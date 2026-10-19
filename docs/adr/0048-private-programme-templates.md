# ADR-048: Private repeatable programme templates

Status: bounded implementation. V3-06-010 and the template half of V3-02-057 stay PARTIAL. A template is a reusable starting plan an organiser writes or captures from a programme they already ran. It creates no participant, sends nothing and moves no money.

The V3 contract lists repeatable delegation templates and programmes as recurring organiser value (priority P1) and ends the organiser journey with producing repeatable programme templates (step 13). It also says delegations must not become a separate backend mission system, so a template here only seeds records that the existing planner, coordination and economics modules already own.

## Decision

Add an optional additive module installed by `migrateCustomerProgrammeTemplates`. It first installs the programme coordination and organiser economics modules, then one table family in `customer_private` and restricted functions in `customer`.

- **Template content.** A template has a Synthetic name, an optional Synthetic description and a content document with exactly four parts: a default programme purpose, an optional capacity, up to 50 tasks (title, optional detail, optional due offset in days from the programme start, optional assignee label) and up to 30 planned costs (expense, obligation or Corridra service fee, a Synthetic description, a currency from the existing currency table and an exact whole-unit amount). It holds no participant, invitation, fee due, payment, actual cost, rating, outcome or date. Participant fees are deliberately excluded because they belong to named registrations.
- **Versioned and append-only.** Every change is a new revision with an expected version, so two organisers cannot silently overwrite each other. A template can be retired and later restored by a new revision. A retired template cannot be applied. Nothing is edited or deleted. At most 50 templates per workspace.
- **Capture from a programme.** A read-only function builds template content from a programme: its current capacity, its tasks (title, detail and assignee label, with no dates because the programme has no start date) and its open planned costs (a cost line that was later cancelled by a correction is left out). The organiser reviews, names and saves it. Capture never writes.
- **Apply to an empty programme.** Applying a template to a programme writes version one of the capacity, the tasks and the planned cost lines in one transaction, using the existing coordination and economics rules, and records one application. It is refused unless the programme has no tasks, no capacity and no ledger entries, and refused if the template is retired or the version is stale, so it can never merge into or overwrite real work. A programme gets at most one application. A start date, if given, turns due offsets into due dates and dates the planned costs. Without one, tasks have no due date and planned costs use the application date.
- **Create from a template.** The interface creates the programme through the existing programme creation, using the template's default purpose and a name the organiser types, and then applies the template. If the second step fails, the empty programme exists and the apply can be retried with the same command.
- **Authority.** Only owners and admins of the workspace read or write templates and apply them, using the existing programme administration and participant management checks. Members, participants and other workspaces see nothing. Staff identity, RLS and the global catalogue are untouched.
- **Retries and concurrency.** Each command carries an id. An exact retry returns the original result, a changed payload under the same id is rejected, and writers are serialised per workspace or programme.
- **Events.** One existing event, audit and outbox chain per save and per application, carrying identifiers, the kind and counts only. Names, text and amounts never enter events.

## Synthetic-only boundary

All free text must begin with `Synthetic `. The route is off unless the workspace, programme and participant flags and `CORRIDRA_CUSTOMER_PROGRAMME_TEMPLATES_ENABLED` are set, the environment is synthetic and Vercel production is not the target. Planned costs are the organiser's own unverified plan lines and carry the same provenance as the economics module. D01 to D06 and D08 stay closed.

## Blast radius and rollback

New objects only. Applying a template inserts rows through the same constraints as the modules it seeds, and the installer is verified to leave existing functions, policies and registries identical. Rollback is disabling the flag and redeploying the previous application. The additive schema, templates and the records an application created are retained and never dropped.

## Not included

Cloning participants, invitations, fees or payments, sharing templates across workspaces, a public template library, scheduling a series of programmes, automatic recurrence, and applying a template to a programme that already has work. These stay MISSING and are named as such in the interface.

## Required acceptance

Populated additive upgrade and repeat install, direct-SQL denial for runtime and auth roles, owner and admin only access with denial for members, participants and other workspaces, content validation in the schema and in SQL, expected-version conflicts, retire and restore, capture accuracy (planned costs net of corrections, no participant data), apply into an empty programme only with exact counts, refusal on a non-empty or already-applied programme and on a stale or retired template, start-date arithmetic, atomic rollback on failure, retries and changed-payload conflicts, concurrent applies, event privacy, changed-account guard, private headers, keyboard and axe at four widths, and the full original suites on the exact merged head.
