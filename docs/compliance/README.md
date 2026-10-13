# Compliance: what is in place, and what to finish before launch

WearWise is a research proof of concept that collects health information in Australia.
This page lists the compliance pieces in the product, where people see them, and what
the organisation still has to do. It is a working checklist, not legal advice; the
documents are drafts for your lawyer and ethics committee to review.

## The documents

All of them live in one place, `packages/legal/src/docs/`, and both the phone app and the
web dashboard render the same text and version.

| Document | For | Shown |
|---|---|---|
| Terms of Use | everyone | sign-up (must agree), Before you continue, app Profile → Legal & privacy, dashboard footer and sign-in page |
| Privacy Policy | everyone | same as above |
| Collection Notice (APP 5) | everyone | sign-up (consent box refers to it), Before you continue |
| Health & safety | everyone | sign-up footer, app sign-in, dashboard footer |
| Research participation information | participants | sign-up (must have read), Before you continue |
| Researcher & clinician terms | staff | the dashboard's Before you continue for researchers and clinicians |
| Accessibility statement | everyone | Legal & privacy, dashboard footer |

The documents are public: `/legal` in the app (no sign-in needed) and on the dashboard.

## What the product records

| What | Where | Rule |
|---|---|---|
| Consent to store readings | `profiles.consent_recorded_at` | sign-up refused without it |
| 18 or older | `profiles.adult_confirmed_at` (migration 7) | sign-up refused without it; accounts from before confirm once; no uploads until confirmed |
| Terms version accepted | `profiles.terms_version`, `terms_accepted_at` (migration 8) | sign-up refused without it; after a change (bump `ACCEPTANCE_VERSION` in `packages/legal/src/index.ts`) everyone accepts again on next sign-in |
| Who can see whose data | `access_grants` (with revocation history) | participant-created share codes only |

## Before launch: fill in, decide, check

1. **Organisation details:** fill in every field in `packages/legal/src/org.ts`: legal name, ABN, address, privacy and support emails, ethics committee and approval number, study contact, hosting region, dashboard address and governing law. Until then, every document shows a "Draft" notice, and the gaps appear as `[brackets]`.
2. **Legal review:** have a lawyer review all seven documents, and the ethics committee review the research information and consent wording. Then set the date in `ACCEPTANCE_VERSION` (and each document's `version`) to the effective date.
3. **Hosting region:** host the Supabase project in **Sydney (`ap-southeast-2`)** if you can. Otherwise the Privacy Policy's overseas-disclosure section (APP 8) has to name the country, and you take on extra obligations.
4. **Account deletion in the app:** both Apple (App Store guideline 5.1.1(v)) and Google Play require apps that create accounts to let people **start account deletion inside the app**, and Google also requires a web link. Today the app has "Request account deletion", which opens an email to the privacy contact. Confirm with your reviewer whether that is enough for a research app, or build an in-app request (the database already has an `account_status` of `deletion_requested`).
5. **Data retention:** decide how long readings are kept after the study ends, and whether they are deleted or de-identified. The ethics approval usually sets this. Then put it in the Privacy Policy.
6. **Data breach plan:** write a short response plan for the Notifiable Data Breaches scheme: who assesses a suspected breach, within 30 days, and how the OAIC and affected people are notified.
7. **TGA:** WearWise presents itself as not a medical device: measurements only, no diagnosis. Ask your ethics committee whether the study also needs a TGA clinical trial notification (the CTN scheme) for using an unapproved device.
8. **Supabase settings:**
   - Auth: minimum password length 10, leaked-password protection on if your plan allows, custom SMTP so reset emails arrive, and the production reset URL on the redirect allow list.
   - Realtime: "Allow public access" **off**.
9. **App store listings:**
   - **Apple privacy labels.** Data linked to the user: Health & Fitness (health readings), Contact Info (name, email address), Identifiers (user ID). Not used for tracking. No third-party advertising or analytics.
   - **Google Play data safety.** Personal info (name, email), Health and fitness, App info and performance (none collected), Device or other IDs (account ID). Encrypted in transit. People can request deletion.
   - **Age rating and audience:** adults only, 18+. Don't target children.
10. **Accessibility:** run a screen-reader pass (VoiceOver, TalkBack) and an automated WCAG check on the dashboard before claiming WCAG 2.2 AA.

## Passwords

New passwords (sign-up, reset, change) need at least 10 characters and must not be common. As people type, a strength meter recommends capital and lowercase letters, numbers and symbols. The rules are shared by the app and the dashboard (`packages/password`).
