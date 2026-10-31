'use client';
import { createContext, createElement, Fragment, useContext, useMemo, type ReactNode } from 'react';
import { fillNodes } from '../../lib/i18n/fill';
import { formEn, type FormCatalog, type FormKey } from '../../lib/i18n/form-words/en';
import { readFormMessage } from '../../lib/i18n/form-words/messages';
import { defaultLocale, localeMeta, type Locale } from '../../lib/i18n/locales';
import { translate } from '../../lib/i18n/messages';
import { wsAEn } from '../../lib/i18n/ws/ws-a';

/** A WS-A message key (commercial readiness program): words added to the form after its own catalogue. */
export type WsaKey = keyof typeof wsAEn;

/**
 * Plain English for the validation library's own wording (CQ-11). The schemas' raw messages stay as they are,
 * because the translated catalogues and the message reader key on them; only the English the person reads changes.
 */
const plainEnglish: readonly (readonly [RegExp, string])[] = [
  [/Too small: expected string to have >=(\d+) characters?/g, 'Write at least $1 characters'],
  [/Too big: expected string to have <=(\d+) characters?/g, 'Use $1 characters or fewer'],
  [/Too small: expected array to have >=1 items?/g, 'Choose at least one'],
  [
    /Invalid string: must match pattern \/\^\[1-9\]\[0-9\]\{0,11\}\$\//g,
    'Enter a whole number, for example 500',
  ],
  [/Invalid email address/g, 'Enter an email address, for example name@company.com'],
  [/Invalid input[^.]*/g, 'Check this answer'],
];
export function plainMessage(text: string) {
  return plainEnglish.reduce((current, [pattern, words]) => current.replace(pattern, words), text);
}

/** The language the form's words are shown in, and its words. No words means English. */
export type FormWords = { locale: Locale; words: FormCatalog | null };

const FormWordsContext = createContext<FormWords>({ locale: defaultLocale, words: null });

/** Supplies the form's words. Only the /plan page region does this; any other mount of the form is English. */
export const FormWordsProvider = FormWordsContext.Provider;

const englishAttributes = { lang: 'en', dir: 'ltr' } as const;
const noAttributes = {} as const;

/**
 * The form's words in the language they are shown in. While the form is English every helper gives exactly what
 * the form wrote before: the same text, no added element and no added attribute, so the page is unchanged. When
 * the form is translated, the parts that stay English are wrapped and say so (`lang="en" dir="ltr"`).
 */
export function useFormWords() {
  const { locale, words } = useContext(FormWordsContext);
  return useMemo(() => {
    const translated = words !== null && locale !== defaultLocale;
    const meta = localeMeta[translated ? locale : defaultLocale];
    /** A word in the shown language. An empty entry shows the English, as the shared catalogue does. */
    const say = (key: FormKey) => (translated && words?.[key]) || formEn[key];
    /** A word with `{name}` parts filled in; a value may be an element. */
    const sayWith = (key: FormKey, values: Record<string, ReactNode>) =>
      fillNodes(say(key), values);
    /** An English part inside a line: a code, an amount, an address or a short sentence. */
    const english = (node: ReactNode): ReactNode =>
      translated ? createElement('span', englishAttributes, node) : node;
    /** An English sentence on its own line after the translated sentences of the same paragraph. */
    const englishIsland = (node: ReactNode): ReactNode =>
      translated
        ? createElement('span', { ...englishAttributes, className: 'lang-island' }, node)
        : node;
    /** A translated sentence followed by an English one; in English the two are one sentence pair as before. */
    const withEnglish = (key: FormKey, sentence: string): ReactNode =>
      translated
        ? createElement(Fragment, null, say(key), englishIsland(sentence))
        : `${say(key)} ${sentence}`;
    /** A message the form shows. English is shown as written. A translated form shows known messages translated,
     * English-only sentences marked English, and anything unknown word for word after a translated line; an English
     * sentence after a translated one starts on its own line. A count is part of the sentence; codes and addresses
     * are data, marked English. */
    const showMessage = (text: string): ReactNode => {
      if (!text) return text;
      if (!translated) return plainMessage(text);
      const parts = readFormMessage(text);
      if (!parts)
        return createElement(Fragment, null, say('form.message.untranslated'), englishIsland(text));
      return parts.map((part, index) => {
        // The part before ends its own sentence or line, so a space is enough; `issueSeparator` would add a full stop.
        const gap = index > 0 ? ' ' : null;
        if ('key' in part)
          return createElement(
            Fragment,
            { key: index },
            gap,
            fillNodes(
              say(part.key),
              Object.fromEntries(
                Object.entries(part.values).map(([name, value]) => [
                  name,
                  /^\d+$/.test(value) ? value : english(value),
                ]),
              ),
            ),
          );
        // An English sentence that opens the message stays inline; after a translated lead or part it is a line.
        if (!part.lead && index === 0)
          return createElement(Fragment, { key: index }, english(part.english));
        return createElement(
          Fragment,
          { key: index },
          part.lead ? gap : null,
          part.lead ? say(part.lead) : null,
          englishIsland(part.english),
        );
      });
    };
    return {
      translated,
      /** The shown language's tag and direction, for country names, times and a right to left form. */
      tag: meta.html,
      dir: meta.dir,
      say,
      sayWith,
      english,
      englishIsland,
      withEnglish,
      showMessage,
      /** A WS-A word in the shown language; English while the form is English. */
      wsa: (key: WsaKey) => (translated ? translate(locale, key) : wsAEn[key]),
      /** Spread on an element that stays English: adds `lang="en" dir="ltr"` only when the form is translated. */
      englishProps: translated ? englishAttributes : noAttributes,
    };
  }, [locale, words]);
}
