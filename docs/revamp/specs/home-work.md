# Home and Work screens

Document status: CURRENT.

Track S2, Wave 2. The customer Work screen shows one list of the person's work from the [work-item adapter](work-items.md), with a context selector for Sell, Source and Organise. It sits inside the locked customer navigation and changes no route, permission or payload.

## Where it lives

- **Navigation stays locked.** Switch off: Home, My Work, Companies, Results, More. `CORRIDRA_UX_NAV` on: Your Move, Missions, Companies, Library, More. No new tab and no rename.
- **Work is `/account?view=work`.** The new list goes first in that view, under its heading. Every panel the view has today stays mounted below it, in the same order, with the same `id`s: `customer-workspaces` (CustomerWorkspaces), the delegation registrations link, `customer-requests` (CustomerRequests) and the "Manage your work" links. They may move into one closed disclosure titled "Workspaces, requests and settings" with a count line, except that an address with a `#customer-workspaces` or `#customer-requests` hash opens it and scrolls to that panel, as today.
- **Home is unchanged in this wave**, apart from one quiet link under the next-step card: "See all your work" to `/account?view=work`. Your Move (`/account/move`) is unchanged; its truth states are already merged.

## The list

Pattern: Queue (UI direction, five page patterns). One primary action per row.

| Part             | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context selector | A real radio group (not tabs, not capsules), label "Show": All, Sell, Source, Organise, Other. Default All. The choice is kept in the address as `?view=work&work=sell` and so on, read through a closed list; an unknown value falls back to All.                                                                                                                                                                                          |
| Row              | Title as stored (`lang` set from content when it is Chinese or Bangla, as the Room does), a kind word (Draft request, Request, Programme, Service request), the workspace name, the source's status in its existing customer words (`customerStatusLabel` and the existing service-status words; never a new status), its date as "Updated 4 Nov 2026" or "Sent 4 Nov 2026" / "Created 4 Nov 2026" by `atKind`, and one `text-link` "Open". |
| Counts           | The selector shows each family's count from the read items ("Source 3"). When `partial` or `unreadable`, counts read "3 or more", never a plain number.                                                                                                                                                                                                                                                                                     |
| Length           | First 20 rows, then one "Show 20 more" button. Within the Record/queue scroll budget (4 phone screens, 2.5 desktop) with 20 rows of long text.                                                                                                                                                                                                                                                                                              |
| Start            | Under the list, one quiet row of three links that reuse the existing deep links: "Sell: find buyers" `/plan?job=buyers`, "Source: find suppliers" `/plan?job=sourcing`, "Organise a delegation" `/plan?job=delegations`. When a request can be started from a workspace, keep the existing workspace start path as today.                                                                                                                   |

## States (every one designed at 390, 768 and 1440 px)

| State          | When                                                               | What it says and shows                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading        | Server render in progress (streaming fallback)                     | `role="status"` "Loading your work…". No skeleton rows that look like data.                                                                                                                          |
| True empty     | Every source that is on was read and gave nothing                  | "You have no work here yet." and the three start links. No count of zero is shown as a result.                                                                                                       |
| Filtered empty | All has items, the chosen family has none                          | "No Source work. Show all" (a link that sets All).                                                                                                                                                   |
| Unreadable     | `unreadable` is not empty and `items` is empty                     | The Your Move wording: "We could not check everything just now. Something may be waiting for you that this page could not read. Your work is safe." and "Try again" (reload). Never the empty words. |
| Partial        | Items shown and (`partial` or `unreadable` or `skippedWorkspaces`) | The list, then one `role="note"` line: "This list may not show everything." plus "Try again" when unreadable, or "Open your workspaces" when skipped.                                                |
| Denied         | The session check fails                                            | The account page's existing signed-out or verify-email screen; the list is not rendered.                                                                                                             |
| Module off     | `CORRIDRA_CUSTOMER_WORKSPACES_ENABLED` off                         | No list section at all; the view is exactly what it is today.                                                                                                                                        |

## Widths

- **390:** one column; each row is a card (`detail-card` look, 12 px radius) with title, then kind and workspace on one wrapping line, then status and date, then Open. Selector wraps to two lines without horizontal scroll. Touch targets 44 px.
- **768:** same cards, two facts per line.
- **1440:** rows on one grid: title, kind, workspace, status, date, Open. Sticky header, tabular numerals for dates. No table if it cannot keep 44 px targets; use the row grid.

## Required tests (S2, named by id)

| Id   | Case                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-01 | With the switch off and with `CORRIDRA_UX_NAV` on, the tab labels and order are exactly as today.                                                             |
| H-02 | Every existing `id`, link destination and panel on `?view=work` is still rendered (snapshot of ids and hrefs before and after).                               |
| H-03 | `#customer-workspaces` and `#customer-requests` open the disclosure and land on the panel.                                                                    |
| H-04 | Each of the seven states renders its exact words; unreadable never shows the empty words.                                                                     |
| H-05 | `work=` accepts only the five values; anything else is All; the value never reaches the page unescaped.                                                       |
| H-06 | Counts read "N or more" whenever the list is partial or unreadable.                                                                                           |
| H-07 | At 320, 390, 768 and 1440: no sideways scroll, 44 px targets up to 768, axe clean, one primary action per region, within the scroll budget with 20 long rows. |
| H-08 | The three start links go to the existing `/plan?job=` addresses and nowhere else.                                                                             |

Not in this wave: changing Results, Companies or More; any new status word; any number not read from a record.
