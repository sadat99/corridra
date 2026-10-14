# UX-03 validation

UX-02 main CI `38604184935` passed. Its file tree is the accepted baseline. A pre-change local build and all 12 protected tests passed, with six-width capture hooks exercising actual synthetic participant flows.

The first static check found a React rule against rendering a ref and an unused local. Pending declaration state now uses React state; the imperative guard remains a ref. A newly added export replay assertion referred to an undefined test-local variable; the explicit local Origin header corrected it. A code review found that refresh did not release its in-flight guard; that guard is now released on every outcome. These were initial findings, not passing results. The first full run passed 199 integration and 72 public tests; eleven protected cases passed, while a new precision-error assertion matched both the application feedback and Next.js route announcer. It now scopes feedback to the participant view. Contributor startup recovery also uses the existing fresh-document pattern and is checked with the actual local database TCP outage.

Final local checks passed: formatting, lint, type checks, 9 document tests, 7 infrastructure tests, 199 database/integration tests across 24 files, production build, 72 public browser tests and all 12 protected tests. Actual command results and logs are included under evidence/after. Exact-head CI must pass before the owner-authorized automatic merge and production deployment.

The unchanged database-backed suites include two-tenant/RLS negatives, expired rights and publisher revocation, customer identity versus capability scope, source/quotation versions, original minor-unit amounts, delegation participants and historical export bytes. New browser assertions use actual service authorization; only interruptions are injected.

A final acknowledgment focus improvement keeps keyboard users on the recorded supplier receipt. The source was rebuilt and its static checks passed; the final complete protected suite passed with the receipt-focus assertion included.

The supplier focused case depends on the preceding real MFA enrollment fixture. Running it alone against a newly reset database failed at setup before reaching the changed UI. The final protected suite runs in its established order. Full-page captures scroll to the document origin to avoid offscreen fixed skip links appearing in stitched screenshots.
