'use client';
import { createContext, createElement, Fragment, useContext, useMemo, type ReactNode } from 'react';
import { fillNodes } from '../../lib/i18n/fill';
import { formEn, type FormCatalog, type FormKey } from '../../lib/i18n/form-words/en';
import { readFormMessage } from '../../lib/i18n/form-words/messages';
import { defaultLocale, localeMeta, type Locale } from '../../lib/i18n/locales';

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
    /** A message the form shows. English is shown as written; a translated form shows known messages translated,
     * English-only sentences marked English, and anything unknown word for word after a translated line. The
     * variable parts of a known message (a code, a count, an address) are data and are shown as written, marked
     * English, so an address keeps its order inside right to left text. */
    const showMessage = (text: string): ReactNode => {
      if (!translated || !text) return text;
      const parts = readFormMessage(text);
      if (!parts)
        return createElement(Fragment, null, say('form.message.untranslated'), ' ', english(text));
      return parts.map((part, index) =>
        createElement(
          Fragment,
          { key: index },
          index > 0 ? ' ' : null,
          'key' in part
            ? fillNodes(
                say(part.key),
                Object.fromEntries(
                  Object.entries(part.values).map(([name, value]) => [name, english(value)]),
                ),
              )
            : createElement(
                Fragment,
                null,
                part.lead ? `${say(part.lead)} ` : null,
                english(part.english),
              ),
        ),
      );
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
      /** Spread on an element that stays English: adds `lang="en" dir="ltr"` only when the form is translated. */
      englishProps: translated ? englishAttributes : noAttributes,
    };
  }, [locale, words]);
}
