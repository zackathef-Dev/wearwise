# Milestone 7 — polish

_26 Aug 2026. The signature ring hero, motion, a settings/consent surface, and an
accessibility pass — on top of a pipeline that already spans device → phone → cloud._

## Outcome

The participant app now has its finished feel:

- **Activity-ring hero** on Home — three concentric Skia rings (sessions / minutes
  monitored / backed-up, this week) that sweep in on mount, with a live centre
  count and a legend. Honest metrics computed from the local store + sync state;
  no fabricated physiology.
- **Settings & consent screen** — account, a Light / Dark / System theme control,
  backup status with "Back up now", the storage-consent date, a data-deletion
  request, and the not-a-medical-device about text.
- **Persisted theme** — the choice survives a restart (MMKV), restored synchronously
  so there's no flash of the wrong palette; light/dark verified on device.
- **Motion** — ring sweep, an entrance reveal on the hero, the existing fade screen
  transitions, the Skia ECG trace, and button press-scale. All respect the OS
  reduce-motion setting.
- **Accessibility** — every screen title is a `header`; the ring exposes a spoken
  summary ("This week: 9 sessions, 10 minutes monitored, 100% backed up"); icon-only
  controls (settings, back) carry labels; theme options are `radio`s; the existing
  `checkbox`/`button` roles on the sensor and history screens stand.

## Files

- `apps/mobile/src/shared/charts/ActivityRings.tsx` — Skia rings, one-shot RAF sweep, reduced-motion aware
- `apps/mobile/src/shared/components/Reveal.tsx` — entrance wrapper (reanimated, reduced-motion aware)
- `apps/mobile/src/app/settings.tsx` — settings/consent screen
- `apps/mobile/src/platform/kv/kv.ts` — MMKV wrapper (v4 `createMMKV`) with in-memory fallback
- `apps/mobile/src/shared/theme/ThemeProvider.tsx` — persistence added
- `apps/mobile/src/app/home.tsx` — ring hero, settings gear, reveal
- header roles across `history/pair/register/reset-password/sensor/settings/wifi`

## Decisions of record

| Decision | Why | Rejected |
|---|---|---|
| Rings show **weekly activity** (sessions/minutes/backed-up), not physiology | honest — ECG average is ~0 mV and daily rollups don't exist; activity is real and ties recording to sync | rings of SpO₂/temp/HR (misleading with simulated data) |
| Ring sweep is a one-shot **RAF → plain number**, not a Reanimated SharedValue bound into Skia | the SharedValue→Skia binding fires a "state update before mount" LogBox error on Skia 2 + Reanimated 4; a one-shot tween is imperceptibly different and dependency-free | reanimated-driven Skia prop (warns) |
| Theme in **MMKV**, not SecureStore | a theme is not a secret; keeps it off the Keychain round-trip and readable synchronously on first render | expo-secure-store (async, would flash) |
| Settings never writes role/status | those are server-controlled and RLS-pinned regardless of the client | a client-writable role field |

## Tests

90/90 unit tests still pass; tsc clean. UI/motion is verified by looking at it on
the device (a snapshot of a Skia canvas proves nothing — the test-strategy says so).

## Platform status

- **Physical Android** (SM-G977N): ✅ ring hero renders + animates, theme toggles
  and persists (dark ↔ light), settings/consent all present, no LogBox error.
- **iPhone**: ⏳ not tested (needs EAS/macOS).

## Limitations (honest)

- Weekly ring goals (5 sessions / 30 min) are fixed constants, not user-set.
- Display-name editing is read-only here; the profile UPDATE path exists server-side
  (profiles RLS) but isn't surfaced yet.
- No haptics on press (would need `expo-haptics`); press feedback is visual only.
- Data-deletion "request" opens a mailto; the audited server-side deletion flow is
  future work (as the profiles migration notes).
