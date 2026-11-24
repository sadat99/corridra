// Languages the product can show. English is the source and the fallback. A language is offered when
// the owner lists it in CORRIDRA_LANGUAGES_REVIEWED, or all of them with CORRIDRA_LANGUAGES_PREVIEW.
// Owner, 23 November 2026: the six are shown by owner decision and no screen marks them; no native
// review is recorded (docs/product/language-review-record.md). The `draft` field below still says
// whether a language is offered without being listed; nothing on screen reads it.
export const localeCodes = ['en', 'bn', 'zh', 'es', 'ar', 'fr', 'de'] as const;
export type Locale = (typeof localeCodes)[number];
export const defaultLocale: Locale = 'en';
export const languageStorageKey = 'corridra.language';

export const localeMeta: Record<Locale, { name: string; html: string; dir: 'ltr' | 'rtl' }> = {
  en: { name: 'English', html: 'en', dir: 'ltr' },
  bn: { name: 'বাংলা', html: 'bn', dir: 'ltr' },
  zh: { name: '中文', html: 'zh-Hans', dir: 'ltr' },
  es: { name: 'Español', html: 'es', dir: 'ltr' },
  ar: { name: 'العربية', html: 'ar', dir: 'rtl' },
  fr: { name: 'Français', html: 'fr', dir: 'ltr' },
  de: { name: 'Deutsch', html: 'de', dir: 'ltr' },
};

export type OfferedLanguage = { code: Locale; draft: boolean };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (localeCodes as readonly string[]).includes(value);
}

/** English always, each listed language, and every language in preview. */
export function offeredLanguages(
  env: Record<string, string | undefined> = process.env,
): OfferedLanguage[] {
  const reviewed = new Set(
    (env.CORRIDRA_LANGUAGES_REVIEWED ?? '')
      .split(',')
      .map((code) => code.trim().toLowerCase())
      .filter(isLocale),
  );
  const preview = env.CORRIDRA_LANGUAGES_PREVIEW === 'true';
  return localeCodes
    .filter((code) => code === defaultLocale || reviewed.has(code) || preview)
    .map((code) => ({ code, draft: code !== defaultLocale && !reviewed.has(code) }));
}

/** Maps one browser language tag to a locale, or null. Traditional Chinese is not claimed. */
export function localeFromTag(tag: string): Locale | null {
  const lower = tag.trim().toLowerCase();
  const primary = lower.split('-')[0];
  if (primary === 'zh') {
    return lower === 'zh' || /^zh-(cn|sg|hans)(-|$)/.test(lower) ? 'zh' : null;
  }
  return isLocale(primary) ? primary : null;
}

/** First browser language that is also offered. Null means keep the default. */
export function negotiate(preferred: readonly string[], offered: readonly Locale[]): Locale | null {
  for (const tag of preferred) {
    const locale = localeFromTag(tag);
    if (locale && offered.includes(locale)) return locale;
  }
  return null;
}
