'use client';
import Link from 'next/link';
import { AccessState } from '../../../components/access-state';
import { displayDate } from '@corridra/domain/locale';
import { useEffect, useRef, useState, type FormEvent } from 'react';
type Invitation = { available: boolean; role?: string; expiresAt?: string; workspaceId?: string };
export function SetupForm({ kind = 'operator' }: { kind?: 'operator' | 'contributor' }) {
  const contributor = kind === 'contributor';
  const inFlight = useRef(false);
  const [failure, setFailure] = useState<'denied' | 'unavailable'>('denied');
  const [invite, setInvite] = useState<Invitation | null>(null),
    [message, setMessage] = useState('Checking your invitation…'),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    fetch('/api/operator-setup' + (kind === 'contributor' ? '?kind=contributor' : ''), {
      cache: 'no-store',
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Object.assign(Error(data.error), { status: r.status });
        return data as Invitation;
      })
      .then((data) => {
        if (active) {
          setInvite(data);
          setFailure('denied');
          setMessage(
            data.available
              ? ''
              : `There is no current ${kind} invitation for this account. Ask your workspace owner to review access.`,
          );
        }
      })
      .catch((e) => {
        if (active) {
          setFailure([401, 403].includes(e.status) ? 'denied' : 'unavailable');
          setMessage(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, kind]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget,
      data = new FormData(form);
    if (data.get('password') !== data.get('confirm')) {
      setMessage(`The ${kind} passwords must match.`);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/operator-setup' + (contributor ? '?kind=contributor' : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: data.get('password') }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      form.reset();
      setDone(true);
      setMessage(
        contributor
          ? 'Your contributor password is ready. Sign in separately and enroll your authenticator. Reviewed eligibility and a task assignment are still required.'
          : 'Your operator password is ready. Sign in separately and enroll your authenticator before opening the workspace.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Setup failed. Try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label={`Your ${kind} invitation`}>
      {message && (
        <AccessState
          kind={
            done
              ? 'complete'
              : invite?.available
                ? 'unknown'
                : message === 'Checking your invitation…'
                  ? 'loading'
                  : failure
          }
        >
          <p>{message}</p>
        </AccessState>
      )}
      {!invite?.available && !done && message !== 'Checking your invitation…' && (
        <button
          type="button"
          className="text-link"
          onClick={() => {
            setMessage('Checking your invitation…');
            setAttempt((value) => value + 1);
          }}
        >
          Check invitation again
        </button>
      )}
      {invite?.available && !done && (invite.role === 'contributor') !== contributor && (
        <p>
          This invitation uses a different access route.{' '}
          <Link href={invite.role === 'contributor' ? '/contributor/setup' : '/operator/setup'}>
            Open the invited setup route
          </Link>
          .
        </p>
      )}
      {invite?.available && !done && (invite.role === 'contributor') === contributor && (
        <form method="post" className="operator-form" onSubmit={submit}>
          <h2>Accept {invite.role} access</h2>
          {invite.expiresAt && <p>Invitation expires {displayDate(invite.expiresAt)}</p>}
          <p>
            {contributor
              ? 'This invitation grants no team membership or full mission access. Only reviewed, explicitly assigned tasks can become available. Keep your password and authenticator recovery codes private.'
              : 'Your invitation is for the synthetic workspace. It does not authorize real customer operations. Keep your password and authenticator recovery codes private.'}
          </p>
          <label className="field">
            New {kind} password
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
            Confirm {kind} password
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
            {busy ? 'Setting up…' : `Set ${kind} password`}
          </button>
        </form>
      )}
      {/* Full page load: drops cached workspace; Next 16.4.3 doubles a # on soft return. */}
      {done && (
        <a
          className="primary-link"
          href={
            contributor && invite?.workspaceId
              ? '/operator/signin?next=' +
                encodeURIComponent('/contributor?workspace=' + invite.workspaceId)
              : '/operator/signin'
          }
        >
          Sign in and set up authenticator
        </a>
      )}
    </section>
  );
}
