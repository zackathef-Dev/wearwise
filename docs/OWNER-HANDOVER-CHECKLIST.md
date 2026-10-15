# Owner handover checklist

What has to be transferred, created or decided **outside Git**. None of these items belong in
the repository, and this file deliberately contains no credentials. Tick them off as they are
done; the Handover Documentation PDF (section 6, "The new owner's first steps") explains the
order.

## Ownership and access

- [ ] **GitHub repository** transferred to the organisation (or the owner added as an owner).
      Confirm public-source publication with the project owner/coordinator before changing
      the repository's visibility.
- [ ] **Supabase**: an organisation-controlled project created (`docs/deployment.md`), the
      migrations applied (never the demo seed), and the schema fingerprint compared.
- [ ] **Original capstone Supabase project**: handed over deliberately (the team adds the owner
      as Owner of its organisation) or retired. Former members removed; their personal access
      tokens revoked.
- [ ] **Researcher and clinician accounts** created with `supabase/admin/create-viewer.sql`;
      one account per person.

## Hosting and email

- [ ] **Dashboard hosting**: a domain or static host on HTTPS, security headers generated for
      the backend (`npm run deploy-config -w dashboard`), single-page fallback.
- [ ] **Supabase settings**: email confirmation on, Site URL and redirect URLs for the hosted
      dashboard (no `localhost`), Realtime "Allow public access" off.
- [ ] **SMTP**: the organisation's own email sender configured in Supabase.

## Signing keys and releases

- [ ] **Android signing**: the owner creates their own release keystore
      (`node scripts/create-release-signing.cjs` in `apps/mobile`) and stores it, with its
      passwords, in the organisation's secret store, with a backup. Losing it means the app
      can't be updated.
- [ ] **Apple signing**: an Apple Developer team, bundle identifier and signing set up in Xcode
      (change `io.wearwise.participant` if it is taken).
- [ ] **ESP32 signing keys** (only if Secure Boot is adopted): an offline signing key, a
      signed-image process for Patch setup, tried on spare boards first.
- [ ] **Release builds** made from the final commit (`docs/deployment.md`), not from any
      earlier APK.

## Governance and operations

- [ ] **Ethics and privacy**: an approved protocol; the organisation's details filled in
      `packages/legal/src/org.ts` (the legal documents show "draft" until then); a privacy
      contact.
- [ ] **Retention policy**: how long recordings are kept, and how they are purged; consent
      withdrawal.
- [ ] **Backups**: the Supabase plan's backups or point-in-time recovery enabled.
- [ ] **Monitoring**: storage growth, sign-up rate, failed sign-ins (Supabase reports).
- [ ] **MFA decision** for researcher and clinician accounts.
- [ ] **Sign-up abuse protection** decision (CAPTCHA or study enrolment code).
- [ ] **Patch hardening decision** (Secure Boot and flash encryption) before patches go to
      participants.
- [ ] **Secrets** (database password, service keys, access tokens, SMTP, signing keys) kept in
      the organisation's secret store; anything ever exposed rotated.
- [ ] **CI**: GitHub Actions enabled for the repository, and private vulnerability reporting
      enabled if it becomes public (`SECURITY.md`).
- [ ] **Independent security review** before any use beyond a supervised research prototype.
