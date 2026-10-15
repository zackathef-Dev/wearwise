# Decision 001 — Brand palette: Navy + Teal supersedes brief §27

**Date:** 2026-08-20
**Status:** Accepted
**Applies to:** WearWise (CSE3CAP Capstone — DSS Wearable App)

## Decision

The WearWise brand palette is **Navy `#0F2747` + Teal `#18B6A4`**, as implemented in
`design-system/tokens/colors.css`.

Section 27 of the project brief ("Branding Colour Direction — Emerald + Midnight Green",
Midnight Green `#064E3B` / Emerald `#10B981`) is **superseded** and should be read as
an earlier draft. All other sections of the brief remain authoritative.

## What actually differs

Only the brand hues diverge. Poppins (§29), Success `#22C55E`, and Light Grey `#E5E7EB`
were already identical in both.

| Role | Brief §27 (superseded) | In force |
|---|---|---|
| Primary dark | Midnight Green `#064E3B` | Navy `#0F2747` |
| Accent | Emerald `#10B981` | Teal `#18B6A4` |
| Charcoal | `#111827` | `#1F2937` |
| Warning | `#F59E0B` | `#F5C542` |
| Error | `#EF4444` | `#F97066` |

## Why

1. **Category differentiation.** Brief §2 states WearWise "is not meant to be only another
   fitness app". Emerald green is the dominant accent in consumer health and fitness apps;
   navy/teal reads as research instrumentation, matching §31's "scientific, trustworthy, calm,
   research-oriented" and §38's "research-oriented wearable data platform".
2. **Semantic collision.** An emerald primary sits adjacent to Success `#22C55E`, so a primary
   action and a success state become hard to distinguish — a real problem on screens that show
   connection and sync states constantly (§8).
3. **Data-visualisation conflict.** The data-viz ramp already assigns teal to ECG
   (`--ww-data-ecg`), blue to SpO2, amber to temperature. A green brand accent would compete
   with the ECG series and with the "normal reading" convention.
4. **Sunk implementation.** The palette is already realised across 26 components, 8 token files,
   21 guideline cards, 6 SVG brand assets, 24 PNG exports and 2 UI kits, all published to the
   design system project.

## Note

Brief §27 lists Grey as `#687280`; this appears to be a typo for `#6B7280` (Tailwind grey-500).
The system uses `#667085` for `--ww-grey-cool` regardless.

## Consequence

No rework. Anyone reconciling the brief against the build should treat this record as the
tiebreaker for colour only.
