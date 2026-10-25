'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
type Stage = 'reading' | 'ready' | 'incomplete' | 'working' | 'done' | 'refused' | 'failed';

// The token travels in the address fragment, so it never reaches a server log or a Referer. Opening
// the page does nothing: muting needs this button, which stops link scanners from muting by accident.
export function MuteForm({ requestId }: { requestId: string }) {
  const [stage, setStage] = useState<Stage>('reading');
  const [token, setToken] = useState('');
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') ?? '';
    // Keep the token out of the visible address and the history entry once it is read.
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the fragment is browser-only
    setToken(tokenPattern.test(value) ? value : '');
    setStage(tokenPattern.test(value) ? 'ready' : 'incomplete');
  }, []);
  async function mute() {
    setStage('working');
    try {
      const response = await fetch('/api/pulse/mute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, token }),
      });
      setStage(response.ok ? 'done' : response.status === 400 ? 'refused' : 'failed');
    } catch {
      setStage('failed');
    }
  }
  if (stage === 'reading') return <p>Loading…</p>;
  if (stage === 'incomplete')
    return (
      <p role="status">
        This link is incomplete. Open it from the email we sent you, using the Mute this request
        link.
      </p>
    );
  if (stage === 'done')
    return (
      <>
        <p role="status">
          Done. We will not send more messages about this request. Your request itself is unchanged.
        </p>
        <Link className="text-link" href="/account">
          Go to your account
        </Link>
      </>
    );
  return (
    <>
      <p>
        We will stop sending email about this request. Your request stays as it is, and you can
        still see it in your account.
      </p>
      <button className="primary-link" onClick={mute} disabled={stage === 'working'}>
        Mute messages about this request
      </button>
      {stage === 'refused' && <p role="alert">This link is not valid or has expired.</p>}
      {stage === 'failed' && (
        <p role="alert">We could not do that just now. Please try again in a moment.</p>
      )}
    </>
  );
}
