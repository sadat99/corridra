# Lane 5: the Room, the Road on a request and the lenses

Status: built and dark, 24 October 2026. Switches `CORRIDRA_UX_ROAD` and `CORRIDRA_UX_LENSES`, both off by default. With both unset every customer page is exactly what it was, and the Room address answers "not found".

## What exists when the switches are on

| Switch               | What changes                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CORRIDRA_UX_ROAD`   | `/account/rooms/[requestId]` exists: the request's emblem, received date, the Road, the team's replies and one tap to every action of the saved request page. The saved request page gains one link to its Room. Your Move opens a request in its Room. |
| `CORRIDRA_UX_LENSES` | The Room shows Compare and Evidence lenses over the delivered report. On the saved mission page the offers are drawn as cards with the table one tap away.                                                                                              |

## The Room

| Part         | Source                                                                               | Rule                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emblem       | The request's own objective text                                                     | Initials plus one of four fixed tones from a stable hash. Never stock imagery.                                                                                                                                    |
| Road         | The mission status a customer may already read                                       | [ADR-071](../adr/0071-road-mapping.md). Compare is done only when a delivered report exists for the same request; Decide is never claimed (a customer cannot read a decision here), so it says "not tracked yet". |
| Replies      | The same private request interface the saved request page uses                       | The latest reply first, the rest one tap away. Read only: the Room adds no reply box.                                                                                                                             |
| Report link  | `customer.assigned_missions`, matched on the exact request id                        | Only an available assignment for this request counts. A saved copy is preferred; a delivered but unsaved report points to the Library, never to a page that is not there.                                         |
| Actions kept | Saved request, request help (where service requests are on), saved report or Library | Every old action stays one tap away.                                                                                                                                                                              |

The request data is read by the browser from the private request interface with the person's own headers, never cached, and cleared when the page is hidden, the same way the saved request page does it.

## The lenses

- **Compare.** Cards over the existing comparison engine. A filled seal and "Comparable on supplied terms" only when `compareOffers` says so; otherwise an open ring, "Not comparable yet" and the engine's own reason (the missing terms, an expired offer, a total that does not match unit price times quantity, or that the offer does not match the current request). Never a ranking, a score or a recommendation. The original currency with its code, exact amounts, a missing term shown as "not stated" and never zero. The matrix is untouched and one tap away (Cards or Table). The engine and its tests are not edited.
- **Evidence.** The five fact labels with their one-line gloss, then the evidence requests and decisions of the report. The fact label on a price is shown only when the claim status is one of the five names; any other status shows the source and status as written, and nothing is weakened to a lesser word.
- **Trip** stays planned: the customer screens do not yet hold visit data the Trip lens could show without inventing it.

The saved report gained two optional properties and nothing else: `lenses` (off by default) and `section` (`all` by default, which is the whole page as it has always been). The Room mounts it with `compare` or `evidence`.

## Scroll and layout

Overview is a short record. At 320, 390, 768 and 1440 px there is no sideways scroll in any lens, every action is at least 44 px tall and the accessibility scan is clean (`tests/operator/ux-room.spec.ts`). The comparison table scrolls inside its own region by design. Screenshots: `docs/design-system/evidence/lane5-room/`.

## Words

21 `room.*` and `compare.*` messages in English and as drafts in Bangla, Chinese, Spanish and Arabic. The region says which language it is written in; the report inside the lenses is English and says so.

## Not included, with the reason

- A decision on the Road: customers read reviewed decisions only through the decision history, which this lane does not call. The Road says "not tracked yet" rather than guess.
- A separate Trip lens (above).
- An Arabic or Chinese version of the report: report text is original data and is never translated.

## Flip and rollback

Set `CORRIDRA_UX_ROAD=true` (and `CORRIDRA_UX_LENSES=true` for the lenses) after a signed-in preview. Remove either to roll back; nothing was migrated and nothing is stored.
