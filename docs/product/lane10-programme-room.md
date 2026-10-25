# Lane 10: the Programme Room

Status: built and dark, 25 October 2026. Switch `CORRIDRA_UX_PROGRAMME`, off by default. With it unset, the delegation page is exactly what it was: a list of programmes, each with its own buttons that open a panel.

## What changes when the switch is on

Each programme in `/account/delegations/[workspaceId]` becomes one room instead of a list item with buttons.

| Part          | What it does                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header        | The programme's emblem (from its own name), name and purpose, and the same "Planning record only" line and "Request help with this programme" link the list showed.                                                               |
| Road          | The same list, shapes and words as the request Road, with six programme steps: Set up, Invite, Register, Plan the days, Run, Report. Each step is marked from a record or it says "not tracked yet".                              |
| Boarding line | "1 of 2 invitations used", out of a total, from the invitations the participants panel already reads. "Not measured yet" when nothing could be read or a list was longer than a page, never a guessed number.                     |
| Views         | Overview, People, Plan and report, Terms and places, Money. A view appears only where its panel is on. The panel is mounted when first opened and then kept (hidden when another view is chosen), so nothing typed in it is lost. |
| The panels    | The same components with the same props: the programme context, participants, coordination and report, terms and places, and finances. None is edited.                                                                            |

## What the road reads

| Step                       | Marked from                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Set up                     | Done, because the programme exists.                                                                            |
| Invite                     | Done once any invitation exists; now (and Register later) when there are none.                                 |
| Register                   | Now while nobody has registered or an invitation is still open; done when someone registered and none is open. |
| Plan the days, Run, Report | Not tracked yet. Those panels hold their own records and the room does not summarise them.                     |

At most one step is now. A step is never marked from an estimate. The legend always says what "not tracked yet" means.

## Rules kept

- Presentation only: the five panels, their data, their permissions, their commands and their money are exactly as built. The four money domains are not mixed: the finances panel stays in the Money view alone, and fee schedules, pricing templates and series stay below the list where they were (a note in the Money view says so).
- The room reads counts and states only. It never shows a participant's own answers, and it adds no request of its own beyond the read the participants panel already makes, with the same access rules and the same hiding when the page is hidden.
- The delegation components import no stylesheet, so the existing delegation specs (125 tests) run unedited and pass. The room's styles come from a small module the page mounts only with the switch on.
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
- Operator spec `ux-programme-room.spec.ts` (9 tests): the real list and participants panel with the real stylesheets. Header, road and boarding line from what was read; "Not measured yet" for a long list and for denied access; a view keeps what was typed when the person moves on; the old toggles with the switch off; 320, 390, 768 and 1440 px with no sideways scroll, 44 px view buttons and a clean accessibility scan. Screenshots in `docs/design-system/evidence/lane10-programme-room/`.
- The seven existing delegation operator specs (125 tests, unedited) pass against the changed list component.
