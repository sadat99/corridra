'use client';
import { useState, type FormEvent } from 'react';
import {
  emailIsOn,
  mailLanguages,
  notificationKinds,
  type NotificationKind,
  type NotificationPreferences,
} from '@corridra/domain/notifications';
import './notifications-form.css';

// The words people read here are plain English. Another language needs a reviewed catalog entry first;
// the page is not offered in any other language until then (ADR-066).
const kindWords: Record<NotificationKind, { label: string; line: string }> = {
  'your-move': { label: 'One thing needs you', line: 'When the team asks you to do something.' },
  update: { label: 'Your request moved forward', line: 'When a request reaches a new step.' },
  countdown: { label: 'A date is coming up', line: 'When a date in your plan is close.' },
  complete: {
    label: 'Your mission is complete',
    line: 'When a mission closes and its report is ready.',
  },
};
const languageWords: Record<string, string> = {
  en: 'English',
  bn: 'Bangla',
  zh: 'Chinese',
  es: 'Spanish',
  ar: 'Arabic',
};
const zones = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

type SavedSettings = Pick<
  NotificationPreferences,
  'digest' | 'quietStart' | 'quietEnd' | 'timeZone' | 'language'
>;

export function NotificationsForm({
  initial,
  unavailable,
}: {
  initial: NotificationPreferences;
  unavailable: boolean;
}) {
  // Email is off until the person switches it on (ADR-067): an empty list of kinds is "off".
  const [savedOn, setSavedOn] = useState(emailIsOn(initial));
  const [on, setOn] = useState(emailIsOn(initial));
  const [kinds, setKinds] = useState<NotificationKind[]>(initial.kinds);
  const [digest, setDigest] = useState(initial.digest);
  const [quiet, setQuiet] = useState(initial.quietStart !== null);
  const [quietStart, setQuietStart] = useState(initial.quietStart ?? '22:00');
  const [quietEnd, setQuietEnd] = useState(initial.quietEnd ?? '07:00');
  const [timeZone, setTimeZone] = useState(
    initial.version === 0
      ? (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
          } catch {
            return 'UTC';
          }
        })()
      : initial.timeZone,
  );
  const [language, setLanguage] = useState(initial.language ?? 'en');
  // The settings the server last accepted. Switching email off sends these, so a half-edited field that is
  // no longer on screen (a cleared quiet-hours time, for one) can never stop a person from turning email off.
  const [lastSaved, setLastSaved] = useState<SavedSettings>({
    digest: initial.digest,
    quietStart: initial.quietStart,
    quietEnd: initial.quietEnd,
    timeZone: initial.timeZone,
    language: initial.language,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  if (unavailable)
    return <p role="status">Email choices are not available just now. Please try again later.</p>;

  const closed = !initial.open;
  const toggle = (kind: NotificationKind) =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    );

  // Switching on with nothing chosen starts from all four messages; the person can untick any.
  const switchTo = (next: boolean) => {
    setOn(next);
    setMessage('');
    setFailed(false);
    if (next && kinds.length === 0) setKinds([...notificationKinds]);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setFailed(false);
    if (on && kinds.length === 0) {
      setFailed(true);
      setMessage('Pick at least one message, or leave email off.');
      return;
    }
    setBusy(true);
    const chosen: SavedSettings = {
      digest,
      quietStart: quiet ? quietStart : null,
      quietEnd: quiet ? quietEnd : null,
      timeZone,
      language,
    };
    try {
      const response = await fetch('/api/pulse/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kinds: on ? notificationKinds.filter((kind) => kinds.includes(kind)) : [],
          ...(on ? chosen : lastSaved),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Your choices were not saved');
      if (data.saved === false) {
        setFailed(true);
        setMessage('Email is not switched on yet, so nothing was saved.');
      } else {
        if (on) setLastSaved(chosen);
        setSavedOn(on);
        setMessage(
          on
            ? 'Email is on. These choices apply from now on.'
            : 'Email is off. We will not email you.',
        );
      }
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Your choices were not saved');
    } finally {
      setBusy(false);
    }
  }

  const buttonWords = on
    ? savedOn
      ? 'Save my choices'
      : 'Switch email on'
    : savedOn
      ? 'Switch email off'
      : '';

  return (
    <form className="notifications-form" onSubmit={save} noValidate>
      {closed && (
        <p role="note" className="notifications-note">
          Email about your requests is not switched on yet. You can look at the choices, but they
          cannot be saved until it is.
        </p>
      )}
      <section
        className="notifications-switch"
        data-state={savedOn ? 'on' : 'off'}
        aria-labelledby="notifications-switch-title"
      >
        <h2 id="notifications-switch-title">
          Email about your requests is <span>{savedOn ? 'on' : 'off'}</span>.
        </h2>
        <p>
          {savedOn
            ? 'We email the verified address on your account when something needs you.'
            : 'We do not email you unless you switch this on. While it is off, nothing is sent to you, so check Your Move to see what is waiting.'}
        </p>
        <label className="notifications-check">
          <input
            type="checkbox"
            checked={on}
            onChange={(event) => switchTo(event.target.checked)}
            disabled={closed}
          />
          <span>
            <strong>Email me when something needs me</strong>
            <span>
              Goes to the verified address on your account. Titles and dates only: never a price, a
              supplier name or a file. Switch it off whenever you like.
            </span>
          </span>
        </label>
      </section>
      {on && (
        <>
          <fieldset>
            <legend>Which messages</legend>
            {notificationKinds.map((kind) => (
              <label key={kind} className="notifications-check">
                <input
                  type="checkbox"
                  checked={kinds.includes(kind)}
                  onChange={() => toggle(kind)}
                  disabled={closed}
                />
                <span>
                  <strong>{kindWords[kind].label}</strong>
                  <span>{kindWords[kind].line}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>How often</legend>
            <label className="notifications-check">
              <input
                type="checkbox"
                checked={digest}
                onChange={(event) => setDigest(event.target.checked)}
                disabled={closed}
              />
              <span>
                <strong>One email a day</strong>
                <span>Gather everything into one message at 08:00 your time.</span>
              </span>
            </label>
            <label className="notifications-check">
              <input
                type="checkbox"
                checked={quiet}
                onChange={(event) => setQuiet(event.target.checked)}
                disabled={closed}
              />
              <span>
                <strong>Quiet hours</strong>
                <span>Hold messages until the quiet hours end. Nothing is lost.</span>
              </span>
            </label>
            {quiet && (
              <div className="notifications-row">
                <label className="field">
                  Quiet from
                  <input
                    type="time"
                    value={quietStart}
                    onChange={(event) => setQuietStart(event.target.value)}
                    disabled={closed}
                  />
                </label>
                <label className="field">
                  Quiet until
                  <input
                    type="time"
                    value={quietEnd}
                    onChange={(event) => setQuietEnd(event.target.value)}
                    disabled={closed}
                  />
                </label>
              </div>
            )}
            <label className="field">
              Your time zone
              <select
                value={timeZone}
                onChange={(event) => setTimeZone(event.target.value)}
                disabled={closed}
              >
                {(zones.includes(timeZone) ? zones : [timeZone, ...zones]).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <fieldset>
            <legend>Language of the email</legend>
            <label className="field">
              Language
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as typeof language)}
                disabled={closed}
              >
                {mailLanguages.map((code) => (
                  <option key={code} value={code}>
                    {languageWords[code]}
                  </option>
                ))}
              </select>
            </label>
            <p className="notifications-help">
              Email is sent in English until a reviewed version exists in the language you pick.
            </p>
          </fieldset>
          <p className="notifications-help">
            Every email has a link to mute messages about one request. Muting never changes the
            request itself.
          </p>
        </>
      )}
      {buttonWords && (
        <button className="primary-link" type="submit" disabled={busy || closed}>
          {buttonWords}
        </button>
      )}
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    </form>
  );
}
