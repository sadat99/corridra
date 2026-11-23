'use client';
import { useState } from 'react';
import { usePrivateCapability } from '../../components/private-capability';

const words = {
  ready:
    'You received an introduction by email from the Corridra team. Choose Stop These Emails and we will not email this address again.',
  working: 'Stopping these emails…',
  done: 'Done. We will not email this address again.',
  failed: 'This did not go through. Try again.',
  gone: 'This link does not open. It may be incomplete or replaced. Open the complete link from the email.',
};
/** ADR-090: the opt-out of one emailed introduction. Nothing is sent until the button is chosen. */
export function StopEmails() {
  const token = usePrivateCapability();
  const [state, setState] = useState<'ready' | 'working' | 'done' | 'gone' | 'failed'>('ready');
  const usable = /^[a-f0-9]{64}$/.test(token);
  async function stop() {
    setState('working');
    try {
      const response = await fetch('/api/outreach/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token }),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      setState(response.ok ? 'done' : response.status === 404 ? 'gone' : 'failed');
    } catch {
      setState('failed');
    }
  }
  const message = !usable ? words.gone : words[state];
  return (
    <section className="detail-card buyer-card" aria-label="Stop these emails">
      <p role="status" aria-live="polite">
        {message}
      </p>
      {usable && state !== 'done' && state !== 'gone' && (
        <button className="primary-link" disabled={state === 'working'} onClick={stop}>
          Stop These Emails
        </button>
      )}
    </section>
  );
}
