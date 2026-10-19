# ADR-047: Private programme coordination and reporting

Status: bounded implementation. V3-02-071 to 073 stay PARTIAL. This decision gives an organiser a place to run a delegation and see how it went. It sends no message, moves no money and verifies nothing.

The V3 contract asks the organiser journey to cover assigning responsibilities and coordination tasks (step 9), tracking participant activity, consented outcomes and overall programme results (step 12), and scoped reporting and feedback (step 13). It also says organisers see programme activity and expressly permitted commercial information, not automatic access to private offers, contacts, contract values or negotiations, and that participants keep appropriate privacy and control. Participant communications (step 10) involve outreach, which the closed gates forbid, so they are not built here.

## Decision

Add an optional additive module installed by `migrateCustomerProgrammeCoordination`. It first installs everything the programme participants module needs, then one table family in `customer_private` and restricted functions in `customer`.

- **Task board.** A task has a Synthetic title, optional detail, a status (open, in progress, done, cancelled), an optional due date and an optional free-text assignee label for a person who may not have an account, such as a local guide. Tasks are append-only revisions with an expected version, so two organisers cannot silently overwrite each other. At most 200 tasks per programme.
- **Capacity.** A versioned capacity target with a reason. Capacity is a plan, not a gate: registration is unchanged and the report shows when active participants exceed it.
- **Attendance.** The organiser records attended or absent for an active registration, as append-only revisions. A withdrawn or removed registration cannot be marked.
- **Participant feedback and outcomes.** Only the participant who owns an active registration writes them. Feedback is one satisfaction rating from 1 to 5 with an optional comment. An outcome is one of a fixed list (meeting held, follow-up agreed, sample or quote requested, preliminary agreement, no progress), a date and an optional note. There is no money field. Each record carries the participant's own choice to share it with the organiser. Changes are new revisions, and a participant can withdraw consent or retract a record at any time. The organiser sees only the latest revision that is shared and not retracted. Comments are shown without a name. Outcomes are shown with the participant label because the participant chose to share them.
- **Scoped report.** One organiser-only read returns plan versus actual: active participants against capacity, attendance, task counts including overdue, the rating distribution, shared outcomes by kind, how many records were not shared, and returning participants (active registrants who also registered in another programme of the same workspace, as a count). Each figure says who reported it. Nothing is verified and no commercial value is shown.
- **Provenance.** Tasks, capacity and attendance are `ORGANISER_RECORDED`. Feedback and outcomes are `PARTICIPANT_REPORTED`. The screen says qualified meetings and documented outcomes are as reported by participants and are not confirmed by Corridra staff.
- **Authority.** Organiser functions use the existing participant management check (workspace owner or admin, programme in the workspace, service executor available). Participant functions require the signed-in account to own an active registration. A plain workspace member sees nothing here. Staff identity, RLS and the global catalogue are untouched.
- **Retries and concurrency.** Each command carries an id. An exact retry returns the original result, a changed payload under the same id is rejected, and writers on one programme are serialised by a lock. Revision numbers are checked in the database as well as in the function.
- **Events.** One existing event, audit and outbox chain per write, carrying identifiers and the kind only. Titles, notes, ratings and outcomes never enter events.

## Synthetic-only boundary

Free text must begin with `Synthetic `. The route is off unless the workspace, programme and participant flags and `CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED` are set, the environment is synthetic and Vercel production is not the target. D01 to D06 and D08 stay closed.

## Blast radius and rollback

New objects only. Core tables, the participants and economics modules, staff identity and RLS are unchanged, and the installer is verified to leave existing functions, policies and registries identical. Rollback is disabling the flag and redeploying the previous application. The additive schema and its records are retained and never dropped.

## Not included

Participant messaging, schedules and change notices (outreach is gated), user-linked task assignment, reminders, participant-visible task lists, qualified meetings from the commercial engine, verified outcomes, repeat revenue, benchmarks across programmes, and exports. These stay PARTIAL or MISSING and are named as such in the interface.

## Required acceptance

Populated additive upgrade and repeat install, direct-SQL denial for runtime and auth roles, organiser-only access with denial for members, other participants, other programmes and workspaces, participant-only writes on an active registration, consent and retraction behaviour in the report, expected-version conflicts, exact retries and changed-payload conflicts, concurrent writers, event privacy, changed-account guard, private headers, keyboard and axe at four widths, and the full original suites on the exact merged head.
