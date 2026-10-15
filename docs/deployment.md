# Deploying WearWise

The apps choose their backend through configuration only. The same migrations build every
environment:

| Environment | Backend | Apps point at |
|---|---|---|
| **A. Local development / handover** | Supabase in Docker on your computer (`supabase start`) | `http://<your LAN IP>:54321`, development builds only |
| **B. Hosted** | your own Supabase Cloud project | `https://<project-ref>.supabase.co` |
| **C. Self-hosted / institutional** | a Supabase deployment your organisation runs | `https://<your Supabase host>` |

A is in the root [README](../README.md) and [database.md](database.md). This page covers B, C,
and building the apps for release.

> **Never put a `service_role` key, `sb_secret_` key, database password or access token into
> an app or into the repository.** The apps need only the project URL and its
> publishable / anon key. Everything else is enforced by RLS on the server.

---

## B. Your own Supabase Cloud project

### 1. Create the project

1. Sign in at <https://supabase.com/dashboard> with the **organisation's** account (not a
   personal one), then **New project**. Keep the database password in your password manager.
2. Region: close to your participants and permitted by your ethics approval and data
   governance (health data).
3. Note the **project ref** (Project Settings → General) and, from Project Settings → API
   Keys, the **publishable** (or legacy anon) key.

### 2. Apply the schema

```bash
supabase login                              # opens the browser; stores an access token locally
supabase link --project-ref <project-ref>   # asks for the database password
supabase db push --dry-run                  # lists the 11 migrations it will apply
supabase db push                            # applies them
```

Do **not** use `--include-seed`: the seed's demo accounts and password are for local use
only. Don't run `supabase config push` either. `config.toml` holds the *local* settings
(email confirmation off, localhost URLs) and would overwrite the hosted ones.

### 3. Project settings (dashboard)

| Where | Setting |
|---|---|
| Authentication → Providers → Email | Email provider on, **Confirm email on**, minimum password length **10** |
| Authentication → URL Configuration | Site URL: the dashboard's https origin. Redirect URLs: `wearwise://auth/confirmed`, `wearwise://auth/reset`, `https://<dashboard origin>/reset-password` |
| Authentication → SMTP Settings | A real email provider (the built-in mailer sends about 2 emails per hour project-wide, which blocks sign-ups) |
| Authentication → Rate Limits | Raise "emails sent" once SMTP is set |
| Realtime → Settings | **Allow public access: off** (every WearWise channel is private) |
| Storage | Nothing: the migrations create the private `recordings` bucket and its policies |

### 4. The first researcher account

Researchers and clinicians have no sign-up page. In the dashboard's SQL Editor, paste
`supabase/admin/create-viewer.sql`, change the marked email, role and name, and Run. It
returns a one-time password; the person changes it after signing in (top bar → Change
password). `supabase/admin/` also has snippets to change a role (`set-role.sql`), suspend
an account (`set-status.sql`), reset a password and list accounts. The same steps can be
scripted: `supabase/scripts/admin.mjs` (needs `SB_PROJECT_REF` and a personal access token
in `SB_PAT`; see its header).

### 5. Point the apps at it

- **Mobile app:** `apps/mobile/.env.production` (release builds) and, for development
  against the hosted project, `apps/mobile/.env`. Copy `apps/mobile/.env.example`:
  ```
  EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
  EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable or anon key>
  ```
  Run `npm run backend:cloud` once, to remove any local override.
- **Dashboard:** `apps/dashboard/.env` (or `.env.production`, or your host's environment
  variables) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then generate the
  security headers for that backend (next section).

### 6. Check it

```bash
SB_URL=https://<project-ref>.supabase.co SB_ANON=<key> SB_TEST_EMAIL=<a confirmed test account> \
  SB_TEST_PW=<its password> node supabase/tests/sync-live.mjs
```

Then sign in on the phone and the dashboard, record a simulated session and check it
appears in the dashboard (see the README's runbook).

### Moving data from another project

There's no data migration tool, by design: each deployment starts empty, and participants'
recordings stay on their phones (the source of truth). If a study really must move cloud
data, it needs its own ethics-approved procedure. Supabase's backup and restore tools
copy *everything*, including accounts and health data.

### Taking over the original capstone project instead

The original hosted project's schema was applied as SQL, outside the CLI, so it has **no
migration history table**. Running `supabase db push` against it would try to re-apply
every migration. Record the history first, then push only new migrations:

```bash
supabase link --project-ref <ref>
for v in $(ls supabase/migrations | cut -d_ -f1); do supabase migration repair --status applied "$v"; done
supabase migration list        # local and remote should now match
```

---

## C. Self-hosted / institutional Supabase

Supabase can be self-hosted with Docker Compose (<https://supabase.com/docs/guides/self-hosting>).
Your organisation's IT runs it; WearWise needs:

1. **HTTPS** with a valid certificate on the public API URL. Release builds of the app
   refuse `http://`, and the dashboard's security headers only allow `https://` and `wss://`.
2. The **migrations** applied to its database:
   ```bash
   supabase db push --db-url "postgresql://postgres:<url-encoded password>@<db host>:5432/postgres"
   ```
   The migrations only assume Supabase's standard `auth`, `storage` and `realtime` schemas
   and the `pgcrypto` extension in `extensions`, all present in self-hosted Supabase.
3. The same **settings** as for the cloud (in the self-hosted stack's `.env` / Auth
   environment variables): `GOTRUE_PASSWORD_MIN_LENGTH=10`, the redirect URLs in
   `ADDITIONAL_REDIRECT_URLS`, email confirmation on and a real SMTP server, and Realtime
   restricted to private channels.
4. Secrets that belong to the deployment only, set in its environment and never in this
   repository: the JWT secret / signing keys, the service key, the database password and
   SMTP credentials.
5. Then point the apps at `https://<your Supabase host>` exactly as in B.5.

---

## The web dashboard

A static single-page app: `npm run build -w dashboard` writes `apps/dashboard/dist/`. Host it
on any static host that serves `index.html` for unknown paths and lets you set response
headers.

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the build (host environment
   variables or `apps/dashboard/.env.production`).
2. Generate the security headers for that backend, and commit them:
   ```bash
   npm run deploy-config -w dashboard    # rewrites apps/dashboard/public/_headers and vercel.json
   ```
   The Content-Security-Policy allows only that one Supabase host. `vite build` refuses a
   production build whose headers don't allow its own backend, and tells you to run this.
   The repository ships with a placeholder host (`your-project-ref.supabase.co`).
3. Deploy:
   - **Netlify:** base directory `apps/dashboard`. `netlify.toml` and `public/_headers` /
     `_redirects` are picked up.
   - **Vercel:** root directory `apps/dashboard`. `vercel.json` carries the same headers and
     the SPA rewrite.
   - **Cloudflare Pages:** build command `npm run build -w dashboard`, output
     `apps/dashboard/dist` (`_headers` and `_redirects` apply).
4. Add `https://<dashboard origin>/reset-password` to the backend's redirect URLs, and use the
   dashboard origin as the Site URL.

Patch setup (firmware over USB) needs HTTPS or localhost and Chrome or Edge. The headers
already allow Web Serial (`Permissions-Policy: serial=(self)`).

---

## Mobile app release builds

Release builds read `apps/mobile/.env.production` and must use an **https** backend.

### Android (Windows, macOS or Linux)

Prerequisites: JDK 17, Android SDK (platform 36, build-tools 36), `ANDROID_HOME` set.

```bash
cd apps/mobile
cp .env.example .env.production            # fill in the https URL and publishable key
node scripts/create-release-signing.cjs    # ONCE: creates wearwise-release.jks + key.properties
npx expo prebuild --platform android       # generates android/ (gitignored)
cd android
NODE_ENV=production ./gradlew assembleRelease   # APK: app/build/outputs/apk/release/app-release.apk
NODE_ENV=production ./gradlew bundleRelease     # AAB for Google Play
```

(Windows PowerShell: `$env:NODE_ENV='production'; .\gradlew.bat assembleRelease`.)

The universal APK is large (about 190 MB) because it holds native libraries for every CPU
architecture and shrinking is off. Google Play's AAB (`bundleRelease`) delivers only what each
phone needs. For sideloading one phone, build its architecture only:
`NODE_ENV=production ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`.

- **Signing keys are yours to create and keep.** `create-release-signing.cjs` makes a new
  random keystore and password, stored only in the two gitignored files. Back them up
  securely (a password manager or the organisation's secret store). An app signed with a
  different key can't update an installed one. For Google Play, enrol in Play App Signing.
- The release build refuses to start without `NODE_ENV=production`, a valid
  `.env.production` (https, publishable key, nothing else) and the signing files.
- Release builds turn off cleartext traffic, backups and screenshots, and strip
  debug-only permissions (`plugins/with-release-security.js`, `release/`).
- Optional check of the built APK for leaked secrets or developer paths (PowerShell):
  `tools/audit-apk.ps1 -Apk <apk> -Report <report.json>`.

### iOS (macOS with Xcode)

Prerequisites: Xcode, CocoaPods, an Apple ID. A paid Apple Developer membership is needed
for TestFlight and the App Store; a free personal team can install on your own devices for
7 days.

```bash
cd apps/mobile
cp .env.example .env.production            # https URL + publishable key
NODE_ENV=production npx expo prebuild --platform ios    # generates ios/ and installs pods
open ios/WearWise.xcworkspace
```

In Xcode: select the **WearWise** target → Signing & Capabilities → choose your **Team**. If
the bundle identifier `io.wearwise.participant` is already taken by another team, change
`ios.bundleIdentifier` (and `android.package`, to keep them aligned) in `app.config.ts`, then
prebuild again. Then **Product → Archive** for TestFlight or the App Store, or choose the
Release configuration and run on a connected device:

```bash
NODE_ENV=production npx expo run:ios --configuration Release --device
```

There is no automatic check of `.env.production` on iOS like the Android Gradle one. Run
`node scripts/check-release-config.cjs` yourself before archiving.

### Version numbers

`version` (shown to users) and `android.versionCode` live in `app.config.ts`. Increase
`versionCode` (and the iOS build number in Xcode) for every store upload.
