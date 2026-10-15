import * as ExpoCrypto from 'expo-crypto';

/* The email-link sign-in (PKCE) in supabase-js uses two pieces of the Web Crypto API.
 * Hermes has neither, and supabase-js then quietly falls back to Math.random for the
 * one-time secret and sends it unhashed. Provide both from expo-crypto: the system's
 * secure random generator and SHA-256. Imported before the Supabase client is made.
 *
 * Only digest() is provided under `subtle`. Nothing in the app calls auth.getClaims(),
 * the one supabase-js path that would want importKey/verify.
 */
type Global = { crypto?: { getRandomValues?: unknown; subtle?: unknown } };

function install(): void {
  const g = globalThis as Global;
  try {
    if (!g.crypto) g.crypto = {};
    const c = g.crypto;
    if (typeof c.getRandomValues !== 'function') {
      c.getRandomValues = <T extends Parameters<typeof ExpoCrypto.getRandomValues>[0]>(a: T): T => ExpoCrypto.getRandomValues(a);
    }
    if (!c.subtle) {
      c.subtle = {
        digest: (algorithm: string | { name: string }, data: BufferSource): Promise<ArrayBuffer> => {
          const name = (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase();
          if (name !== 'SHA-256') return Promise.reject(new Error(`digest: ${name} is not supported`));
          return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
        },
      };
    }
  } catch {
    /* A runtime with its own read-only crypto already has what supabase-js needs. */
  }
}

install();
