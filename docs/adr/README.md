# Architecture decision index

Read [Start here](../START_HERE.md), [current plan](../implementation/current-plan.md) and [current architecture](../architecture/v2-current-map.md). ADR numbers have intentional gaps; the [plan status register](../PLAN_STATUS.md) lists the ADRs that are superseded or only proposed (a `Status:` line inside an ADR is the state on the day it was written); do not renumber accepted decisions. These are contracts/dated decisions, not an implementation queue. Later explicit amendments supersede only the identified restriction.

ADR 014 preview-only deployment was amended by ADR 015 for the retained synthetic production-domain exception. ADR 019/D07 records the historical Git association repair; main Git auto-deployment was disabled until ADR 050 (20 October 2026) switched it on, so a merge to main deploys itself. ADR 020 customer identity remains separate from staff TOTP. ADRs 023–029 add the revised multi-corridor/commercial/intelligence/network/operations scope. ADR 031 supersedes only ADR 030 offline existing-staff password recovery; first invitations, lost MFA and suspended/expired recovery remain reviewed.

| Decision                                                          | Subject                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [0001](0001-public-launch-and-platform-boundaries.md)             | ADR-001: Public launch and platform boundaries                                            |
| [0002](0002-canonical-postgresql.md)                              | ADR-002: PostgreSQL is transactional truth                                                |
| [0003](0003-tenancy-and-identity.md)                              | ADR-003: Global entities, tenant-private records and database authorization               |
| [0004](0004-evidence-semantics.md)                                | ADR-004: Claims, evidence and verification stay distinct                                  |
| [0005](0005-events-and-outbox.md)                                 | ADR-005: Immutable domain events and transactional outbox                                 |
| [0010](0010-eu-data-and-access.md)                                | ADR-010: EU-primary storage and explicit access purpose                                   |
| [0012](0012-synthetic-preview-lifecycle.md)                       | ADR-012: Preview branches only from a sterile non-production parent                       |
| [0013](0013-blob-storage-and-s3-migration.md)                     | ADR-013: Temporary private EU Blob storage with an S3 migration path                      |
| [0014](0014-live-synthetic-preview-with-deferred-controls.md)     | ADR-014: Live synthetic preview with deferred operational controls                        |
| [0015](0015-production-domain-and-explicit-unscanned-evidence.md) | ADR-015: Production-domain rollout with explicit unscanned evidence                       |
| [0016](0016-mission-intake-and-operator-commands.md)              | ADR-016: Mission intake and operator commands                                             |
| [0017](0017-counterparty-research-and-reversible-attribution.md)  | ADR-017: Counterparty research and reversible attribution                                 |
| [0018](0018-controlled-introductions-and-meeting-truth.md)        | ADR-018: Controlled introductions and meeting truth                                       |
| [0019](0019-part-06-production-release-and-customer-readiness.md) | ADR-019: Part 06 production release and customer readiness                                |
| [0020](0020-neon-auth-accounts-and-preserved-operator-mfa.md)     | ADR-020: Neon Auth accounts and preserved operator MFA                                    |
| [0021](0021-commercial-funnel-cash-and-outcome-projections.md)    | ADR-021: Commercial funnel, cash and outcome projections                                  |
| [0022](0022-scoped-client-and-institutional-delivery.md)          | ADR-022: Scoped client and institutional delivery                                         |
| [0023](0023-global-markets-and-versioned-routes.md)               | ADR-023: Global markets and pinned route versions                                         |
| [0024](0024-commercial-origin-and-event-coexistence.md)           | ADR-024: Evidence-backed commercial origins                                               |
| [0025](0025-service-economics-rewards-and-privacy-boundaries.md)  | ADR-025: Separate service economics, reward obligations and policy authority              |
| [0026](0026-commercial-mission-execution.md)                      | ADR-026: Versioned commercial mission execution                                           |
| [0027](0027-scoped-multi-corridor-product-experience.md)          | ADR-027: Scoped multi-corridor product experience                                         |
| [0028](0028-governed-tasks-and-restricted-execution-network.md)   | ADR 028: Governed tasks and restricted execution work                                     |
| [0029](0029-operational-readiness-and-observed-economics.md)      | ADR 029: Evidenced route readiness and observed operations                                |
| [0030](0030-explicit-staff-invitation-and-first-password.md)      | ADR 030: Explicit staff invitation and first-password setup                               |
| [0031](0031-operator-password-recovery-and-scoped-directory.md)   | ADR 031: Operator password recovery and a scoped member directory                         |
| [0032](0032-customer-workspace-authority.md)                      | ADR 032: Proposed customer workspace authority; migration test-policy conflict unresolved |
| [0033](0033-private-customer-request-authority.md)                | ADR 033: Private customer request design; canonical engine reuse, implementation missing  |

Forward status, 17 October 2026: ADR032's original test-policy conflict was resolved by its documented independently optional customer module, with full original core tests retained. Synthetic provisioning/collaboration backends are verified; exposure and private provider acceptance remain gated. Read its forward amendments and the V3 ledger instead of treating the historical index label as current implementation state.

[ADR034](0034-custom-production-origin.md) records the owner-reported navigation repair:owned production subdomain as the exact canonical origin,provider allowlist preservation,host-scoped cookie implications and rollback. This is an origin configuration change,not a new identity or commercial activation.

| [0035](0035-private-original-request-details.md) | Creator-only original submitted request details;separate opt-in module |

| [0036](0036-account-saved-commercial-reports.md) | Private saved commercial reports,capability preservation and self-declared replies |

| [0038](0038-approved-customer-company-portfolios.md) | Canonical company continuity within original approved customer scopes |

| [0037](0037-customer-programme-command-authority.md) | Scoped customer creation of canonical programmes; additive command authority and preserved staff guard/event behavior |

| [0041](0041-private-delegation-participant-onboarding.md) | Private programme invitations and consented registrations;independent source and access authorities |
| [0042](0042-participant-commercial-mission-summary-grants.md) | Explicit participant objective summaries referencing canonical private missions;no organiser source grant |

ADR043: [Canonical programme context](0043-customer-canonical-programme-context.md), optional customer command and explicit participant sharing; original staff/agenda authorities preserved.

ADR044: [Private organisation profiles](0044-private-customer-organisation-profiles.md), optional append-only self-reported customer profile; the globally readable catalogue is untouched.

ADR045: [Private mission drafts](0045-private-customer-mission-drafts.md), optional creator-only guided request drafts that send through the unchanged private request path.
ADR046: [Private organiser programme economics](0046-private-organiser-programme-economics.md), an optional organiser-recorded ledger of fees, payments, costs and margins that moves no money.
ADR047: [Private programme coordination and reporting](0047-private-programme-coordination-and-reporting.md), an optional task board, capacity, attendance and consented participant feedback with a scoped organiser report that sends nothing and verifies nothing.
ADR048: [Private programme templates](0048-private-programme-templates.md), optional repeatable plans (purpose, capacity, tasks, planned costs) captured or written, versioned and applied only to an empty programme.
ADR049: [Synthetic production opt-in and open admission](0049-synthetic-production-opt-in-and-open-admission.md), an owner-accepted, default-off way to run the synthetic customer modules on production and admit email-verified accounts automatically, with scanning, legal and security recorded as deferred.
ADR050: [A merge to main deploys itself](0050-main-deploys-itself.md), the owner's reversal of the held main auto-deployment; verify the deployment of the merged SHA, deploy by hand only if none appeared.
ADR051: [Team roles and leaving](0051-member-roles-and-leaving.md), an optional, default-off way for a workspace owner to make invited members admins or regular members and for a member to leave, as an append-only history that the existing role readers consult.
ADR052: [Canonical organisation linking](0052-canonical-organisation-linking.md), an optional, default-off way for a workspace owner or admin to claim that the workspace company is a canonical organisation, with text evidence, deterministic deduplication and protected staff review, recorded as an append-only link ledger that never writes to the company catalogue.
ADR053: [Programme terms, eligibility and places](0053-programme-terms-eligibility-and-places.md), an optional, default-off way for an organiser to publish versioned terms and eligibility criteria and set minimum and maximum places with an ordered waiting list, for a participant to apply and accept, and for workspace members to own tasks and see in-app reminders.
ADR054: [Pricing templates, series and exports](0054-pricing-templates-series-and-exports.md), an optional, default-off set of versioned fee schedules, all-or-nothing bulk fees into the existing ledger, programme series with repeat editions, per-currency repeat revenue and audited CSV exports that move no money.
ADR055: [Contextual paid-service requests](0055-contextual-paid-service-requests.md), an optional, default-off, synthetic-only way for a workspace owner or admin to ask for paid local help from a request, programme or company, answered by a staff quote that lists every cost and exclusion, where accepting records an order intent only (no payment, billing not enabled).

ADR056: [Real-use admission and progressive registration](0056-real-use-admission-and-progressive-registration.md), owner-authorized real admission with deferred scanning, both signup entry paths and a verified identity plus possession handoff; real admission enabled, with genuine managed-provider acceptance separately unverified.

ADR057: [Real invited execution work](0057-real-invited-execution-work.md), separate contributor invitations and password/TOTP access, real purpose isolation and preserved review/reward boundaries; Production activation pending.

ADR058: [Emailed request status link](0058-emailed-request-status-link.md), proposed only; a 90 day link that shows request status without sign-in, awaiting owner approval, no code depends on it.

ADR059: [View-as preview](0059-view-as-preview.md), a read-only, always-logged preview of a customer screen with sample data for owners and admins; stage 1 built, switch off by default.

ADR060: [Synthetic plans, subscriptions and entitlements](0060-synthetic-plans-subscriptions-and-entitlements.md), an optional, default-off, synthetic-only billing slice: versioned plans with stated tax treatment, a customer request that records the exact plan shown, staff-activated subscription periods and a plain read of what a plan grants. No payment, invoice or processor; entitlements are recorded, not enforced; invoicing is a later slice.

ADR061: [Sample invoices, payment records and credit notes](0061-sample-invoices-payment-records-and-credit-notes.md), the second billing slice: an optional, default-off, synthetic-only record of what the team asks for each activated plan period, what they say was received and any credit, with derived status and per-currency balances. Customers read, staff write. No processor, collection, refund, tax calculation or legal numbering.

ADR062: [Real plans, subscriptions and entitlements](0062-real-plans-subscriptions-and-entitlements.md), billing stage 1 for real workspaces: an optional module whose control starts closed, a real catalogue kept apart from the sample one, staff-written real plans, customer requests and staff-activated periods. No invoice, charge or payment; entitlements are recorded, not enforced; real invoices (stage 2) and a payment provider (stage 3) wait for their official inputs.
ADR063: [Owner switches for shared reports of real workspaces](0063-real-report-access-switches.md), two independent owner switches for how a real report is read: a public link (off by default) and signed-in access (on by default), enforced in the application and in the database, so either can be turned on or off without code changes. Export stays refused.
ADR064: [Real invoices, payment records and credit notes](0064-real-invoices-payment-records-and-credit-notes.md), billing stage 2 for real workspaces: an optional module whose control starts closed, Singapore GST in exact minor units, gap-free yearly legal numbers, a second person approving every invoice and credit note, manual payment records, and supplier details with made-up fields marked on the face of each document. No payment provider and no money moves.
ADR065: [Simulated payment provider](0065-simulated-payment-provider.md), billing stage 3: a stand-in provider named Corridra Pay (madeup) so the pay and refund flow can be tried end to end. Optional module with a closed control; every reference says (madeup); no network, no card, no money moves, and no invoice ever changes. A made-up refund policy lets staff refund inside a window.
ADR067: [Notification records and Pulse](0067-notification-records-and-pulse.md), email about what needs a person: new messages for a Move, a request that moved, a close date and a finished mission; mute per request, daily digest, quiet hours, a stored language; a new module beside mission mail, off until the owner's privacy review.
ADR068: [Move records](0068-move-records.md), what a person must do next: a staff-set, append-only record with a fixed verb, a plain object, a holder and an optional real date, read by the customer through a database function; closed control, default off.
ADR069: [Reply Page](0069-reply-page.md), the supplier answer page extended: one question at a time, the quote terms the comparison engine needs, a language carried in the link, a receipt, and a staff review queue with an append-only review record; sample only until real outreach opens.
ADR070: [Decision card and sharing](0070-decision-card-and-sharing.md), a read-only, expiring card for a co-owner or bank on the delivery-link model; design only, not built until the interviews justify it.
ADR071: [The Road](0071-road-mapping.md), a request in six steps drawn from the mission status a customer may already read; Compare and Decide follow records; presentation only.
