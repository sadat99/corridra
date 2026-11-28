'use client';

import { createElement, type ReactNode } from 'react';
import { useLanguage } from '../../components/language-provider';
import { fill } from '../../lib/i18n/fill';
import { defaultLocale } from '../../lib/i18n/locales';
import { translate, type MessageKey } from '../../lib/i18n/messages';

/**
 * The catalogue words of the request window (left pane and saved screen). While a language has no reviewed words for a
 * key (native review is open, so every `home.v44.*` word is English only) the English shows and says so: it sits in an
 * English island, so a screen reader reads it in English and the page's own direction is kept.
 */
export function usePlanWords() {
  const { t, locale } = useLanguage();
  const word = (key: MessageKey, values?: Record<string, string | number>): ReactNode => {
    const text = values ? fill(t(key), values) : t(key);
    return locale !== defaultLocale && t(key) === translate(defaultLocale, key)
      ? createElement('span', { lang: 'en', dir: 'ltr' }, text)
      : text;
  };
  return { t, word };
}
