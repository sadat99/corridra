'use client';
// The settings a field helper uses in one place. Language, reading aloud, text size (three steps) and Less Movement
// are real; text size and Less Movement are kept in this browser only. Data saver is not built yet, so it says
// Coming soon and is not a control. The private link note describes the invitation link only in words that are
// true of any link: it is for one person and the Corridra team renews it. Owner: S4, W7.
import './helper-me.css';
import { useState } from 'react';
import Link from 'next/link';
import { LanguageSwitcher } from '../../../components/language-switcher';
import { CorridraIcon } from '../../../components/corridra-icon';
import { textSizeNames, UnsavedChoiceNote } from '../../../components/ux/comfort-controls';
import { useLessMovement, useTextSize } from '../../../components/ux/use-comfort';
import { useListen } from '../../../components/ux/utility-menus';
import { textSizes } from '../../../lib/ux/comfort';

export function HelperMe({ workspace }: { workspace: string }) {
  const listen = useListen();
  const [size, setSize] = useTextSize();
  const [movement, setMovement] = useLessMovement();
  const [unsaved, setUnsaved] = useState(false);
  return (
    <>
      <section aria-labelledby="me-language" className="detail-card">
        <h2 id="me-language">Language</h2>
        <LanguageSwitcher />
      </section>
      <section aria-labelledby="me-comfort" className="detail-card">
        <h2 id="me-comfort">Make it easier to read</h2>
        {listen.supported ? (
          <button
            type="button"
            className="text-link"
            onClick={listen.toggle}
            aria-pressed={listen.speaking}
          >
            {listen.speaking ? 'Stop Reading' : 'Read This Page Aloud'}
          </button>
        ) : null}
        <fieldset className="me-textsize">
          <legend>Text Size</legend>
          <div className="me-textsize-choices">
            {textSizes.map((step) => (
              <label key={step} className="me-textsize-choice" data-step={step}>
                <input
                  type="radio"
                  name="me-text-size"
                  value={step}
                  checked={size === step}
                  onChange={() => setUnsaved(!setSize(step))}
                />
                <span aria-hidden="true" className="me-textsize-glyph">
                  A
                </span>
                <span className="me-textsize-name">{textSizeNames[step]}</span>
                {size === step ? <CorridraIcon name="check" /> : null}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="me-switch">
          <span>Less Movement</span>
          <span className="me-switch-state">
            <input
              type="checkbox"
              role="switch"
              checked={movement === 'on'}
              onChange={(event) => setUnsaved(!setMovement(event.target.checked ? 'on' : 'off'))}
            />
            {movement === 'on' ? 'On' : 'Off'}
          </span>
        </label>
        <p className="me-hint">Stops animation and anything that moves by itself.</p>
        {unsaved ? <UnsavedChoiceNote /> : null}
        <p>
          Data Saver <span className="ux-soon-tag">Coming soon</span>
        </p>
      </section>
      <section aria-labelledby="me-link" className="detail-card">
        <h2 id="me-link">Your private link</h2>
        <p>
          The link that opened your tasks is for you alone. Do not share it. If it stops working,
          ask the Corridra team to renew it.
        </p>
        <Link
          className="text-link"
          href={
            '/operator/signin?next=' + encodeURIComponent('/contributor?workspace=' + workspace)
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          Verify your authenticator again (opens a new tab)
        </Link>
        <Link className="text-link" href="/network">
          About assigned work
        </Link>
      </section>
    </>
  );
}
