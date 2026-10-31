import type { Locale } from '../locales';

// WS-C message block (commercial readiness program, D16 and 3.3). Only WS-C edits this file.
// Keys start with "wsc.". English is the source; every other language needs the same keys. The
// translations are drafts until a native reviewer is recorded in docs/qa/2026-10-31/i18n-review.md.
// Privacy and consent lines stay in English.
export const wsCEn = {} as const;

export const wsC: Record<Exclude<Locale, 'en'>, Record<keyof typeof wsCEn, string>> = {
  bn: {},
  zh: {},
  es: {},
  ar: {},
  fr: {},
  de: {},
};
