/* The port the domain sees. Implementations live in data/remote; screens never
 * import an implementation, only use cases that take this interface.
 *
 * `Participant` is the domain's view of a signed-in person — deliberately small.
 * Tokens are NOT part of it: session material lives inside the gateway's secure
 * storage and never crosses into domain state, so nothing above this line can
 * accidentally log or persist it.
 */

export interface Participant {
  id: string;
  email: string;
  displayName: string;
  /* When the account's storage consent was recorded (ISO 8601, UTC). */
  consentRecordedAt: string;
  /* The person has declared they are 18 or older. WearWise accounts are for adults;
     accounts made before that rule confirm once (confirmAdult) before using the app. */
  adultConfirmed: boolean;
  /* The version (YYYY-MM-DD) of the terms, privacy policy, collection notice and research
     information this account last accepted; null if never (packages/legal). */
  termsVersion: string | null;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  /* The moment the consent checkbox was accepted, captured client-side and stored
     server-side by the sign-up trigger. Absence server-rejects the sign-up. */
  consentRecordedAt: string;
  /* The moment "I'm 18 or older" was ticked. Absence server-rejects the sign-up too. */
  adultConfirmedAt: string;
  /* The terms version accepted at sign-up (ACCEPTANCE_VERSION). Also server-required. */
  termsVersion: string;
}

export type RegisterOutcome =
  | { kind: 'signed-in'; participant: Participant }
  | { kind: 'confirmation-email-sent'; email: string };

export interface AuthGateway {
  /* Resolve the persisted session, refreshing if needed. Null = signed out. */
  restore(): Promise<Participant | null>;

  register(input: RegisterInput): Promise<RegisterOutcome>;
  signIn(email: string, password: string): Promise<Participant>;
  signOut(): Promise<void>;
  /* The signed-in person confirms what the account still needs: 18 or older (accounts
     from before that rule) and/or the current terms version. */
  confirmAccount(answers: { adult: boolean; termsVersion: string | null }): Promise<Participant>;

  /* Fire-and-forget by design: resolves whether or not the account exists, so the
     request path cannot be used to probe for accounts. */
  requestPasswordReset(email: string): Promise<void>;

  /* Change the signed-in participant's display name (account metadata and profile). */
  updateDisplayName(name: string): Promise<Participant>;

  /* Live session changes (token refresh failure, remote sign-out). */
  onSessionChange(listener: (p: Participant | null) => void): () => void;
}
