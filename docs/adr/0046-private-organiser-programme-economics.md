# ADR-046: Private organiser programme economics

Status: bounded implementation. V3-06-007 stays PARTIAL for the whole product. This decision records money the organiser says they charge or spend. It does not collect, hold, move or verify any money.

The V3 contract requires an organiser to understand participant fees and payment status, their own expenses and obligations, Corridra service fees, and contribution margin per programme (V3-02-047, 055, 067 to 070). It also requires strict accounting separation (V3-02-074, V3-08-016 to 022): organiser revenue is not Corridra revenue, participant trade values are not organiser revenue, and contributor obligations and supplier payments are not automatically Corridra expenses. Fees, refunds, cancellations and payment collection need contracting, a payment provider and legal review before activation (V3-02-075). None of those exists, so this module is a private bookkeeping record, labelled as such.

## Decision

Add an optional additive module installed by `migrateCustomerProgrammeEconomics`. It first installs everything the programme participants module needs, then one table family in `customer_private` and three restricted functions in `customer`.

- **Append-only ledger per programme.** An entry has a kind, an exact whole-unit amount (`bigint`, 1 to 999999999999999999), a currency from the existing `app.currency` table, a date, a free-text description and, for participant entries, the registration it concerns. Entries are numbered in order within a programme. Nothing is edited or deleted. A mistake is corrected by a compensating entry of the same kind, currency and registration with exactly the negated amount, at most once per original, following the existing commercial-record rule.
- **Kinds.** `PARTICIPANT_FEE` (fee due), `PARTICIPANT_PAYMENT` (a receipt the organiser recorded), `ORGANISER_EXPENSE`, `ORGANISER_OBLIGATION` (owed, for example to a supplier or contributor) and `CORRIDRA_SERVICE_FEE` (a fee the organiser owes Corridra under their own agreement). Cost kinds are `PLANNED` or `ACTUAL` so expected expenses and incurred expenses are never mixed.
- **Separation.** The service-fee kind records what the organiser owes. It never writes to Corridra's own service ledger, so Corridra revenue is untouched. Participants' trade values are not recorded here at all. Obligations and supplier payments are the organiser's costs and are never routed to Corridra.
- **Exact money.** Amounts and totals are returned as decimal strings so a value above 2^53 can never lose a digit in the browser. Totals are per currency and nothing is ever summed across currencies. No conversion is performed, so there is no rate or rounding method to disclose.
- **Derived figures, defined in plain words.** Per currency: fees due, payments recorded, outstanding (due minus recorded), planned costs, actual costs, margin if costs are as planned (fees due minus planned costs), margin on actual costs (fees due minus actual costs) and cash margin (payments recorded minus actual costs). Per participant and currency: due, recorded and a status of no fee, unpaid, part paid, paid or overpaid.
- **Provenance.** Every entry is marked `ORGANISER_RECORDED` and unverified. The screen says payment status reflects what the organiser entered, not a confirmed payment, and that no payment is collected or held by Corridra.
- **Authority.** Only workspace owners and admins of the programme's workspace read or write, using the existing `participant_scope` management check, which also locks workspace access and confirms the service executor. A participant, a plain member and any other workspace see nothing. Staff identity, RLS and the globally readable catalogue are untouched.
- **Retries and concurrency.** Each command carries an id. An exact retry returns the original entry, a changed payload under the same id is rejected, and entry numbers are allocated under a per-programme lock so writers cannot collide.
- **Events.** One existing event, audit and outbox chain per entry, carrying identifiers and the kind only, never an amount or description.

## Synthetic-only boundary

Descriptions must begin with `Synthetic `. The route is off unless the workspace, programme and participant flags and `CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED` are set, the environment is synthetic and Vercel production is not the target. No real money, payment provider, invoice or payout is involved. D01 to D06 and D08 stay closed.

## Blast radius and rollback

New objects only. Core tables, `app.currency`, the commercial and service ledgers, staff identity, RLS policies and every earlier customer module are unchanged, and the installer is verified to leave existing functions, policies and registries identical. Rollback is disabling the flag and redeploying the previous application. The additive schema and any entries are retained and never dropped.

## Not included

Capacity, participant satisfaction and consented outcome reporting (V3-02-071 to 073), repeatable programme templates, bulk fee application, refunds or cancellations as business flows, invoicing, tax, currency conversion, and any real payment or provider. These stay PARTIAL or MISSING and are named as such in the interface.

## Required acceptance

Populated additive upgrade and repeat install, direct SQL denial for runtime and auth roles, owner and admin only access with denial for members, participants, other programmes and other workspaces, exact-amount handling above 2^53, per-currency totals with no cross-currency sum, compensating-entry integrity (wrong kind, currency, amount, registration, double reversal, reversing a reversal), registration scope, planned versus actual costs, retries and conflicts, concurrent writers, event privacy, changed-account guard, private headers, keyboard and axe at three widths, and the full original suites on the exact merged head.
