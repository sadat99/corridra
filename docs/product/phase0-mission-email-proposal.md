# Phase 0: first two mission emails

Status: proposal for the owner, 23 October 2026. Nothing here is switched on. The switch `CORRIDRA_MISSION_EMAIL_ENABLED` does nothing yet, and the Owner page says so.

## What is built and tested

| Piece                             | File                                          | What it does                                                                                                                                                                                                                                                                               |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Message 1, "We have your request" | `packages/auth/src/mission-mail-templates.ts` | The exact words from the plan, a button, a two line signature, the footer with Mute this request, Manage messages and the language code. The sentence about signing in with a code is used only when code sign-in is on. The owner's one sentence renders nothing at all when it is empty. |
| Message 4, "Your move"            | same file                                     | The exact words from the plan, no personal signature, and a typed input (`MissionMove`) with length limits. With no due date the date sentence is dropped.                                                                                                                                 |
| Mute link token                   | `packages/auth/src/mission-mail-mute.ts`      | A keyed hash of the request id with one fixed purpose. It proves a link is genuine and belongs to one request. No sign-in is needed to check it.                                                                                                                                           |
| Send rules                        | `packages/auth/src/mission-mail-gate.ts`      | One decision, with a reason: the switch must be exactly `true`, real use must be on, the workspace must not be a sample, the account email must be verified, and the address must be usable. The switch is read first, so with it off nothing else is looked at.                           |
| Founder sentence setting          | `MISSION_EMAIL_FOUNDER_LINE`                  | One sentence, plain text, cut to 280 characters. Unset means nothing is shown.                                                                                                                                                                                                             |
| Tests                             | `tests/integration/mission-mail.test.ts`      | 34 checks. Each rule was broken on purpose once and a test caught it.                                                                                                                                                                                                                      |

The templates reuse the AC/1 colours and the escaping of the sign-in emails. Only English exists. A new language is a new entry in the catalog.

One deliberate difference from the plan text: when the request has no short description, the plan says to use "your request" for the job. That would read "Your request about your request". The template drops the phrase instead and says "Your request has reached us".

## What is not built, and why

The plan asks for the events and outbox pattern, a mute that works, and no sending from a request handler. Today that cannot be done without a database change. These facts come from reading the code.

1. **Nothing reads the outbox for email.** `app.outbox` rows are written for many events, but the only dispatcher (`packages/workflows/src/index.ts`) works on the controlled communications queue, and only the synthetic channel exists. The database also refuses a real email channel there.
2. **The app cannot add an event type.** The runtime database role can only read the event and outbox tables. Rows come from database functions and triggers. A new "send this email" event needs a new function.
3. **There is nowhere to remember a mute.** Opt-outs exist only for outreach contacts, written by staff. A signed-out customer clicking a link cannot write any existing record. A signed link proves the link is genuine, but not that it was clicked.
4. **The verified email address is not stored.** The identity provider returns it during a request. The database keeps only a short-lived hash. A background sender would not know where to send.
5. **There is no "move" for a customer.** The `next_action` on a mission is the team's own next step and must not be sent to a customer. No table records something a customer must do by a date. The trigger waits for the Mission Road work.
6. **Sample accounts use `.invalid` addresses**, which can never receive mail. The send rules refuse them.

## Smallest change that makes it work (needs your approval)

An additive migration, applied by the offline schema-owner tooling like the other customer modules, with the runtime role getting only execute rights on named functions.

1. `customer_private.mission_mail_mute` : request id, purpose (`mute`), created time. One row per request and purpose. No personal data.
2. `customer.mute_mission_mail(request_id, token)` : checks the keyed hash inside the database, inserts the row once, and returns the same answer on a repeat so a click can be repeated safely.
3. `customer_private.mission_mail_queue` : request id, kind (`request-received` or `your-move`), the recipient address, state, attempts, and `retention_until` set to the request retention (30 days). Written in the same transaction as the request, only when the switch is on.
4. `customer.claim_mission_mail` and `customer.finish_mission_mail` : lease, retry with a cap, and a record that the mail went out, modelled on the existing communications claim and finish functions. The sender reuses the Resend transport already written for sign-in codes.

Blast radius: new objects only, no existing table or function changes, none of it is reachable with the switch off. Rollback: drop the four objects; the queue holds nothing the person cannot already see in their request. The new rows are excluded from counts, reports and delivery because no existing query reads these tables.

Open choice for you: storing the recipient address is new personal data. The alternative is to send once, in the same request that creates the request, which the plan forbids. I recommend the queue with the 30 day limit.

## Words for the privacy notice (for your review; the page is not edited)

The privacy page now says mission reply emails are not sent. When these emails are on, I suggest replacing that sentence with:

> We email the verified address on your account when we receive your request and when we need something from you about it. Each of these emails has a link to mute that request and a link to your account settings. We keep the address used for sending only as long as we keep the request, and never share it. Sign-in and password emails are separate.

Keep the switch off until you have reviewed this.

## What you need to do

1. Write the one founder sentence for message 1, then set `MISSION_EMAIL_FOUNDER_LINE`.
2. Approve, change or reject the migration above.
3. Review the privacy wording.
4. Say when the Mission Road work should supply the "move" that message 4 needs.
