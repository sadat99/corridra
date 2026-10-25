# UX update: what was built, what is switched off, and what is yours to do

Written 25 October 2026 at the end of the build, by the session that ran the corrected plan alone under the owner's delegation ([the plan, section 0](ux-update-plan-corrected-2026-10-24.md)). Nothing here is switched on. Every change is behind its own switch, off by default, and with a switch off the page is what it was. Three optional database parts are installed only by your install job and start closed.

## The lanes

| Lane | What it is                                                               | Switch (all off)                          | Needs an install step       | Detail                                                       |
| ---- | ------------------------------------------------------------------------ | ----------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| 1, 3 | The shared teaching layer (Road, holder badge, Move card), ADRs 66 to 71 | none (library)                            | No                          | `docs/adr/`, `apps/web/components/mr/`                       |
| 2    | Language phase 2 (46 teaching words, five drafts, script-aware type)     | `CORRIDRA_LANGUAGES_REVIEWED`, `_PREVIEW` | No                          | ADR-066, [language review record](language-review-record.md) |
| 4    | Your Move front door, plain navigation names, All tools                  | `CORRIDRA_UX_NAV`, `CORRIDRA_UX_MOVE`     | No                          | [lane4](lane4-front-door.md)                                 |
| 5    | The Room, the Road on a request, Compare and Evidence lenses             | `CORRIDRA_UX_ROAD`, `CORRIDRA_UX_LENSES`  | No                          | [lane5](lane5-room.md)                                       |
| 6    | Picture-first first question, one Sample or Real label                   | `CORRIDRA_UX_FIRSTQ`                      | No                          | [lane6](lane6-first-question.md)                             |
| 7a   | Staff-set Moves                                                          | `CORRIDRA_UX_MOVE_RECORDS`                | Yes: `move_records_action`  | [lane7a](lane7a-move-records.md)                             |
| 7b   | Pulse email choices and records (sends nothing)                          | `CORRIDRA_PULSE_ENABLED`                  | Yes: `notifications_action` | [lane7b](lane7b-pulse.md)                                    |
| 8    | Supplier Reply Page, and the team's review of replies                    | `CORRIDRA_REPLY_PAGE`                     | Yes: `reply_review_action`  | [lane8](lane8-reply-page.md)                                 |
| 9    | An address for each of the 18 team workspace sections; view as samples   | `CORRIDRA_UX_OPERATOR_URLS`               | No                          | [lane9](lane9-operator-urls.md)                              |
| 10   | The Programme Room                                                       | `CORRIDRA_UX_PROGRAMME`                   | No                          | [lane10](lane10-programme-room.md)                           |
| 11   | French and German drafts, the pseudo-language test                       | none (the language rule holds them back)  | No                          | [lane11](lane11-languages.md)                                |
| 12   | Fair pages with checked dates, the Countdown                             | `CORRIDRA_UX_FAIRS`                       | No                          | [lane12](lane12-fairs.md)                                    |
| 13   | Founder and helper front doors                                           | `CORRIDRA_UX_FRONT_DOORS`                 | No                          | [lane13](lane13-front-doors.md)                              |

## What is not built, and why

| Item                                                                              | Why                                                                                                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Any email to a real person                                                        | Pulse has no source for a verified address (see decision 1). The queue, texts and choices exist; nothing is claimed or sent.           |
| The Trip view, Trip Book and Supplier Book                                        | The customer screens hold no itinerary or visit data to show or print. `CORRIDRA_UX_TRIP` and `CORRIDRA_UX_BOOKS` stay planned.        |
| Staff entering a reply on a supplier's behalf                                     | The reply table is immutable and each row is the supplier's own statement. It needs its own provenance and your decision.              |
| A company lane, agenda conflicts, "ready" counts in the Programme Room            | The records do not hold them (registrations carry a label, not a company; there is no readiness record). Each is explained in lane 10. |
| A "next task" card for helpers                                                    | It needs the task board's data and the contributor access review.                                                                      |
| Decision card sharing, status link, Pulse emitters for messages 5, 6 and complete | Planned in ADRs; the emitters wait for the phase 2 interviews.                                                                         |
| Any native reviewer's sign-off                                                    | A person's judgment. Six languages are drafts.                                                                                         |

## Your decisions

1. **Where Pulse gets a verified address** (identity provider read, or a person's opt-in) and a privacy review of the email texts and the queue's retention. Until then nothing is sent, even with the switch and the control on.
2. **A native reviewer for each language** (Bangla, Chinese, Spanish, Arabic, French, German). Record the name and date in the language review record, then list the code in `CORRIDRA_LANGUAGES_REVIEWED`. Legal and privacy text needs a qualified reviewer per language.
3. **Gate 3** (before you switch Wave 4 on for real use): the 10 to 15 interviews on co-owner or bank involvement, the supplier test with about ten real suppliers, and service promises per route.
4. **Whether fair pages may be found by search**, and who adds and re-checks fairs. The list ships empty on purpose.
5. **WeChat and WhatsApp in-app browsers**: a person with each app runs the short test plan in lane 8 before any real outreach is opened.
6. **The contributor sign-in change** still waits for its security review. Nothing in this update touches it.

## Install and switch order (each step can be undone)

1. Look at each switch in a signed-in preview of the deployed site before you turn it on. The Owner page lists every switch and its state.
2. For the three database parts, run the `install-customer-modules` job in its protected environment, in this order, each with `apply = yes`: `move_records_action = install`, then `notifications_action = install`, then `reply_review_action = install`. Nothing anyone can see changes. Then `enable` (with a reason of at least ten characters) for the ones you want, and set the matching switch. `pause` stops a part at once and keeps every record.
3. Turn on the switches that need no install in any order: they change only what a person sees, and unsetting one restores the old page.
4. Never turn on email (Pulse sending) until decision 1 is settled.

## What was checked

- Every lane has unit tests for its rules, an operator spec that mounts its real screens with the real stylesheets at 320, 390, 768 and 1440 px (no sideways scroll, 44 px targets, clean accessibility scan), and a test of every switch-off path. Database parts have their own database suites (additive, repeatable, append only, closed to the runtime roles, refusing another tenant).
- Each pull request passed the required checks on its exact head before it was merged, and main CI and the Vercel production deploy were confirmed for each merge commit.
- Review findings from Codex were fixed in the same pull requests.
- Gates D01 to D06 and D08, real operations and provider activation are untouched and closed.
