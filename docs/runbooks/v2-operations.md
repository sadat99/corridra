# Corridra V2 administrator and operator manual

## Entry and navigation

Use `/operator`, select the authorized workspace, verify the authenticator and open Global operations. Its links lead to Mission dashboard, Corridor Control Center, Recovery and health, Production readiness and the existing workspace sections. Owner/admin can administer; ordinary operators see authorized delivery metrics and recovery. Financial ledger and administration access remain owner/admin scoped. Workspace selection is the tenant filter; it never creates global access. Failed loads offer retry, and drafts remain in page memory. Do not reload a pending unacknowledged command unnecessarily; retry its existing ID.

## Set up a directional route

1. In Corridors and policies, install missing registered templates with owner authority. Choose two distinct ISO country scopes or an explicit approved market scope such as EU. Create the directional route. Reverse direction is a different route.
2. Create the initial reviewed pack using the existing bounded configuration editor. Select existing mission types, exact requirement/assessment versions, supported languages/currencies/time zones, approved source categories, operating clusters/localities, permitted SYNTHETIC/MANUAL channels, required capabilities and coverage. Unsupported adapters, arbitrary code, unknown policy fields and currency/channel expansion are denied. Do not infer legal approval from bloc membership or coverage text.
3. For subsequent versions, choose the route in Control Center, prepare a configuration draft, inspect its effects and submit the exact proposal. A different authorized owner reviews and publishes it. A stale base or unsupported reference fails without publishing. Two owner identities are required for independent publication; role promotion remains an explicit existing owner membership action.
4. Revert by preparing a new version containing the earlier desired configuration and repeating review. Never delete a pack, rewrite a historical assignment or reuse a version number. A new configuration requires new readiness evidence before approval.
5. Inspect active communication policy versions and privacy/source-rights versions. Model/provider routing uses the existing AI policy editor and secret references only. Current legal/pricing limitations cannot be bypassed by putting a value into JSON.

## Activate or pause a service

Choose the exact route and enabled mission type. Record all thirteen readiness dimensions with a named current owner, source evidence, rationale and expiry no later than the evidence retention. Missing or expired observations show BLOCKED. Only external dependencies may be NOT APPLICABLE, with an evidenced reason. A different authorized reviewer approves the exact current evidence set.

SYNTHETIC_APPROVED permits a reviewed synthetic readiness observation. It does not enable real intake, public operational advertising, outreach, AI credentials or contributor payouts. The present real-data release gate remains OFF. PAUSED blocks new assignments for the selected directional service and preserves previous missions, money and history. UNPUBLISHED records the controlled availability decision. Other routes remain independent.

The launch order is BD→China sourcing/machinery, then delegations; BD→Spain/EU buyer/export-market access, then selective reverse market entry. A future country requires existing capability/adapters, named owner, actual research path, approved data/communications, tested journey, offer/support, rollback and explicit readiness approval. Merely creating a route is not launch.

## Run a mission

Start from the short synthetic job brief or an independently imported programme participant. Record the actual origin, target and mission type, qualification records and pinned route assignment. Record progressive requirements with original declaration and source/claim. Research manually, preserve uncertainty, assess fit with the exact requirement version and request missing evidence. Capture RFQs and original quotations/currencies/terms; never replace a missing term with a guess. Arrange introductions and meetings/visits through their existing state machines. A proposed appointment is not held attendance.

Create the appropriate evidence-backed commercial origin or retain the held-meeting path. Record samples, proposals, contracts, invoices and cash separately. Accounting confirmation and exact compensations retain their existing permissions. Publish only approved client/supplier/institution scope. Programme observations retain participant denominators and cross-company confidentiality. Translation-derived content does not change the original evidence or become verification.

## Record commercial operations

Use the reviewed Operational command JSON editor. All commands contain an immutable request `id`, `action` and evidence-based `reason`. Keep the same ID and values for an unacknowledged retry. A changed payload with the same ID is denied. Commands commit their observation, audit/event/outbox and command receipt together. Inspect returned histories before assuming a record is absent.

| Action      | Required data and meaning                                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document`  | missionId, INVOICE/RECEIPT kind, parentId or null, reverseOf or null, amountMinor string, currency, sourceId, unique externalReference and occurredAt. These are Corridra documents, not customer invoices.                                                                            |
| `ledger`    | missionId, SERVICE_FEE/DELIVERY_COST kind, original amountMinor/currency, sourceId, externalReference, occurredAt and reverseOf. Existing contributor rewards remain in the original network/ledger flow.                                                                              |
| `effort`    | missionId, operatorId, 1–1440 minutes, sourceId, occurredAt and reverseOf. Compensation preserves the exact original operator/minutes.                                                                                                                                                 |
| `context`   | missionId, next version, customerReference/industry/acquisitionSource or null, payingStatus, revenueComplete/costComplete/effortComplete and sourceId. Optional intakeDecision and firstUsefulResultAt require actual evidence; rejected intake must already have a cancelled mission. |
| `ai-budget` | missionId, next version, amountMinor string as lifetime reserved USD minor units, sourceId and validUntil. Zero stops new reservations; expiry/exhaustion preserves manual fallback. Tenant/day and task limits remain.                                                                |
| `template`  | Registered typeKey, MISSION_TYPE/REQUIREMENT/ASSESSMENT kind, next version and description. Schema fields/criteria come from registered code, not executable input. Owner authority remains.                                                                                           |
| `case`      | Stable key, next version, kind, same-tenant subjectId or null, OPEN/BLOCKED/RESOLVED state, active ownerId, dueAt, sourceId or null. Resolution needs evidence; it performs no delivery, deletion, verification or payout.                                                             |

Receipt collection cannot exceed the original invoice or change currency. Compensation uses the exact negative original amount and ID. Compensate receipts before reversing their invoice. A completeness attestation must follow the reviewed ledger entries; later activity makes margin unknown until rereview. A recorded subtotal may be displayed without claiming it is the full mission economics. No original amount is converted or replaced.

## Read the founder dashboard

Filter by current workspace/tenant, corridor ID, directional route, mission type, recorded customer reference/industry, owner, intake dates, commercial stage and programme. Totals include all matching authorized missions; the mission list is paginated at 50. Queue lists are bounded at 100 and explicitly labelled.

Submitted/qualified/accepted state counts, cancellation, actual responses/held meetings, target/fit observations, quote/RFQ/assessment activity, loss reasons and programme denominators come from canonical records. Recorded rejections and useful-result acceptance come from source-backed context; their absence does not convert cancellation or first-target timing into those metrics. Customer reference is an observation, not verified identity. Repeat mission association is not causal acquisition attribution or cohort retention.

Earned service fees, Corridra invoiced/collected fees, direct costs, contributor obligations and customer trade/cash are distinct categories. Compare original currencies separately. A contribution margin requires complete fee/cost/reward coverage for that mission/currency; otherwise read the observed subtotals and warning. Completed-mission columns show their actual recorded denominators; no unsupported average, forecast or accuracy claim appears. Provider reservations are not provider invoices; infrastructure cost is unknown until actual billing is connected.

## Switch an AI provider/model or prompt release

Use Corridors and policies to append a new reviewed model policy with supported adapter/model, explicit task coverage, secret reference, terms/evaluation sources, processing locations, rates, ceiling and expiry. Bind the exact reviewed policy to an available mission pack through the existing policy guards. Inspect the registered task/prompt/schema version and evaluation evidence. Missing credentials, region review or accepted live evaluation blocks real inference. Both deployment and tenant flags must permit inference; default production AI remains OFF.

Registered prompts are immutable engineering release assets. Release a changed registered prompt/schema through reviewed code, golden/schema/grounding/privacy tests and normal CI deployment; do not type executable policy or a free-form unreviewed prompt into admin configuration. The provider/model policy can switch between already supported identifiers without a country-specific deployment. A failed or unavailable model preserves ordinary manual mission operations. Review drafts explicitly; accepting one never verifies facts or performs a commercial command.

## Assign local operators and contributors

An owner manages existing memberships; scope and fresh MFA remain required. Choose a current named operational owner in readiness and mission follow-up. Use Execution network to review contributor identity, capabilities, markets, work country, language, eligibility source/expiry and availability. Assign only a matching reviewed task with disclosure, terms, deadline, reviewer and optional current reward rule. Contributors receive exact task disclosure, not membership or parent mission access.

Submissions remain original declarations until the existing independent review/verification process. Reward assessment, independent credit and separate reconciliation use the original ledger. Reverse by exact compensation; never overwrite rewards or silently change the accepted rule. Record a scoped FRAUD or TASK case for an accountable investigation; do not infer fraud from a flag. Disputes retain their existing network event history and explicit disposition. External payout remains unavailable.

## Privacy and production gates

Inspect source, evidence, original-language content, classification/purpose, current rights version, jurisdictions, transfer review, retention and legal hold. Rights review cannot extend source retention or override AI denial. Open a PRIVACY case for a DSAR, deletion or legal-hold decision, with a named owner, deadline and actual evidence. A resolved case is not proof that bytes were deleted. Automatic deletion remains blocked until counsel/owner approve policy and an executable storage/DB plan is independently validated.

Validate a credential-free environment plan with `pnpm exec tsx scripts/validate-environment-plan.ts <metadata.json>`. Synthetic, candidate and production resources/credential references must be distinct. A valid plan and approval IDs still require provider-binding and actual approval verification. Never copy real personal records into previews. Keep the existing synthetic branch intact while a separately approved real-data setup is prepared. Account verification/recovery approval applies to identity mail, not commercial outreach or mission intake.

Review the dated Part 5 controls register and original deferrals before every activation. Missing legal, operator, storage/scanner, provider or GitHub prerequisite remains BLOCKED with its actual next action. Do not purchase entitlement, fabricate counsel clearance, enable real outreach or execute real-money/customer test transactions from this runbook.
