# Lane 13: the founder and helper front doors

**Document status: DONE.** Built and merged behind its switch, off by default; nothing installed or enabled by merging. See the [plan status register](../PLAN_STATUS.md).

Status: built and dark, 25 October 2026, scoped under the owner's delegation (decision 8 of the corrected plan: small, switch-gated pages that link to what exists). Switch `CORRIDRA_UX_FRONT_DOORS`, off by default. With it unset the founder page and the helper page are exactly what they were. (The door's stylesheet is part of those pages' stylesheet list either way, because Next collects stylesheets from imports; none of its rules match anything on the page with the switch off.)

## What a front door is

A short list of cards. Each card is one link to a page that already exists, with a plain title and one plain line. A front door stores nothing, reads nothing and counts nothing, so it cannot state a number it does not have. One card may be the primary way in.

## The founder door

On `/operator/owner`, above the existing page, five cards using the words of the locked founder navigation in UI direction.

| Card                | Goes to                          | One line                                                   |
| ------------------- | -------------------------------- | ---------------------------------------------------------- |
| Business            | `/operator#workspace-commercial` | Commercial progress and the missions behind it.            |
| Operations          | `/operator#workspace-operations` | Corridor operations, the mission dashboard and recovery.   |
| Routes and settings | `/operator#workspace-settings`   | Corridors and policies.                                    |
| People and access   | `/operator#workspace-audit`      | Who has access, and the audit trail.                       |
| Ready to start?     | `/operator#ops-gates` (primary)  | Production readiness: what is still open before real work. |

Each card carries the workspace the page is showing: on the Owner page for a second workspace the links read `/operator?workspace=<id>#workspace-commercial`, so a card opens the workspace the person chose and not their first one (found in review; the fragment and the section are unchanged). A test covers the rewrite and that anything that is not a workspace id leaves the links as they were.

A test checks that every card points at a real workspace section that both an owner and an admin can open, and that the address is one the sign-in return list already accepts, so a card survives a sign-in. The page's own "what is on and off" content is unchanged below the door.

## The helper door

On `/contributor` when the address carries no workspace (the page that today tells a person to open the link from their invitation), the three text links become three cards: Accept a reviewed invitation (primary, `/contributor/setup`), How assigned work works (`/network`) and Choose your sign-in route (`/signin`). The words of the explanation above them and the Back to Corridra link are unchanged.

The signed-in task page, the sign-in redirect and everything about contributor access are not touched. The contributor sign-in change still waits for its security review.

## Not built, and why

| Item                                            | Why                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A "next task" card on the signed-in helper page | It needs the task board's data and states, and the helper area's access model is under security review. A card must never claim a task the person cannot open.     |
| Counts on the founder cards                     | "Counts are always out of a total, and unknown is Not measured yet" (UI direction). The founder page already carries the real counts; a card would only duplicate. |
| Real addresses for the sections in the cards    | Lane 9 gives sections their own addresses; the cards use the `#` links that work with or without it.                                                               |

## Rollback

Unset the switch. Nothing is stored.

## Verification

- Unit suite `ux-front-doors.test.ts`: the five locked words in order, every card resolves to a real section or page, one primary card each, no digits or promises in any line, tokens only in the stylesheet, the switch is real and read through the shared list, the founder page puts the door above everything only with the switch on, the helper page keeps its three links word for word with the switch off.
- Operator spec `ux-front-doors.spec.ts` (5 tests): each card is one link to the page it names, the primary card is marked, every card is 44 px or taller, no sideways scroll and no accessibility violation at 320, 390, 768 and 1440 px. Screenshots in `docs/design-system/evidence/lane13-front-doors/`.
