import { z } from 'zod';
import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import { AuthFailure } from '@/domain/errors/auth-errors';
import { secureSessionStorage } from '@/platform/secure-storage/secure-session-storage';
import type {
  AuthGateway,
  Participant,
  RegisterInput,
  RegisterOutcome,
} from '@/domain/repositories/auth-gateway';

/* AuthGateway over supabase-js.
 *
 * Everything that leaves this file is domain-shaped: Supabase responses are
 * validated with zod before they become a Participant (external data is validated
 * at the boundary, not trusted), and every Supabase error is folded into an
 * AuthFailure code the UI is allowed to see.
 */

/* What we require of auth.users + metadata to call someone signed in. */
const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  user_metadata: z
    .object({
      display_name: z.string().optional(),
      consent_recorded_at: z.string().optional(),
      adult_confirmed_at: z.string().optional(),
      terms_version: z.string().optional(),
    })
    .passthrough(),
});

function toParticipant(raw: unknown): Participant {
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) throw new AuthFailure('unknown', parsed.error);
  const u = parsed.data;
  return {
    id: u.id,
    email: u.email,
    displayName: u.user_metadata.display_name ?? '',
    consentRecordedAt: u.user_metadata.consent_recorded_at ?? '',
    adultConfirmed: !!u.user_metadata.adult_confirmed_at,
    termsVersion: u.user_metadata.terms_version ?? null,
  };
}

/* Supabase → domain error folding. Matching is on status + normalized message
 * fragments because supabase-js does not expose stable machine codes for all of
 * these; the fold is intentionally conservative — anything unrecognized becomes
 * 'unknown', never a guess. */
function fold(e: AuthError | null | undefined): AuthFailure {
  if (!e) return new AuthFailure('unknown');
  const msg = (e.message ?? '').toLowerCase();
  if (e.status === 0 || msg.includes('network request failed') || msg.includes('fetch failed')) {
    return new AuthFailure('network', e);
  }
  if (e.status === 429) return new AuthFailure('rate-limited', e);
  if (msg.includes('invalid login credentials')) return new AuthFailure('invalid-credentials', e);
  if (msg.includes('email not confirmed')) return new AuthFailure('email-not-confirmed', e);
  if (msg.includes('already registered') || msg.includes('already been registered')) {
    return new AuthFailure('email-in-use', e);
  }
  if (msg.includes('password') && (msg.includes('weak') || msg.includes('at least'))) {
    return new AuthFailure('weak-password', e);
  }
  return new AuthFailure('unknown', e);
}

export class SupabaseAuthGateway implements AuthGateway {
  constructor(private readonly client: SupabaseClient, private readonly storageKey: string | null = null) {}

  async restore(): Promise<Participant | null> {
    /* getUser() revalidates against the server (and refreshes via the stored
       session); getSession() alone would trust an unverified local blob. */
    const { data, error } = await this.client.auth.getUser();
    if (error) {
      /* An expired/absent session is a signed-out state, not a failure. */
      if (error.status === 400 || error.status === 401 || error.message.includes('session')) return null;
      throw fold(error);
    }
    return data.user ? toParticipant(data.user) : null;
  }

  async register(input: RegisterInput): Promise<RegisterOutcome> {
    const { data, error } = await this.client.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        /* The trigger on auth.users reads these; a sign-up without consent is
           rejected server-side even if a modified client skips the checkbox. */
        data: {
          display_name: input.displayName,
          consent_recorded_at: input.consentRecordedAt,
          adult_confirmed_at: input.adultConfirmedAt,
          terms_version: input.termsVersion,
          terms_accepted_at: input.consentRecordedAt,
        },
        emailRedirectTo: 'wearwise://auth/confirmed',
      },
    });
    if (error) throw fold(error);
    if (data.session && data.user) {
      return { kind: 'signed-in', participant: toParticipant(data.user) };
    }
    /* Email confirmation on: no session until the link is followed. */
    return { kind: 'confirmation-email-sent', email: input.email };
  }

  async signIn(email: string, password: string): Promise<Participant> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw fold(error);
    return toParticipant(data.user);
  }

  async signOut(): Promise<void> {
    /* scope:'local' — sign this device out. Revoking every session everywhere is a
       separate, explicit account action, not a side effect of tapping Sign out. */
    const { error } = await this.client.auth.signOut({ scope: 'local' }).catch((e: AuthError) => ({ error: e }));
    if (error) {
      /* Offline with an expired token, supabase-js can't load the session to sign it
         out and leaves it stored. The person still asked to be signed out here, so
         remove it ourselves: this device forgets the account either way. */
      await this.forgetStoredSession();
      throw fold(error);
    }
  }

  private async forgetStoredSession(): Promise<void> {
    if (!this.storageKey) return;
    for (const key of [this.storageKey, `${this.storageKey}-code-verifier`, `${this.storageKey}-user`]) {
      await secureSessionStorage.removeItem(key).catch(() => undefined);
    }
  }

  async confirmAccount({ adult, termsVersion }: { adult: boolean; termsVersion: string | null }): Promise<Participant> {
    /* The server's record first (profiles.adult_confirmed_at gates uploads;
       terms_version is the acceptance record), then the account metadata the app reads
       at sign-in, offline included. A server without the adults-only / terms migrations
       has no such function (PGRST202): nothing to record there, the metadata carries it. */
    const rpc = async (fn: string, args?: Record<string, unknown>): Promise<unknown> => {
      const { data, error } = await this.client.rpc(fn, args);
      if (error && error.code !== 'PGRST202') {
        throw new AuthFailure(/network request failed|fetch failed/i.test(error.message) ? 'network' : 'unknown', error);
      }
      return data;
    };
    const metadata: Record<string, string> = {};
    if (adult) {
      const at = await rpc('confirm_adult');
      metadata.adult_confirmed_at = typeof at === 'string' ? at : new Date().toISOString();
    }
    if (termsVersion) {
      await rpc('accept_terms', { p_version: termsVersion });
      metadata.terms_version = termsVersion;
      metadata.terms_accepted_at = new Date().toISOString();
    }
    const { data, error } = await this.client.auth.updateUser({ data: metadata });
    if (error) throw fold(error);
    return toParticipant(data.user);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: 'wearwise://auth/reset',
    });
    /* Success and unknown-account resolve identically (anti-enumeration). Only
       transport-level failures surface, because those the user can act on. */
    if (error) {
      const folded = fold(error);
      if (folded.code === 'network' || folded.code === 'rate-limited') throw folded;
    }
  }

  async updateDisplayName(name: string): Promise<Participant> {
    /* Two homes, both written: the auth metadata the app reads at sign-in, and the
       profiles row (display_name is the one column a participant may update — the
       2026-10-13 hardening grants nothing else). */
    const { data, error } = await this.client.auth.updateUser({ data: { display_name: name } });
    if (error) throw fold(error);
    const participant = toParticipant(data.user);
    const { error: profileError } = await this.client.from('profiles').update({ display_name: name }).eq('id', participant.id);
    if (profileError) throw new AuthFailure('unknown', profileError);
    return participant;
  }

  onSessionChange(listener: (p: Participant | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session: Session | null) => {
      // restore() validates persisted identity with the server before unlocking UI.
      if (_event === 'INITIAL_SESSION') return;
      try {
        listener(session?.user ? toParticipant(session.user) : null);
      } catch {
        /* A malformed session is treated as signed out rather than a crash loop. */
        listener(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }
}
