# Languages and the language switcher: proposal

Status: decided and partly built. The owner chose option A (remembered choice applied in the browser) and English, Bangla, Chinese and Spanish first, then Arabic. The foundation is merged (PR 171 and PR 174, 24 October 2026). What remains is translating the home page, how it works and the request flow, and recording a native reviewer per language. Written on 24 October 2026 after the owner asked where the language switcher is; the sections below keep the original reasoning, and the next section says what exists now.

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

Built and merged (PR 171, PR 174):

- Message files for English, Bangla, Chinese, Spanish and Arabic (`apps/web/lib/i18n`). Bangla, Chinese, Spanish and Arabic are drafts until a reviewer is recorded.
- A language chip in the public header (`language-switcher.tsx`), a provider that applies the remembered or browser language after the page loads, and the page language and direction for the translated header, footer and skip link. Each page's main content stays marked English until that page is on message files.
- The rule that only reviewed languages are offered: `CORRIDRA_LANGUAGES_REVIEWED` (for example `bn,zh,es`). `CORRIDRA_LANGUAGES_PREVIEW=true` shows labelled drafts for the owner. With neither set, only English is offered and the chip is hidden, which is why the live site looks unchanged.

Not built yet:

- Home page, how it works and the request flow are still English text, not on message files.
- Listen reads the main content in its own language, but there is no per-language voice check beyond the browser's own.
- No native reviewer is recorded for any language, so no language is offered to the public.
- The privacy page does not yet mention the stored language choice (needs the owner's review of legal text).

The Bangla guide inside the request form and the mission email templates (which already take a language, including right to left) are separate and unchanged.

## Decision 1: how the language is chosen (decided: option A)

| Option                                       | Web address                                     | Speed for Bangladesh phones                                                       | Search and sharing             | Effort and risk                                                                                        |
| -------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| A. Remembered choice, applied in the browser | Unchanged                                       | Pages stay static on the CDN. Non-English readers see English for a moment first. | One address per page           | Small. No route or test changes. Can be replaced by B later without changing how screens ask for text. |
| B. Language in the address (`/bn/signin`)    | English unchanged, other languages get a prefix | Static pages in every language, no flash                                          | Best: one address per language | Large. All 53 pages move under a language folder and their tests change.                               |
| C. Remembered choice, read on the server     | Unchanged                                       | Every page rendered on request from Frankfurt, slower for Bangladesh              | One address per page           | Medium. Loses static pages, which the request page and tests rely on.                                  |

Recommendation: **A now, built so B can replace it.** Screens ask for text through one function (`t('key')`), so moving to B later changes where the language comes from and nothing else. Hard to reverse is B, not A.

## Decision 2: which languages first (decided: English, Bangla, Chinese, Spanish, then Arabic)

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
