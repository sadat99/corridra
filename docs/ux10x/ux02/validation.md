# UX-02 validation

**Document status: HISTORICAL.** Dated UX10X snapshot. Counts and results belong to the revision it names, not to today. See the [plan status register](../../PLAN_STATUS.md).

Dated phase inventory/validation record. Its counts, execution results and open issues belong to the captured revision, not an exhaustive current audit. See [the programme index](../README.md) and [current plan](../../implementation/current-plan.md). Preserve the paired ledger and evidence manifests; source discovery is not functional verification.

Accepted baseline is `21bc01327296edb8a5ee988b57918d94defce898`, UX-01 PR #39. Its main CI run passed. Original domain packages, API routes, server libraries, migrations, source documents and lockfile have no UX-02 diff. No live service or customer operation is exercised by local tests.

## Discovery and browser evidence

Accepted public route sources were replayed on a local isolated server, with source backup and concurrent-edit checks before restoration. The baseline covers 30 path/viewport observations at 1440, 1280, 768, 390, 360 and 320. UX-02 after captures cover the same observations plus the six-width synthetic evidence example. Both stages report zero axe violations and zero horizontal document overflow.

Local median FCP was 70 ms before and 66 ms after; maxima were 400 and 404 ms. These are individual local navigation measurements, not production or field LCP/INP or an assertion that every possible layout is covered.

## Behavior checks

Final checks passed: formatting, lint, type checks, 9 document tests, 7 infrastructure tests, 199 integration tests across 24 files, production build, 72 public browser tests and 12 protected operator/access tests.

Final commands and counts are saved in `evidence/after/results.json` and the sanitized logs.

- Public cases exercise role/job/direction discovery, no-write synthetic preview, EU/reverse-direction limits, native keyboard disclosure, real destinations, 24-hour expiry, corrupt/blocked storage and retained multilingual/original-budget drafts.
- The database-backed flow submits an actual synthetic machinery brief through the existing service, preserving the original BHD `1.234` as `1234` minor units. It checks invalid dates and real email refusal before network, outage/retry, same-key receipt replay, identical-content/new-key privacy, actual private receipt read and unknown-receipt denial without stale result content.
- Customer access tests use the existing config/SDK surface. Every auth transport request is rejected with an interruption; no authorization success is mocked. They verify single submission while pending, locked fields, focused failure, retry and incomplete reset-link recovery. Successful hosted customer email lifecycle is PARTIAL coverage, not a passing claim.
- Existing protected workflows, tenant/MFA/RLS negatives, startup recovery, money/evidence/history and original-currency tests remain required.

## Initial findings retained

The first lint run found two unescaped apostrophes; those were fixed. The first public run passed 68 cases and failed two because the test used a button-role selector for a native summary; the corrected native selector passed. Parallel focused runs initially collided in Playwright's shared artifact directory; separate output directories resolved the artifact failure. Final suites run serially.

A repeated intake fixture produced a privacy-preserving duplicate response without a receipt, as the existing service specifies. The test now uses unique invented details per run and verifies both same-key replay and identical-content/new-key suppression. The complete protected run passed eleven cases, then the added intake replay hit the shared fixture's real six-request budget. That test now uses a separate fixed local database/server with the same migrations, bootstrap, restricted identities and unmodified budget policy. Its complete flow passed there. No shared data, budget or authorization rule is modified or bypassed.

A baseline source checksum map produced a secret-scanner false positive. The metadata now stores separate path and SHA-256 fields; the evidence scan passes without a new ignore or weakened scanner rule. Local Semgrep rule tests and full/new-file scans passed with zero findings.

The first auth outage test expected a wrapper message, while the SDK threw the transport message directly. The assertion was corrected to its actual preserved error semantics.

## Scope and acceptance

The separate owner-approved UX-01 production release is documented in `ux01-production.json`. Actual production access checks use the official Vercel alias because the managed policy blocks the custom domain. No production signup, signin, intake, outreach or financial action was performed.

This is a bounded UX-02 review packet. Unlinked source actions, complete role/state combinations and hosted received-email paths remain NOT_YET_VERIFIED or PARTIAL. The original Gate 0 inventory remains intact. No percentage of whole-programme coverage is asserted.

UX-02 merge and deployment require owner acceptance. The branch and main have automatic Git deployments disabled. Rollback is this presentation/test/documentation diff; no database migration is involved.
