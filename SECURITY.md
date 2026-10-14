# Security policy

WearWise is a **research prototype** built for the La Trobe University CSE3CAP Capstone
Project. It is **not a medical device**, it has **not been certified**, and it has **not been
penetration-tested or audited by an independent third party**. Its security practices are
informed by relevant guidance (OWASP MASVS, the OWASP Top 10 and Supabase's recommendations).
Do not use it with real participants until the owner's own review and approvals are in place.

## Supported version

| Version | Supported |
|---|---|
| `v1.0.0-handover` (the `main` branch) | Yes: security fixes are made on `main` |
| Anything older | No |

## Reporting a vulnerability

**Please report privately. Do not open a public issue, pull request or discussion about a
vulnerability.**

- Use GitHub's **private vulnerability reporting** for this repository (Security → Report a
  vulnerability), once the repository maintainers have enabled it.
- If that isn't available, contact the maintainers of the organisation that hosts this
  repository through a private channel they publish.

Include what you found, where (file, endpoint or screen), how to reproduce it, and the impact
you expect. You will get an acknowledgement, and fixes are released on `main` with a note in
`CHANGELOG.md`.

### Never include in a report, issue or commit

- passwords, API keys, Supabase service-role / secret keys, access tokens or signing keys;
- real participants' health data, recordings, email addresses or other personal information;
- screenshots that show any of the above.

If you accidentally exposed a credential, say so in your private report: it will be rotated.
Deleting it from a file or the latest commit is not enough.

## Scope

In scope: the phone app (`apps/mobile`), the web dashboard (`apps/dashboard`), the database
migrations and access rules (`supabase/`), the patch firmware (`firmware/`), and the shared
packages (`packages/`).

Out of scope: denial of service against hosted services, social engineering, physical attacks
on a patch beyond those described in the known limitations, and third-party services
(Supabase, Expo, GitHub) themselves.

## Known security limitations

These are documented, accepted for a research prototype, and listed with recommendations in
[docs/known-limitations.md](docs/known-limitations.md) and the security documentation:
unencrypted patch flash (no Secure Boot or flash encryption yet), no cryptographic patch
identity, no two-factor sign-in for staff, open sign-up without CAPTCHA, and no automatic data
retention or purge. Reports about these are still welcome if you find a new way to exploit them.

## More detail

- [docs/security.md](docs/security.md): controls, secrets and responsibilities.
- [docs/security/WearWise-Security-Documentation.pdf](docs/security/WearWise-Security-Documentation.pdf):
  the current, authoritative security documentation (threat model, controls, test evidence,
  risk register).
- [docs/security/dependency-advisories.md](docs/security/dependency-advisories.md): dependency
  advisories and their assessment.
