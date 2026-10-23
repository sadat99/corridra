# ADR-061: Sample invoices, payment records and credit notes (billing slice 2)

Status: bounded implementation, synthetic only, default off (`CORRIDRA_CUSTOMER_INVOICING_ENABLED`, which also needs `CORRIDRA_CUSTOMER_BILLING_ENABLED`). V3-06-013 stays PARTIAL. This builds on [ADR-060](0060-synthetic-plans-subscriptions-and-entitlements.md), which named invoices, payment observations and credit notes as the next slice. No payment processor is involved and no money moves.

## Context

ADR-060 gives a sample workspace a plan and explicit subscription periods. A subscription is a record, not a contract, and ADR-060 says that tax registration, a contracting party and invoice numbering rules are legal work that must be settled before invoicing is activated for anyone real. The contract also says to keep an invoice distinct from a confirmed payment, and Corridra's own revenue distinct from every other money domain. Slice 2 therefore adds the three records a manually invoiced service needs, in the same sample-only frame, so that the model can be reviewed and used in rehearsal without anyone being billed.

Rules that decide the shape:

- **An invoice is not a payment.** An invoice says what is asked for a period. A payment observation says that the Corridra team recorded money as received. A credit note reduces what is still unpaid. Three tables, three kinds of fact, none rewrites another. The status of an invoice is read from them, never stored.
- **Four money domains stay separate.** An invoice here is Corridra service revenue (domain B). It never reads or writes customer trade value (A), an organiser's participant fees and costs (the programme ledger of ADR-046 and ADR-054) or contributor obligations (D). The tables have no reference to any of those ledgers, a test lists the references to prove it, and each invoice carries its money domain as a fixed value.
- **Exact amounts, original currency, no conversion.** Whole minor units in the currency of the plan, as digits. Totals are per currency and never added across currencies.
- **History is immutable.** A mistake is corrected by a credit note, not an edit. Nothing is deleted.
- **Honest labels.** Every invoice says it is a sample record and not a tax invoice. Numbers are `SAMPLE-INV-000001` and `SAMPLE-CN-000001`, so none can be mistaken for a legal sequence.

## Audit

Reused unchanged: the customer role helper and the staff authority of ADR-060 (an owner or admin of a synthetic operator workspace with a fresh authenticator check, read from the live session), the event chain (domain event, audit event, outbox), `app.currency`, and the subscription periods that staff activate and renew. No staff role, permission or table is changed. Functionality that does not count: the operations console holds internal revenue ledgers per mission; they are for Corridra's own accounting and say nothing a customer can read.

New and built here: an invoice per subscription period, payment observations, credit notes, a customer read of invoices and per-currency balances, staff screens to issue and record, a switch of its own.

## Decision

New optional module `packages/db/customer-invoicing-migrations/0001_sample_invoices_payments_credits.sql`, registry `customer_invoicing_migrations.applied` (SHA-256, history-mismatch refusal, advisory lock), installed by `migrateCustomerInvoicing` after the billing module. It adds only new objects.

- **Invoice.** One immutable row per (subscription, period). The period must be one that staff activated or renewed. The plan fee must equal the price of the exact plan version the subscription holds, in that plan's currency; a free plan cannot be invoiced. Tax is stated in one of three ways that follow the plan: price excludes tax (staff add a tax amount, which may be zero, and it is added to the total), price includes tax (staff state the tax inside the price, informational), tax to be confirmed (stated as not stated, with no amount). The total is the plan fee plus added tax and the table checks it. The due date is within 90 days of the issue date. One invoice per period, so a period cannot be invoiced twice.
- **Payment observation.** An append-only row: amount, the date it was received, a method (bank transfer, cash or other) and a short reference that must begin with `Synthetic `. The amount cannot exceed what is still outstanding, the date cannot be in the future or before the invoice date, and a staff command names the position it saw so two people cannot record the same money twice. Corridra does not collect anything; this records what a person says was received.
- **Credit note.** An append-only row with a reason that begins with `Synthetic `. A credit cannot exceed what is still unpaid, so a fully paid invoice cannot be credited. Refunds are not built; a refund needs a payment provider and legal review.
- **Status, derived.** Unpaid, partly paid, paid, credited (nothing paid, everything credited) or settled (paid and credited). Overdue is shown when something is unpaid after the due date. All amounts shown are exact strings; balances are per currency.
- **Customers read, staff write.** Owners and admins of a sample workspace read their invoices and per-currency outstanding balances. Members see that invoices exist for owners and admins and nothing else. There is no customer command: a customer cannot pay, dispute or edit anything here.
- **Staff.** The same protected staff authority as ADR-060: list the periods that still need an invoice, issue one, list and open invoices, record a payment, issue a credit note. Every change is idempotent by (staff person, command id) and, after the first, position-checked.
- **Sample only, three ways.** Every function refuses a workspace that is not a sample workspace, a table guard repeats it, and every free-text field must begin with `Synthetic `.
- **Events.** One domain event, audit event and outbox row per change, with ids, the sample number and a sequence only: never an amount, a date, a reference or a reason.
- **Switch.** `CORRIDRA_CUSTOMER_INVOICING_ENABLED` is separate from the billing switch so that plans can be shown without invoices. It is in the owner switch registry and the founder module list.

## Not included

A payment processor, card or bank details, collecting or refunding money, tax calculation, a tax registration number, a legal numbering sequence, a PDF or email of an invoice, reminders, currency conversion, proration, discounts, usage charges, invoicing a free plan, invoicing anything but a plan period, linking an invoice to a paid-service order, to an organiser's programme ledger or to a customer's trade value, and any enabling for a real workspace. Enforcement of plan limits is still absent.

## Limits the owner should know

- This is a rehearsal of the records. A real launch needs a contracting party, tax rules for each country, a legal numbering sequence, payment provider agreements and a named staff team, none of which exist.
- Any synthetic operator workspace owner or admin with a fresh authenticator check can issue and record. The position check stops overwrites; it is not a four-eyes control.
- A payment observation is the team's statement, not a bank confirmation.
- Real-user ease of the screens is unproven.

## Rollback

Unset the switch. Tables and history are kept. Issued invoices stay readable to the database owner and are not deleted.

## Required acceptance

Database tests: install on a populated database adds only new objects, repeatable with history-mismatch refusal, and needs only the billing module; the restricted logins reach five intended functions and no table; issue for each tax treatment with exact totals, sequential numbers, concurrency (one winner per period, unique numbers across periods); refusals for an unknown period, a free plan, a wrong tax shape, a bad due date, a repeated period and a workspace that is not a sample; payments and credits that cannot exceed what is outstanding, future or early dates, stale positions, concurrent payments; derived status for every state; customer visibility for owner, admin, member, outsider, forged workspace, revoked, left and disabled; per-currency balances with no conversion; immutability of every table; direct SQL cannot write a wrong total, a wrong fee, an over-payment or an over-credit; the tables reference no other money ledger; events carry no amounts or text; a real workspace is refused with real use installed. Browser protocol tests: exact request shapes, same command id on retry, stale, denied and off states, member message, empty state, keyboard and accessibility at four widths.
