import { defaultLocale, isLocale, localeCodes, type Locale } from './locales';

// Page words (owner decision of 25 October 2026: pages follow the chosen language). A page is on message files
// when its words are keys with one of these prefixes. They show in the chosen language only for the languages
// named by `CORRIDRA_LANGUAGES_PAGES`, which the owner sets after the page words of each language are reviewed and
// recorded (docs/product/language-review-record.md). Until then every page key shows its English words in
// every language, so releasing a language never releases words nobody has reviewed.
export const pageKeyPrefixes = ['home.'] as const;

export const isPageKey = (key: string) => pageKeyPrefixes.some((prefix) => key.startsWith(prefix));

/**
 * The languages a release setting names: `true` releases every language, a list such as `es,de` only those, and
 * anything else (empty, unset, a misspelling) releases none. English is always English.
 */
function releasedLanguages(setting: string | undefined): readonly Locale[] {
  const value = (setting ?? '').trim().toLowerCase();
  if (value === 'true') return localeCodes.filter((code) => code !== defaultLocale);
  return [
    ...new Set(
      value
        .split(',')
        .map((code) => code.trim())
        .filter(isLocale)
        .filter((code) => code !== defaultLocale),
    ),
  ];
}

/** The languages whose home page words are released (`CORRIDRA_LANGUAGES_PAGES`). */
export function languagesWithPages(env: NodeJS.ProcessEnv = process.env): readonly Locale[] {
  return releasedLanguages(env.CORRIDRA_LANGUAGES_PAGES);
}

/**
 * The languages whose request form words are released (`CORRIDRA_LANGUAGES_FORM`). Read the same way as the page
 * words and independent of them: setting one never releases the other. Only `/plan` reads it.
 */
export function languagesWithForm(env: NodeJS.ProcessEnv = process.env): readonly Locale[] {
  return releasedLanguages(env.CORRIDRA_LANGUAGES_FORM);
}

export const languagePagesEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  languagesWithPages(env).length > 0;

/** The language a key is shown in: the chosen one, except page keys while that language's page words are not released. */
export function localeFor(locale: Locale, key: string, pages: boolean): Locale {
  return pages || !isPageKey(key) ? locale : defaultLocale;
}
