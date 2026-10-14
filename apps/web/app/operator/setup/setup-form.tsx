'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
type Invitation = { available: boolean; role?: string; expiresAt?: string };
export function SetupForm() {
  const [invite, setInvite] = useState<Invitation | null>(null),
    [message, setMessage] = useState('Checking your invitation…'),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/operator-setup', { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error);
        return data as Invitation;
      })
      .then((data) => {
        if (active) {
          setInvite(data);
          setMessage(
            data.available
              ? ''
              : 'There is no current operator invitation for this account. Ask your workspace owner to review access.',
          );
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    if (data.get('password') !== data.get('confirm')) {
      setMessage('The operator passwords must match.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/operator-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: data.get('password') }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      form.reset();
      setDone(true);
      setMessage(
        'Your operator password is ready. Sign in separately and enroll your authenticator before opening the workspace.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Setup failed. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Your operator invitation">
      <p role="status" aria-live="polite">
        {message}
      </p>
      {invite?.available && !done && (
        <form className="operator-form" onSubmit={submit}>
          <h2>Accept {invite.role} access</h2>
          <p>
            Your invitation is for the synthetic workspace. It does not authorize real customer
            operations. Keep your password and authenticator recovery codes private.
          </p>
          <label className="field">
            New operator password
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={14}
              maxLength={128}
              disabled={busy}
            />
          </label>
          <label className="field">
            Confirm operator password
            <input
              type="password"
              name="confirm"
              autoComplete="new-password"
              required
              minLength={14}
              maxLength={128}
              disabled={busy}
            />
          </label>
          <button className="primary-link" disabled={busy}>
            {busy ? 'Setting up…' : 'Set operator password'}
          </button>
        </form>
      )}
      {done && (
        <Link className="primary-link" href="/operator/signin">
          Sign in and set up authenticator
        </Link>
      )}
    </section>
  );
}
