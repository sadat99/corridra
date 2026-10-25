# Lane 7a: Move records

Status: built and dark, 24 October 2026. Switch `CORRIDRA_UX_MOVE_RECORDS` (off by default) and a database control that starts closed. Decision record: [ADR-068](../adr/0068-move-records.md). With the switch unset and the control closed, every page, address and database behaviour is what it was.

## What exists

| Part               | What it does                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database module    | `customer_move_migrations/0001_move_records.sql`: a closed-by-default control table, append-only Move rows (set, done, cleared are separate rows), guard triggers, a staff command function and a customer read function. Additive only. |
| Staff command      | `MissionMoveService.command` in `packages/missions`. Needs `missions.manage` and a fresh authenticator check (five minutes). Idempotent by command id and request hash; the same id with a different request is a conflict (409).        |
| Staff panel        | `app/operator/mission-moves.tsx`, shown inside a mission only when the switch is on. Sets up to five Moves, clears the open set, shows the whole history. Plain words only: no link, no markup, nothing that looks like money.           |
| Customer read      | `GET /api/move/mine`, a security-definer function that returns only Moves of requests the caller submitted. Unknown, not yours and signed out answer identically.                                                                        |
| Your Move          | A Move held by the customer is a card (verb, object, real date if the team set one, one tap to the request). A Move held by the Corridra team or a supplier or buyer is folded under "Waiting on others", with no action.                |
| Install job wiring | `move_records_action` and `move_records_reason` inputs on the owner-run install job; `unchanged` by default.                                                                                                                             |

## Rules kept

- The customer cannot write, edit or clear a Move. The runtime and auth roles cannot read or write the tables directly.
- No date is invented. A Move with no date shows no date.
- The object is the team's own words. It is shown as written and marked as English in any language; it is never translated.
- Audit and domain events hold ids and the verb only, never the object text.
- Closing the control stops new Moves. Records stay. The mission `next_action` is untouched.
- The email for a Move is Lane 7b ([lane7b-pulse.md](lane7b-pulse.md)); it needs Pulse, which stays off until the owner's privacy review and an address source.

## Verification

- Database suite `move-records-database.test.ts` (27 tests): install is repeatable and refuses a changed history; control starts closed; roles cannot touch the tables; permission and fresh authenticator check; a second set clears the first; cap of five; idempotence and conflict; another customer, another tenant and signed out refused identically; events carry no object text; amount-shaped text refused in the database as in the code.
- Unit suite `ux-move-records.test.ts` (30 tests): the shape rules, card building from records, folding, switch-off parity.
- Operator specs `ux-mission-moves.spec.ts` (staff panel, 9 cases) and `ux-move.spec.ts` (Move cards and folded rows) mount the real components with the real stylesheets: 320 to 1440 px, no sideways scroll, 44 px targets, clean accessibility scan.

## Owner steps (nothing is applied by merging; the full order is in [phase2-install.md](phase2-install.md))

1. Run the install job (`install-customer-modules`, protected environment) with `move_records_action = install` and `apply = yes`. This adds the tables and functions; nobody sees any change.
2. Run it again with `move_records_action = enable` and a reason of at least ten characters to open the database side.
3. Set `CORRIDRA_UX_MOVE_RECORDS=true` (with `CORRIDRA_UX_MOVE=true` for Your Move) after a signed-in preview.
4. Roll back by running the job with `move_records_action = pause` (records stay) or by unsetting the switch.

## Not included

A customer-written task list, reminders to the Corridra team, and the email for a new Move (Lane 7b, behind Pulse).
