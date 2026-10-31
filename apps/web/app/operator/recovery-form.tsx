'use client';
import Link from 'next/link';
import { operatorSignInPage } from '../../lib/workspace-navigation';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { identityClient } from '@corridra/auth/client';

export function OperatorRecoveryForm({ mode }: { mode: 'request' | 'reset' }) {
  const query = useSearchParams();
  const [token, setToken] = useState(() => {
    const candidate = query.get('token') ?? '';
    return mode === 'reset' && /^[A-Za-z0-9]{24}$/.test(candidate) ? candidate : '';
  });
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const alert = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (mode !== 'reset') return;
    // Keep the one-time secret only in this page's memory, never in referrers or history.
    window.history.replaceState(null, '', window.location.pathname);
  }, [mode]);
  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || done || (mode === 'reset' && !token)) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setError('');
    if (mode === 'reset' && data.get('password') !== data.get('confirm')) {
      setError('The operator passwords must match.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const result =
        mode === 'request'
          ? await identityClient.requestPasswordReset({
              email: String(data.get('email')),
              redirectTo: `${window.location.origin}/operator/reset-password`,
            })
          : await identityClient.resetPassword({
              token,
              newPassword: String(data.get('password')),
            });
      if (result.error)
        throw new Error(
          'Recovery could not be completed. Try again, or request a new link if this one expired.',
        );
      form.reset();
      setToken('');
      setDone(true);
    } catch {
      setError(
        'Recovery could not be completed. Try again, or request a new link if this one expired.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (done)
    return (
      <div role="status">
        <p>
          {mode === 'request'
            ? 'If this address has an active operator account, you will receive an operator password reset email. Check spam too. A pending invitation needs setup instead.'
            : 'Your operator password has changed. Previous operator sessions have been signed out. Sign in with your new password and existing authenticator.'}
        </p>
        <a className="primary-link" href={operatorSignInPage}>
          Return to operator sign-in
        </a>
        {mode === 'request' && (
          <Link className="text-link" href="/operator/setup">
            Finish a pending invitation
          </Link>
        )}
      </div>
    );
  if (mode === 'reset' && !token)
    return (
      <div role="alert">
        <p>
          This operator reset link is incomplete or invalid. Request a new link and open it in your
          browser.
        </p>
        <Link className="primary-link" href="/operator/forgot-password">
          Request a new operator reset link
        </Link>
      </div>
    );
  return (
    <form
      method="post"
      className="operator-form"
      aria-label="Operator password recovery"
      onSubmit={submit}
    >
      {mode === 'request' ? (
        <label className="field">
          Operator email
          <input name="email" type="email" autoComplete="username" required disabled={busy} />
        </label>
      ) : (
        <>
          <p>
            Use 14 to 128 characters. Your existing authenticator and workspace permissions stay in
            place.
          </p>
          <label className="field">
            New operator password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={14}
              maxLength={128}
              required
              disabled={busy}
            />
          </label>
          <label className="field">
            Confirm operator password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={14}
              maxLength={128}
              required
              disabled={busy}
            />
          </label>
        </>
      )}
      {error && (
        <p role="alert" tabIndex={-1} ref={alert} className="field-error">
          {error}
        </p>
      )}
      <button className="primary-link" disabled={busy}>
        {busy
          ? 'Please wait…'
          : mode === 'request'
            ? 'Request operator reset email'
            : 'Set new operator password'}
      </button>
    </form>
  );
}
