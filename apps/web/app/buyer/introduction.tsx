'use client';
import { useEffect, useRef, useState } from 'react';
import type { Introduction } from '@corridra/domain/access';
type View = {
  introduction: Introduction;
  template: string;
  expiresAt: string;
  decision: string | null;
  synthetic: boolean;
};
const labels = {
  INTERESTED: 'Interested',
  NEED_INFO: 'Need more information',
  NOT_RELEVANT: 'Not relevant',
} as const;
export function BuyerIntroduction() {
  const [data, setData] = useState<View | null>(null),
    [message, setMessage] = useState('Loading your introduction…'),
    [busy, setBusy] = useState(false),
    [optOut, setOptOut] = useState(false),
    [declined, setDeclined] = useState(false);
  const token = useRef(''),
    requestId = useRef('');
  useEffect(() => {
    let active = true;
    token.current = window.location.hash.slice(1);
    if (!/^[a-f0-9]{64}$/.test(token.current)) {
      Promise.resolve().then(() => {
        if (active)
          setMessage('This private link is unavailable. Open the complete link you received.');
      });
      return;
    }
    fetch('/api/buyer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read', token: token.current }),
      cache: 'no-store',
    })
      .then(async (r) => {
        const value = await r.json();
        if (!r.ok) throw new Error(value.error);
        return value as View;
      })
      .then((v) => {
        if (active) {
          setData(v);
          setMessage('');
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function respond(decision: keyof typeof labels) {
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'respond',
          token: token.current,
          responseId: requestId.current,
          decision,
          optOut,
        }),
        cache: 'no-store',
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      setData((current) => (current ? { ...current, decision: v.decision } : current));
      setMessage('Thank you. Your response has been recorded.');
      if (optOut) setDeclined(true);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Your response could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }
  async function stopContact() {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'optout', token: token.current }),
        cache: 'no-store',
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      setDeclined(true);
      setMessage(
        'Your request has been recorded. Further introductions from this workspace are blocked.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-card buyer-card" aria-label="Private introduction">
      <p role="status" aria-live="polite">
        {message}
      </p>
      {data && (
        <>
          <p className="evidence-label">Invented demonstration. No real outreach.</p>
          <p>{data.template}</p>
          <dl className="buyer-details">
            {(
              [
                ['Company', data.introduction.company],
                ['Country', data.introduction.country],
                ['Relevant capability', data.introduction.capability],
                ['Why there may be a fit', data.introduction.fit],
                ['Evidence highlights', data.introduction.evidence],
                ['What remains unverified', data.introduction.uncertainty],
                ['Purpose of conversation', data.introduction.conversationPurpose],
                ['Available dates', data.introduction.availableDates],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {value}
                  {label === 'Evidence highlights' && (
                    <p className="evidence-label">
                      Operator-reported context. No independent verification is asserted.
                    </p>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {data.decision ? (
            <p>
              Your response: <strong>{labels[data.decision as keyof typeof labels]}</strong>.
              Corridra will use it only to handle this introduction.
            </p>
          ) : (
            <>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={optOut}
                  disabled={busy}
                  onChange={(e) => setOptOut(e.target.checked)}
                />
                Do not send me further introductions from this workspace
              </label>
              <div className="buyer-actions">
                {(Object.keys(labels) as (keyof typeof labels)[]).map((decision) => (
                  <button
                    key={decision}
                    className={decision === 'INTERESTED' ? 'primary-link' : 'secondary-link'}
                    disabled={busy || declined || (optOut && decision === 'INTERESTED')}
                    onClick={() => void respond(decision)}
                  >
                    {labels[decision]}
                  </button>
                ))}
              </div>
            </>
          )}
          {!declined && (
            <button className="text-link" disabled={busy} onClick={() => void stopContact()}>
              Stop further introductions
            </button>
          )}
          <p>You will not be added to a mailing list by responding.</p>
          <p>Private link expires {new Date(data.expiresAt).toLocaleString()}.</p>
        </>
      )}
    </section>
  );
}
