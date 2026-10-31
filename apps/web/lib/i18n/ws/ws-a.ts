import type { Locale } from '../locales';

// WS-A message block (commercial readiness program, D16 and 3.3). Only WS-A edits this file.
// Keys start with "wsa.". English is the source; every other language needs the same keys. The
// translations are drafts until a native reviewer is recorded in docs/qa/2026-10-31/i18n-review.md.
// Privacy and consent lines stay in English.
export const wsAEn = {} as const;

export const wsA: Record<Exclude<Locale, 'en'>, Record<keyof typeof wsAEn, string>> = {
  bn: {},
  zh: {},
  es: {},
  ar: {},
  fr: {},
  de: {},
};
