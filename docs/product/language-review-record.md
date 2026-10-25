# Language review record

**Document status: CURRENT.** Kept up to date; a language is public only when a review is recorded here. See the [plan status register](../PLAN_STATUS.md).

One row per language. A language is offered to the public only when a native reviewer is recorded here and the owner has added its code to `CORRIDRA_LANGUAGES_REVIEWED`. Nothing in this file is a review until a name and a date are filled in. Written in Lane 2 of the UX update (24 October 2026).

| Language             | Code | Reviewer (name) | Date reviewed   | What was reviewed                                                | Offered to the public                    |
| -------------------- | ---- | --------------- | --------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| English              | `en` | Source language | Not applicable  | Not applicable                                                   | Always                                   |
| Bangla               | `bn` | Nazmus Sadat    | 25 October 2026 | All 138 message keys as built (see below)                        | Yes, from the release on 25 October 2026 |
| Chinese (Simplified) | `zh` | Nazmus Sadat    | 25 October 2026 | All 138 message keys as built, and the supplier Reply Page words | Yes, from the release on 25 October 2026 |
| Spanish              | `es` | Nazmus Sadat    | 25 October 2026 | All 138 message keys as built                                    | Yes, from the release on 25 October 2026 |
| Arabic               | `ar` | Nazmus Sadat    | 25 October 2026 | All 138 message keys as built                                    | Yes, from the release on 25 October 2026 |
| French               | `fr` | Nazmus Sadat    | 25 October 2026 | All 138 message keys as built                                    | Yes, from the release on 25 October 2026 |
| German               | `de` | Nazmus Sadat    | 25 October 2026 | All 138 message keys as built                                    | Yes, from the release on 25 October 2026 |

Recorded on the owner's instruction on 25 October 2026: the owner, Nazmus Sadat, is the reviewer for all six languages and signs off the drafts as they stand in `apps/web/lib/i18n/messages.ts` (138 keys per language, the same keys as English, every placeholder kept, none containing legal, privacy or consent text). The record keeps the name and the date; it does not claim more than that. If a native reader later changes a word, the row is updated with their name and the date.

## Decisions on the three open questions in ADR-066

Taken by the reviewer on 25 October 2026, each as the ADR recommended:

| #   | Question                                       | Decision                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Which Bengali face for buttons, labels, tables | Noto Sans Bengali (SIL OFL) for text, the serif for headings only. Shipped on 25 October 2026: `apps/web/app/fonts/noto-sans-bengali-variable.woff2` with its licence, a lazy face (fetched only when a page has Bengali characters, never preloaded). Buttons, labels, tables and text use it; headings keep the serif. |
| 2   | Bengali or Western digits                      | Original-currency amounts keep Western digits (suppliers quote them that way). Dates and counts stay as built (Bengali digits in Bangla text).                                                                                                                                                                           |
| 3   | Trust names                                    | The five trust names stay in English in every language until a reviewer proposes exact meanings; never a weaker word.                                                                                                                                                                                                    |

## What a reviewer reads

1. The 46 teaching-layer words and the header, footer and skip link words in `apps/web/lib/i18n/messages.ts` (keys `mr.*`, `header.*`, `footer.*`, `way.*`, `language.*`).
2. The screenshots in `docs/design-system/evidence/language-phase2/` (Bangla now; others added when their drafts are mounted).
3. The three open questions in [ADR-066](../adr/0066-language-phase-2.md): the type face, the numerals, and the trust names.

## Rules for a reviewer

Formal register for Spanish, French (vous) and German (Sie); modern corporate Chinese; Modern Standard Arabic in an enterprise register; Bangla in a modern corporate register with technology words in Bengali script. Words with legal or commercial weight are translated for exact meaning. The five trust names are never weakened. Company names, original text and quotations are never translated. Legal and privacy text is not part of this review: it needs a qualified reviewer per language.

## How a language is released

1. The reviewer reads the drafts and the screenshots and signs off in writing.
2. The owner records the reviewer's name and the date in the table above.
3. The owner adds the language code to `CORRIDRA_LANGUAGES_REVIEWED` in the deployment settings.

## Other surfaces that carry words needing the same review

| Surface                                 | File                              | Language | State                                            | Released how                                                                                                                                                                      |
| --------------------------------------- | --------------------------------- | -------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home page words (all six languages)     | `apps/web/lib/i18n/home-words.ts` | all six  | Drafted 25 October 2026; review NOT yet recorded | Stays English everywhere until the owner records a review here and sets `CORRIDRA_LANGUAGES_PAGES=true` (then a new deploy). The five trust names stay English in every language. |
| Supplier Reply Page, its own words only | `apps/web/lib/reply-words.ts`     | `zh`     | Reviewed by Nazmus Sadat, 25 October 2026        | Released with `zh` by the row above. A link naming Chinese now opens the Chinese page once `CORRIDRA_LANGUAGES_REVIEWED` lists `zh` and the Reply Page switch is on (Lane 8).     |

The reviewer should also read the supplier-facing wording in the page for exact meaning: "Self-declared", "Not stated", "No charge", the price and validity steps and the receipt. Requirement text, names and quotations are never translated.
