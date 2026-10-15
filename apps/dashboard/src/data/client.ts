import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ViewerApi } from './api';

/* The one Supabase client. Same project as the phone app; only the public anon key
 * ships to the browser — what a viewer can see is decided by RLS on the server.
 *
 * Auth: email + password only. detectSessionInUrl is off: the only link that comes
 * back here is the password reset, and ResetPasswordPage reads it explicitly. PKCE:
 * a reset link carries a one-time ?code= that only works in the browser that asked
 * for it (the verifier stays here), instead of a session in the URL that would end
 * up in browser history and could be used to swap someone else's session in.
 * The session (tokens only, never sample data) persists in localStorage, so a reload
 * doesn't sign the viewer out.
 *
 * Every request is no-store: decoded recordings must not linger in the browser's
 * disk cache after sign-out (Storage objects carry a max-age).
 */

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabase: SupabaseClient | null = url && anonKey
  ? createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  })
  : null;

export const api: ViewerApi | null = supabase ? new ViewerApi(supabase) : null;
