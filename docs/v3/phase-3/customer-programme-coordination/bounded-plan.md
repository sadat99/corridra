# Programme coordination and reporting: bounded plan and acceptance record

**Document status: DONE.** Source built and present on main (checked 24 Oct 2026). Words such as "pending" or "once they exist" below are the wording of the day it was written. The capability stays PARTIAL for the whole product; use the requirement register for status. Not a to-do list. See the [plan status register](../../../PLAN_STATUS.md).

Governing decision: [ADR-047](../../../adr/0047-private-programme-coordination-and-reporting.md). Contract sections: 2 (Product 3, Delegation OS), 6 (new capabilities) and 9 (per-PR acceptance). Status of the whole capability: PARTIAL. Source and local evidence only until exact-head CI, merge and a gated deployment are recorded in the ledger.

## Changed requirement IDs

| Requirement                                                                                                                         | Status after this work                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V3-02-053 (assign responsibilities, local support and coordination tasks)                                                           | PARTIAL: a task board with free-text assignee labels. No user-linked assignment, reminders or participant-visible tasks                                                         |
| V3-02-056 (track participant activity, consented outcomes and overall programme results)                                            | PARTIAL: organiser-recorded attendance and participant-reported, consented outcomes and feedback                                                                                |
| V3-02-057 (scoped reporting, feedback; repeatable templates)                                                                        | PARTIAL: scoped report and feedback exist. Templates are the next packet (ADR-048)                                                                                              |
| V3-02-071 (capacity, attendance and participant satisfaction), V3-02-073 (repeat business and programme performance)                | PARTIAL: capacity plan against active participants, attendance counts, shared satisfaction ratings, returning-participant count. No revenue-based repeat business or benchmarks |
| V3-02-072 (qualified meetings and documented business outcomes)                                                                     | PARTIAL: participant-reported outcomes only. Qualified meetings from the commercial engine are not connected and nothing is verified                                            |
| V3-02-062 (participants retain privacy and control), V3-02-063 (organisers see permitted information, not private offers or values) | PARTIAL: records are the participant's own, shared only by choice, revisable and withdrawable, with no money field. Broader participant controls are unchanged                  |
| V3-02-054 (participant communications, schedules and changes)                                                                       | NOT VERIFIED and not built: outreach is gated, and the screen says so                                                                                                           |

## Existing versus new

Existing and unchanged: the planner, participants, objectives, context, economics, the commercial and service ledgers, staff identity, RLS and every earlier migration. New: optional module `customer-programme-coordination-migrations` (seven private tables, integrity triggers, seven restricted `customer.*` functions), `/api/customer-programme-coordination`, a "Coordinate and report" panel on each programme in the planner, and a "Share feedback and results" panel on each active registration in the participant account.

## Original and destination paths

Every original planner and participant action stays where it was. Both new panels are extra buttons that appear only when the participants and coordination flags are on.

## Server and domain contracts

Append-only task, capacity, attendance and participant-record revisions with expected-version or last-state semantics, a command table for exact retries, and one existing event chain per write that carries identifiers and the kind only. The organiser report is one read computed in the database. Participant writes require ownership of an active registration. Records of withdrawn or removed participants leave the report.

## Tests

PostgreSQL integration (19): populated additive upgrade and repeat install, the gate, empty report, task create and revise with stale rejection, input validation in schema and SQL, the 200-task limit, capacity versions, attendance rules and idempotence, participant-only writes with denial for the organiser and everyone else, consent and retraction behaviour in the report, withdrawn participants, overdue counts, the organiser denial matrix, retries and conflicts and serialised writers, content-free events, database guards and immutability, direct-SQL denial, and the changed-account guard. Component protocol: organiser panel 21 and participant panel 20, covering exact payloads, retries with the identical command, stale and changed-account handling, denial and unavailable states, rejected responses, paging, expiry, account change, keyboard and axe at 320, 390, 768 and 1440. Closed-gate browser spec for the API and both pages.

## Responsive, accessibility and data preservation

Labelled fields, native selects, radio groups and checkboxes, tables with captions, `role="alert"` and `role="status"`, no horizontal scroll at 320. A failed save keeps what was typed. Details are cleared only when access ends. Nothing is stored in browser storage.

## Remaining gaps, blockers and flags

Default off behind `CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED` plus the workspace, programme and participant flags; synthetic only; production hard-disabled. Not built: participant messaging, schedules and change notices, user-linked assignment, reminders, qualified meetings from the commercial engine, verified outcomes, exports and cross-programme benchmarks. Not verified: usability with real users, the cloud module install and an isolated preview. D01 to D06 and D08 stay closed.

## Deployment and rollback

Additive schema installed explicitly before enabling any flag. Rollback is disabling the flag and redeploying the previous application; tables and records are retained and never dropped.

## Exact result

PARTIAL. Source implemented and locally tested; exact-head CI and release evidence are recorded in the ledger once they exist.
