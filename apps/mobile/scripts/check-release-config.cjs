const fs = require('node:fs');
const path = require('node:path');
const envFile = path.resolve(__dirname, '../.env.production');
if (!fs.existsSync(envFile)) throw new Error('Create the ignored .env.production using .env.example before release.');
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')];
}));
const url = new URL(env.EXPO_PUBLIC_SUPABASE_URL);
// Any HTTPS host: the owner's Supabase Cloud project or a self-hosted deployment. Never
// http, and never a loopback / private-LAN address (that's a local development backend).
const localHost = url.hostname === 'localhost' || url.hostname.endsWith('.local') ||
  /^(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
if (url.protocol !== 'https:' || localHost || url.username || url.password || url.search || url.hash) throw new Error('Production backend must be an HTTPS URL on a public host (Supabase Cloud or self-hosted), not a local development backend.');
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
try { publicKey ||= JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch {}
if (!publicKey) throw new Error('Only a publishable or legacy anon key may be bundled.');
if (Object.keys(env).some((name) => !['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'].includes(name))) throw new Error('Unexpected production environment entry; review before bundling.');
console.log('Production configuration validated: HTTPS and public client credential only.');
