# Dependency advisories: assessment, 14 October 2026

GitHub Dependabot opened 13 alerts on the handover repository (all from `package-lock.json`);
`npm audit` reports the same advisories, counted once per affected package path (69 entries
before the fixes below, 65 after). This page records what was fixed, and why each remaining
alert is not reachable in the shipped app or is mitigated.

**Fixed (lockfile updates within the ranges the dependents already allow, no `--force`):**

| Alert | Package | Severity | Change | Used by |
|---|---|---|---|---|
| #13 | `shell-quote` | critical | 1.10.0 → 1.12.0 | React Native's developer tools (`react-devtools-core`) |
| #11 | `compression` | high | 1.8.1 → 1.8.2 | Expo CLI's development server |
| #3, #5, #7 | `brace-expansion` 5.x | high, high, moderate | 5.0.9 → 5.0.12 | `minimatch` 10 (build tooling) |
| #4, #6, #8 | `brace-expansion` 1.x | high, high, moderate | 1.1.18 → 1.1.21 | `minimatch` 3 (ESLint, Jest) |

Checked after the update: app type check and 283 unit tests, dashboard type check and
110 + 49 unit tests, a production build of the dashboard, and Metro bundling the app on the
Android emulator. The alerts close when GitHub sees the updated lockfile.

**Remaining (5 alerts):** none has a fix that can be applied without a breaking upgrade.

| Alert | Package | Severity | Path | Assessment |
|---|---|---|---|---|
| #10 | `braces` ≤ 3.0.3 | high | `micromatch` ← Metro file map, Jest | **No patched version exists.** Denial of service from deeply nested glob patterns. Patterns come from the project's own configuration, never from users, and the package isn't in the app bundle or the dashboard build. |
| #9 | `node-forge` ≤ 1.4.0 | high | Expo CLI | **No patched version exists.** RSA PKCS#1 v1.5 signature verification. Used by Expo's command-line tooling (development certificates and update signing). WearWise doesn't use Expo Updates code signing, and the package isn't in the app bundle. |
| #12 | `sprintf-js` ≤ 1.1.3 | moderate (dev) | `argparse` 1 ← `js-yaml` 3 ← Jest coverage | **No patched version exists.** Development dependency only (test coverage tooling). |
| #1 | `uuid` < 11.1.1 | moderate | `xcode` 3.0.1 ← Expo config plugins (iOS prebuild) | **Not affected:** the bug is in `v3`/`v5`/`v6` with a `buf` argument; `xcode` only calls `uuid.v4()`. Build-time only. `xcode` pins `uuid` ^7; an npm override to 11 was tried and left the dependency unresolved, so it was not applied. Clears with an Expo SDK upgrade. |
| #2 | `decode-uri-component` ≤ 0.4.2 | moderate | `query-string` 7 ← `expo-router` (**in the app at run time**) | **Mitigated.** Denial of service from malformed percent-encoded input. Every incoming `wearwise://` link passes `src/app/+native-intent.tsx` first, which refuses links over 2,048 characters and any link whose percent-encoding doesn't decode cleanly; on Android the native check (`plugins/with-release-security.js`) refuses any link containing `%` at all. The patched 0.5.0 is an ES module that `query-string` 7 can't load, so the fix is `expo-router` 58 (Expo SDK 58). |

**Next step:** upgrade to the next Expo SDK (`npx expo install expo@latest` then
`npx expo install --fix`), rebuild the native apps, rerun every test and the device checks
(`docs/testing/hardware-test-matrix.md`). Never run `npm audit fix --force`: it installs
much older Expo versions and breaks the app.

The remaining alerts can be dismissed in GitHub (Security → Dependabot) with the reasons
above ("vulnerable code is not actually used" for #1, #9, #10, #12; "risk is tolerable" for
#2), or left open as reminders for the SDK upgrade.
