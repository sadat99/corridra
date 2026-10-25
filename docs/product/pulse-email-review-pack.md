# Pulse email: review pack for the owner

Written 25 October 2026 so the privacy review can be done in one sitting. Pulse is built and closed. Nothing is sent to anyone until you have read this, accepted or changed it, and opened it (steps at the end). This pack is a plain description of what the system does, not legal advice; the privacy lawyer review in the ledger is separate.

## What you are deciding

| #   | Decision                                                                                                                                       | My recommendation                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | Are the email texts below acceptable as they stand?                                                                                            | Yes for message 1, the only one that can be sent today.                                               |
| 2   | Is it acceptable that a record of each message (a plain title, a date and its status, never the address) is kept as history and never deleted? | Yes for now. The same words already sit in the Move records. A deletion process needs its own design. |
| 3   | Does the reply address read by a human? Message 1 says "reply and tell us".                                                                    | Confirm the mailbox set for mission mail (`CUSTOMER_AUTH_MAIL_REPLY_TO`) is watched before opening.   |
| 4   | Does the privacy notice wording below say the right things?                                                                                    | Yes. It appears on the privacy page only while Pulse is on.                                           |

## Who is emailed, and when

- Only the verified account holder who owns the request, at the verified address on their account. Never a teammate, a supplier, a buyer or an address typed by anyone.
- Only if that person switched email on. Email is off for everyone until they do (Email choices page). Each person is told: the page leads with the switch, and Your Move and the request page show an "Email is off" prompt until they choose.
- Never for a request they muted, never for a kind they switched off, never after the thing it is about is done or cleared, never from a sample workspace.
- At most three messages a day for one request and ten a day for one person. Quiet hours and the daily email only delay a message; it stays valid for 24 hours after it can first be sent, and then it expires unsent.

## The messages (rendered with sample data)

Every email is a single column with a plain-text twin, no open-tracking pixel, and titles and dates only. A price, a supplier name, a file or free text from the team never appears.

### 1. One thing needs you

The only message that can be sent today. The Corridra team sets a Move that the person must do; the person is emailed once.

![1. One thing needs you](../design-system/evidence/lane7b-pulse/emails/your-move.png)

Plain text:

```text
Subject: One thing needs you: Add your import licence number

Hi Amina,

Your request needs one thing from you: Add your import licence number.

Please do it by 23 November 2026. If that date does not work, reply and tell us.

Open: https://c.obsidianglobal.studio/account/requests/6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e

You are getting this because you switched on email about your requests in Corridra.
Mute this request: https://c.obsidianglobal.studio/pulse/mute/6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e#t=SAMPLE-TOKEN-NOT-REAL
Manage messages: https://c.obsidianglobal.studio/account/notifications
Language: en
```

### 2. Your request moved forward

Text and template exist. Nothing triggers it yet (see "What is not built").

![2. Your request moved forward](../design-system/evidence/lane7b-pulse/emails/update.png)

Plain text:

```text
Subject: Your request moved forward

Hi Amina,

Your request moved forward: Meetings are being arranged.

See your request: https://c.obsidianglobal.studio/account/requests/6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e

You are getting this because you switched on email about your requests in Corridra.
Mute this request: https://c.obsidianglobal.studio/pulse/mute/6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e#t=SAMPLE-TOKEN-NOT-REAL
Manage messages: https://c.obsidianglobal.studio/account/notifications
Language: en
```

### 3. A date is coming up

Text and template exist. Nothing triggers it yet.

![3. A date is coming up](../design-system/evidence/lane7b-pulse/emails/countdown.png)

Plain text:

```text
Subject: Your Madrid visit is coming up

Hi Amina,

Your Madrid visit is on 3 December 2026.

See the plan: https://c.obsidianglobal.studio/account/requests/6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e

You are getting this because you switched on email about your requests in Corridra.
Mute this request: https://c.obsidianglobal.studio/pulse/mute/6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e#t=SAMPLE-TOKEN-NOT-REAL
Manage messages: https://c.obsidianglobal.studio/account/notifications
Language: en
```

### 4. Your mission is complete

Text and template exist. Nothing triggers it yet.

![4. Your mission is complete](../design-system/evidence/lane7b-pulse/emails/complete.png)

Plain text:

```text
Subject: Your mission is complete

Hi Amina,

Hotel towels for Spain is complete. Your report is waiting in your account.

Open your report: https://c.obsidianglobal.studio/account/requests/6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e

You are getting this because you switched on email about your requests in Corridra.
Mute this request: https://c.obsidianglobal.studio/pulse/mute/6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e#t=SAMPLE-TOKEN-NOT-REAL
Manage messages: https://c.obsidianglobal.studio/account/notifications
Language: en
```

### 5. The daily email

Sent instead of single messages when the person chose "one email a day". It gathers what is due into one message at 08:00 in their time zone.

![5. The daily email](../design-system/evidence/lane7b-pulse/emails/digest.png)

Plain text:

```text
Subject: What is waiting for you

Hi Amina,

Here is what is new in your requests.

Add your import licence number (by 23 November 2026)

Your Madrid visit (by 3 December 2026)

Open Your Move: https://c.obsidianglobal.studio/account/move

You are getting this because you switched on email about your requests in Corridra.
Manage messages: https://c.obsidianglobal.studio/account/notifications
Language: en
```

The words come from `packages/auth/src/pulse-templates.ts`. English only: a person who picks another email language still gets English, and the Email choices page says so. The sample address, name and mute token above are made up.

## What is kept, and where

| Item            | What it holds                                                                                                                                                                                                                                         | How long                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Email choices   | Which messages, daily email, quiet hours, time zone, language, and the time each choice was saved. Saving at least one kind is the opt-in; saving none is the opt-out.                                                                                | Every version is kept (append only). This is the record of consent.                                                                           |
| Message record  | Request id, person id, kind, the plain title (the team's Move words), a date, status, times, and digests of two tokens. Never an address, a name, a price or free text.                                                                               | Kept as history (append only, never deleted). A message that cannot be sent within 24 hours of becoming due is marked expired; the row stays. |
| Mute record     | The request id only.                                                                                                                                                                                                                                  | Kept.                                                                                                                                         |
| Activity events | Ids and the kind only.                                                                                                                                                                                                                                | Kept with the other audit events.                                                                                                             |
| The address     | Read from the sign-in account (`neon_auth.user`, verified addresses only) inside the database at the moment of sending, held in memory for that one send, and handed to the mail provider (Resend, the same one used for sign-in and mission emails). | Not written to any Corridra table or log.                                                                                                     |

## What is not built

- Messages 2, 3 and 4 (a request moved forward, a date is close, a mission closed) have texts but no trigger. They wait for the phase 2 interviews. Only message 1, and the daily email that gathers message 1 items, can go out today.
- Email in other languages (needs a reviewed translation).
- Deleting a person's choices or message records on request. The records are append only by design; an erasure process for them is not designed yet and belongs with the privacy lawyer review.
- Web push and WhatsApp (outside ADR-067).

## Privacy notice wording (appears only while Pulse is on)

> If you switch on email about your requests, we email the verified address on your account when something needs you. Email is off until you switch it on, and you can switch it off at any time on the Email choices page. We read the address from your account at the moment we send and do not store it. Each email shows only a plain title and a date, with a link to your request and a link to mute messages about that request, and is sent through Resend, like account verification emails. We keep your email choices, with the time you made them, and a record of each message (its title, date and status, never your address) in the Frankfurt application database as part of your request history.

## Opening Pulse, and undoing it

1. Run the `install-customer-modules` job with `notifications_action = enable`, `apply = yes` and a reason of at least ten characters. You approve it in the protected environment. It applies the new migration, checks that the database owner can read the sign-in provider's user table (and stops with a plain message if not), and opens the database control.
2. Set `CORRIDRA_PULSE_ENABLED=true` in Vercel production and redeploy. Real use must be on (it is).
3. People then see the "Email is off" prompt. Nobody is emailed until they switch email on.

To undo: run the job with `notifications_action = pause` (stops new work at once; every record is kept), or remove `CORRIDRA_PULSE_ENABLED` and redeploy.

Not observed: whether the production database owner can read the sign-in provider's user table. Step 1 reports it and refuses to open if it cannot, so nothing is opened in a state that cannot send.
