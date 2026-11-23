# Journey Modes (options A + B combined): implementation brief

Document status: CURRENT. Owner-approved spec (23 November 2026). Not built yet; built by unit J of the [commercial-ready run](../commercial-ready-run-2026-11-23.md).

Target: one draft PR on `sadat99/corridra`, branch `claude/journey-modes`, behind a new switch, off by default.
Written 23 Nov 2026 against main `d6a0865`, revised the same day with the owner's answers. Built from the code, not from plans. Every fact below was read in the repository; items marked ASSUMPTION or NOT VERIFIED were not.

## 0. Start here (process, do not skip)

1. Follow `CLAUDE.md` startup: `git status --short`, fetch main and open PRs, `node scripts/v3-context.mjs` and `node scripts/v3-context.mjs verify`, load `corridra-squad`, run `corridra-authority` first. This brief does not replace authority resolution; if the Authority Brief contradicts a fact here, the repository wins and you say so.
2. This is a visible change under `apps/web`: UI/UX.v4 is binding (`docs/agents/ui-direction.md`: "Current locked decisions", "How to build a new screen", "Definition of done for any visible change"). Use tokens, `CorridraIcon`, `components/ux/`. No raw colours, no inline px or type sizes. `tests/design-system-guard.test.mjs` enforces it.
3. Record the owner decisions first-hand in the ledger and work log, in the owner's words, all dated 23 Nov 2026:
   - on seeing the options page: they liked the recommendation, "option A+B. combined", and asked for it to be planned and then implemented in one go;
   - a person with no work yet: "Show switcher";
   - the quiet "N elsewhere" count on the closed switcher: "nice";
   - the switcher when work exists in one journey only: "always show";
   - the prompt on a request page: "This request is in Sourcing. Switch to Sourcing" (the owner pasted this exact wording; build it).
     The owner has not yet seen a rendered build. So: switch off by default, and the owner flips it after a signed-in pass.
4. Next.js here is 16.4.5 and `apps/web/AGENTS.md` says its APIs differ from training data. `node_modules` was not installed when this was written. After `pnpm install`, read the cookies and dynamic rendering guides in `apps/web/node_modules/next/dist/docs/` before writing any cookie code. `cookies()` from `next/headers` is async in this version; the repo already awaits it (`app/api/intake/pending/route.ts`).
5. Long checks go through `node scripts/gate.mjs NAME -- COMMAND`. Run the UX gate against a production build, never `next dev` (KI-18). Read `docs/v3/KNOWN_ISSUES.md` before debugging CI.

## 1. What the owner asked for, in plain terms

- While a person works in one journey, the sidebar and the pages show only that journey. They can switch to another journey instantly from the sidebar, at any time.
- The switcher is always there for everyone (new people, one-journey people, many-journey people).
- If they open a request that belongs to a different journey than the one they are in, the page offers to switch.

## 2. Verified facts that shape the design

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                  | Where                                                                                                   | Consequence                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | There are three journeys, not four: Sourcing (`source`, family `SOURCE`), Organising (`organise`, `ORGANISE`), Selling (`sell`, `SELL`). Programmes and Registrations are Organise, not a fourth journey.                                                                                                                                                                                             | `app/account/move/journeys.ts`, `lib/work-items/types.ts`                                               | Modes are `all`, `source`, `organise`, `sell`.                                                                                                                                    |
| 2   | Work items carry an explicit `family`, and `UNCLASSIFIED` exists ("Other"). Classification is explicit only, never guessed.                                                                                                                                                                                                                                                                           | `lib/work-items/classify.ts`                                                                            | Unclassified work shows under Everything only. Never drop it silently.                                                                                                            |
| 3   | The Requests page already filters by journey: `/account?view=work&work=source                                                                                                                                                                                                                                                                                                                         | sell                                                                                                    | organise                                                                                                                                                                          | other | all`, parsed by `parseWorkFilter`, driven by `WorkFilterBar`. | `lib/work-items/view.ts`, `app/account/work-filter.tsx` | Requests scoping needs no data work. |
| 4   | Your Move already has a journey switch, remembered per browser in localStorage (`corridra.home.journey`), `?journey=` always wins, auto-hidden for single-journey people (owner, 5 Nov 2026).                                                                                                                                                                                                         | `app/account/move/move-view.tsx` lines 51 to 90                                                         | Leave that in-page switch as it is, including its auto-hide. There must be ONE source of truth for the chosen journey, not two.                                                   |
| 5   | The sidebar's Your Journeys links open `/account/move?journey=X`, with quiet counts equal to the Requests "Your work" number, streamed and shared per request. Rules L16 (ui-direction.md line 99): quiet badge, not a coloured alert, zero not drawn, "N+" when incomplete, spoken name, no extra read where the page already reads the list.                                                        | `lib/ux/customer-navigation.ts`, `components/ux/customer-rail.tsx`, `lib/work-items/journey-counts*.ts` | Counts on the switcher follow L16 exactly.                                                                                                                                        |
| 6   | Meetings are built from the person's request list (`loadMeetings(..., requests)`), and `requests` come from `loadWorkItems`. Delivered reports carry `requestId`.                                                                                                                                                                                                                                     | `app/account/meetings/page.tsx`, `packages/auth/src/customer-delivered-reports.ts`                      | Meetings and Reports can be scoped by the family of their request. No data change, no migration.                                                                                  |
| 7   | Companies (the approved companies portfolio) is per workspace and has no journey.                                                                                                                                                                                                                                                                                                                     | `app/account/companies/page.tsx`                                                                        | Companies stays shared. Say so on the page; do not pretend it is scoped.                                                                                                          |
| 8   | Phones use a drawer only. No bottom tab bar (owner, 14 Nov 2026, "B"). The same `CustomerSideNav` renders in the drawer.                                                                                                                                                                                                                                                                              | ui-direction.md line 46, `components/customer-shell.tsx` comments                                       | The phone pattern is the switcher at the top of the drawer. No new bottom bar.                                                                                                    |
| 9   | `CustomerShell` is called by each page, not by a layout. Pages use `export const dynamic = 'force-dynamic'`. `CustomerFrame` is a synchronous server component.                                                                                                                                                                                                                                       | `components/customer-shell.tsx`, `app/account/page.tsx`                                                 | The frame can become async and read `cookies()`. Verify every page that renders `CustomerShell` is dynamic (work package 8).                                                      |
| 10  | Switches are named in `lib/ux-switches.ts` and described in `lib/owner-switches.ts`; a test fails when a name is read but not described. With every switch unset a page is byte for byte what it was.                                                                                                                                                                                                 | those two files                                                                                         | The new switch must keep the off path identical.                                                                                                                                  |
| 11  | The left bar has a collapsed (icons only) state and a drawer state. Opening a `<summary>` in the collapsed bar first widens it (`onClickCapture` in `left-nav.tsx`). The drawer traps focus and handles Escape at document level.                                                                                                                                                                     | `components/ux/left-nav.tsx`                                                                            | Build the switcher as an inline `<details>`/`<summary>` disclosure, not a floating popup menu, so it works in the drawer and in the collapsed bar with no nested-Escape conflict. |
| 12  | One workspace switcher exists (avatar menu), by owner decision 6 Nov 2026. "Workspace" means the customer's company.                                                                                                                                                                                                                                                                                  | `tests/integration/ux-one-workspace-switcher.test.ts`                                                   | The new control is called **Journey**. Never "workspace", never "module".                                                                                                         |
| 13  | About 36 test files reference the customer shell or sidebar.                                                                                                                                                                                                                                                                                                                                          | `grep` of `tests/`                                                                                      | With the switch off, none may need to change. That is an acceptance rule.                                                                                                         |
| 14  | The Room already knows its own journey: `room-view.tsx` computes `classifyObjective(original?.objective)` and a `journey` (null when unclassified). The saved request page `app/account/requests/request-detail.tsx` also carries the request's objective. The programme rooms live under `/account/delegations/<workspace id>` and are always Organise (`customerGroupHere`, `PROGRAMME_ROOM_PATH`). | `app/account/rooms/[requestId]/room-view.tsx` lines 141 and 164                                         | The "Switch to Sourcing" prompt (3.9) needs no work-list read and no new data.                                                                                                    |

## 3. Product behaviour (the spec)

### 3.1 Terms and modes

- Control name: **Journey**. Values: Everything, Sourcing, Organising, Selling (`all | source | organise | sell`).
- All words are English, marked `lang="en"` where the chosen language has no reviewed text (the existing pattern in `customer-shell.tsx`). Actions in Title Case (`tests/integration/title-case-scan.ts`).

### 3.2 When the switcher exists

- ALWAYS, for every signed-in customer, whenever `CORRIDRA_UX_JOURNEY_MODES` is on (owner, 23 Nov 2026: "always show"). No hiding by activity, no hint cookie, no flip between shown and hidden. It lists all three journeys plus Everything, whether or not each has work. Choosing a journey with no work is allowed and shows that page's normal empty state.
- Counts are decoration only: they stream in from the existing `readJourneyCounts()` (shared `loadWorkItems` cache) and the control is fully usable before and without them. If counts are unreadable (`null`), draw the control with no counts.
- Groups (Programmes, Registrations) keep today's gates and are never hidden by activity, because a participant in someone else's programme has no work item and must still find Registrations.
- Home's own in-page switch keeps its existing auto-hide for single-journey people. That is a different control and is not changed.

### 3.3 Sidebar composition per mode

| Mode                | Top                           | Five destinations (order unchanged)                                                                | Groups                                                            |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Everything          | Switcher (shows "Everything") | Home, Requests, Companies, Meetings, Reports, exactly today's hrefs                                | As today (gated)                                                  |
| Sourcing or Selling | Switcher                      | Home `/account/move?journey=J`, Requests `/account?view=work&work=J`, Companies, Meetings, Reports | Not drawn                                                         |
| Organising          | Switcher                      | same with `J = organise`                                                                           | Programmes and Registrations, with their existing gates and icons |

- The Your Journeys group is replaced by the switcher when the switch is on. It stays when the switch is off.
- Companies keeps its place and href; it is not scoped (fact 7).
- Exception: on a Groups page (`customerGroupHere(pathname)` is not null) the Groups group is drawn in any mode, so a deep link from an email never leaves the person with a sidebar that omits where they are.
- At most five primary choices per level stays true.

### 3.4 The switcher control

- A `<details class="ux-journey-switch">` inside `CustomerSideNav`, first thing in the nav, above the five destinations. `<summary>` shows the dot (existing `data-tone` mapping: Sourcing action, Organising positive, Selling ornament; Everything has no tone), the current name, and a chevron. Accessible name like "Journey, Sourcing".
- Open state is an inline list of four buttons, each with its quiet count (`journeyCountText`, `journeyCountWords`), the current one marked `aria-current="true"`. Inline, not floating, so it works in the drawer and the collapsed bar.
- Quiet "elsewhere" count on the closed summary (owner: "nice"): the sum of the counts of the journeys that are NOT current, with spoken name ("3 pieces of work in other journeys"). In Everything mode there is no elsewhere count. Same quiet badge style as L16, never coloured. Needs the owner's eye in the signed-in pass.
- Collapsed bar (icons only, 1024 px and wider): the summary shows the dot only, name in `ux-rail-label` shown on hover and focus via the existing `useRailTip` pattern; opening it widens the bar first (existing behaviour).
- 44 px targets, visible focus, no animation (respects reduced motion by having none), forced-colours safe via tokens.
- First paint needs nothing but the cookie: the control is drawn at once from the server-known mode; counts fill in when ready, like `CountedJourneys`.

### 3.5 Switching

- Choosing a journey: write the mode cookie (3.6), then go to the same section of the new journey, as the workspace switcher does:
  - on Home (Your Move): `/account/move?journey=J` (or no param for Everything);
  - on Requests: `/account?view=work&work=J` (Everything removes `work`);
  - on Meetings, Reports and any other customer page: stay on the page and `router.refresh()`, so the page re-reads the cookie;
  - on Companies, Account, Billing, All Tools and every unscoped page: stay and refresh; only the sidebar changes.
- Put this in one pure function `hrefForJourneySwitch(pathname, search, mode)` with unit tests.
- Choosing Everything is always available and always one click.

### 3.6 State: one source of truth

- One cookie `corridra_journey`, value one of `all|source|organise|sell`. Attributes: `Path=/account`, `SameSite=Lax`, `Max-Age=31536000`, `Secure` on https. Not HttpOnly (written by client code). Closed list on read: anything else is `all`. It holds a UI preference only: no identity, no tracking, no PII. There is no second cookie.
- Mode resolution order, in one pure function `resolveJourneyMode`: page-supplied explicit mode (Home passes its `?journey=`, Requests passes its `work` when it is a journey) > cookie > `all`. Never redirect or refresh in a loop.
- Requests: `work=other` means mode `all` with the Other filter; `work=all` means `all`.
- Home: change `journeySnapshot`/`rememberJourney` in `move-view.tsx` to read the cookie first and write both the cookie and its existing localStorage key. Keep Home's own in-page switch (owner approved 5 Nov); the two controls must always agree.
- Requests chips: `WorkFilterBar.onChange` also writes the cookie. When the URL has no `work` and the cookie is a journey, the server page treats the filter as that journey, so a plain click on Requests in the sidebar lands scoped.
- Client pages that need the current mode (the prompt in 3.9) read it from a small React context, `JourneyModeProvider`, set by `CustomerFrame` from the server-read cookie around `children`. No `document.cookie` reads in render, so there is no hydration mismatch.

### 3.7 Page scoping while a journey is chosen

| Page                                                              | In a journey                                                                           | Notes                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home (`/account/move`)                                            | filtered by `?journey=` (exists)                                                       | Same cookie.                                                                                                                                                                                                                          |
| Requests (`/account?view=work`)                                   | list filtered by `work`                                                                | Show one quiet line above the list: "Showing Sourcing. Show Everything" (link sets mode `all`).                                                                                                                                       |
| Meetings                                                          | filter `requests` by family before `loadMeetings`                                      | The "Your Requests" tab shows the scoped requests. Existing partial and unreadable notices unchanged. Same quiet line.                                                                                                                |
| Reports (`view=results`)                                          | filter delivered reports by the family of their `requestId` using the shared work list | Read the whole `results` branch of `app/account/page.tsx`. Scope everything that carries a request id. Anything that cannot be scoped stays visible AND gets a quiet line saying it is not sorted by journey. Never hide it silently. |
| Companies                                                         | not scoped                                                                             | Quiet line: "Companies are shared across all your journeys."                                                                                                                                                                          |
| Search, All Tools, Account, Billing, Notifications, Pocket button | global                                                                                 | No change.                                                                                                                                                                                                                            |

- UNCLASSIFIED work: visible under Everything and the Other chip only. Everything's Requests list must still show it.

### 3.8 Phone and drawer

- No bottom bar. The switcher is the first element inside the drawer nav, above the five destinations, rendered by the same component. Test inside the open drawer: focus trap includes the `<summary>` and the buttons; Escape closes the drawer (the disclosure has no floating panel, so there is no nested Escape).

### 3.9 The "Switch to" prompt on a request page (owner wording)

- Component `JourneyMismatchNote` (client), file `apps/web/components/ux/journey-mismatch-note.tsx`, props `{ family: WorkFamily }`. It reads the mode from `JourneyModeProvider`.
- Show it only when ALL of these hold: the switch is on; the page's request or programme has a journey (family is `SOURCE`, `SELL` or `ORGANISE`, never `UNCLASSIFIED`); the current mode is a journey (not `all`); and it differs from the page's journey. In Everything mode, or when they match, draw nothing.
- Copy, exact: "This request is in Sourcing." followed by a button "Switch to Sourcing". Selling: "This request is in Selling." and "Switch to Selling". Organising: "This request is in Organising." and "Switch to Organising". On a programme page the first sentence says "This programme is in Organising." Button words in Title Case, `lang="en"`.
- Behaviour: the button writes the cookie and calls `router.refresh()`; the sidebar re-renders in the new journey, the note disappears, the page stays exactly where it is (no navigation). It is a quiet line (a `<p>`, not `role="alert"`), placed at the top of the page content above the heading area, using existing tokens and the quiet-note styling from `journey-note.tsx`. No dismiss control: it clears itself when the person switches or changes to Everything.
- Where it goes: the Room (`app/account/rooms/[requestId]/room-view.tsx`, family already computed at line 164), the saved request page (`app/account/requests/request-detail.tsx`, from the objective via `classifyObjective`), and programme rooms under `app/account/delegations/[workspaceId]` (family fixed to `ORGANISE`). Read each page before adding it; add only where the page already holds the objective or is a programme page. If one page does not carry it, skip that page and record it in the PR description.
- It never auto-switches. The person always chooses.

## 4. Technical design

### 4.1 Files (create)

- `apps/web/lib/ux/journey-mode.ts` (pure, no imports from server modules): `JourneyMode`, `journeyModeCookie`, `parseJourneyMode`, `resolveJourneyMode`, `hrefForJourneySwitch`, `journeyScopedHref(mode)`, `shouldOfferSwitch(mode, family)`.
- `apps/web/lib/ux/journey-mode-server.ts`: `readJourneyMode()` using `await cookies()`.
- `apps/web/components/ux/journey-switch.tsx` (client) and `journey-switch.css` (tokens only).
- `apps/web/components/ux/journey-mode-context.tsx`: `JourneyModeProvider`, `useJourneyMode()`.
- `apps/web/components/ux/journey-note.tsx`: the quiet "Showing X. Show Everything" line and the Companies line.
- `apps/web/components/ux/journey-mismatch-note.tsx`: the 3.9 prompt.
- Tests (section 5).

### 4.2 Files (edit)

- `lib/ux-switches.ts`: add `CORRIDRA_UX_JOURNEY_MODES` with a comment in the house style. `lib/owner-switches.ts`: plain-language description. The mode is active only when `CORRIDRA_UX_SHELLS_V2` and `CORRIDRA_UX_MOVE` are also on (the journey links already need Move); say so in the description.
- `lib/ux/customer-navigation.ts`: `customerTabs` takes an optional `journey` and returns the scoped Home and Requests hrefs. `customerJourneyLinks` stays untouched for the switch-off path.
- `components/customer-shell.tsx`: make `CustomerFrame` async (or add a small async server child), read the mode, wrap `children` in `JourneyModeProvider`, build scoped `items`, pass `journeyMode` and `journeyCounts` to `CustomerSideNav`. Accept an optional `journeyMode` prop on `CustomerShellProps` for pages that know their own params. With the switch off, the code path and output are unchanged.
- `components/ux/customer-rail.tsx`: `CustomerSideNav` renders `JourneySwitch` first when the switch is on, drops the Your Journeys group in that case, and draws Groups by the rule in 3.3.
- `app/account/move/page.tsx` and `move-view.tsx`: pass explicit mode, single source of truth (3.6).
- `app/account/page.tsx` (Requests and Reports views), `work-filter.tsx`, `work-list.tsx`: default filter from the cookie, cookie write on chip change, quiet line, Reports scoping.
- `app/account/meetings/page.tsx`: family filter on `requests`.
- `app/account/companies/page.tsx` or `company-portfolio.tsx`: the quiet line.
- `room-view.tsx`, `requests/request-detail.tsx`, delegations programme room: the 3.9 prompt.
- Docs: `docs/agents/ui-direction.md` (new row in "Current locked decisions" for Journey modes, update the "Customer sidebar" and "Navigation" rows, record deviations), `docs/V3_LEDGER.md` and the work log through the scribe, per the repo rules. Do not load those files whole; use `node scripts/v3-context.mjs section`.

### 4.3 Hard rules for the code

- No new database table, column, migration, route, or server write. One cookie only.
- No extra work-list read on pages that already read it. Where the Reports page does not read the list today, the scoped path adds one read only when a journey is chosen; measure it in `customer-sidebar-read-cost.test.ts` style and state the number.
- Switch off: output byte for byte unchanged, and all existing tests pass unmodified.
- Access is decided by the server, as everywhere. The mode only narrows what is shown; it grants nothing, and a crafted cookie value can only produce `all` or a journey that filters a list the person was already allowed to read.

## 5. Tests (write them, then run the gates)

Unit (pure, no database), new file `tests/integration/journey-mode.test.ts`:

- `parseJourneyMode` accepts only the closed list, rejects repeated, empty, oversized and hostile values.
- `resolveJourneyMode` precedence table, including `work=other`, unknown `journey`.
- `hrefForJourneySwitch` for Home, Requests, Meetings, Reports, Companies, Account, a Groups page, with and without existing query words and a `#` fragment.
- `shouldOfferSwitch`: true only for a journey mode that differs from a classified family; false for `all`, matching, and `UNCLASSIFIED`.
- Composition: per mode the five hrefs and Groups, switch on and off; with the switch off the model equals today's output exactly.

Source and structure (house style, `readFileSync` tests):

- Switch described in `owner-switches.ts`; off path in `customer-shell.tsx` unchanged; no raw colour or inline size in the new css; no text-transform on actions.
- Counts follow L16: quiet badge, zero not drawn, spoken name.
- The prompt copy is exactly "This request is in X." and "Switch to X".

Browser (Playwright, `tests/ux/`), against a production build:

- Widths 1280, 1024, 390. Collapsed bar. Open drawer. Keyboard only: Enter and Space open the disclosure, Tab reaches the choices, Escape in the drawer closes the drawer.
- Switching on Home, Requests, Meetings, Reports and Companies lands where 3.5 says and the sidebar follows.
- A deep link to `/account/move?journey=sell` while the cookie says Sourcing: the page and sidebar both say Selling.
- Brand-new account with no work: switcher shown with all three journeys and no counts; choosing one shows that page's empty state.
- Single-journey account: switcher still shown.
- Prompt: in Selling mode open a Sourcing request's Room: the line "This request is in Sourcing." and "Switch to Sourcing" appear; pressing it re-renders the sidebar in Sourcing, the note disappears, the Room does not reload its content. In Everything mode and when modes match: no note. An unclassified request: no note.
- UNCLASSIFIED work still appears under Everything.
- Cross-journey count visible while in another journey.
  Update or add to: `tests/ux/customer-sidebar.spec.ts`, `tests/integration/customer-sidebar-counts.test.ts`, `customer-sidebar-read-cost.test.ts` only as new cases; do not edit existing assertions.

Gates, in order on the frozen revision: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, the UX gate on the production build, `tests/design-system-guard.test.mjs`. Record exact receipts. Draft PR only; the Guardian merges.

## 6. Work packages (execute in this order, one PR)

1. Pure model and tests (`journey-mode.ts`, section 5 unit tests). Nothing visible yet.
2. Switch registration (`ux-switches.ts`, `owner-switches.ts`), the server cookie reader and `JourneyModeProvider`.
3. Shell wiring (`customer-shell.tsx`, `customer-navigation.ts`), still rendering the old sidebar when the switch is off.
4. `JourneySwitch` component and css, `CustomerSideNav` changes, counts, collapsed bar and drawer behaviour.
5. Home single source of truth (`move-view.tsx`, `move/page.tsx`).
6. Requests and Reports scoping, chips, quiet line.
7. Meetings scoping and the Companies line.
8. Dynamic check: confirm every page that renders `CustomerShell` is `force-dynamic` or otherwise dynamic. If one is static, the cookie read would opt it into dynamic rendering or fail the build; fix by reading the mode only inside a dynamic server child of the sidebar, not by changing the page.
9. The 3.9 prompt on the Room, the saved request page and programme rooms.
10. Browser tests, docs, ledger and work log through the scribe, gates, draft PR, `subscribe_pr_activity`.

## 7. Known limits (state them in the PR, do not hide them)

- Companies is shared and unscoped by design.
- The prompt (3.9) is a choice, never an automatic switch. A person who ignores it keeps a sidebar in the other journey while reading that request.
- The team (operator) sidebar is untouched. Its desk grouping already is a module model.
- No URL scheme change. Journey is not in the path.
- Native-language review stays OPEN; no catalogue strings are added.
- NOT VERIFIED until the owner's signed-in pass: the "elsewhere" count, the prompt on a real request, real-device drawer behaviour, screen readers, Safari and Firefox.

## 8. Decisions that are expensive to reverse

- The cookie name and values (`corridra_journey`). Changing later strands saved choices; harmless but visible.
- The control name "Journey" and the labels, and the exact prompt wording the owner gave.
- The switch name `CORRIDRA_UX_JOURNEY_MODES`.
- Mode in a cookie, not in the path.

## 9. Owner steps after the build

After the signed-in pass, flip `CORRIDRA_UX_JOURNEY_MODES` to true (owner-only, with `CORRIDRA_UX_SHELLS_V2` and `CORRIDRA_UX_MOVE` already on). No other open question blocks the build.

## 10. Definition of done

Switch off: nothing changes and no existing test changed. Switch on: the switcher is always drawn; one chosen journey shows only that journey on Home, Requests, Meetings and Reports; Companies says it is shared; everything un-sortable stays reachable under Everything; opening a request from another journey offers "This request is in X. Switch to X"; zero new database reads on pages that already read the list; all gates green on the exact head; docs and ledger updated; draft PR open and watched.
