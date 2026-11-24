import { inEveryLanguage } from '../lang';

// WS-A message block (commercial readiness program, D16 and 3.3). Only WS-A edits this file.
// Keys start with "wsa.". English is the source; each other language's words for these keys
// are in lang/<code>.ts, and a key a language has no words for is shown in English.
// Privacy and consent lines stay in English.
export const wsAEn = {
  'wsa.plan.required': 'required',
  'wsa.plan.outcomesHint': 'Choose at least one.',
  'wsa.plan.trip.offer': 'What should the trip achieve?',
  'wsa.plan.trip.offerExample':
    'Example: Twelve garment exporters visit buyers in Guangzhou for four days in March. Each wants two meetings with buyers who fit.',
  'wsa.plan.trip.offerHint':
    'Say who is travelling, where and when, and what each participant hopes to bring home. Details can follow later.',
  'wsa.plan.jobChoice':
    'You have a saved request. Continue it, or start a new request for “{job}”?',
  'wsa.plan.jobChoice.continue': 'Continue saved request',
  'wsa.plan.jobChoice.start': 'Start a new request',
  'wsa.plan.noteChoice':
    'You have a saved request. Continue it, or start a new request with the notes from the link you opened?',
  'wsa.plan.countries.pinned': 'Most requested',
  'wsa.plan.countries.eu': 'EU countries',
  'wsa.plan.countries.other': 'Other countries',
  'wsa.plan.check.hintReal': 'The code from your request receipt email.',
  'wsa.plan.check.hintSample': 'The code shown after you sent the request.',
  'wsa.plan.check.empty': 'Enter the code from your receipt.',
} as const;

/** These words in every other language (lang/<code>.ts), English where a language has none yet. */
export const wsA = inEveryLanguage(wsAEn);
