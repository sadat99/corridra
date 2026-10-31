import type { Locale } from '../locales';

// WS-D message block (commercial readiness program, D16 and 3.3). Only WS-D edits this file.
// Keys start with "wsd.". English is the source; every other language needs the same keys. The
// translations are drafts until a native reviewer is recorded in docs/qa/2026-10-31/i18n-review.md.
// Privacy and consent lines stay in English.
// Lead, 31 Oct 2026: the team pages stay English (as WS-C chose), so no WS-D key is read by any page.
// The twelve draft keys were removed instead of shipping unused text; add keys here when a page uses them.
export const wsDEn = {} as const;

export const wsD: Record<Exclude<Locale, 'en'>, Record<keyof typeof wsDEn, string>> = {
  bn: {},
  zh: {},
  es: {},
  ar: {},
  fr: {},
  de: {},
};
