# Known limitations

The authoritative list of what WearWise does not do, or does only partly, at the handover
release (`v1.0.0-handover`, October 2026). WearWise is a **research proof of concept**, not a
certified medical device. Items marked **agreed scope** were deliberately left out of the
minimum viable product with the project owner; they are future work, not defects. Everything
else is a known gap with a recommendation. Security items match the risk register in the
security documentation (`docs/security/WearWise-Security-Documentation.pdf`, section 24).

## Scope (agreed with the project owner)

| Item | Status | Notes |
|---|---|---|
| NFC connectivity | **Agreed scope: deferred** | Bluetooth Low Energy was prioritised for the MVP. NFC is future work; the transport layer (`apps/mobile/src/data/transport/`) is the place to add it. |
| Several wearables streaming at once | **Agreed scope: one active wearable** | One patch is connected at a time for the proof of concept. The app remembers several patches and switches between them; a patch remembers two phones. The protocol and capability discovery were designed to scale. |
| App Store / Google Play publication | **Agreed scope: not required** | Development builds and a documented release-build process exist (`docs/deployment.md`); publishing is the owner's decision. |
| Clinical or commercial use | **Agreed scope: research prototype** | No diagnosis, no clinical validation, no regulatory approval. |

## Measurements and safety

| Item | Status | Recommendation |
|---|---|---|
| Clinical accuracy | Not validated | Readings are prototype sensor measurements. Validate against reference devices (`docs/HRValidation.md`). |
| SpO₂ | Uncalibrated formula | A board read about 80 % at rest during testing. Calibrate against a reference pulse oximeter. |
| Heart rate | Can read about double before settling, or on a weak module | Hold the value back until the estimate settles. |
| Possible-fall detection | Threshold heuristic; can miss falls and raise false alarms | Nothing outside WearWise is alerted (no SMS or emergency call). The alarm path was tested end to end on a real phone and the dashboard (13 October); the detection itself is not validated against real falls. A fall outside a recording reaches researchers only while live view is on (nothing stored); otherwise only falls during recordings are uploaded. |
| ECG | Education only; not tested with electrodes on a person in the handover tests | Battery or power-bank power only when electrodes are on a person. |

## Security (see the security documentation's risk register)

| Item | Status | Recommendation |
|---|---|---|
| Patch flash unencrypted, USB download open (R-01, High) | Open | Secure Boot V2 + flash encryption before patches leave the lab (`firmware/wearwise-esp32/README.md`, "Production hardening"). Permanent per chip; needs a signed-update process. |
| Two-factor sign-in for staff (R-02) | Not implemented | TOTP enrolment in the dashboard, required for viewer access. |
| Sign-up abuse protection (R-03) | Not implemented | CAPTCHA or a study enrolment code; monitor storage. |
| Cryptographic patch authenticity (R-04) | Partly: a saved patch whose identity changes is refused | A per-patch secret on the label, checked with a challenge on connect. |
| Owner-hosted Supabase settings (R-05) | Owner action | Email confirmation, SMTP, Site URL and redirects, Realtime public access off (`docs/deployment.md`). |
| Fixed label PIN per patch (R-06) | By design | Use **New PIN** whenever a patch changes hands. |
| Viewers see all columns of shareable sessions (R-07) | Open | A column-limited view for viewers. |
| No audit log of researcher reads (R-08) | Open | Keep Supabase logs per the protocol, or add read auditing. |
| Wi-Fi proof-of-possession is 4 bytes (R-10) | Open | A longer, per-phone value in a future protocol version. |
| Dependency advisories (R-11) | 5 remain, none exploitable as used | Upgrade the Expo SDK (`docs/security/dependency-advisories.md`). |

## Data, privacy and operations

| Item | Status | Recommendation |
|---|---|---|
| Retention and purge (R-12) | Not implemented | Define retention with the ethics approval; implement purge and consent withdrawal. Participants can delete sessions themselves. |
| Account deletion | Admin script only (`supabase/scripts/admin.mjs delete-account`) | An in-app "delete my account" flow. |
| Legal documents | Drafts | Fill in `packages/legal/src/org.ts`; the documents show "draft" until then. |
| Original capstone Supabase project (R-13) | Still exists | Retire it, or hand it over deliberately (`docs/deployment.md`). |
| Firmware updates | USB only (Patch setup or `idf.py`) | Over-the-air updates, signed, together with Secure Boot. |
| Continuous integration | Added at handover (`.github/workflows/ci.yml`) | Hardware tests stay manual. |

## Platforms and testing

| Item | Status | Notes |
|---|---|---|
| iOS | Builds and runs on the simulator; less real-device testing than Android, including the pinned Wi-Fi stream | Test an iOS release build on devices before use (R-14). |
| Emulators and simulators | No Bluetooth | Use the simulated patch, or a physical phone for real patches. |
| Home "Backed up x/y" | Counts a recording in progress as backed up until it stops | Cosmetic (`apps/mobile/src/app/(tabs)/home.tsx`). |

Future work is in [knowledge-transfer.md](knowledge-transfer.md#t-future-improvements).
