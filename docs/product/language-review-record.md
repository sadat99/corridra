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

## Draft additions, 29 October 2026

| Surface                                | File                                                                                      | Languages              | Review state                                                           | Release boundary                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First question trips, visits and fairs | `apps/web/lib/i18n/messages.ts`, `fq.visits.label` and `fq.visits.hint`                   | bn, zh, es, ar, fr, de | Reviewed by Nazmus Sadat (owner), 30 October 2026; approved as drafted | Existing first-question language release through the reviewed-language setting `CORRIDRA_LANGUAGES_REVIEWED`, including its filter; no new setting. New drafts written at the owner's request on 29 October. |
| Request form words (`/plan` only)      | `apps/web/lib/i18n/form-words/{bn,zh,es,ar,fr,de}.ts`, with the English source in `en.ts` | bn, zh, es, ar, fr, de | Drafted 30 October 2026; review NOT yet recorded                       | Only by `CORRIDRA_LANGUAGES_FORM` plus a new deploy, and only for a language that is also in `CORRIDRA_LANGUAGES_REVIEWED`. Unset (off) by default, so the form stays English.                               |

Recorded on the owner's instruction on 30 October 2026: the owner, Nazmus Sadat, is the reviewer of the twelve drafts above (label and hint in each of the six languages) as they stand in `apps/web/lib/i18n/messages.ts` at `84678ff` (PR 214). He saw each string with its literal English meaning, including that the Bangla and Chinese labels add "business", and approved them as drafted in chat ("approve words"). They are released through the existing reviewed-language setting; no setting changes. The record keeps the name and the date; it does not claim more than that. If a native reader later changes a word, the row is updated with their name and the date.

The 25 October review covers the 138 keys present that day, including the retired `fq.somethingElse` words. It does not review the replacement `fq.visits` words introduced on 28 October. Earlier review rows remain dated records. The owner clarified on 29 October that the first question keeps its existing language behaviour when the new request-form switch is off.

The request form files hold the form's words and the messages it can show: 233 keys per language, the same keys as English. 81 of them are `form.message.*` keys, and 47 of those cover the domain, schema, amount, server and no-connection messages. Not in the files: the consent, privacy and storage sentences, the notice names, codes, amounts and anything a person typed. The sentences and notice names stay English and are marked English when the rest of the form is translated; codes, amounts and typed text are shown as written. The first question keeps its own release (the row above), and the signed-in request form stays English. Note for the reviewer: the German heading "Anfrage zu einer Mission prüfen." (English "Check a mission request.") was shortened so it fits at 200 percent text.
