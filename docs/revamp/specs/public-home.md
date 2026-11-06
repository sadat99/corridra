# Public home and fast intake

Document status: CURRENT.

Track S3, Wave 3. The public home is owner-settled (concept A "Ledger", 22 Oct 2026, [design-system index](../../design-system/README.md) section 9): headline "Make market entry deliberate.", the three jobs on the first screen, and a Selling/Sourcing example mission beside them. This wave keeps that composition. It fixes what tests prove is wrong and makes the first intake step shorter. It is not a redesign. Superseded for the home page by the owner's decision of 6 November 2026 below (concept G); everything else in this spec still applies.

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

## Owner decision, 6 November 2026: home page concept G

The owner asked for a landing revamp of 2 to 2.5 desktop screens (verbatim: "landing could be 2-2.5x screen size ij desktop"), reviewed six concepts (A to F) and chose, verbatim: "E with F". Concept G is the result. Mockup and screenshots: [evidence/landing-g](../../agents/evidence/landing-g/) (`concepts.html?v=g`, 1440 and 390).

- **Hero (E).** Eyebrow, h1 "Make market entry deliberate." (unchanged), lead "Watch one request become a decision. Then start yours.", the three job rows with the same `/plan?job=buyers|sourcing|delegations` links and accessible names, "Something else? Tell us your business goal" to `/plan`, the two calm lines. Beside them the Mission Player.
- **Mission Player.** An `ol` named "How a mission works" with the six steps and their existing copy (descriptions stay in the accessibility tree). Each step is a screen of sample data: Define (the request), Find (the existing four-row shortlist), Compare (the existing quote table), Visit, Decide, Follow through. A Selling and Sourcing example switch (tablist, Arrow, Home and End). It advances every 4 seconds with a visible Pause (WCAG 2.2.2), stops on hover and focus, never advances under reduced motion, and has Previous and Next buttons. Every sample says Example and Not real companies or suppliers.
- **Evidence (F).** Hook line "Know who is real before you fly." above "Every fact says where it comes from.", the four labels as a numbered list, How We Label Facts to `/trust`, and an example dossier card that shows all four labels on its fields.
- **Routes (F).** Boarding-pass cards: Bangladesh to China, Bangladesh to Spain and Explore Every Route, same three links.
- **Closing band.** "Your request can look like this." with Start a Request. Header, footer and dock unchanged.
- **Budget.** 1440 × 900: 2.0 to 2.5 screens (owner). 390 × 844: at most 3.5 screens (S1 cap, owner asked to confirm). The mockup measures 2.33 and 3.50. No sideways scroll, 44 px targets, axe clean at 320, 390, 768 and 1440.
- **Tests.** P-01 to P-07 stay unchanged. The AC1-03 pins (example tabs, four buyer rows, five quote rows, three route links, the `#mission-example` redirect) move to the player; the PR lists each changed assertion as owner-approved. New tests cover the player keyboard, Pause, reduced motion, the example switch and every job link.
- **Owner.** S3, after the PR 322 fixes. Not sensitive unless it touches the `/plan` submit path, consent, cookies or storage.
