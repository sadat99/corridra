# Phase 2 install steps for the owner

Status: written 24 October 2026 with Lane 7 of the UX update. Nothing here is applied by merging. Every step below is yours to run, in this order, and each can be undone.

## What exists after Lane 7 merges

| Module                        | Switch                     | Database control       | What a person sees when it is on                                                                          |
| ----------------------------- | -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Move records (ADR-068)        | `CORRIDRA_UX_MOVE_RECORDS` | `move_records_action`  | The Corridra team can set what a person must do next; Your Move shows it as a card.                       |
| Pulse notifications (ADR-067) | `CORRIDRA_PULSE_ENABLED`   | `notifications_action` | An Email choices page, and the Your Move email once an address source exists.                             |
| Reply review (ADR-069)        | `CORRIDRA_REPLY_PAGE`      | `reply_review_action`  | The team reviews supplier replies beside the requirement; the supplier page is the new one-question form. |

With every switch unset and every control closed, every page, address and email is exactly what it was before Lanes 7 and 8.

## Order

1. Run the install job (`install-customer-modules`, protected environment `customer-modules-install`) with `move_records_action = install` and `apply = yes`. This adds the Move tables and functions. Nobody sees any change.
2. Run it with `notifications_action = install` and `apply = yes`. This adds the Pulse tables and functions, and installs Move records first if step 1 was skipped. Nobody sees any change.
3. Look at the result in a signed-in preview before opening anything.
4. To open Move records: run the job with `move_records_action = enable` and a reason of at least ten characters, then set `CORRIDRA_UX_MOVE_RECORDS=true` (and `CORRIDRA_UX_MOVE=true` for Your Move itself).
5. To open the Email choices page: run the job with `notifications_action = enable` and a reason, then set `CORRIDRA_PULSE_ENABLED=true`. The page lets people save their choices. It sends nothing.
6. Email stays off until the privacy review below is done and an address source is chosen.
7. To open the team's review of supplier replies: run the job with `reply_review_action = install` and `apply = yes` (nothing visible changes), then `reply_review_action = enable` with a reason of at least ten characters, then set `CORRIDRA_REPLY_PAGE=true`. This also switches the supplier page to the new form. Reply review installs the real-use functions first if they are missing. Pause with `reply_review_action = pause`; every reply and review is kept.
8. Before real outreach is ever opened, run the in-app browser test plan in [lane8-reply-page.md](lane8-reply-page.md) with a person who has WeChat and WhatsApp.

Rolling back: run the job with `pause` (every record stays; queued messages expire within a day) or unset the switch. Pausing a control stops new work at once and loses nothing.

## What blocks Pulse from sending, on purpose

| Open item                                                        | Why it is yours to decide                                                                                                                                                                                                                                                                                                                                                                                                                                    | What I built so far                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the verified address comes from at send time               | Corridra's database holds only a hash of a customer's verified email (as the sign-in design intends). The team's session does not carry the address. Two honest options: read it from the identity provider by account id at send time (needs a server credential for the provider that I have not been given), or ask each person to opt in and keep their address only for as long as the choice stands. Each has a privacy cost, so it needs your review. | The send path asks a single function for the address (`RecipientPort` in `packages/auth/src/customer-notifications.ts`). Today that function says there is no source, so nothing is claimed or sent, and every queued message expires within a day. |
| Privacy review of the email texts and the retention of the queue | Plain wording a customer reads; kept records.                                                                                                                                                                                                                                                                                                                                                                                                                | The texts are in `packages/auth/src/pulse-templates.ts`, English only, titles and dates only. No legal or privacy wording was changed anywhere.                                                                                                     |
| Other languages for email                                        | Needs a reviewed translation.                                                                                                                                                                                                                                                                                                                                                                                                                                | English only; a person who picks another language still gets English, and the page says so.                                                                                                                                                         |

Until all three are settled the application switch can be on and the control can be open and still nothing is emailed.

## What Pulse never does

- It never emails a teammate, a supplier or an address typed by anyone. Only the verified account holder who owns the request.
- It never puts a price, a supplier name, a file or free text from the team in an email. A title and a real date only.
- It never sends while a request is muted, while a kind is switched off by the person, or after the Move it is about is done or cleared.
- It never keeps an address: the queue holds ids, a plain title and a date.
- Quiet hours and the daily email only delay a message (it stays valid for a day from when it can first be sent); they never drop one that is still wanted.

## Sign-in return

Email links open an exact page after sign-in: the request, its Room, Your Move or the Email choices page. This is a short list of exact paths with strict checks (no host, no query, no fragment, no traversal). It is navigation only and gives no access. It applies only while `CORRIDRA_PULSE_ENABLED=true`; with the switch off the only kept destination is `/plan`, as before.
