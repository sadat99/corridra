# V2 to V3 preservation matrix

**Document status: CURRENT, DATED.** Static baseline inventory; re-check against code and fresh runtime evidence before claiming preservation. See the [plan status register](../../PLAN_STATUS.md).

Baseline: e9ed2e53d97f543c30bace29d9ef38d568a65236. Phase 0 removes no functions. Static discovery is not verified preservation.

## Capability families

| ID        | Existing capability                                      | Required V3 home                                      | Status                                                                        |
| --------- | -------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| V3-05-003 | Public discovery, route pages and positioning            | Unified three-product homepage and supporting pages   | apps/web/app/page.tsx; PARTIAL; runtime evidence pending                      |
| V3-05-004 | Global country, EU and corridor selection                | Common market selector and advanced corridor settings | apps/web/components/corridor-map.tsx; PARTIAL; runtime evidence pending       |
| V3-05-005 | Synthetic request, receipt and operator replies          | Guided requests and continuing request history        | apps/web/app/plan/intake.tsx; PARTIAL; runtime evidence pending               |
| V3-05-006 | Customer registration, verification, recovery            | Customer account/security                             | apps/web/app/account/page.tsx; PARTIAL; runtime evidence pending              |
| V3-05-007 | Staff invitations, sign-in, MFA and recovery             | Staff access/security                                 | packages/auth/src/operator-setup.ts; PARTIAL; runtime evidence pending        |
| V3-05-008 | Owner/admin membership and role controls                 | People & Access administration                        | packages/auth/src/access.ts; PARTIAL; runtime evidence pending                |
| V3-05-009 | Tenant-scoped RLS and authenticated authority            | All workspaces and server boundaries                  | packages/db/src/index.ts; PARTIAL; runtime evidence pending                   |
| V3-05-010 | Versioned corridors, packs and route assignments         | Corridor Control Center                               | packages/missions/src/corridors.ts; PARTIAL; runtime evidence pending         |
| V3-05-011 | Progressive requirements and gaps                        | Contextual Requirements                               | packages/missions/src/commercial.ts; PARTIAL; runtime evidence pending        |
| V3-05-012 | Mission lifecycle and status commands                    | Commercial engagement workspace                       | packages/missions/src/index.ts; PARTIAL; runtime evidence pending             |
| V3-05-013 | Counterparty discovery/research                          | Companies & Qualification                             | packages/counterparties/src/index.ts; PARTIAL; runtime evidence pending       |
| V3-05-014 | Deduplication, source records and scoped contacts        | Company details and source history                    | packages/counterparties/src/index.ts; PARTIAL; runtime evidence pending       |
| V3-05-015 | Source/claim/evidence verification                       | Contextual evidence and protected review              | packages/evidence/src/index.ts; PARTIAL; runtime evidence pending             |
| V3-05-016 | Scan/quarantine and retention controls                   | Evidence security and governance                      | packages/evidence/src/adapters.ts; PARTIAL; runtime evidence pending          |
| V3-05-017 | Shortlist assessments and decisions                      | Buyer/Supplier qualification                          | packages/counterparties/src/index.ts; PARTIAL; runtime evidence pending       |
| V3-05-018 | RFQs and their commercial origins                        | Sourcing and commercial engagement                    | packages/missions/src/commercial.ts; PARTIAL; runtime evidence pending        |
| V3-05-019 | Supplier offers, original terms and revisions            | Quotations & Comparison                               | packages/missions/src/commercial.ts; PARTIAL; runtime evidence pending        |
| V3-05-020 | Machinery/site/technical requirements                    | Sourcing's machinery-specific experience              | packages/domain/src/commercial-missions.ts; PARTIAL; runtime evidence pending |
| V3-05-021 | Fair, factory and other typed visits                     | Meetings & Activities                                 | packages/missions/src/meetings.ts; PARTIAL; runtime evidence pending          |
| V3-05-022 | Introductions, recipient consent/response                | Commercial access and recipient experience            | packages/communications/src/index.ts; PARTIAL; runtime evidence pending       |
| V3-05-023 | Scheduled versus held meetings                           | Meetings & Activities with exact statuses             | packages/missions/src/meetings.ts; PARTIAL; runtime evidence pending          |
| V3-05-024 | Follow-ups and subsequent engagements                    | Actions and commercial progression                    | packages/missions/src/meetings.ts; PARTIAL; runtime evidence pending          |
| V3-05-025 | Meeting and non-meeting opportunity origins              | Commercial opportunities                              | packages/opportunities/src/index.ts; PARTIAL; runtime evidence pending        |
| V3-05-026 | Samples, proposals and commercial stages                 | Commercial Progress                                   | packages/opportunities/src/index.ts; PARTIAL; runtime evidence pending        |
| V3-05-027 | Customer contracts, invoices and cash observations       | Commercial Outcomes                                   | packages/opportunities/src/index.ts; PARTIAL; runtime evidence pending        |
| V3-05-028 | Immutable events, compensations and projections          | Financial and activity history                        | packages/workflows/src/index.ts; PARTIAL; runtime evidence pending            |
| V3-05-029 | Programme creation and institutional context             | Delegation OS and staff operations                    | packages/delivery/src/index.ts; PARTIAL; runtime evidence pending             |
| V3-05-030 | CSV/XLSX participant import                              | Delegation participant management                     | packages/delivery/src/import.ts; PARTIAL; runtime evidence pending            |
| V3-05-031 | Independent participant missions                         | Private participant workspace                         | packages/delivery/src/index.ts; PARTIAL; runtime evidence pending             |
| V3-05-032 | Shared agendas and programme schedules                   | Delegation Activities                                 | packages/delivery/src/index.ts; PARTIAL; runtime evidence pending             |
| V3-05-033 | Scoped publication and link issuance                     | Controlled Sharing                                    | packages/delivery/src/index.ts; PARTIAL; runtime evidence pending             |
| V3-05-034 | Expiring/revoked access                                  | Sharing and access enforcement                        | packages/delivery/src/index.ts; PARTIAL; runtime evidence pending             |
| V3-05-035 | Programme CSV/PDF reports                                | Delegation Outcomes & Reporting                       | packages/delivery/src/report.ts; PARTIAL; runtime evidence pending            |
| V3-05-036 | Tenanted registered AI tasks                             | Contextual assistance                                 | packages/intelligence/src/service.ts; PARTIAL; runtime evidence pending       |
| V3-05-037 | Governed provider adapters, budgets and reviews          | AI administration and task execution                  | packages/intelligence/src/adapters.ts; PARTIAL; runtime evidence pending      |
| V3-05-038 | Invited contributor tasks and evidence                   | Commercial Execution Network                          | packages/network/src/index.ts; PARTIAL; runtime evidence pending              |
| V3-05-039 | Contribution approval and disputes                       | Network Operations                                    | packages/network/src/index.ts; PARTIAL; runtime evidence pending              |
| V3-05-040 | Reward rules, obligations and reversals                  | Contributor Economics                                 | packages/domain/src/economics.ts; PARTIAL; runtime evidence pending           |
| V3-05-041 | Observed Corridra service fees/costs                     | Commercial Performance                                | packages/missions/src/operations.ts; PARTIAL; runtime evidence pending        |
| V3-05-042 | Precise currencies and source-preserving FX              | All monetary records and comparisons                  | packages/domain/src/currencies.ts; PARTIAL; runtime evidence pending          |
| V3-05-043 | Source-rights, transfer and policy versions              | Data & Privacy Governance                             | packages/domain/src/policy.ts; PARTIAL; runtime evidence pending              |
| V3-05-044 | Durable events, outbox, retries and idempotency          | Operations & Reliability                              | packages/workflows/src/index.ts; PARTIAL; runtime evidence pending            |
| V3-05-045 | Source-backed Control Center                             | Founder/Admin Operations                              | packages/missions/src/operations.ts; PARTIAL; runtime evidence pending        |
| V3-05-046 | Incident, recovery and system health                     | Operations & Reliability                              | packages/missions/src/operations.ts; PARTIAL; runtime evidence pending        |
| V3-05-047 | Route-specific real-operation readiness                  | Readiness & Activation                                | packages/missions/src/operations.ts; PARTIAL; runtime evidence pending        |
| V3-05-048 | Existing exports and deep links                          | Relevant contextual actions                           | apps/web/lib/workspace-navigation.ts; PARTIAL; runtime evidence pending       |
| V3-05-049 | Existing valid roles and deny rules                      | All workspaces                                        | packages/domain/src/index.ts; PARTIAL; runtime evidence pending               |
| V3-05-050 | Keyboard access, responsive views and recovery           | V3 design system                                      | apps/web/app/globals.css; PARTIAL; runtime evidence pending                   |
| V3-05-051 | Historic migration/event and original evidence integrity | Unchanged canonical records                           | packages/db/migrations; PARTIAL; runtime evidence pending                     |

Evidence per family: docs/implementation/implementation-matrix.json gives original code, test and ADR paths (39 requirement families); inventory.json gives current exact control/API/method/state locations, conditions and dependencies. Every control has its own destination and next action. Do not infer runtime coverage from a family row.

## Every operator section

Keep original /operator fragments and role declarations while regrouping context. Each label below is sourced from apps/web/lib/workspace-navigation.ts, not a replacement permission model.

| Section                         | Original and retained path        | V3 contextual handling                                                                             |
| ------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Missions and requirements       | /operator#workspace-missions      | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Companies and research          | /operator#workspace-research      | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Introductions and meetings      | /operator#workspace-meetings      | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Commercial progress             | /operator#workspace-commercial    | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Client and institution delivery | /operator#workspace-delivery      | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Sources and claims              | /operator#workspace-sources       | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Evidence review                 | /operator#workspace-evidence      | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| AI assistance                   | /operator#workspace-ai            | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Execution network               | /operator#workspace-network       | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Global operations               | /operator#workspace-operations    | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Mission dashboard and economics | /operator#ops-dashboard           | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Corridor Control Center         | /operator#ops-center              | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Recovery and health             | /operator#ops-health              | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Production readiness            | /operator#ops-gates               | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Corridors and policies          | /operator#workspace-settings      | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Access and audit                | /operator#workspace-audit         | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Authenticator                   | /operator#workspace-authenticator | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |
| Workspace controls              | /operator#workspace-controls      | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |

## Audiences and contextual authority

Anonymous visitor; verified/unverified customer; exporter/seller; importer/procurement; organiser; participant; buyer/supplier recipient; exact-assigned contributor; owner/admin/operator/reviewer/viewer. Commercial job labels grant no authority. Customer identity remains separate from invited staff password/MFA. Capability links retain audience, source rights, publication, expiry and revocation checks. New customer self-service authority is MISSING until separately implemented and denied correctly.

## Action/state mapping and protected operations

inventory.json retains every discovered source control (806), API dispatch (70), service method (119), domain vocabulary (166), permission call, test declaration, component path and migration/source hash. Each control records original file/line, routes, binding, visibility and intended destination. Original deep links remain until replacement passes affected roles/states. Export, cancellation, compensation, recovery, revocation, expiry, independent reviews, disputes and original evidence must remain available. Every state/role combination remains NOT VERIFIED until actual execution evidence is linked.

## Reconciliation limits and rollback

reconciliation.json compares UX10X snapshots against current source locations. Shifted lines are not proof of lost behavior; matched locations are not proof of preserved behavior. Data-driven maps, external identity and dynamically rendered controls require runtime expansion. No measured usability/performance improvement claimed. Revert UI commits for rollback, retain additive history, never disable denial checks or activation gates.
