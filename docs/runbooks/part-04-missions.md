# Part 04 mission operations

**Document status: CURRENT, DATED.** The steps still describe the module. Counts, dates and rollout notes inside are historical. See the [plan status register](../PLAN_STATUS.md).

Module-specific guidance. Read [the current plan](../implementation/current-plan.md), [developer handoff](../START_HERE.md), [identity recovery](neon-auth-accounts.md) and [deployment](deployment.md) for current programme/access/release status. Part-specific counts and dated rollout/settings observations below refer to their own release; inspect the current schema and executed evidence before acting. These instructions never authorize real operations or bypass readiness gates.

Read ADR-016 and the deferred controls register before activation. This release extends the existing synthetic Frankfurt database; do not repoint it to the owner's separate production-candidate database or delete corridra-live-synthetic.

## Development and acceptance

Use Node 24 and pnpm 11.19.0. Run pnpm install --frozen-lockfile, pnpm db:local, pnpm db:prepare-local and pnpm scanner:local. Use only the local fixture credentials in ignored .cache. Integration tests recreate isolated test databases. The operator browser server recreates only corridra_browser, migrates it and configures its own synthetic intake destination.

Run formatting, lint, typecheck, document/infrastructure tests, integration tests and the production build. Run public and operator browser suites sequentially because their default artifact directory is shared. Operator traces, screenshots and video remain disabled; their error contexts are excluded from CI artifacts. Never run live-browser tests through the local database reset script.

## Live activation and operations

Apply reviewed migration 0007 through the existing offline corridra_migrator connection, after checking the endpoint belongs to br-lucky-darkness-b1ppj8en in odd-pond-26265871. ConfigureSyntheticIntake is an offline-only helper. It validates the synthetic tenant and active owner, creates a dedicated ingress service principal and refuses to replace a different existing destination. App runtime retains the restricted roles and no management/migration credentials.

In a synthetic environment (real use not enabled), at /plan, submit invented details and an @example.invalid email. In production since 22 October 2026 this original intake answers 409 and real requests use the pending-request path described under "Opening to customers" below. Save the private receipt before closing the tab. A website link is optional; no crawler or public file-upload flow is invoked. Open /operator with the already provisioned owner account and real authenticator. Ops Home lists briefs ordered by due date; Open, All and Overdue filters are available. Refresh missions to see a new submission. Review source/notice details, set the structured market and target profile, then begin qualification. Activate, pause, resume or cancel with a recorded reason. The original intake and self-declared claim remain intact.

Post a receipt reply to make the response visible at /plan. This action sends no email. Do not put confidential information in receipt replies. Anyone holding the receipt can read those replies until the recorded retention window expires. Do not log, commit or place receipts in URLs. A content duplicate from a different browser receives no receipt, which prevents duplicate detection from exposing an existing private response channel.

To suspend new intake, the offline administrator sets app.intake_destination.enabled=false through an explicitly reviewed operation. Existing receipt reads and authorized operator work continue. Preserve the destination, service principal and mission records. To roll back application behavior, redeploy the preceding Part 03 release and close intake; leave the additive migration and append-only history in place. Do not down-migrate or reset the live database.

## Opening to customers

Real admission is enabled in production since 22 October 2026 under [ADR-056](../adr/0056-real-use-admission-and-progressive-registration.md), by approved run 39645923089 ([receipt](../v3/cleanup/2026-10-22-real-admission-enabled.json)). The receipt records `DATA_ENVIRONMENT=real`, `CORRIDRA_REAL_USE_ENABLED=true`, the real-use approval value for `CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK` and `CORRIDRA_CUSTOMER_OPEN_ADMISSION`, and `EVIDENCE_SCAN_MODE=bypass`. Scanning is bypassed and owner-deferred, so make no clean-scan claim.

What the code does now:

- `realUseEnabled()` (`packages/auth/src/customer-production.ts`) is true only when `DATA_ENVIRONMENT=real`, `CORRIDRA_REAL_USE_ENABLED=true` and production is not locked.
- The original mission engine intake, `POST /api/intake` (`apps/web/app/api/intake/route.ts`), refuses every brief with 409 "Finish account activation to submit your request" while real use is enabled. In production it no longer accepts briefs.
- The synthetic guard is still in the code. `briefSchema` (`packages/domain/src/missions.ts`) still requires an `@example.invalid` address, and `MissionService` (`packages/missions/src/index.ts`) uses it whenever it is built in synthetic mode, which is every environment where `realUseEnabled()` is false. Do not remove it as a shortcut; ADR-056 keeps the legacy synthetic acceptance and denial tests.
- Real requests go through `/api/intake/pending` and `/api/intake/pending/claim`. `apps/web/lib/pending-request.ts` refuses them with 503 unless `realUseEnabled()` is true. `apps/web/lib/foundations.ts` then builds `MissionService` in real mode, which uses `realBriefSchema` (any email address, notice version `real-intake-2026-10-21-v1`) and also asks the database `customer.intake_available()` before staging a request. Choosing the real schema grants no admission on its own.

Still open, from the ledger and the receipt: genuine production account, email activation and private-journey acceptance are unverified; the lawyer review of the privacy notice and the retention and reminder decisions are owner items; billing is missing. Outreach, AI inference, payments and payouts are not activated and need their own implementation and activation. Gates D01 to D06 and D08 stay closed. Deferred scanners and account checks keep their separately documented status.

History: before 22 October 2026 this section said the application enforced synthetic-only data and test email addresses, and listed the conditions for opening. The owner decision (ADR-056) and the configuration change (receipt: admission enabled, original authority preserved) are now recorded. The receipt also shows the live privacy page with real copy and the real notice version, and no test-address requirement. The privacy page (`apps/web/app/privacy/page.tsx`) names Corridra Pte Ltd as the organisation responsible and gives a contact address. No receipt here proves that the contact mailbox is monitored, that response delivery works or that retention cleanup runs, so treat those as not proven. Identity recovery is handled by managed Neon Auth (ADR-056), but its production use is part of the unverified acceptance above.
