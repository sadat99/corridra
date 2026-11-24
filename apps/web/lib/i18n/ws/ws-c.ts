import { inEveryLanguage } from '../lang';

// WS-C message block (commercial readiness program, D16 and 3.3). Only WS-C edits this file.
// Keys start with "wsc.". English is the source; each other language's words for these keys
// are in lang/<code>.ts, and a key a language has no words for is shown in English.
// Privacy and consent lines stay in English.
export const wsCEn = {} as const;

/** These words in every other language (lang/<code>.ts), English where a language has none yet. */
export const wsC = inEveryLanguage(wsCEn);
