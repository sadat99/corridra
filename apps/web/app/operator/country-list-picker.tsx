'use client';
// A bounded pick of countries (ADR-089, guided Connect AI): a search field, at most five matching countries to add with a
// line that says how many matched, and the chosen list with Remove: the first five, then Show All for every one. English names with the code beside
// them, no flags. Every add and remove is announced. It keeps only the search text; the chosen codes belong to the screen.
import { useEffect, useId, useRef, useState } from 'react';
import { countryCodes } from '@corridra/domain/countries';
import { FieldError } from '../../components/field-error';
import { chosenCount, countryAdded, countryRemoved, matchesLine, words } from './connect-ai-copy';

const names = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string) => names.of(code) ?? code;
const resultLimit = 5;
const chosenShown = 5;

export function CountryListPicker({
  inputId,
  chosen,
  limit,
  onChange,
  error,
  errorId,
}: {
  /** The search field's id, so the screen can move focus to it. */
  inputId: string;
  chosen: readonly string[];
  limit: number;
  onChange: (codes: string[]) => void;
  error?: string;
  errorId: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [announced, setAnnounced] = useState('');
  const [showAll, setShowAll] = useState(false);
  // The control a click removes hands focus on once the next render is drawn: Show All to the first country it revealed,
  // Remove to the search field.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingFocus.current && document.getElementById(pendingFocus.current);
    if (!target) return;
    pendingFocus.current = null;
    target.focus();
  });
  const text = query.trim().toLowerCase();
  const matching = text
    ? countryCodes.filter(
        (code) =>
          !chosen.includes(code) &&
          (countryName(code).toLowerCase().includes(text) || code.toLowerCase() === text),
      )
    : [];
  const shown = matching.slice(0, resultLimit);
  const full = chosen.length >= limit;
  const add = (code: string) => {
    if (full || chosen.includes(code)) return;
    const next = [...chosen, code];
    onChange(next);
    setAnnounced(countryAdded(countryName(code), next.length, limit));
  };
  const remove = (code: string) => {
    const next = chosen.filter((c) => c !== code);
    onChange(next);
    setAnnounced(countryRemoved(countryName(code), next.length, limit));
    pendingFocus.current = inputId;
  };
  const item = (code: string) => (
    <li key={code}>
      <span>{countryName(code)}</span>
      {/* The visible word is Remove; the name adds the country, so each of the list's buttons is told apart. */}
      <button
        id={`${id}-remove-${code}`}
        type="button"
        className="text-link connect-ai-link"
        aria-label={`Remove ${countryName(code)}`}
        onClick={() => remove(code)}
      >
        Remove
      </button>
    </li>
  );
  return (
    <div className="connect-ai-picker">
      <label htmlFor={inputId}>{words.countries.find}</label>
      {/* One line: the hint before typing, then how many countries match. */}
      <p id={`${id}-hint`} className="connect-ai-helper" role="status">
        {!text
          ? words.countries.findHint
          : matching.length
            ? matchesLine(shown.length, matching.length)
            : words.countries.noMatch}
      </p>
      <input
        id={inputId}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-describedby={`${id}-hint${error ? ` ${errorId}` : ''}`}
        aria-invalid={error ? true : undefined}
      />
      {full ? (
        <p className="connect-ai-helper">{words.countries.atCap}</p>
      ) : (
        shown.length > 0 && (
          <ul className="connect-ai-results">
            {shown.map((code) => (
              <li key={code}>
                <button
                  type="button"
                  className="text-link connect-ai-link"
                  onClick={() => add(code)}
                >
                  Add {countryName(code)}
                </button>{' '}
                <span className="connect-ai-code">{code}</span>
              </li>
            ))}
          </ul>
        )
      )}
      <p>{chosenCount(chosen.length, limit)}</p>
      {chosen.length > 0 && (
        <ul className="connect-ai-chosen" id={`${id}-chosen`}>
          {(showAll ? chosen : chosen.slice(0, chosenShown)).map(item)}
        </ul>
      )}
      {chosen.length > chosenShown && !showAll && (
        // Shows every chosen country in the one list, not only those after the first few. The button then goes, so focus
        // moves to the first country it revealed.
        <button
          type="button"
          className="text-link connect-ai-link"
          aria-controls={`${id}-chosen`}
          onClick={() => {
            pendingFocus.current = `${id}-remove-${chosen[chosenShown]}`;
            setShowAll(true);
          }}
        >
          {words.countries.showAll}
        </button>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
      <p className="sr-only" role="status" aria-live="polite">
        {announced}
      </p>
    </div>
  );
}
