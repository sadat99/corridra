'use client';
// The tab title in the chosen language (commercial-ready run, unit L0). Pages are built in English and stay static,
// so the title a search engine or a share preview reads is the English one in app/layout.tsx. After the page loads,
// where the tab shows the site's own default title this writes the same line in the chosen language, as the provider
// does for the page language and direction. A page that sets its own title is left exactly as it is: those titles
// are English until each page's words are translated. Nothing is sent anywhere.
import { useEffect } from 'react';
import { localeCodes } from '../../lib/i18n/locales';
import { translate } from '../../lib/i18n/messages';
import { useLanguage } from '../language-provider';

/** The site's default title in every language: a tab that shows one of these shows the site default. */
const defaults = new Set(localeCodes.map((code) => translate(code, 'site.title')));

/** Writes `wanted` over a default title. React keeps its own text node, so the node is changed, never replaced. */
function apply(wanted: string) {
  const title = document.querySelector('head > title');
  const current = title?.textContent ?? '';
  if (!title || current === wanted || !defaults.has(current)) return;
  const text = title.firstChild;
  if (text && text.nodeType === Node.TEXT_NODE && title.childNodes.length === 1)
    (text as Text).data = wanted;
  else title.textContent = wanted;
}

export function SiteTitle() {
  const { locale } = useLanguage();
  useEffect(() => {
    const wanted = translate(locale, 'site.title');
    apply(wanted);
    // Moving between pages puts the English default back; write the chosen language again when that happens.
    const observer = new MutationObserver(() => apply(wanted));
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [locale]);
  return null;
}
