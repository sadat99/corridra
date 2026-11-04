# Decision card, step 4: the screens

Document status: CURRENT.

Track S2, Wave 4. The database module, service and routes are built (PR 261, PR 262) behind `CORRIDRA_SHARE_CARD`, default off; the module is not installed in production. This step adds only the two screens. [ADR-076 item 4](../../adr/0076-trip-books-and-decision-sharing.md) is the contract and wins on any difference; nothing here widens it. Building does not enable: enabling needs the recorded privacy review, the installed module and the owner.

## Owner panel (inside the saved mission page)

- Shown only when the switch is on and the person is the saved-mission holder and a current owner or admin of the request's workspace (the service decides; the screen never guesses). Otherwise it is absent, not disabled.
- Step 1: choose ONE currently reviewed SELECT, DECLINE or NEED_INFORMATION disclosure. Step 2: preview the exact six fields (company, decision, rationale, next action, due date, one provenance label). Step 3: an explicit acknowledgement checkbox, then "Create link". Nothing is created before step 3.
- After create: the link (`/decision-card#<token>`) with a copy button, its expiry date with time zone, the plain line "Anyone with this link can see these six fields until it expires or you withdraw it", the open count with the line "Counts page loads, including automatic link checks", and "Withdraw".
- States: CHANGED (409) "The decision changed since the preview. Preview again." CAP_REACHED (409) "Five links are active for this report. Withdraw one first." 429 "Too many new links in the last hour. Try again later." 503 "Not available right now." Real (non-sample) workspace: "Decision cards are available for sample workspaces only."

## Public page `/decision-card`

- A bare page: no customer, team or public navigation shell, and no component that reads the session. Use one shared `isBarePublicPage(pathname)` predicate so the header, footer and any session-reading component stay out.
- On load it reads the token from `location.hash`, removes it from the address bar with `history.replaceState`, and sends it in a POST body to `/api/decision-card`. Never a query string, GET or local storage.
- It shows the six fields read-only, with nothing actionable, or the single message "This link is not available." for every non-open answer.
- Headers and meta: `no-store`, `no-referrer`, `noindex`.

## Required tests (S2, named by id)

| Id   | Case                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| D-01 | Real production build: loading `/decision-card#<token>` makes no get-session request and receives no `Set-Cookie`.                   |
| D-02 | The token never appears in a request URL, the page URL after load, `localStorage` or `sessionStorage`.                               |
| D-03 | An unknown token, a random token and a switch-off answer render byte-identical page text: "This link is not available."              |
| D-04 | `noindex` and `no-referrer` are present on the page; responses are `no-store`.                                                       |
| D-05 | The public page renders only the six fields; a seeded price, contact, file and second decision appear nowhere in the HTML.           |
| D-06 | The owner panel creates nothing before the acknowledgement; the preview shows exactly the six fields.                                |
| D-07 | CHANGED, CAP_REACHED, 429, 503 and the real-workspace case each show their exact words.                                              |
| D-08 | Withdraw is offered only to the creator; after withdraw the public page shows "This link is not available."                          |
| D-09 | With the switch off, no panel and no link appear anywhere, and the saved mission page is exactly as before (ids and hrefs snapshot). |
| D-10 | 320, 390, 768 and 1440 px: no sideways scroll, 44 px targets, axe clean, for both screens.                                           |

`Sensitive: yes` (public unauthenticated route, tokens, cookies). Guardian PASS required.
