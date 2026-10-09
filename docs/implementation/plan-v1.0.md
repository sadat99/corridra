# Corridra implementation plan v1.0

Status: Parts 01 to 06 are implemented and deployed. Parts 03 to 06 retain their documented synthetic-data and deferred-control boundaries. Neon Auth account code is deployed with customer signup disabled. On 9 October 2026 the owner requested release closeout with signup deferred so work can move to Part 07. Part 07 is implemented, with deployment and acceptance tracked in its release record; Parts 08 to 12 remain planned. See [Part 07 release status](part-07-release.md). See [Part 06 release](part-06-release.md), [the account runbook](../runbooks/neon-auth-accounts.md) and [deferred controls](deferred-controls.md).

## Outcome and delivery method

Build one EU-primary, multi-tenant operating system for cross-border market access. Start with a visitable coming soon site. Keep it available while successive releases make mission delivery, commercial follow-through and local contribution usable. A part is a milestone containing small reviewable PRs, not one large PR or permission to build all parts at once.

The first sellable workflow is: short intake, operator qualification, relevant targets with provenance, controlled outreach, buyer response without registration, held meeting, follow-up and commercial progression through cash. Record manual operations in the same canonical model used by automation.

Every part has a deployed demonstration, measurable acceptance criteria and a rollback path. Show synthetic examples only in access-controlled previews with an explicit label. Public marketing must describe only available capabilities or clearly identified plans. The initial public page must never disappear while the product is under construction.

## Architecture contracts

1. PostgreSQL is transactional truth. Public organisation facts and tenant-private relationship knowledge have distinct records and access rules.
2. Preserve `source -> claim -> evidence -> verification -> canonical fact -> inference -> recommendation`. Extraction or repetition cannot turn a claim into a verified fact.
3. Server commands enforce the canonical mission, meeting, opportunity, evidence and DCG state machines. Material changes atomically write versioned domain events and outbox records.
4. Routes and UI call application services. Services use domain rules, repositories and adapters. A domain never writes another domain's tables directly.
5. Tenant-private rows carry `tenant_id`, application authorization and tested RLS. Use restricted runtime identities; migration credentials never reach application or preview runtime.
6. Money is integer minor units plus ISO currency. Rewards use an append-only ledger with compensating entries. Cash collected is distinct from contracts and invoices.
7. AI operates behind Corridra policy and provider adapters. Permissions, money, legal decisions, verified facts and consequential actions remain outside model authority.
8. Outcome Graph starts as relational projections from ordinary events. Add infrastructure only when measured product or load requirements justify it.
9. EU-primary databases and evidence storage; international access is purpose and role restricted. Previews use synthetic or sanitized non-production data exclusively.
10. Copy follows the constitution, including natural human writing and no em dashes. Proof is factual, representative and explicit about uncertainty.

## Ordered delivery

| Part | Release                                                  | Depends on      | Visitable result                                     |
| ---- | -------------------------------------------------------- | --------------- | ---------------------------------------------------- |
| 01   | Public launch and engineering baseline                   | None            | Public coming soon page                              |
| 02   | Public experience and design system                      | 01              | Public solution pages and process explanation        |
| 03   | Data, identity, tenancy and trust foundations            | 01              | Protected operator sign-in and synthetic workspace   |
| 04   | Mission intake and operations core                       | 02, 03          | Intake to an operator-owned mission                  |
| 05   | Counterparty research and qualification                  | 04              | Evidence-aware target shortlist                      |
| 06   | Controlled access, buyer response and meetings           | 05              | Secure buyer response to held meeting                |
| 07   | Follow-through, opportunity and outcome projection       | 06              | Mission yield through commercial progression         |
| 08   | Client and institutional delivery                        | 07              | Client progress and cohort reporting                 |
| 09   | Governed AI assistance                                   | 05, 07          | Reviewed research and brief assistance               |
| 10   | Corridra Network and contribution economics              | 03, 05, 07      | Local task to verified contribution and ledger       |
| 11   | Admin, durable workflows and operational reliability     | 06 to 10        | Controlled configuration and recoverable work queues |
| 12   | Pilot release, independent assurance and expansion gates | All prior parts | Production pilot satisfying the readiness checklist  |

Parts are built in the displayed order. Dependencies explain prerequisites if scheduling later changes. Security, accessible UX, authorization, observability and relevant admin controls ship with each part, rather than being deferred to Part 12.

## Part 01: Public launch and engineering baseline

**Deliver:** Preserve all three source documents and verify their hashes. Add the requested constitution amendment. Establish this plan, ADR-001, pnpm workspaces, pinned Next.js/React/TypeScript, formatting, lint, typecheck, document tests, browser smoke tests and CI. Build a responsive coming soon page using the approved headline and initial Bangladesh to Spain/EU corridor. Include metadata, a local brand icon, security headers and accessible navigation. Do not collect data or invent a contact address.

**Release:** Commit and push the reviewed bootstrap, deploy on Vercel and verify its public HTTPS URL. Record commit, deployment URL, deployment identity and actual validation evidence in the release record. Configure the Vercel project's Root Directory as `apps/web` and include workspace files outside that directory. Vercel installs the workspace lockfile and builds the web package. Confirm Git integration separately rather than assuming CLI deployment enables it.

**Gate:** Frozen install, document integrity tests, format, lint, typecheck, production build and desktop/mobile browser tests pass. Page has one clear heading, no broken links, no horizontal overflow, no fabricated proof, and no em dashes in public copy. Public request returns the actual headline and coming soon status. Credentials are absent from Git history and client bundles.

**Rollback:** Redeploy the previous successful Vercel release. Before the first release, a failed deployment leaves the repository unchanged and is retried after diagnosis.

## Part 02: Public experience and design system

**Deliver:** Implement `/sell`, `/source`, `/enter-market`, `/trade-missions`, `/how-it-works`, `/network`, `/institutions`, `/trust` and `/about` using the public-experience document. Create shared typography, spacing, colours, buttons, fields, cards, evidence labels and responsive navigation. Write the solution-page and navigation requirements as route-level acceptance criteria. Link only to available flows; until intake ships, clearly explain its upcoming status. Publish approved privacy/terms when an actual data-processing workflow requires them.

**Contracts:** Preserve job-based navigation. Keep Mission Infrastructure, DCG and Outcome Graph out of the primary visitor navigation. Distinguish planned capabilities from operational coverage. Do not publish testimonials, success percentages or partner logos without evidence and permission.

**Gate:** Every public route resolves; mobile navigation works by touch and keyboard; focus, contrast and landmarks pass accessibility checks; no unexplained client JavaScript, trackers or third-party font requests. Target Lighthouse accessibility >= 95 and performance >= 90 on representative mobile runs, recording the tool/version and any variance. Agree Core Web Vitals budgets: p75 LCP <= 2.5s, INP <= 200ms and CLS <= 0.1 once real traffic permits measurement.

**Live result:** Visitors can identify the solution that fits and understand what happens next. Existing coming soon URL stays available until the expanded public homepage is promoted.

**Rollback:** Revert the public routes or restore Part 01; no application state exists yet.

## Part 03: Data, identity, tenancy and trust foundations

**Deliver:** Provision Neon production and separate sanitized non-production projects in an approved EU region; verify current region availability and plans. Add Drizzle reviewed SQL migrations, PostGIS/pgvector only where supported and needed, synthetic seed primitives, EU object-storage adapter, backup policy and preview-branch lifecycle. Adopt an identity-provider adapter with privileged MFA/passkeys, session revocation and step-up support. Implement users, tenants, organisations, memberships, roles, RBAC/ABAC and restricted runtime database identities.

Create source, claim, immutable evidence metadata, verification and canonical-fact contracts. Add immutable audit, domain-event and transactional outbox envelopes: event ID/type/version, tenant, aggregate/version, actor, occurrence time, correlation/causation and safe payload. Build the upload quarantine, MIME/size checks, integrity hashes, malware scan adapter and authorization before enabling uploads. Retention, classification, purpose and AI-use policy are required metadata. Add versioned feature/config controls and a minimal privileged-access console.

**ADRs:** Record canvas ADR topics 001 to 005, 010 and 012 as separate decisions with tradeoffs, not silent assumptions. Complete a permission matrix, initial ERD, event catalogue and threat model. Check contractual/legal requirements before production personal data enters the system.

**Gate:** Fresh and upgrade migrations pass. Real PostgreSQL tests demonstrate cross-tenant denial, non-member denial, revoked-session denial and correct same-tenant access. Tests use the restricted runtime role so owner/superuser bypass cannot mask RLS failures. Domain mutation, event and outbox commit together or all roll back. Evidence remains quarantined until validation completes. Preview cannot access production credentials or clone production data. Restore one non-production backup and record recovery evidence.

**Live result:** Operator workspace with synthetic tenants. The owner subsequently authorized the production domain and temporary explicit unscanned-file handling in [ADR-015](../adr/0015-production-domain-and-explicit-unscanned-evidence.md). Deferred controls remain tracked; no customer import is added by this rollout.

**Rollback:** Prefer expand/contract migrations and compatible forward fixes. Revoke newly introduced identities and disable protected features; do not drop retained evidence or events.

## Part 04: Mission intake and operations core

**Deliver:** Build `/plan` as the documented five-step, no-account intake. Validate server-side, progressively preserve input, and present field-specific errors. Capture objective, market, visit window, offer/requirement, desired outcome and response details. Only collect optional phone/files when justified. Implement intake deduplication/idempotency, abuse limits, purpose/notice versions and an operator review queue. Submitted claims retain provenance and self-declared status.

Implement mission commands and canonical states, participant/objective/window records, commercial intent and target profile. Build Ops Home with an assigned owner, next action, due date and audit history. Use structured taxonomy primitives and timezone-aware dates; preserve original free text alongside extracted structure.

**Gate:** Browser flow persists a real mission once, without requiring account creation. Validation failures do not lose input. Duplicate submits do not duplicate missions. Unauthorized state changes fail. An operator can qualify, activate, pause and cancel a mission with valid reasons and atomic events. Reviewers can see source and consent/notice version. Required privacy notice and response channel are operational before the public CTA opens.

**Live result:** Public intake feeds a protected operator queue. Demonstrate an end-to-end synthetic submission on preview, then a controlled production pilot with permission.

**Rollback:** Disable public submission with a clear availability message, preserve accepted records, and continue operator work on the prior compatible release.

## Part 05: Counterparty research and qualification

**Deliver:** Organisation/counterparty workspace, public entity facts, tenant-private relationships/contacts/notes, products, capabilities, certifications, requirements and markets. Implement source ingestion, deterministic entity-resolution candidates, ambiguity review and reversible merge attribution. Add target accounts/contacts, qualification assessments, evidence gaps and transparent shortlist reasons. Operators can research manually without AI.

**Contracts:** Relationship ownership and selective visibility remain explicit. Verification requires a defined authorized process. A certificate is evidence, not automatic commercial fit. Source records survive canonical merges. Search uses appropriate Postgres indexes and scoped queries before a separate search system is considered.

**Gate:** A mission yields a shortlist with fit, source, uncertainty and next action. Tenant A cannot obtain tenant B's private contact/negotiation through search, export or joins. Merge/reversal preserves provenance. Stale evidence is visibly expired. Tests cover claim-versus-fact boundaries and ambiguous entity collisions.

**Live result:** Operator reviews a complete, evidence-aware target workspace using synthetic records in preview and authorized pilot records in production.

**Rollback:** Disable new ingestion/merge commands; existing read models and historical attribution remain available.

## Part 06: Controlled access, buyer response and meetings

**Deliver:** Communication records, purposes, policy basis, opt-outs, human-approved templates and channel adapters. Add jurisdiction-policy checks before external contact. Implement scoped, expiring, revocable buyer magic links using hashed tokens, least-data responses and rate limits. Buyer can select Interested, Need more information or Not relevant without registering. Prefetch/GET requests cannot accept an introduction or consume a decision token. Store responses idempotently and honour opt-outs.

Build proposed/accepted/scheduled/held meeting commands plus decline, cancellation, no-show and rescheduling paths. Add local/timezone rendering, itinerary, meeting brief, outcome capture and follow-up owner/deadline. Connect atomic outbox dispatch to durable orchestration through an adapter; implement retry, idempotency and dead-letter triage at first external side effect.

**Gate:** Link expiry/revocation/replay and unrelated-record access tests pass. GET scanners cannot trigger decisions. Parallel duplicate responses create one material event. Calendar/timezone and daylight-saving cases pass. A synthetic introduction progresses to an accepted, held meeting and follow-up. Email send permission, legal-policy basis and sender-domain readiness are confirmed before sending real outreach.

**Live result:** Minimal buyer page and operator scheduling flow. Public marketing can describe this availability only after controlled delivery works.

**Rollback:** Revoke affected links, stop dispatch, retain communication history and route pending work to operators. Never resend a side effect solely because a deployment was retried.

**Implementation status:** Part 06 is implemented and has passed authorized production acceptance. The [requirements map](part-06-scope.md), [ADR-018](../adr/0018-controlled-introductions-and-meeting-truth.md), [operations runbook](../runbooks/part-06-access-and-meetings.md) and [release record](part-06-release.md) distinguish local/CI implementation evidence from authorized production acceptance. Real outreach and D08 remain gated.

## Part 07: Follow-through, opportunity and outcome projection

**Deliver:** Qualified opportunity, RFQ, sample, proposal, commitment, contract, invoice, cash receipt and recurrence records with the canonical funnel. Enforce server transitions, loss reasons, attribution, owners and follow-up. Signed contract, invoiced amount and received cash have separate dates, evidence and currencies. Accounting confirmation is distinct from a sales claim. Start append-only outcome events and relational Outcome Graph projections, with replay/rebuild tooling.

**ADRs:** Canvas topic 006, projection/versioning and currency/attribution rules. Record external reference IDs without treating them as verified payments. Avoid guessed revenue, FX rates or causal attribution.

**Gate:** One mission can be operated from intake through cash evidence. Invalid transitions and unauthorized cash edits fail. Replay produces the same projection without duplicate cash/opportunity totals. Mixed currencies are shown separately unless a recorded conversion basis is used. Dashboard distinguishes activity, access, pipeline, contracts, invoices and cash, with denominators and attribution scope.

**Live result:** Operator mission-yield dashboard and overdue follow-up queue. This is the first minimum sellable mission milestone, subject to pilot/legal gates.

**Rollback:** Disable new transition types and rebuild projections from retained events. Correct financial mistakes with traceable compensating records.

## Part 08: Client and institutional delivery

**Deliver:** Scoped client mission view, brief/itinerary, evidence requests, progress and next actions. Add safe institutional CSV/Excel cohort intake with preview, row-level errors, deduplication and explicit confirmation. Build cohort dashboards and purpose-scoped PDF/CSV exports. Exports neutralize spreadsheet formula injection and emit audit events. Add external APIs only where a validated integration requires them, using Zod/OpenAPI contracts, scoped identities and rate limits.

**Gate:** Client sees only permitted mission information. Institution sees only approved cohort scope, without leaking private contacts, margins or negotiations. Import retries are idempotent and malformed rows cannot silently disappear. Report figures reconcile to the same canonical commercial records as Ops. Data export/download permissions and sensitive-field redaction are tested.

**Live result:** Client progress and a synthetic institutional programme with reproducible outcome reporting.

**Rollback:** Disable new cohort/export endpoints; preserve mission operations and previously accepted imports.

## Part 09: Governed AI assistance

**Deliver:** Corridra AI Gateway, provider adapters, task/prompt/model registry, structured outputs, budgets/timeouts, execution lineage and golden evaluations. Start with research, document extraction, intent structuring, fit explanations and meeting briefs. Add Gemini, OpenAI and Anthropic as configured adapters; verify current provider/tier data terms and approved destinations before use. Provider names do not appear in business-domain logic.

Version allowed data classes/tools, redaction, tenant scope, retrieval permissions, routing and human gates. Start with public or synthetic data on free development tiers. Give operators clear source citations, uncertainty and accept/reject controls. No autonomous outreach, verification, payout, pricing commitment, eligibility/legal decision or destructive deletion.

**ADRs:** Canvas topics 008 and 009, prompt-injection threat model and model-promotion criteria. Record data processing, cost attribution and failover policy.

**Gate:** Golden cases verify schema adherence, factual grounding, hallucination handling, prompt-injection resistance and budget limits. Unauthorized retrieval fails outside model control. All executions record policy/provider/model/prompt versions without logging secrets or confidential payloads. Provider outage leaves core mission operations usable. Model promotion requires quality, safety, cost and latency results with explicit thresholds.

**Live result:** Reviewed assistance in the operator workspace. AI makes suggestions; verified state changes still use deterministic authorized commands.

**Rollback:** Disable task routes or revert versioned routing. Operators retain manual delivery and existing canonical facts.

## Part 10: Corridra Network and contribution economics

**Deliver:** Mobile-first node onboarding, capabilities, service area and human eligibility review. Implement clear task scope, effort, evidence, reward, deadline and attribution before acceptance. Add assignment/reservation, submission, immutable evidence, verification and dispute handling. Support private connector participation and selective relationship visibility. Use task-scoped coarse location only when justified; no continuous tracking.

Implement contribution roles, dimensional reputation with explainable inputs, duplicate/anomaly review, effective-dated reward rules and append-only ledger buckets. Start manual, reviewed payout recording. Automated international payouts remain deferred until country/work-status/tax/provider controls are validated. Ledger balancing and reconciliation are deterministic and separate from reputation.

**ADRs:** Canvas topic 007, eligibility/payout treatment and configuration history. Launch tasks only when there is real useful work, rather than building an empty community.

**Gate:** The assignment lifecycle reaches verified contribution and an approved reward without editable balances. Double acceptance, duplicate evidence and repeated payment webhook tests cannot double-credit. Unauthorized verification/ledger mutation fails. Contribution provenance persists through later opportunity closure. Mobile submissions handle interrupted connections and disclose actual status rather than pretending upload succeeded.

**Live result:** Restricted pilot task board, evidence submission and reward status. Paid participation opens only after the relevant legal/operational review.

**Rollback:** Stop new assignments/reward rule versions; preserve accepted obligations, ledger and review history. Reverse mistakes through compensating entries.

## Part 11: Admin, durable workflows and operational reliability

**Deliver:** Complete the canvas admin inventory: tenants/users/roles, access review, markets/taxonomies, mission/workflow rules, evidence/entity resolution, DCG/rewards, AI routes/prompts/evals, communications/opt-outs, privacy/retention/DSAR/legal hold, billing/economics, feature flags, audit and health. Ship effective-dated configuration with approvals, impact preview and reversible activation. Store credential references/status only.

Expand durable orchestration for evidence processing, reminders, follow-up, evaluations and institution reports. Keep the Postgres outbox canonical. Add idempotent replay, retry/backoff, dead-letter ownership and operator recovery. Implement OpenTelemetry context, application/error monitoring, business telemetry, privacy-safe logs and tenant/mission cost attribution. Integrate DSAR/export/delete and retention jobs with legal holds and evidence/audit policy.

**ADRs:** Canvas topic 011; check Vercel Workflow maturity, region, duration, retention and pricing against current official docs. If unsuitable, preserve the adapter/outbox contracts and record an alternative before implementation.

**Gate:** Crash between business commit and delivery does not lose or duplicate the action. Admin cannot rewrite historical rules or retrieve API-key plaintext. Step-up and approval tests cover sensitive operations. Outbox backlog, failure rates, privileged changes and cost limits generate actionable alerts. DSAR/delete respects holds, storage cleanup and retained lawful audit records.

**Live result:** Controlled admin release and recoverable work queues. Document every background process, readiness signal, owner and failure response.

**Rollback:** Revert active config version, pause dispatch and feature flags, resume from preserved outbox checkpoints. Keep compatible worker/event versions during rollout.

## Part 12: Pilot release, independent assurance and expansion gates

**Deliver:** Close the full canvas section 23 readiness checklist. Run threat-model review, independent security review before sensitive/high-value scale, migration rehearsal, non-production restore/PITR drill, incident-response tabletop and privileged-access drill. Confirm notices, terms, controller/processor roles, DPA/SCC approach, EU outreach basis and international access with qualified counsel. Review DCG pilot-country treatment separately. Validate rate limits, CSRF/session protection, CSP, SSRF/upload defenses and secret handling under realistic deployment conditions.

Run bounded load tests on intake, Ops, buyer responses, search and reports. Establish measured capacity and agreed latency/error budgets before scaling. Measure technical health, AI quality/cost, operational speed, held qualified meetings, opportunity conversion, time-to-cash, repeat missions and corridor contribution using visible denominators. Availability target is 99.9% once staffed alerting/recovery and real measurements support it; a target is not a claim of achieved uptime.

**Gate:** All mandatory production-readiness items have an owner, test evidence and closure. No unexplained required test failures. Production and preview data/credentials are demonstrably isolated. Recovery objectives are agreed and met in a drill. Real pilot reports reconcile against source evidence. Confirm deployment promotion and rollback using the actual Vercel project. Unsupported or missing external prerequisites are recorded as blockers, not completed checkboxes.

**Live result:** Controlled Bangladesh to Spain/EU pilot. Expand only after repeatable delivery, sound contribution economics and legal/operational readiness in the next corridor.

**Rollback:** Disable risky features, roll back the application and use compatible forward database fixes. Maintain incident communication, evidence preservation and manual mission delivery.

## Engineering and release controls

Use short-lived PR branches after the initial bootstrap. Protect `main` with required CI, no force pushes and human review when a second trusted engineer is available. Enable secret scanning/push protection and dependency updates where the repository plan supports them. Add CodeQL and sensitive-path CODEOWNERS with real maintainers rather than invented accounts. These account-level controls are not active until verified through GitHub settings/API access.

Every behavior-changing PR includes lint, typecheck, focused tests, build and changed-flow Playwright tests. Add real Postgres/RLS integration checks starting in Part 03; do not claim zero tests validate a database. Test authorization denial, idempotency, failure recovery and state-machine boundaries as first-class behavior. Run AI evaluations only for affected AI paths. Ensure CI fails on failures and preserves runner exit status.

Vercel PR previews must use non-production credentials and synthetic/sanitized Neon branches. Verify the actual preview before promotion. Production migrations are reviewed, gated and backward compatible, run separately from application builds. Keep the previous compatible release and documented forward-fix path. No irreversible historical-data rewriting on deployment.

For each PR record: outcome, scope, acceptance criteria, non-goals, APIs/schema/events, permissions/data classes, test results, preview URL, migration/rollback and limitations. Each part ends with a release record and remaining decisions. Continue to the next part only when requested; this task builds Part 01, not the main system.

## Source coverage

| Canvas section                                                          | Delivery                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0 to 4: architecture, stakeholders, topology, stack and code boundaries | Contracts above; Parts 01 to 03; boundaries enforced in every part |
| 5 to 7: GitHub, agent contract and environments                         | Parts 01, 03 and release controls                                  |
| 8 to 11: tenancy, table families, states and evidence                   | Parts 03 to 07 and 10                                              |
| 12: DCG model                                                           | Part 10                                                            |
| 13 to 14: AI control plane and safe automation                          | Part 09                                                            |
| 15 to 16: communications, security and privacy                          | Parts 03, 04, 06, 11 and 12                                        |
| 17 to 18: Vercel workflows, reliability and cost                        | Parts 06, 09, 11 and 12                                            |
| 19: UX surfaces                                                         | Parts 02, 04 to 11                                                 |
| 20: 25 original build packets                                           | Packet mapping below                                               |
| 21 to 23: CI, guardrails and production gates                           | Every part; full closure in Part 12                                |
| 24: unfrozen decisions                                                  | Versioned config; Parts 05, 09 to 12                               |
| 25: first ADRs                                                          | Parts 01, 03, 07, 09, 10 and 11                                    |
| 26: seed configuration                                                  | Part 03; only factual primitives and synthetic examples            |
| 27: admin complete scope                                                | Controls with each domain; inventory closure in Part 11            |
| 28 to 30: minimum sellable mission, metrics and build rule              | Parts 04 to 07; measurements in Parts 11 to 12                     |
| 31: current-platform references                                         | Verify at the corresponding integration step                       |

| Original canvas packet | Plan part                                     |
| ---------------------- | --------------------------------------------- |
| 1                      | 01                                            |
| 2 to 5                 | 03                                            |
| 6 to 8                 | 04                                            |
| 9 to 10                | 05                                            |
| 11 to 12               | 06                                            |
| 13                     | 07                                            |
| 14                     | 04, expanded in 05 to 07                      |
| 15                     | 06                                            |
| 16                     | 08                                            |
| 17 to 19               | 09                                            |
| 20 to 22               | 10                                            |
| 23                     | 08                                            |
| 24                     | 06, expanded in 11                            |
| 25                     | Security starts in 01/03; final closure in 12 |

All 44 constitution sections remain in the working copy and govern public copy, trust labels, claims and stakeholder UX. All 35 public-experience sections remain in the working copy: navigation/routes/copy in Part 02, intake in Part 04, buyer response in Part 06, network in Part 10 and evidence semantics in Parts 03/05. The preserved source documents remain the complete requirement baseline.

## Decisions and prerequisites that must remain explicit

Required by integration, not invented now: Vercel project/team access; EU Neon/storage access and region; identity sender domain; counsel-approved production notices/outreach; pilot sectors and operators; DCG country/reward terms; approved AI credentials and provider terms. Use secure settings for credentials. Do not put secret values in plans, source files or PR descriptions.

Keep match weights, prices, commissions, reputation weights, expansion markets, channels, model routes and automation thresholds versioned and evidence-led. No Kubernetes, Kafka, dedicated graph database, native app, autonomous outbound agent or automated global payout system in the initial scope.

## Next task packet

**Outcome:** Implement Part 07 follow-through, opportunity and outcome projection in reviewable PRs. The owner authorized proceeding after closing out the completed Part 06 release with customer signup deferred. The [Part 07 handoff](part-07-handoff.md) records scope and acceptance. This authorization does not activate customer signup, real outreach or customer-data processing.

**Read:** Constitution claims/evidence rules; public-experience mission progress and reporting requirements; canvas commercial truth, canonical funnel, tenancy, money and ordinary-event Outcome Graph contracts; Part 07 above; ADR-015 to ADR-020; the Part 06 release/runbook and deferred controls register.

**Acceptance:** Operate an existing mission from held meeting and owned follow-up through qualified opportunity, RFQ/sample, proposal, commitment, contract, invoice, confirmed cash and recurrence. Enforce canonical transitions, required loss reasons and tenant/actor permissions. Keep signed contract, invoice and cash evidence distinct. Record integer minor units, currency, dates, accounting confirmation and attribution scope. Use append-only events and rebuildable, versioned relational projections; corrections require compensating records. Ship mission-yield and overdue follow-up views without guessed revenue, FX or causal claims.

**Validation:** Document integrity, format, lint, typecheck, real PostgreSQL/RLS integration, build and public/protected browser checks. Demonstrate invalid-transition denial, unauthorized cash denial, idempotent commands, projection replay with no duplicate totals and separate mixed-currency totals. Exercise a synthetic intake-to-cash journey. Keep existing public, buyer and operator flows working; record migration, CI, exact deployment SHA, functional acceptance and rollback evidence. D01 to D06, D08 and D09 retain their explicit activation boundaries.
