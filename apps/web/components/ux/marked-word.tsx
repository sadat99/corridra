'use client';
// A message in the chosen language; when that language has no text yet (it equals the English
// placeholder) the word is marked lang="en" so a screen reader reads it as English (D16, open
// language gap). Shared by the left navigation of the team and contributor shells. Owner: WS-E.
import type { ReactNode } from 'react';
import { useLanguage } from '../language-provider';
import { translate } from '../../lib/i18n/messages';

export function useMarkedWord() {
  const { t, locale } = useLanguage();
  function word(key: Parameters<typeof t>[0]): ReactNode {
    const text = t(key);
    return locale !== 'en' && text === translate('en', key) ? <span lang="en">{text}</span> : text;
  }
  return word;
}
