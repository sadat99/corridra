# Staff command palette search (navigation v1, Phase 1)

Document status: CURRENT.

Amends [navigation system v1](../navigation-v1.md) rule 3 (honest scopes) and rule 4 (the palette searches only what the person's role may open). Sibling of [team-reachability](team-reachability.md). Sensitive: yes, because the search route reads through role-checked services. No migration, no schema change, no new service, no new dependency, no new switch. People search is not built and is not shown. Phase 2 (database full-text and more entities) and Phase 3 (customer search) are out of scope.

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
| `rankLimits.maxTokensPerField` | 64 tokens of a field are compared fuzzily; exact, prefix and substring scan all text  |
| `tierScore`               | exact word 400, word prefix 300, substring 200, fuzzy 100                                  |
| `labelBonus`              | +50 when the hit is in the label field                                                     |
| `exactLabelBonus`         | +25 when the label words equal the query words in sequence                                 |
| `editPenalty`             | 10 per edit for a fuzzy hit                                                                |

Folding: each character is decomposed (NFKD), combining marks are removed, the rest is lower-cased, and ß ø ł đ æ œ ð þ ı are mapped to ss o l d ae oe d th i. Tokens are runs of letters and digits. "Zürich" matches "zurich".

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

`paletteLimits` is `{ queuePages: 3, cataloguePages: 4, showAll: 5, showScope: 10, strongStop: 5 }`. Most calls per request: missions 3, companies 5, scope All 8. Hits returned: 5 per scope under All, 10 per scope for a single scope. A strong row has every query word as an exact or prefix match in the label; a scope stops early after 5 strong rows.

Partial: a scope is partial when it stopped at the cap with rows still unread (total greater than rows read), including a whole-word read whose total exceeds 50. Stopping early on strong hits is not partial; order is among the rows read. A scope read completely is never partial.

Failures: a 403 on the first read of a scope puts it in `denied`. Any other error on the first read of a scope fails the request with 500 and the generic message. A later page failing with a non-403 error keeps the earlier hits and marks the scope partial, and logs one line `{event:'palette_search_page_failed', scope, page, correlationId}` (never the query). A later page 403 puts the scope in `denied` and clears that scope's rows. `denied` and `partial` list scopes in the order missions, companies.

No latency or p95 claim is made until it is measured on a seeded database and recorded in the work log.

## 4. Facts beside the hits

Hits are untouched. The result may carry an optional sibling map `facts`, keyed `mission:<id>` or `company:<id>`, present only when there are hits. A client that does not know `facts` shows label and detail only.

- Mission: `{status}` (the stored status code, shape `^[A-Z][A-Z_]{0,31}$`) and `close` when it applies. No step text is sent.
- Company: `{source}` only from `identity_status` of the catalogue row: `SOURCE_REPORTED` when any row of the organisation has it, otherwise `EXPIRED` when any row has it, otherwise nothing; `UNKNOWN` gives no entry. `close` when it applies. `source_locator`, domain, address, identifier, notes and contacts are never copied.

## 5. Words the person reads

Straight quotes in code, curly quotes on screen, no em dashes.

Mission stage badge (from the Road mapping in `components/mr/road-status.ts`): DRAFT and QUALIFICATION "Step 1, Define"; ACTIVE, TARGETING and OUTREACH "Step 2, Find"; MEETINGS "Step 4, Visit"; FOLLOW_UP, COMMERCIAL_PIPELINE and CLOSED "Step 6, Follow through"; ON_HOLD "Paused" and CANCELLED "Cancelled" (no step); an unknown status shows its plain label and no step number. Steps 3 and 5 are never produced. The staff stage ("Finding companies") follows the server detail, then "Opens Missions" while mission pages are off or unknown.

Company chip: "Source on record" for a source-reported identity (a source record is not verification); "Source expired" for an expired one; nothing otherwise. The words "Evidence available" and "Verified" never appear in the palette. A close hit shows "Close match".

| State                                     | Words                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty query, All                          | "Type at least 2 letters to search missions and companies." Then "Recent on this device", "Clear Recents", "Places you can open" (4 actions)  |
| Empty query, Missions or Companies        | "Type at least 2 letters to search missions." or "companies." Recents of that kind, or "No recent missions yet." or "No recent companies yet." |
| Searching                                 | "Searching missions and companies" (or "Searching missions." / "Searching companies.")                                                         |
| Results                                   | "1 result" or "N results"                                                                                                                      |
| Partial                                   | "Partial results." "Not every mission was searched. More may exist. Narrow your search." (or company, or "mission or company")                |
| Denied                                    | "Your role cannot search companies." (or missions, or "missions or companies.") "Ask an owner or admin if you need access."                    |
| Failed                                    | "The search did not finish. Try again." Offline: "You are offline. Check your connection, then try again." First option "Retry"                |
| Failed on a later page                    | "Some results could not be loaded, so more may exist. Narrow your search or retry."                                                             |
| Signed out (401)                          | "You are signed out" "Sign in again to keep searching." and a "Sign In" option                                                                  |
| No match                                  | "No match for “mad”" "Try a different spelling or fewer letters."; a single scope adds "You are searching Missions only. Choose All to search everywhere." |
| No match, one scope denied                | "No match for “mad” in missions" plus the denied notice                                                                                        |
| No match, partial                         | "No match in the part searched" "More may exist. Narrow your search."                                                                          |

Denied, partial, failed and signed out never read "No match" or "Nothing found". Rows from the allowed scope still show when the other is denied.

## 6. Recents

Per device, in `localStorage` under `corridra:palette-recents:v1:` plus the workspace id and the signed-in subject. At most 8 items, each `{kind, id, label}`; never query text, detail, status, address, role, e-mail or time. Written when a mission or company hit or recent is opened (never an action). Shown only for an empty query in All, Missions or Companies, 5 in All, and only when the role may open Missions (for mission recents) or Companies (for company recents). Recents are not a way in: the opened page still decides. The subject comes from `/api/operator-auth/get-session` once per open; with no subject nothing is shown or written. Another person's recents on the same device are removed on open, and all are removed on Sign Out and when the session is found signed out. Stored values are validated on read and rendered as text.

## 7. Top bar

From 1024 px the single Search button is a wide field-style control: height 44 px, width 176 px to 560 px (flexible), left aligned, Search and the Ctrl K keycap visible, the other tools staying at the right edge. Below 1024 px it stays the 44 by 44 icon button (the word and keycap visually hidden, accessible name Search).

Deliberate deviation: the design board and the first draft used about 900 px. At 900 to 1023 px the field cannot fit beside the brand wordmark, and hiding the wordmark would change the brand lockup, so the wide form begins at 1024 px. Surfaces use AC/1 tokens only. The keycap is 12 px (the board's 11 px fails the UX gate). Contrast note: the strong border on white is 2.18 to 1, below the 3 to 1 guideline for non-text parts; the control is identified by its icon, word and keycap, not by its border alone, and no new colour is invented. The measured widths at 1024, 1100, 1280 and 1440 px are recorded in the work log from the production build.

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
| P8    | Top bar size, one row, no sideways scroll, icon button on a phone    | `team-palette-v2.spec.ts`                                                              |
| P9    | Keyboard, active option id, one announcement per settled change      | `team-nav-v1.spec.ts` (unchanged), `team-palette-v2.spec.ts`, `palette-status.test.ts` |
| D1    | Each role finds what it may open; a denied scope is named            | `palette-search.test.ts` (database), `palette-search-depth.test.ts`, `palette-status.test.ts` |
| D2    | Wrong workspace: both scopes denied, no rows                         | `palette-search.test.ts` (database), `palette-search-depth.test.ts`                    |
| D3    | Signed out: 401, services untouched, sign-in-again message           | `palette-search-route-depth.test.ts`, `team-palette-v2.spec.ts`                        |
| D4    | Revoked role: next search says denied; recents are not a bypass      | `team-palette-v2.spec.ts`                                                              |
| D5    | Recents never cross people or workspaces; cleared on sign-out        | `palette-recents.test.ts`                                                              |
| D6    | A non-403 error is a 500 with the generic message, query not logged  | `palette-search-route-depth.test.ts`                                                   |
| R1    | Failed search shows Retry; retry re-sends; stale answers dropped     | `palette-status.test.ts`, `team-palette-v2.spec.ts`                                    |
| R2    | A later page failing keeps earlier rows, marked partial              | `palette-search-depth.test.ts`                                                         |
| R3    | Close and reopen resets, focus on the opener                         | `team-palette-v2.spec.ts`                                                              |
| R4    | Mission pages off: the hit opens Missions                            | `team-nav-v1.spec.ts` (unchanged)                                                      |
| M1    | Bounded work per request                                             | `palette-search-route-depth.test.ts`                                                   |
| M2    | Bounded response size                                                | `palette-search-depth.test.ts`                                                         |
| M3    | No latency claim until measured                                      | work log                                                                               |
| M4    | UX gate and axe on a production build                                | `team-palette-v2.spec.ts`, `pnpm test:ux`                                              |
| M5    | Release checks, exact-head CI, Guardian PASS                         | CI                                                                                     |
| M6    | The six pinned tests pass unedited                                   | `palette-search.test.ts`, `palette-search-route.test.ts`, `team-palette.test.ts`, `private-api-headers.test.ts`, `team-nav-v1.spec.ts`, `ws-e/team-shell.spec.ts` |
