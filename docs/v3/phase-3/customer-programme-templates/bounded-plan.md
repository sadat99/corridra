# Repeatable programme templates: bounded plan and acceptance record

Governing decision: [ADR-048](../../../adr/0048-private-programme-templates.md). Contract sections: 2 (Product 3, Delegation OS), 6 (new capabilities) and 9 (per-PR acceptance). Status of the whole capability: PARTIAL. Source and local evidence only until exact-head CI, merge and a gated deployment are recorded in the ledger.

## Changed requirement IDs

| Requirement                                                                                        | Status after this work                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V3-06-010 (repeatable delegation templates and programmes)                                         | PARTIAL: write or capture a plan, version it, retire it and apply it to an empty programme or a new one. No series, recurrence, sharing across workspaces, public library or cloning of participants |
| V3-02-057 (scoped reporting, feedback and repeatable programme templates)                          | PARTIAL: the template half now exists alongside the coordination report (ADR-047)                                                                                                                    |
| V3-02-053 (assign responsibilities and coordination tasks), V3-02-047 (pricing, expected expenses) | PARTIAL: a template carries the task checklist, capacity and planned costs only. Participant fees are deliberately excluded because they belong to named registrations                               |

## Existing versus new

Existing and unchanged: the planner, programme creation, participants, objectives, context, coordination, economics, the commercial and service ledgers, staff identity, RLS and every earlier migration. New: optional module `customer-programme-templates-migrations` (four private tables, an integrity trigger, six restricted functions), `/api/customer-programme-templates`, and a "Repeatable programme templates" panel on the planner page.

## Original and destination paths

Every original planner action stays where it was. The panel is an extra section that appears only when the participants, coordination, economics and templates flags are on. Programmes are still created through the unchanged `/api/customer-programmes`.

## Server and domain contracts

Append-only template revisions with expected versions and retirement, an application record per programme, a command table for exact retries and one existing event chain per save and per application carrying identifiers, counts and the kind only. Content has exactly four parts and is validated in SQL as well as in the schema. Capture is read-only. Application is one transaction that refuses a programme with any task, capacity or ledger entry, a retired or stale template, or a second application, and writes through the same constraints as the modules it seeds.

## Tests

PostgreSQL integration (16): populated additive upgrade and repeat install, the combined gate, create, revise, stale rejection, retire and restore, content validation in schema and SQL (including that participant data, fees due, payments and actual costs cannot be stored), read-only capture that leaves out participants, cancelled tasks, corrected planned costs, actual costs, fees and payments, exact application counts and start-date arithmetic, undated application, refusals for non-empty, seeded, stale, retired, unknown and foreign templates, atomic rollback on a mid-way failure, the owner and admin denial matrix, retries and conflicts, concurrent applies seeding once, the 50-template limit, content-free events, database guards and immutability, direct-SQL denial and the changed-account guard. Component protocol (23): list, create with exact money conversion, edit, retire, capture, use for a new or existing programme, retry after a partial failure, refusals, denial and unavailable states, rejected responses, expiry, account change, keyboard and axe at 320, 390, 768 and 1440. Closed-gate browser spec for the API and planner.

## Responsive, accessibility and data preservation

Labelled fields, native selects, repeated fieldsets with a visible legend per task and cost, `role="alert"` and `role="status"`, no horizontal scroll at 320. A failed save keeps what was typed. Details are cleared only when access ends. Nothing is stored in browser storage.

## Remaining gaps, blockers and flags

Default off behind `CORRIDRA_CUSTOMER_PROGRAMME_TEMPLATES_ENABLED`, which also needs the participants, coordination and economics flags; synthetic only; production hard-disabled. Not built: cloning participants or fees, templates shared across workspaces, a public library, scheduling a series, recurrence and applying a template to a programme that already has work. If creating a programme succeeds and applying fails, the empty programme exists and the apply is retried with the same command. Not verified: usability with real users, the cloud module install and an isolated preview. D01 to D06 and D08 stay closed.

## Deployment and rollback

Additive schema installed explicitly, after the coordination and economics modules, before enabling any flag. Rollback is disabling the flag and redeploying the previous application; templates, applications and the records an application created are retained and never dropped.

## Exact result

PARTIAL. Source implemented and locally tested; exact-head CI and release evidence are recorded in the ledger once they exist.
