# Part 04 mission operations

**Document status: CURRENT, DATED.** The steps still describe the module. Counts, dates and rollout notes inside are historical. See the [plan status register](../PLAN_STATUS.md).

Module-specific guidance. Read [the current plan](../implementation/current-plan.md), [developer handoff](../START_HERE.md), [identity recovery](neon-auth-accounts.md) and [deployment](deployment.md) for current programme/access/release status. Part-specific counts and dated rollout/settings observations below refer to their own release; inspect the current schema and executed evidence before acting. These instructions never authorize real operations or bypass readiness gates.

Read ADR-016 and the deferred controls register before activation. This release extends the existing synthetic Frankfurt database; do not repoint it to the owner's separate production-candidate database or delete corridra-live-synthetic.

## Development and acceptance

Use Node 24 and pnpm 11.19.0. Run pnpm install --frozen-lockfile, pnpm db:local, pnpm db:prepare-local and pnpm scanner:local. Use only the local fixture credentials in ignored .cache. Integration tests recreate isolated test databases. The operator browser server recreates only corridra_browser, migrates it and configures its own synthetic intake destination.

Run formatting, lint, typecheck, document/infrastructure tests, integration tests and the production build. Run public and operator browser suites sequentially because their default artifact directory is shared. Operator traces, screenshots and video remain disabled; their error contexts are excluded from CI artifacts. Never run live-browser tests through the local database reset script.

## Live activation and operations

Apply reviewed migration 0007 through the existing offline corridra_migrator connection, after checking the endpoint belongs to br-lucky-darkness-b1ppj8en in odd-pond-26265871. ConfigureSyntheticIntake is an offline-only helper. It validates the synthetic tenant and active owner, creates a dedicated ingress service principal and refuses to replace a different existing destination. App runtime retains the restricted roles and no management/migration credentials.

At /plan, submit invented details and an @example.invalid email. Save the private receipt before closing the tab. A website link is optional; no crawler or public file-upload flow is invoked. Open /operator with the already provisioned owner account and real authenticator. Ops Home lists briefs ordered by due date; Open, All and Overdue filters are available. Refresh missions to see a new submission. Review source/notice details, set the structured market and target profile, then begin qualification. Activate, pause, resume or cancel with a recorded reason. The original intake and self-declared claim remain intact.

Post a receipt reply to make the response visible at /plan. This action sends no email. Do not put confidential information in receipt replies. Anyone holding the receipt can read those replies until the recorded retention window expires. Do not log, commit or place receipts in URLs. A content duplicate from a different browser receives no receipt, which prevents duplicate detection from exposing an existing private response channel.

To suspend new intake, the offline administrator sets app.intake_destination.enabled=false through an explicitly reviewed operation. Existing receipt reads and authorized operator work continue. Preserve the destination, service principal and mission records. To roll back application behavior, redeploy the preceding Part 03 release and close intake; leave the additive migration and append-only history in place. Do not down-migrate or reset the live database.

## Opening to customers

The current application enforces synthetic-only data and test email addresses. Do not remove that restriction as a deployment shortcut. Confirm the controller's legal identity, monitored privacy contact, approved notice, response delivery, retention cleanup, identity recovery and the real-pilot release gates. Record the owner decision and implement the required policy/configuration migration with negative authorization tests. Deferred scanners and account checks retain their separately documented status.
