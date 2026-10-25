# Language review record

**Document status: CURRENT.** Kept up to date; a language is public only when a review is recorded here. See the [plan status register](../PLAN_STATUS.md).

One row per language. A language is offered to the public only when a native reviewer is recorded here and the owner has added its code to `CORRIDRA_LANGUAGES_REVIEWED`. Nothing in this file is a review until a name and a date are filled in. Written in Lane 2 of the UX update (24 October 2026).

| Language             | Code | Reviewer (name) | Date reviewed  | What was reviewed | Offered to the public |
| -------------------- | ---- | --------------- | -------------- | ----------------- | --------------------- |
| English              | `en` | Source language | Not applicable | Not applicable    | Always                |
| Bangla               | `bn` | Not recorded    | Not recorded   | Draft only        | No                    |
| Chinese (Simplified) | `zh` | Not recorded    | Not recorded   | Draft only        | No                    |
| Spanish              | `es` | Not recorded    | Not recorded   | Draft only        | No                    |
| Arabic               | `ar` | Not recorded    | Not recorded   | Draft only        | No                    |
| French               | `fr` | Not recorded    | Not recorded   | Draft only        | No                    |
| German               | `de` | Not recorded    | Not recorded   | Draft only        | No                    |

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

| Surface                                 | File                          | Language | State              | Released how                                                                                                   |
| --------------------------------------- | ----------------------------- | -------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Supplier Reply Page, its own words only | `apps/web/lib/reply-words.ts` | `zh`     | Draft, no reviewer | A link naming Chinese opens in English until `zh` is released for the whole product by the row above (Lane 8). |

The reviewer should also read the supplier-facing wording in the page for exact meaning: "Self-declared", "Not stated", "No charge", the price and validity steps and the receipt. Requirement text, names and quotations are never translated.
