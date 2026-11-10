'use client';
// The settings a field helper uses in one place. Language, reading aloud, text size (three steps), Stronger Colours
// and Less Movement are real; the last three are kept in this browser only. A switch whose effect the device already
// asks for reads On and does nothing. Corridra keeps data use low for everyone (W10, owner decision: the site icon is
// cached and no link prefetches), so there is no Data Saver switch and the card says so in one plain line. The
// private link note describes the invitation link only in words that are true of any link: it is for one person and
// the Corridra team renews it. Owner: S4, W7, W10.
import './helper-me.css';
import { useId } from 'react';
import Link from 'next/link';
import { LanguageSwitcher } from '../../../components/language-switcher';
import { CorridraIcon } from '../../../components/corridra-icon';
import { textSizeNames, UnsavedChoiceNote } from '../../../components/ux/comfort-controls';
import {
  useContrast,
  useLessMovement,
  useSystemSetting,
  useTextSize,
} from '../../../components/ux/use-comfort';
import { useListen } from '../../../components/ux/utility-menus';
import { systemContrastQuery, systemReducedMotionQuery, textSizes } from '../../../lib/ux/comfort';

/**
 * A comfort switch with its hint. Named by its words alone and described by the hint, so the On or Off beside it is not
 * read twice. When the device already asks for the effect it reads On, is announced as unavailable (still focusable)
 * and the hint says why; a change does nothing and nothing is saved.
 */
function MeSwitch({
  label,
  hint,
  hintBySystem,
  on,
  bySystem,
  onChange,
}: {
  label: string;
  hint: string;
  hintBySystem: string;
  on: boolean;
  bySystem: boolean;
  onChange: (on: boolean) => void;
}) {
  const labelId = useId();
  const hintId = useId();
  const shownOn = on || bySystem;
  return (
    <>
      <label className="me-switch">
        <span id={labelId}>{label}</span>
        <span className="me-switch-state">
          <input
            type="checkbox"
            role="switch"
            aria-labelledby={labelId}
            aria-describedby={hintId}
            aria-disabled={bySystem || undefined}
            checked={shownOn}
            onChange={(event) => {
              if (!bySystem) onChange(event.target.checked);
            }}
          />
          {shownOn ? 'On' : 'Off'}
        </span>
      </label>
      <p id={hintId} className="me-hint">
        {bySystem ? hintBySystem : hint}
      </p>
    </>
  );
}

export function HelperMe({ workspace }: { workspace: string }) {
  const listen = useListen();
  const [size, setSize] = useTextSize();
  const [contrast, setContrast] = useContrast();
  const [movement, setMovement] = useLessMovement();
  const systemContrast = useSystemSetting(systemContrastQuery);
  const systemReducedMotion = useSystemSetting(systemReducedMotionQuery);
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
                  onChange={() => setSize(step)}
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
        <MeSwitch
          label="Stronger Colours"
          hint="Darker text, clearer lines and underlined links."
          hintBySystem="Your device already asks for stronger colours, so this stays On."
          on={contrast === 'more'}
          bySystem={systemContrast}
          onChange={(on) => setContrast(on ? 'more' : 'normal')}
        />
        <MeSwitch
          label="Less Movement"
          hint="Stops animation and anything that moves by itself."
          hintBySystem="Your device already reduces motion, so this stays On."
          on={movement === 'on'}
          bySystem={systemReducedMotion}
          onChange={(on) => setMovement(on ? 'on' : 'off')}
        />
        <UnsavedChoiceNote className="me-status" />
        <p className="me-data-use">Corridra already keeps data use low.</p>
      </section>
      <section aria-labelledby="me-link" className="detail-card">
        <h2 id="me-link">Your private link</h2>
        <p>
          The link that opened your tasks is for you alone. Do not share it. If it stops working,
          ask the Corridra team to renew it.
        </p>
        <Link
          prefetch={false}
          className="text-link"
          href={
            '/operator/signin?next=' + encodeURIComponent('/contributor?workspace=' + workspace)
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          Verify your authenticator again (opens a new tab)
        </Link>
        <Link prefetch={false} className="text-link" href="/network">
          About assigned work
        </Link>
      </section>
    </>
  );
}
