# Phase 0: first two mission emails

Status: approved by the owner on 23 October 2026 ("Yes, go for update in database"). Phase A, the database module and installer, and Phase B, the application side, are built and tested. Nothing is installed or switched on: the database control starts closed and `CORRIDRA_MISSION_EMAIL_ENABLED` is off.

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

## Why a database change was needed, and what still waits

The plan asks for the events and outbox pattern, a mute that works, and no sending from a request handler. That could not be done without a database change. These facts come from reading the code. Points 1 to 4 and 6 are now answered by the module below. Point 5 still waits.

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

## Privacy notice (edited 23 October 2026, with the owner's approval)

The privacy page (`/privacy`) now shows, only while real use is on and `CORRIDRA_MISSION_EMAIL_ENABLED` is `true`:

> We email the verified address on your account when we receive your request. Each of these emails has a link to mute messages about that request and a link to your account. We keep the address used for sending in the Frankfurt application database for at most 24 hours, only to send the email, and we do not share it with anyone else. These emails are sent through Resend, like account verification emails. Sign-in and password emails are separate.

Where this differs from the first suggestion, it follows what is built: no "when we need something from you" (that message is not wired), "your account" instead of "your account settings", and "at most 24 hours" instead of "as long as we keep the request". With the switch off the page still says "Mission reply emails are not sent." The notice version string is unchanged. `tests/integration/privacy-notice.test.ts` renders the real page and checks both states.

## The application side as built (Phase B)

| Piece                                            | What it does                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/auth/src/mission-mail.ts`              | Queues inside the request transaction, in a savepoint, so a mail problem can never fail or undo the request. Sends one attempt at a time. Mutes. Derives the two secrets from the server secret.                                                                                                                   |
| `customer-requests.ts`                           | An optional mail port. It exists only while `CORRIDRA_MISSION_EMAIL_ENABLED` is exactly `true` in real use. Delivery starts only after the request has committed. With the switch off the request code path is unchanged.                                                                                          |
| `apps/web/workflows/mission-mail.ts`             | A durable workflow with a few spaced attempts. The database also caps attempts at three and expires a message after 24 hours.                                                                                                                                                                                      |
| `/mute/[requestId]` and `/api/mission-mail/mute` | Public, not indexed, no cache, no referrer. The token is in the address fragment and is removed from the address once read. Opening the page mutes nothing; the button does. Every refusal reads the same. They keep working if the sending switch is later turned off, so an older email's Mute link still works. |
| Owner page                                       | `CORRIDRA_MISSION_EMAIL_ENABLED` is now a real switch, and `MISSION_EMAIL_FOUNDER_LINE` is listed (its text is never shown).                                                                                                                                                                                       |

Message 1 uses these words: "We have your request". The job phrase comes from the request type the person chose ("selling in a new market" and so on), never from free text. Message 4 ("Your move") is written and tested but has no trigger and cannot be queued: the database refuses that kind until the Mission Road work supplies a real move.

Tests: `tests/integration/mission-mail-flow.test.ts` (8, real database and roles, a recorder in place of the provider; four deliberate breaks each failed a test) and `tests/browser/mission-mail-mute.spec.ts` (page, headers, button behaviour, refusals, axe at 1440, 390 and 320).

## What you need to do, in this order

1. Merge Phase A, then Phase B. Merging installs and enables nothing.
2. Run **Install customer modules** from `main` with `mission_mail_action = install`. This creates the objects. Nothing can be queued yet because the database control is closed.
3. Set the sender settings if they are not already set (`CUSTOMER_AUTH_MAIL_KEY`, `CUSTOMER_AUTH_MAIL_FROM`, `CUSTOMER_AUTH_MAIL_REPLY_TO`, the same ones the sign-in emails use) and `MISSION_EMAIL_FOUNDER_LINE` with your sentence.
4. Privacy page: done. It shows the paragraph above only after the switch is on. Check it on the live site after the next deploy.
5. Set `CORRIDRA_MISSION_EMAIL_ENABLED=true` and let the next deployment finish.
6. Run the workflow again with `mission_mail_action = enable` and a written reason. This is the moment mail can start.

To stop: run the workflow with `mission_mail_action = pause`, and unset the switch. To check before going live, do steps 2 to 6 on a non-production database first.

Still yours to do: write the founder sentence, and say when the Mission Road work should supply the "move" that message 4 needs.
