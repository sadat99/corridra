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

## The database change as built (Phase A, approved)

A new optional installer module, `customer-mission-mail-migrations`, installed by the owner-run workflow like the Network module. It adds new objects only. No existing table, policy, trigger, grant or function changes. It depends on real-use admission being installed and refuses to install without it.

| Object                                      | What it holds or does                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mission_mail_control`                      | Append-only open or closed versions with a reason. No row means closed. Opened only by the offline owner operation.                                                                                                                                                                                                           |
| `mission_mail_queue`                        | One row per message: request id, kind, state, attempts, retry time, and hashes of two secrets. Never an address, a name or message text. Rows are never deleted, identity columns never change, finished rows never change again.                                                                                             |
| `mission_mail_recipient`                    | The only place an address is kept, with the typed name and a short description of the request, for sending. Deleted when the message is sent, muted, dead or after 24 hours, whichever is first. This is a deliberate difference from the append-only rule, because the repo has no erasure path for an address.              |
| `mission_mail_mute`                         | One row per muted request. Ids only. Append-only.                                                                                                                                                                                                                                                                             |
| `customer.enqueue_mission_mail`             | Runs inside the customer's own request transaction. Checks the control, the real session, that the caller owns the request, that the workspace is real, and that the address equals the verified email hash from the session proof. Returns "not queued" with a reason, never an error, for closed, sample or unusable cases. |
| `claim_mission_mail`, `finish_mission_mail` | Lease for 60 seconds, retry with a cap of three, backoff to a minute, permanent failure ends at once. Both need a capability computed from the server secret, so the database role alone cannot read an address.                                                                                                              |
| `mute_mission_mail`                         | No sign-in. Needs the link token, which is tied to one request and one purpose. A repeat returns the same answer. A wrong token and an unknown request are refused identically.                                                                                                                                               |

Each queue and mute action also writes an event and an audit row with ids only. No outbox row is written, because nothing would consume it and a row with no consumer would suggest a delivery that did not happen.

Blast radius: new objects only. Nothing reaches them with the control closed. Rollback: close the control with the workflow (`mission_mail_action = pause`), unset the application switch. Records stay, as everywhere else in this system.

How it is installed: the protected **Install customer modules** workflow, from `main`, after exact-head CI and CodeQL, with `mission_mail_action = install` (creates the objects, sends nothing), later `enable` (opens the database side) with a written reason. Nothing is installed by merging.

Tested against a real PostgreSQL with the real roles (`tests/integration/mission-mail-database.test.ts`, 22 checks). Seven deliberate breaks of the SQL were tried: six failed a test at once, and the seventh (the sample workspace rule) survived until a test for it was added, after which it failed too.

## Words for the privacy notice (for your review; the page is not edited)

The privacy page now says mission reply emails are not sent. When these emails are on, I suggest replacing that sentence with:

> We email the verified address on your account when we receive your request and when we need something from you about it. Each of these emails has a link to mute that request and a link to your account settings. We keep the address used for sending only as long as we keep the request, and never share it. Sign-in and password emails are separate.

Keep the switch off until you have reviewed this.

## What you need to do

1. Write the one founder sentence for message 1, then set `MISSION_EMAIL_FOUNDER_LINE`.
2. Run the install workflow when Phase B is merged: first `install`, then, after you have read the privacy wording, `enable` with a reason.
3. Review the privacy wording.
4. Say when the Mission Road work should supply the "move" that message 4 needs.
