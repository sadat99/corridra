# SaaS readiness audit, 15 October 2026

A read-only audit of what Corridra can and cannot do today as a paid software product. Nothing was changed to produce it. It is a dated record: it describes `main` at `47a03d0` (plus the production deployment of `f5e6384`, `dpl_Aqz6dLRGuj8ARTJe87CT8SsATeZZ`) and must be re-checked against newer code before it is quoted.

Evidence tags: **[O]** observed in code, migrations, tests or Vercel; **[I]** inference; **[U]** not verified. Implemented, tested, deployed, activated for real customers and commercially production-ready are different things and are kept apart below.

## Verdict

Corridra is not a SaaS today. It is a synthetic-only, staff-operated platform with strong isolation and governance foundations. No module is activated for real customers. There is no billing, no tenant provisioning and no white-label. The nearest route to revenue is a paid managed pilot that uses the existing staff workflow, not self-serve subscriptions. The vision document says the same: initial monetisation is "primarily paid managed commercial missions", and software subscriptions are deferred.

## What "seven modules" means here

The repository does not define seven modules. For this audit they are the three engines and four products of the Product Vision v2.1: Engine 1 Cross-Border Mission Infrastructure, Engine 2 Commercial Outcome Graph, Engine 3 Commercial Execution Network, and the products Missions, Sourcing (including machinery), Programmes and Field. Field has no separate implementation; it exists only as invited network tasks. If the owner means a different seven, this mapping must be redone.

## Findings by question

| Topic                             | Finding                                                                                                                                                                                                                                                                                        | Evidence                                                                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Real-customer activation          | None. Synthetic-only is enforced in code, not only in copy.                                                                                                                                                                                                                                    | [O] `packages/config/src/index.ts:49` pins `DATA_ENVIRONMENT` to `synthetic`. `0007_mission_core.sql:28` requires brief emails ending `@example.invalid`. 14 migrations carry synthetic-tenant guards. |
| Self-service                      | Customers can create and verify an account (identity only) and submit a labelled test request. They cannot create an organisation, see their own missions without a pasted private link, or manage sourcing or suppliers. Staff do every step after submit.                                    | [O] `apps/web/app/plan/intake.tsx`, `apps/web/app/api/intake`, `apps/web/app/account/customer-missions.tsx`                                                                                            |
| Institutions                      | No institution login. Staff create programmes, import participants, schedule meetings and issue links. The institution can view and export approved reports from a staff-issued link, expiring within 30 days. Recurring programmes do not exist.                                              | [O] `packages/delivery/src/index.ts`, `apps/web/app/programme/page.tsx`, ADR 0022                                                                                                                      |
| Delegation requests               | Anyone can submit a delegation request for any country pair (any supported country or the EU), with optional organiser and participants text. Organising, leading and managing it is staff work. Real delegations cannot be admitted.                                                          | [O] `apps/web/app/plan/intake.tsx:663`, `packages/domain/src/experience.ts:10`                                                                                                                         |
| Enterprise corridors              | Partial. A tenant owner can create routes between any registered countries and append pack JSON. New mission types, criteria, non-country markets and real channels need code or a migration. Packs are synthetic-only.                                                                        | [O] `apps/web/app/operator/review-settings.tsx`, `packages/domain/src/corridors.ts`, `0020_versioned_corridors.sql`                                                                                    |
| Multi-tenancy                     | Isolation design is sound: restricted roles, per-request tenant context, 74 policies, MFA step-up, tests on two to three synthetic tenants. No tenant provisioning. RLS is enabled but not forced. All tenants would share one database, one Blob store and one set of secrets.                | [O] `packages/db/src/index.ts:28,54`, `0001_identity_tenancy.sql`, `packages/auth/src/bootstrap.ts:43`, ADR 0003, `tests/integration/support.ts:44`                                                    |
| Billing and monetisation          | Nothing. No plans, trials, subscriptions, payment provider, customer invoices, metering, seats, entitlements, renewals or pricing page. The invoice and receipt tables are manually keyed observations restricted to synthetic tenants.                                                        | [O] repository-wide search for payment providers returns nothing; `0011`, `0022`, `0028` migrations; ADR 0029                                                                                          |
| White-label and enterprise        | Nothing. No per-tenant branding, custom domains, SSO or SCIM, API keys, outbound webhooks or integrations. Exports are per-mission or per-programme.                                                                                                                                           | [O] `apps/web/app/api` has 12 session or capability-link routes only                                                                                                                                   |
| Infrastructure                    | Frankfurt database and Blob store, Vercel fra1. Neon PITR window 6 hours; one drill on a tiny synthetic database took 4.7 s (not an RTO). No monitoring or alert routing, no WAF configuration, no load or SLO evidence, no unattended scheduler. Evidence scanning is bypassed in production. | [O] `docs/implementation/part-03-cloud-validation.json`, `apps/web/vercel.json`, Vercel production environment names                                                                                   |
| AI and marketplace                | Staff-only AI behind three gates, all off. The contributor network is invited-only and off. No payout adapter. Suppliers and clients collaborate only through scoped private links.                                                                                                            | [O] `packages/intelligence`, `packages/network`, `CORRIDRA_AI_ENABLED`, `CORRIDRA_NETWORK_ENABLED`                                                                                                     |
| Legal                             | The privacy page is a test-intake notice. No terms of service, DPA, cookie consent or subprocessor list. The controller entity is unresolved.                                                                                                                                                  | [O] `apps/web/app/privacy/page.tsx`, D08 in `docs/implementation/deferred-controls.md`                                                                                                                 |
| Production settings               | `DATA_ENVIRONMENT=synthetic`, `EVIDENCE_SCAN_MODE=bypass`, `EVIDENCE_STORAGE_PROVIDER=vercel-blob`, `DATABASE_REGION=aws-eu-central-1`. AI and network flags are not set. Three variables are flagged by Vercel as readable secrets.                                                           | [O] Vercel project `corridra`, names only, values not read                                                                                                                                             |
| Which database the live site uses | The documents say the live synthetic site runs on a non-production Neon project. Not confirmed in this audit: the Neon connector available in the session lists different projects.                                                                                                            | [U] `docs/runbooks/v2-reliability-recovery.md`, `docs/implementation/part-03-release.md`                                                                                                               |

## Readiness matrix

Every row shares these blockers. Code: **B1** synthetic hard guards, **B2** no tenant provisioning, **B3** no customer-owned mission view or notifications, **B4** no billing, **B5** no real outbound email. External: **X1** legal entity, privacy notice, terms and DPA (D08), **X2** scanner and storage (D01, D05), **X3** payment-provider eligibility, **X4** independent security review, **X5** branch protection and CodeQL (D02, D04).

| Module                    | What exists                                                                                                  | Self-service         | Estimated effort to a paid launch [I] |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------------------------- |
| E1 Mission infrastructure | Intake, state machine, versioned route packs, requirements, research, introductions, meetings. Staff-driven. | Test intake only     | 6 to 8 weeks                          |
| E2 Outcome graph          | Opportunities, commercial records in exact minor units, projections. Observations only.                      | None                 | 3 to 4 weeks after E1                 |
| E3 Execution network      | Invited tasks, review, rewards, disputes, 12 governed AI tasks. Off.                                         | None                 | 10 or more weeks; defer               |
| Missions                  | Public pages leading to `/plan`, then staff.                                                                 | Test intake only     | As E1                                 |
| Sourcing and machinery    | RFQ, original offers, comparison, machinery and site requirements, staff-entered.                            | None                 | 6 to 8 weeks                          |
| Programmes                | Programme context, agendas, scoped report and export at `/programme`.                                        | View and export only | 5 to 7 weeks                          |
| Field                     | No separate product.                                                                                         | None                 | Define first; defer                   |

## Gaps, ranked

| Rank | Gap                                                                                                                      | Kind                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| P0   | Real-data admission: additive migration, per-tenant real state, config change, readiness gating                          | Code (backbone)       |
| P0   | Tenant provisioning and staff invitation without a schema-owner procedure                                                | Code (backbone)       |
| P0   | Customer-owned mission view with notifications                                                                           | Code                  |
| P0   | Legal entity, privacy notice, terms, DPA, subprocessor list (X1)                                                         | External              |
| P0   | Private EU scanner and real evidence storage (X2)                                                                        | External              |
| P0   | Payment-provider eligibility for the legal entity (X3)                                                                   | External              |
| P0   | A monitored support and incident channel                                                                                 | External              |
| P1   | Real email channel, billing and entitlements, observability and alerts, tenant export and deletion, institution accounts | Code                  |
| P1   | Independent security review, branch protection, CodeQL (X4, X5)                                                          | External              |
| P1   | Re-create three production variables as Sensitive in Vercel                                                              | Configuration (owner) |
| P2   | SSO, API and webhooks, custom branding and domains, calendar, recurring programmes, load and SLO evidence                | Code                  |

## Recommended order

1. Now, in parallel and without code: the external items above, branch protection and the Vercel variable hygiene.
2. A paid managed pilot after the two backbone P0 items and the D08 gates: one institutional programme and one Bangladesh to China sourcing customer, invoiced outside the platform.
3. Customer view, real email and notifications.
4. Per-mission and per-programme invoicing first; subscriptions later.
5. Institution accounts and recurring programmes.
6. Enterprise corridors and white-label only after repeated institutional demand.

Selling the managed service off-platform now, with no customer personal data in the platform, is an option for the owner. It is a commercial and legal decision, not part of this repository's work.

## Roadmap, at most five pull requests, each needing the owner's explicit go-ahead

All five change the backbone (migrations, authentication or domain), so none may start without an owner request and an ADR where `AGENTS.md` requires one.

1. Real-data admission behind readiness gates.
2. Tenant provisioning and staff invitation using the existing invitation machinery.
3. Customer workspace: missions linked to the customer identity, notifications, real email channel.
4. Billing: plans, entitlements, seats, provider checkout and webhooks, invoices.
5. Institution portal: accounts, self-created programmes, recurrence, tenant branding.

## Limits of this audit

Integration tests were not re-run. Findings come from reading code, migrations, documents and the Vercel project environment names. Live GitHub enforcement, the Resend domain, Neon and Vercel plan tiers, and which Neon project the live site uses were not verified. Effort figures are estimates. Four read-only sub-reviews produced the detail; the claims above that matter most (no payment provider in the repository, the single runtime tenant insert, the synthetic guards, no forced RLS, the pinned data environment, the production variable names) were re-checked directly.

Related: [master plan](master-plan.md), [deferred controls](../implementation/deferred-controls.md), [per-route readiness](../implementation/v2-part-05-readiness.md), [current plan](../implementation/current-plan.md), [product vision v2.1](../product/corridra-product-vision-v2.1.md).
