# ADR-062: Real plans, subscriptions and entitlements (billing stage 1)

Status: bounded implementation, no money, default off. Two switches must both be on before a real workspace can see or ask for a plan: the database control opened by the owner-run install job, and `CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED` (which also needs `CORRIDRA_CUSTOMER_BILLING_ENABLED`). Stage 2 (real invoices) and stage 3 (payment provider) are not built here.

## Context

ADR-060 gave sample workspaces plans, subscriptions and entitlements and refused every other workspace on purpose: "enabling billing for a real, non-synthetic workspace needs its own ADR, legal and provider review and an independent gate". The owner now runs real workspaces and asked for the whole of billing to be real, in three stages that move only when the official inputs exist:

| Stage | What it is                                                                                                                                         | Needs from the owner                                                                                                                   | Status    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1     | Real plans, subscriptions and entitlements. A record of which plan a real workspace holds and for which period. No invoice, no charge, no payment. | Nothing legal. The owner decides real plan names, prices and wording as staff, inside the product.                                     | This ADR  |
| 2     | Real invoices, with a legal number, tax lines and credit notes. Payments recorded by hand.                                                         | Billing entity name and address, tax rules per country, legal invoice number format, a named finance person for a second pair of eyes. | Not built |
| 3     | Payment provider.                                                                                                                                  | Provider choice and agreement, refund policy, legal review.                                                                            | Not built |

The contract keeps three rules that bound this stage: a billing processor is not a prerequisite for a lawful, manually invoiced managed service; fees, refunds and collections need contracting, provider integration and legal review; and built, tested, deployed, enabled and commercially live are different states. A real subscription row here means "the real workspace holds this plan record". It does not mean anyone was invoiced, charged or paid.

The vision keeps four money domains apart. A plan price is Corridra revenue (domain B). Nothing here reads or writes customer trade value, organiser participant fees or contributor obligations.

## Audit

Reused unchanged:

- The sample module of ADR-060 (tables, immutability triggers, entitlement keys, digest and showing rules, one-open-request and one-held-plan rules, lifecycle, event chain, idempotent customer and staff commands).
- The real-use scaffolding of ADR-056: `app.real_use_allowed`, `customer_private.synthetic_context`, `customer_private.real_session`, `customer_private.real_admission_open`, and `customer_private.organisation_profile_role`, which already returns the owner, admin or member role of a real workspace to a verified real session.
- The staff path used by paid-service requests: an owner or admin with a fresh authenticator check and a live session in an operator workspace. A real operator workspace uses the tenant's real processing purpose; a sample operator workspace uses the sample purpose, as before.
- The mission-mail control pattern (ADR for Phase 0): a control table that starts empty (closed), an offline schema-owner operation that opens or pauses it, and an install-job input.

Not touched: the invoicing module of ADR-061. It keeps calling the sample-only `billing_role` and `billing_staff_actor`, keeps its own sample-only table triggers and still serves sample workspaces only. A real workspace gets no invoice view and real staff reach no invoice function. A test holds this.

## Decision

New optional module `packages/db/customer-billing-real-migrations/0001_real_billing.sql`, registry `customer_billing_real_migrations.applied` (SHA-256, history-mismatch refusal, advisory lock), installed by `migrateCustomerBillingReal` after the billing and real-use modules. It creates objects, drops and re-adds four named table constraints that said "sample only", and replaces eleven functions. Every replaced function is guarded by the SHA-256 of its installed definition, the same pattern as the real-use migrations, so the install refuses if the base differs from what was reviewed.

- **Closed by default.** `customer_private.real_billing_control` is empty at install, so `real_billing_open()` is false. Only the offline schema-owner operation `configureRealBilling` (install job input `real_billing_action`: unchanged, install, enable, pause, with a reason) adds a row. It also needs real admission to be open. Pausing keeps every record.
- **Two catalogues, never mixed.** `billing_plan_version.synthetic` is true for sample plans and false for real plans. A sample plan must still say "sample" or "synthetic" in its title. A real plan is staff-written, must not claim to be a sample, and cannot use an `example-` key. A plan key belongs to one catalogue for ever. A real plan can only be written while the control is open. A workspace is only ever offered, and can only request, plans from the catalogue that matches the workspace, and the timeline guard refuses any mismatch.
- **No sample plans are seeded for real use.** The real catalogue starts empty. The owner or an authorised staff person writes real plans in the staff panel, with the name, price, currency, interval, tax treatment, what is in and out and every limit. The product states no price on the owner's behalf.
- **Notes.** Sample workspaces keep the invented-text rule ("Synthetic ..."), now applied by the timeline guard because the table cannot see the workspace. Real notes are plain text: no links or addresses, no control characters, up to 1000 characters. Internal staff notes are still never shown to the customer.
- **Customer functions** (`customer.billing_plans`, `billing_overview`, `billing_command`) use `customer_private.billing_workspace_role`, which serves a sample workspace to a sample session and a real workspace to a real session and never across. For a real workspace whose control is closed it raises SQLSTATE `55000` to its own members, which the route answers as 503 "Plans are not switched on for real workspaces yet". A person outside the workspace still learns nothing. The application then checks the second switch inside the transaction, so a refusal rolls back anything recorded (for example that a plan was shown).
- **Staff functions** use `customer_private.billing_staff_actor_scoped`: a sample operator workspace sees and changes sample subscriptions and plans; a real operator workspace sees and changes real ones, and only while the control is open. Lists, views and commands are scoped by the same context, so one cannot reach the other.
- **Events.** Same chain as ADR-060, ids and versions only, with `synthetic` now true or false by workspace. No text, amount or note appears in an event.
- **Entitlements stay a record.** Nothing reads them to restrict programmes, members or exports. The customer screen says so. Enforcement changes the behaviour of other modules and needs its own reviewed change.
- **Screens.** The customer plan page reads the answer's own flag: a real workspace is told "a record of the plan your workspace holds ... Nothing is charged ... Invoices are not issued from this page" and is never asked for sample invoices; a sample workspace keeps its sample wording. The staff panel shows "Customer plans" for real workspaces, drops the "start with Synthetic" prompts, and states that a real plan title must not say sample.

## Not included

Invoices, payment records, credit notes, refunds, tax calculation or numbering, currency conversion, proration, discounts and trials; any payment provider; outbound notices about plan changes; entitlement enforcement and usage measurement; a platform-wide staff team; linking a subscription to a programme ledger or to a paid-service order intent. Real invoicing is stage 2 and needs the inputs in the table above before any document is labelled an invoice.

## Limits the owner should know

- The plan price shown to a customer is a statement of intent by staff. Until stage 2, nothing collects it and nothing is invoiced. Staff must not describe a stage 1 subscription to a customer as billed.
- Any owner or admin of the real operator workspace with a fresh authenticator check can write plans and answer requests, and the position check keeps two people from overwriting each other. A named finance or billing role is a stage 2 decision.
- Terms of service, the contracting party, tax registration and invoice rules are legal work that stage 2 depends on. Nothing in this stage replaces them.

## Rollback

Pause the control with the install job (`real_billing_action` = pause), or unset `CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED`. Real plans, subscriptions and events stay and are readable to the database owner. Sample workspaces are unaffected either way.

## Required acceptance

Database and service tests (`customer-billing-real.test.ts`): install is repeatable and refuses a changed history; control starts closed and a closed control answers `55000` to members, nothing to outsiders, and records nothing; staff in a real operator workspace are refused while closed and cannot write a real plan; with the control open and the application switch off, calls are refused with 503 and the showing is rolled back; a real workspace reads only the real catalogue and cannot request a sample plan; real plan rules (no sample wording, no example key, one catalogue per key, immutable versions); the full lifecycle with exact money and no invoice rows; events carry no text or amounts; one open request and one held plan under concurrency; pausing keeps the record; the table refuses a real workspace holding a sample plan; invoicing is still unreachable for real workspaces and real staff; the runtime logins reach no table or private function. The whole sample billing suite runs again with this module installed and closed (`customer-billing-with-real-module.test.ts`) and passes unchanged apart from three message texts. Browser protocol tests: real wording, no sample invoices for a real workspace, a real request, the "switched off" state, and the staff panel in real mode.
