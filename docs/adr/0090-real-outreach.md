# ADR-090: Real outreach by email, test mode first

Status: Proposed 23 November 2026 for the owner decision of 23 November 2026 that opened "Real outreach" (commercial-ready run, section 1). Test mode first. Live mode is not opened by this record: it needs the owner's word "live". Update 26 November 2026 (records, decided by Guardian G65 on the owner's delegation): built and merged in PRs 620 (`bf608ec8`, unit B9) and 627 (`916abd3f`, unit B9b). `CORRIDRA_REAL_OUTREACH` defaults off and the mode defaults to test; no module install, provider values or webhook are recorded as done. Live mode still needs the owner's word "live". This note changes no decision.

Amends ADR-018 and ADR-069 forward: both say real outreach and email to suppliers are closed. From this record on, a real workspace may email a reviewed introduction to a real company contact under the rules below. Everything else ADR-018, ADR-056, ADR-058, ADR-069 and ADR-081 decide stays in force. Those records are not edited.

## Context

- Introductions were sample only at four database points in `packages/db/migrations/0009_controlled_communications.sql`: `app.guard_communication()` refused any workspace that is not a sample workspace and any EMAIL policy, `app.communication_allowed` required a sample workspace, a sample company, an `@example.invalid` address and a SYNTHETIC or MANUAL channel, `app.deliver_synthetic` refused EMAIL, and the receipt accepted only the providers `synthetic` and `manual`.
- Real workspaces can already hold real company contacts and carry the real processing purpose on the communication tables (customer real-use migrations 0002 and 0007).
- The dispatcher refused every channel but SYNTHETIC and MANUAL in code, and only the sample channel was wired.
- Every function that records something no signed-in person records (a delivery receipt, a recipient's answer, an opt-out) looked up its service executor in `app.intake_destination`, which is a single row for the sample workspace. A real workspace had none, although the real-use configuration already names a real executor.
- The code already reaches one mail provider, Resend over HTTPS with an idempotency key, for sign-in mail. No new dependency is needed.

## Decision

### One pipeline, two lanes that cannot mix

The existing tables, reply page, opt-out and staff list are kept. The lane is chosen by the kind of workspace and is enforced in the database:

- A sample workspace takes only the SYNTHETIC and MANUAL channels. Its conditions are unchanged.
- A real workspace (real use allowed) takes only the EMAIL channel. A policy with jurisdiction OTHER covers a company in a country outside BD, ES and DE.
- A sample workspace with an EMAIL policy and a real workspace with a sample channel are both refused. A sample message can never get an email receipt. A real introduction is never labelled a sample, and a sample one is never shown as real.

### What must be true before a real message can be sent

1. The optional database module `packages/db/outreach-real-migrations` is installed (it needs the real-use modules through 0020).
2. The switch is on (below).
3. The workspace has `communications.introductions` and `communications.dispatch` on.
4. An owner or admin of that workspace, with a fresh two-step check, has created an EMAIL contact policy for it. This is the per-workspace lock: without that policy a real workspace can send nothing.
5. A staff member with two-step sign-in and access to the relationship creates the introduction and records consent for that message.
6. A staff member dispatches it.

### Approval before each send is kept

There is no new way to send. Each real message is created by a staff member (`introduce`) and dispatched by a staff member (`dispatch`), one message per approval. A real message is dispatched only when a staff member names that one message; a dispatch without a message id starts the waiting sample messages only and never a real one. There is no schedule, no batch and no automatic send. An introduction on an EMAIL policy without its consent basis is refused when it is created, in plain words. `app.communication_allowed` checks the approver again when the message is claimed and when it is delivered: role, two-step sign-in, country, purpose, classification, expiry, policy version and revocation.

In this unit the staff screen does not yet offer the EMAIL channel or the consent fields. Real outreach is reachable only through the existing command. The staff fields are follow-up unit B9b.

### Switch and test mode

Names only. Values are set by the owner and are never written in the repository.

| Name                                           | Meaning                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `CORRIDRA_REAL_OUTREACH`                       | On only when exactly `true`. Unset or anything else is off. Default off.                          |
| `CORRIDRA_REAL_OUTREACH_MODE`                  | Live only when exactly `live`. Unset or anything else is test mode. Default test mode.            |
| `CORRIDRA_REAL_OUTREACH_TEST_RECIPIENTS`       | Comma list of exact addresses that may receive a test message in test mode.                       |
| `REAL_OUTREACH_MAIL_KEY`                       | Mail provider key.                                                                                |
| `REAL_OUTREACH_MAIL_FROM`                      | Verified sender address.                                                                          |
| `REAL_OUTREACH_MAIL_REPLY_TO`                  | Reply address.                                                                                    |
| `REAL_OUTREACH_WEBHOOK_SECRET`                 | Signing secret for the provider's bounce and complaint notices.                                   |
| `CORRIDRA_REAL_OUTREACH_DAILY_WORKSPACE_LIMIT` | Optional. Sends per workspace per day (UTC). Default 20, capped at 200 by the database.           |
| `CORRIDRA_REAL_OUTREACH_DAILY_GLOBAL_LIMIT`    | Optional. Sends across all workspaces per day (UTC). Default 100, capped at 1000 by the database. |

- In test mode a message leaves only for an address on the test list, with "[Test]" at the start of its subject. Every other message goes to a sink that makes no network call. Both are recorded with the receipt provider `email_test`, which is never counted as an approach on a customer report. The staff list data marks them "Test, not sent" or "Test, sent to a test address only"; showing that note on the staff screen is part of B9b.
- In live mode a delivered message is recorded with the receipt provider `email`.
- Fail closed: with the switch on and the key, sender, reply address, signing secret or `APP_ORIGIN` missing or malformed, nothing is read, sent or recorded. Live mode with a missing setting is closed, never treated as test mode.
- A message that cannot be sent (switch off, setting missing, limit reached, provider failure) ends its attempt without a receipt. After three attempts it stops and is kept; the existing staff retry queues it again. Nothing is sent twice: the message id is the provider idempotency key.

### Consent

A real introduction carries a recorded basis (consent, legitimate interest, existing relationship or published business contact) and a note, written by the staff member who creates it, in the same transaction. Without it the message cannot be queued. The record is immutable.

### Opt-out and suppression

- Every real message carries a visible opt-out link (`/buyer?stop=1` with its own private token) and the headers `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- The opt-out link has its own token, which opens nothing else. Opening the page changes nothing, and opening the one-click address in a browser only leads to that page; only the button or the mail provider's one-click POST records the opt-out. The opt-out has its own limits per caller and per token and never spends the shared hourly total, so other traffic cannot close it. It works with every switch off, after the message has expired, and can be repeated.
- Suppression is by a hash of the address and applies to every workspace. An address is suppressed by an opt-out link, a hard bounce, a complaint, or an opt-out recorded in any real workspace. Suppression is checked when a message is created, queued and claimed, when the address is handed to the sender, and when its page is read. If a suppression lands after the provider has accepted a message, the receipt is still recorded and every later send is stopped.

### Bounces and complaints

Signed notices from the provider arrive at `POST /api/outreach/webhook`. A notice is refused when the signing secret is not set, when the signature is wrong and when it is older or newer than five minutes. Each notice is recorded once. A hard bounce or a complaint suppresses the address everywhere; a soft bounce does not. No address and no notice body is stored or logged.

### Rate limits

One send is counted per workspace per day before any provider call, under one lock. A reached workspace or global limit sends nothing.

### The reply page for a real recipient

A real recipient opens the same private page from the emailed link. The page is answered under the real workspace's processing purpose and is not labelled a sample. The three answers, the opt-out and the full reply form are recorded by the real-use executor. Changing an answer afterwards (`app.recipient_detail_revise`) is not opened for real recipients in this unit.

### Database changes

One new optional family, `packages/db/outreach-real-migrations/0001_real_outreach.sql`. It adds four tables (consent, suppression, provider notices, daily counts; the runtime role writes them only through functions and cannot read suppression or counts) and replaces seven functions, each guarded by the hash of the definition it expects:

- `app.guard_communication()` and `app.communication_allowed(uuid,boolean)`: the real lane beside the unchanged sample conditions.
- `app.experience_outreach_rows_for(uuid,uuid[])`: a test-mode receipt never counts a target as approached.
- `app.record_capability_change()`, `app.buyer_decide(text,uuid,text,boolean)`, `app.buyer_optout(text)` and `app.recipient_detail_respond(text,uuid,jsonb)`: only the lookup of the service executor is swapped for `app.outreach_executor`, which gives a sample workspace the sample executor, a real workspace the real-use executor, and anything else nobody.

The receipt provider check gains `email` and `email_test`.

## Rollback

1. Turn the switch off. This closes the real lane at once and needs no data change. Opt-outs and notices are still recorded.
2. Only if the module itself must be removed: `rollback/0001_restore.sql` restores the seven functions and the receipt check, as a reviewed forward run. It refuses while any real-lane receipt exists. Tables and history written by the module stay.

## What stays closed

- Live mode. It opens only on the owner's word "live".
- Any automatic, scheduled or batch outreach.
- Real email from a sample workspace and sample channels in a real workspace.
- Changing an answer on the reply page for a real recipient, and the staff screen fields for the EMAIL channel and consent (B9b).

## Consequences

- Seven existing functions now depend on this module's executor lookup. A later migration that replaces one of them must start from the installed definition, as the hash guards require.
- A hard bounce or a complaint in one workspace stops mail to that address from every workspace.
- A retried attempt that the provider refused has already used one count of the daily limit. This is the cautious side of the limit.
