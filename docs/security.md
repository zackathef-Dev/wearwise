# WearWise security notes

WearWise is a **capstone research prototype** that handles health-related data (heart rate,
SpO₂, ECG, temperature, movement, possible falls). Its security practices are informed by
relevant guidance, such as the OWASP Mobile Application Security Verification Standard
(MASVS), the OWASP Top 10, and Supabase's security recommendations. **No part of the system
has been certified, penetration-tested by a third party or formally audited**, and it is
not a medical device. Treat it as a prototype until the owner's own review says otherwise.

History of reviews and fixes: `docs/security/audit-2026-10-13.md`,
`docs/security/WearWise-release-security-report.md`, `docs/database/cloud-schema.md`
(security review section).

## What is protected, and how

| Layer | Control | Where |
|---|---|---|
| Patch ↔ phone (Bluetooth) | LE Secure Connections only, 6-digit passkey printed on the patch, bonding. Pairing only with no bonds or within 60 s of pressing BOOT, lock-out after 3 failures, at most two remembered devices. Every characteristic needs an encrypted, authenticated link | `firmware/wearwise-esp32/main/communication/` |
| Patch ↔ phone (Wi-Fi) | TLS with the patch's self-signed certificate **pinned** by SHA-256 read over the authenticated BLE link, plus a proof-of-possession token. Wi-Fi credentials are kept in the patch's RAM only | [ble-protocol.md](ble-protocol.md) |
| Data on the phone | SQLCipher-encrypted database, key in the OS secure store. Auth session in the secure store. Android backup off. Release builds block screenshots; iOS shows a privacy cover in the app switcher | `apps/mobile/src/data/local`, `platform/secure-storage` |
| Phone/dashboard ↔ backend | HTTPS only in release builds (http allowed only for local hosts in development builds). PKCE for email links | `public-config.ts`, `check-release-config.cjs`, release manifest |
| Accounts | Server-enforced consent, 18+ and terms at sign-up. Server-enforced 10-character minimum password (the apps also refuse common passwords). Roles server-controlled (nobody promotes themselves) | migrations 1, 7–9; `packages/password` |
| Data access | Row Level Security on every table, least-privilege grants (`anon` has none), column-level write privileges, RESTRICTIVE "active account" policies, private Storage bucket with object-name rules | [database.md](database.md#row-level-security) |
| Sharing | One-time hashed share codes (24 h, ~49.5 bits, 10 failed tries per hour per viewer), revocable scoped grants, participant email never shown to viewers | migrations 5, 9 |
| Live view | Private Realtime channels per grant, policy-checked; nothing stored | migrations 6, 10 |
| Web dashboard | Strict Content-Security-Policy (one backend host), no framing, HSTS, `Permissions-Policy` | `apps/dashboard/scripts/deploy-headers.mjs` |
| Supply chain | `ignore-scripts=true` (dependencies can't run install scripts); pinned esptool-js | `.npmrc` |

RLS is verified by 277 plain-SQL checks plus pgTAP on a real local Supabase stack
(`bash supabase/sql-tests/run-on-local-stack.sh`), and through the public API by
`supabase/tests/sync-live.mjs` (two-user isolation for rows and Storage files).

## Secrets: what exists, who creates it, where it lives

Nothing in this table is in the repository, and none of it should ever be.

| Secret | Created by | Lives in | Never |
|---|---|---|---|
| Supabase database password | the owner, when creating the project | the owner's password manager | in a file in the repo, in an app |
| Supabase `service_role` / `sb_secret_` key | Supabase | Supabase dashboard; used only by admin tooling at run time (`admin.mjs` fetches it in memory) | in any app, `.env`, or log |
| Supabase personal access token (`sbp_…`) | each administrator, for the CLI | the CLI's keychain store (`supabase login`) or an env var for one session | committed, shared |
| SMTP credentials | the owner | Supabase dashboard (Auth → SMTP) | in the repo |
| Android release keystore + passwords (`wearwise-release.jks`, `key.properties`) | the owner: `node apps/mobile/scripts/create-release-signing.cjs` | `apps/mobile/` (gitignored) **plus a secure backup** | committed. Losing it means the app can't be updated |
| Apple signing certificate / provisioning profiles | the owner's Apple Developer team, via Xcode | the macOS keychain / Apple account | committed |
| Patch label PINs | the dashboard's Patch setup page, per patch | the patch's flash + the printed label | in the repo, in Supabase |
| Patch TLS key, Wi-Fi PoP | the patch itself, at first boot / every boot | the patch | — |

Not secret, but tied to a deployment: the project URL and the **publishable / anon key**.
They are designed to ship inside the apps, so treat them as public; RLS is what protects
data. They still live in gitignored `.env` files, so each deployment keeps its own.

The local stack's keys (`supabase status`) and the demo password `wearwise-demo-only` are
development-only values that work only against a local stack on your own machine.

## Handover scan (2026-10-13)

Before the handover, the tracked files and the full git history were scanned for
credentials and personal data.

| Finding | Location | Status | Rotation required |
|---|---|---|---|
| Supabase keys, tokens, JWTs, private keys, keystores, passwords | tracked files and all history | **none found** | No |
| `.env`, `.env.production` with the original project's URL and anon key | developer machine only (gitignored, never committed) | not transferred | No (publishable by design). The original project should be retired or handed over deliberately |
| Original project reference in scripts, CSP and `.mcp.json` | tracked files | **removed**: scripts take `SB_PROJECT_REF`, headers are generated, `.mcp.json` untracked | No |
| Personal email address in a test screenshot | `docs/testing/evidence/m3/3.1-…/09-after-create.png` | **redacted** in the current tree; still present in **git history** | No (not a credential) |
| Developer's email (commit author), personal paths and the address above | git history | see "Git history" below | No |
| Home network name, LAN addresses, phone serial, developer names in docs | tracked docs | **redacted** | No |
| Board Bluetooth MAC addresses | test evidence, a test fixture | kept: they identify the prototype patches handed over with the project | No |
| Team names on presentation material (slides, trade-show, video) | presentation folders | **not included**: presentation material stays with the team | No |

**Git history.** The full history contains the developer's commit email, an older copy of
that screenshot, and absolute paths that were later removed. If the repository is shared
beyond the project owner, publish it as a fresh history (the current tree as one initial
commit) or rewrite history first. Either way, check again with
`git log --all -p | grep -iE '<what you are looking for>'`.

## Local development security

- `supabase start` publishes the API, database, Studio and Mailpit ports on **all network
  interfaces** (so phones on the Wi-Fi can reach the API). On an untrusted network, anyone
  on it could reach the local database with the default password. Use it only on a trusted
  network, or firewall ports 54322–54324.
- Development builds accept `http://` to local and LAN hosts, and the Android debug manifest
  allows cleartext. **Release builds do neither** (checked at run time and at build time).
- Never test with real participants' data on a local stack or a developer's machine.

## Owner responsibilities (before real participants)

1. **Ethics and governance:** an approved protocol; a data-storage region and retention
   period that match it; a privacy notice. Fill in the organisation details in
   `packages/legal/src/org.ts`; the legal documents show a "draft" notice until you do.
2. **Own deployment:** a Supabase project under the organisation's account, not a student's.
   Apply the settings in [deployment.md](deployment.md#3-project-settings-dashboard): email
   confirmation, SMTP, Realtime private-only, and redirect URLs.
3. **Accounts:** create researcher accounts with the admin SQL. Give people their own
   accounts, and suspend (`admin/set-status.sql`) or remove accounts that leave.
4. **Keys:** create your own Android keystore and Apple signing. Store them, the database
   password and access tokens in the organisation's secret store. Rotate the service key and
   the database password if they are ever exposed (Supabase dashboard → Project Settings).
5. **Backups:** enable the plan's backups / point-in-time recovery for the hosted database.
   Recordings also remain on participants' phones.
6. **Updates:** keep dependencies, Expo SDK, ESP-IDF and the Supabase CLI current, and run
   the test suites after each upgrade.
7. **Independent review** before any use beyond a supervised research prototype.

## Known limitations (security-relevant)

- No multi-factor authentication for dashboard accounts (Supabase supports TOTP; not enabled
  or wired into the dashboard).
- The label PIN is fixed per patch: anyone who reads the label and presses BOOT within reach
  can pair (the patch remembers two devices). Use **New PIN** when a patch changes hands.
- A viewer sees all columns of a session it may read (device name, firmware). A column-limited
  view is a possible improvement.
- The phone's fall emergency notifies nobody outside WearWise (no SMS or emergency call).
- No audit log of researcher reads beyond what Supabase's logs keep.
- The iOS pinned-WebSocket module and release build have had less device testing than
  Android (see `docs/testing/real-device-2026-10-13.md`).
