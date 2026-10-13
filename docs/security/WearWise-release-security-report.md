# WearWise release security report

> **Superseded in part by [audit-2026-10-13.md](audit-2026-10-13.md).** Since this report, Wi-Fi
> streaming is enabled (pinned `wss://` after passkey Bluetooth pairing), the vibrate and
> notification permissions are back for alerts and the fall alarm, and FLAG_SECURE / the
> link filter now have iOS equivalents.

Audit date: 20 September 2026. Target: Expo/React Native Android participant app.

**Disposition: signed research-demo release candidate. Not a complete security sign-off for real participant deployment.** The APK builds and launches; authenticated backend isolation and physical sensor testing remain outstanding. BLE link authentication requires firmware work. The accompanying backend SQL is a proposal, not a deployed fix.

Reviewed against relevant OWASP MASVS principles. This is not certification, a penetration-test guarantee, or a medical-device approval.

## A. Security findings

| Severity | Finding | Result |
|---|---|---|
| Critical | Privileged credentials embedded in the mobile app | None confirmed in reviewed source/history or decoded final bundle. Pattern searches are not a proof that every possible secret is absent. |
| High | Release inherited the Android debug signing key | Fixed: dedicated local RSA-3072 release key; neutral certificate identity; build refuses missing signing configuration. |
| High | Signed-out navigation and direct session links could expose another account's locally stored session | Protected routes and explicit session ownership checks added. Signed-out deep-link rejection verified on release emulator. |
| High | Logout/account switches could leave monitoring and sync state active | Monitoring detached/stopped; state cleared; sync checks account identity and retains original upload owner. Existing encrypted recordings deliberately retained. |
| High | Unencrypted ESP32 WebSocket streaming and unauthenticated BLE Wi-Fi provisioning | Wi-Fi setup is development-only and blocked in release UI and transport methods. Release rejects cleartext traffic. BLE recording remains available. |
| High | BLE firmware does not require encrypted/authenticated pairing; advertised identifiers can be copied | **Remaining firmware limitation.** Service/protocol checks are compatibility checks, not cryptographic identity. Use controlled demo data; do not claim confidential wireless transport for research participants. |
| High | Committed profile policy does not actually freeze consent/status columns; channel UPDATE lacks the parent-ownership condition present on INSERT | **Live configuration unverified.** Reviewed SQL proposal supplied in `backend-hardening-review.sql`; not applied. Confirm actual deployed grants/policies and test with two accounts before participant use. |
| Medium | Android backup and device transfer could carry private application data | Disabled backups; release extraction rules exclude data from cloud backup and device transfer. |
| Medium | Device registry was shared across local accounts | Schema v5 scopes listing/deletion to user ID. Legacy registry entries are hidden until re-pairing; recordings preserved. |
| Medium | BLE discovery accepted short identity data and malformed capability structures; reconnect did not verify identity | Strict protocol-v1 identity, characteristics, capability framing, sensor codes, rates, and reconnect identity checks added. Packet device/session/sensor checks added. |
| Medium | Confirmation/password reset callback screens absent | Added PKCE code exchange and reset-password screen; invalid-link handling verified. Real email delivery and successful reset remain manual tests. |
| Medium | URL decoder dependency advisory | Still present transitively. Android rejects external links containing percent-encoding or longer than 2,048 characters before Expo Router receives them. Malformed-link test passed. Update upstream dependency when compatible. |
| Medium | YAML parsing advisory in development/build tools | Targeted updates to js-yaml 3.15.2 and 4.3.2. No framework upgrade. |
| Low | Native assertion strings contained developer machine identity | Fixed with compiler path remapping; final native-library and decoded bundle scans found no developer username or user-directory path. |
| Low | Unnecessary Android permissions | Removed storage, overlay, coarse location, vibration, biometric/fingerprint, camera, microphone, and notification permissions from release. |
| Low | Fall UI implied an emergency alert would be sent | Changed to possible-fall wording and explicit statement that emergency services/contacts are not contacted. |
| Low | Database/server error details surfaced in sync messages | Replaced cloud operation errors with generic user-safe messages. |

## B. Personal information

- Developer Windows username and user-directory paths appeared in native binaries before cleanup. Compiler remapping removes those paths from the final rebuilt native libraries.
- Twelve tooling/generated files contained developer-specific temporary paths. Browser tooling now uses `WEARWISE_PUPPETEER_PATH` or an installed `puppeteer`; video tooling accepts `WEARWISE_FFMPEG_PATH`; generated bundle comments use neutral paths.
- Git author metadata and capstone/design collateral contain attribution and example profiles. Git history was inspected, not rewritten. These files are outside the mobile dependency graph and APK. Do not distribute the entire working directory as a sanitized release package.
- Runtime participant email/display name, device identity and research recordings are functional user data, not embedded developer profiles. They remain for authentication, identifying sensors and displaying recordings.
- The existing Supabase project identifier and public API URL are required routing configuration, not a personal login credential. The user confirmed project `<project-ref>` during the audit. The Android package remains project-based: `io.wearwise.participant`.
- The signing certificate uses **WearWise Project Team / La Trobe University Capstone Project**, with no individual name, email, address or student ID.

## C. Credential classification

No actual credential values are included in this report.

| Type/location | Classification | Action / rotation / functionality |
|---|---|---|
| Supabase publishable client key in ignored mobile environment files | A: public client configuration; B: backend restrictions required | Retained. HTTPS/project URL and public-key type validated. Authorization must rely on authenticated RLS/storage policies. No rotation required solely because a publishable key is in an APK. |
| Supabase project URL | A: public routing configuration | Retained; confirmed project matches release configuration. Supabase public keys do not gain protection from Android package/SHA restrictions; enforce backend policy instead. |
| Android debug keystore and standard debug password | E: development-only | Local debug material retained. Final release is signed with a separate key. No private debug material packaged. |
| Newly generated release keystore and local passwords | B: restricted signing material | Stored only in ignored `apps/mobile/wearwise-release.jks` and `apps/mobile/key.properties`. Not committed or bundled. Back up both securely; protect workstation access. |
| Supabase management/service-role/database credentials | C if needed: backend/admin only | No confirmed values found in reviewed app/source/history. Admin scripts reference environment variables only. No admin credential added to mobile configuration. |
| ElevenLabs voice-generation key referenced by video tooling | E/C: offline tooling/server secret | Environment-variable reference, not a confirmed embedded value; video tooling is outside APK. |
| Runtime access/refresh tokens, SQLCipher key | B: private per-install/user data | OS-backed secure storage. Session accessibility changed to device-only on iOS. Passwords remain transient form state; not persisted by app code. |
| Runtime Wi-Fi password/PoP | D in production provisioning path; E for existing development flow | Release provisioning disabled. Existing firmware must be redesigned for authenticated encryption before re-enabling. |

Pattern scan covered 903 initially tracked files and 45 reachable commits, plus targeted ignored environment/native/build files. Generic credential matches in history were design-token names and synthetic validation-test inputs; no committed privileged secret was confirmed. Consequently there is no confirmed secret for which rotation is currently mandated. If a separate review discovers an actual previously committed private credential: **THIS SECRET MUST BE ROTATED.** Deleting its current source is insufficient.

`.env.example` is now trackable and contains no real values. Environment, signing files, private certificates/keys, local properties, credential/service-account files and IDE state are ignored. No Git commit was made.

## D. Final Android permissions and components

| Permission | Purpose / scope |
|---|---|
| INTERNET | HTTPS authentication and cloud synchronization. |
| BLUETOOTH | Legacy Bluetooth connections, maximum Android API 30. |
| BLUETOOTH_ADMIN | Legacy discovery, maximum API 30. |
| ACCESS_FINE_LOCATION | BLE scan requirement on Android API 24–30 only; maximum API 30. App does not collect GPS coordinates. |
| BLUETOOTH_SCAN | Android 12+ BLE discovery; `neverForLocation`. |
| BLUETOOTH_CONNECT | Android 12+ GATT connections and interaction. |
| io.wearwise.participant.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION | AndroidX-generated signature permission restricting dynamic receivers; not a user-granted data permission. |

MainActivity is exported for launching and the `wearwise` callback scheme. FileProvider and startup provider are not exported. AndroidX ProfileInstallReceiver is exported but protected by the platform `android.permission.DUMP` permission. No publicly exposed custom service found in merged manifest. Release is non-debuggable; cleartext, backups and transfer of app data are disabled. Release windows use FLAG_SECURE, so screenshots/recents previews do not expose health screens.

## E. Storage, network and privacy inventory

| Data | Location/use |
|---|---|
| Email, display name, account UUID, consent timestamp | Supabase Auth/profile; active session in secure storage; UI while signed in. Passwords are sent to Auth over HTTPS and not saved by app code. |
| Protocol device UUID, BLE reconnect address/name, pairing timestamps | Encrypted local device registry, now scoped to account. No GPS collection found. |
| ECG, PPG, heart rate, SpO2, temperature, acceleration | Local SQLCipher recording/chunk/channel tables; optional cloud mirror via existing sync flow. |
| Possible-fall events and timing | Local encrypted session data. UI is a prototype alarm, not an emergency contact service. |
| Session summaries, configuration, sync/recovery state | Encrypted local database; cloud sessions/channels and private recording-object storage where sync is enabled. |
| Appearance and sync preferences | Unencrypted MMKV; intended for nonsensitive preferences only. |
| Analytics/crash tracking | No app-configured analytics or remote crash-reporting SDK found in reviewed runtime code. No health-to-analytics pipeline found. Build tooling telemetry is outside this runtime claim. |

The SQLCipher key uses 32 cryptographically random bytes and device-only secure storage. The database has no plaintext persistence fallback: if encrypted storage cannot open, app uses memory-only storage with a visible data-loss warning. The migration SQL was exercised against SQLite to verify all five migrations and the ownership column; native encryption was not independently extracted/proven from a populated release database because no live account was used.

Logout retains encrypted recordings so the same user can return to offline history; other accounts must not receive those rows. There is no implemented end-to-end account-deletion workflow. Define research retention, deletion, consent withdrawal and cloud-object cleanup with the team before real participant deployment. Cloud samples are access-controlled backend data, not claimed to be end-to-end encrypted with the local SQLCipher key.

Production configuration uses the confirmed hosted HTTPS Supabase endpoint. `.env.production` is a separate ignored file initialized from the existing public client configuration; this is not evidence of a separate staging database. Release preflight rejects unrecognized environment entries, private key types, non-HTTPS/local endpoints, and missing release signing. Keep all `EXPO_PUBLIC_*` values nonprivileged; anything bundled is extractable.

Anonymous live reads returned HTTP 200 with zero rows for profiles, recorded_sessions and recorded_channels. This verifies those requests exposed no rows at test time; it does not prove authenticated tenant isolation or bucket privacy. Full deployed grants, RLS policies, bucket settings, Auth rate limits/password rules/email confirmation and administrative configuration were not accessible through an authenticated management connection.

## F. BLE validation and limitations

Scanning filters the WearWise service UUID, not a name prefix. Connection requires INFO/CAPS/CONTROL/DATA characteristics with expected access properties, protocol version 1, a nonzero device identifier, terminated firmware information and bounded capability data. Capabilities reject malformed framing, duplicate/unknown sensors, invalid flags and rates outside 1–1,000 Hz. Notifications enforce packet length, framing, version, sensor/encoding, CRC, session ID and connected device ID. Existing sequence/gap/recovery behavior remains.

Reconnect checks device identity and stops retrying after explicit disconnect. Multiple devices can be remembered and selected; the current app records through one active transport at a time. Simultaneous recording from multiple ESP32 boards is not claimed.

CRC and UUID checks do not authenticate a sensor. Firmware does not currently require encrypted GATT characteristics. Physical ESP32 discovery, MAX30102, temperature, ECG, motion/fall handling, reconnect and real radio behavior were not exercised during this release audit. Existing user's firmware edits were preserved.

Simulation is retained intentionally and explicitly labelled **SIMULATED DATA**. Fall wording says **Possible fall detected** and explicitly disclaims emergency dispatch. WearWise remains an educational research prototype, not diagnostic software.

## G. Changed files

See `release-files-changed.txt` beside this report for the complete audit change inventory. Existing changes to `live.tsx` were preserved while adding safety copy. Existing firmware edits, untracked firmware projects, editor workspace state and the prior temporary slide-file deletion were not part of this audit and were not reverted.

Native `android/` is generated/ignored. Durable native changes live in the Expo plugin, `release-signing.gradle`, and `release/` manifest/resources/CMake settings. Regeneration must keep those inputs.

## H. APK and verification

Output: `<workspace>\_review\releases\WearWise-0.1.0-release.apk`

SHA-256: `A2A7A9BB516E968EF34EF134EA314E9B93D9871E79807BB19D6709767DCB65F4`

Size: 112,065,365 bytes. Signing-file Windows permissions restrict access to the current account and SYSTEM. App icon visually inspected: neutral WearWise mark.

Final artifact details and hashes are in `release-artifact.json` beside this report. Filename: **WearWise-0.1.0-release.apk**. Package: **io.wearwise.participant**. Version: **0.1.0 (code 1)**. Minimum API: **24**. Target API: **36**. ABIs: **arm64-v8a and x86_64**; no 32-bit ABI in this candidate.

Signed release build, APK signature scheme v2 verified. Dedicated RSA-3072 key; no debug signing. R8/resource shrinking was considered and left off to avoid untested BLE/native/reflection breakage. This is not a claim of resistance to reverse engineering.

Verification performed:

- TypeScript type checking and Expo lint passed.
- 108 tests in 16 suites passed, including codec corruption handling, recording/recovery/fall/sync tests and new discovery/config/device-ownership tests.
- Five SQLite migrations executed successfully in a temporary in-memory SQLite database.
- Android release assembly, native compilation and Android vital lint passed.
- Signed APK installed and launched in a fresh isolated API-36 emulator; no observed AndroidRuntime/ReactNativeJS crash errors in the sampled release logs.
- Signed-out saved-session link remained at sign-in; invalid confirmation code produced safe error UI; malformed percent-encoded external link was rejected without killing the app.
- Screenshots from the secure release window were black, as expected from FLAG_SECURE.
- Final APK ZIP scan inspected 1,269 entries. No environment file, signing file, private certificate/key, service-account file or source-map file was identified. Native-library developer paths were removed and rescanned.
- Hermes bytecode was decoded for string-boundary inspection. No actual privileged-key pattern, private-key marker, developer username or user-directory path was found in decoded strings. Raw byte scanning produced false positives from a literal Supabase key-prefix validator, concatenated string-table storage and lowercase `/users/` API routes.
- Inactive dependency defaults referencing localhost remain in bytecode. Production uses the validated HTTPS endpoint, release has no Metro dependency and cleartext is blocked. Do not interpret the report as claiming every library debug/default string has been removed.

Remaining dependency advisories: 14 moderate package findings propagated from transitive decode-uri-component and build-time xcode/uuid advisories; zero high or critical findings in the final npm production-dependency audit. The uuid advisory concerns v3/v5/v6 buffer handling; reviewed xcode code uses v4, and xcode is not Android app runtime code. `npm audit` is not claimed clean. Broad/downgrade fixes suggested by npm were not applied.

## I. Required follow-up before real participant use

1. Verify live authenticated RLS with two accounts, confirm the recordings bucket is private, and review/apply the proposed backend hardening using an authenticated database connection. Confirm suspended accounts, role/status/consent updates, cross-account re-parenting and storage-path ownership fail appropriately.
2. Complete real-device testing: sign-in, successful email confirmation/reset, logout/relaunch, offline storage, cloud sync, recording deletion, reconnect, and every physical sensor. No test account/password is embedded in the APK.
3. Implement authenticated encrypted BLE pairing/device identity and secure Wi-Fi firmware before collecting confidential participant readings over radio or enabling Wi-Fi again. Do not send real Wi-Fi credentials through the development provisioning flow on an untrusted radio link.
4. Define account deletion, consent withdrawal and retention. Current encrypted local retention after logout is intentional, not a deletion feature.
5. Back up the ignored release keystore and key.properties securely, outside Git. Keep the signing key for future updates. A device with the old debug-signed app cannot receive this release as an in-place update; migrating/uninstalling old data must be intentional.
6. Update the upstream URL decoder when a compatible dependency path is available; current native mitigation rejects all percent-encoded external links. Test any future encoded deep-link requirements before relaxing it.
7. Restrict backend administration, rate limits and signup/email settings in Supabase. Public keys are not a substitute for those controls. Recheck any dashboard changes before submission.

## References

- [OWASP MASVS](https://mas.owasp.org/MASVS/)
- [Supabase product security](https://supabase.com/docs/guides/security/product-security)
- [Supabase sign-out scopes and token expiry](https://supabase.com/docs/guides/auth/signout)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [URL-decoder advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
- [YAML advisory](https://github.com/advisories/GHSA-2883-xcg3-v3hh)
- [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
