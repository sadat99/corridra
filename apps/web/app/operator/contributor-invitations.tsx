'use client';
import Link from 'next/link';
import { PhoneFold } from '../../components/phone-fold';
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
    if (!invitationId && (!data?.enabled || !data.countries.length)) {
      setMessage(
        'Your draft is kept. Verify your invitation access, then refresh invitations before submitting.',
      );
      return;
    }
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
    <section className="detail-card ux-network-invitations" aria-label="Contributor invitations">
      <p className="label">01 · INVITE</p>
      <h3>Invite a contributor</h3>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {readError && (
        <div role="alert" className="ux-network-paused">
          <p>{readError}</p>
          <p>
            Invitation access needs an owner or admin and an authenticator check made within the
            last five minutes. You can keep preparing the name and email below. Verify your access,
            then refresh invitations to load your reviewed countries. Your sign-in and permissions
            are separate from this short verification window.
          </p>
          <a className="text-link" href="#workspace-authenticator">
            Verify invitation access
          </a>
        </div>
      )}
      {!data && !readError && <p>Loading contributor invitations…</p>}
      {data?.installed && !data.enabled && (
        <p>
          Invitations are paused in this workspace. You can prepare the fields below, but cannot
          submit until Network is enabled here. Choose an enabled workspace using the Workspace
          selector above. Existing history and pending cancellation remain available.
        </p>
      )}
      <PhoneFold
        fold={!data ? 'off' : !data.installed ? 'always' : !data.enabled ? 'phone' : 'off'}
        summary={
          data && !data.installed
            ? 'Prepare an invitation draft (setup is not installed here)'
            : 'Prepare an invitation draft (sending is paused here)'
        }
        className="ux-invitation-body"
      >
        {data && !data.installed && (
          <p>Contributor invitation setup awaits the protected Network installation.</p>
        )}
        <p>
          Prepare their separate work sign-in. They verify their account email, set a contributor
          password and enroll an authenticator. An invitation grants no team membership or task
          assignment.
        </p>
        <div className="ux-invitation-flow">
          <form className="operator-form" method="post" onSubmit={(event) => void save(event)}>
            <fieldset disabled={busy}>
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
                  disabled={!data?.installed || !data.countries.length}
                >
                  <option value="" disabled>
                    {readError
                      ? 'Verify access to load countries'
                      : !data
                        ? 'Loading reviewed countries…'
                        : 'Select a country'}
                  </option>
                  {data?.countries.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </label>
              <p id="contributor-country-help">
                {data?.installed
                  ? 'Choose within your reviewed country scope. Task eligibility is reviewed separately.'
                  : 'Name and email stay editable. Reviewed countries load after authorized invitation access is confirmed.'}
              </p>
              <button
                className="primary-link"
                disabled={busy || !data?.enabled || !data.countries.length}
              >
                {busy ? 'Saving…' : 'Prepare contributor invitation'}
              </button>
            </fieldset>
          </form>
          <PhoneFold
            summary="What happens after you invite (3 steps)"
            className="ux-invitation-steps"
          >
            <aside className="ux-invitation-guide" aria-label="Contributor onboarding steps">
              <h4>What happens next</h4>
              <ol>
                <li>
                  <strong>Prepare the invitation.</strong>
                  <span>
                    Use the person’s account email and a country within your reviewed scope.
                  </span>
                </li>
                <li>
                  <strong>Share the setup link.</strong>
                  <span>
                    They verify that email, set a separate work password and enroll an
                    authenticator. Corridra does not send an invitation email.
                  </span>
                </li>
                <li>
                  <strong>Review, then assign.</strong>
                  <span>
                    Approve their eligibility before assigning a fully disclosed task. An invitation
                    grants no workspace membership.
                  </span>
                </li>
              </ol>
            </aside>
          </PhoneFold>
        </div>
        {data?.installed && !data.countries.length && (
          <p role="alert">
            No operating country is available in your reviewed scope. Ask your workspace owner to
            review your country access before inviting a contributor.
          </p>
        )}
        <div className="workspace-links ux-invitation-links">
          <button
            className="text-link"
            type="button"
            onClick={() =>
              void copy(
                new URL('/contributor/setup', location.origin).href,
                'Contributor setup link',
              )
            }
          >
            Copy contributor setup link
          </button>
          <button
            className="text-link"
            type="button"
            onClick={() =>
              void copy(
                new URL('/contributor?workspace=' + encodeURIComponent(tenant), location.origin)
                  .href,
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
            <PhoneFold
              summary={`Invitations in this view (${data.invitations.length})`}
              className="ux-invitation-records"
            >
              <h4>Reviewed invitations</h4>
              {!data.invitations.length && <p>No invitations in this view.</p>}
              <div className="ux-invitation-list">
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
                          <input
                            name="reason"
                            required
                            minLength={3}
                            maxLength={500}
                            disabled={busy}
                          />
                        </label>
                        <button className="text-link" disabled={busy}>
                          Cancel pending invitation
                        </button>
                      </form>
                    )}
                  </article>
                ))}
              </div>
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
            </PhoneFold>
          </>
        )}
      </PhoneFold>
    </section>
  );
}
