'use client';
// The language chooser (UI/UX.v4 row "Language chooser", board screen 10): a bottom sheet that lists each offered
// language in its own script with its short code, for example "EN English" and "BN বাংলা". It uses the same stored
// choice as every other language control (language-provider.tsx), so switching and its persistence are unchanged.
// The line "Six of seven are draft translations. Native review pending." is written from the offered languages
// themselves, so it is shown only while drafts are offered and the numbers are the real ones.
import './language-sheet.css';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { localeMeta, type Locale, type OfferedLanguage } from '../../lib/i18n/locales';
import { useLanguage } from '../language-provider';
import { CorridraIcon } from '../corridra-icon';

const numberWords = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** The short code of a language, as the top bar and the sheet show it: EN, BN, ZH, ES, AR, FR, DE. */
export function localeCode(locale: Locale) {
  return locale.toUpperCase();
}

/** "Six of seven are draft translations. Native review pending." or null when no draft is offered. */
export function draftLine(offered: readonly OfferedLanguage[]) {
  const drafts = offered.filter((item) => item.draft).length;
  if (drafts === 0 || offered.length >= numberWords.length) return null;
  const total = numberWords[offered.length].toLowerCase();
  const verb = drafts === 1 ? 'is a draft translation' : 'are draft translations';
  return `${numberWords[drafts]} of ${total} ${verb}. Native review pending.`;
}

const focusable = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Sheet({ onClose, extra }: { onClose: () => void; extra?: ReactNode }) {
  const { locale, offered, choose, t } = useLanguage();
  const titleId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const panel = useRef<HTMLDivElement>(null);
  const line = draftLine(offered);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className="language-sheet-layer"
      onKeyDown={(event) => {
        // The sheet sits in the page body but is part of the header in the React tree: keep its keys to itself so the
        // drawer's own focus trap and Escape never see them.
        event.stopPropagation();
        if (event.key === 'Escape') {
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const stops = Array.from(panel.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="language-sheet-scrim" onClick={onClose} />
      <div
        ref={panel}
        className="language-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="language-sheet-head">
          <h2 id={titleId}>{t('language.label')}</h2>
          <button type="button" className="language-sheet-close" onClick={onClose}>
            <CorridraIcon name="close" size={18} />
            <span>{t('header.menuClose')}</span>
          </button>
        </div>
        <ul className="language-sheet-list">
          {offered.map(({ code, draft }) => (
            <li key={code}>
              <button
                type="button"
                lang={localeMeta[code].html}
                dir={localeMeta[code].dir}
                aria-pressed={code === locale}
                onClick={() => {
                  choose(code);
                  onClose();
                }}
              >
                <span className="language-sheet-code" dir="ltr">
                  {localeCode(code)}
                </span>
                <span className="language-sheet-name">{localeMeta[code].name}</span>
                {draft && <small>{t('language.draft')}</small>}
                {code === locale && <CorridraIcon name="check" size={18} />}
              </button>
            </li>
          ))}
        </ul>
        {line && (
          <p className="language-sheet-note" lang="en" dir="ltr">
            {line}
          </p>
        )}
        {/* Optional room under the rows for a page's own language help; nothing uses it yet. */}
        {extra}
      </div>
    </div>
  );
}

/**
 * The language control of the top bar: an icon, the short code of the chosen language and a sheet that lists every
 * offered language. It appears only when more than one language is offered, so with English alone the bar is unchanged.
 */
export function LanguageButton({
  className = 'top-bar-tool',
  extra,
}: {
  className?: string;
  /** Optional content shown under the language rows in the sheet. */
  extra?: ReactNode;
}) {
  const { locale, offered, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (offered.length < 2) return null;
  function close() {
    setOpen(false);
    button.current?.focus();
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${localeCode(locale)}, ${t('language.label')}: ${localeMeta[locale].name}`}
        onClick={() => setOpen(true)}
      >
        <CorridraIcon name="globe" size={20} />
        <span aria-hidden="true" dir="ltr">
          {localeCode(locale)}
        </span>
      </button>
      {open && createPortal(<Sheet onClose={close} extra={extra} />, document.body)}
    </>
  );
}
