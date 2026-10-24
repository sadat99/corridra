# Home tiles: the three cards today and a four-tile alternative

Status: proposal for the owner's decision, 24 October 2026. Nothing on the home page changed. Written in Lane 6 of the UX update, which only changes `/plan`.

## What the home shows today (chosen 22 October)

Three start cards on `apps/web/app/page.tsx`, each a link into the plan page with a job already chosen:

| Card                     | Opens                   | Picture it matches on `/plan`                  |
| ------------------------ | ----------------------- | ---------------------------------------------- |
| Sell my products         | `/plan?job=buyers`      | Sell abroad                                    |
| Buy products or machines | `/plan?job=sourcing`    | Buy products (a machine is a separate picture) |
| Lead a group trip        | `/plan?job=delegations` | Lead a group trip                              |

## The alternative: four tiles that mirror the first question

Sell abroad, Buy products, Buy a machine, Lead a group trip. "Something else" stays a quiet link, because it is the way out, not a way in.

| Question                                                | Three cards (today)                                                     | Four tiles                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Does the home say the same words as the first question? | Almost: "Buy products or machines" is one card, two pictures on `/plan` | Yes, word for word                                                                                    |
| Does a machine buyer land on the right job?             | They land on products and must pick the machine job                     | They land on `machinery_procurement`, which asks the machine questions first                          |
| Height of the choice on a phone                         | Three cards                                                             | Four tiles, about one more screen of scroll at 390 px unless tiles are two across                     |
| Risk                                                    | None new                                                                | A fourth choice slows the very first decision for people who are not buying a machine                 |
| Cost                                                    | None                                                                    | One page and one link table change; the job mapping already exists (`apps/web/lib/first-question.ts`) |

## What is already safe either way

The mapping table (`apps/web/lib/first-question.ts`) is the one place that says which picture opens which job. A test checks the home cards, the public pages, the guided-draft starters and the plan page against it, so changing the home later cannot make them disagree.

## Recommendation

Keep the three cards until the first question has been tried with real people (the Gate 2 sessions). If machine buyers are slower than product buyers there, switch to four tiles in a separate pull request; the table needs no change. The owner decides.
