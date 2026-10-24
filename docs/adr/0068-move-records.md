# ADR-068: Move records (what a person must do next)

Status: accepted by owner delegation, 24 October 2026. Default off. Switch `CORRIDRA_UX_MOVE_RECORDS`, and a database control that starts closed.

## Context

A customer can only be told what to do next if a record says so. Today nothing does. The mission `next_action` is a staff-approved sentence inside a delivery publication, shown on the mission passport; it is not a task, has no holder and no state, and is read only while a delivery link lives, so it cannot drive a front door or an email. The Your Move screen can show five states the code already holds (a draft, a quote to answer, a company link that needs evidence, an open evidence request, a new reply). It cannot show "Confirm your visit dates", which only the Corridra team knows.

## Decision

An optional additive module, `customer_move_migrations`, with append-only records.

- **A Move** belongs to one request of one person. Its parts: a verb from a fixed list (Read, Answer, Add, Confirm, Choose, Send), an object in at most 80 plain characters, a holder (customer, Corridra team, or supplier or buyer), an optional real date, and a state (open, done, cleared). The text is plain: no link, no markup, no number that looks like money.
- **Writes.** The Corridra team only, through a command function that needs the `missions.manage` permission and a fresh authenticator check. Commands are idempotent by (actor, command id); a different request under the same id conflicts. A new set for the same request clears the open one in the same transaction. At most five open Moves per request.
- **Reads.** The customer reads through a security-definer function that returns only the Moves of requests the caller submitted. A customer cannot write, edit or clear a Move. Another customer, another tenant and a signed-out call get nothing.
- **History is exact.** Set, cleared and done are separate rows. Nothing is updated or deleted. The staff panel shows the whole history.
- **Your Move** reads Moves beside its five existing sources, and a Move held by the Corridra team or by a supplier or buyer is shown folded, with no action.
- **Email.** Setting a Move held by the customer can queue message 4 ([ADR-067](0067-notification-records-and-pulse.md)), only when Pulse is on and the person has not muted the request.
- **Control and switch.** A control table starts closed; the application switch is separate; both must be on for the screens to show Moves. Closed means staff can still not set a Move.
- **Events.** Audit and domain events carry ids and the verb only, never the object text.

## Abuse cases

Staff pasting a link or personal data into the object (refused by the shape rule); a Move set on a request of another tenant (the function joins the request to the actor's tenant); replay or double submit (command id); enumeration of request ids (answers are identical for unknown and not yours); a Move used as a covert message channel to a customer (length cap, fixed verbs, history visible to the whole team); date in the past or absurdly far (bounded to one year ahead).

## Not included

A customer-written task list, reminders to the Corridra team, supplier-side Moves in the Reply Page (they read the request, not a Move), and any use of the Move in pricing or delivery.

## Rollback

Close the control (install job action `pause`) or unset the switch. Records stay. The mission `next_action` is untouched.

## Required acceptance

Database tests: install is repeatable and refuses a changed history; the control starts closed; the runtime and auth roles cannot read or write the tables; the staff command needs the permission and a fresh authenticator check; a second set clears the first; the cap of five; idempotence and conflict; another customer, another tenant and a signed-out call are refused identically; events hold no object text. Unit tests: the shape rule refuses links, markup and money-like numbers; verbs are the fixed list.
