# ADR-014: Live synthetic preview with deferred operational controls

Status: superseded by ADR-015 after the user requested the production domain and explicit scan bypass. Originally accepted by the user's explicit instruction on 2026-10-05. Implementation and deployment evidence are recorded separately.

The user requested a live functional preview while deferring cloud malware scanning and unverified account controls. This supersedes the requirement to close those operational gates before deploying Part 03, within the limited synthetic scope below. It does not declare the controls complete or change the supplied originals.

Deploy the existing Part 03 PR as a synthetic operator preview using the separate Frankfurt non-production child, restricted runtime and identity logins, branch-only credentials, a unique exact HTTPS auth origin and real TOTP. Retain the project's already configured Vercel preview authentication. Keep the public production site on Part 02. Do not merge around branch rules, import customer data, open public signup or advance to Part 04.

Sign-in, authenticator enrollment, tenant access, source and claim recording, membership controls, feature controls, audit history and signout can operate. Evidence uploads remain disabled while no real scanner is configured. Scan errors never become clean verdicts; evidence cannot become downloadable or verified without the existing clean-scan and independent-review requirements. Selecting Blob does not waive those contracts. A tenant feature flag alone cannot make uploads available.

Keep Git auto-deployment held while account controls remain unverified. Explicit authenticated deployments of the exact pushed SHA provide a reviewable manual release path. Use Frankfurt functions for this preview. Any temporary automation protection credential is private, used only for acceptance and revoked afterwards; it is never a public share link.

Track remaining work in [the deferred controls register](../implementation/deferred-controls.md), with ownership, activation boundaries and concrete closure evidence. Cloud scanning is required before file uploads. GitHub controls must be resolved before unattended releases or a real pilot. Production data, legal-hold retention and S3 object recovery require their own release decisions. A functioning synthetic preview is not production readiness.
