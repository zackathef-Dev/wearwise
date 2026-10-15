import { isLocalDevelopmentHost, validPublicBackend } from '../public-config';
import { bytesToBase64 } from '@/data/ble/base64';

const jwt = (role: string) => `e30.${bytesToBase64(new Uint8Array([...JSON.stringify({ role })].map((c) => c.charCodeAt(0))))}.test`;

test('permits any HTTPS backend with a public client credential, in every build', () => {
  for (const url of ['https://example.supabase.co', 'https://supabase.example.org', 'https://db.example.org:8443']) {
    expect(validPublicBackend(url, 'sb_publishable_example', false)).toBe(true);
  }
  for (const url of ['https://example.supabase.co?token=x', 'https://example.supabase.co#x', 'https://user:pass@example.supabase.co', 'ftp://example.supabase.co', 'not a url']) {
    expect(validPublicBackend(url, 'sb_publishable_example', true)).toBe(false);
  }
  expect(validPublicBackend('https://example.supabase.co', 'sb_secret_example', false)).toBe(false);
  expect(validPublicBackend('https://example.supabase.co', jwt('anon'), false)).toBe(true);
  expect(validPublicBackend('https://example.supabase.co', jwt('service_role'), false)).toBe(false);
});

test('plain http only in development builds, and only to a local or LAN host', () => {
  const local = ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://10.0.2.2:54321', 'http://192.168.1.20:54321', 'http://172.20.0.5:54321', 'http://devbox.local:54321'];
  for (const url of local) {
    expect(validPublicBackend(url, jwt('anon'), true)).toBe(true);
    expect(validPublicBackend(url, jwt('anon'), false)).toBe(false); // release: never http
  }
  for (const url of ['http://example.supabase.co', 'http://8.8.8.8:54321', 'http://172.32.0.1:54321']) {
    expect(validPublicBackend(url, jwt('anon'), true)).toBe(false);
  }
  expect(validPublicBackend('http://127.0.0.1:54321', jwt('service_role'), true)).toBe(false);
});

test('local host detection', () => {
  expect(isLocalDevelopmentHost('192.168.0.9')).toBe(true);
  expect(isLocalDevelopmentHost('example.org')).toBe(false);
  expect(isLocalDevelopmentHost('192.168.0.9.example.org')).toBe(false);
});
