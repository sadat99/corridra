# Controlled introductions and meeting operations

**Document status: CURRENT, DATED.** The steps still describe the module. Counts, dates and rollout notes inside are historical. See the [plan status register](../PLAN_STATUS.md).

Module-specific guidance. Read [the current plan](../implementation/current-plan.md), [developer handoff](../START_HERE.md), [identity recovery](neon-auth-accounts.md) and [deployment](deployment.md) for current programme/access/release status. Part-specific counts and dated rollout/settings observations below refer to their own release; inspect the current schema and executed evidence before acting. These instructions never authorize real operations or bypass readiness gates.

Part 06 uses invented identities and `@example.invalid` recipients. A synthetic receipt demonstrates the dispatch protocol; it does not prove an email was sent. A manual receipt records an operator handoff. EMAIL is blocked in the database and current runtime. The sender-domain, send-permission, legal-policy and D08 gates remain open for real outreach.

## Operator and buyer flow

1. Sign in with the actual operator password and authenticator. An owner enables `communications.introductions` and `communications.dispatch` in Workspace controls. Both default off.
2. Qualify and activate an invented mission, move it to TARGETING and record a sourced target, relationship and current contact. Respect the existing relationship visibility and evidence distinctions.
3. An owner/admin with fresh MFA approves a jurisdiction/channel/contact-purpose policy with its basis and validity, and an introduction template. Replacing the policy immediately invalidates introductions tied to the older version.
4. Review the intended recipient and the eight buyer-facing fields. State evidence and uncertainty honestly. Create the private introduction. Its fragment link is a bearer capability: share only with the intended synthetic tester. An authenticated retry of the original command can recover the same link; plaintext capabilities are absent from PostgreSQL and event payloads.
5. Select **Dispatch pending introductions**. The transactional outbox starts Workflow jobs. Refresh to inspect delivery checkpoints and immutable attempts. A missing workflow-start acknowledgement leaves the database job available for another start. Duplicate starts use the same effect identity.
6. Open the complete private link without an account. Reading or reloading records no decision. Select Interested, Need more information or Not relevant. The same decision can be retried; a changed decision cannot replace it. Stop further introductions with the opt-out action. The recipient email digest blocks all channels/purposes for this tenant, including another contact with the same address.
7. Propose a meeting with its private brief, participant names, owner, next action, deadline and reason. Accept using the recorded Interested response or an explicit human observation. Acceptance does not imply attendance.
8. Schedule with an IANA timezone, local wall times, matching absolute timestamps with explicit offsets and a location. The itinerary shows meeting and viewer local times. DST gaps and mismatched offsets fail; use the intended offset to disambiguate repeated times.
9. Record HELD only after the scheduled start and with an observed outcome and owned, dated follow-up. NO_SHOW also requires an outcome and elapsed start. Decline, cancel or mark RESCHEDULE_REQUIRED explicitly; rescheduling retains the previous schedule in command history. Cancel/decline can clean up a meeting after its mission is stopped. Complete or cancel follow-up with a reason. Commercial opportunities and cash are Part 07.

Mission progression is TARGETING → OUTREACH → MEETINGS → FOLLOW_UP, with an approved introduction, accepted meeting and held meeting/follow-up respectively required. Hold/resume/cancel remain available. Paused/cancelled missions block new contact, buyer decisions and scheduling.

## Failure and recovery

Workflow 5.2.0 integrates through `withWorkflow`, identifier-only start arguments, Node step functions and durable sleeps. PostgreSQL owns 30-second leases, five-second retry delays and three delivery attempts per retry cycle. There are at most 20 workflow polls; unresolved work remains visible for operator recovery. This part requires an operator to start/recover pending work. An unattended scheduler is later operational work.

Inspect DEAD work and the sanitized attempt history before an explicit retry with a reason. Retrying retains history and stable identity. SUPPRESSED work stays suppressed: create a newly reviewed introduction only after the underlying permission, policy or mission condition is resolved. A persisted delivery receipt reconciles an interrupted checkpoint even if the link was subsequently revoked. Deployment retries never imply resending.

Revoke a link to stop reads and decisions immediately. Disable introductions to stop new contact and active buyer capabilities; disable dispatch to stop new effects. An effect already committed remains delivered. Disabling dispatch preserves historical workspace reads. Opt-outs are append-only and have no clearing command.

## Migration and release

Use the pinned Node 24/pnpm 11.19.0 toolchain. Apply `0009_controlled_communications.sql` then `0010_meetings_and_followup.sql` using the offline migrator, separately from builds. Earlier applied hashes remain immutable. Never use an owner connection in runtime. Local integration and browser runners reset only their dedicated loopback databases.

Run document/infrastructure checks, format, lint, typecheck, real PostgreSQL/RLS integration, dependency audit, build and the public/protected browser suites. Keep browser secrets, tokens, traces and screenshots private. The populated Part 05 upgrade compares missions, targets, contacts, permissions, events and outbox before and after the migrations.

For an authorized production release, verify the existing Frankfurt synthetic branch and exact migration hashes, merge through the normal PR process after actual CI, then verify the deployment SHA, READY state, alias and new buyer/operator flows. Record actual cloud Workflow execution separately from local proof. Retain preview authentication and the existing private Blob store. Do not change the separate production candidate or close scanner/account/privacy deferrals.

Rollback flags first, revoke affected links and route pending work to operators. Keep additive schema and immutable history; restore a compatible application and use forward database corrections. No destructive downgrade is provided. Real provider activation additionally requires reviewed regional/data terms and an idempotent external transport, including ambiguous acknowledgement recovery.
