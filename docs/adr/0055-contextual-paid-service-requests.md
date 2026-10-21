# ADR-055: Contextual paid-service requests (quote versus order)

Status: bounded implementation, synthetic only, default off (`CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED`). V3-06-012 moves from MISSING to PARTIAL for the whole product. V3-06-013 (billing, entitlements, invoicing, subscriptions) stays MISSING and is not touched.

## Context

The contract lists paid local help ("approved local execution and follow-through", "contextual paid-service requests") as a revenue line and insists on two distinctions: quote versus order, and that a low quoted price must never conceal missing costs, a different scope, installation obligations, uncertain certification or incompatible payment and delivery terms. Nothing in the product let a customer ask for such help from the place they already work, and nothing let staff answer with a quote the customer could check item by item.

## Audit

What exists and is reused, unchanged:

- **Customer authority**: the proof-bound session boundary (`CustomerSessionBoundary`), `customer_private.lock_workspace_access`, and the role helper `customer_private.organisation_profile_role` that the member-roles module (ADR-051) keeps current. Owner and admin write, member reads, revoked, left and disabled access reads as no access.
- **Places a request can start from**: private requests (`owned_request`, ADR-033), delegation programmes (`programme_creation`, ADR-037) and approved companies (`customer.company_portfolio`, ADR-038).
- **Staff authority**: the protected staff path of customer delivery and decision disclosure (ADR-040 and ADR-039): `withTenant` with the existing `delivery.share` permission (owner or admin, fresh authenticator check) and the live-session lock that those SQL functions repeat. No staff role, permission or table is added or changed.
- **Event chain**: domain event, audit event and outbox rows, one chain per real change. Currencies: `app.currency` with exact integer minor units as strings.
- **Staff functionality that does not count**: the operations console holds internal cost, effort and revenue ledgers per mission. They are for Corridra's own accounting and say nothing a customer can request, read or accept, so they do not establish self-service.

What did not exist and is built here: a service catalogue, a customer request tied to its context, a quote with itemised components, a customer acceptance that is an order intent only, a status path with a plain timeline, and the customer and staff screens.

## Decision

New optional module `packages/db/customer-service-request-migrations/0001_contextual_service_requests.sql`, registry `customer_service_request_migrations.applied` (SHA-256, history-mismatch refusal, advisory lock), installed by `migrateCustomerServiceRequests` after member roles, programmes and companies. It adds only new objects; no existing function, table, policy, grant or row changes.

- **Catalogue.** `service_catalogue_version`, one immutable row per version: key, plain title, summary, what is included, what is explicitly excluded, delivery regions, quote basis, active flag, `synthetic` fixed to true. Four invented services are seeded by the migration (local meeting arrangement, interpreter day, site visit coordination, supplier sample check). Staff revise or retire an entry by adding a version; customers read the latest active version and nothing else. A request records the exact version it was made against.
- **Contextual request.** An owner or admin picks a catalogue service from a request, a programme or a company and describes the need, preferred dates and region. The database checks that the place is theirs (programme in this workspace, private request they sent, company in their own portfolio) and that the region is one the service offers. Free text must begin with `Synthetic `. There is one open request per (workspace, place, service), enforced under an advisory lock so concurrent attempts produce one winner. Editing the need is possible only before a quote exists and is version-checked.
- **Idempotent and version-checked.** Customer commands are keyed by (customer, command id); staff commands by (staff person, command id). An exact retry returns the original answer; the same id with other content conflicts; stale versions and a stale timeline position are refused.
- **Quote versus order, never conflated.** A quote is itemised components in one currency as exact integer minor units: service fee, local cost, pass-through cost and tax, each marked included, estimate or not included. Tax must be stated; a tax line left out is shown as "Not included". A quote also carries scope, at least one exclusion, at least one assumption, delivery terms, payment terms (described only) and a validity time of at most 90 days. The table itself rejects a quote without exclusions or assumptions, a deferred constraint rejects an incomplete quote at commit, and the timeline guard re-checks the quote on quoting and on acceptance.
- **Seeing before accepting.** The customer detail view returns the whole quote and records, per person and quote version, that it was shown (with its fingerprint). Acceptance must name the exact quote version and the fingerprint of what was shown, carry an explicit acknowledgement, and come from someone the quote was shown to. A changed or replaced quote therefore cannot be accepted by an old page.
- **Acceptance is an order intent only.** `service_order_intent` stores the exact quote version, currency and the computed fixed and estimated totals, with `payment_taken` fixed to false and `billing` fixed to `billing_not_enabled`. Nothing is charged; there is no payment, invoice, refund or subscription object in the module.
- **Status path.** requested, quoted, accepted or declined or expired, in progress, delivered, closed (plus withdrawn before a quote). Every transition is an appended timeline row checked by a database guard (order, allowed move, quote and order rules, handling team); rows cannot be updated or deleted. Expiry is written once, the first time anyone looks after the validity time, and lists already read a lapsed quote as expired. Staff move a request on with a customer-visible note; internal staff notes are separate rows the customer functions never select.
- **Staff side.** Staff (owner or admin of an operator workspace, fresh authenticator check, live session) see requests nobody holds yet and their own, prepare and replace quotes, answer questions, start, update, deliver and close, and keep internal notes. The first staff workspace to act holds the request; another workspace is refused. Every staff change needs the current timeline position.
- **Events.** One domain event, audit event and outbox row per real change, carrying ids and versions only (request, sequence, status, quote version): never text, amounts or notes. Customer changes are attributed to the service executor with the customer as initiator; staff changes to the staff person; expiry to the executor as a system change.
- **UI.** Customer: a "Request help with this" link in programmes, private requests and the company portfolio; a help-requests list per workspace; a request page with the need, an itemised quote table, everything left out, assumptions, terms, accept, decline, ask a question, withdraw, the order intent and a plain timeline. Staff: a panel in the operator delivery section with the queue, a quote form, a progress form, internal notes and the catalogue editor. Both show calm empty, denied, stale and unavailable states and keep typed text when a page goes out of date.

## Not included

Payments, invoices, subscriptions, entitlements, refunds and any billing state; currency conversion; outbound email, SMS or other notices (the customer sees changes when they look); file attachments; real vendors, real prices or real people; staff assignment to a named person; a platform-wide staff team (see below); reopening a declined or closed request (the customer starts a new one).

## Limits the owner should know

- There is no platform-wide "Corridra staff" workspace in the product. Any synthetic operator workspace whose owner or admin has a fresh authenticator check can maintain the catalogue and take a request; the first to act holds it. A named staff team is a later decision, and a billing launch needs one.
- A private request belongs to the person who sent it, so only that person can ask for help about it; an admin teammate cannot. A request's help requests are visible to the workspace, with only the request's date as its label.
- Real-user ease of the screens, the wording and the quote layout are unproven until real users try them.

## Rollback

Unset the flag. Tables and history are kept. Existing requests, quotes and order intents stay readable to the database owner and are not deleted.

## Required acceptance

Database tests: install on a populated database adds only new objects; restricted logins reach nine intended functions and no table; catalogue read and expired proof; owner, admin, member, outsider, forged workspace, revoked, left and disabled access; context ownership for all three kinds; synthetic-only text; one open request per place and service under concurrency; replay and conflict for customer and staff; stale versions; quote completeness in the table, at commit and at acceptance; view-before-accept and fingerprint checks; order intent that cannot hold a payment; allowed and refused transitions; expiry and requote; one handling team; hidden internal notes; privacy of events; immutability of every history table; catalogue versions; repeatable installer with history-mismatch refusal. Browser protocol tests: confirmation before acceptance, exact request shapes, itemised quote, stale, denied and unavailable states, same-command retry, absence of controls for a member and when off, and accessibility.
