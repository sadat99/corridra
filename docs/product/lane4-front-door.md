# Lane 4: Your Move, the navigation names and All tools

**Document status: DONE.** Built and merged behind its switch, off by default; nothing installed or enabled by merging. See the [plan status register](../PLAN_STATUS.md).

Status: built and dark, 24 October 2026. Switches `CORRIDRA_UX_NAV` and `CORRIDRA_UX_MOVE`, both off by default. With both unset every customer page, address and label is exactly what it was.

## What exists when the switches are on

| Switch             | What changes                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CORRIDRA_UX_NAV`  | The customer tabs read Your Move (or Home until Your Move is on), Missions, Companies (only where that module is on), Library, More. `/account/all-tools` exists and More links to it. |
| `CORRIDRA_UX_MOVE` | `/account/move` exists. With the navigation switch also on, the bare `/account` address goes there.                                                                                    |

With the navigation switch off `/account/all-tools` answers "not found", and with the Move switch off `/account/move` does. Neither address exists on main.

## Parity: where every original place went

| Before                                                    | After (switches on)                                                                | How it is kept                                                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Home (`/account`, view `home`)                            | Your Move, `/account/move`. The Home view is still served at `/account?view=home`. | Only the bare address redirects. The tab reads the older Home as Your Move.                                                          |
| My Work (`?view=work`)                                    | Missions                                                                           | Same address, same page.                                                                                                             |
| Companies                                                 | Companies                                                                          | Unchanged.                                                                                                                           |
| Results (`?view=results`)                                 | Library                                                                            | Same address, same page. The word Results stays as the heading inside.                                                               |
| More (`?view=more`)                                       | More                                                                               | Same address. It gains a link to All tools.                                                                                          |
| Old hashes (`#my-work`, `#results`, `#more` and the rest) | Still mapped to the right `?view=`                                                 | `AccountHashRedirect` is mounted on Your Move too, so a link that was `/account#my-work` still lands on Missions after the redirect. |

Every page a person can reach is in All tools or has a written reason for not being there (`apps/web/lib/all-tools.ts`, checked by `tests/integration/ux-all-tools.test.ts`).

## What Your Move reads

Only records the customer screens already read. It adds no table, no function and no permission.

| Card                               | Source                                                                         | Holder        | Action shown to                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------- |
| Send your draft request            | Open drafts in each workspace the person belongs to                            | You           | The author                                                                                         |
| Answer the quote                   | A service request in status `quoted`                                           | You           | A workspace owner or admin. A member sees it under "Waiting on others", held by the owner or admin |
| Add evidence for your company link | A company link in status `needs_evidence`                                      | You           | A workspace owner or admin. Others see it under "Waiting on others"                                |
| Read the new reply                 | A team reply newer than the last one marked read on this device                | You           | Anyone who can read the request                                                                    |
| Waiting on the Corridra team       | A request in qualification, active, targeting, outreach, meetings or follow-up | Corridra team | Nobody: it is information, with a link to open                                                     |

- **No date is invented.** A card carries a date only when a real date exists. None of the five sources has a due date today, so no card shows one. There are no streaks, badges or counts.
- **The read mark stays on the device.** It is kept in the browser (`corridra.move.seen`), the same idea as the language choice. The server never learns what was read. "Forget which replies I have read on this device" clears it.
- **Bounded reads.** Each read asks the sign-in provider for the session, so drafts and quotes are read for at most the first eight workspaces. When a person has more, the page says so and points to Missions.
- **A source that fails or is switched off is left out**, never guessed. A closed module is not read at all.
- **Not included, with the reason.** "Answer an evidence request on a delivered report" is not a card yet. The request lives inside each saved report, and reading a report may be recorded as the person opening it. It needs a small, read-only list of open requests first (a later, additive database function), so it waits for the Move records module (Lane 7).
- **Quiet days.** When nothing waits the page says so, shows where the most recent request stands (the Road) and makes Start a request the main action. Otherwise Start a request stays as a quiet link.

## Words and languages

Every word on the screen comes from the message module (22 `move.*` keys in English and as drafts in Bangla, Chinese, Spanish and Arabic). The region says which language it is written in, so the page around it, still English, is never mislabelled. The screen heading and navigation are English until those parts move onto message files.

## Checks

- `tests/integration/ux-front-door.test.ts` and `ux-all-tools.test.ts`: the card rules, the role rules, the navigation with the switch off equal to today, the redirect rule, the parity of every page.
- `tests/operator/ux-move.spec.ts`: the real component mounted with the real stylesheets: cards, holders, the empty state, five-then-more, the device-only read mark including blocked storage, Bangla and Arabic (lang, direction, 320 px), and at 320, 390, 768 and 1440 px no sideways scroll, 44 px targets and no accessibility violation.
- Screenshots: `docs/design-system/evidence/lane4-your-move/`.

## Flip and rollback

Flip on in the deployment settings (`CORRIDRA_UX_NAV=true`, `CORRIDRA_UX_MOVE=true`) after a look at a signed-in preview. Roll back by removing either setting: the addresses return to exactly what they were. Nothing was migrated and nothing is stored on the server.
