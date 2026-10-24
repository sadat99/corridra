'use client';

import { useRef } from 'react';
import { localeMeta } from '../lib/i18n/locales';
import { useLanguage } from './language-provider';

/**
 * The language chip. It appears only when more than one language is offered, so with only English
 * reviewed the page is unchanged. Each name is written in its own language and tagged with it.
 */
export function LanguageSwitcher() {
  const { locale, offered, choose, t } = useLanguage();
  const details = useRef<HTMLDetailsElement>(null);
  if (offered.length < 2) return null;
  function close() {
    const element = details.current;
    if (!element) return;
    element.open = false;
    element.querySelector('summary')?.focus();
  }
  return (
    <details
      className="lang-switcher"
      ref={details}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
    >
      <summary aria-label={`${t('language.label')}: ${localeMeta[locale].name}`}>
        <span lang={localeMeta[locale].html}>{localeMeta[locale].name}</span>
      </summary>
      <ul>
        {offered.map(({ code, draft }) => (
          <li key={code}>
            <button
              type="button"
              lang={localeMeta[code].html}
              dir={localeMeta[code].dir}
              aria-current={code === locale ? 'true' : undefined}
              onClick={() => {
                choose(code);
                close();
              }}
            >
              {localeMeta[code].name}
              {draft && <small> ({t('language.draft')})</small>}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
