import { inEveryLanguage } from '../lang';

// WS-D message block (commercial readiness program, D16 and 3.3). Only WS-D edits this file.
// Keys start with "wsd.". English is the source; each other language's words for these keys
// are in lang/<code>.ts, and a key a language has no words for is shown in English.
// Privacy and consent lines stay in English.
// Lead, 31 Oct 2026: the team pages stay English (as WS-C chose), so no WS-D key is read by any page.
// The twelve draft keys were removed instead of shipping unused text; add keys here when a page uses them.
export const wsDEn = {} as const;

/** These words in every other language (lang/<code>.ts), English where a language has none yet. */
export const wsD = inEveryLanguage(wsDEn);
