'use client';
import { useEffect, useState } from 'react';
import './email-nudge.css';

// Email about a person's requests is off until they switch it on (ADR-067), so a person who never looked would
// wait for a message that cannot come. This says so once, where they already are, and points at the switch.
// It asks the same endpoint the Email choices page uses, so it shows only when email choices exist, the
// database control is open, the workspace is not a sample and the person has never saved a choice. A person
// who switched email off on purpose is not asked again. "Not now" is remembered in this browser for 14 days.
// The words are English only, as on the Email choices page, so the block says so for assistive technology.
const rememberKey = 'corridra.email-nudge';
const quietMilliseconds = 14 * 24 * 60 * 60 * 1000;

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(rememberKey));
    return at > 0 && Date.now() - at < quietMilliseconds;
  } catch {
    return false;
  }
}

export function EmailNudge() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (recentlyDismissed()) return;
    let live = true;
    fetch('/api/pulse/preferences', { cache: 'no-store', headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((preferences) => {
        if (
          live &&
          preferences &&
          preferences.open === true &&
          preferences.synthetic !== true &&
          preferences.version === 0
        )
          setShow(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(rememberKey, String(Date.now()));
    } catch {
      // Without storage it simply asks again next time.
    }
    setShow(false);
  };
  return (
    <aside className="email-nudge" lang="en" dir="ltr" aria-labelledby="email-nudge-title">
      <h2 id="email-nudge-title">Email is off</h2>
      <p>
        We only email you about your requests if you switch email on. Until you do, nothing is sent,
        so open Your Move to see what is waiting for you.
      </p>
      <div className="email-nudge-actions">
        <a className="primary-link" href="/account/notifications">
          Switch on email
        </a>
        <button type="button" className="text-link" onClick={dismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}
