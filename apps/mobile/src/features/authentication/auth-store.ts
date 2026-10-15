import { create } from 'zustand';
import { ACCEPTANCE_VERSION } from '@wearwise/legal';
import { AuthFailure } from '@/domain/errors/auth-errors';
import type { AuthGateway, Participant, RegisterInput } from '@/domain/repositories/auth-gateway';
import { supabase, backendConfigured, authStorageKey } from '@/data/remote/supabase-client';
import { SupabaseAuthGateway } from '@/data/repositories/supabase-auth-gateway';

/* Client auth state. Zustand owns "who is signed in right now"; server state
 * (profiles, sessions) belongs to TanStack Query in later milestones.
 *
 * status:
 *   'restoring'        app start, persisted session being validated
 *   'signed-out'
 *   'signed-in'
 *   'unconfigured'     no backend credentials in this build — a setup state shown
 *                      honestly in the UI, never silently mocked (working rule:
 *                      no mock security in production paths)
 */

type AuthStatus = 'restoring' | 'signed-out' | 'signed-in' | 'unconfigured';

interface AuthState {
  status: AuthStatus;
  participant: Participant | null;

  restore(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  register(input: RegisterInput): Promise<'signed-in' | 'confirmation-email-sent'>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updateDisplayName(name: string): Promise<void>;
  /* What the account still needs before use: 18+ and/or the current terms. */
  confirmAccount(answers: { adult: boolean; termsVersion: string | null }): Promise<void>;
}

/* The gateway is module-scoped, not stored in state: it holds no UI-relevant data
 * and screens must never reach it directly. Tests construct their own store via
 * makeAuthStore with a fake gateway. */
const gateway: AuthGateway | null = supabase ? new SupabaseAuthGateway(supabase, authStorageKey) : null;

export function makeAuthStore(gw: AuthGateway | null) {
  return create<AuthState>((set) => {
    const requireGateway = (): AuthGateway => {
      if (!gw) throw new AuthFailure('backend-not-configured');
      return gw;
    };

    /* Keep the store honest about remote sign-outs and refresh failures. */
    gw?.onSessionChange((participant) => {
      set(participant ? { status: 'signed-in', participant } : { status: 'signed-out', participant: null });
    });

    return {
      status: gw ? 'restoring' : 'unconfigured',
      participant: null,

      async restore() {
        if (!gw) {
          set({ status: 'unconfigured' });
          return;
        }
        try {
          const participant = await gw.restore();
          set(participant ? { status: 'signed-in', participant } : { status: 'signed-out', participant: null });
        } catch {
          /* Restoration failing (offline at launch) is a signed-out start, not a
             crash; sign-in remains available and will surface real errors. */
          set({ status: 'signed-out', participant: null });
        }
      },

      async signIn(email, password) {
        const participant = await requireGateway().signIn(email, password);
        set({ status: 'signed-in', participant });
      },

      async register(input) {
        const outcome = await requireGateway().register(input);
        if (outcome.kind === 'signed-in') {
          set({ status: 'signed-in', participant: outcome.participant });
        }
        return outcome.kind;
      },

      async signOut() {
        /* Local state clears even if the network revoke fails — the person asked
           to be signed out on this device, and that must not depend on wifi. The
           gateway removes the stored tokens either way (supabase-js alone keeps them
           when offline with an expired token). */
        try {
          await requireGateway().signOut();
        } finally {
          set({ status: 'signed-out', participant: null });
        }
      },

      async requestPasswordReset(email) {
        await requireGateway().requestPasswordReset(email);
      },

      async updateDisplayName(name) {
        const participant = await requireGateway().updateDisplayName(name);
        set({ participant });
      },

      async confirmAccount(answers) {
        const participant = await requireGateway().confirmAccount(answers);
        set({ participant });
      },
    };
  });
}

export const useAuth = makeAuthStore(gateway);

/** What a signed-in account must answer before using the app: 18+ (accounts made before
    that rule) and the current terms (new or changed since it last accepted). */
export function accountNeeds(p: Participant | null): { adult: boolean; terms: boolean } {
  return {
    adult: !!p && !p.adultConfirmed,
    terms: !!p && (p.termsVersion ?? '') < ACCEPTANCE_VERSION,
  };
}

/** Where a signed-in person goes: the app, or first "Before you continue". */
export function homeRoute(p: Participant | null): '/home' | '/confirm-account' {
  const needs = accountNeeds(p);
  return needs.adult || needs.terms ? '/confirm-account' : '/home';
}
export { backendConfigured };
