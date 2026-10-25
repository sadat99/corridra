# Lane 10: the Programme Room

**Document status: DONE.** Built and merged behind its switch, off by default; nothing installed or enabled by merging. See the [plan status register](../PLAN_STATUS.md).

Status: built and dark, 25 October 2026. Switch `CORRIDRA_UX_PROGRAMME`, off by default. With it unset, the delegation page is exactly what it was: a list of programmes, each with its own buttons that open a panel.

## What changes when the switch is on

Each programme in `/account/delegations/[workspaceId]` becomes one room instead of a list item with buttons.

| Part          | What it does                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header        | The programme's emblem (from its own name), name and purpose, and the same "Planning record only" line and "Request help with this programme" link the list showed.                                                                                                                                                                   |
| Road          | The same list, shapes and words as the request Road, with six programme steps: Set up, Invite, Register, Plan the days, Run, Report. Each step is marked from a record or it says "not tracked yet".                                                                                                                                  |
| Boarding line | "1 of 2 invitations used", out of a total, from the invitations the participants panel already reads. "Not measured yet" when nothing could be read or a list was longer than a page, never a guessed number. "Refresh counts" reads again; if the private view expired or access changed, the panel's own notice is shown beside it. |
| Views         | Overview, People, Plan and report, Terms and places, Money. A view appears only where its panel is on. The panel is mounted when first opened and then kept (hidden when another view is chosen), so nothing typed in it is lost.                                                                                                     |
| The panels    | The same components with the same props: the programme context, participants, coordination and report, terms and places, and finances. None is edited.                                                                                                                                                                                |

## What the road reads

| Step                       | Marked from                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Set up                     | Done, because the programme exists.                                                                                                                                                                                                                                      |
| Invite                     | Done once any invitation exists; now (and Register later) when there are none.                                                                                                                                                                                           |
| Register                   | Now while nobody has registered or an invitation is still open; done when someone registered and none is open, and only when the whole list was read. A list longer than a page is a sample: an open invitation in it still shows now, otherwise Register is not marked. |
| Plan the days, Run, Report | Not tracked yet. Those panels hold their own records and the room does not summarise them.                                                                                                                                                                               |

At most one step is now. A step is never marked from an estimate. The legend reads: "Not tracked yet means this room does not read that step's records, or could not read them just now." (The request Road's legend is about a record not existing, which is not what this room knows.)

## Rules kept

- Presentation only: the five panels, their data, their permissions, their commands and their money are exactly as built. The four money domains are not mixed: the finances panel stays in the Money view alone, and fee schedules, pricing templates and series stay below the list where they were (a note in the Money view says so).
- The room reads counts and states only. It never shows a participant's own answers. It makes the same read the participants panel makes (the same endpoint, the same access rules, the same hiding when the page is hidden), and it adds that read: with the switch off nothing is read until someone opens "Manage participants", with it on each programme reads once when it is on screen. To keep that cheap, a programme is read only while it is on screen (and a little around it), again when the person changes view, and when they press "Refresh counts"; a long list of programmes does not read every programme at once. The panel keeps its own copy of the same read, so the numbers above it are refreshed by those three triggers, not live.
- The delegation components import no stylesheet, so the existing delegation specs run unedited and pass (174 tests across the ten delegation specs). The room's styles come from a small module the page imports and mounts with the switch on. Next collects stylesheets from imports, not from what renders, so with the switch off the page still loads those stylesheets; none of their rules match anything on the page, so nothing looks or behaves differently, but the page's stylesheet list is not byte for byte what it was.
- No migrations, no new colours (tokens only), no change to permissions, money or data meaning, no legal or privacy wording changed.

## Not built, and why

| Item                                            | Why                                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A private lane per participant company          | Registrations carry a consented label, not a company, so a company lane would be invented. The participants panel already shows each registration with the objectives that participant chose to share. |
| An Encounter-style agenda with inline conflicts | The agenda lives inside the coordination panel, which this lane must not change. It stays one view away in Plan and report. A conflict view needs its own change to that panel.                        |
| "14 of 20 ready"                                | There is no readiness record. The boarding line says what the records say: invitations used out of invitations issued.                                                                                 |
| Road steps for the days, the run and the report | They need data from panels the room does not read; marking them from a guess would break "nothing is inferred". They show "not tracked yet".                                                           |

## Rollback

Unset the switch. Nothing is stored or migrated.

## Verification

- Unit suite `ux-programme-room.test.ts`: the counts, the boarding line, every road state and that at most one step is now; each original panel is used in both branches with the same props; the old toggles are word for word; a view is mounted on first open and kept; the room reads no participant answers; the default is off; no delegation component imports a stylesheet.
- Operator spec `ux-programme-room.spec.ts` (12 tests): the real list and participants panel with the real stylesheets. Header, road and boarding line from what was read; "Not measured yet" for a long list and for denied access; a view keeps what was typed when the person moves on; the old toggles with the switch off; 320, 390, 768 and 1440 px with no sideways scroll, 44 px view buttons and a clean accessibility scan. Screenshots in `docs/design-system/evidence/lane10-programme-room/`.
- The ten existing delegation operator specs (174 tests, unedited) pass against the changed list component.
- Added after an independent review: Register is not marked done from a partial list; "Refresh counts"; a read only while a programme is on screen (eight programmes, only the visible ones read until scrolled to); the Money note only where the pricing panel is on the page; a legend that says what this room reads; no "choose a view" line when there is no other view.
