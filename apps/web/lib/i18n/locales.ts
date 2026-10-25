// Languages the product can show. English is the source and the fallback. A language is offered to
// the public only when its text has been reviewed by a native speaker (ui-direction.md, rule 3), and
// the owner records that by listing it in CORRIDRA_LANGUAGES_REVIEWED. CORRIDRA_LANGUAGES_PREVIEW
// shows the unreviewed drafts, labelled, so the owner can read them before a reviewer does.
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

/** English always. A reviewed language is offered as itself, a draft only in preview. */
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
