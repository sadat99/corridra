# ADR-067: Notification records and Pulse (email about what needs a person)

Status: accepted by owner delegation, 24 October 2026 (see the execution record in [the UX plan](../product/ux-update-plan-corrected-2026-10-24.md)). Default off. Nothing is sent to a real customer until the owner has done the privacy review and opened the database control. Switch `CORRIDRA_PULSE_ENABLED`.

## Context

Mission mail (Phase 0) sends one message, "We have your request", to the verified account holder. Its queue accepts one kind, `request-received`. The template for message 4, "One thing needs you", exists but nothing triggers it, because no record says what a person must do ([ADR-068](0068-move-records.md) adds that record). Messages for a request that moves forward, a date that is close and a mission that closes do not exist. A person also has no way to choose what they are emailed, to be emailed once a day, or to keep quiet at night.

## Decision

An optional additive module, `customer_notification_migrations`, beside mission mail and never editing it. Mission mail, its queue, its mute page and its workflow stay exactly as they are.

- **Kinds.** `your-move` (message 4), `update` (message 5, a request moved forward), `countdown` (message 6, a recorded date is near) and `complete` (a mission closed). Each is a new template function. Message 1 is not edited.
- **Records, all append only.** A preference record per person (which kinds, daily digest on or off, quiet hours as a start and end time with a time zone, and a language for mail); a mute record per request; an outbox of messages to send, with the same lease, retry, expiry and dedupe rules as mission mail (three attempts, a 60 second lease, a 24 hour expiry, one message per request, kind and dedupe key). The recipient address is read at send time from the verified account and is never kept beyond the send.
- **Recipient.** Only the verified account holder who owns the request. Never a teammate, a supplier or an address typed by anyone.
- **Content.** The body shows the name on the person's account (up to 80 characters), the team's short description of the Move (80 characters at most, plain text, escaped) and a date. A subject never carries the team's words. Staff are told on the Move screen that these words are emailed and kept, and are asked never to write ID or document numbers, people's names, or health, legal or money details; the server refuses any run of seven or more digits in any script (the staff screen shows why); the database does not repeat that rule. No file, price table or supplier field is ever read into an email. Links go to the canonical origin only, to an exact internal path, and a link grants no access: it only decides where a person lands after signing in.
- **Format.** Single column, a plain-text twin, no open-tracking pixel, safe in dark mode, ready for right-to-left. English until a language preference is stored.
- **Controls.** Mute per request (the existing token link pattern), a daily digest, and quiet hours by time zone. Digests and quiet hours only delay; they never drop a message that is still valid.
- **Sign-in return.** `accountReturnTo` accepts exactly `/plan` today, so an email link loses its destination at sign-in. It is extended to a short allow-list of exact internal paths with strict checks (no scheme, no host, no `//`, no encoded separators, no query or fragment beyond the exact path). It is navigation only.
- **Control.** A control table, closed until the owner opens it, with an offline `configure` step like mission mail's. The application switch is separate. Both must be on, and `realUseEnabled` must be true.
- **Order.** Email first. Web push comes after, and WhatsApp is not covered here.

## Address source and consent (owner decision, 25 October 2026)

The owner chose option A with opt-in from the three options in [phase2-install](../product/phase2-install.md): the address comes from the sign-in provider at send time, and only a person who switched email on is emailed.

- **Off by default.** A person who has saved no choice has email off (an empty list of kinds). Saving at least one kind is the opt-in; each saved choice is a new version row with its time, which is the record of consent. Switching email off saves an empty list. A message already queued is suppressed when its kind is no longer chosen.
- **Address read at send time, never stored.** The provider keeps its users in `neon_auth."user"` in the same database. `customer.notification_recipient(queue, capability)` returns the verified address of the one account that owns the request, only while that message is leased to the sender, only with the secret-derived capability, only with the control open and the person's email on, and only when the provider marks the address verified. The application holds it in memory for the one send. No table stores it and no log carries it. A person with no verified address gets nothing.
- **Opening is checked.** The install job refuses `notifications_action=enable` unless the database owner can read that table with the columns the lookup needs, so email is never opened in a state that cannot send.
- **People are told.** The Email choices page leads with a plain on and off switch and says email is off until it is switched on. Your Move and the request page show a short prompt, "Email is off", to a person who has never chosen, with a link to the switch. "Not now" is remembered in that browser for 14 days, and a person who switched email off on purpose is not asked again. Every email says the person switched email on.
- **Still the owner's.** The privacy review of the email texts and of the 24 hour queue before the control is opened, and reviewed translations (email is English only).
- **A second migration file.** The first file is installed and its hash is checked, so the change is `0002_email_off_until_chosen.sql`. Enabling runs every pending file first.

## Abuse cases

A forged link to another person's request (the owner check is in the database function); replay of a send (idempotent by key); a mail scanner opening a mute link (nothing happens until the button is pressed); an attacker choosing a return path (exact allow-list, never a free value); personal data in logs (events carry ids only); a flood of messages (per request and per day caps, and quiet hours); a staff typo, or a sensitive detail, in a Move description sent to a customer (the text is plain, escaped, limited to 80 characters, refused by the server if it holds a long number, and carries a plain warning on the staff screen; there is no staff preview before saving, so the warning and the digit check are the controls, and the words are kept as record history).

## Not included

Web push, WhatsApp, SMS, any message to a supplier or buyer, marketing mail, and any change to mission mail.

## Rollback

Set `CORRIDRA_PULSE_ENABLED` off, or run the install job with the notification action `pause`. Records and the outbox are kept, queued messages expire within 24 hours, and mission mail is unaffected.

## Required acceptance

Database tests: install is repeatable and refuses a changed history; the control starts closed; internal tables are unreachable by the runtime and auth roles; another person's or an unknown request is refused; a signed-out call is refused; preferences and mutes are append only; a message is never queued while muted, outside a kind the person chose, or to an unverified account; no personal data in events; mission mail's grants, functions and policies are unchanged. Unit tests: every template renders the name, the team's short words and a date, never in a subject, escapes text, has a plain-text twin and no tracking pixel; quiet hours and digest timing across time zones and daylight saving; the sign-in allow-list refuses every non-listed path.
