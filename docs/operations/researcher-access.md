# Researcher & clinician access — admin runbook

For whoever runs WearWise after hand-over. No coding or command line needed for the
day-to-day tasks: everything below is done in the **Supabase Dashboard** of the
WearWise project, with a Supabase account that is a member of the project's
organisation.

## How access works (one paragraph)

Participants own their data. A researcher or clinician ("viewer") only sees a
participant's data after that participant creates a **share code** in the phone app
(Profile → Privacy & access → Share my data) and the viewer enters it in the **viewer
dashboard**. The participant chooses which signals are shared and can remove access
at any time. Viewer accounts can't be self-registered: an admin creates them (below).
Full technical detail: `docs/database/cloud-schema.md` → "Data sharing".

## Everyday tasks

All snippets live in `supabase/admin/`. For each: Supabase Dashboard → **SQL Editor** →
**New query** → paste the whole file → change the lines marked `<-- CHANGE` → **Run**.

| Task | Snippet | Notes |
|---|---|---|
| **Add a researcher or clinician** | `create-viewer.sql` | Set email, role (`researcher` or `clinician` only) and display name. The result shows a **one-time password** — send it privately (not in the same message as the email address). They sign in at the dashboard, accept the current terms themselves, and use **Change password** in the top bar. |
| Make an existing account a viewer (or back to participant) | `set-role.sql` | Only for an account whose **email is confirmed** (no rows returned otherwise). Signs the account out everywhere. Prefer a separate email for viewers: a viewer account can't create share codes. |
| Suspend / reactivate someone | `set-status.sql` | Suspended viewers see nothing; a suspended participant's data is hidden from every viewer, and their pending share code stops working. Suspending also signs the account out everywhere. Nothing is deleted. |
| Locked-out viewer | `reset-password.sql` | Gives a new one-time password and signs the account out everywhere. Use when the "Forgot password?" email can't reach them. |
| See all viewers and who shares with whom | `overview.sql` | Read-only. |
| Find recordings of deleted accounts | `orphaned-recordings.sql` | Read-only. Lists Storage folders in `recordings` whose user no longer exists, with their size. Delete them in Dashboard → Storage → recordings. |
| Delete an account and all its data | — | Use `admin.mjs delete-account` (below): it removes the account's recording files from Storage first. Deleting a user in Authentication → Users removes their rows but **leaves their files** in Storage (find them with `orphaned-recordings.sql`). |

"Signs out everywhere" deletes the account's sessions (and with them its refresh
tokens), so no device can renew its login. A login token already issued keeps
working until it expires (at most the project's JWT expiry, 1 hour by default) —
but a suspended account or a changed role takes effect on the very next request
anyway, because the database checks status and role itself.

Removing a participant from a viewer is normally done by the participant (app) or the
viewer (dashboard → participant → Remove participant). To end every grant a viewer
has at once, suspend the viewer. Once a grant has ended (or either account is
suspended) the viewer can't even see that it existed; the participant keeps the
record.

Each snippet was tested against a local copy of the database
(`supabase/sql-tests/standalone/run.sh`, test files `supabase/sql-tests/admin_snippets.local.sql`
and `supabase/sql-tests/security_review.local.sql`).

## Command-line alternative (developers)

`supabase/scripts/admin.mjs` does the same with a Supabase personal access token
(Supabase Dashboard → Account → Access Tokens). Read the token without echoing it or
putting it in your shell history — don't type `SB_PAT=sbp_... node ...`:

```bash
read -rs SB_PAT && export SB_PAT        # paste the token, press Enter (nothing is shown)
node supabase/scripts/admin.mjs create-viewer dr.chen@clinic.org clinician "Dr Chen"
node supabase/scripts/admin.mjs set-role someone@example.org researcher
node supabase/scripts/admin.mjs delete-account someone@example.org          # dry run: shows what would go
node supabase/scripts/admin.mjs delete-account someone@example.org --yes    # deletes, cannot be undone
node supabase/scripts/admin.mjs allow-redirects
unset SB_PAT
```

- `create-viewer` takes `researcher` or `clinician` only; `set-role` also takes
  `participant`, needs a confirmed email, and signs the account out everywhere.
- `delete-account` lists the account's files in the `recordings` bucket, deletes them
  through the Storage API, checks none are left, then deletes the user through the
  Auth admin API (which removes every row it owned: profile, recordings, falls,
  alerts, share codes, grants). The Storage and Auth calls need the project's
  service-role key; the script fetches it with your token for that run only
  (Management API `GET /v1/projects/{ref}/api-keys`) and never prints or stores it.

A token is personal: each admin creates their own and never commits or shares it.

## Before real researchers use it (shipping checklist)

1. **Host the dashboard.** `apps/dashboard` is a static site (`npm run build -w dashboard`
   → `apps/dashboard/dist`). Any static host works (Vercel, Netlify, Cloudflare Pages).
   Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host, and make every path
   fall back to `index.html` (single-page app), or `/reset-password` links will 404.
2. **Allow the hosted reset page.** Add `https://<dashboard-host>/reset-password` to
   Supabase → Authentication → URL Configuration → Redirect URLs (and to the list in
   `admin.mjs allow-redirects`). `http://localhost:5192/reset-password` is the dev one.
3. **Set up email (SMTP).** Supabase → Authentication → Emails → SMTP settings, with a
   provider such as Resend, Postmark or Amazon SES, then raise the email rate limit.
   Without it, sign-up confirmations and "Forgot password?" emails are capped at a
   couple per hour and may only reach project-team addresses.
4. **Tell participants** the dashboard's address is what they give their researcher,
   together with the share code.

## Handing over the project

- **Supabase:** invite the new owner to the Supabase organisation that holds the
  project (`<project-ref>`) as **Owner** (Organisation → Team), then have them
  confirm they can open the SQL Editor. Remove or downgrade old members afterwards.
- **Tokens:** personal access tokens don't transfer. Old admins should revoke theirs;
  the new owner creates their own if they use `admin.mjs`.
- **Code:** transfer the Git repository; `README.md` and `docs/` explain the apps,
  `apps/dashboard/README.md` the dashboard.
- **Accounts:** viewer accounts belong to the people using them; nothing to transfer.
  Run `overview.sql` to hand over an up-to-date list of who has access.
