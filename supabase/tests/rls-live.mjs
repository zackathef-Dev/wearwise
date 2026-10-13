/* Live RLS verification against a HOSTED project, through the same public API
 * the phone uses. Mirrors supabase/tests/rls_profiles.test.sql (which is the
 * version to run against a local Supabase: `supabase test db`).
 *
 *   SB_PROJECT_REF   the project's ref (Project Settings → General)
 *   SB_ANON          its publishable / anon key
 *   SB_PAT           a personal access token (creates and deletes the test users by SQL)
 *   SB_TEST_MAILBOX  an address you own; test users are <local>+wwrls-<tag>@<domain>
 *
 * Test users are created by SQL (not the sign-up endpoint) because a free project
 * without custom SMTP caps sign-up EMAILS at 2/hour — inserting into auth.users
 * still fires the consent trigger, and the password grant used to sign them in is
 * not email-rate-limited. Cleanup runs in `finally`, and on Ctrl-C.
 *
 * Each run uses a fresh random password, so users left behind by a crash can't be
 * signed in to by anyone reading this file. Cleanup deletes exactly this run's addresses.
 */
import { randomBytes } from 'node:crypto';

const REF = process.env.SB_PROJECT_REF;
const URL = `https://${REF}.supabase.co`;
const ANON = process.env.SB_ANON;
const PAT = process.env.SB_PAT;
const MAIL = process.env.SB_TEST_MAILBOX;
if (!/^[a-z0-9]{20}$/.test(REF ?? '') || !ANON || !PAT || !MAIL) { console.error('need SB_PROJECT_REF, SB_ANON, SB_PAT, SB_TEST_MAILBOX'); process.exit(1); }

const [local, domain] = MAIL.split('@');
const addr = (tag) => `${local}+wwrls-${tag}@${domain}`;
const PW = `ww-${randomBytes(18).toString('base64url')}`;
const TAGS = ['a', 'b', 'c', 'w'];
/* What the sign-up trigger requires besides consent (migrations 7–9). */
const ACCOUNT = { adult_confirmed_at: new Date().toISOString(), terms_version: '2026-10-16' };
const mgmt = { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' };

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: mgmt, body: JSON.stringify({ query: q }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
async function rest(path, jwt, init = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function signIn(tag) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: addr(tag), password: PW }) });
  return { status: r.status, body: await r.json() };
}
async function signupApi(tag, password, data) {
  const r = await fetch(`${URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: addr(tag), password, data }) });
  return { status: r.status, body: await r.json() };
}

/* Insert a confirmed user + identity. The profiles trigger fires on the users insert. */
const mk = (tag, meta) => sql(`
  with u as (
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      '${addr(tag)}', crypt('${PW}', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '${JSON.stringify(meta)}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', '')
    returning id, email)
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    select gen_random_uuid(), id, id::text, 'email', jsonb_build_object('sub', id::text, 'email', email), now(), now(), now() from u
  returning user_id`);

async function cleanup() {
  const list = TAGS.map((t) => `'${addr(t)}'`).join(', ');
  return sql(`delete from auth.users where email in (${list})`);
}
process.once('SIGINT', () => { void cleanup().finally(() => process.exit(130)); });

const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok]); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

try {
  console.log('\n-- account creation --');
  const mkA = await mk('a', { display_name: 'Alpha', consent_recorded_at: '2026-08-26T00:00:00Z', ...ACCOUNT });
  check('participant A created; trigger accepted consent', mkA.status === 201, `HTTP ${mkA.status} ${mkA.status !== 201 ? JSON.stringify(mkA.body).slice(0, 120) : ''}`);
  const mkB = await mk('b', { display_name: 'Bravo', consent_recorded_at: '2026-08-26T00:00:00Z', ...ACCOUNT });
  check('participant B created', mkB.status === 201, `HTTP ${mkB.status}`);
  const mkC = await mk('c', { display_name: 'NoConsent', ...ACCOUNT });
  check('user WITHOUT consent is rejected by the trigger', mkC.status >= 400 && /consent_recorded_at missing/.test(JSON.stringify(mkC.body)), `HTTP ${mkC.status}: ${String(mkC.body?.message || '').slice(0, 70)}`);

  const w = await signupApi('w', 'short1', { display_name: 'Weak', consent_recorded_at: '2026-08-26T00:00:00Z', ...ACCOUNT });
  check('sign-up API rejects a 6-char password (server min is 10)', w.status === 422, `HTTP ${w.status} ${w.body?.error_code || ''}`);

  console.log('\n-- sign-in --');
  const a = await signIn('a'), b = await signIn('b');
  check('A signs in with password and gets a session', a.status === 200 && !!a.body.access_token, `HTTP ${a.status} ${a.body?.error_code || ''}`);
  check('B signs in with password and gets a session', b.status === 200 && !!b.body.access_token, `HTTP ${b.status} ${b.body?.error_code || ''}`);
  const jwtA = a.body.access_token, jwtB = b.body.access_token;
  const idA = a.body.user?.id, idB = b.body.user?.id;

  console.log('\n-- row level security, as participant A --');
  const seen = await rest('profiles?select=id,display_name,account_role', jwtA);
  check('A sees exactly one profile: their own', seen.status === 200 && seen.body?.length === 1 && seen.body[0].id === idA, `rows=${seen.body?.length}`);
  check('profile carries the sign-up display name (trigger)', seen.body?.[0]?.display_name === 'Alpha', `got "${seen.body?.[0]?.display_name}"`);

  const rename = await rest(`profiles?id=eq.${idA}`, jwtA, { method: 'PATCH', body: JSON.stringify({ display_name: 'Alpha Renamed' }) });
  check('A can rename themselves', rename.status === 200 && rename.body?.[0]?.display_name === 'Alpha Renamed', `HTTP ${rename.status}`);

  const promote = await rest(`profiles?id=eq.${idA}`, jwtA, { method: 'PATCH', body: JSON.stringify({ account_role: 'researcher' }) });
  const roleNow = (await rest('profiles?select=account_role', jwtA)).body?.[0]?.account_role;
  check('A cannot promote themselves to researcher', promote.status >= 400 && roleNow === 'participant', `HTTP ${promote.status}, role now "${roleNow}"`);

  const cross = await rest(`profiles?id=eq.${idB}`, jwtA, { method: 'PATCH', body: JSON.stringify({ display_name: 'hacked' }) });
  const bName = (await rest('profiles?select=display_name', jwtB)).body?.[0]?.display_name;
  check("A's update against B's row changes nothing", (cross.body?.length ?? 0) === 0 && bName === 'Bravo', `affected=${cross.body?.length ?? 0}, B still "${bName}"`);

  const insert = await rest('profiles', jwtA, { method: 'POST', body: JSON.stringify({ id: idA, display_name: 'x', consent_recorded_at: '2026-08-26T00:00:00Z' }) });
  check('A cannot INSERT a profile row directly (trigger-only creation)', insert.status >= 400, `HTTP ${insert.status}`);

  const del = await rest(`profiles?id=eq.${idA}`, jwtA, { method: 'DELETE' });
  const stillThere = (await rest('profiles?select=id', jwtA)).body?.length === 1;
  check('A cannot DELETE their profile row (no policy)', stillThere, `HTTP ${del.status}, row still present=${stillThere}`);

  console.log('\n-- as participant B --');
  const seenB = await rest('profiles?select=id', jwtB);
  check('B sees only their own profile', seenB.body?.length === 1 && seenB.body[0].id === idB, `rows=${seenB.body?.length}`);

  console.log('\n-- as an anonymous caller (no session) --');
  const anon = await fetch(`${URL}/rest/v1/profiles?select=id`, { headers: { apikey: ANON } });
  const anonBody = await anon.json().catch(() => null);
  check('anonymous sees zero profiles', anon.status === 200 ? anonBody?.length === 0 : anon.status === 401, `HTTP ${anon.status}, rows=${anonBody?.length ?? 'n/a'}`);
} finally {
  console.log('\n-- cleanup --');
  const d = await cleanup();
  const left = await sql(`select count(*)::int as n from public.profiles`);
  console.log(`  test users deleted: HTTP ${d.status}; profiles remaining: ${left.body?.[0]?.n}`);
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
