import { inEveryLanguage } from '../lang';

// WS-B message block (commercial readiness program, D16 and 3.3). Only WS-B edits this file.
// Keys start with "wsb.". English is the source; each other language's words for these keys
// are in lang/<code>.ts, and a key a language has no words for is shown in English.
// Privacy and consent lines stay in English.
export const wsBEn = {
  // D6: a request the customer sent is never called a draft.
  'wsb.status.received': 'Received, waiting for review.',
  // CQ-21: an unsent draft asks to be finished and sent.
  'wsb.move.draft.action': 'Finish and Send',
  // CQ-77: a published report the customer can read.
  'wsb.move.report.object': 'your new report',
  'wsb.move.report.action': 'Open the Report',
  'wsb.move.report.title': 'New report ready',
} as const;

/** These words in every other language (lang/<code>.ts), English where a language has none yet. */
export const wsB = inEveryLanguage(wsBEn);
