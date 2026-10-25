# Lane 11: French and German drafts, and the pseudo-language test

**Document status: DONE.** Built and merged behind its switch, off by default; nothing installed or enabled by merging. See the [plan status register](../PLAN_STATUS.md).

Status: built and dark, 25 October 2026. Nothing is offered to the public: French (`fr`) and German (`de`) join Bangla, Chinese, Spanish and Arabic as labelled drafts that show only where the owner turns on `CORRIDRA_LANGUAGES_PREVIEW`. A language is offered for real only after a native reviewer is recorded in [language-review-record.md](language-review-record.md) and the owner adds its code to `CORRIDRA_LANGUAGES_REVIEWED`. No switch is added, because the existing release rule already holds every draft back.

## What exists

| Part                 | What it does                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| French draft         | All 138 message keys (header, footer, ways to work, the Road, Your Move, the Room, the first question) in a formal register (vous). The Move is explained as "une prochaine étape", never as a loan word.                                                       |
| German draft         | The same keys in a formal register (Sie). The Move is "ein nächster Schritt". Long compounds are avoided where a short plain word exists.                                                                                                                       |
| Locale codes         | `fr` and `de` are known languages with their own `lang` tag, left to right. The browser-language match now maps `fr-*` and `de-*` to them, but a language that is not offered is never chosen.                                                                  |
| Pseudo-language test | Every English string made 40 percent longer, with a long unbroken word on every third string, shown through Your Move, the Road and the first question at 320, 390, 768 and 1440 px: nothing scrolls sideways, controls stay 44 px, no accessibility violation. |
| Short-label rule     | A unit test fails when a header, Move card or button label in French or German runs past 1.7 times the English text (or 30 characters), the point where a tab or a button breaks on a phone.                                                                    |
| Catalogue rules      | Every language, including these, must have exactly the English keys, no empty entry, no dash used as punctuation, the brand name wherever English has it, and every placeholder (`{date}`, `{count}`) kept exactly.                                             |

## Not built, and why

| Item                                     | Why                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A reviewer's sign-off for any language   | It is a person's judgment. The drafts are first translations for a reviewer to correct; nothing in them is claimed as reviewed.                                                                                                                                                                                    |
| Translated pages beyond the shared words | The shared message module covers the header, footer, teaching layer, Your Move, the Room and the first question. The rest of each page (public pages, forms, legal and privacy text) stays in English until each has its own reviewed translation. Legal and privacy text needs a qualified reviewer per language. |
| Numerals, type and mirroring decisions   | Arabic numerals and mirroring were decided in Lane 2 (ADR-066). French and German use Latin script and the existing type; the owner may ask the reviewer about number and date formats.                                                                                                                            |

## For the owner

1. Name a native reviewer for French and one for German.
2. Send them the strings in `apps/web/lib/i18n/messages.ts` (keys of the `fr` and `de` blocks) and the screenshots in `docs/design-system/evidence/lane11-languages/`.
3. When a reviewer signs, record the name and date in the table in `language-review-record.md`, then add the code to `CORRIDRA_LANGUAGES_REVIEWED`.

## Verification

- Unit suite `language-catalog.test.ts` (updated for two more languages): the existing key, dash, brand and fallback rules now run for `fr` and `de`; every placeholder is kept in every language; both are labelled drafts and are not offered without the preview setting; the formal address; short labels; the browser-language match. 70 tests pass.
- Operator spec `ux-pseudo-language.spec.ts` (5 tests): the 40 percent longer language through the real screens at four widths. Screenshot in `docs/design-system/evidence/lane11-languages/`.
