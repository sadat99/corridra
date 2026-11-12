# Staff command palette search (navigation v1, Phase 1)

Document status: CURRENT.

Amends [navigation system v1](../navigation-v1.md) rule 3 (honest scopes) and rule 4 (the palette searches only what the person's role may open). Sibling of [team-reachability](team-reachability.md). Sensitive: yes, because the search route reads through role-checked services. No migration, no schema change, no new service, no new dependency, no new switch. People search is not built and is not shown. Phase 2 (database full-text and more entities) and Phase 3 (customer search) are out of scope here; customer search is specified in [customer search](customer-search.md).

Owner direction, 12 Nov 2026: upgrade the staff command palette to the platform's standard. Binding condition 7 of navigation v1 still holds: no switch, provider, payment, outreach, AI or migration change; the D gates stay closed.

## 1. What stays exactly as it is

- Ctrl K and Command K, and the `corridra:open-palette` window event with `detail.opener`. Focus returns to the opener on close, also in Safari.
- The Search trigger is one real `<button>` in the team top bar: `aria-haspopup="dialog"`, `aria-keyshortcuts="Control+K Meta+K"`, `title="Search"`, a leading icon, the word Search and the keycap Ctrl K. Its markup is pinned by `tests/integration/fixtures/app-header-markup.json` and does not change; only CSS changes. It is not an input and there is no second combobox.
- The dialog name is exactly "Search missions, companies and actions". The hint "Searches only what your role may open" appears once. The scopes are exactly All, Missions, Companies, Actions.
- Up and Down stop at the ends. Enter opens with a full page load. Tab and Shift+Tab cycle All, Missions, Companies, Actions with wrap. Escape closes and resets.
- The route is `GET /api/workspace/search?tenant&q&scope`: `Cache-Control: no-store`, `X-Corridra-Request-ID`, no-referrer, `purpose` `synthetic_validation`, 401 with no session, 400 for a bad workspace id, an unknown scope or a query over 80 characters, 503 when the workspace is unavailable. A 403 inside a scope goes to `denied` and is never an empty result. It writes nothing and never logs the query.
- Reads go only through `missions.queue` (needs `missions.read`) and `counterparties.catalogue` (needs `research.read`). No SQL, no widened role. A query under 2 characters reads nothing.
- Hits are exactly `{id, label, detail}`. The empty result is exactly `{missions, companies, denied, partial}`.

## 2. Ranking and typo tolerance

`apps/web/lib/palette-rank.ts` is a pure module (no I/O, no imports). `matches()` in `palette-search.ts` is unchanged and stays strict (every word as a substring); ranking is a separate function.

| Name                      | Value                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `rankLimits.maxWords`     | 8 query words, the rest are ignored                                                        |
| `rankLimits.fuzzyMinLength` | 4: a word of 3 characters or fewer needs an exact, prefix or substring match             |
| `rankLimits.unanchoredFuzzyLength` | 6: from 6 characters a typo may sit inside a longer token                         |
| `rankLimits.maxTokenLength` | 40 characters of a token are compared fuzzily; each query word is cut to 40              |
| `rankLimits.maxTokensPerField` | 64 tokens of a field are compared fuzzily                                               |
| `rankLimits.maxFieldLength` | 256: only the first 256 characters of a field are tokenised, so a very long name cannot make ranking slow |
| `tierScore`               | exact word 400, word prefix 300, substring 200, fuzzy 100                                  |
| `labelBonus`              | +50 when the hit is in the label field                                                     |
| `exactLabelBonus`         | +25 when the label words equal the query words in sequence                                 |
| `editPenalty`             | 10 per edit for a fuzzy hit                                                                |

Folding: each character is decomposed (NFKD), the combining accents U+0300 to U+036F are removed, the rest is lower-cased, and ß ø ł đ æ œ ð þ ı are mapped to ss o l d ae oe d th i. Every other mark is part of the word and stays: the vowel signs of Bengali and Devanagari, and the Arabic and Hebrew marks. Tokens are runs of letters, marks and digits. "Zürich" matches "zurich" and "Dhaka" matches "dhaka"; "কি" and "কী" are different words, so "ঢাকা" never matches "ঢুকি". At most 256 characters of each field are tokenised (`rankLimits.maxFieldLength`).

Edit distance is optimal string alignment (Levenshtein where swapping two neighbouring letters costs 1). The allowed distance for a query word of n characters: n of 3 or fewer gives 0; 4 to 7 gives 1; 8 or more gives 2. A word of 4 or 5 characters is compared against the start of a token (anchored); 6 or more against any part of a token (unanchored). A word is tried fuzzily only when it has no exact, prefix or substring match in any field of the row, so a typo can never outrank an exact word. "tributer" (8 characters, limit 2) finds "Distributor". "knit france" does not match "Sell knitwear, Spain".

A row is a hit only when every query word scores. Row score is the sum of word scores plus the label sequence bonus. Tier decides first: an exact word in a detail outranks a label prefix; within a tier the label beats the detail. Ties break by position in the service order (queue order, catalogue order), then by id as plain code units. No clock, locale or randomness, so a fixed fixture gives one exact order. A company that the whole-word catalogue read returned but the ranker does not match (a domain or identifier equality) is kept with score 1, as today.

A hit found only through a typo is marked close. The words highlighted for a close hit include the fuzzy span; for any other hit only exact, prefix and substring spans are marked, so a typo match is never shown as exact.

Highlighting returns text segments; the client renders each marked segment as a React text node inside `<mark>`. It never inserts HTML. `<img src=x onerror=...>` in a name is shown as text. The full label stays the option's accessible name.

## 3. Depth, caps and partial results

Per request, in order, one scope after the other (the runtime pool is 5):

| Scope     | Reads                                                                                         | Cap                         |
| --------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| Missions  | `missions.queue(ctx, 'all', offset)`, offset = rows read so far; pages of 100                 | 3 pages, 300 missions       |
| Companies | one whole-word read `{q}`, then scan pages with `q: ''` at offsets 0, 50, 100, 150; pages of 50 | 1 + 4 reads, 200 scanned |

`paletteLimits` is `{ queuePages: 3, cataloguePages: 4, showAll: 5, showScope: 10 }`. Most calls per request: missions 3, companies 5, scope All 8. Hits returned: 5 per scope under All, 10 per scope for a single scope.

Pages are read until the scope is read completely (total no greater than rows read), a page is empty, or the cap is reached. There is no early stop: a better match on a later page is never skipped because earlier pages already held good ones, and the hits are ranked over every row read.

Partial: a scope is partial when rows remain unread at the cap (total greater than rows read), including a whole-word read whose total exceeds the 50 rows returned, because rows of it were never read. A scope read completely is never partial. A page that fails to load after the first also makes the scope partial (see Failures), so the one partial notice covers both; there is no separate notice for it.

Failures: a 403 on the first read of a scope puts it in `denied`. Any other error on the first read of a scope fails the request with 500 and the generic message. A later page failing with a non-403 error keeps the earlier hits and marks the scope partial, and logs one line `{event:'palette_search_page_failed', scope, page, correlationId, errorName, errorCode}` (the kind of error and its code when it has one; never the query and never the error message). A later page 403 puts the scope in `denied` and clears that scope's rows. `denied` and `partial` list scopes in the order missions, companies.

No latency or p95 claim is made until it is measured on a seeded database and recorded in the work log.

## 4. Facts beside the hits

Hits are untouched. The result may carry an optional sibling map `facts`, keyed `mission:<id>` or `company:<id>`, present only when there are hits. A client that does not know `facts` shows label and detail only.

- Mission: `{status}` (the stored status code, shape `^[A-Z][A-Z_]{0,31}$`) and `close` when it applies. No step text is sent.
- Company: `{source}` only from `identity_status` of the catalogue row: `SOURCE_REPORTED` when any row of the organisation has it, otherwise `EXPIRED` when any row has it, otherwise nothing; `UNKNOWN` gives no entry. `close` when it applies. `source_locator`, domain, address, identifier, notes and contacts are never copied. The source chip reads only the catalogue rows that were read: an organisation whose rows straddle the cap shows the flag of the rows read.

The client keeps at most 10 hits per scope and cuts a label or detail longer than 200 characters to 200; it never drops or blanks the hit for length.

## 5. Words the person reads

Straight quotes in code, curly quotes on screen, no em dashes.

Mission stage badge (from the Road mapping in `components/mr/road-status.ts`): DRAFT and QUALIFICATION "Step 1, Define"; ACTIVE, TARGETING and OUTREACH "Step 2, Find"; MEETINGS "Step 4, Visit"; FOLLOW_UP, COMMERCIAL_PIPELINE and CLOSED "Step 6, Follow through"; ON_HOLD "Paused" and CANCELLED "Cancelled" (no step); an unknown status shows its plain label and no step number. Steps 3 and 5 are never produced. The staff stage ("Finding companies") follows the server detail, then "Opens Missions" while mission pages are off or unknown.

Company chip: "Source on record" for a source-reported identity (a source record is not verification); "Source expired" for an expired one; nothing otherwise. The words "Evidence available" and "Verified" never appear in the palette. A close hit shows "Close match".

| State                                     | Words                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Three letters, workspace not published    | "Search is not ready yet."                                                                                                                      |
| Empty query, All                          | "Type at least 2 letters to search missions and companies." Then "Recent on this device", "Clear Recents", "Places you can open" (4 actions)  |
| Empty query, Missions or Companies        | "Type at least 2 letters to search missions." or "companies." Recents of that kind, or "No recent missions yet." or "No recent companies yet." |
| Searching                                 | "Searching missions and companies" (or "Searching missions." / "Searching companies.")                                                         |
| Results                                   | "1 result" or "N results"                                                                                                                      |
| Partial                                   | "Partial results." "Not every mission was searched. More may exist. Narrow your search or try again." (or company, or "mission or company"). Also used when a later page failed |
| Denied                                    | "Your role cannot search companies." (or missions, or "missions or companies.") "Ask an owner or admin if you need access."                    |
| Failed                                    | "The search did not finish. Try again." Offline: "You are offline. Check your connection, then try again." First option "Retry"                |
| Signed out (401)                          | "You are signed out" "Sign in again to keep searching." and a "Sign In" option                                                                  |
| No match                                  | "No match for “mad”" "Try a different spelling or fewer letters."; a single scope adds "You are searching Missions only. Choose All to search everywhere." |
| No match, one scope denied                | "No match for “mad” in missions" plus the denied notice                                                                                        |
| No match, partial                         | "No match in the part searched" "More may exist. Narrow your search."                                                                          |

Denied, partial, failed and signed out never read "No match" or "Nothing found". Rows from the allowed scope still show when the other is denied.

When the page cap was reached and no hit was found, the block reads “No match in the part searched” with “Narrow your search.” and not “Try again.”: the rows past the cap are not searched by trying again, so narrowing is the right advice.

## 6. Recents

Per device, in `localStorage` under `corridra:palette-recents:v1:` plus the workspace id and the signed-in subject. At most 8 items, each `{kind, id, label}`; never query text, detail, status, address, role, e-mail or time. Written when a mission or company hit or recent is opened (never an action). Shown only for an empty query in All, Missions or Companies, 5 in All, and only when the role may open Missions (for mission recents) or Companies (for company recents). Recents are not a way in: the opened page still decides. The subject comes from `/api/operator-auth/get-session` once per open; with no subject nothing is shown or written. Another person's recents on the same device are removed on open. All are removed at every sign-out path, each only after the sign-out itself succeeded: the staff account menu Sign Out, the workspace toolbar Sign Out, the contributor Sign Out of Assigned Work, and the shared `endSession` helper (called by `use-sign-out`, which the site header, the staff utility menus and the account Sign Out use, and by the account lifecycle error line); also when the session is found signed out on open. "No recent missions yet." is said only when the signed-in person is known. Stored values are validated on read and rendered as text.

## 7. Top bar

From 1024 px the single Search button is a wide field-style control: height 44 px, width 176 px to 560 px (flexible), left aligned, Search and the Ctrl K keycap visible (the keycap yields only as an accessibility fallback, see below), the other tools staying at the right edge. Below 900 px it is the icon button (the word and keycap visually hidden, accessible name Search); from 900 to 1023 px it is the unchanged 154 by 44 button with the word and the keycap.

The wide form starts at `min-width: 64em`, not 1024 px, and the field's floor is `min-width: min(11rem, 100%)`, not a bare `11rem`. A media query in em follows the browser's own default font size, so a person who has set a larger default font falls back to the unchanged button instead of overflowing the header. That behaviour cannot be proven by emulating a root font size (an em query ignores it); a source-level test pins the query, and measurement with a Chromium profile whose default font size is 32 is owed to the verifier. A root size set by the page itself, which is how Corridra's own text-size setting (Make It Easier to Read) works, does not move an em query, so at 200% text the wide field does apply, and a bare `11rem` floor is then 352 px: wider than the space beside it (249 px at 1024 px on the bundled header without a rail), which pushed the page 63 px sideways. The floor `min(11rem, 100%)` gives way to the container, so the field never runs past it at any root font size; when the container is narrower than 11rem the field fills it and the other tools wrap below. This is proven by `team-palette-v2.spec.ts` ("at 200% text the Search field never runs past its container or the window", at 1024, 1100 and 1280 px with the rail collapsed) and the existing `ux-language-trigger-shape.spec.ts` (team header at 1024 px with 200% text), and the floor is pinned at source level in `palette-css.test.ts`. The Ctrl K keycap is a shortcut aid and is not always shown: `.ux-team-tools` is a size container and the keycap is hidden (`display: none`) when that container is narrower than 14rem (`@container (max-width: 14rem)`, inside the same 64em block). Because rem follows the root size, the rule fires only when there is no room: at normal text the tools box is far wider than 14rem at every width from 1024 px, so the keycap is always shown; at 200% text it is under 448 px, so the keycap yields. The button keeps its icon, the word Search and its accessible name, and its markup does not change. A browser without container queries keeps the earlier behaviour. This closed the last measured overflow on the Today fixture with the rail open at 200% text and 1280 px: the tools box was 153 px wide, narrower than the icon, padding and keycap, so the keycap ended at 1296 px and the page scrolled 16 px sideways. It is proven by `team-palette-v2.spec.ts` (at 200% text with the rail open at 1280 and 1440 px the page does not scroll sideways and the keycap yields; at normal text it is shown at 1024, 1280 and 1440 px) and pinned at source level in `palette-css.test.ts`. Not covered: on the Today fixture with the left rail open at 200% text, the header at 1024 and 1100 px is still wider than the window (the page scrolled 182 px and 169 px sideways before this change and 61 px and 48 px after, measured). That overflow is also present on main without the Search field and is not claimed fixed here.

Deliberate deviation: the design board and the first draft used about 900 px. At 900 to 1023 px the field cannot fit beside the brand wordmark, and hiding the wordmark would change the brand lockup, so the wide form begins at 1024 px at the default font size. Surfaces use AC/1 tokens only. The keycap is 12 px (the board's 11 px fails the UX gate). Contrast note: the strong border on white is 2.18 to 1, below the 3 to 1 guideline for non-text parts; the control is identified by its icon, word and keycap, not by its border alone, and no new colour is invented. Measured on the bundled team shell (the Today fixture with the real stylesheets, Chromium 1243, one workspace language, rail expanded): the field is 288 px at 1024, 364 px at 1100, 544 px at 1280 and 560 px (the cap) at 1440; with the rail collapsed it is 484, 560, 560 and 560 px. The header stays 64 px high, in one row, with no sideways scroll, and between 900 and 1023 px the button is the 154 px button it was. These are fixture measurements: the same widths on a production build (KI-18), and at 200% text, are still owed to CI or the verifier and are recorded in the work log.

Phone panel (below 640 px): the panel is the viewport width less 1 rem wide and 8 px from the sides (304 px at 320, 374 at 390; the browser's own modal-dialog maximum width is overridden), with a height cap of the smaller of the viewport height less 1 rem and 36rem. The list region may shrink to nothing so the footer line "Searches only what your role may open" is always whole inside the panel, also in the failed and the denied states. The field keeps at least 8rem and the Close button wraps under it at large text. The summary line has 8 px above it, a detail wraps instead of being cut, and a row with nothing in its trailing slot has no blank gap.

## 8. Board versus CURRENT

The design boards (TeamDesktop.dc.html, CommandPalette.dc.html) are evidence only. Where they differ, this table says which wins.

| Board                                              | Built                                                                  | Winner  |
| -------------------------------------------------- | ---------------------------------------------------------------------- | ------- |
| People pill and "people" placeholder               | People left out; existing placeholder                                   | CURRENT |
| Scope pills 99 px radius, navy fill when active    | 8 px radius, 44 px, `--selected` tokens                                 | CURRENT |
| "Evidence available" cobalt chip                   | "Source on record", neutral                                             | CURRENT |
| Actions "New mission", "Add a company", N and C    | Real "Open <place>" rows from the team map, no hotkeys                  | CURRENT |
| Mono 11 px uppercase                               | 12 px minimum, no text transform                                        | CURRENT |
| Spacing 14, 20, 6                                  | 4 px scale                                                              | CURRENT |
| Single-line 52 px rows                             | Two lines, 56 px                                                        | CURRENT |
| Bold active label                                  | Constant weight, reserved Enter slot                                    | CURRENT |
| Top bar echoes the typed word                      | The trigger is a button and never echoes                                | CURRENT |
| Route switcher ("Bangladesh to Spain")             | Not built, not drawn (MISSING)                                          | CURRENT |
| Panel 720 px, radius 16, shadow, navy backdrop     | As the board                                                            | Board   |
| Wide field from about 900 px                       | From 1024 px                                                            | CURRENT |

Note: navigation-v1.md rule 3 mentions a route switcher with Ctrl K search in the top bar; only Search is built. The route switcher is not yet built and is not part of this change.

## 9. Acceptance checks and the tests that prove them

Pure and fake-service tests run in `pnpm test`; browser tests need the CI database and a built app.

| Check | What                                                                 | Test                                                                                   |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P1    | Label prefix above detail-only containment                           | `palette-rank.test.ts`                                                                 |
| P2    | Typo, transposition, short words, no false "knit france"            | `palette-rank.test.ts`                                                                 |
| P3    | Marks in the label, name unchanged, no HTML injection                | `palette-rank.test.ts`, `team-palette-v2.spec.ts`                                      |
| P4    | Stage badge words                                                    | `palette-facts.test.ts`                                                                |
| P5    | Company chip only from the service field                            | `palette-facts.test.ts`, `palette-search-depth.test.ts`                                |
| P6    | Target beyond the first page found; partial only past the cap        | `palette-search-depth.test.ts`                                                         |
| P7    | Empty state: recents then actions, zero requests                     | `palette-recents.test.ts`, `team-palette-v2.spec.ts`                                   |
| P8    | Top bar size, one row, no sideways scroll, icon button on a phone, tools inside the header; phone panel width and footer line; the wide field starts at 64em | `team-palette-v2.spec.ts`, `palette-css.test.ts` |
| P9    | Keyboard, active option id, one announcement per settled change      | `team-nav-v1.spec.ts` (unchanged), `team-palette-v2.spec.ts`, `palette-status.test.ts` |
| D1    | Each role finds what it may open; a denied scope is named            | `palette-search.test.ts` (database), `palette-search-depth.test.ts`, `palette-status.test.ts` |
| D2    | Wrong workspace: both scopes denied, no rows                         | `palette-search.test.ts` (database), `palette-search-depth.test.ts`                    |
| D3    | Signed out: 401, services untouched, sign-in-again message           | `palette-search-route-depth.test.ts`, `team-palette-v2.spec.ts`                        |
| D4    | Revoked role: next search says denied; recents are not a bypass      | `team-palette-v2.spec.ts`                                                              |
| D5    | Recents never cross people or workspaces; cleared at every sign-out path (staff menu, workspace toolbar, `endSession`, contributor sign-out) | `palette-recents.test.ts`, `team-palette-v2.spec.ts`                           |
| D6    | A non-403 error is a 500 with the generic message, query not logged  | `palette-search-route-depth.test.ts`                                                   |
| R1    | Failed search shows Retry; retry re-sends; stale answers dropped     | `palette-status.test.ts`, `team-palette-v2.spec.ts`                                    |
| R2    | A later page failing keeps earlier rows, marked partial              | `palette-search-depth.test.ts`                                                         |
| R3    | Close and reopen resets, focus on the opener, also when Escape and Ctrl K come at once | `team-palette-v2.spec.ts`                                                              |
| R5    | The selection is always a real row once results arrive; Enter during input method composition does not open | `palette-selection.test.ts`, `team-palette-v2.spec.ts`                  |
| R4    | Mission pages off: the hit opens Missions                            | `team-nav-v1.spec.ts` (unchanged)                                                      |
| M1    | Bounded work per request                                             | `palette-search-route-depth.test.ts`                                                   |
| M2    | Bounded response size                                                | `palette-search-depth.test.ts`                                                         |
| M3    | No latency claim until measured                                      | work log                                                                               |
| M4    | UX gate and axe on a production build                                | `team-palette-v2.spec.ts`, `pnpm test:ux`                                              |
| M5    | Release checks, exact-head CI, Guardian PASS                         | CI                                                                                     |
| M6    | The six pinned tests pass unedited                                   | `palette-search.test.ts`, `palette-search-route.test.ts`, `team-palette.test.ts`, `private-api-headers.test.ts`, `team-nav-v1.spec.ts`, `ws-e/team-shell.spec.ts` |
