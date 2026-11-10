# Workflow intelligence and plain-language programme

Document status: CURRENT.

Owner mandate, 10 November 2026, given directly to session S17 (`session_0187kU9tKW97MLLTBWV9mtvY`, Opus): improve Corridra's commercial workflows, journeys, interface quality and development execution, prove each improvement, and preserve every authorised action. The owner's definition of success, verbatim: "Users(of 5th grade 12th grade literacy level) should know why they are on each screen, what they can do, what happens next, and how to progress toward a real commercial outcome." The mandate also says: "Never infer release authorization from this prompt" and asks for approval before any persistent tool installation.

This spec adds scope inside the [V3 revamp](../README.md). It never overrides the [V3 contract](../../V3_CONTRACT.md), the [UI direction](../../agents/ui-direction.md), the [AC/1 design system](../../design-system/README.md), the [layout budget](layout-budget.md) or an accepted ADR. Merges follow the current lanes rule (exact-head green CI plus Guardian PASS, the owner merges migrations and installers). Live state stays in the [ledger](../../V3_LEDGER.md).

## 1. Reality audit at main `9c48ead5`

Sources: `docs/revamp/COVERAGE.json` (127 routes, 79 IMPLEMENTED, 48 GATED, none VERIFIED), a read-only code map of five journeys, and direct reading of the files cited. "Verified" below means read in source by S17, not runtime acceptance.

| Area                          | State                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public intake `/plan`         | Implemented; real mode deployed under ADR056; runtime journey unverified | 5 steps (Goal, Where, Details, Results, Contact), about 16 to 25 fields, step list at `apps/web/app/plan/intake.tsx:113-124`; draft kept 24 hours in the tab (`intake.tsx:399`, `:1014`, `:1528`)                                                                                                                                                    |
| Account need in real mode     | Implemented, disclosed on the first screen                               | The page lead (`plan/plan-head.tsx:11-16`) and the request notice (`intake.tsx:943-950`) both say an account is created at the final step; the password (at least 14 characters) is asked only on step 5 (`intake.tsx:1453-1495`). Corrected 10 Nov 2026 after the Guardian review of PR 379: the first audit said "disclosed late", which was wrong |
| Customer Home and Work        | Implemented, several parts gated                                         | `apps/web/app/account/page.tsx` with views home, work, results, more                                                                                                                                                                                                                                                                                 |
| Request Room (sell or source) | Implemented behind `CORRIDRA_UX_ROAD`                                    | One next step chosen by state (`account/rooms/[requestId]/room-view.tsx:136-183`); the idle state names the Corridra team as holder                                                                                                                                                                                                                  |
| Decision and quote compare    | Implemented, gated by customer decision switches                         | `account/missions/[resourceId]`; the room and the mission page are two screens for one decision (overlap not yet measured)                                                                                                                                                                                                                           |
| Delegation organiser          | Implemented, gated by `CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED` and others  | `/account/delegations/organise` shows only a workspace chooser before any programme work (`organise/page.tsx`)                                                                                                                                                                                                                                       |
| Operator Today                | Implemented                                                              | "Needs you now" counts only new requests and overdue missions (`operator/today.tsx:172-190`); customer questions, supplier or buyer replies and evidence waiting for review live in other sections                                                                                                                                                   |
| Operator mission page         | Implemented                                                              | 8 tabs; Companies, Quotes and Meetings tabs summarise and link out (`operator/[section]/[missionId]/mission-page.tsx:26-35`)                                                                                                                                                                                                                         |
| Reading level of copy         | Not measured anywhere                                                    | No readability check exists in `tests/` or `scripts/`; the UX gate checks layout, targets, focus and axe only. The plain-language rules in the UI direction (sentences under 20 words, common words) have no automated guard                                                                                                                         |
| Rejected finding              | Not a defect                                                             | `/account` links to `/plan#receipt-check`, which is hidden only for private programme submissions (`intake.tsx:318`, `:1629`), a mode an account visitor does not reach from that link                                                                                                                                                               |

## 2. Journey improvement matrix

| Journey                           | Current experience (verified in source)                                   | Defect                                                                                   | Intervention                                                                                               | Expected benefit (reasoned, not measured)                        | Batch |
| --------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----- |
| All, every screen                 | Copy written to rules nobody measures                                     | Long or hard sentences for readers at grade 5 to 12 cannot be found or kept from growing | Reading-level measurement in the UX gate with a baseline that may only fall                                | Every later copy change shows a before and after number          | W1    |
| A, B, C customer copy             | Hints and notices on `/plan` and customer screens                         | Sentences above the measured limits (list produced by W1)                                | Rewrite the worst non-legal sentences in plain words; legal, privacy and consent text untouched            | Lower grade and fewer long sentences, measured by W1             | W2    |
| E operator                        | "Needs you now" shows new requests and overdue missions only              | Waiting customer questions and counterparty replies are not in the first view            | Surface existing pending counts from existing endpoints in Today, each linking to its section; no new data | The next useful action is visible without opening other sections | W3    |
| D organiser                       | Workspace chooser before any programme work                               | An extra step for the common one-workspace case                                          | When exactly one programme workspace exists, show it as the primary action; the chooser stays for more     | One fewer decision on the most frequent path                     | W4    |
| A, B, C waiting state in the Room | Idle next step says the team is working; primary button opens the request | Holder wording differs from the glossary ("Waiting on the Corridra team")                | Align the idle state with the glossary words; keep every destination                                       | One word per idea across screens                                 | W4    |

Not changed by this programme: the mission stage command (reason, owner, next action and due date are domain-required in `packages/domain/src/missions.ts:145-168`), permissions, payloads, element names and ids, money, evidence and consent semantics.

## 3. Tool decisions

Read from each repository's README on 10 November 2026. No tool is installed. Any install needs the owner's approval and goes in its own PR.

| Tool                                                    | Decision                     | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Impeccable (`pbakaus/impeccable`, Apache-2.0)           | Hold install; use the method | Its installer offers an edit hook that runs even when commands are denied, a live mode whose Apply can run an agent with permission checks off, telemetry, and `init` and `document` create `PRODUCT.md` and `DESIGN.md`, which would compete with the UI direction and design system. No release tag to pin. Its critique and audit questions are used as review prompts by the S17 reviewer without installing anything. If the owner wants it: project scope only, no hook, telemetry off, no `init` or `document`, pinned by commit. |
| Graphify (`Graphify-Labs/graphify`, Apache-2.0 and MIT) | Reject for now               | Installs a search hook that can deny Read and Grep, writes `graphify-out/`, and a commit hook. The repository already has a deterministic inventory (`scripts/v3-inventory.mjs`, `COVERAGE.json`). Reconsider only for a change that spans several packages where the inventory is not enough.                                                                                                                                                                                                                                           |
| Diagram Design (`cathrynlavery/diagram-design`, MIT)    | Hold; draw by hand           | No hooks stated, but it loads web fonts and writes profile files outside the repository. Diagrams here are drawn only when a decision needs one, as plain SVG with AC/1 tokens.                                                                                                                                                                                                                                                                                                                                                          |
| Superpowers (`obra/superpowers`, MIT)                   | Reject install               | A start-of-session hook, skills that trigger themselves, worktrees and parallel agents conflict with AGENTS.md. The useful practices already exist here: `scripts/gate.mjs`, `pnpm preflight`, test-first cases named by id, and evidence-backed completion.                                                                                                                                                                                                                                                                             |
| Taste Skill (`Leonxlnx/taste-skill`, MIT)               | Reject                       | A Stop hook finish gate, copied assets and photography for marketing sites conflict with AC/1 and the content rules.                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 4. Batches

One branch at a time (branch cap below nine). Each batch is one PR, built by a Sonnet session on the S17 branch and reviewed by S17 before it is marked ready for the Conductor.

### W1. Reading-level measurement (tooling only, no product change)

Files: `tests/ux/readability-lib.ts`, `tests/ux/readability.spec.ts`, `tests/ux/readability-baseline.json`, unit cases for the scoring functions, and this spec.

1. Same routes as the UX gate (every static public route, signed-out), production build, 1440 px wide, default state.
2. Read visible prose only: `p`, `li`, `dd`, `figcaption`, `.guide-hint`, `.field-hint` and `[role=alert]`/`[role=status]` blocks of at least five words, outside the site header, its navigation and the site footer (headers inside the page content are read), in English (`lang` absent or `en`). The footer is measured once, on `/`, under its own key.
3. Per route: words, sentences, Flesch-Kincaid grade over all prose, the count of sentences over 20 words, and the count of hard sentences (at least 8 words and a sentence grade above 9).
4. The baseline may not rise for long or hard sentences; the route grade may not rise by more than 0.5. New routes start from their measured values only with an explicit update flag, as the UX gate does. Lower the baseline when copy improves; never raise it.
5. A local report (in `work/`, not committed) lists the 20 worst sentences per route for W2.
6. Unit cases (named `R-01` and up) pin the syllable counter, sentence splitter and grade formula on fixed sample text.
7. The grade is an approximation for English; it guides plain words and never replaces native review or user testing. No screen claims a reading level.

Acceptance: the spec passes on the current build with the recorded baseline; unit cases pass; `pnpm format:check`, `lint`, `typecheck`, `test`, `build` and `test:ux` pass; no file under `apps/` or `packages/` changes.

#### W1 build notes

Built on the production build at `53913e55`, 1440 px wide, default state. Baseline recorded with `READABILITY_UPDATE_BASELINE=1`; two later runs gave byte-identical reports. The report is written to `work/ux-gate/readability-report.json`, the folder the CI ux job uploads.

- Route set: exactly the UX gate's own walk of `apps/web/app` plus the corridor pages, now kept in `tests/ux/static-routes.ts` and imported by both specs. That is 51 routes, plus the footer under `/#footer`, 52 baseline entries. Eight are not measured: `/account` and `/coming-soon` redirect (to `/signin` and `/`), and `/account/all-tools`, `/account/meetings`, `/account/move`, `/account/notifications`, `/fairs` and `/operator/owner` are unavailable in the signed-out build. Four account routes (`/account/billing`, `/account/profile`, `/account/service-requests`, `/account/delegations/organise`) render the same sign-in prompt in place, so they carry identical numbers.
- Measured: 43 routes plus the footer, 2,108 words in 248 sentences. `/account/companies`, `/account/service-requests/new` and `/decision-card` have no prose block of five words in their default state, so they record 0 words.
- Totals: sentences over 20 words 1 (on `/sell`); hard sentences 41; grade median 6.4 and maximum 26.5 over the 41 entries that have prose. The maximum is `/account/delegations`, a single five-word sentence ("Sample delegation participation is unavailable."), so it says little. The highest grade on a page with at least ten words is `/operator/reset-password` at 14.2, then `/operator/setup` at 12.4.
- Five worst routes by hard-sentence count: `/about` 11 (grade 10.8); `/institutions` 4 (9.8); `/privacy` 4 (8.7); `/operator/setup` 3 (12.4); `/contributor/setup` 3 (10.0). `/machinery`, `/corridors/bangladesh-china` and `/enter-market` follow with 2 each.
- `/plan` records 36 words in its default state (7 sentences, grade 3.5, no hard sentence), which includes the page lead in `header.guide-plan-head`. Its later steps and hints behind a closed disclosure are not read, so the W2 rewrite list for `/plan` needs a second look at those steps.
- Baseline regenerated after the Guardian review of PR 379. The first version took its routes from a filtered inventory and dropped every `header`, so it missed 25 routes and the in-content headers. Both fixes change what is measured, so the file was deleted and recorded again from scratch instead of merged. Against the first file, 25 routes are new and only `/plan` changed (28 to 36 words, because its page lead is now read); every other earlier route has the same numbers. From now on an update run keeps the lower of the old and new long, hard and grade for a route (words and sentences take the new values), takes new routes as measured, and still fails when a route changes kind.

Limits of the measure, plainly:

- The syllable counter is a vowel-group rule with a short exception list. It is often right and can be off by one on words such as "business", "every" or "doesn't". Short pages swing by a grade on one word.
- The sentence splitter knows a short list of abbreviations. A block with no closing mark, such as a list item, counts as one sentence. "U.S." at the end of a sentence does not end it.
- Only English prose in `p`, `li`, `dd`, `figcaption`, alerts, status blocks and the two hint classes is read. Headings, button and label text, and anything in the site header, a `nav` or the site footer are not (the footer is read once, on `/`; headers and footers inside the page content are read). A block that holds another prose block is read through the inner one only.
- Only the default state is read. Closed `details`, later steps, signed-in pages and other languages are not measured.
- The numbers guide plain wording. They are not a reading-level claim for any screen and never replace native review or user testing.

### W2. The worst copy

Withdrawn item (10 Nov 2026): an early account notice on `/plan`. The first screen already says it twice (see the audit), so a third line would add words, not clarity. Withdrawn after the Guardian review of PR 379 showed the page lead the first audit missed. The early Sign In link that came with it is dropped too: the first screen's notice already offers sign-in at the final step.

1. Rewrite the worst English sentences from the W1 report on `/plan` hints and public non-legal pages. Legal, privacy, consent and the owner-locked home headline are excluded. Each rewrite lowers the W1 numbers, and the baseline is lowered in the same PR.
2. `/plan` stays inside its confirmed limits (2.6 phone, 1.85 desktop) in `tests/browser/layout-budget-plan.spec.ts`.
3. `Sensitive: yes` (public unauthenticated route): needs Guardian PASS.

### W3 and W4

Specified in this file before their build, after W1 and W2 merge, with their files and tests read first.

### W4. Request reference in view, quiet idle step in the Room

Owner, 10 Nov 2026, in S17: "use the free branch slots to run W3 & others in parallel 100% correctly without rework, reruns etc". This lifts the order "after W1 and W2 merge" for W4. Built by S24 in PR 384. Presentation only, on signed-in customer pages.

1. Request page (`apps/web/app/account/requests/request-detail.tsx`): the overview card shows "Reference: <request id>" under the received date, with the hint "Quote this reference when you contact the Corridra team." The id is the customer's own request id, already shown in the closed "Request reference" disclosure at the bottom of the page, which stays exactly as it was.
2. Room (`apps/web/app/account/rooms/[requestId]/room-view.tsx`): when there is nothing for the customer to do and service requests are off (`next.act === 'request'`), "Open the Request" is a quiet `text-link` instead of a primary button. It is the same element, the same address (`/account/requests/<id>`) and the same words. Every other next-step state keeps its primary action.
3. In that idle state, the default words are "Waiting on the Corridra team" (glossary, UX update amendment), and a subline still comes first when one exists.
4. Preserved: every link destination, element, id, name and test hook; the "Request reference" disclosure; the Room's Overview link to the request.
5. Tests: W4 cases in `tests/operator/v3-customer-request-detail.spec.ts` and `tests/operator/ux-room.spec.ts`. They fail on the code before W4, and no existing assertion changes.
6. Matrix row "D organiser" is not part of W4 and is withdrawn: `apps/web/components/workspace-chooser.tsx:61` already opens the only workspace directly when a person has exactly one, so the one-workspace shortcut exists.

### W5. Operator section links keep the mission

Owner, 10 Nov 2026, in S17: "use the free branch slots to run W3 & others in parallel 100% correctly without rework, reruns etc" and "close the dependabot PRs to free slots for W4 and W5, if they are not required". Built by S25 in PR 387. Operator presentation only: no data, route, permission or schema change.

The mission page's links to whole workspace sections (`apps/web/app/operator/[section]/[missionId]/mission-page.tsx`, `sectionHref`) did not carry the mission, so the operator had to find it again. Each destination was checked first (GO or STOP):

1. Research (`apps/web/app/operator/counterparties.tsx`): GO. It already holds a selected mission and lists missions it is allowed to read (one read of up to 100). The link "Find and add companies" now adds `&mission=<id>`.
2. Commercial progress (`apps/web/app/operator/opportunities.tsx`): GO. Its first response already lists the missions. The link "Quotes and billing" now adds `&mission=<id>`.
3. Meetings (`apps/web/app/operator/access.tsx`): STOP. It has no selected-mission state, only meeting targets, so its link is unchanged.
4. Delivery (`apps/web/app/operator/delivery.tsx`): STOP. Its mission choice sits in a closed disclosure on another tab and only for owners and admins, so a preselection would be invisible or wrong for other roles. Its link is unchanged.

For the GO sections the mission in the address is only a hint. It must be a well-formed id (`apps/web/app/operator/mission-hint.ts`), it is applied once after the section's own list loads, and only when that mission is in the list. Otherwise one plain note says "This mission is not in the list shown here." and the section is as before. A choice the operator makes always wins. Selecting the mission triggers only the read the section already makes when someone selects it by hand. The real `/operator` page reads only `workspace` from the address and rewrites it only when the operator switches workspace, so the hint survives a normal click. Section addresses are `#workspace-research` and `#workspace-commercial`, which the operator router accepts.

Tests: `tests/operator/w5-mission-context.spec.ts`, W5-links and W5-research and W5-commercial (listed, malformed, not listed, later choice wins), 9 cases; 7 fail with the source change reverted.

### W8. One list of all meetings

Owner, 10 Nov 2026, in S17: "For signed in users, there multiple navigation links as placeholders now in different menus on the header and others, we need to make them 100% functional(as per the latest prodcut vision and ambitions, ux/ui & other requirements), instead of just placeholders witth coming soon." Customer presentation only, signed in: no migration, no new permission, route or switch, and no data the person cannot already open.

`/account/meetings` (the Meetings tab, behind `CORRIDRA_UX_SHELLS_V2`) said "One list of all your meetings" with a "Coming soon" tag. It now lists every meeting and visit from the person's own saved reports, in one place. Each source was checked first (GO or STOP):

1. The person's requests (`apps/web/lib/work-items/load.ts`, `loadWorkItems`): GO, unchanged. The page already read it. Only these request ids are ever used.
2. Assigned missions (`customerAssignedMissions.list`, pages of 25, followed up to `movePageCap`, as `apps/web/lib/home-journeys/load.ts` does): GO, unchanged. `roomLinkFor` picks the one saved report for each request, exactly as the Room does. A list that failed or was cut short never labels a request "not saved".
3. The saved report (`customerSavedMissions.command` view, audience `CLIENT_PROGRESS`, the same session proof the saved report page uses): GO, unchanged. At most `meetingReportCap` (12) reports are read in one page load, at the same time. Each result goes through the same `report()` check the report page uses, and only the itinerary block is kept (ADR 0076: no price, offer, contact or export).
4. A request whose report is not saved to the Library: STOP. It is not read, because the Room cannot show it either. The page says so in plain words and links to the Library, the same next step the Room gives.
5. More than 12 saved reports: STOP for the extra ones. A plain notice says some meetings may be missing, and the person can open a request to see all of its meetings.
6. Delivery or saved-missions module off: STOP. No report is read; one plain sentence replaces the groups and the requests list stays.
7. Operator Meetings (W5 STOP) and organiser programme meetings (ADR 0075): not touched.

What the page does:

- Meetings are grouped by their start time against the server clock: "Coming up" (soonest first), "Done and past" (newest first), "Time not confirmed yet", then "Date changed". A dated meeting is past when its end (or its start, when there is no end) is before now; equal to now is still upcoming. Status never decides the group; the badge tells the status.
- A changed schedule (`isChangedMeeting`, the Trip rule) keeps only its name, the "Date changed" badge and the changed sentence. The old time, zone, place and status are dropped on the server, so they are not in the page text, attributes or `dateTime`.
- Each row shows name, Starts and Ends with the time zone, Place (text only, "Not shared yet" when absent), status badge, request title and a link "Open in the Request". The first three meetings show, then "Show All N Meetings and Visits". Names and places in Chinese are marked `lang="zh"`.
- The link opens the Room on Meetings (`?view=meetings`) when `CORRIDRA_UX_TRIP`, `CORRIDRA_UX_ROAD` and `CORRIDRA_UX_LENSES` are all on; otherwise the saved report at `/account/missions/<id>`, where the times are today. The Room reads `?view` only when the value is exactly `meetings` and the Trip and lenses switches are on; anything else opens Overview.
- A read that fails, an incomplete assignment list or a capped read shows the partial notice. The page never says "no meetings" when nothing was read.
- Copy is English only (the page has no reviewed translation), with no price, offer, contact, result or booking claim.

Files: `apps/web/lib/saved-report-check.ts` (the report check, a pure move), `apps/web/lib/trip.ts` (`statusWords`, a pure move), `apps/web/lib/meetings/{load,group,cards}.ts`, `apps/web/lib/room.ts` (`initialLensFor`), `apps/web/app/account/meetings/{page.tsx,meetings-list.tsx}`, `apps/web/app/account/rooms/[requestId]/{page.tsx,room-view.tsx,room-view.css}` (one selector added). The two pure moves were proved with `diff` against the old lines.

Tests: `tests/integration/w8-meetings.test.ts` (grouping, status map, cap, `?view` parsing, loader with mocked services, source checks), additions to `tests/integration/revamp-nav-customer-model.test.ts` and `tests/integration/ux-trip.test.ts`, `tests/operator/w8-meetings.spec.ts` (real component: language marks, times, badges, link names, widths 320, 390, 768 and 1440, axe), one case in `tests/operator/ux-room.spec.ts` (the Room opens on Meetings when asked), and the stricter replacement of the "Coming soon" case in `tests/e2e/verification/revamp-s2/customer-shell.spec.ts`.

With the source change reverted (tests kept), every new case fails: 33 in `w8-meetings.test.ts` (the file cannot load), 4 added to `ux-trip.test.ts`, 1 added to `revamp-nav-customer-model.test.ts`, 20 in `w8-meetings.spec.ts` (the fixture cannot build), 1 in `ux-room.spec.ts`, and the replaced case in `customer-shell.spec.ts` at all three widths of its project. That is 59 new cases, all failing, and the replaced case, which fails too. Measured page length of the closed list (three of twelve long Chinese meetings, three requests, in the customer frame, without the intro and notices): 2.28 screens at 390 and 1.54 at 1440, over the layout-budget limits of 2.0 and 1.0; this is reported to the owner and not hidden. The Meetings page was not walked signed in against a live account: no such claim is made.

## 5. Measurement

Measured for each changed journey: steps and fields before and after, repeated inputs removed, reading-level numbers from W1, UX gate counts, and the page lengths from the layout budget tests. Conversion, satisfaction, revenue and speed are not claimed: no measurement for them exists.
