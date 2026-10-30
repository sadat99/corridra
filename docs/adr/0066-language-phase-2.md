# ADR-066: Language, phase 2 (what the language foundation does, and what is added)

Status: accepted by owner delegation, 24 October 2026 (see the execution record in [the UX plan](../product/ux-update-plan-corrected-2026-10-24.md)). Written to match what PR171 and PR174 built, plus the small additions below. Default off: with `CORRIDRA_LANGUAGES_REVIEWED` and `CORRIDRA_LANGUAGES_PREVIEW` unset only English is offered, the chip does not render and no visitor sees a change.

## Context

PR171 and PR174 added the language chip, the message module and the provider ([proposal](../product/language-switcher-proposal.md)). No ADR recorded the decisions behind them. The UX update adds new screens (Your Move, the Room, the Road, quote cards, a first question) that must be written for translation from the start, and Bangla in particular needs more than translated words: how it is set in type.

## What the foundation does (recorded as built)

| Topic                       | Decision                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the choice lives      | In this browser (`localStorage`, key `corridra.language`). Where storage is blocked it is kept for the visit. Another tab's change clears the in-memory choice so tabs agree.                                 |
| What the server knows       | Nothing. No cookie, no header, no account field. Pages are built in English and stay static on the CDN.                                                                                                       |
| First visit                 | The browser's own language, if that language is offered. Otherwise English.                                                                                                                                   |
| Release                     | A language is offered to the public only when it is named in `CORRIDRA_LANGUAGES_REVIEWED`, which the owner sets after a native reviewer is recorded ([review record](../product/language-review-record.md)). |
| Drafts                      | `CORRIDRA_LANGUAGES_PREVIEW=true` shows every unreviewed language, labelled "draft", for the owner to read. Never set for the public.                                                                         |
| Page language and direction | Set on `<html>` after load. A main region still in English says `lang="en" dir="ltr"` itself, so only translated chrome follows the choice.                                                                   |
| Right to left               | Arabic mirrors by logical properties (`inline-start`, `inset-inline-end`). Only directional icons flip.                                                                                                       |
| Numerals                    | `displayDate` and `displayMoney` take the language tag. Amounts keep every digit and the original currency in every language. Whether Bangla or Arabic shows its own numerals is a reviewer decision (below). |
| Fallback                    | A missing or empty entry shows English. An entry is never blank.                                                                                                                                              |
| Not done on purpose         | No language in the address, no server-side language, no translation of company names, quotations or original text.                                                                                            |

## What this phase adds

1. **Words for the teaching layer.** 46 message keys (`mr.*`) in English and as drafts in Bangla, Chinese, Spanish and Arabic: the Road steps and states, the holders, the Move verbs and the sentence pattern, the quote card, the example and sample labels. The components take them through `mrLabelsFor(locale)` (and `useMrLabels()` in a client component); with no labels passed they render exactly the English they rendered before. Words for Your Move, the Room and the first question are added with those screens, so no key exists without a user.
2. **A sentence pattern, not a sentence.** `{verb} {object}` for English, Spanish, Chinese and Arabic; `{object} {verb}` for Bangla, because the verb comes last. A translator may reorder but must keep both placeholders (a test checks it).
3. **A test tying the language list to the formatters.** Every language in the chip is accepted by `displayDate` and `displayMoney`, and the digits of an amount read back identical in each language's numerals. A language cannot be added to the chip that the formatters reject.
4. **A pure move of the chip styles.** The language chip rules moved out of `apps/web/app/globals.css` into `apps/web/components/language-switcher.css`, imported by the chip. Not one rule changed (the compiled rules were compared, 11 of 11 identical, and the new sheet loads after the global one as before). This is the only edit to the global file in the whole UX update.
5. **No letter-spacing for scripts that join letters.** `apps/web/components/language-scripts.css`: when the page language is Bangla or Arabic, text in that language is not letter-spaced. The product sets many small labels in spaced capitals, right for Latin and wrong here (it breaks Bengali conjuncts and Arabic joins). The rule matches nothing while English is chosen, and never a main region still written in English.
6. **Evidence.** Bangla in a Road, a Move card, a quote card and a table at 390 and 1440 pixels: `docs/design-system/evidence/language-phase2/`.

## Localization standard for every string

Scannable at a glance. Buttons one to three words. Bangla in a modern corporate register with technology words written in Bengali script as people say them; B2B and RFQ stay as professionals say them. Words with legal or commercial weight are translated for exact meaning. The five trust names (Self-declared, Documented, Corridra-checked, Official source, Signed) are never weakened and are not translated in this phase (they appear in English beside translated labels in the screenshots; a reviewer decides). Figures of speech (Move, Road, Follow through) are translated by meaning, not word for word. No dashes used as punctuation in any language.

## Open questions for the owner (the Bangla type question)

| #   | Question                                                                                                                                                                                    | What the screenshots show                                                                                            | Recommendation                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Which Bengali face for buttons, labels and tables? The product's lazy Bengali face is a serif (Noto Serif Bengali) and is the only Bengali face shipped. Body and labels in Latin are sans. | Mixed Latin sans and Bengali serif in one line looks uneven in tables.                                               | Add Noto Sans Bengali (SIL OFL) as a lazy, unicode-range face for text; keep the serif for headings only. **Decided and shipped on 25 October 2026** (the font file is in `apps/web/app/fonts/`; this is a second edit to `globals.css`, two font-family lists). |
| 2   | Bengali or Western digits for money and dates in Bangla?                                                                                                                                    | Bangla fixture shows Bengali digits in text; amounts in the original currency show Western digits (`USD 18,400.00`). | Keep original-currency amounts in Western digits (they are quoted that way by suppliers); let the reviewer choose for dates and counts.                                                                                                                          |
| 3   | Trust names in Bangla?                                                                                                                                                                      | They stay English.                                                                                                   | Keep English until the reviewer proposes exact meanings; never a weaker word.                                                                                                                                                                                    |

None of these blocks the build. Each is decided when a reviewer is recorded.

## Rollback

Delete `language-scripts.css` and its import, restore the chip rules into the global file, and remove the `mr.*` keys. The previous behaviour is unchanged because nothing mounts the teaching layer until Lane 4 and 5.

## Required acceptance

With both language settings unset the rendered page is as it was (English only, no chip). `tests/integration/language-phase2.test.ts` and `tests/integration/language-catalog.test.ts` pass; the specimen passes at 320, 390, 768 and 1440 pixels, including the letter-spacing check for Bengali and Arabic.

Amended by [ADR-074](0074-per-page-language-release.md) (accepted 30 October 2026) for the request form's words; otherwise this ADR applies as written.
