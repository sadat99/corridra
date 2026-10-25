# Lane 9: team workspace addresses and view as, stage 2

Status: built and dark, 25 October 2026. Switch `CORRIDRA_UX_OPERATOR_URLS`, off by default. With it unset, `/operator` is what it was, a section address answers "not found" and the preview shows only its three fixed cards.

## What changes when the switch is on

| Part              | What it does                                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section addresses | Each of the 18 workspace sections opens at its own address, for example `/operator/missions` or `/operator/readiness`. The page is the same workspace with that section selected. The 18 ids and every mounted panel are unchanged. |
| Old links         | `#workspace-...` links keep working everywhere. A `#` part always wins over the address, so a link inside a section address still switches section.                                                                                 |
| Signed out        | A section address sends a signed-out person to the same sign-in, and back to the same section afterwards. The list of places sign-in may return to is not widened.                                                                  |
| Tenant switch     | Switching workspace on a section address keeps the person on that section.                                                                                                                                                          |
| View as, stage 2  | The customer preview also shows the real Your Move screen and the Room's header and Road, drawn from fixed sample data inside the preview's inert stage. Nothing in them can be pressed, focused or sent.                           |

## The addresses

One table in `apps/web/lib/operator-urls.ts`; adding a section without an address fails the build.

| Section id                                                       | Address                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `workspace-missions`, `-research`, `-meetings`, `-commercial`    | `/operator/missions`, `research`, `meetings`, `commercial`           |
| `workspace-delivery`, `-sources`, `-evidence`, `-ai`, `-network` | `/operator/delivery`, `sources`, `evidence`, `assistance`, `network` |
| `workspace-operations`, `ops-dashboard`, `ops-center`            | `/operator/operations`, `dashboard`, `control-center`                |
| `ops-health`, `ops-gates`                                        | `/operator/health`, `readiness`                                      |
| `workspace-settings`, `-audit`, `-authenticator`, `-controls`    | `/operator/settings`, `audit`, `authenticator`, `controls`           |

The words `owner`, `setup`, `signin`, `forgot-password`, `reset-password` and `view-as` are real folders under `/operator`, so they are matched first and can never be shadowed. A test lists every folder under `/operator` and fails if a section word ever equals one. Anything else that is not in the table is the plain "not found" page, and so is every address with the switch off.

## What stays exactly the same

- `/operator` renders from the same code as before, moved into one shared file so the two addresses cannot drift. Every unavailable state keeps its words.
- The role check is the one the hash links already used: a section the person's role may not see shows the same notice and the section directory.
- No protected operator or view-as test was edited. The view-as test that keeps the preview folder free of client code still passes: the sample file is a plain server component and imports the real screens from where they live.

## Not built, and why

| Item                                      | Why                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A link from each Today row to its mission | The rows are text and carry no mission address today. The section address only selects a section, so a row link would not land on the mission. It needs a mission address of its own. |
| In-preview tab switching                  | The preview stays fully inert. Clicking through sample screens is a later choice, recorded as open point 7 of the view-as proposal.                                                   |
| A Room sample with the lenses             | The Room's own screen reads the request from a private interface, so the preview draws its header and Road only. The lenses stay in the real Room.                                    |

## Rollback

Unset the switch. Nothing is stored and nothing is migrated.

## Verification

- Unit suite `ux-operator-urls.test.ts`: the table covers all 18 sections with unique words, no word equals a real folder, junk and prototype names are refused, a `#` part wins, the sign-in return list is unchanged, every switch-off path.
- Operator spec `ux-view-as-samples.spec.ts` (6 tests): the real components with sample data, focus never enters the inert stage, no sideways scroll and no accessibility violation at 320, 390, 768 and 1440 px. Screenshots in `docs/design-system/evidence/lane9-operator-urls/`.
- Built app with the switch on: a section address redirects a signed-out visit to sign-in, an unknown word is "not found", and with the switch off every section address is "not found" (see the work log).
