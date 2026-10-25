'use client';
import { useState, type FormEvent } from 'react';
import {
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

export function NotificationsForm({
  initial,
  unavailable,
}: {
  initial: NotificationPreferences;
  unavailable: boolean;
}) {
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

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const response = await fetch('/api/pulse/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kinds: notificationKinds.filter((kind) => kinds.includes(kind)),
          digest,
          quietStart: quiet ? quietStart : null,
          quietEnd: quiet ? quietEnd : null,
          timeZone,
          language,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Your choices were not saved');
      if (data.saved === false) {
        setFailed(true);
        setMessage('Email is not switched on yet, so nothing was saved.');
      } else setMessage('Saved. These choices apply from now on.');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Your choices were not saved');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="notifications-form" onSubmit={save} noValidate>
      {closed && (
        <p role="note" className="notifications-note">
          Email about your requests is not switched on yet. You can look at the choices, but they
          cannot be saved until it is.
        </p>
      )}
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
        Every email has a link to mute messages about one request. Muting never changes the request
        itself.
      </p>
      <button className="primary-link" type="submit" disabled={busy || closed}>
        Save my choices
      </button>
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    </form>
  );
}
