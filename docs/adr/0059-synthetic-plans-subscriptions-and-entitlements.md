# ADR-059: Synthetic plans, subscriptions and entitlements (billing slice 1)

Status: bounded implementation, synthetic only, default off (`CORRIDRA_CUSTOMER_BILLING_ENABLED`). V3-06-013 (billing, entitlements, invoicing, subscriptions) moves from MISSING to PARTIAL for the whole product. Invoices, payment observations and credit notes are slice 2 and are not built here. No payment processor is involved.

## Context

The contract lists billing, entitlements, invoicing and subscriptions as a P1 capability "before subscription launch", and says in the same section that a billing processor must not be a prerequisite for a lawful, manually invoiced managed service. The first slice therefore gives a customer workspace a real, auditable answer to three questions without moving any money: which plan is on offer and exactly what does it say, which plan does my workspace hold and for which period, and what does that plan include.

Four rules from the contract and the vision decide the shape:

- **Four money domains stay separate.** A plan price is Corridra revenue (domain B). It is never customer trade value (A), never an organiser's participant fee (the programme ledger of ADR-046 and ADR-054) and never a contributor obligation (D). Nothing in this module reads or writes those ledgers.
- **Built, tested, deployed, enabled and commercially live are different states.** A subscription row here means "the synthetic workspace holds this plan record". It does not mean anyone paid or was charged.
- **A low price must never conceal what is missing.** A plan states its tax treatment, what it includes and what it leaves out, and a customer sees the whole plan before asking for it.
- **History is immutable.** Plans, requests and every status change are appended; nothing is edited. A correction is a new row.

## Audit

What exists and is reused, unchanged:

- **Customer authority**: `CustomerSessionBoundary`, `customer_private.lock_workspace_access` and the role helper `customer_private.organisation_profile_role` that the member-roles module (ADR-051) keeps current. Owner and admin write, member reads, revoked, left and disabled access reads as no access.
- **Staff authority**: the protected staff path used by customer delivery and paid-service requests (ADR-040, ADR-055): `withTenant` with the existing `delivery.share` permission (owner or admin of a synthetic operator workspace, fresh authenticator check) and the live-session lock that the SQL functions repeat. No staff role, permission or table is added or changed. The check is copied into a billing function so this module does not require the paid-service module to be installed.
- **Event chain**: domain event, audit event and outbox rows, one chain per real change. Currencies: `app.currency` with exact integer minor units.
- **Functionality that does not count**: the operations console holds internal revenue and cost ledgers per mission and the programme ledger holds organiser fees. They say nothing a customer can read or ask for, so they do not establish self-service billing.

What did not exist and is built here: a plan catalogue with versions, entitlement definitions per plan version, a customer request for a plan that records what was shown, a staff-controlled subscription lifecycle with explicit periods, an entitlement read for the held plan, and the customer and staff screens (the screens are a later change to this branch).

## Decision

New optional module `packages/db/customer-billing-migrations/0001_plans_subscriptions_entitlements.sql`, registry `customer_billing_migrations.applied` (SHA-256, history-mismatch refusal, advisory lock), installed by `migrateCustomerBilling` after member roles. It adds only new objects; no existing function, table, policy, grant or row changes.

- **Plan catalogue.** `billing_plan_version`, one immutable row per version: key, plain title and summary, billing interval (month or year), exact price in integer minor units and one currency from `app.currency`, tax treatment, what is included, what is explicitly excluded, an active flag, `synthetic` fixed to true. Tax treatment is one of "price excludes tax", "price includes tax" or "tax to be confirmed"; a plan cannot leave it unstated. Staff revise or retire a plan by adding a version. Three invented example plans are seeded; their titles end in "(sample plan)", and the table requires a plan title to say "sample" or "synthetic", so customer screens can say "sample" as UI direction requires. They are not offers.
- **Entitlements.** `billing_entitlement_key` is a closed reference list of five things the product already does: people in a workspace, active programmes, participants per programme, open help requests, and programme report exports. Each plan version holds exactly one row per key (the table enforces the key's unit: a count has a limit or is unlimited, a flag is included or excluded; a deferred constraint rejects a plan version that does not cover every key). Entitlements are a record of what the plan grants. **They are not enforced by this change**: no existing module reads them, so holding a plan restricts nothing and not holding one restricts nothing. The customer screen says so in plain words. Enforcement would change the behaviour of programmes, members and exports and needs its own reviewed change.
- **Seeing before asking.** Reading the plans as an owner or admin records, per person and plan version, that the whole plan was shown (with its fingerprint). A request must name the exact plan version and the fingerprint of what was shown and carry an explicit acknowledgement, so a changed or replaced plan cannot be requested from an old page.
- **Subscription lifecycle, manual by design.** A customer request creates a subscription in `requested`. Staff activate it for an explicit period, decline it with a reason, or leave it. Active periods are explicit dates: the end is the start plus one month or one year. Staff renew by starting the next period on the day the previous one ends, and only within 31 days of that day, so a period is never booked far ahead. The customer can withdraw a request, and can schedule cancellation at the end of the current period and take it back before then. When a scheduled cancellation reaches its end date the next read writes the `ended` entry once, attributed to the system; staff can also end a subscription with a reason. Nothing runs on a timer. A period that is not renewed is shown as "period ended" and grants nothing.
- **One plan at a time.** A workspace has at most one open request and at most one subscription that is active or scheduled to cancel. Asking for another plan while one is held is a change request; activating it ends the held one in the same transaction with the reason "replaced". Asking for the plan already held is refused. Concurrent attempts produce one winner under an advisory lock.
- **Synthetic only, twice over.** Every customer and staff function refuses a workspace that is not synthetic. Staff notes and customer-visible notes must begin with `Synthetic `. There is no payment, invoice, card, tax number or contact detail in this module and none can be stored.
- **Idempotent and version-checked.** Customer commands are keyed by (customer, command id); staff commands by (staff person, command id). An exact retry returns the original answer; the same id with other content conflicts; staff commands carry the position they saw and stale positions are refused.
- **Events.** One domain event, audit event and outbox row per real change, carrying ids and versions only (subscription, sequence, status, plan key, plan version): never text, amounts or notes. Customer changes are attributed to the customer-service executor with the customer as initiator; staff changes to the staff person; automatic ending to the executor as a system change.
- **Customer functions** (`customer.*`, granted to the restricted runtime login): plans, overview, command. **Staff functions** (`app.*`): subscription list, view, command, plan list and plan command. The restricted logins reach these eight functions and no table.

## Not included

Invoices, payment observations, credit notes, refunds, tax calculation or numbering, currency conversion, proration, discounts and trials; any payment processor; outbound email or other notices (the customer sees changes when they look); entitlement enforcement and usage measurement; a platform-wide staff team (see below); enabling billing for a real, non-synthetic workspace (that needs its own ADR, legal and provider review and an independent gate); linking a subscription to an organiser's programme ledger or to a paid-service order intent.

## Limits the owner should know

- There is no platform-wide "Corridra staff" workspace in the product. Any synthetic operator workspace whose owner or admin has a fresh authenticator check can maintain plans and answer requests, and the position check keeps two people from overwriting each other. A named staff team is a later decision, and a launch needs one.
- The seeded plans are invented examples with invented prices. They are not a price list and no price is validated. Real prices need customer research and an owner decision, in the currencies and tiers that fit each market.
- A subscription here is a record, not a contract. Terms of service, a contracting party, tax registration and invoice numbering rules are legal work that must be settled before slice 2 is activated for anyone real.
- Real-user ease of the screens and wording is unproven until real users try them.

## Rollback

Unset the flag. Tables and history are kept. Existing plans, subscriptions and events stay readable to the database owner and are not deleted.

## Required acceptance

Database tests: install on a populated database adds only new objects and is repeatable, with history-mismatch refusal; restricted logins reach eight intended functions and no table; plan catalogue reads show only the latest active versions; owner, admin, member, outsider, forged workspace, revoked, left, disabled and non-synthetic workspace access; request needs the shown plan, the matching fingerprint and the acknowledgement; one open request and one held plan under concurrency; replay and conflict for customer and staff; stale positions; allowed and refused transitions for every status; period rules for activation and renewal; scheduled cancellation, withdrawal of it and automatic ending once; change of plan ends the held one; plan versions are complete, immutable and the entitlements honour units; staff text must be synthetic; events carry no text or amounts; immutability of every history table. Browser protocol tests (with the screens): confirmation before requesting, exact request shapes, stale, denied and unavailable states, same-command retry, absence of controls for a member and when off, the plain statement that entitlements are not enforced, and accessibility.
