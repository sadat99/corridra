# Route pack editor: the one screen in Settings (ADR-093 Phase 3)

Document status: WAITING OWNER.

UI spec for ADR-093 Phase 3 under UI/UX.v4 (with the v4.1 desk rules). Spec only: no application code, migration or service is written or changed by this record, and nothing is built or live because of it. It follows team desk unit D17 ("Settings with routes first and their pack state") and extends it with completeness, stale marks, editing, import, export and the one-person publish flow of ADR-093 decision I.

Written 26 November 2026 on main `0d0bff7`, with the authority stamp `auth-d8359000b3d7`. Phase 2 (2a, 2b, 2c) had no draft PR when this was first written, so the contracts were taken from ADR-093 and the code on main and the gaps went to Guardian G68 as the 15 numbered questions of section 17. The Phase 2 session answered them the same day; section 17 holds the answers and three open items, and the sections above are amended to match. The repository wins over this record: the build re-checks every name against main, and if a Phase 2 PR differs the spec is amended before the build starts.

## 1. What this screen is for

One job: let one person see which routes are ready to go live, fill what is missing, keep facts fresh, and publish a pack change, without ever facing everything at once.

The owner's words that shape it (ADR-093, 26 November 2026, first hand): "ensuring nothing becomes overwhelming for anyone while not compromising with anythign needed", "always the easiest, smoothest option over complex option when that is essential and doesnt add value over 20%", "no need to have second person. one person is enough".

Design answers to those words:

- Core fields first. The default view of a route is "To Do": only the Pending Core fields and the stale Core facts. The 17 sections are one tap away, not the first thing.
- One save, one reason. Edits are collected and saved together with one reason and one authenticator check.
- Facts and pack are kept apart in words and in cost. Saving facts never touches readiness. Changing a pack setting or the status always says it resets readiness, before the person confirms.
- One person can do everything the roles allow, with each step still recorded under their name.

## 2. Version, rules applied and what is preserved

Name: **UI/UX.v4** (with the v4.1 desk amendment). Rows of `docs/agents/ui-direction.md` applied:

| Rule (section of the file)                                                            | Where it applies here                                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Current locked decisions: Brand and tokens, Type scale, Icons                         | Tokens only, `CorridraIcon`, no new colour. Cobalt is the only action fill.                      |
| Page frame and actions                                                                | One primary action per region. Actions Title Case, left edge of the content column.              |
| Page length                                                                           | Desktop 1 screen, phone at most 2, disclosures closed (section 5).                               |
| Forms                                                                                 | One to three fields per step (section 8).                                                        |
| Visual grammar                                                                        | State is a shape plus a word, never colour alone. A lone symbol has its word beside it.          |
| Error banner                                                                          | `FieldError` and a banner with icon and words, never colour alone.                               |
| Progress as words                                                                     | "Step 1 of 2: Answer" and "Core fields: 14 of 20 done".                                          |
| Sample and real data                                                                  | Sample routes keep the one tenant mode label. Words say "sample", never "synthetic".             |
| No repeated links (team desk v4.1)                                                    | One link per destination inside `<main>`. No Back-to links, no Jump-to chips, no second tab row. |
| Team desk decision 4                                                                  | Actions open in the centred `Dialog` with the authenticator check in place (`StepUpDialog`).     |
| How to build a new screen, steps 1 to 12, and Definition of done for a visible change | The checklist at the end of this file (section 18).                                              |

Preserved, unchanged: the Routes list as D17 draws it today (name, status chip, "Pack version N", "No pack yet"), "Refresh Reviewed Configuration" and its counts, "Create a directional corridor route", the guided "Add route pack" form and its payload, the Advanced raw `corridor-pack` command, every element `id` and `name`, the section `id` `workspace-settings`, all role gates, the fresh authenticator rule, and the closed real-operation gates. The left menu and its places are unchanged; this screen adds no menu entry.

## 3. Where it lives, who sees it, when it shows

| Item          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Place         | The existing Settings place "Routes and settings" (`workspace-settings`). The Routes list stays its first block (D17). No new menu place, no new tab row.                                                                                                                                                                                                                                                                                                                                                                     |
| Addresses     | Same place address plus `?route=BD-CN` (route key in the ADR-093 sheet form), `&view=todo` or `&view=sections`, `&section=5`. A deep link opens that state; Back and Forward move through them. The existing `#workspace-settings` link still lands on the Routes list.                                                                                                                                                                                                                                                       |
| Shown only if | `CORRIDRA_UX_TEAM_DESK_V41` is on (the Routes list of D17 exists only then), `CORRIDRA_ROUTE_PACK_FORM` is on, and the route pack content module (2b marker) is installed. Otherwise the page is exactly today's page for that combination: the D17 list with no completeness, no editor and no import.                                                                                                                                                                                                                       |
| Owner         | Reads, edits facts, changes pack settings and status, imports and exports. Needs `config.manage` for every write; fresh authenticator check on every write.                                                                                                                                                                                                                                                                                                                                                                   |
| Admin         | Reads everything, exports (`missions.read`) and can check an import file without saving it (`audit.read`). Limiting the Export control to owner and admin is a design choice of this spec, not an ADR-093 rule: the Phase 2 session confirmed that every staff role may read content, history and export under `missions.read`, so G68 may widen it. Writes are not offered: the editor shows a read-only note (section 9). Admin keeps readiness and release in the existing Control Center, and after 2a can do both alone. |
| Other roles   | Whatever the Settings place already allows today. Nobody below the Settings gate sees any of it. Customers see none of it, ever.                                                                                                                                                                                                                                                                                                                                                                                              |

## 4. Screens

One screen, five states of the same page. Nothing is a second page.

| State               | Address                              | What shows                                                                                                                                                                 |
| ------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes only         | `workspace-settings`                 | The Routes list full width, with completeness and stale marks. A line says to open a route.                                                                                |
| Route, To Do        | `?route=BD-CN` (default `view=todo`) | List beside or above the editor; the route header; the Pending Core and stale Core fields by section.                                                                      |
| Route, All Sections | `?route=BD-CN&view=sections`         | The 17 sections as one grid, each with its state word and counts.                                                                                                          |
| Route, one section  | `?route=BD-CN&section=5`             | One section's fields, Core first, with the section actions.                                                                                                                |
| Dialogs             | no address change                    | Save Route Facts, Change Pack Setting, Change Pack Status, Add Custom Field, Mark Section Not Applicable, Import Route Data, Export Route Data, Discard Changes, Conflict. |

Which view is the default: "To Do" when the route has any Pending Core field or any stale Core fact; otherwise "All Sections".

## 5. Layout per width

Page length budget (UI/UX.v4 "Page length"): desktop 1 screen, phone 1.5 to 2 screens, measured with disclosures closed and the footer included. Over the limit means tabs or disclosure, never cuts. Every list here uses `ShowMoreList` (fixed count, rest folded, nothing removed).

| Width       | Routes only                                                                                                            | Route open                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 320         | One column. Row: name on its own line, then status chip and "Version 2", then "Core 14 of 20 done" and any stale mark. | The Routes list folds into one disclosure row "Routes: Bangladesh to China" (closed). Header, view choice, then the field rows, one column, field value under its label. The unsaved bar is the last block of the editor and sticks to the bottom of it, 60 px tall. |
| 375 and 390 | As 320.                                                                                                                | As 320. Field rows keep a 44 px Edit target.                                                                                                                                                                                                                         |
| 768         | One column, the row on two lines.                                                                                      | Disclosure row for the list, as phone. Sections grid in two columns. Field rows show label, value, state and source stamp on one line each.                                                                                                                          |
| 1024        | List full width, one line per route.                                                                                   | Two columns: the Routes list 20 rem wide (name, status chip, "Core 14 of 20"), the editor beside it. The current route has `aria-current="true"`.                                                                                                                    |
| 1440        | As 1024 with room for the version and stale words on the row.                                                          | As 1024, editor column up to 44 rem. Sections grid in two columns. Fits one screen with every disclosure closed; lists over 8 rows fold behind "Show all N".                                                                                                         |
| 1920        | As 1440, content column capped; no new wide layout.                                                                    | As 1440.                                                                                                                                                                                                                                                             |

Rules at every width: no horizontal page scroll; text reflows at 200 percent; values wrap (`overflow-wrap: anywhere`) and carry `dir="auto"` because place and company names may be in any script; the Edit button never moves off the row on a phone (the row stacks, the button stays right under the value); the fixed phone bottom action area is not used (this is a data screen, not a flow screen), the unsaved bar is sticky inside the editor only and never covers a field.

## 6. Components

Reuse first (all exist today):

| Need                  | Reuse                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Route name with flags | `CountryName` (`apps/web/app/operator/country-name.tsx`) and `Flagged`; no flag alone                                            |
| Pack status chip      | `StatusBadge` with the existing `packStatuses` words and `packTones` (Draft, not used yet; Testing; Limited use; Active; Paused) |
| Route list            | The D17 `RouteList` and `ShowMoreList`, extended in place                                                                        |
| View choice           | `SegmentedFilter` ("To Do", "All Sections"); applies at once, arrow keys, counts with tabular numerals                           |
| Source and date       | `SourceStamp` (source and date on one 12 px line; not a trust label)                                                             |
| Dialogs and step-up   | `Dialog` (32 rem column, full width on a phone), `StepUpDialog` through `withStepUp`                                             |
| Choices               | `ChoiceRow` and `ChoiceButton` for single choices; `ux-check` for multi choices                                                  |
| Errors, empty, help   | `FieldError`, `EmptyState`, `FieldHelp`, `role="alert"`, `role="status"`                                                         |
| Inputs                | `.field`, `MoneyInput`, `DateTimeInput` (date only), `NumberField`                                                               |
| More menu             | `OverflowMenu`                                                                                                                   |
| Buttons               | `.primary-link` (cobalt, one per region), `.text-link` for the quiet ones                                                        |
| Icons                 | `CorridraIcon` names that exist today: `check`, `lock`, `clock`, `alert`, `document`, `list`, `refresh`                          |

New components, each added to the "Shared components (UI/UX.v4)" table in `ui-direction.md` by the build PR before use, and each placed next to its peers under `apps/web/components/ux/` or `apps/web/app/operator/`:

| New              | What                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FactMark`       | The state shape with its word: filled tick and "Filled", dashed and "Not applicable", hollow and "Pending". Reuses the Room stage shapes (done, not tracked, later) and their tokens, no new colour. A stale mark is the `clock` icon with the word "Stale". |
| `ChangeSummary`  | A list of changes in words (added, changed, removed) with a count line. Used by Save Route Facts, Change Pack Setting, Change Pack Status and the import dry run, so every confirmation reads the same.                                                      |
| `RouteFactRow`   | One field: label, Core word, value, state, source stamp, stale mark, Edit. Expands in place to the two-step field editor.                                                                                                                                    |
| The editor shell | Route header, view choice, unsaved bar. Pure composition of the above.                                                                                                                                                                                       |

## 7. The Routes list (D17, extended)

Heading `h2` "Routes" (unchanged). One 14 px line under it: "Facts describe a route. The pack decides what the team may do on it."

Each row, one link per route (the name is the link, to `?route=`):

| Part           | Words and rules                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route          | Flag and name, "Bangladesh to China" (existing words).                                                                                                                                                                                             |
| Pack           | Existing chip and "Pack version N", or the chip "No pack yet".                                                                                                                                                                                     |
| Core           | "Core 14 of 20 done" (counts derived from the schema, never typed in code). When all done: "Core complete". With no facts saved yet: "Core 0 of 20 done". The number of Core fields is whatever the standard version says; 20 is today's v1 count. |
| Stale          | If any: the clock mark and "2 stale". Hidden when none.                                                                                                                                                                                            |
| Live with gaps | If the pack is Limited use or Active and a Core field is Pending (a route that was live when the content module was installed): the word "Live with gaps" in the caution tone, with its shape.                                                     |

List head actions, left aligned under the helper line, owner and admin for both Import (the check is read only for an admin) and Export: "Import Route Data" and "Export Route Data" as quiet `.text-link` buttons (the list has no primary). On a phone they stack, 44 px tall.

Limit: first 5 routes, then "Show all 8 routes" (existing `ShowMoreList`).

The existing empty line stays: "No route yet. Open Create a directional corridor route below to add the first one."

## 8. The route view

### 8.1 Header

`h2` the route name with flags. Below it, in order:

1. Status chip, "Pack version 2", "Route facts version 5" (the content version). With no pack: chip "No pack yet" and "Route facts version 5". With no facts yet: "No facts saved yet".
2. The completeness line: "Core fields: 14 of 20 done. 6 still Pending." with a native `progress` (value 14, max 20, `aria-label` "Core fields done") for screen readers; it is words first, a thin bar second.
3. If any stale: clock mark, "2 facts are stale. Check them before relying on them." Staleness never blocks; this is a nudge.
4. The readiness line (section 10), from `overview().routes[].readiness`, typed `{ packId: string; completeMissionTypes: string[] } | null`. `packId` is always the current pack; the value is null when the route has no pack or the reader is not owner or admin, and then the line is not drawn. With an empty `completeMissionTypes`: "Readiness: not recorded for pack version 3." Otherwise: "Readiness: complete for {mission type names} on pack version 3." (question 11, answered.)
5. The last pack change: "Pack version 3, proposed and published by you, 26 Nov 2026" when proposer and publisher are the same person; otherwise "proposed by X, published by Y". Names are staff names as the audit shows them today.

Actions: one primary at most. With unsaved changes the primary is "Review and Save" (count in the label: "Review and Save (3)"). Otherwise no primary. Quiet actions: "Change Pack Status" (owner), and an `OverflowMenu` named "More" with "Export This Route", "Add Custom Field" and "Mark Section Not Applicable" (the last two only on a section view).

### 8.2 View choice

`SegmentedFilter` labelled "View": "To Do (6)" and "All Sections (17)". It is the one way between the two views and the way back from a section: opening a section sets `section`, and choosing either segment clears it. No Back-to link.

### 8.3 To Do

Every Pending Core field and every stale Core fact of the route, grouped under `h3` section headings ("3. Languages, money and time"). Rows are `RouteFactRow`. First 8 rows, then "Show all 14 fields". The Optional fields are not listed here; one quiet line counts them: "31 optional fields are still Pending. Open All Sections to fill them." (a count, not a list, per ADR-093 C).

Empty (all Core done and none stale): `EmptyState` with the check icon, "Every Core field is done and nothing is stale." and no action; the view choice and the optional-count line remain.

### 8.4 All Sections

A grid of the 17 sections in two columns from 768 px. Each is one button-styled row of at least 44 px: number and name, the state word (Filled, Not applicable, Pending), "2 Core pending" when any, "1 stale" when any, and a quiet count "3 optional pending". Section state is the derived state of ADR-093 C (a section marked Not applicable with a Locked Core row not Filled shows Pending and says which row, section 8.6).

### 8.5 One section

`h3` "5. Trade fairs and events" with its state mark and word. One 14 px line with the section help. Fields in two groups with plain subheadings: "Needed before going live" (Core) and "Optional". Custom fields placed in this section sit last under "Your own fields". First 8 rows, then "Show all N". Quiet actions in the More menu: "Add Custom Field", "Mark Section Not Applicable".

### 8.6 Section marked Not applicable

Owner action "Mark Section Not Applicable" opens a dialog with one field, the reason (3 to 500 characters), a line "Every field in this section that is not Filled becomes Not applicable. Filled facts keep their value. Pack settings that are Core stay required." and "Mark Not Applicable". When a Locked Core row in the section is not Filled the section stays Pending after the mark and says: "This section is marked Not applicable, but Working languages and 1 more pack setting are Core and still Pending." Unmarking is a normal edit of the rows (a new facts version), not a special action.

### 8.7 A field row

| Part     | Content                                                                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label    | The label from the field dictionary (the schema is the one copy; the spec and the screen never retype it).                                                                                                              |
| Core     | The word "Core" in a small chip. Optional rows show no chip (their group heading says Optional).                                                                                                                        |
| Value    | The value in words, at most 2 lines with "Show full value" for longer ones. A list shows its items as a short list. Money shows "USD 45.00", exactly as entered, never converted. Empty shows "Not filled yet" (quiet). |
| State    | `FactMark` and word. Not applicable also shows the reason: "Not applicable: {note}".                                                                                                                                    |
| Source   | `SourceStamp`: the source (an address shown as its host, or "Staff knowledge") and the observed date. "Valid until 31 Dec 2026" follows when set.                                                                       |
| Stale    | Clock mark and "Stale since {valid until}". Staleness changes no state, blocks nothing and removes no value.                                                                                                            |
| Pack row | A Locked row shows the `lock` icon and the words "Pack setting", no source or dates (decisions, not facts), and its button reads "Change {label}" instead of "Edit {label}".                                            |
| Unsaved  | A row with an unsaved edit shows "Changed, not saved" beside its state.                                                                                                                                                 |

`sourcing.profile` (Locked, Optional) shows "Filled" when the pack carries the block, with the note "Set in Add route pack while the sourcing control is open." Its only actions: "Mark Not Applicable" (reason), and when Filled, "Remove Sourcing Profile" (reviewed publish with a reason, section 11.3). Nothing here edits the block.

### 8.8 Editing a fact (content row)

"Edit {label}" opens the row in place, two steps, at most three fields each, with progress in words. Focus moves to the first control. "Cancel" returns focus to the Edit button.

| Step                               | Fields                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 1 of 2: Answer (Next: Source) | State as three `ChoiceRow` answers: "Filled", "Not applicable", "Pending". Then the value control for the type, or, for Not applicable, the reason (required, up to 1000 characters). That is two inputs.                                                                                          |
| Step 2 of 2: Source                | Source (two choices: "Staff knowledge" or "A web address" with the address field, `https://`), then the dates as one pair: "Observed on" (default today) and "Valid until" (optional). Two inputs plus the pair. Skipped when the state is Pending or Not applicable (no source is kept for them). |

Buttons: step 1 "Next", step 2 "Keep Change". "Keep Change" stages the edit (it is not saved yet) and closes the row.

Value controls by type (the same types as the standard):

| Type   | Control                                                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| text   | Textarea with a live counter against the field's limit ("412 of 1000").                                                                            |
| number | `NumberField`, whole numbers where the format says so.                                                                                             |
| money  | `MoneyInput`: currency code and amount, exact minor units, extra decimals refused with words ("Use at most 2 decimals for USD").                   |
| date   | A date input, `YYYY-MM-DD` underneath, shown as the viewer's date words.                                                                           |
| choice | `ChoiceRow` answers from the field's list.                                                                                                         |
| list   | One entry per row with "Add Another" and a remove button per row ("Remove entry 2"); where the field has allowed values, `ux-check` boxes instead. |
| link   | One input, must start with `https://`.                                                                                                             |

Inline refusals (`FieldError`, focus moves to the first):

| Case                                          | Words                                                                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An email address in any value, note or source | "This looks like an email address. Route facts name organisations, places and rules, never people. Remove it."                                                                            |
| Over the limit                                | "That is 1,204 characters. The limit is 1000. Shorten it."                                                                                                                                |
| Source not `https://` or "Staff knowledge"    | "Give a web address that starts with https://, or choose Staff knowledge."                                                                                                                |
| Not applicable without a reason               | "Say why this does not apply to this route."                                                                                                                                              |
| Pending a Core field on a live route          | The Pending answer is disabled with the visible reason "This route is Limited use or Active, so a Core field cannot go back to Pending. Fill it or mark it Not applicable with a reason." |
| Not applicable on a Locked Core row           | The answer is not offered. The row's help says why: "An empty list is not the same as does not apply."                                                                                    |

### 8.9 Changing a pack setting (Locked row)

"Change {label}" opens the dialog "Change Pack Setting". It is the one place a Locked row is edited and it always follows the reviewed path, so it never mixes with unsaved fact edits (those stay staged and are untouched).

Step 1 of 2: Value. The control for the key: the existing guided-form controls for mission types, languages, currencies, time zones and channels (channels in words: "Sample messages only" and "The team sends by hand", values `SYNTHETIC` and `MANUAL`), a key-list entry for the others (short keys: lowercase letters, digits, `_ . -`, up to 80 characters, up to 50 keys, each key checked as typed). A Locked Core row cannot be emptied on a live route: the Save is disabled with the visible reason from 8.8.

Step 2 of 2: Review. `ChangeSummary` of the one changed key, the base ("Based on pack version 2"), the new version ("Becomes pack version 3"), "Mission assignments kept: 4" (`historicalAssignmentsPreserved`), the readiness warning of 11.2, one reason, then the publish button (section 11). For a route with no pack yet, the same dialog creates pack version 1 as Draft with every other key at its carried default (empty lists, no policy references, review required) and says so: "This starts the pack as Draft, not used yet."

## 9. Saving facts

The unsaved bar sits at the bottom of the editor once anything is staged: "3 changes not saved" and the primary "Review and Save (3)", and a quiet "Discard Changes". Staged edits survive moving between views and sections of the same route. They are held in the page and mirrored in `sessionStorage` per route as a convenience only (wrapped in try/catch, the page works without it). Moving to another route, or closing the page, with staged edits asks first.

### 9.1 Save Route Facts (dialog)

| Part      | Content                                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title     | "Save Route Facts"                                                                                                                                                                                          |
| Statement | "This saves a new version of the facts for Bangladesh to China. It does not change the pack, so readiness stays as it is. Only your team can see route facts."                                              |
| Summary   | `ChangeSummary`: "Added 2, changed 1, removed 0", then the lines ("Added: Working week", "Changed: Usual business hours"). First 6 lines, then "Show all".                                                  |
| Field     | One field: "Reason", 3 to 500 characters, counter. Placeholder: "For example: added the 2027 public holidays from the official notice".                                                                     |
| Actions   | "Save Facts" (primary, left), "Cancel". The authenticator check opens in place if needed (`StepUpDialog`); the reason stays.                                                                                |
| After     | Dialog closes. `role="status"`: "Saved. Route facts are now version 6." Focus goes to the status line. The staged edits clear and the rows show the saved values. The Core line and the Routes list update. |

Admin (read only): the editor shows, once, under the header: "Only the owner can change route facts and packs. You can read everything and export it." Every Edit, Change and Status control is absent, not disabled (a control the role can never use is not drawn). Import Route Data and Export stay: the admin can check a file, and its Save is disabled with the reason of section 12.1 (G68, 26 November 2026).

### 9.2 Conflict

If another save landed first (the service answers 409 `ROUTE_PACK_CONTENT_CHANGED`, question 12, answered): the page re-reads the overview, then the dialog shows "Someone saved route facts for this route first." and, for each fact both of you changed, two `ChoiceRow` answers, "Keep mine: {value}" and "Use theirs: {value}". Facts only one side changed merge without asking. The page then sends the whole merged document at the next version (the service takes the whole document, never partial changes). Primary "Save With These Choices". Nothing is lost silently.

## 10. One person: publish, then readiness, then release

The owner can take a route from data to live alone. The roles are unchanged (ADR-093 I): publishing a pack needs the owner (`config.manage`); readiness and release need owner or admin (`opportunities.accounting`). Every step has its own reason and fresh authenticator check, and every step is recorded under the person's name.

| Step | Where                                            | What the person does                                                                                   | Cost                                                |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 1    | This screen, facts                               | Fill and save facts (section 9).                                                                       | None. Readiness is untouched.                       |
| 2    | This screen, pack                                | Change a pack setting, change the status, or import a file that changes a pack (sections 8.9, 11, 12). | New pack version. Readiness must be recorded again. |
| 3    | This screen, header                              | Read "Readiness: needs recording for pack version 3."                                                  | Words only.                                         |
| 4    | The existing readiness controls (Control Center) | Record the 13 dimensions and release. This screen never records readiness or releases.                 | Unchanged screens, one person allowed after 2a.     |

The one link from this screen to step 4 is in the readiness line: "Record Readiness" (text link, to the existing controls for this route and pack). The editor has no release button and no copy that implies the route is cleared.

Wording rule for every status and pack change (ADR-029 and ADR-093 Phase 4): a pack status is not clearance. The dialogs say it: "A pack status is not clearance. Real payments, outreach and payouts stay closed until the owner decides each gate."

## 11. Publishing a pack change

### 11.1 One dialog, two recorded steps

For the owner, "propose" and "publish" are one confirmation and one request: the page calls the server-side `publishReviewed`, which runs propose then decide inside the 5-minute fresh authenticator window, so one code covers both (question 4, answered). The dialog shows the preview, takes one reason and checks the authenticator. A retry resends the same command id: the existing proposal is reused and the decision is idempotent, so nothing is duplicated.

Button: **Publish Pack Change** (primary). Under it, the one-person line, shown only once the 2a marker exists: "You are proposing and publishing this yourself. Both steps are recorded under your name."

In progress: the button becomes "Publishing…" with `aria-busy` and the dialog is locked (`Dialog locked`). The two steps run inside one request, so the page shows one busy word, not two steps.

### 11.2 The readiness warning (always, before confirm)

A bordered block above the buttons, with the `alert` icon and words (never colour alone):

"This publishes pack version 3. Readiness has to be recorded again for every dimension before this route can be released. Route facts, sources and dates are not affected."

It appears for a pack setting change, a status change, a sourcing removal and an import that changes a pack.

### 11.3 Remove Sourcing Profile

Only on a Filled `sourcing.profile` row, owner only. Dialog "Remove Sourcing Profile": one reason; statement "This removes the buying profile from the pack. Buyers' comparison for this route stops using it."; the same warning and button. Leaving a key out never removes it anywhere else (ADR-093 B).

### 11.4 Failures

| Case                                    | Words and behaviour                                                                                                                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposal saved, publish failed          | Banner: "The change is saved as a proposal but not published yet." Button "Try Publishing Again" (same command id). Nothing is duplicated.                                                                                                                        |
| The pack changed meanwhile (stale base) | "Another change to this pack was published first. Nothing was published. Open the route again to see the current pack, then make your change again." Primary "Reload Route".                                                                                      |
| Authenticator missing or wrong          | Handled in place by `StepUpDialog`; the form, reason and choices stay.                                                                                                                                                                                            |
| Not allowed (not the owner)             | "Only the owner can publish pack changes." The control is not drawn for an admin, so this shows only if a role changed while the dialog was open.                                                                                                                 |
| Before 2a is installed                  | The same dialog says, under the summary: "A second owner has to publish this. One-person publishing is not installed yet." The primary reads "Propose Pack Change" and the change waits in Control Center. The pre-2a service refusal and its text are unchanged. |
| Go-live refused (Core Pending)          | The dialog does not open; see 11.5.                                                                                                                                                                                                                               |

### 11.5 Change Pack Status

Owner only. Button "Change Pack Status" in the route header. Dialog, two steps.

Step 1 of 2: Status (Next: Review). "Now: Testing." Five `ChoiceRow` answers with the existing words: "Draft, not used yet", "Testing", "Limited use", "Active", "Paused". The current one is marked "Now" and cannot be chosen.

When the route has a Pending Core field, "Limited use" and "Active" are shown but cannot be chosen, and the reason is visible text on each: "Not yet: 6 Core fields are still Pending." Under them a disclosure "Show the 6 fields" lists them (first 6, then "Show all"), and one link, "Fill Them First", closes the dialog and opens the To Do view. When no Core field is Pending, both are choosable. This mirrors the shared go-live check (ADR-093 C); the server stays the authority and its refusal has its own words (11.6).

Step 2 of 2: Review. `ChangeSummary`: "Status: Testing to Active", "Pack version 2 becomes 3", "Mission assignments kept: 4", the settings unchanged ("Every pack setting stays as it is"), the readiness warning of 11.2, the not-clearance line of section 10, one reason, "Publish Status Change" (the 11.1 button, relabelled).

Moving to Paused or Draft has the same warning (every status change is a new pack version).

### 11.6 Go-live refusals from the server

The three refusals of ADR-093 C, each shown as a banner with icon and words and with the fields named, never "invalid request":

| Refusal                                                         | Words                                                                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status to Limited use or Active with a Core field Pending       | "This route cannot go to Active yet. These Core fields are still Pending: Working languages, Business visa and 4 more." Action "Open To Do".                   |
| A save turns a Filled Core fact back to Pending on a live route | "This route is live. A Core fact cannot go back to Pending: Privacy laws. Fill it or mark it Not applicable with a reason." The field is marked in the editor. |
| A pack change empties a Locked Core row on a live route         | "This route is live. Working languages cannot be empty. Choose at least one."                                                                                  |

A route that was already live with Pending Core fields when the content module was installed keeps working: its header shows "Live with gaps" and one line, "This route is live and 3 Core fields are still Pending. It keeps working. Fill them when you can."

## 12. Import and export

### 12.1 Import Route Data

Owner and admin may open it, because the check is read only (`audit.read`); only the owner can save (`config.manage` plus the authenticator). For an admin the dialog works through steps 1 to 3 as for the owner, and step 4 shows "Save All Routes" disabled with its reason as visible text: "Only the owner can save a route file. You can check it here and nothing is saved." No reason field and no authenticator prompt are drawn for the admin. Opened from the Routes list head. One dialog, four visible steps in words: "Step 1 of 4: Choose a file", "Step 2 of 4: Check", "Step 3 of 4: Review" and "Step 4 of 4: Save". Nothing is written until step 4.

**Step 1, Choose a file.** Text: "Use a CSV file saved in UTF-8: the template, or an export you changed. Up to 1 MB, 5000 rows and 20 routes." Two more lines of help, plainly: "To copy one route to another, export it, change the route column and import it." and "To give one row to several routes, write them in the route cell with | between, for example BD-CN | CN-BD." One file control, "Choose File". "Download Blank Template" as a text link (question 7). Wrong type or too big is refused before upload: "That file is not a CSV." and "That file is over 1 MB."

**Step 2, Check (the dry run).** It starts at once on choosing the file, writes nothing, and says so: "Checking only. Nothing is saved." Busy: `role="status"` "Checking 1,240 rows…". Failure of the check itself (not of the file): banner "The check did not finish. Your file was not used. Try again." with "Try Again".

If there are problems (any error blocks the save):

- Heading "7 problems in 4 rows. Nothing is saved while any problem remains."
- An ordered list, one item per problem: "Row 14, BD-CN, Working languages: use language tags such as en or bn." Every error carries its row number, the route key and the field label. First 20, then "Show all 7 problems" (here, all). A quiet "Download Problem List" makes a CSV from the response in the page (row, route, field, problem).
- Actions: "Choose Another File". There is no Continue.

If there are none, step 3.

**Step 3, Review.** The result is judged against the state as it will be after the whole file is applied (ADR-093 E, G).

- Heading "Ready to save 3 routes."
- One block per route: the route name; the tag "Will be added" for a route that does not exist yet; `ChangeSummary` for the facts ("Added 12, changed 3, removed 0") and, when the pack changes, a second summary "Pack settings: Working languages, Currencies used" with the readiness warning of 11.2 and "Becomes pack version 3". Each route's lines sit in a disclosure "Show the changes", closed, so the dialog stays short.
- Rows skipped, listed with a count: "2 rows skipped: new custom fields that are still Pending." Skipped rows are not errors.
- One fixed line: "A file never changes a pack status. Every route keeps its status." and, for a new route, "A new route starts as Draft, not used yet."

**Step 4, Save.** One reason (3 to 500 characters), the one-person line when the 2a marker exists, and the authenticator check in place. Primary "Save All Routes". While saving, locked dialog with one busy line, "Saving 3 routes…" (the save is one request with a save id, so per-route progress is not shown; the answer lists each route). Each route is three idempotent steps (add the route if needed, append the facts, publish a pack change if the locked rows differ), so a failure part way leaves earlier routes saved and says so.

Outcomes:

| Outcome                   | Words                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Success                   | `role="status"`: "Saved 3 routes." The list updates. One link: "Open Bangladesh to China" (the first route in the file).                                                                          |
| Part way failure          | "Saved 1 of 3 routes. Not saved: China to Bangladesh, EU to Bangladesh." and, for each failed route, its reason in words. Primary "Try the Rest Again" (same command ids; nothing is duplicated). |
| A route changed meanwhile | "Bangladesh to EU changed while you were checking. It was not saved. Choose the file again to check it against the current state." The other routes are handled as above.                         |
| Go-live refusal           | Shown in the dry run as an error with its row, never as a surprise at save (the check runs on the resulting pack and content together).                                                           |

Dismissing the dialog before step 4 discards the file. After step 4 starts, closing is locked until it settles.

### 12.2 Export Route Data

Owner and admin. From the Routes list head and, for the open route, from the More menu as "Export This Route".

Dialog "Export Route Data". One list of the routes with `ux-check` boxes: from the list head all are ticked, from the More menu only the open route. Text: "One CSV file in UTF-8, which any spreadsheet opens. Every standard field is listed, including the ones still Pending, so the gaps show. Each fact has its source and date." "Download CSV" (primary). Busy "Preparing the file…". Success `role="status"`: "Downloaded corridra-route-data-2026-11-26.csv with 2 routes." Error banner: "The file could not be made. Nothing was changed. Try again." File name is the date and never a person's name. Export then import with no edit gives no change (ADR-093 test), so the dialog says nothing about versions.

## 13. States (every screen)

| State        | Routes list                                                                                                                                                                                                                                                                  | Route view                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading      | Skeleton rows (3) and the words "Loading routes…" (`role="status"`), as today.                                                                                                                                                                                               | Skeleton header and 4 skeleton rows; "Loading route facts…". The unsaved bar is absent. No layout shift when it resolves (heights reserved).                                                            |
| Empty        | The existing "No route yet" line. A route with no pack shows "No pack yet" and still opens.                                                                                                                                                                                  | No facts saved: "Nothing is recorded for this route yet." and the To Do view lists every Core field; the Optional count line shows the rest.                                                            |
| Busy         | The list head buttons carry `aria-busy` while a check or export runs.                                                                                                                                                                                                        | Save, publish and import lock their dialog (`Dialog locked`) and show the step in words; the editor rows stay readable behind.                                                                          |
| Error        | "Routes are unavailable. Refresh reviewed configuration to try again." (existing words).                                                                                                                                                                                     | Banner with `role="alert"`: "Route facts are unavailable. Try again." and "Try Again". The header still shows the pack chip if the catalogue loaded. A failed save keeps every staged edit and says so. |
| Denied       | Whatever Settings already shows for a role below the gate.                                                                                                                                                                                                                   | Admin: read-only note and no write controls (9.1). A role without `missions.read`: "You do not have access to route facts." and nothing else; never an empty page that hides the denial.                |
| Conflict     | Not applicable.                                                                                                                                                                                                                                                              | Section 9.2 (facts), 11.4 (stale base).                                                                                                                                                                 |
| Success      | `role="status"` lines named in each flow; focus goes to the status line after a dialog closes.                                                                                                                                                                               | As left.                                                                                                                                                                                                |
| Stale        | Row shows "N stale".                                                                                                                                                                                                                                                         | Header line, row marks, stale Core facts listed in To Do. Never blocks.                                                                                                                                 |
| Complete     | "Core complete" on the row.                                                                                                                                                                                                                                                  | "Every Core field is done and nothing is stale." in To Do.                                                                                                                                              |
| Switch off   | With `CORRIDRA_ROUTE_PACK_FORM` off, the content module not installed, or the desk switch off: exactly the page that exists today. No completeness text, no editor, no import or export, no new strings. This is tested by comparing the page with the switches off to main. |
| Offline      | A failed read shows the error state; no write is attempted and no draft is claimed saved.                                                                                                                                                                                    | Staged edits stay on the page; a failed save says "Not saved. Your changes are still here."                                                                                                             |
| Rate limited | Not applicable.                                                                                                                                                                                                                                                              | The shared limit words, with the command kept ready to send again.                                                                                                                                      |

## 14. Accessibility

- One `h1`, the existing Settings page title. `h2` "Routes", `h2` the open route's name, `h3` sections, field labels are plain text in a list item, not headings.
- The Routes list is a `ul`. Each name is a link with the accessible name "Bangladesh to China, pack Testing, Core 14 of 20 done"; the open one has `aria-current="true"`.
- The view choice is a radio group labelled "View" (arrow keys), as `SegmentedFilter` already is. Each section button in the grid is named "5, Trade fairs and events, Pending, 2 Core pending".
- Edit buttons are named by the row: "Edit Working week", "Change Working languages". The expanded editor is a `group` named by the same words. State is announced as words by `FactMark` text, never by a shape alone.
- Staging announces: `role="status"` "Change kept. 3 changes not saved." Saving, publishing, importing and exporting each announce start (busy) and result; failures use `role="alert"`.
- Focus: opening a field moves focus to its first control, Cancel or Keep Change returns it to the Edit button; a dialog traps focus and returns it to the control that opened it (`Dialog`); after a save the focus goes to the status line; after an import error list appears focus goes to its heading; the first invalid field takes focus on a refusal.
- Keyboard: every action is a real button or link, no pointer-only path; Escape closes a dialog (not while locked); closing with staged edits asks first and the safe choice, "Keep Editing", has focus.
- Touch targets 44 px up to 768 px, including list rows, section rows, Edit and the choice rows. Contrast WCAG 2.2 AA from the tokens only; state and stale are shape plus word. Reduced motion respected; the only motion is the existing dialog open and the in-place row expand, each under 300 ms, nothing plays on its own.
- Text reflows at 200 percent; no information is only in a tooltip. Values use `dir="auto"` and wrap. Disabled choices state their reason in visible text.
- Test selectors follow the accessible names above (roles and names, not class names). Existing `id` and `name` values are untouched.

## 15. Copy rules

Final wording is in place above. Rules the build keeps: actions in Title Case written in the text, no em dashes anywhere, no `text-transform`, plain words ("Pending", not "Not yet populated"), "sample" never "synthetic", numbers always derived from the data and the schema (the 20 Core fields, the 71 standard fields and the 17 sections are v1 facts and are never typed into a string), dates through `formatDate` in the viewer's zone, no claim that a route is cleared, compliant or ready beyond what the data says. English only; new strings carry `lang="en"` where the region may be in another language. Field labels, help text and example values come from the field dictionary and the domain schema (one copy), so the screen cannot drift from the standard.

## 16. Not in this screen

Recording the 13 readiness dimensions and releasing a route (Control Center, unchanged). Reading a proposal queue (Control Center). Restoring an old version of the facts (a correction is a new save; no restore button is drawn, because the record is append-only). Editing the sourcing block itself (the guided form, while the sourcing control is open). Any country-specific branch, field or word in code. Real payments, outreach, payouts and the closed gates D01 to D06 and D08: a pack status opens none of them.

A History disclosure at the foot of the route view, closed, read-only: the last 5 fact versions and the last 5 pack versions, each with version, date, who and the reason, and "Show all". Fed by `history(routeId)` for facts (newest first, up to 100 rows: version, date, who, reason, and whether it was you) and `packHistory(routeId)` for packs (question 13, answered).

## 17. Questions for Guardian G68, and the answers

The 15 questions were put to G68 on 26 November 2026. The Phase 2 session answered them the same day from the fixed 2b and 2c contract (2a is PR 673; the 2b build had started on a branch of its own). Names below are as that session gave them and are not yet merged code, so the build re-checks them against main before use.

| No  | Subject            | Answer used by this spec                                                                                                                                                                                                                                                                                   |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Derived data       | `overview()` returns per route the section states, `pendingCore`, `staleCore` and `pendingOptionalCount` from the one shared `deriveCompleteness`. The page only renders it.                                                                                                                               |
| 2   | Capability markers | `capabilities()` returns `routePackForm`, `contentInstalled` and `onePersonPublication`, works before install and is also inside `overview()`. Drives the switch-off page and the pre-2a "propose only" state.                                                                                             |
| 3   | Pack history       | `packHistory(routeId)`: per pack version `publishedBy`, `proposedBy`, `proposalReason`, `decisionReason`, `reviewed`, `proposedAndPublishedByYou`.                                                                                                                                                         |
| 4   | One confirmation   | One request, `publishReviewed`, propose then decide inside the 5-minute window. A retry reuses the command id (section 11.1).                                                                                                                                                                              |
| 5   | Effective date     | Optional, the server uses now. The editor sends none.                                                                                                                                                                                                                                                      |
| 6   | Dry run            | Needs `audit.read` (owner or admin), no step-up. Save needs `config.manage` plus step-up. The report carries per route: will be added, changed pack fields, facts added, changed and removed with labels, section marks, skipped rows, completeness, go-live; and errors with row, route, key and message. |
| 7   | Blank template     | Built in the page from the schema (`blankSheetRows(route)`); no endpoint.                                                                                                                                                                                                                                  |
| 8   | Formula safety     | Export writes every cell through `csvCell`, which prefixes an apostrophe to cells starting with `=`, `+`, `-`, `@`, tab, CR or LF; import strips it, so export then import gives no change.                                                                                                                |
| 9   | Client precheck    | `goLiveCheck` is pure and importable from `@corridra/domain/route-pack-standard`. The page uses it for the disabled-with-reason choices; the server re-checks and is the authority.                                                                                                                        |
| 10  | Admin read         | Every staff role reads content and history and exports under `missions.read`.                                                                                                                                                                                                                              |
| 11  | Readiness line     | `overview().routes[].readiness` gives `packId` and `completeMissionTypes` for the current pack; null unless the reader is owner or admin.                                                                                                                                                                  |
| 12  | Concurrent save    | Append takes the whole document and the next version. A conflict answers 409 `ROUTE_PACK_CONTENT_CHANGED`; the page re-reads the overview. There is no partial-changes call.                                                                                                                               |
| 13  | History read       | `history(routeId)`: up to 100 rows, newest first, with version, `createdAt`, `createdBy`, `createdByYou` and reason.                                                                                                                                                                                       |
| 14  | No-pack route      | `publishReviewed` with no current pack creates version 1 as Draft with the carried defaults. The guided form keeps its fields.                                                                                                                                                                             |
| 15  | Dialog width       | No contract impact. Decision: the import review stays inside the 32 rem `Dialog` (lists, not tables).                                                                                                                                                                                                      |

Error codes the page turns into the words of sections 8.8, 9.2, 11.4, 11.6 and 12.1: `ROUTE_PACK_INVALID` 400, `ROUTE_PACK_CUSTOM_KEY_CONFLICT` 409, `ROUTE_PACK_CONTENT_CHANGED` 409, `ROUTE_PACK_COMMAND_REUSED` 409, `ROUTE_PACK_GO_LIVE_PENDING_CORE` 409, `ROUTE_PACK_CORE_TURNS_PENDING` 409, and 404 while the module is inactive. The export and import routes are the team-control actions `route-pack-export` (GET, `routes=BD-CN|CN-BD`) and `route-pack-import` (POST `{mode, csv, saveId?, reason?}`), both 404 while `CORRIDRA_ROUTE_PACK_FORM` is off, which is the switch-off state.

G68 decisions on the open items (26 November 2026):

- **A. Custom key conflict words.** Decided: `ROUTE_PACK_CUSTOM_KEY_CONFLICT` names the key and the other route, within the same workspace only. The page shows: "custom.x is already a list on EU to Bangladesh. Use the same type or a new name."
- **B. Readiness shape.** Answered by the route pack session on 26 November 2026: `readiness` is `{ packId: string; completeMissionTypes: string[] } | null`; `completeMissionTypes` is a list of mission type keys and is `[]` when none is complete; `packId` is always the current pack; null when there is no pack or the reader is not owner or admin. Section 8.1 uses it as written.
- **C. Dry run for an admin.** Decided: the check is drawn for owner and admin; Save is drawn as the service permission allows, disabled with its reason for the roles that cannot save. Export stays owner and admin only as this spec's design choice.

## 18. Definition of done for the build PR (UI/UX.v4)

- [ ] `docs/agents/ui-direction.md` read in the session; "How to build a new screen" followed; this spec named in the PR.
- [ ] Screenshots at 320, 390, 768, 1024, 1440 and 1920, each state in section 13, with the switches off and on; the off state byte-equal in structure to main.
- [ ] Page length measured on a production build, inside budget, disclosures closed.
- [ ] Axe clean on every state; keyboard path through list, view choice, a field edit, Save Route Facts, Change Pack Status and Import works; focus visible; targets 44 px.
- [ ] `node --test tests/design-system.test.mjs tests/design-system-guard.test.mjs` passes, no baseline raised; `pnpm test:ux` counts did not rise; `pnpm test:operator` run.
- [ ] Copy has no em dashes, Title Case actions, "sample" only.
- [ ] No original action, route, id, payload or permission removed or changed; the new components are in the shared components table.
- [ ] Tests: the three go-live refusals reach the page in words; an admin sees no Edit, Change or Status control and a disabled Save in Import with its reason; the pre-2a publish says a second owner is needed; export then import shows no change in the dry run; a refused file saves nothing.
- [ ] The work log lists what was run and what was not. A control without a working backend is reported missing, never shipped.
