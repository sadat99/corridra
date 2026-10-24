# ADR-065: Simulated payment provider "Corridra Pay (madeup)" (billing stage 3)

Status: bounded implementation, default off, database control closed. Three things must all be on before a real owner or admin sees the flow: real invoices ([ADR-064](0064-real-invoices-payment-records-and-credit-notes.md)) switched on and open, `CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED=true`, and the database control opened by the owner-run install job. Nothing in this stage moves money.

## Context

The owner asked for billing stage 3 to use made-up information, each piece marked "(madeup)" in brackets. A real provider needs an account, credentials, a contract and a legal review that do not exist yet. This stage builds the whole customer and staff flow against a stand-in so it can be tried end to end and the real adapter can replace the stand-in later without changing the screens.

## Decision

An optional additive module, `customer_payments_simulated_migrations`, installed by the same owner-run job (`simulated_payments_action`: install, enable, pause, set_refund_window). It needs the real invoicing module.

- **The provider** is named "Corridra Pay (madeup)". It has no network access, holds no credentials and touches no card or bank. Every reference is `SIMPAY-` plus twelve hex characters and ends with " (madeup)"; the database refuses any other shape.
- **Attempts.** A real workspace owner or admin starts a checkout for one real invoice, for an amount from 1 minor unit up to what is still outstanding, in the invoice's currency. One live attempt per invoice at a time; a checkout lasts 30 minutes (the database allows at most an hour). Only the person who started it finishes it, as approved or declined, once.
- **Refunds (made-up policy).** Staff can record a made-up refund on an approved attempt, in part or in full, inside a made-up window of days (default 14, settable 1 to 90 by the owner job). The window in force is recorded with the outcome. Refunds follow in order and never exceed what the attempt paid.
- **Nothing real changes.** A simulated attempt or refund never writes to the real invoice ledger: payments, credit notes, balances and statuses are untouched, and the real ledger stays the only record of money received. Money here is Corridra service revenue only (domain B).
- **Append-only.** Every table rejects update and delete. Commands are idempotent by (person, command id); a different request under the same id conflicts. Events carry no amount or text.
- **Authority.** Customers: workspace owner or admin of a real workspace, through the customer functions. Staff: the same protected staff authority as real invoicing, in a real operator workspace, with a fresh authenticator check. A closed control answers 55000, shown to people as "not switched on".
- **Screens.** The billing page shows "Try the payment flow (madeup)" with a visible note that it is a simulation; an answer that does not say (madeup), claims money moves, or claims a payment was taken is refused by the screen. The staff workspace shows "Simulated payments (madeup)" with the made-up refund form. The privacy notice describes billing records, and the practice flow only while it exists.

## Not included

A real provider, any card or bank detail, webhooks, payouts, partial captures, disputes, and any effect on an invoice. A real adapter is a later decision: it would write real payments to the invoice ledger (ADR-064) and needs its own ADR, contract and review.

## Limits the owner should know

- Approving a simulated payment does not mark an invoice paid. If you want an invoice marked paid, the team records the real payment it received.
- The refund window and the refund policy are made up. Replace them with a real policy before a real provider is added.
- Pausing keeps every record. Unsetting the switch hides the screens.

## Rollback

Run the install job with `simulated_payments_action` = pause, or unset `CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED`. Records stay and are readable to the database owner. Real invoices and plans are unaffected.

## Required acceptance

`v3-simulated-payments-ui.spec.ts` (customer screen) and `v3-simulated-payments-staff-ui.spec.ts` (staff screen): the made-up notice and policy; a checkout sends one command and can be approved or declined; an uncertain save is retried as the same command; refunds and expired attempts keep their made-up labels; members see who can use it; switched off shows nothing; an answer without the made-up label, with money moving, a payment taken or the wrong workspace is refused; staff refund only where one is possible; axe clean.

`customer-payments-simulated.test.ts`: install is repeatable and refuses a changed history; the control starts closed and real invoicing closing closes it too; a closed control answers customers 55000 and staff 503, and the application switch is separate; an owner sees payable invoices, the provider and policy, a member sees nothing, an outsider learns nothing; a checkout takes a made-up reference, stays within what is outstanding, allows one live attempt, replays by command and conflicts on a different request; only the starter finishes it, once; a decline frees the invoice; the real ledger, balances and statuses never change; an expired checkout cannot be finished; staff see every attempt and refund inside the window and never above what was paid or on a declined attempt, plain text only; a refund after the window is refused and refunds replay by command; the window is a setting recorded with each outcome; sample and read-only staff roles and the runtime logins are refused and reach no table or private function; every table is append-only; events carry no amount or text.
