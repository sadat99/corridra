# Public home and fast intake

Document status: CURRENT.

Track S3, Wave 3. The public home is owner-settled (concept A "Ledger", 22 Oct 2026, [design-system index](../../design-system/README.md) section 9): headline "Make market entry deliberate.", the three jobs on the first screen, and a Selling/Sourcing example mission beside them. This wave keeps that composition. It fixes what tests prove is wrong and makes the first intake step shorter. It is not a redesign.

## First: pin what exists (tests before any change)

| Id   | Case                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-01 | Every one of the 15 `missionCatalogue` job keys can be chosen and survives to the sent request's `experience.job`.                                                                                                                                                                                                                                                            |
| P-02 | Every field the request schema accepts (`briefSchema` and `realBriefSchema`) can be filled and is sent unchanged; required-field errors appear inline next to the field.                                                                                                                                                                                                      |
| P-03 | The consent and notice acknowledgement is required, its version string is sent, and real versus sample notice follows the data mode.                                                                                                                                                                                                                                          |
| P-04 | Both draft paths keep work, as they do today: the device draft saves every change and resumes after reload; the account draft saves as you go (about 2 seconds after the last edit, PR 281) and on "Save draft", resumes after reload and warns before leaving with unsaved changes. Nothing is sent before the send button, and the acknowledgement is never saved as given. |
| P-05 | Deep links `/plan?job=<key>` select that job for each of the 15 keys; an unknown key falls back to the first question with nothing selected.                                                                                                                                                                                                                                  |
| P-06 | Old addresses still work: `/sell`, `/source`, `/machinery`, `/trade-missions`, `/business-trips`, `/enter-market`, `/fairs`, `/fairs/<slug>`, `/corridors`, `/corridors/<corridor>`, `/plan#receipt-check`.                                                                                                                                                                   |
| P-07 | The home page's three job links go to `/plan?job=buyers`, `/plan?job=sourcing` and `/plan?job=delegations`.                                                                                                                                                                                                                                                                   |

These go up as their own test-only PR first.

## Then: changes allowed in Wave 3

1. **Fast first step.** The first screen of `/plan` already asks only the job (when the link has not set it), which is the minimum useful first action. Keep it that way: no field moves between steps, so every element id, name and test hook stays where it is. (Decision 4 Nov 2026, after S3's audit: moving the target market onto step 1 would gain nothing and move a hook used by about 12 tests.)
2. **One primary action per section** on the home and each public page (UX gate rule). Secondary actions are quieter.
3. **Honest proof only.** No "Trusted by", "Results", counts, logos or testimonials. Sample material says "sample".
4. **English only.** Keep the language chip and the existing Bangla and Chinese code; add no new translated strings and claim no reviewed translation.
5. **Signed-in footer fix**, if a test shows the public footer offering sign-in to a signed-in person: change only the footer's own wording or link choice.

## Required checks for the Wave 3 PR

| Id   | Case                                                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-08 | P-01 to P-07 still pass unchanged.                                                                                                                                                                                                                              |
| P-09 | `pnpm test:ux` counts do not rise above `tests/ux/ux-baseline.json`; lower the baseline for any debt fixed.                                                                                                                                                     |
| P-10 | The form card of each step fits the flow-step budget: 1.5 phone screens at 390, 1 desktop screen at 1440. The whole page's length (3.7 phone screens at 390 on 4 Nov 2026: receipt panel, summary and footer) is recorded as existing debt and not made longer. |
| P-11 | The intake API payload for the same answers is byte-for-byte the same before and after the change (fixture comparison).                                                                                                                                         |

`/plan` is a public unauthenticated route: a change to its submit path, consent, cookies or storage is `Sensitive: yes`.
