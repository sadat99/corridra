# Work-item adapter contract

Document status: CURRENT.

Track S2, Wave 2. One read-only adapter turns the customer's existing records into one list of work items for the Work screen. It adds no table, no route and no write. Code lives in `apps/web/lib/work-items/` (S2). It reads only through the services the account and Your Move already call, with the same session proof.

## Sources and how each is classified

A work item has a `family`: `SELL`, `SOURCE`, `ORGANISE` or `UNCLASSIFIED`. Classification is explicit only. If no stored field below decides it, the family is `UNCLASSIFIED`, shown to people as "Other".

| Source (existing service)                                     | Item kind         | Family comes from                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customerMissionDrafts.list` (status `OPEN` only)             | `draft`           | The stored `family`: `BUYERS_PARTNERS` to `SELL`, `SUPPLIERS_PRODUCTS` to `SOURCE`, `DELEGATION` to `ORGANISE`, `OTHER` to `UNCLASSIFIED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `customerRequests.list`, plus `customerRequestDetails.detail` | `request`         | The stored `objective` in the request detail's original brief, only when that objective appears in exactly one family of `missionDraftObjectives` (`packages/domain/src/mission-drafts.ts`), computed from that table at run time, never hand-copied. Today that makes `Sell in a new market` and `Find customers or distributors` `SELL`, `Source suppliers` `SOURCE`, `Run a multi-company mission` `ORGANISE`; `Make an upcoming business trip more productive` (in every family) and `Something else` are `UNCLASSIFIED`. A detail that cannot be read gives `UNCLASSIFIED`, never a guess. |
| `customerProgrammes.list` (organiser workspaces)              | `programme`       | Always `ORGANISE`: the record is a programme the workspace runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `customerServiceRequests.list`                                | `service_request` | Always `UNCLASSIFIED`. Its `contextLabel` is display text, never a classifier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The mission job (`experience.job`, 15 catalogue keys) has no family in the catalogue and is never used to classify. Titles, company names, emails, countries, markets, service titles and context labels are never used to classify or to match records.

## Item shape

```ts
type WorkItem = {
  key: string; // `${kind}:${id}`, unique in the list
  kind: 'draft' | 'request' | 'programme' | 'service_request';
  id: string; // the source record id, unchanged
  workspaceId: string;
  family: 'SELL' | 'SOURCE' | 'ORGANISE' | 'UNCLASSIFIED';
  title: string | null; // stored text as written; for a request, requestTitle(detail.original) as the requests route derives it; null when unreadable
  status: string; // the source's own status value, never renamed
  at: string; // ISO time from the source
  atKind: 'updated' | 'created'; // which time `at` is; a creation time is never shown as an update
  href: string; // an existing route for this record (see below)
};
type WorkList = {
  items: WorkItem[];
  unreadable: WorkSource[]; // sources that are on and failed, as in Your Move
  partial: boolean; // a list was longer than the pages read
  skippedWorkspaces: number; // workspaces beyond the cap, not read
};
```

`href` is only an existing destination, built the way `apps/web/lib/move-cards.ts` builds it today: draft `/account/drafts/<workspaceId>`, request `/account/requests/<id>` (or `/account/rooms/<id>` only when `CORRIDRA_UX_ROAD` is on, as Your Move does), programme `/account/delegations/<workspaceId>`, service request `/account/service-requests/<workspaceId>/<id>`. Reuse that code or copy it; do not invent a route or add a query parameter.

## Scope and joins

1. **Allowed workspaces only.** The adapter first reads `customerWorkspaces.list` for the person. An item whose `workspaceId` is not in that set is dropped and counted in a private `excluded` number used only by tests. It is never shown or logged.
2. **No joins by text.** Two records are linked only by an explicit stored id: an `OPEN` draft is shown; a `SUBMITTED` draft is not shown when its `requestId` names a request already in the list. Nothing is merged because two titles, companies, emails or countries match.
3. **No duplicates.** One source record gives at most one item.
4. **Order.** `at` newest first, then `key`, so the order is stable. Drafts and service requests use their update time (`atKind: 'updated'`); requests and programmes have only a creation time (`atKind: 'created'`) and the screen labels it as sent or created, never as updated.
5. **Truth states.** Reuse the Your Move rules: a source that is on and fails goes into `unreadable`, a module that is off is a true empty, a cut-off list sets `partial`. The workspace and page caps are the existing `moveWorkspaceCap` and `movePageCap`.
6. **No money, no contacts.** The item carries no amount, price, quote figure, markup, contact name, email or phone, even where the source has one.

## Not listed: delegation registrations (decision, 4 Nov 2026)

`customerParticipants.own()` rows carry no `workspaceId` and no update time, and scoping one would need a programme read that a member cannot make. A registration therefore never becomes a work item: an unscoped item would break rule 1, and a joined one would break rule 2. The existing Delegation registrations link on the Work view stays exactly where it is, so nothing becomes unreachable. Revisit only if the registration read gains an explicit, authorised workspace id.

## Required test cases (S2 writes each red first, named by id)

| Id   | Case                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-01 | Draft families map exactly: `BUYERS_PARTNERS` SELL, `SUPPLIERS_PRODUCTS` SOURCE, `DELEGATION` ORGANISE, `OTHER` UNCLASSIFIED.                                    |
| W-02 | Each request objective classifies by the one-family rule; `Make an upcoming business trip more productive` and `Something else` are UNCLASSIFIED.                |
| W-03 | The objective map is computed from `missionDraftObjectives`: adding a test fixture where an objective appears in two families makes it UNCLASSIFIED.             |
| W-04 | A request whose detail read fails is UNCLASSIFIED and still listed, and the list is not marked unreadable for that alone.                                        |
| W-05 | Programmes are ORGANISE; service requests are UNCLASSIFIED whatever their title or context label says (fixtures use "Sell", "Source", "Delegation" words).       |
| W-06 | A record whose workspaceId is not in the person's workspaces is dropped and never appears in `items`.                                                            |
| W-07 | Two records from different sources with the same title, company, email and country stay two items.                                                               |
| W-08 | A SUBMITTED draft whose `requestId` is in the list is hidden; one whose request is not in the list is not shown as a draft either (only OPEN drafts are listed). |
| W-09 | Each failing source is named in `unreadable`; a source that is off is never named; all sources failing gives an empty `items` with a non-empty `unreadable`.     |
| W-10 | A list longer than the page cap sets `partial`; workspaces beyond the cap set `skippedWorkspaces`.                                                               |
| W-11 | No item contains any amount, currency, quote, markup, email, phone or contact field (checked against the serialised list).                                       |
| W-12 | Every `href` is one of the existing route patterns; a fixture id with `/`, `?` or `#` is rejected or encoded, never injected.                                    |
| W-13 | Order is newest first by `at` and stable for equal times; requests and programmes carry `atKind: 'created'`.                                                     |
| W-14 | `title` and `status` are passed through as stored: a Chinese or Bangla title is unchanged; a status value is never renamed.                                      |
| W-15 | No `participation` item is produced, and the Delegation registrations link is still rendered on the Work view.                                                   |

Review: the Guardian checks every case is present and fails without the code, and reads the adapter for any classification or join that is not in this file.
