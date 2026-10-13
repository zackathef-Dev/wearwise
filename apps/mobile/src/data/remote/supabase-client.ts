import 'react-native-url-polyfill/auto';
import '@/platform/crypto/web-crypto'; // secure PKCE: before supabase-js is created
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { secureSessionStorage } from '@/platform/secure-storage/secure-session-storage';
import { validPublicBackend } from './public-config';

/* One Supabase client for the whole app, or null when the build carries no
 * backend configuration.
 *
 * Null is a real state, not an error: the repo ships without credentials, and a
 * clone must build and run to the "backend not configured" screen rather than
 * crash or silently mock. Configuration comes from EXPO_PUBLIC_* env (a local
 * .env, which is gitignored):
 *
 *   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
 *
 * The anon key is a PUBLISHABLE key — safe in the binary by design; every privilege
 * decision happens server-side in RLS. The service-role key must never appear in
 * this codebase in any form.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Where supabase-js keeps the session in secure storage: its own default key, spelled
    out so sign-out can remove it even when the client can't (offline, expired token). */
export const authStorageKey: string | null = (() => {
  try { return url ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token` : null; } catch { return null; }
})();

export const supabase: SupabaseClient | null =
  url && anonKey && validPublicBackend(url, anonKey)
    ? createClient(url, anonKey, {
        auth: {
          storage: secureSessionStorage,
          storageKey: authStorageKey ?? undefined,
          autoRefreshToken: true,
          persistSession: true,
          flowType: 'pkce',
          /* Deep-link flows (email confirm, reset) hand the app a URL; we exchange
             it explicitly in the auth gateway rather than having the client guess. */
          detectSessionInUrl: false,
        },
      })
    : null;

export const backendConfigured = supabase != null;
