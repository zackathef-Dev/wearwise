import { ACCEPTANCE_VERSION } from '@wearwise/legal';
import { accountNeeds, homeRoute, makeAuthStore } from '../auth-store';
import { AuthFailure } from '@/domain/errors/auth-errors';
import type {
  AuthGateway,
  Participant,
  RegisterOutcome,
} from '@/domain/repositories/auth-gateway';

/* Auth store behaviour against a scripted gateway.
 *
 * The fake implements the same port the Supabase gateway does — this is test
 * substitution at the architecture's seam, not mock security: the production
 * store construction (useAuth) only ever receives the real gateway or null.
 */

const alex: Participant = {
  id: '3fbb2f6e-52a5-41a9-9d1c-1f24b1c86e11',
  email: 'alex@wearwise.io',
  displayName: 'Alex Reyes',
  consentRecordedAt: '2026-08-26T00:00:00.000Z',
  adultConfirmed: true,
  termsVersion: ACCEPTANCE_VERSION,
};

function makeGateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    restore: async () => null,
    register: async (): Promise<RegisterOutcome> => ({ kind: 'confirmation-email-sent', email: alex.email }),
    signIn: async () => alex,
    signOut: async () => undefined,
    requestPasswordReset: async () => undefined,
    updateDisplayName: async (name) => ({ id: 'u1', email: 'a@b.c', displayName: name, consentRecordedAt: '', adultConfirmed: true, termsVersion: ACCEPTANCE_VERSION }),
    confirmAccount: async () => alex,
    onSessionChange: () => () => undefined,
    ...overrides,
  };
}

describe('auth store', () => {
  test('starts unconfigured with no gateway, and every action fails with the setup code', async () => {
    const store = makeAuthStore(null);
    expect(store.getState().status).toBe('unconfigured');

    await expect(store.getState().signIn('a@b.c', 'pw')).rejects.toMatchObject({
      code: 'backend-not-configured',
    });
    /* restore() must settle the state, not throw — splash awaits it. */
    await store.getState().restore();
    expect(store.getState().status).toBe('unconfigured');
  });

  test('restore lands signed-in when a session exists', async () => {
    const store = makeAuthStore(makeGateway({ restore: async () => alex }));
    expect(store.getState().status).toBe('restoring');
    await store.getState().restore();
    expect(store.getState().status).toBe('signed-in');
    expect(store.getState().participant?.email).toBe(alex.email);
  });

  test('restore failure (offline launch) degrades to signed-out, not a crash', async () => {
    const store = makeAuthStore(
      makeGateway({ restore: async () => { throw new AuthFailure('network'); } }),
    );
    await store.getState().restore();
    expect(store.getState().status).toBe('signed-out');
    expect(store.getState().participant).toBeNull();
  });

  test('signIn success stores the participant', async () => {
    const store = makeAuthStore(makeGateway());
    await store.getState().signIn(alex.email, 'correct-horse-battery');
    expect(store.getState().status).toBe('signed-in');
    expect(store.getState().participant).toEqual(alex);
  });

  test('signIn failure propagates and leaves the store signed out', async () => {
    const store = makeAuthStore(
      makeGateway({ signIn: async () => { throw new AuthFailure('invalid-credentials'); } }),
    );
    await expect(store.getState().signIn(alex.email, 'wrong')).rejects.toMatchObject({
      code: 'invalid-credentials',
    });
    expect(store.getState().status).toBe('restoring'); // untouched — no partial sign-in
    expect(store.getState().participant).toBeNull();
  });

  test('register can complete as signed-in or as confirmation-pending', async () => {
    const signedIn = makeAuthStore(
      makeGateway({ register: async () => ({ kind: 'signed-in', participant: alex }) }),
    );
    await expect(
      signedIn.getState().register({
        email: alex.email, password: 'long-enough-pw', displayName: 'Alex',
        consentRecordedAt: alex.consentRecordedAt, adultConfirmedAt: alex.consentRecordedAt, termsVersion: ACCEPTANCE_VERSION,
      }),
    ).resolves.toBe('signed-in');
    expect(signedIn.getState().status).toBe('signed-in');

    const pending = makeAuthStore(makeGateway());
    await expect(
      pending.getState().register({
        email: alex.email, password: 'long-enough-pw', displayName: 'Alex',
        consentRecordedAt: alex.consentRecordedAt, adultConfirmedAt: alex.consentRecordedAt, termsVersion: ACCEPTANCE_VERSION,
      }),
    ).resolves.toBe('confirmation-email-sent');
    expect(pending.getState().status).not.toBe('signed-in');
  });

  test('signOut clears local state even when the network revoke fails', async () => {
    const store = makeAuthStore(
      makeGateway({
        restore: async () => alex,
        signOut: async () => { throw new AuthFailure('network'); },
      }),
    );
    await store.getState().restore();
    expect(store.getState().status).toBe('signed-in');

    await expect(store.getState().signOut()).rejects.toMatchObject({ code: 'network' });
    expect(store.getState().status).toBe('signed-out');
    expect(store.getState().participant).toBeNull();
  });

  test('a remote sign-out (session change) flips the store', async () => {
    let push: ((p: Participant | null) => void) | undefined;
    const store = makeAuthStore(
      makeGateway({
        restore: async () => alex,
        onSessionChange: (listener) => { push = listener; return () => undefined; },
      }),
    );
    await store.getState().restore();
    expect(store.getState().status).toBe('signed-in');

    push?.(null);
    expect(store.getState().status).toBe('signed-out');
  });

  test('an account must be 18+ and on the current terms before entering the app', async () => {
    const legacy = { ...alex, adultConfirmed: false, termsVersion: null };
    expect(accountNeeds(legacy)).toEqual({ adult: true, terms: true });
    expect(accountNeeds({ ...alex, termsVersion: '2020-01-01' })).toEqual({ adult: false, terms: true });
    expect(accountNeeds(alex)).toEqual({ adult: false, terms: false });

    let answered: unknown = null;
    const store = makeAuthStore(makeGateway({
      restore: async () => legacy,
      confirmAccount: async (a) => { answered = a; return alex; },
    }));
    await store.getState().restore();
    expect(homeRoute(store.getState().participant)).toBe('/confirm-account');
    await store.getState().confirmAccount({ adult: true, termsVersion: ACCEPTANCE_VERSION });
    expect(answered).toEqual({ adult: true, termsVersion: ACCEPTANCE_VERSION });
    expect(homeRoute(store.getState().participant)).toBe('/home');
  });
});
