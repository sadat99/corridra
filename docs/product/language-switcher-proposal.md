# Languages and the language switcher: proposal

Status: waiting for two owner decisions (how the language is chosen, and which languages go first). Nothing is built. Written on 24 October 2026 after the owner asked where the language switcher is.

## What the plan already says

The locked guided experience standard in `docs/agents/ui-direction.md` (19 October 2026) sets these rules.

| Rule                              | Wording in the plan                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Rule 3, language first            | English, বাংলা and 中文 are chosen first and remembered. Company names and original text are never translated. |
| Language chip                     | Beside the title and help on public and home screens. The public header carries language and Listen.           |
| Reviewed copy only                | A language without copy reviewed by a native speaker is not offered.                                           |
| Language screen (open decision 3) | Preselect from the browser language, show it once on a first visit, allow skipping to English.                 |
| Build order step 1                | Language, public home and request flow, in one pull request.                                                   |
| Source language stays visible     | The UX handoff (C08, X03) says Bangla guidance and formats must not be presented as a fully translated UI.     |

## What exists today

The page language is fixed to English. A Bangla guide sits inside the request form. The mission email templates already take a language, including right to left. There is no language chip, no message files and no Listen button. The plan's step 1 was never built.

## Decision 1: how the language is chosen

| Option                                       | Web address                                     | Speed for Bangladesh phones                                                       | Search and sharing             | Effort and risk                                                                                        |
| -------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| A. Remembered choice, applied in the browser | Unchanged                                       | Pages stay static on the CDN. Non-English readers see English for a moment first. | One address per page           | Small. No route or test changes. Can be replaced by B later without changing how screens ask for text. |
| B. Language in the address (`/bn/signin`)    | English unchanged, other languages get a prefix | Static pages in every language, no flash                                          | Best: one address per language | Large. All 53 pages move under a language folder and their tests change.                               |
| C. Remembered choice, read on the server     | Unchanged                                       | Every page rendered on request from Frankfurt, slower for Bangladesh              | One address per page           | Medium. Loses static pages, which the request page and tests rely on.                                  |

Recommendation: **A now, built so B can replace it.** Screens ask for text through one function (`t('key')`), so moving to B later changes where the language comes from and nothing else. Hard to reverse is B, not A.

## Decision 2: which languages first

Proposed: English, বাংলা, 中文 and español in the first release, then العربية. Arabic needs a right to left layout check and its own reviewer. Each language is switched on only when its reviewer is recorded. Until then it can be shown to the owner as a labelled draft behind a setting, never to the public.

For each language the owner names one native reviewer. Reviews cover the pages in the first release, not the whole product.

## What the first release translates

The public header and footer, the home page, how it works, and the request flow, which is build order step 1. The signed-in screens, operator screens, emails and legal pages follow later. The privacy page and legal text are not machine translated: they need a lawyer or qualified reviewer per language.

## Rules kept

- Company names, original text and quotations are never translated.
- Copy follows the plain language rules (short sentences, no idioms) in every language.
- Dates, numbers and money keep their original currency and precision, with locale formatting only for display.
- A language switch changes the page and nothing else: no account, permission or data change.
- Right to left languages set the page direction and mirror the layout, and every screen is checked at 320, 390, 768 and 1440 pixels with the accessibility scan.
- No claim that the product is fully translated until it is.

## Work, in order

1. Foundation: message files, the `t()` function, the language chip in the header, a remembered choice, page language and direction, fonts for each script, and tests. English only, behind the reviewed flag.
2. Move the public header, footer, home, how it works and the request flow onto message files.
3. Draft each language and send it to its reviewer. Switch a language on when its review is recorded.
4. Read aloud (Listen) as its own follow-up, hidden where the phone cannot speak that language.
