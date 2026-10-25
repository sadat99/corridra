# Lane 6: the first question and the single Sample label

Status: built and dark, 24 October 2026; listed as an owner switch from 25 October. Switch `CORRIDRA_UX_FIRSTQ`, off by default. With it unset the plan page and the header are exactly what they were.

## What changes when the switch is on

| Where               | Change                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/plan`, first step | The six objective radios are replaced by five pictures: Buy products, Buy a machine, Sell abroad, Lead a group trip, Something else. A picture only chooses a start.     |
| Header              | One visible label, Sample or Real, beside the name. The start button no longer carries "(sample request)" as screen-reader text, so a screen reader hears the mode once. |

## What stays exactly the same

- All fifteen job types stay selectable in the Commercial job list under the pictures, and a job chosen there moves the picture to the one that opens it.
- A link that names a job (`/plan?job=sourcing` from the home cards and public pages) opens with the right picture chosen.
- Draft saving in the tab, the 24 hour handoff, retained submission, the receipt flow and the code link are not touched. The only edit to the intake file outside the first step is moving `objectiveForJob` into the shared table, with a test that compares it to the previous behaviour for every job.
- Every existing validation. A picture sets the job and objective through the same `change()` rule the radios and the list always used.

## The mapping table

One file, `apps/web/lib/first-question.ts`. Each job type sits under exactly one picture.

| Picture           | Jobs it opens                                                                                    | Starts on             | Guided-draft family    |
| ----------------- | ------------------------------------------------------------------------------------------------ | --------------------- | ---------------------- |
| Buy products      | sourcing, supplier_evaluation                                                                    | sourcing              | Suppliers and products |
| Buy a machine     | machinery_procurement                                                                            | machinery_procurement | Suppliers and products |
| Sell abroad       | buyers, customers, distributors, partners, market_validation, market_entry, export_market_access | buyers                | Buyers and partners    |
| Lead a group trip | delegations                                                                                      | delegations           | Delegation             |
| Something else    | meetings, factory_visits, trade_fairs, business_trips                                            | the person chooses    | Other                  |

`tests/integration/ux-first-question.test.ts` checks the table against the job catalogue the code holds (nothing missing, nothing twice), against the objectives each guided-draft starter accepts, against the three home cards and against every public page that opens the plan, so the places cannot disagree.

## Flow-step budget

No step is added. The first step still has one choice and one optional refinement; the pictures replace the radios and the Continue button is unchanged.

## The Sample or Real label

The label comes from the server layout (the switch and whether real use is on), is drawn once by the header and uses the same component as the rest of the product. The accessible name of the start button is now exactly "Start a request". With the switch off the old text and its screen-reader suffix are unchanged (a test pins the exact markup).

## Words

13 messages (`fq.*` and `header.mode*`) in English and as drafts in Bangla, Chinese, Spanish and Arabic.

## Checks

- Unit: the table, the parity with the previous rule, the pictures as real radio buttons with a drawn check mark, the header with the switch off and on.
- Operator spec `ux-first-question.spec.ts` mounts the real intake and header: six radios with the switch off; five pictures with it on, each choosing the right job, the job list complete, the keyboard, the home-card links; one label; and at 320, 390, 768 and 1440 px no sideways scroll, 44 px targets and no accessibility violation. Screenshots: `docs/design-system/evidence/lane6-first-question/`.

## Flip and rollback

`CORRIDRA_UX_FIRSTQ=true` after a look at the plan page in a preview. Remove it to roll back; nothing is migrated or stored. The home page is untouched; see [the home tiles proposal](../design-system/home-tiles-proposal.md).
