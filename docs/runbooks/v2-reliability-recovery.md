# V2 incident, recovery and rollback runbook

## Triage and safe recovery

Open Recovery and health in the affected authorized workspace. It shows safe identifiers/statuses, available times, expired leases, retained attempt counts, named mission owners, outstanding task reviewers, AI failures/pending reservations and owned cases. No provider payload, credential or private contact belongs in logs. Use the server-generated X-Corridra-Request-ID and mission/message/run UUIDs to correlate a request with the immutable audit/event history.

For a dead communication, inspect policy, expiry, opt-out, target scope, recorded receipt and current delivery switch. Retry only eligible work through the existing command; suppressed policy is not bypassed. Starting/recovering dispatch may create another orchestration run, but the exact stable effect ID and persisted receipt prevent duplicate delivery. An acknowledged receipt wins after a lost acknowledgement. Attempts are retained; three failures enter DEAD. Transient waits are 5, 10 and 20 seconds, bounded by the unchanged attempt limit. Expired 30-second leases may be reclaimed safely. Never erase an attempt or resend because a deployment changed.

Assign a COMMUNICATION, TASK, REPORT, PROVIDER, SECURITY, FRAUD or INCIDENT case with a current owner and deadline. Reassign by appending a version; retain kind and subject. Close with evidence of the actual resolution. Task recovery goes through its existing disclosed assignment/submission/review/correction/dispute commands. Report publication/export remains the existing atomic scoped service; do not invent a background report job or alter stored historical export bytes. AI failures retain reservations and manual fallback; do not reset spent ceilings without reviewed new budget evidence.

## Monitoring and workflow compatibility

Use exact-deployment Vercel runtime error/fatal group counts, not unrestricted raw logs. Database reachability, unscanned evidence and owned queue/case deadlines are visible in the UI. Billing/provider invoice totals remain unknown until an actual account integration is approved. A dashboard is not an unattended alert subscription; configure an approved monitored support/incident channel before a real pilot.

Workflow SDK 5.2.0 documentation confirms runs pin to deployment versions and replacement runs may target a reviewed current deployment. Preserve the existing `deliverCommunication` and step identifiers for already-started runs. Recovery crosses only the stable message ID and derives the server capability inside the restricted step. Keep the PostgreSQL receipt/idempotency boundary when manually starting a successor. Never serialize credentials, personal evidence or runtime database clients into workflow input/checkpoints.

## Backup and restore

Inspect actual approved Neon project/branch, EU region and current history-retention metadata. The historical cloud drill is in `part-03-cloud-validation.json`; it is not a fresh real-data restore approval. The full integration suite performs a populated non-production dump/restore and proves retained events and runtime denials. Part 5 isolated cloud validation uses only a freshly inspected sterile parent and synthetic validation data. Never restore the live customer-identity branch into a preview.

A real-data drill requires an approved isolated EU recovery environment, scoped credentials, an approved plan, access/revocation controls and explicit retention/deletion handling. Verify canonical row/hash reconciliation, role restrictions, RLS, event/outbox receipt recovery and application compatibility before promoting a recovery. Record actual RPO/RTO from the drill rather than guessing. Keep existing live synthetic and default/sterile branches protected. Delete a temporary recovery branch only after exact identity/parent/children/binding checks and preserved sanitized evidence.

## Release and rollback

Apply migration 0028 only as a separate release job after populated 0027→0028 upgrade/replay, restricted-role negative tests, isolated Neon acceptance and exact final-head CI. Builds never migrate. Verify application project `odd-pond-26265871`, live synthetic `br-lucky-darkness-b1ppj8en` and actual customer Auth binding first. Preserve every original migration/hash, original table column/row and Auth metadata. Do not operate on native Vercel preview storage as the application database.

Use normal merge after passing exact-head checks, then verify production READY and the alias at the merged SHA. Smoke-test public/affected pages and anonymous protected API denials. Keep AI/network/real-data/outreach/payout gates closed without their actual prerequisites. GitHub settings returned 403; preserve the documented exact-head manual release equivalent until actual enforcement is verified.

To contain a route problem, pause the exact directional service. To contain an AI/network problem, disable the separately authorized deployment/tenant switch and retain manual mission reads. Roll back to accepted V2-compatible application `7a015101738acd4b2171a4f284babff09ef7bd1b` or a later proven compatible revision. Additive tables/columns remain; do not drop observations, rewards, evidence or financial history. Use a compatible forward fix and test replay. Restoring data is a separately approved recovery, not the routine application rollback.

After acceptance, delete only the completed product Git branch and its exact retired native preview after merged head/tree, production binding, parents/children and open-PR checks. Preserve all eight unfinished dependency PRs and their environments. Product and managed Neon creation refuse an eleventh branch; CI also checks the current budget. These checks cannot globally prevent another actor from creating a branch while repository settings are inaccessible.
