# Pulse email: privacy review record, 25 October 2026

**Document status: CURRENT, DATED.** Engineering privacy review of Pulse as merged on 25 October 2026; re-check against the code before quoting. See the [plan status register](../PLAN_STATUS.md).

Reviewer: Claude (an AI engineering assistant), on the written instruction of the owner, Nazmus Sadat, on 25 October 2026 ("U do the privacy review now"). A second, independent read-only reviewer checked the first pass. This is an engineering review of what the system does and says. It is not legal advice and it does not replace the privacy lawyer review of the notice, which stays a separate later owner step in the ledger.

Scope: Pulse as merged in PR 205 (email about requests, off until a person switches it on, address read at send time), the privacy notice, the staff Move screen, the email templates and the database functions. Nothing was observed in production; everything below is from the code, the tests and rendered emails.

## Findings

| #    | Finding                                                                                                                                                                                  | Decision                                                                                                                                                                                                                                                   | Status                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| B1   | The privacy notice did not describe Pulse (what is emailed, the processor, what is kept, the withdrawal path).                                                                           | Blocker. A Pulse paragraph, a purposes bullet, a processors line, a storage line and an "in short" line now appear on the privacy page only while Pulse is on, so the notice and the feature open in the same deploy.                                      | Fixed in this change, tested.        |
| B2   | Staff write the Move words freely. They go into the email body, were in the subject, and are kept as record history. A careless entry could put an ID number or a health detail in mail. | Blocker. Subjects are now generic. The Move form refuses any run of seven or more digits. The staff screen carries a plain warning that the words are emailed and kept. Length stays 80 characters, plain text, escaped.                                   | Fixed in this change, tested.        |
| B3   | Message 1 says "reply and tell us". If the reply-to mailbox is not watched, a person's reply to a message about their own request goes nowhere.                                          | Owner confirmation condition, not a code change. Mission mail already uses the same reply wording and the same mailbox variable. The value is encrypted in Vercel and cannot be read from here.                                                            | Open: owner confirms before opening. |
| NB1  | A person who said yes while the control was open could not say no if the control was later paused.                                                                                       | Withdrawal must always work. Saving an empty list of kinds is allowed while closed, in the database and in the form, and while the Pulse switch is off for a signed-in person who already said yes (page and route). Switching on is refused while closed. | Fixed (migration 0002), tested.      |
| NB2  | The consent record has no notice version.                                                                                                                                                | Accepted for now. Every choice version has its time, and the notice date is 25 October 2026 while Pulse is first opened. Revisit if the notice text changes after opening.                                                                                 | Accepted, recorded.                  |
| NB3  | The greeting uses the person's name from their account, which the earlier pack did not say.                                                                                              | Disclosed in the notice and the pack. It is the name the person gave when signing up, sent only to their own inbox.                                                                                                                                        | Fixed in docs and notice.            |
| NB4  | Resend keeps its own delivery record with the address and content.                                                                                                                       | Disclosed in the notice. Retention and data location are an owner check in the Resend account (condition below).                                                                                                                                           | Open: owner checks.                  |
| NB5  | The daily email has no mute link, even when it holds one request.                                                                                                                        | Accepted. It has the Manage messages link, which switches the daily email or all email off. The pack now says so.                                                                                                                                          | Accepted, disclosed.                 |
| NB6  | Outbox rows and titles are never deleted.                                                                                                                                                | Accepted for now as request history, disclosed in the notice ("not deleted automatically; contact us"). A deletion process needs its own design with the privacy lawyer.                                                                                   | Accepted, residual risk R2.          |
| NB7  | The address is read inside the database at send time and could be mistaken for stored data.                                                                                              | Verified: the lookup needs a secret-derived capability and a message leased right now, returns only a verified address of the owning account, and nothing writes it down (tests cover each refusal).                                                       | No change needed.                    |
| NB8  | The owner may not be able to read the sign-in provider's user table from the database role.                                                                                              | The enable run asks first and refuses to open when it cannot, so nothing opens in a state that cannot send.                                                                                                                                                | Handled by design.                   |
| NB9  | The Email choices page said the mute help in a way that did not match the product.                                                                                                       | Wording corrected.                                                                                                                                                                                                                                         | Fixed.                               |
| NB10 | A hidden invalid quiet-hours value blocked switching email off (Codex finding on PR 205).                                                                                                | Switching off sends the last saved values, so it can never be blocked by a half-edited form.                                                                                                                                                               | Fixed, tested.                       |
| NB11 | Messages 2, 3 and 4 have templates and no trigger.                                                                                                                                       | Nothing to review until they have a trigger. Each needs its own review when built.                                                                                                                                                                         | Deferred by design.                  |

## Second pass: independent reviewer on the fixes

A second, read-only reviewer checked the fixes and found no blocker. What it found, and what was done:

| #   | Finding                                                                                              | Done                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| S1  | A person could not switch email off while `CORRIDRA_PULSE_ENABLED` was off (page 404, route 503).    | A signed-in person who already said yes can reach the page and switch off; switching on stays refused. Tested. |
| S2  | The notice said "we do not keep your address in our own database"; the sign-in table is in it.       | Now "our email records do not hold your address".                                                              |
| S3  | The notice, form and pack said every single-request email has a mute link; the daily email has none. | Wording corrected in all three: only emails sent one at a time carry it.                                       |
| S4  | Docs said "first name"; the email greets with the account name (up to 80 characters).                | Docs corrected (ADR-067, lane, install, pack, template header).                                                |
| S5  | Stale statements: "titles and dates only", "no privacy wording changed".                             | Corrected in ADR-067 and the install doc.                                                                      |
| S6  | The long-number rule was described as enforced by the form and the database.                         | It is enforced by the server that parses the Move; comments and ADR now say so.                                |
| S7  | Bangla and Arabic-Indic digits passed the long-number rule.                                          | The rule now counts digits in any script. Tested.                                                              |
| S8  | The data-request query left out preference and outbox columns.                                       | Added; a test still runs the block.                                                                            |
| S9  | No test for yes while open, pause, withdraw, reopen.                                                 | Added to the database suite.                                                                                   |
| S10 | A future translation could put the title in a subject.                                               | Subjects are filled with nothing, so such a catalog throws; every locale is tested.                            |

## Conditions before the database control and the switch are opened

1. The owner confirms the replies mailbox (`CUSTOMER_AUTH_MAIL_REPLY_TO`) is read by a person.
2. The owner checks the Resend account for retention and data location, and that the notice sentence matches.
3. The updated privacy notice goes live in the same deploy as `CORRIDRA_PULSE_ENABLED=true` (it does, because both depend on that switch).
4. The owner knows that the privacy lawyer review of the notice is still ahead and that this record is not a substitute.

## Residual risks

| #   | Risk                                                                               | Why accepted for now                                                                                        |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| R1  | A staff member writes a sensitive detail below seven digits (a name, a diagnosis). | Warning on screen, 80 character limit, plain text only. Staff are the Corridra team, not the public.        |
| R2  | Message records and Move words are kept with no deletion process.                  | Disclosed. A person can contact us and the owner can answer with the query below. Needs a designed process. |
| R3  | Resend keeps a delivery record outside Corridra's control.                         | Disclosed. Owner check in the Resend account.                                                               |
| R4  | The consent record does not say which notice version was shown.                    | Time of each choice is kept and the notice has a date.                                                      |

## Answering a person's data request (owner query)

Run read-only by the database owner, replacing the placeholder with the person's sign-in subject. It lists what Pulse keeps about them and never an address, because none is kept.

```sql
SELECT n.version, n.kinds, n.digest, n.quiet_start, n.quiet_end, n.time_zone, n.language, n.created_at AS saved_at
FROM customer_private.principal p
JOIN customer_private.notification_preference n ON n.principal_id = p.id
WHERE p.subject = '<sign-in subject>' ORDER BY n.version;

SELECT o.request_id, o.kind, o.title, o.ref_date, o.status, o.attempts, o.available_at, o.created_at, o.finished_at
FROM customer_private.notification_outbox o
JOIN customer_private.principal p ON p.id = o.principal_id
WHERE p.subject = '<sign-in subject>' ORDER BY o.created_at;

SELECT m.request_id, m.created_at
FROM customer_private.notification_mute m
JOIN customer_private.owned_request r ON r.id = m.request_id
JOIN customer_private.principal p ON p.id = r.principal_id
WHERE p.subject = '<sign-in subject>';
```

The column names were checked against `customer-notification-migrations/0001_notifications.sql` and `customer-migrations/0003_private_customer_requests.sql`.
