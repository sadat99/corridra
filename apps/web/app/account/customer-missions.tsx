'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DeliveryView } from '../delivery-view';
export function CustomerMissions() {
  const [missions, setMissions] = useState<{ token: string; label: string }[]>([]),
    [error, setError] = useState('');
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);
  function open(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const form = e.currentTarget;
    const value = String(new FormData(form).get('invitation')).trim();
    try {
      const u = new URL(value, window.location.origin);
      if (
        u.origin !== window.location.origin ||
        u.pathname !== '/client' ||
        !/^#[a-f0-9]{64}$/.test(u.hash)
      )
        throw Error('Use the complete private client link supplied by your operator.');
      const token = u.hash.slice(1);
      if (!missions.some((m) => m.token === token))
        setMissions((m) => [...m, { token, label: `Mission invitation ${m.length + 1}` }]);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the private invitation.');
    }
  }
  return (
    <section className="detail-card ux-account-missions" aria-label="Shared missions">
      <h2>Shared missions</h2>
      <p>
        Missions are shared with you by private invitation. Paste your invitation below to open it.
        An invitation can expire or be withdrawn, and an opened mission clears when you leave or
        sign out.
      </p>
      <form className="operator-form" onSubmit={open}>
        <label className="field">
          Private mission invitation
          <input name="invitation" type="text" autoComplete="off" required maxLength={300} />
        </label>
        <button className="primary-link">Open authorized mission</button>
      </form>
      {error && (
        <p ref={feedback} tabIndex={-1} className="ux-error-summary" role="alert">
          {error}
        </p>
      )}
      {missions.length === 0 && <p>No shared missions opened yet.</p>}
      {missions.map((m) => (
        <article key={m.token}>
          <h3>{m.label}</h3>
          <DeliveryView
            audience="CLIENT_PROGRESS"
            capability={m.token}
            endpoint="/api/customer-missions"
          />
          <button onClick={() => setMissions((v) => v.filter((x) => x.token !== m.token))}>
            Close this mission view
          </button>
        </article>
      ))}
    </section>
  );
}
