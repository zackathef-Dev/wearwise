import { base64ToBytes } from '@/data/ble/base64';

/* Which backends the app will talk to. The URL decides the environment, never code:
 *   - https://<anything>  — the owner's Supabase Cloud project or a self-hosted /
 *     institutional deployment. Allowed in every build.
 *   - http://<local host> — a local Supabase (`supabase start`) on the developer's
 *     machine. Allowed ONLY in development builds (`allowLocalHttp`, which defaults to
 *     __DEV__) and only to loopback, the Android emulator's host alias, private LAN
 *     ranges or *.local names. A release build refuses http outright, so a stray local
 *     .env can't ship a cleartext backend.
 * The key must be a public client credential: a publishable key, or a legacy JWT
 * whose role is anon. A service_role / secret key is refused. */

const PRIVATE_IPV4 = /^(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

export function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.local') || PRIVATE_IPV4.test(hostname);
}

export function validPublicBackend(url: string, key: string, allowLocalHttp: boolean = __DEV__): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname) return false;
    const secure = parsed.protocol === 'https:';
    const localHttp = parsed.protocol === 'http:' && allowLocalHttp && isLocalDevelopmentHost(parsed.hostname);
    if (!secure && !localHttp) return false;
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
    const parts = key.split('.');
    if (parts.length !== 3) return false;
    const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = base64ToBytes(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const claims = JSON.parse(String.fromCharCode(...bytes));
    return claims.role === 'anon';
  } catch { return false; }
}
