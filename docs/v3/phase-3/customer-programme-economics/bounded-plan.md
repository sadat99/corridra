# Organiser programme economics: bounded plan and acceptance record

**Document status: DONE.** Source built and present on main (checked 24 Oct 2026). Words such as "pending" or "once they exist" below are the wording of the day it was written. The capability stays PARTIAL for the whole product; use the requirement register for status. Not a to-do list. See the [plan status register](../../../PLAN_STATUS.md).

Governing decision: [ADR-046](../../../adr/0046-private-organiser-programme-economics.md). Contract sections: 2 (Product 3, Delegation OS), 6 (new capabilities), 8 (financial truth) and 9 (per-PR acceptance). Status of the whole capability: PARTIAL. Source and local evidence only until exact-head CI, merge and a gated deployment are recorded in the ledger.

## Changed requirement IDs

| Requirement                                                                                                                                                                    | Status after this work                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V3-06-007 (delegation pricing, costs and organiser economics)                                                                                                                  | PARTIAL: organiser-recorded ledger and per-currency figures exist. Capacity, satisfaction, outcome reporting, templates, bulk pricing, refunds and any real collection are not built |
| V3-02-047 (participant pricing, expected expenses), V3-02-055 (costs, payments, organiser economics), V3-02-067 to V3-02-070 (fees and status, expenses, service fees, margin) | PARTIAL: owner and admin bookkeeping only. Nothing is collected, held or verified                                                                                                    |
| V3-02-074 (accounting separation), V3-08-016, V3-08-018, V3-08-022 (financial truth)                                                                                           | PARTIAL: private ledger separate from the commercial and service ledgers, exact original-currency amounts, compensating corrections, no conversion                                   |
| V3-02-075 (fees, refunds, cancellations, collection need contracting, provider and legal review)                                                                               | NOT VERIFIED: nothing here activates a fee, refund, cancellation or collection, so the requirement is respected by absence and stays open                                            |

Not touched: V3-08-017 (customer trade value), V3-08-019 and V3-08-020 (Corridra revenue and delivery cost), V3-08-021 (contributor compensation).

## Existing versus new

Existing and unchanged: the programme planner at `/account/delegations/[workspaceId]`, participants, objectives, context, the commercial and service ledgers, `app.currency`, staff identity, RLS and every earlier migration. New: optional module `customer-programme-economics-migrations` (two private tables, one guard trigger, three restricted `customer.programme_*` functions), `/api/customer-programme-economics`, a collapsible finance panel on each programme in the planner, shared exact-money helpers reused from `@corridra/domain`.

## Original and destination paths

Every original planner action stays where it was. The finance panel is an extra button on each programme and appears only when the participants and economics flags are on.

## Server and domain contracts

Append-only entries (fee, payment, expense, obligation, Corridra service fee) with planned or actual basis for costs, bigint minor units, a currency from `app.currency`, a date, a Synthetic description and an optional registration. Compensating entries cancel exactly once. Only workspace owners and admins read or write, through the existing `participant_scope` management check. Totals and margins are computed in the database per currency and returned as strings.

## Tests

PostgreSQL integration (20): populated additive upgrade and repeat install, direct-SQL denial, owner and admin only, denial for members, participants, other programmes and workspaces, amounts above 2^53, per-currency totals, compensating-entry integrity, registration scope, planned versus actual, retries, conflicts, concurrent writers, event privacy, changed-account guard, input validation in both the schema and SQL. Component protocol (25): exact formatting, entry and correction payloads, retry with the identical command, conflict and changed-account handling, denial and unavailable states, scope and verification claims rejected, older entries, expiry, account change, keyboard and axe at 320, 390, 768 and 1440. Closed-gate browser spec for the API and planner.

## Responsive, accessibility and data preservation

Labelled fields, native selects and radio group, `role="alert"` for problems and `role="status"` for progress, tables with captions, no horizontal scroll at 320. A failed save keeps what was typed; details are cleared only when access ends. Nothing is stored in browser storage.

## Remaining gaps, blockers and flags

Default off behind `CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED` plus the workspace, programme and participant flags; synthetic only; hard-disabled on Vercel production. Not built: capacity and satisfaction reporting, consented outcomes, programme templates, bulk fee application, refunds, invoicing, tax, currency conversion, participant-visible statements, and any payment provider. D01 to D06 and D08 stay closed.

## Deployment and rollback

Additive schema installed explicitly before enabling any flag. Rollback is disabling the flag and redeploying the previous application; tables and entries are retained and never dropped.

## Exact result

PARTIAL. Source implemented and locally tested; exact-head CI and release evidence are recorded in the ledger once they exist.
