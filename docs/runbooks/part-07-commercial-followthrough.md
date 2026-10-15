# Commercial follow-through operations

Module-specific guidance. Read [the current plan](../implementation/current-plan.md), [developer handoff](../START_HERE.md), [identity recovery](neon-auth-accounts.md) and [deployment](deployment.md) for current programme/access/release status. Part-specific counts and dated rollout/settings observations below refer to their own release; inspect the current schema and executed evidence before acting. These instructions never authorize real operations or bypass readiness gates.

Read [the requirement baseline](../implementation/part-07-scope.md), [ADR-021](../adr/0021-commercial-funnel-cash-and-outcome-projections.md) and [deferred controls](../implementation/deferred-controls.md). Use invented records until customer-data/pilot controls are complete. Existing invited-operator password and authenticator access remains available while Neon Auth customer signup is deferred.

## Operate a mission

1. Complete the existing intake, qualification, targeting, introduction and held-meeting journey. Move the mission into FOLLOW_UP. Keep its meeting follow-up owned and dated.
2. A workspace owner with fresh MFA enables `opportunities.commands` for the intended synthetic workspace. Configuration remains owner-only; admins can confirm accounting and rebuild reports after the owner enables commands. The flag defaults off and affects writes, not historical reads. Operators can then create an opportunity from a held meeting, record attribution and limits, and assign its owner, next action and deadline.
3. Qualify the opportunity. Record RFQs/samples separately. Record a proposal before advancing to PROPOSAL, a commitment before COMMITMENT, observed contract evidence before CONTRACT and an invoice linked to that contract before INVOICE. Every command needs a reason; stale versions fail visibly.
4. Record cash against its invoice using the source, actual observed date, currency, amount and distinct external reference. This remains a reported receipt. It contributes no confirmed cash until an owner/admin performs the separate accounting confirmation with fresh MFA, an observed accounting source and a human confirmation basis. A self-declaration is insufficient.
5. Advance to CASH_COLLECTED after confirmation. A later receipt from a different invoice, confirmed in the same currency, can support a repeat-order observation and RECURRING_REVENUE. Select the earlier confirmed receipt explicitly. A second payment of the same invoice does not establish recurrence.
6. Use the report's mission filter and visible denominators. Contract, invoice and cash totals are separate, currency-specific amounts. Repeat cash is already included in confirmed cash. Historical stage counts do not disappear after financial correction. Load further evidence pages when history exceeds the initial bound.
7. Move FOLLOW_UP to COMMERCIAL_PIPELINE after qualification. Close only when every opportunity has a recorded loss or cash outcome, reported cash assertions are resolved, and meeting follow-ups are complete. Cancellation/hold remain recorded mission operations.

Loss requires a reason and cannot conceal net confirmed cash. Records inherit source retention and deny AI use. Supporting files must be currently accessible, matched to the source and scanned or explicitly permitted under the existing synthetic bypass; the UI labels unscanned files. Restricted source data cannot be copied into a more visible commercial record. A record or source reference does not independently verify a contract or payment.

## Correct and recover

For a wrong amount, an owner/admin with fresh MFA records full negative compensation with a source and reason. Retain the original. Compensate dependent receipts before invoices and invoices before contracts. An unconfirmed sales assertion may be compensated without affecting confirmed cash. A confirmed receipt's compensation must itself receive accounting confirmation before confirmed cash changes. Never edit/delete financial rows to fix mistakes.

If a response is lost, retry the unchanged command. Its actor-scoped key returns the original result without duplicate totals; changing the payload with that key fails. The client retains an unsuccessful command key during the page session. Check the visible record before submitting a new command after reload.

An owner/admin with fresh MFA can rebuild commercial reports with an explicit reason. PostgreSQL serializes the tenant's commercial commands, replays versioned retained events and appends a rebuild command/audit/outbox entry. Repeated events do not duplicate material entities or cash. Inspect immutable events and command history if source and report disagree; use a reviewed forward fix for an unsupported event version.

## Release and rollback

Run every repository check and protected browser journey against real isolated PostgreSQL. Apply only the reviewed additive 0011 to 0013 migrations using the migrator credential outside the build. Check populated-upgrade preservation, exact migration hashes, runtime RLS, CI and exact deployment SHA. Verify production and remove any temporary synthetic test access/sessions; restore prior flags and retain immutable proof.

Rollback disables `opportunities.commands`, restores a compatible application deployment and retains the additive schema, original events and financial records. Rebuild derived projections after a reviewed forward correction. Do not drop tables, rewrite migrations already applied or remove accounting history. Keep customer signup disabled and real outreach/customer-data gates unchanged.
