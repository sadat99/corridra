# ADR-093: One route pack standard for every route, and one person may publish

Status: Accepted by the owner 26 November 2026. The owner's words in this session, first hand: "go. and ensuring nothing becomes overwhelming for anyone while not compromising with anythign needed. also always the easiest, smoothest option over complex option when that is essential and doesnt add value over 20%. also no need to have second person. one person is enough". "go" answered the design summary that the conductor of this squad run put to the owner, which this record writes up. Earlier the same day: "rethink and suggest the best configurable ... single standard, exhaustive route pack structure/framework that can be appliet for any route ... custom/manual route specific data additon should be available for any specific route." and "there is no route pack in the system, we need prepare them for 10-20 routes. i can gather data for the packs". Date: 26 November 2026.

Phase 1 is this record and its two attachments only: no SQL, application code, migration, installer change or switch change accompanies it. Nothing is built, installed or live because of it. No requirement moves to VERIFIED. Update, 26 Nov 2026: Phase 2a (PR 673) and Phase 2b (PR 675) are merged and not installed. Building Phase 2 is Class A work (auth and a migration) under the full process.

Attachments, both plain CSV files that open in any spreadsheet:

- [Field dictionary](0093/route-pack-standard-v1-fields.csv): every standard field of Route Pack Standard v1 with its section, key, label, part (Locked or Content), Core or Optional, type, format, example and help text.
- [Fill-in template](0093/route-pack-template-v1.csv): one row per field for one route, ready to copy per route, with two example custom field rows.

## Amendments

This record amends two accepted records forward, for route packs only. Those records are not edited. Every other sentence in them stays in force.

ADR-029 (Evidenced route readiness and observed operations). For route pack publication and route readiness, these words no longer apply:

1. "Publication requires an independent authorized owner. An owner without a second authorized reviewer can prepare a proposal but cannot self-publish it."
2. In "Publication checks the current base, independent identity and existing pack validators in one transaction.", the words "independent identity". The current base and the pack validators are still checked in one transaction.
3. In "Reversion publishes an independently reviewed new version using the previous desired configuration.", the word "independently".
4. In "Approvals preserve exact observation IDs and require a different reviewer.", the words "and require a different reviewer". Approvals still preserve exact observation IDs.

ADR-083 (The sourcing workflow on the shared base), for route packs only:

1. Decision 1: the words "independently approved" (in "so the profile is reviewed, independently approved and published with the pack") and "with an independent reviewer" (in "it is proposed through the reviewed flow with an independent reviewer as pack version 2 or later").
2. Context (line 15): in "Publication goes through the reviewed flow: an independent reviewer is required and the published pack's configuration must equal the proposal's", the words "an independent reviewer is required and". The published configuration must still equal the proposal's.
3. The S1 acceptance phrase (line 60) "pack not independently reviewed is refused". From the 2a install on, S1's acceptance is that a pack published without the reviewed flow (proposal, preview and decision) is refused; the same person may propose and publish.

The rest of ADR-083 decision 1 stands unchanged: the `sourcing` key, its 4096 octet budget, the unchanged 8192 octet proposal CHECK, no seed and no country branch.

Not amended, and unchanged by this record:

- ADR-029: "Only the external-dependencies dimension may be explicitly inapplicable." Thirteen dimensions with named active owners and retained source evidence. Pinning to an exact pack. The release states (no real or public activation). "A technical pack status is not legal or operational clearance."
- ADR-028: independent review of partner tasks.
- Every rule, other than those amended above, that needs a second person for money, invoices, evidence decisions or any other gate. For example, real invoices keep their second approver. Amended gate, named explicitly: route readiness evidence and route release. Phase 2a removes the `r.created_by=NEW.created_by` comparison on evidenced readiness observations, so one person may record readiness evidence and release a route pack.
- Roles. Proposing and publishing a pack keep the `config.manage` permission, which is the owner only (`packages/domain/src/index.ts:98`). Readiness and release keep `opportunities.accounting`, owner or admin (`:80`). Every operations command keeps its fresh authenticator check (`packages/missions/src/operations.ts:247-257`). No role set changes, but one admin can now complete readiness and release alone.

## Context

Read on main `8f8aadb`.

- The locked pack. A pack version's `configuration` is a closed set of 18 keys plus the optional `sourcing` block. The guard `app.guard_corridor_configuration`, latest in `packages/db/sourcing-workflow-migrations/0001_route_sourcing_profile.sql:33-64`, refuses any other key, needs `reviewRequired` true, bounds every array at 50 strings and checks currencies, time zones, policy references and the sourcing block (at most 4096 octets, and only while the sourcing control is open). The application mirror is `routeConfiguration`, `.strict()` (`packages/domain/src/corridors.ts:106-128`). Most of these keys carry authority: `missionTypes`, `channels`, `requiredCapabilities`, `operatorCapabilities`, `jurisdictionPolicyRefs`, `aiPolicyRef`, `pricingRef` and `reviewRequired`; `resolveConfiguration` lets lower layers narrow the allowed lists but never widen them (`:142-187`).
- The size cap. A proposal is held in `app.configuration_proposal.proposed_pack` under `CHECK(octet_length(proposed_pack::text)<=8192)` (`packages/db/migrations/0028_operations_control_center.sql:20`).
- The guided form. "Add route pack" (`apps/web/app/operator/review-settings.tsx:155-200`, shown while `CORRIDRA_ROUTE_PACK_FORM` is on) sends `createRoutePack` (`packages/missions/src/route-pack-form.ts:13-69`). It takes the status, the effective date, mission types, languages, currencies, time zones, the manual channel, the optional ADR-083 `sourcing` block and the reason, and writes every other key empty (`:34-55`), even when the current pack has values for them. It writes the pack version straight through `CorridorService.appendPack` (`packages/missions/src/corridors.ts:209-227`), with no proposal, preview or decision record.
- The reviewed path. `OperationsService.preview` names the base and the changed fields and always answers `readinessInvalidated: true` (`packages/missions/src/operations.ts:208-245`): any new pack version needs its readiness recorded again. Publishing refuses the proposer in the service (`:355-356`, "An independent authorized reviewer is required") and in the database (`0028_operations_control_center.sql:100`, live as replaced at `packages/db/customer-real-use-migrations/0003_real_customer_modules.sql:561`, "Independent configuration reviewer required").
- Readiness. A `SYNTHETIC_APPROVED` release needs all 13 current, evidenced dimensions, and refuses any dimension recorded by the person releasing (`0028_operations_control_center.sql:93`, live at real-use `0003:554`, `r.created_by=NEW.created_by`, "Independent approval of current evidenced readiness required"). Only the `dependencies` dimension may be `NOT_APPLICABLE` (real-use `0003:544`).
- The guard `app.guard_operations_control()` is the live definition from real-use `0003:523`, which checks a hash of the core 0028 definition before replacing it (`:522`). No later file replaces it.
- There is no route pack in production. The launch routes are, from Bangladesh, "China, EU, UK, US" (owner, 24 November 2026, `docs/revamp/specs/team-desk-v4-1.md` section 9), each in both directions: eight routes. Bangladesh to China and China to Bangladesh stay independently configured (V3 contract section 3).
- The owner wants one standard for any route, room for route-specific data, nothing overwhelming, the simplest option unless the complex one adds more than 20 percent value, and one person enough.

Two facts drive the design. First, the locked pack cannot hold descriptive route facts: every fact would need a guard migration, the 8192 octet cap would overflow, and every new holiday or port would create a pack version, which invalidates readiness for all 13 dimensions. Second, if publishing or releasing still needs a second person, the owner alone cannot take a route live.

## Decision

### A. Two parts per route

1. **Locked part**: today's guarded pack configuration, unchanged in shape and checks. It keeps everything that grants or limits authority: mission types, channels, capabilities, policy references, `reviewRequired`, the allowed languages, currencies and time zones, the narrowing key lists and the ADR-083 `sourcing` block. Nothing the guard protects moves out of it.
2. **Standard content**: a new, separately versioned, append-only record per route that holds everything descriptive and operational. Each version names the pack version in force when it was saved (none if the route has no pack yet). Content never grants authority, never widens a pack and is never read by an authorization or assignment check.

Adding or correcting a content fact never creates a pack version, so it never invalidates readiness.

### B. One standard for every route: Route Pack Standard v1

Seventeen fixed sections. The fields of each are in the [field dictionary](0093/route-pack-standard-v1-fields.csv); 71 standard fields, of which 13 belong to the locked part.

1. Identity and scope
2. Missions
3. Languages, money and time
4. Market map
5. Trade fairs and events
6. Trade and customs
7. Standards and certification
8. Documents
9. Logistics
10. Payments
11. Travel
12. Compliance and outreach
13. Sourcing profile
14. Supply sources
15. Partners and coverage
16. Risks and watch
17. Custom fields and notes

The same sections and keys serve every route. No section, field or code path names a country.

Section 13 keeps ADR-083 exactly as it works today: the `sourcing` block stays in the locked part, enters through the pack when the sourcing control is open, and keeps its 4096 octet budget. The sheet carries one row for it (`sourcing.profile`, Locked, Optional), used only to mark it Not applicable with a reason or leave it Pending. Its state shows Filled when the current pack carries the block. Moving it into content would need a new guard migration and would split a block that the buying comparison reads, for no gain.

Locked rows in the sheet (keys starting `pack.`) are 12 of the 18 guarded configuration keys, under their own names. The other 6 are never in the sheet: `requirements`, `assessments`, `jurisdictionPolicyRefs` and `aiPolicyRef` are references chosen on the screen, `pricingRef` stays null as the guard requires, and `reviewRequired` stays true. 12 plus 6 is the 18; the optional `sourcing` block is the 19th key and has only its state row.

Carrying over: a pack version built by the import or by the guided form copies every key it does not set from the current pack unchanged: `requirements`, `assessments`, `jurisdictionPolicyRefs`, `aiPolicyRef`, `pricingRef`, `reviewRequired` and `sourcing` (for a route with no pack yet: empty lists, null, true and no block). The import also carries the pack status from the current pack (DRAFT for a new route). Pack status is never set from a file, so a file can never take a route live by accident. A status change is a separate, explicit action on the screen: a reviewed propose-and-publish of the current configuration, unchanged except for the new status. It uses the existing proposal path, the same authority, a fresh authenticator check and a reason; there is no new command. Every status change is a new pack version, so readiness must be recorded again (`readinessInvalidated`, `packages/missions/src/operations.ts:241`); the editor warns about this before the person confirms. In the import and the guided form, leaving a key out never removes it: in particular a `sourcing` block is removed only by the explicit choice "Remove sourcing profile" in the reviewed publish path, with a reason. The raw Advanced `corridor-pack` command is different: it writes the configuration exactly as given. This also fixes, as a Phase 2 item, the precedent in `routePackConfiguration` (`packages/missions/src/route-pack-form.ts:34-55`) that writes those keys empty and so silently drops them from the next version.

### C. States, Core and the completeness view

- Every field row has one state: **Filled**, **Not applicable** (a reason is required in the note) or **Pending**.
- A whole section can be marked Not applicable with one row whose `field_key` is the word `section`, whose `section` cell names the section by its number or its name (for example `5` or `Trade fairs and events`), and whose note gives the reason. Sections are never marked by key prefix. The mark covers every row in that section that is not Filled, including custom fields placed in that section, except Locked Core rows, which stay required. A Filled row keeps its value.
- A section's state is derived: Not applicable when it is marked so (or every field in it is) and all of its Locked Core rows are Filled; a marked section with a Locked Core row not Filled shows Pending and lists those rows. Filled when every Core field in it is Filled or Not applicable and at least one field is Filled; otherwise Pending.
- Each field is **Core** (needed before the route may go live) or **Optional**. The Core set is small: 20 fields, 5 of them locked. Custom fields are always Optional.
- Locked Core rows must be Filled; Not applicable is refused for them, because an empty list is not the same thing as "does not apply". On a Locked Optional row (such as `sourcing.profile` or `pack.localities`) Not applicable is accepted with a reason: the key stays as it is in the pack, and the mark and reason are kept in the content record.
- The completeness view lists every Pending Core field by route, and counts Pending Optional fields without listing them, so nobody faces everything at once.
- Go-live check: one shared domain check, evaluated on the resulting pack and content together. Warn only (owner, first hand, 27 Nov 2026: "confirm warn only"). It saves the write and returns warnings for two cases:
  - a move of a route's pack status to LIMITED or ACTIVE (from any other status) while a Core field would be Pending (`ROUTE_PACK_GO_LIVE_PENDING_CORE`);
  - a content version that turns a Filled or Not applicable Core field back to Pending while the route is LIMITED or ACTIVE (`ROUTE_PACK_CORE_TURNS_PENDING`).
- It refuses exactly one thing (409 `ROUTE_PACK_LOCKED_CORE_EMPTIED`): a pack version that turns a Filled Locked Core row Pending while the route is LIMITED or ACTIVE before and after the write, for example `pack.languages` or `pack.channels` set to an empty list through `appendPack`, the raw `corridor-pack` command, the guided form or the reviewed publish, because it breaks the live pack itself. Locked Core rows still cannot be marked Not applicable. Warnings are returned by every write path and shown by the form after the success words.
- Every path that writes a pack version calls it: `appendPack` (so the Advanced raw `corridor-pack` command, `apps/web/app/api/workspace/[action]/route.ts:332`, cannot bypass it), the guided form, the reviewed publish and the status change. The content append calls it too. It never allows anything the existing checks refuse. DRAFT and TESTING packs are not held back.
- PAUSED is never held back. A route moved from ACTIVE to PAUSED may have a Locked Core row emptied, because it is not live after the write; moving it back to LIMITED or ACTIVE then only warns that the Core field is Pending (warn only), it is not refused.
- The check acts only once the 2b install marker exists. Before that install, or while `CORRIDRA_ROUTE_PACK_FORM` is off, every pack path behaves exactly as on main. Turning `CORRIDRA_ROUTE_PACK_FORM` off therefore also turns the go-live check off, matching main.
- Routes that are already LIMITED or ACTIVE when 2b is installed keep working. The completeness view lists their Pending Core fields, and the check warns as above and refuses only a Filled Locked Core row turning Pending. No production pack exists today, so this case is not expected.
- "Not applicable" in content is about the content record only. It never changes the ADR-029 readiness rules: only the `dependencies` dimension may be inapplicable there, and a content field marked Not applicable is not readiness evidence of any kind.

### D. Every fact has a source and a date

- Each Filled content fact carries a source (an `https://` address or the words `staff knowledge`), an observed date, and an optional valid until date.
- A fact past its valid until date is shown to the team as stale (Phase 3). Staleness never blocks anything by itself; a stale Core fact is listed in the completeness view.
- Locked rows carry no source or dates: they are decisions, and the pack's reason records why.
- Content facts are not readiness evidence. Readiness keeps its own retained `source_record` evidence under ADR-029.
- Content must not hold personal data. Values name organisations, places and rules, never people, email addresses or phone numbers. The importer and the service refuse any value, note or source that contains an email address. A staff owner per route is the readiness `owner` dimension (a principal), not a content field.

### E. Custom fields

- A custom field lives inside the route's content document: each custom fact carries its key (starting with `custom.`), label, section, type and, for `choice` and `list`, its allowed values. There is no separate definitions table.
- The same key keeps the same meaning: the importer and the service refuse a custom key whose type, allowed values or section differs from the same key in the latest content of any other route in the workspace, compared with the state as it will be after the whole file is applied. The label is not compared across routes: the label of the latest save is shown for that key everywhere, so a label change needs one row, not one per route.
- The importer refuses any label that starts with `EXAMPLE ROW`, so the template's example rows can never be saved as they are.
- The importer creates a custom field from a row only when the row is Filled or Not applicable. A Pending row with a new custom key is listed in the dry run and skipped, so an untouched example row never creates a field.
- Types, the same set as the standard fields:
  - `text`
  - `number`
  - `money`: an exact amount in minor units plus an ISO currency, typed as a currency code and amount such as `USD 45.00`; never converted or added to other amounts
  - `date`: `YYYY-MM-DD`
  - `choice`: one value from the field's list
  - `list`: several values, each from the field's list if it has one
  - `link`: an `https://` address
- A custom field exists only on the routes where it is entered.
- Free notes per route use the standard field `notes.general`.
- Promotion: adopting a widely used custom field into a later standard version is a manual change to this record (a new ADR or amendment). Nothing is promoted automatically, and v1 has no alias mechanism.

### F. The standard is versioned

Each content version names its standard version (`standardVersion: 1`). The domain holds one schema per standard version, and v1 is frozen once built. A later v2 may add or retire fields. Old content stays readable under its own version. Moving a route to v2 appends a new content version; nothing is rewritten.

### G. Updating: one sheet shape for everything

The spreadsheet is **one long sheet: one row per route and field**. Columns: `route`, `section`, `field_key`, `label`, `part`, `core`, `type`, `format`, `state`, `value`, `source`, `observed_on`, `valid_until`, `note`, `help`. The importer reads only `route`, `field_key`, `state`, `value`, `source`, `observed_on`, `valid_until` and `note`. For a new `custom.` key it also reads `section`, `label`, `type` and `format`; for a section mark row (`field_key` `section`) it also reads `section`. The other columns are there to help the person filling it.

Why this shape, by the 20 percent rule: one sheet per section would need a source, observed date and valid until column for every field, about three times the columns, and a new custom field would change the sheet layout. The long sheet serves every route in one file, a custom field is just a new row, each fact carries its own source, and import is a plain row loop. The long sheet is both simpler and better, so there is nothing to trade.

Rules of the sheet:

- A route is written `ORIGIN-DESTINATION` with market keys: `BD-CN`, `CN-BD`, `BD-EU`, `EU-BD`, `BD-GB`, `GB-BD`, `BD-US`, `US-BD`. The United Kingdom's key is `GB`.
- **Apply to many**: the route cell may list several routes separated by `|` (for example `BD-CN | CN-BD`). The importer copies that row to each.
- **Copy from a route**: export a route, change the route cell, import. Nothing extra is built.
- **List values**: put several values in one cell separated by `|`, or repeat the field key on more rows. The importer joins them in order.
- **File format**: CSV in UTF-8. Spreadsheet apps save it directly. XLSX is not read: a CSV round trip covers the need without a new parser dependency. The file is at most 1 MiB, 5000 rows and 20 routes.
- **Dry run first**: import always runs a dry run that writes nothing and lists every error with its row number, then shows per route what will change: the locked part as the existing preview of changed fields, and the content as added, changed and removed facts. Nothing is saved while any error remains. A route in the file that does not exist yet is listed as "will be added".
- **Save**: one confirmation with one reason and a fresh authenticator check saves the whole file. Each step below is idempotent by command id, so a failed step can be retried without duplicates. Per route, in order:
  1. add the route if needed (existing `createRoute`);
  2. append one content version;
  3. if the locked rows differ from the current pack, propose and publish the new pack version through the reviewed path (same person, see below), with the status carried from the current pack.

  The dry run and the save run the go-live check on the resulting pack and content together (the current pack and content with the whole file applied), so a file that fills a Locked Core row is judged against the new pack, not the old one. The pack's status never changes on import. The content version names the pack in force when it was saved, which is the version before a pack published in step 3; the editor shows both.

- **Export**: writes the same sheet for one or more routes, with every standard field listed, Pending rows included, so the gaps are visible.
- **One editor screen** (Phase 3): routes first, each with its pack state, completeness and stale marks, and one route opened section by section with the same fields, states and sources as the sheet.

### H. Storage (Phase 2)

The simplest shape that meets A to G: one new table, in a new optional migration directory, added through the existing reviewed installer.

- `app.route_pack_content`:
  - columns: `id`, `tenant_id`, `route_id`, nullable `pack_id` (the pack version in force when saved), `version` (sequential per route), `standard_version`, `document` jsonb, `reason` (3 to 500 characters), `created_by` and server-set `created_at`;
  - checks: `jsonb_typeof(document)='object'`, `octet_length(document::text)<=131072`, at most 500 facts;
  - a guard trigger requires the route and pack to belong to the tenant and the next sequential version; it is a new function, so it needs no hash pin;
  - the document holds `standardVersion`, the section marks and the facts. Each fact is `key`, `state`, `value`, `source`, `observedOn`, optional `validUntil` and `note`, and a custom fact also its `label`, `section`, `type` and allowed values. Text values are at most 1000 characters, `notes.general` at most 4000, a note at most 1000, a custom label at most 120 characters; at most 100 custom keys per route;
  - the octet cap on the whole document wins over the per-field character limits: a document over 131072 octets is refused even when every field is within its own limit.
- The table is append-only and follows the existing corridor table pattern (`packages/db/migrations/0020_versioned_corridors.sql:73-82`):
  - row security, with read and add policies equal to those of `app.corridor_pack_version`, including the real-use pair (`customer-real-use-migrations/0002_real_request_authority.sql:190-192`);
  - `SELECT, INSERT` only;
  - the `reject_rewrite` trigger;
  - the `record_change` event, which carries ids only.
- Writing needs owner or admin with a fresh authenticator check in the database, and the owner-only `config.manage` permission in the service, the same as a pack. Reading needs `missions.read`, like the corridor catalogue. Customers see none of it.
- Full validation of a document is the domain schema of its standard version, in one new domain file; the database checks shape and size. The custom key consistency check runs in the service, inside the same transaction as the insert, under the existing per-workspace corridor lock. The field dictionary in this record is the human copy of that schema; a test asserts that the CSV and the schema list the same keys, parts, Core flags and types.
- No new switch. The content features show only while `CORRIDRA_ROUTE_PACK_FORM` is on and the module's marker function exists, so they appear only after the owner-approved install.

### I. One person may publish a route pack and take it live

- The same person may propose and publish a route pack version, record its readiness dimensions, and release it. The roles stay as they are: proposing and publishing need the owner (`config.manage`), readiness and release need owner or admin (`opportunities.accounting`). Every step needs a fresh authenticator check and a reason.
- After 2a an admin alone, not only the owner, can record all readiness dimensions and release a route, within the existing `opportunities.accounting` role set. This follows the owner's "one person is enough"; publishing a pack still needs the owner.
- Self-publication keeps every other check:
  - the preview of changed fields;
  - the pinned base, refused if the current pack changed;
  - the exact published configuration equal to the proposal;
  - the guard's validators.
- The audit trail is unchanged in shape. The proposal, the decision, each readiness observation and the release each keep their own `created_by` and reason, and each raises its event. When the proposer and publisher are the same person the screen says "Proposed and published by you".
- Phase 2 builds this as an additive, hash-checked replacement of `app.guard_operations_control()`. It is equal to the live real-use `0003:523` definition except that it drops exactly two comparisons:
  - `q.created_by=NEW.created_by` in the `configuration_decision` branch (`:561`);
  - `r.created_by=NEW.created_by` in the release loop (`:554`).
- The service keeps its proposer comparison (`operations.ts:355-356`) until the 2a install marker exists, so before the install the refusal and its text are unchanged. Once the marker exists, the service drops that comparison and both layers allow one person. Each existing error still needs a message for the conditions it still covers, reworded to drop "Independent" once the 2a marker exists, and tests match the new texts:
  - service `:356`, "An independent authorized reviewer is required": still raised when the proposal does not exist or is not readable in this workspace; reworded to "Configuration proposal not found".
  - database `0003:561`, "Independent configuration reviewer required": still raised when the proposal does not exist in the tenant; reworded to "Configuration proposal required".
  - database `0003:554`, "Independent approval of current evidenced readiness required": still raised when a dimension has no observation, its latest observation is not in the release list, is for another pack, is BLOCKED or expired, or its source is missing, unreadable or past retention; reworded to "Current evidenced readiness required for every dimension".
- `configuration_proposal` is route pack configuration only, and readiness and release are route-only, so the change cannot reach any other record.
- The guided form and the import both use the reviewed path (propose, then publish) instead of `appendPack`, so every pack version they write has a proposal, a preview and a decision. `appendPack` stays as the existing developer path under Advanced, as ADR-029 allows for trusted compatibility entry points.
- Owner scope, confirmed by the owner 26 Nov 2026: this record reads "one person is enough" as covering pack publication, the readiness approvals and release. The owner confirmed it first hand to Guardian G67 on 26 Nov 2026, verbatim "yes, covers readiness evidence and release too", in answer to whether the one-person rule covers readiness evidence and release. Every other second-person, money, auth, tenant and real-invoice rule is unchanged.

### Phases

- **Phase 1**: this record, the field dictionary and the template. The owner can start gathering data now.
- **Phase 2**: Class A, full process; three PRs, each leaving main releasable.
  - 2a: one-person route publication (decision I). The new migration directory `packages/db/route-pack-migrations/` with `0001_one_person_route_publication.sql` and a rollback file restoring the exact current definition. One new option, `route_pack_install`, on the existing `field_modules_action` input (no new workflow input); it needs the real-use modules installed first. The service change, screen copy and tests.
  - 2b: `0002_route_pack_content.sql` (decision H), the Standard v1 domain schema, the content service with the custom key consistency check, the completeness view, the shared go-live check (acting only once the 2b marker exists; wired into `appendPack`, the guided form, the reviewed publish and the content append), the status change as a reviewed propose-and-publish of the current configuration with only the status changed (a new pack version, so readiness must be recorded again; the editor warns before confirming), the explicit "Remove sourcing profile" choice in the reviewed publish path, and the guided form extended with the remaining locked key lists and the carry-over of unset keys (same validators and guard). Amended 26 Nov 2026 (PR 675): 2b builds the server side of the remaining locked key lists and of "Remove sourcing profile" (accepted and tested in the service); their screen controls move to Phase 3, the editor, as the easiest option under the owner's first-hand rule of 26 Nov 2026 ("always the easiest, smoothest option over complex option when that is essential and doesnt add value over 20%"). Confirmed by the owner first hand, 26 Nov 2026: "confirm, move them to phase 3". The old guided form sends only what the person set and keeps today's payload while the module is inactive; it cannot clear a list (the Phase 3 editor can).
  - 2c: the CSV import with dry run, apply to many and export, on the existing team control route.
  - Owner, first hand in G68's session, 26 Nov 2026: "Warn only" for a Core field still pending. Confirmed first hand, 27 Nov 2026: "confirm warn only". Built and merged as PR 677 (90d3ecf4), not installed. The third refusal (a pack version emptying a Filled Locked Core list on a LIMITED or ACTIVE route) stays.
  - Each install is a separate owner-approved run of the reviewed installer; builds never migrate.
- **Phase 3**: the one editor screen in Settings (team desk D17: routes first with their pack state), with completeness, stale marks, import and export, under UI/UX.v4.
- **Phase 4**: load the first eight routes (Bangladesh with China, EU, UK and US, both directions) from the owner's sheets, each saved and each moved to TESTING, LIMITED or ACTIVE only on the owner's word. Retiring the sample companies and the AL to AU route stays a separate owner step. A pack status of TESTING, LIMITED or ACTIVE, or any other status, does not open any real-operation gate: D01 to D06, D08, real payments and payouts stay closed, and each gate keeps its own owner decision.

## Rollback

- Phase 1: revert the commit.
- 2a: a reviewed forward run of the rollback file restores the exact earlier `guard_operations_control()` definition and removes the 2a marker, so the service comparison and the database guard match again and publication and release need a second person again. Records written meanwhile stay, and each still shows who did what.
- 2b and 2c: content is append-only and harmless when unread. Turning `CORRIDRA_ROUTE_PACK_FORM` off hides the form and the content features. The table stays; nothing is deleted.

## Tests (for Phase 2 and 3)

- `tests/integration/operations.test.ts`:
  - before the 2a install (no marker), self-publication and self-release fail exactly as today, in both the service and the database, with today's error texts;
  - after it, the same owner proposes, previews and publishes, and records readiness and releases, through the service and the database;
  - an admin alone records all 13 dimensions and releases;
  - still refused: without a fresh authenticator check, with a stale base, with a configuration different from the proposal, and for a member without the permission;
  - the reworded error texts.
- `tests/integration/sourcing-workflow-install.test.ts:313-366` ("a sourcing pack goes through the reviewed flow"): before the 2a install, self-publication of the sourcing block still fails; after it, the same owner proposes and publishes the exact block, and a pack outside the reviewed flow is still refused.
- Real invoice second-person approval and ADR-028 task review are unchanged; their existing tests stay green untouched.
- The content table, in positive, denial and recovery form:
  - row security per tenant;
  - append-only, with update and delete refused;
  - sequential versions and the size cap;
  - an admin without `config.manage` refused in the service;
  - a retried save adds nothing;
  - a custom key with a different type, allowed values or section from another route is refused, judged after the whole file is applied; a different label is accepted and the latest label is shown for the key on every route.
- Domain tests:
  - every v1 key parses;
  - an email address in a value, note or source is refused;
  - a Locked Core row marked Not applicable is refused; `sourcing.profile` and other Locked Optional rows marked Not applicable with a reason are accepted;
  - a section mark by number or name covers its non-Filled rows and its custom fields, never a Locked Core row; a marked section with a Locked Core row not Filled shows Pending and lists it;
  - a document over the octet cap is refused even when every field is within its character limit;
  - a Not applicable row without a reason is refused;
  - section states and the Core completeness are derived as decided;
  - an unknown key outside `custom.` is refused;
  - the CSV dictionary and the schema are equal.
- Import tests:
  - the dry run writes nothing and lists every error with its row;
  - a route list in one cell expands;
  - `|` values and repeated rows join;
  - money keeps exact minor units and refuses extra decimals;
  - a file with any error saves nothing;
  - a Pending row with a new custom key is reported and skipped;
  - a label starting with `EXAMPLE ROW` is refused;
  - a file that turns a Filled Core field Pending on a LIMITED or ACTIVE route is reported as a warning in the dry run; a file that empties a Filled Locked Core row on such a route is refused; a file that fills a Locked Core row is judged against the resulting pack;
  - a pack built by import keeps the current pack's status and every unsheeted key, including `sourcing`; the `sourcing` block is removed only by "Remove sourcing profile" with a reason in the reviewed publish path;
  - export then import gives no change.
- Go-live check:
  - a move to LIMITED or ACTIVE with a Pending Core field is saved with a `ROUTE_PACK_GO_LIVE_PENDING_CORE` warning through `appendPack` (the raw `corridor-pack` command), the guided form, the reviewed publish and the status change, and with no warning once the field is Filled or Not applicable;
  - status change: DRAFT to ACTIVE with a Pending Core field is saved with the warning, as a reviewed proposal and decision with the configuration unchanged;
  - a content version that turns a Filled Core field Pending on a LIMITED or ACTIVE route is saved with a `ROUTE_PACK_CORE_TURNS_PENDING` warning;
  - a pack version that sets `pack.languages` or `pack.channels` to an empty list on a LIMITED or ACTIVE route is refused with `ROUTE_PACK_LOCKED_CORE_EMPTIED` through `appendPack` (the raw `corridor-pack` command), the guided form and the reviewed publish, writing nothing, while the same route already ACTIVE with that row Pending at install keeps working;
  - a route already ACTIVE with Pending Core fields when 2b is installed keeps working and is listed;
  - before the 2b install, or with `CORRIDRA_ROUTE_PACK_FORM` off, every pack path is unchanged from main.
- A property test: country pairs in both orders give the same code path; no country branch.

## Consequences

- The owner can gather data for any route now, in one file, Core fields first (20 rows per route), and the same file later loads through the importer.
- The locked pack stays small and guarded. Descriptive facts change without new pack versions, so readiness is not reset by a holiday list.
- One person can take a route from data to live, with every step still recorded, previewed, authenticated and reasoned.
- Two places describe a route, the pack and the content. The editor and the export show them together, and the sheet marks which part each row belongs to.
- The ADR-083 test fixture comment that says an independent reviewer approves the BD to CN profile becomes stale; 2a corrects it.

## Rejected options

- **Put all route facts into the pack configuration and raise the 8192 cap.** Every fact would need a guard migration, every edit would create a pack version and invalidate all readiness, and authority and description would mix.
- **Free jsonb with no standard.** No completeness, no comparison across routes, and no way to tell a gap from a choice.
- **A separate custom field definitions table, with routes it applies to, a retired state and promotion by alias.** More tables and lifecycle for little value over keys kept consistent inside the content (owner's 20 percent rule).
- **One table per section, or a row per fact.** More migrations and slower snapshots for no value the jsonb document and the domain schema do not already give.
- **One sheet per section, or XLSX import.** About three times the columns, layout changes for custom fields, and a new parser; see G.
- **Keep a second person for publication.** The owner said "no need to have second person. one person is enough".
- **A per-country module or a field that names a country in code.** Refused by the V3 contract and ADR-083.
- **A new owner switch for content.** The installed module and the existing route pack form switch already decide when it shows (V3-04-010, no unnecessary configuration).
