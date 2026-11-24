import type { Locale } from '../locales';
import type { MessageKey } from '../messages';
import { ar } from './ar';
import { bn } from './bn';
import { de } from './de';
import { es } from './es';
import { fr } from './fr';
import { zh } from './zh';

// One words file per language (commercial-ready run, unit L0). English is the source and lives beside its screens
// in lib/i18n (messages.ts and the *-words.ts and ws files); each other language keeps all of its words in one file
// here, so a language unit edits one file and never another language's. A key a language has no words for yet is
// shown in English: the catalogue is the English words with that language's words laid over them (messages.ts).
//
// Conventions for every language: Spanish, French and German use sentence case and the formal address (usted, vous,
// Sie); Bangla, Chinese and Arabic have no letter case. Brand and company names stay as written. The six header job
// names match the `way.*` words of the same language. Arabic is right to left and every header label is short
// enough for the 320 px header. No dash is used as punctuation.

/** The words one language has. A key that is not English's is a type error; a missing key falls back to English. */
export type LanguageWords = Partial<Record<MessageKey, string>>;
export type OtherLocale = Exclude<Locale, 'en'>;

export const languageWords: Record<OtherLocale, LanguageWords> = { bn, zh, es, ar, fr, de };

/** One block of English words in every other language: the language's own word where it has one, English where not. */
export function inEveryLanguage<T extends Record<string, string>>(
  english: T,
): Record<OtherLocale, Record<keyof T, string>> {
  const block = (code: OtherLocale) =>
    Object.fromEntries(
      Object.keys(english).map((key) => [
        key,
        (languageWords[code] as Record<string, string | undefined>)[key] || english[key],
      ]),
    ) as Record<keyof T, string>;
  return {
    bn: block('bn'),
    zh: block('zh'),
    es: block('es'),
    ar: block('ar'),
    fr: block('fr'),
    de: block('de'),
  };
}
