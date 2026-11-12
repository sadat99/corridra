# Customer search (navigation v1, customer and regular-user search)

Document status: CURRENT.

Sibling of [staff command palette search](command-palette-search.md), which is the pattern this follows. Amends [navigation system v1](../navigation-v1.md) rule 5 in one respect only (section 1). Sensitive: yes, because a new authenticated route reads customer-owned data under the customer's own session. No migration, no schema change, no new SQL function, no new service in `packages/**`, no new dependency, no new switch, no environment variable. The D gates, payments, outreach and AI stay closed, and the search neither triggers, enables nor reads any of them.

Build state: the route and its core, the pure client modules and the dialog are built. The tests listed in section 13 are written; the real-database test is written and runs in CI. Nothing here is claimed enabled, live or verified. Production switch values are owner-reported and not observed.

## 1. Owner direction and what it changes

Owner, 12 Nov 2026: "searchbar should be available to customers/regular users as well for their convenience".

Navigation v1 rule 5 reads "Customers search inside Requests and Companies." This request supersedes only the words "inside Requests and Companies": a customer now has a Search button in the top bar. Binding conditions 4 and 7 stand: the search finds only what the person may already open and adds no access (condition 4), and there is no switch, provider, payment, outreach, AI or migration change (condition 7). The staff spec deferred this as its Phase 3 and did not forbid it.

The boards (`navigation-v1/*.dc.html`, `canvas.json`) show no customer search field. This document is CURRENT and wins over the boards.

## 2. What is searched, and what is not

Searched, each through the service the person already uses, under their own session:

| Scope     | Source                                                                         | Matched on                                                                          | Opens                                                          |
| --------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Requests  | `CustomerRequestService.list` and `CustomerRequestDetailService.detail`        | The plain title (for example "Sell in Spain"), derived from the brief the person wrote | `/account/requests/<id>`                                       |
| Companies | `CustomerCompanyService.list`, the person's approved report scopes             | Company name and country, from the pages loaded in this search                      | `/account/missions/<lowest loaded resourceId>` (the report page the Companies page links to) |
| Pages     | The shell's own navigation model, built in the browser (0 reads, no server scope) | Page label and detail                                                               | The shell's own href                                           |

Requests are the person's own, as the Requests page lists them (ADR-033, ADR-032): a workspace owner does not find members' Requests, a removed member finds nothing written in the workspace they left, a revoked Request is not found, and a Request whose retention has ended (`available` false) is not searchable and is not counted as partial. A withdrawn Request is found, exactly as the Requests list shows it, with `facts.withdrawn`.

Companies are the person's approved portfolio (ADR-038), not the linked organisations of ADR-079. The dialog never claims to be a complete company search: it searches only companies loaded from the person's approved reports.

Not searched, and not built: Requests written by other members, delegations, programmes, service requests, participants, invitations (tokens, member lists), the inbox and notifications, meetings content, anything staff-side, the organisation catalogue, "find other companies" (ADR-079 customer name search is never called: no `organisation_link_search`, no catalogue), database full text, people.

## 3. Route contract

`POST /api/customer-search`, `Content-Type: application/json`, body `{ q, scope }`. The words typed travel only in the body so they never enter a URL, an access log, history or a Referer.

Validation order. Nothing before step 10, the search itself, touches a service.

1. `foundations()` null: 503, every requested scope unavailable.
2. `Origin` is not `APP_ORIGIN`: 403.
3. Content type does not start `application/json`: 415.
4. Body over 8192 bytes: 413. Invalid JSON or a body that fails the schema: 400.
5. Strict schema `{ q: string up to 80, scope: all | requests | companies, default all }`. An unknown scope (including `pages`), an extra key or a query over 80 UTF-16 units is 400.
6. A trimmed query shorter than 2 characters, or with no letter or digit: 200 `{ "hits": [], "scopes": {} }`, zero reads, and no allowance spent.
7. The signed-in person is read first, on the server, from the identity provider session (`customerIdentity()`): never from the body, never from the identity headers the browser sends, never from an address. Nobody signed in, or a provider that does not answer: 401 `Sign in to continue`, with no slot held, no allowance counted and no service read, so an anonymous request cannot crowd out signed-in people.
8. The person's own allowance, keyed on that verified issuer and subject alone: a person who has already started 10 searches in the last 10 seconds gets 429 `{ error: 'Too many searches, try again in a moment', correlationId }` with `Retry-After`, before the slot and before any service call. Varying the workspace, a request id, the scope, the identity headers or the address does not change the key.
9. A process slot (section 4); none free: 503 `Search is busy, try again in a moment` with `Retry-After: 2`.

The 200 answer (`sample: true` marks a hit that comes from sample data, which the dialog labels "Sample"; real data carries no marker):

```
{ hits: [{ id, label, detail, href, kind: 'request' | 'company', sample?: true }],
  scopes: { requests?: State, companies?: State },
  facts?: { 'request:<uuid>': { sent, status?, withdrawn?, close? },
            'company:<hex64>': { reports, close? } } }
State = ok | partial | unavailable | denied | archived | limited
```

Requests first, then Companies, each ranked by `palette-rank.ts` (unchanged). 5 hits per scope under All, 10 for a single scope. Labels are cut to 200 characters. Only the requested scopes appear in `scopes`. A Request hit has an empty `detail`; the client builds the detail line from `facts.sent` (an ISO date and time) and `facts.status` (the stored status word, which the client turns into the words the Requests page uses). A Company hit's detail is the country and `facts.reports` is the count from loaded pages only. `facts` never carries fit, rationale, uncertainty, gaps, verification, contact, brief text or any money field. The answer carries no total and no "more exist" count.

Status codes:

| Code | When                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 200  | Answered (scopes may each be unavailable, denied, archived or partial).                                                               |
| 400  | Bad body, query over 80 characters, unknown scope, or a malformed subject or issuer header (from the session boundary).               |
| 401  | No signed-in person (step 7), including a provider that does not answer; or a service that finds no session. A staff session is invisible to the customer boundary, so staff without a customer session also get 401.        |
| 403  | Wrong Origin, a closed account (`account_closed` is kept in the body), or an unverified email.                                        |
| 409  | The subject or issuer header does not match the live session (the boundary refuses before any read).                                  |
| 413  | Body over 8 KB.                                                                                                                       |
| 415  | Content type is not JSON.                                                                                                             |
| 429  | The same person has used their allowance of searches (step 8; `Retry-After` is the seconds to wait), or every scope asked for was refused by the Companies budget (`code: 'scope_limited'`, no `Retry-After`, as the Companies route answers). The dialog shows a calm "try again" state with Retry, never "No match". |
| 500  | `{ error: 'The request could not be completed', correlationId }` for any other failure, and for a service refusal whose status is not 400, 401, 403, 409, 413, 415 or 503.                                    |
| 503  | The route is unavailable, every requested scope is unavailable, or the process is already running its limit of searches (`Search is busy, try again in a moment`, with `Retry-After: 2`). The dialog shows all three as its one whole-route state.                                                                    |

A DomainError of 400, 401, 403 (any) or 409 from a service is returned for the whole request and stops the remaining scopes and lookups. Per scope: a DomainError 503 or SQLSTATE `42P01`, `3F000`, `42883` is `unavailable`; raw SQLSTATE `42501` is `denied`; the archived-workspace refusal is `archived` for Requests (Companies still answer). A scope whose switch is off is `unavailable` with zero calls to its service. A DomainError 429 from a service is `limited` for its scope. A refusal shows its own words and code only for the statuses in the table; any other status is the generic 500. Every answer of the route handler, errors included, carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and `X-Corridra-Request-ID`. The route is registered in `apps/web/next.config.ts` with its own rule.

Subject and issuer headers are passed through exactly as `/api/customer-requests` passes them. They are rejection-only: they can make the boundary refuse, never grant. The header Search sends them when the page supplied them (the server reads `customerIdentity()` once per request for the customer frame); with none it sends none, and the server answers 401. A mismatch is a 409, which the dialog shows as the access-could-not-be-confirmed state.

## 4. Bounded work (M1)

All limits live in one exported object, `customerSearchLimits`, in `apps/web/lib/customer-search.ts`.

| Limit              | Value | Meaning                                                                                                   |
| ------------------ | ----- | --------------------------------------------------------------------------------------------------------- |
| `requestPage`      | 100   | One `list` call of 100 rows. `nextAfter` remaining makes Requests partial.                                |
| `titleCap`         | 30    | At most 30 `detail` lookups per search. More available rows than the cap makes Requests partial.          |
| `titleConcurrency` | 2     | At most 2 lookups in flight.                                                                              |
| `titleBudgetMs`    | 6000  | Time budget for lookups; running out makes Requests partial.                                              |
| `titleFailureStop` | 3     | Three consecutive failed lookups stop the lookups (partial).                                              |
| `companyPages`     | 4     | At most 4 company pages.                                                                                  |
| `companyPageSize`  | 5     | Scopes per page (the service maximum).                                                                    |
| `showAll`          | 5     | Hits per scope under All.                                                                                 |
| `showScope`        | 10    | Hits for a single scope.                                                                                  |
| `perPersonSearches` | 10 | Searches one person may start in each window, counted in this process before any read. A third of the staff palette's 30, because a search here can make up to 35 service calls. |
| `perPersonWindowMs` | 10000 | The sliding window for that allowance. |
| `perPersonKeys` | 5000 | People the allowance remembers; the least recently used are dropped, so memory stays bounded. |
| `maxConcurrentSearches` | 4 | Searches one process runs at once; the next is refused with 503 and `Retry-After: 2`. The slot is given back when the search ends for any reason. |
| `searchDeadlineMs` | 12000 | One deadline for the whole search, both scopes and every service call. A call still running at the deadline, or when the request aborts, is given up on, and its scope is partial, never ok. |

Scopes run one after the other, under one clock. Requests are ordered by id, not by time, so beyond the cap the unread part is arbitrary: that is why a capped read says partial and never "No match". Companies are partial when `nextAfter` remains after page 4, when any page has `unavailableScopes` above 0, or when a later page failed.

The Companies page spends a per-client budget before each portfolio page it reads (`missions.budget(client)`, the first address of `x-vercel-forwarded-for` on Vercel and `local` elsewhere). In the synthetic mode that is `app.intake_budget` at 6 an hour per client, in the real mode `customer.real_request_budget` at 120 an hour, both shared with public intake. The search spends the same budget, with the same client and in the same mode, ONCE per search that reaches Companies, before the first portfolio page, and nothing more for the later pages of that search. So a search that reads Companies costs one unit however many pages it reads (up to 4), and a search that does not reach Companies (scope Requests, words not worth reading, nobody signed in, a person over their allowance, the Companies switch off) costs none. A customer whose budget is already spent is refused Companies through search exactly as on the Companies page: the Companies scope is `limited`, no portfolio page is read, the Requests scope still answers, and the whole request is a 429 only when every scope asked for is `limited`. The owner may tighten this to one unit per page, as the Companies page itself spends.

The query never reaches SQL, a service argument, a URL, a header or a log field. It exists only in the validated body, where it feeds `queryWords` and `rankFields`.

## 5. Failure handling and logging

A first-read failure that is not a DomainError and not a known SQL state is a 500 and logs one fixed-shape line `{ event: 'customer_search_failed', scope, correlationId, errorName, errorCode }` (scope when known; name at most 64 characters, code at most 32, otherwise left out; never the message). An unexpected Companies failure after Requests answered keeps the Requests hits, makes Companies `unavailable` and logs one line `{ event: 'customer_search_scope_failed', scope, correlationId, errorName, errorCode }`. A failure on a later company page keeps the earlier hits, marks the scope partial and logs one line `{ event: 'customer_search_page_failed', scope, page, correlationId, errorName, errorCode }`, name at most 64 characters, code at most 32, never the message (a database may fill a message with the typed words). A lookup failure counts toward partial. SQLSTATE `42501` on a later page makes the scope denied and clears its rows. The access log, console and logger never receive the query or a result.

## 6. Privacy rules

- POST with a bounded JSON body; no query in any URL; `referrerPolicy: 'no-referrer'` on the fetch.
- No logging, no storage, no cache of the query or results: no `localStorage`, `sessionStorage`, cookie, `indexedDB`, `history` or `URLSearchParams` in the client files. No recents (the staff recents are not imported).
- Anti-enumeration (ADR-079): the same neutral answer for unknown and forbidden, no totals, no counts of hidden rows, no hint of other workspaces, claims or organisations.
- A staff service is never imported, and the staff route is never reused.

## 7. Pages scope

Built in the browser from the shell's own model, so it can only be narrower than the shell:

- the tabs from `customerNavigation(input)` (5, or 4 with Companies off);
- New Request at `newRequestHref(...)`;
- Manage Workspaces only when the person has at least one workspace;
- the avatar items of kind `link` (Account, Company Profile, Plan and Billing, Notification Settings); items of kind `soon` are dropped, so "Coming soon" is never openable; Sign Out is excluded;
- the `link` items of the Help groups (See How It Works, How We Label Facts, Report a Problem when on, Corridra Website, Privacy Notice); external, listen, text size, contrast and movement items are excluded.

Flags come from the same holders the avatar and Help menus read. Without them the defaults are the narrow side. The Pages scope sends no request.

## 8. Honest incompleteness and words

A scope that is partial, denied, unavailable, archived, closed, signed out or failed is never called "No match". A search that is limited (429) says "Too many searches just now. Wait a little, then try again." with Retry first and the pages still listed, and the screen reader hears "Too many searches just now. Wait a little. Retry is the first option." A Companies scope held back by the budget says "Searching Companies is paused because of too many requests. Try again later." (it counts per hour, so the words say later) and the Requests still answer. A hit from sample data shows a "Sample" chip. Partial says "Partial results" and "Narrow your search"; a partial scope with nothing listed says "Search was partial", never "No match". Signed out says "You are signed out" with a Sign In option that never carries the typed words. A closed account has its own block. Words are Request and Company, never Mission. English only (`lang="en"`), Title Case buttons, curly quotes on screen, no em dashes, no reviewed translation claimed. Never shown: "verified", "evidence", "enabled", "live", totals, "more exist" counts, "complete search".

The final copy and layout are owned by the UI specification of the UI stage; the pure words module `customer-search-status.ts` carries the strings, and `customer-search-words.test.ts` pins them.

## 9. Trigger, dialog and CSS rules

- One real `<button type="button">`, first in the customer top bar tools, accessible name exactly "Search", `aria-haspopup="dialog"`, `aria-keyshortcuts="Control+K Meta+K"`, `title="Search"`, no keycap. It mounts only in the customer branch of the header, so team and contributor markup is unchanged byte for byte. It appears on every `/account/*` page, because the customer header is keyed on the path; for a signed-out visitor the route answers 401 and the dialog says so.
- The Close button is visible at every width and there is no Esc keycap. Below 64em the trigger is a fixed 44 by 44 target with a fixed-size icon, so the five tools share one line at 768 px with 200% text (the pinned `ux-language-trigger-shape` test).
- New classes only (`ux-csearch*`), tokens only, targets at least 44 px, text at least 12 px, no shared selector with the team header.
- The wide-word query is in `em`: `@media (min-width: 64em)` (KI-54). Under 640 px the dialog panel is the viewport width less 1 rem with `max-width: none` (KI-53). The native `<dialog>` is opened from its own `open` state and ignores a close event that arrives after a reopen (KI-52). Ranking and highlighting are the unchanged `palette-rank.ts`, which keeps vowel signs (KI-56).
- Ctrl K and Command K open the dialog, and are ignored when another modal `dialog[open]` exists.

## 10. Cleanup

The dialog closes and clears its query, scope, answer and workspaces on the `sessionChanged` event (which covers `endSession`, `useSignOut`, the account sign-out, the lifecycle error line, the closed-account screen and the sign-in forms), on `pagehide`, and on a persisted `pageshow`. It clears the answer and query when the page becomes hidden.

## 11. Coupling to other switches

Requests need the request switch and, for titles, `CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED`. With the details switch off the Requests scope is `unavailable`, never a fabricated empty list. Companies need `CORRIDRA_CUSTOMER_COMPANIES_ENABLED` (which needs saved missions). The route also applies the provenance guard the Requests page applies. The search adds no switch and requires none the person's own pages do not already need.

## 12. Cost, rate limit and follow-ups

Every service call is one transaction: it reads the identity-provider session remotely, writes a short proof row and holds a pool connection. A search makes up to 1 + 30 + 4 = 35 such calls. Three things now bound the cost: a per-process cap of 4 concurrent searches, one 12 second deadline per search, and a per-person allowance of 10 searches in 10 seconds (in process, so per server instance; it keeps only the signed-in person's key in a bounded map, never the words typed, and it is the same sliding window the staff palette uses, with its own map and numbers, so a customer never spends a staff allowance). The per-person allowance is what stops one person from taking every concurrency slot. The cost is still unmeasured (M3): no latency or capacity claim is made until it is measured on a seeded database, and the measurement goes in the work log. Reading the signed-in person costs one identity-provider read before the allowance is checked.

Open follow-ups, not built here:

- No limit shared across server instances. The per-person allowance counts in each instance's own memory, so several instances allow more in total. A shared limit needs a table, so it is a migration and owner-gated.
- The Companies budget is the per-client budget public intake also uses (6 an hour in the synthetic mode, 120 in the real mode), so a search that reads Companies, the Companies page and public intake from one address draw on one allowance. A search spends one unit however many pages it reads; the owner may tighten that to one unit per page.
- A 429 writes no log line, so a flood cannot also flood the log; the 429 carries only the request id.
- A batch title lookup in `packages/auth` would cut the lookups; build it only if the measured cost is high.
- The dialog stylesheet is a prefixed copy of the staff palette rules because the staff files must not change. Consolidating the two is a later task.
- The request detail page has no withdrawn wording.

## 13. Acceptance

| Id  | Check                                                                                                          | Test                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P1  | "spain" finds "Sell in Spain" with sent date and status; "spian" is marked close                                | `customer-search-core.test.ts`, `customer-search-facts.test.ts`                           |
| P2  | A company is found by name; reports counted from loaded pages; same company across pages merged                | `customer-search-core.test.ts`                                                            |
| P3  | Pages are only what the shell offers; Companies absent when off; no "soon" hit                                  | `customer-search-pages.test.ts`                                                           |
| P4  | Keyboard and scope helpers match the staff behaviour                                                            | `customer-search-status.test.ts`                                                          |
| P5  | Empty, one-letter and symbol-only queries read nothing                                                          | `customer-search-route.test.ts`                                                           |
| D1  | Signed out is a 401 with no service call, before any slot or allowance                                                                 | `customer-search-route.test.ts`, `customer-search-route-depth.test.ts`                    |
| D2  | Cross-tenant and header mismatch; extra ids in the body rejected; B finds nothing of A (Requests and Companies, both against the database)                          | `customer-search-route-depth.test.ts`, `customer-search-database.test.ts`                 |
| D3  | Removed member finds nothing; re-admission restores; revoked not found; withdrawn shown (Requests and Companies, both against the database)                         | `customer-search-database.test.ts`, `customer-search-core.test.ts`                        |
| D4  | No staff service, no SQL, no catalogue in the route or core                                                     | `customer-search-source.test.ts`                                                          |
| D5  | Closed account is 403 with its code; archived is a Requests state                                              | `customer-search-route-depth.test.ts`                                                     |
| D6  | Each flag off makes that scope unavailable with zero calls; all off is 503                                      | `customer-search-route-depth.test.ts`                                                     |
| D7  | Generic 500; later-page failure partial with one log line; three failed lookups stop                            | `customer-search-route-depth.test.ts`, `customer-search-core.test.ts`                     |
| D8  | Bad body, scope, size, origin, content type                                                                     | `customer-search-route.test.ts`                                                           |
| D10 | A person past 10 searches in 10 seconds gets 429 before any service call; the key is the signed-in person, so no browser-sent value resets it; nobody signed in is not counted; the map is bounded; a customer never spends a staff allowance | `customer-search-limit.test.ts`, `customer-search-status.test.ts`, `customer-search-ui.spec.ts` |
| D11 | The Companies budget is spent once per search that reaches Companies, before the first portfolio page (a four page search charges exactly one unit; a search that never reaches Companies charges none); a spent budget gives a `limited` scope (or a 429 when every scope is limited) with zero portfolio reads; the Requests scope is unaffected | `customer-search-core.test.ts`, `customer-search-route-depth.test.ts` |
| D12 | Anonymous requests hold no slot and read no service (401 first); sample data is labelled and never described as verified or live | `customer-search-route-depth.test.ts`, `customer-search-core.test.ts`, `customer-search-facts.test.ts`, `customer-search-ui.spec.ts` |
| D9  | The query is in no log, response or service argument                                                            | `customer-search-route-depth.test.ts`                                                     |
| R5  | No state that is not a complete search ever says "No match"                                                     | `customer-search-status.test.ts`                                                          |
| M1  | Bounded work: caps, the process slots, the overall deadline and the abort signal                               | `customer-search-core.test.ts`, `customer-search-route-depth.test.ts`                                                            |
| M2  | Headers on every answer of the route handler                                                                                         | `customer-search-route.test.ts`, `private-api-headers.test.ts`                            |

The browser checks (R1 to R4, M4) belong to the UI stage and are listed in its own specification.
