'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { displayDate } from '@corridra/domain/locale';
import {
  SubmissionFailure,
  submissionMessage,
  useRetainedSubmission,
} from '../../components/retained-submission';
type Cursor = { createdAt: string; id: string };
type Invitation = {
  id: string;
  principalId: string;
  name: string;
  email: string;
  expiresAt: string;
  state: string;
};
type Snapshot = {
  installed: boolean;
  enabled: boolean;
  invitations: Invitation[];
  next: Cursor | null;
  countries: { code: string; name: string }[];
};

export function ContributorInvitations({ tenant }: { tenant: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [previous, setPrevious] = useState<(Cursor | null)[]>([]);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [readError, setReadError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const submit = useRetainedSubmission();
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    const query = new URLSearchParams({ tenant });
    if (cursor) query.set('after', JSON.stringify(cursor));
    fetch('/api/workspace/network-invitations?' + query, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok)
          throw new SubmissionFailure(body.error ?? 'Invitation access is unavailable.', r.status);
        return body as Snapshot;
      })
      .then((snapshot) => {
        if (live) {
          setData(snapshot);
          setReadError('');
        }
      })
      .catch((error) => {
        if (live) {
          setData(null);
          setReadError(error instanceof Error ? error.message : 'Invitations could not be loaded.');
        }
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [tenant, cursor, revision]);
  async function request(action: string, input: unknown) {
    const r = await fetch('/api/workspace/' + action + '?tenant=' + encodeURIComponent(tenant), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await r.json();
    if (!r.ok)
      throw new SubmissionFailure(
        body.error ?? 'Invitation could not be confirmed.',
        r.status,
        r.headers.get('X-Corridra-Request-ID'),
      );
    return body;
  }
  async function save(event: FormEvent<HTMLFormElement>, invitationId?: string) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    const form = event.currentTarget,
      fields = new FormData(form);
    const input = invitationId
      ? {
          action: 'revoke',
          commandId: crypto.randomUUID(),
          invitationId,
          reason: fields.get('reason'),
        }
      : {
          action: 'invite',
          commandId: crypto.randomUUID(),
          name: fields.get('name'),
          email: fields.get('email'),
          operatingCountry: String(fields.get('operatingCountry')).toUpperCase(),
        };
    try {
      const receipt = await submit(form, 'network-invitation', input, request);
      setMessage(
        invitationId
          ? 'Pending invitation cancelled. Its history is retained.'
          : receipt.setupRequired
            ? 'Invitation prepared. Share the contributor setup link with the invited person. Review eligibility before assigning a task.'
            : 'Existing work identity confirmed. Its credentials and memberships were preserved. Review eligibility before assigning a task.',
      );
      form.reset();
      setData(null);
      setCursor(null);
      setPrevious([]);
      setRevision((n) => n + 1);
    } catch (error) {
      setMessage(submissionMessage(error, 'Invitation could not be confirmed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(label + ' copied.');
    } catch {
      setMessage('Copy ' + label.toLowerCase() + ': ' + value);
    }
  }
  return (
    <section className="detail-card" aria-label="Contributor invitations">
      <h3>Invite a contributor</h3>
      <p>
        Prepare their separate work sign-in. They verify their account email, set a contributor
        password and enroll an authenticator. An invitation grants no team membership or task
        assignment.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {readError && <p role="alert">{readError}</p>}
      {!data && !readError && <p>Loading contributor invitations…</p>}
      {data && !data.installed && (
        <p>Contributor invitation setup awaits the protected Network installation.</p>
      )}
      {data?.installed && !data.enabled && (
        <p>
          New invitations are paused. Existing invitation history and pending cancellation remain
          available.
        </p>
      )}
      <form className="operator-form" method="post" onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy || !data?.enabled}>
          <legend>New reviewed invitation</legend>
          <label className="field">
            Contributor name
            <input name="name" required maxLength={80} autoComplete="off" />
          </label>
          <label className="field">
            Contributor email
            <input name="email" type="email" required maxLength={254} autoComplete="off" />
          </label>
          <label className="field">
            Contributor operating country
            <select
              name="operatingCountry"
              required
              defaultValue=""
              aria-describedby="contributor-country-help"
            >
              <option value="" disabled>
                Select a country
              </option>
              {data?.countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          </label>
          <p id="contributor-country-help">
            Choose within your reviewed country scope. Task eligibility is reviewed separately.
          </p>
          <button className="primary-link">
            {busy ? 'Saving…' : 'Prepare contributor invitation'}
          </button>
        </fieldset>
      </form>
      <div className="workspace-links">
        <button
          className="text-link"
          type="button"
          onClick={() =>
            void copy(new URL('/contributor/setup', location.origin).href, 'Contributor setup link')
          }
        >
          Copy contributor setup link
        </button>
        <button
          className="text-link"
          type="button"
          onClick={() =>
            void copy(
              new URL('/contributor?workspace=' + encodeURIComponent(tenant), location.origin).href,
              'Assigned-task link',
            )
          }
        >
          Copy assigned-task link
        </button>
        <Link className="text-link" href="/network">
          Network access and work overview
        </Link>
        <button
          className="text-link"
          type="button"
          disabled={busy}
          onClick={() => {
            setData(null);
            setRevision((n) => n + 1);
          }}
        >
          Refresh invitations
        </button>
      </div>
      {data?.installed && (
        <>
          <h4>Reviewed invitations</h4>
          {!data.invitations.length && <p>No invitations in this view.</p>}
          {data.invitations.map((item) => (
            <article className="detail-card" key={item.id}>
              <h4>{item.name}</h4>
              <p>{item.email}</p>
              <p>
                {item.state.replaceAll('_', ' ')} · Setup cutoff {displayDate(item.expiresAt)}
              </p>
              <button
                className="text-link"
                type="button"
                onClick={() => void copy(item.principalId, 'Contributor reference')}
              >
                Copy contributor reference for eligibility review
              </button>
              {['AWAITING_SETUP', 'EXPIRED'].includes(item.state) && (
                <form
                  className="operator-form"
                  method="post"
                  onSubmit={(event) => void save(event, item.id)}
                >
                  <label className="field">
                    Reason to cancel this pending invitation
                    <input name="reason" required minLength={3} maxLength={500} disabled={busy} />
                  </label>
                  <button className="text-link" disabled={busy}>
                    Cancel pending invitation
                  </button>
                </form>
              )}
            </article>
          ))}
          <nav className="workspace-links" aria-label="Invitation pages">
            <button
              className="text-link"
              disabled={busy || !previous.length}
              onClick={() => {
                setData(null);
                setCursor(previous.at(-1) ?? null);
                setPrevious(previous.slice(0, -1));
              }}
            >
              Previous invitations
            </button>
            <button
              className="text-link"
              disabled={busy || !data.next}
              onClick={() => {
                setData(null);
                setPrevious([...previous, cursor]);
                setCursor(data.next);
              }}
            >
              Next invitations
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
