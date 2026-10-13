/* One-off Supabase Management API helper for a HOSTED project (Supabase Cloud). For a
 * local Supabase, run the same steps from supabase/admin/*.sql in Studio's SQL editor
 * (http://127.0.0.1:54323) or with psql — see docs/database.md.
 *
 * The project and token come from the environment and are never written anywhere.
 * Read the token without echoing it or leaving it in your shell history (don't type
 * `SB_PAT=sbp_... node ...`):
 *   export SB_PROJECT_REF=<your project ref>   # Project Settings → General
 *   read -rs SB_PAT && export SB_PAT        # paste the token, press Enter
 *   node supabase/scripts/admin.mjs sql <file-or-inline-sql>
 *   node supabase/scripts/admin.mjs auth-config
 *   node supabase/scripts/admin.mjs set-password-min 10
 *   unset SB_PAT                            # when you're done
 * Account commands (create-viewer, set-role, delete-account) are described below.
 */
import { readFileSync, existsSync } from 'fs';

const REF = process.env.SB_PROJECT_REF;
const PAT = process.env.SB_PAT;
if (!/^[a-z0-9]{20}$/.test(REF ?? '')) { console.error('SB_PROJECT_REF missing or malformed. Run: export SB_PROJECT_REF=<your project ref> (Project Settings → General).'); process.exit(1); }
if (!PAT) { console.error('SB_PAT missing. Run: read -rs SB_PAT && export SB_PAT'); process.exit(1); }
const H = { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' };
const base = `https://api.supabase.com/v1/projects/${REF}`;
const projectUrl = `https://${REF}.supabase.co`;

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'sql') {
  const query = existsSync(arg) ? readFileSync(arg, 'utf8') : arg;
  const r = await fetch(`${base}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) });
  const body = await r.text();
  console.log(`HTTP ${r.status}`);
  console.log(body.slice(0, 2000));
  process.exit(r.ok ? 0 : 1);
}

if (cmd === 'auth-config') {
  const r = await fetch(`${base}/config/auth`, { headers: H });
  const j = await r.json();
  console.log(JSON.stringify({
    password_min_length: j.password_min_length,
    mailer_autoconfirm: j.mailer_autoconfirm,
    external_email_enabled: j.external_email_enabled,
    site_url: j.site_url,
    uri_allow_list: j.uri_allow_list,
  }, null, 2));
}

if (cmd === 'set-password-min') {
  const r = await fetch(`${base}/config/auth`, { method: 'PATCH', headers: H, body: JSON.stringify({ password_min_length: Number(arg) }) });
  const j = await r.json();
  console.log(`HTTP ${r.status} → password_min_length = ${j.password_min_length}`);
}

/* Accounts. Roles are server-controlled, so only this path — or SQL run by an admin
   (supabase/admin/*.sql) — can make someone a researcher or clinician.
     node admin.mjs create-viewer dr.chen@clinic.org clinician "Dr Chen"
     node admin.mjs set-role someone@example.org researcher|clinician|participant
     node admin.mjs delete-account someone@example.org          (dry run: shows what would go)
     node admin.mjs delete-account someone@example.org --yes    (deletes)
   create-viewer prints a one-time password; ask them to change it after signing in.
   set-role only changes an account whose email address is confirmed, and signs it out
   everywhere so it signs in again under the new role. */
const VIEWER_ROLES = ['researcher', 'clinician'];
const ROLES = ['participant', ...VIEWER_ROLES];
const EMAIL = /^[^\s@']+@[^\s@']+\.[^\s@']+$/;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const runSql = async (query) => {
  const r = await fetch(`${base}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) });
  const body = await r.json().catch(() => null);
  if (!r.ok) { console.error(`HTTP ${r.status}`, body); process.exit(1); }
  return body;
};

if (cmd === 'create-viewer' || cmd === 'set-role') {
  const [email, role, name = ''] = process.argv.slice(3);
  const allowed = cmd === 'create-viewer' ? VIEWER_ROLES : ROLES;
  if (!EMAIL.test(email ?? '') || !allowed.includes(role)) {
    console.error(`usage: ${cmd} <email> <${allowed.join('|')}>${cmd === 'create-viewer' ? ' "<display name>"' : ''}`);
    process.exit(1);
  }
  if (cmd === 'create-viewer') {
    /* The values go inside a $$-quoted DO block below. */
    if (email.includes('$') || name.includes('$')) { console.error('email and display name may not contain "$"'); process.exit(1); }
    const { randomBytes } = await import('crypto');
    const pw = randomBytes(15).toString('base64url');
    /* Same steps as supabase/admin/create-viewer.sql. The sign-up trigger needs the
       consent and 18+ declarations and a terms version the server knows (it stamps
       its own times). The terms acceptance is cleared straight after, so the person
       accepts the current terms (researcher terms included) themselves the first
       time they sign in, not the administrator for them. One request = one
       transaction: nothing is kept if any step fails (e.g. the email exists). */
    const rows = await runSql(`
      do $$
      declare
        new_id uuid := gen_random_uuid();
      begin
        if exists (select 1 from auth.users where lower(email) = lower(${q(email)})) then
          raise exception '% already has an account. Nothing was changed. Use set-role to promote it.', ${q(email)};
        end if;
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
        values ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
          lower(${q(email)}), extensions.crypt(${q(pw)}, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('display_name', left(${q(name)}, 80), 'consent_recorded_at', now(), 'adult_confirmed_at', now(),
                             'terms_version', (select max(t.version) from private.terms_versions t)),
          now(), now(), '', '', '', '', '', '', '', '');
        insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), new_id, new_id::text, 'email', jsonb_build_object('sub', new_id::text, 'email', lower(${q(email)})), now(), now(), now());
        update public.profiles set account_role = ${q(role)}, terms_version = null, terms_accepted_at = null where id = new_id;
        update auth.users set raw_user_meta_data = raw_user_meta_data - 'terms_version' where id = new_id;
      end $$;
      select p.account_role from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = lower(${q(email)})`);
    if (rows?.[0]?.account_role !== role) { console.error(`${email}: account not created as ${role}`); process.exit(1); }
    console.log(`created ${email} as ${role} — one-time password: ${pw}`);
    process.exit(0);
  }
  /* Same as supabase/admin/set-role.sql. */
  const rows = await runSql(`
    with target as (
      select u.id from auth.users u
       where lower(u.email) = lower(${q(email)}) and u.email_confirmed_at is not null
    ), changed as (
      update public.profiles p set account_role = ${q(role)} from target t where p.id = t.id returning p.id
    ), signed_out as (
      delete from auth.sessions s using changed c where s.user_id = c.id returning s.id
    )
    select (select count(*) from changed)::int as changed,
           (select count(*) from signed_out)::int as sessions_ended,
           exists (select 1 from auth.users u where lower(u.email) = lower(${q(email)})) as found`);
  const [r] = rows ?? [];
  if (r?.changed) console.log(`${email} is now ${role} (${r.sessions_ended} session(s) signed out)`);
  else if (r?.found) { console.error(`${email} has not confirmed its email address: nothing changed`); process.exit(1); }
  else { console.error(`no account found for ${email}`); process.exit(1); }
}

/* Delete an account and everything it stored. Deleting the auth user cascades to
   every row it owns (profile, sessions, channels, falls, alerts, share codes, grants),
   but NOT to its files in Storage, so those go first, through the Storage API (a
   delete in SQL would leave the files themselves behind). The Storage and Auth admin
   calls need the project's service-role key: it is fetched with SB_PAT for this run
   only, kept in memory, and never printed. Without --yes this is a dry run. */
const serviceKey = async () => {
  const r = await fetch(`${base}/api-keys?reveal=true`, { headers: H });
  if (!r.ok) { console.error(`could not read the project's API keys: HTTP ${r.status}`); process.exit(1); }
  const keys = await r.json();
  const legacy = keys.find((k) => k.name === 'service_role' && k.api_key);
  const secret = keys.find((k) => k.type === 'secret' && k.api_key);
  const k = legacy ?? secret;
  if (!k) { console.error('no service-role or secret key found for the project'); process.exit(1); }
  /* A legacy service_role key is a JWT and also goes in Authorization; a new
     sb_secret_ key is sent as apikey only. */
  return legacy ? { apikey: k.api_key, Authorization: `Bearer ${k.api_key}` } : { apikey: k.api_key };
};

if (cmd === 'delete-account') {
  const [email, flag] = process.argv.slice(3);
  if (!EMAIL.test(email ?? '') || (flag !== undefined && flag !== '--yes')) {
    console.error('usage: delete-account <email> [--yes]');
    process.exit(1);
  }
  const users = await runSql(`
    select u.id, u.email, p.account_role, p.account_status
      from auth.users u left join public.profiles p on p.id = u.id
     where lower(u.email) = lower(${q(email)})`);
  if (!users?.length) { console.error(`no account found for ${email}`); process.exit(1); }
  if (users.length > 1) { console.error(`${users.length} accounts match ${email}; delete them in the dashboard`); process.exit(1); }
  const [{ id, account_role: role, account_status: status }] = users;
  if (!/^[0-9a-f-]{36}$/.test(id)) { console.error(`unexpected user id for ${email}`); process.exit(1); }
  const listObjects = async () => (await runSql(`
    select name from storage.objects
     where bucket_id = 'recordings' and name like ${q(`${id}/%`)}
     order by name`)).map((o) => o.name);
  const names = await listObjects();
  console.log(`${email} (${id}, ${role ?? 'no profile'}, ${status ?? '-'}): ${names.length} recording file(s) in Storage`);
  if (flag !== '--yes') {
    console.log('Dry run: nothing deleted. Re-run with --yes to delete the files and the account (this cannot be undone).');
    process.exit(0);
  }

  const auth = await serviceKey();
  for (let i = 0; i < names.length; i += 100) {
    const r = await fetch(`${projectUrl}/storage/v1/object/recordings`, {
      method: 'DELETE',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: names.slice(i, i + 100) }),
    });
    if (!r.ok) { console.error(`Storage delete failed: HTTP ${r.status}. The account was NOT deleted; run again.`); process.exit(1); }
  }
  const left = await listObjects();
  if (left.length) { console.error(`${left.length} file(s) still in Storage. The account was NOT deleted; run again.`); process.exit(1); }

  const r = await fetch(`${projectUrl}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: auth });
  if (!r.ok) { console.error(`account delete failed: HTTP ${r.status} (its recordings are already gone)`); process.exit(1); }
  console.log(`deleted ${email}: ${names.length} recording file(s), the account and every row it owned`);
}

if (cmd === 'allow-redirects') {
  /* The app's deep-link scheme must be on the allow list or confirm/reset links
     will redirect to the site URL instead of opening the app. The dashboard's
     reset page is listed too (local dev origin; add the hosted origin when it has one). */
  const allow = ['wearwise://auth/confirmed', 'wearwise://auth/reset', 'http://localhost:5192/reset-password'];
  const r = await fetch(`${base}/config/auth`, { method: 'PATCH', headers: H, body: JSON.stringify({ uri_allow_list: allow.join(',') }) });
  const j = await r.json();
  console.log(`HTTP ${r.status} → uri_allow_list = ${j.uri_allow_list}`);
}
