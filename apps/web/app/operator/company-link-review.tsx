'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { displayDate } from '@corridra/domain/locale';
import {
  hiddenText,
  isHidden,
  staffDecisions,
  staffOutcomeSchema,
  staffQueueSchema,
  staffReviewSchema,
} from '../../lib/organisation-link-replies';
type Queue = z.infer<typeof staffQueueSchema>;
type Review = z.infer<typeof staffReviewSchema>;
type Decision = (typeof staffDecisions)[number];
type Pending = {
  commandId: string;
  claimId: string;
  expectedVersion: number;
  decision: Decision;
  reason: string;
  internalNote: string | null;
  organisationId: string | null;
  shareConfirmed: boolean;
};
const decisionLabel: Record<Decision, string> = {
  approve: 'Approve and link to a company on the list',
  approve_creation: 'Approve adding this company (create the record, then link)',
  request_evidence: 'Ask for more evidence',
  reject: 'Reject',
  revoke: 'End the current link',
};
const reasonLabel: Record<string, string> = {
  name_country: 'same name and country',
  website_host: 'same website host',
  chosen_by_customer: 'chosen by the customer',
  same_organisation: 'asks for the same company',
};
const stateLabel: Record<string, string> = {
  pending: 'Waiting for review',
  needs_evidence: 'Waiting for the customer',
  creation_approved: 'Approved for creation',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ended: 'Link ended',
};
type Props = { tenant: string };
export function CompanyLinkReview(props: Props) {
  return <Reviewer key={props.tenant} {...props} />;
}
function Reviewer({ tenant }: Props) {
  const [queue, setQueue] = useState<Queue | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [scope, setScope] = useState<'open' | 'closed'>('open'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [decision, setDecision] = useState<Decision | ''>(''),
    [organisationId, setOrganisationId] = useState(''),
    [pending, setPending] = useState<Pending | null>(null);
  const controller = useRef<AbortController | null>(null);
  const endpoint =
    '/api/workspace/customer-organisation-links?tenant=' + encodeURIComponent(tenant);
  useEffect(() => {
    const clear = () => {
      controller.current?.abort();
      setQueue(null);
      setReview(null);
      setPending(null);
      setBusy(false);
      setMessage('Customer details cleared. Load the requests again.');
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') clear();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', clear);
    return () => {
      controller.current?.abort();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', clear);
    };
  }, []);
  useEffect(() => {
    if (!review && !queue) return;
    const timer = setTimeout(() => {
      controller.current?.abort();
      setQueue(null);
      setReview(null);
      setPending(null);
      setBusy(false);
      setMessage('Review expired. Load the requests again before deciding.');
    }, 60000);
    return () => clearTimeout(timer);
  }, [review, queue]);
  function failureText(status: number) {
    return status === 503
      ? 'Company link review is unavailable.'
      : status === 401
        ? 'Verify your authenticator again, then reload.'
        : status === 403
          ? 'Reviewer access in the intake workspace is required.'
          : status === 409
            ? 'The request changed or conflicts with a recorded decision. Reload the requests.'
            : 'The request could not be completed.';
  }
  async function loadQueue(next: 'open' | 'closed' = scope) {
    if (busy) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setQueue(null);
    setReview(null);
    setPending(null);
    setMessage('');
    try {
      const r = await fetch(endpoint + '&scope=' + next, {
        cache: 'no-store',
        signal: task.signal,
      });
      if (!r.ok) throw Error(failureText(r.status));
      const v = staffQueueSchema.parse(await r.json());
      if (v.scope !== next) throw Error('The list changed. Reload.');
      if (!task.signal.aborted) {
        setQueue(v);
        if (v.items.length === 0) setMessage('No requests to show.');
      }
    } catch (e) {
      if (!task.signal.aborted)
        setMessage(e instanceof Error ? e.message : 'The list could not be loaded.');
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  async function loadMore() {
    if (busy || !queue?.nextAfter) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch(
        endpoint + '&scope=' + queue.scope + '&after=' + encodeURIComponent(queue.nextAfter),
        { cache: 'no-store', signal: task.signal },
      );
      if (!r.ok) throw Error(failureText(r.status));
      const v = staffQueueSchema.parse(await r.json());
      if (v.scope !== queue.scope) throw Error('The list changed. Reload.');
      if (!task.signal.aborted) setQueue({ ...v, items: [...queue.items, ...v.items] });
    } catch (e) {
      if (!task.signal.aborted)
        setMessage(e instanceof Error ? e.message : 'The list could not be loaded.');
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  async function open(claimId: string) {
    if (busy) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setPending(null);
    setDecision('');
    setOrganisationId('');
    setMessage('');
    try {
      const r = await fetch(endpoint + '&claim=' + encodeURIComponent(claimId), {
        cache: 'no-store',
        signal: task.signal,
      });
      if (!r.ok) throw Error(failureText(r.status));
      const v = staffReviewSchema.parse(await r.json());
      if (v.claimId !== claimId) throw Error('The request changed. Reload.');
      if (!task.signal.aborted) {
        setReview(v);
        setDecision(v.decisions[0] ?? '');
        setOrganisationId(v.chosenOrganisation?.id ?? v.candidates.organisations[0]?.id ?? '');
      }
    } catch (e) {
      if (!task.signal.aborted)
        setMessage(e instanceof Error ? e.message : 'The request could not be loaded.');
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !review || !decision) return;
    const form = new FormData(e.currentTarget);
    const chosen = review.candidates.organisations.find((o) => o.id === organisationId);
    const value: Pending = pending ?? {
      commandId: crypto.randomUUID(),
      claimId: review.claimId,
      expectedVersion: review.version,
      decision,
      reason: String(form.get('reason') ?? '').trim(),
      internalNote: String(form.get('internalNote') ?? '').trim() || null,
      organisationId: decision === 'approve' ? organisationId || null : null,
      shareConfirmed:
        decision === 'approve' &&
        !!chosen &&
        chosen.linkedWorkspaces > 0 &&
        form.get('share') === 'on',
    };
    setPending(value);
    setBusy(true);
    setMessage('');
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        signal: task.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!r.ok) {
        if (r.status === 409) setPending(null);
        throw Error(failureText(r.status));
      }
      const outcome = staffOutcomeSchema.parse(await r.json());
      if (outcome.commandId !== value.commandId) throw Error('The receipt did not match. Reload.');
      if (!task.signal.aborted) {
        setReview(null);
        setPending(null);
        setQueue(null);
        setMessage(
          'Decision recorded: ' +
            (stateLabel[outcome.state] ?? outcome.state) +
            '. Nothing was sent to the customer; they see it in their account.',
        );
      }
    } catch (error) {
      if (!task.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : 'The decision was not confirmed. Retry the same decision.',
        );
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  const chosen = review?.candidates.organisations.find((o) => o.id === organisationId);
  return (
    <details className="ux-mission-detail" style={{ overflowWrap: 'anywhere' }}>
      <summary>Customer company link requests</summary>
      <p>
        Review a customer&apos;s request to link their workspace to a company on the list. A link
        records that staff checked the evidence the customer wrote. It does not verify a person, and
        customer text is never copied into the company list. This needs reviewer access in the
        intake workspace and a fresh authenticator check.
      </p>
      <label className="field">
        Show
        <select
          value={scope}
          disabled={busy}
          onChange={(e) => setScope(e.target.value as 'open' | 'closed')}
        >
          <option value="open">Open requests</option>
          <option value="closed">Decided requests</option>
        </select>
      </label>
      <button className="text-link" type="button" disabled={busy} onClick={() => void loadQueue()}>
        Load Company Link Requests
      </button>
      {message && <p role="status">{message}</p>}
      {queue && queue.items.length > 0 && !review && (
        <ul>
          {queue.items.map((i) => (
            <li key={i.claimId}>
              <strong>{i.legalName}</strong> ({i.country}) · {i.workspaceName} ·{' '}
              {stateLabel[i.state] ?? i.state} ·{' '}
              {i.kind === 'EXISTING' ? 'asks to match a listed company' : 'proposes a new company'}{' '}
              · {i.evidenceCount} evidence · {i.candidateCount} possible match
              {i.candidateCount === 1 ? '' : 'es'} · sent {displayDate(i.filedAt)}{' '}
              <button
                className="text-link"
                type="button"
                disabled={busy}
                onClick={() => void open(i.claimId)}
              >
                Review {isHidden(i.legalName) ? 'request' : i.legalName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {queue?.nextAfter && !review && (
        <button className="text-link" type="button" disabled={busy} onClick={() => void loadMore()}>
          Show More Requests
        </button>
      )}
      {review && (
        <section
          aria-label={
            'Review of ' +
            (isHidden(review.profile.legalName) ? 'request' : review.profile.legalName)
          }
        >
          <h3>{review.profile.legalName}</h3>
          <p>
            {stateLabel[review.state] ?? review.state} · {review.workspaceName} · request version{' '}
            {review.version}
          </p>
          <dl>
            <dt>Country</dt>
            <dd>{review.profile.countryCode}</dd>
            <dt>Website</dt>
            <dd>{review.profile.website ?? 'Not provided'}</dd>
            <dt>Roles and size</dt>
            <dd>
              {review.profile.commercialRoles.join(', ')} · {review.profile.sizeBand} people
            </dd>
            <dt>About</dt>
            <dd>{review.profile.summary}</dd>
            <dt>Profile version</dt>
            <dd>
              {review.profile.version}
              {review.profile.currentVersion > review.profile.version
                ? ' (the customer has edited it since)'
                : ''}
            </dd>
            <dt>Request</dt>
            <dd>
              {review.kind === 'EXISTING'
                ? 'Match to ' +
                  (review.chosenOrganisation
                    ? review.chosenOrganisation.name +
                      ' (' +
                      review.chosenOrganisation.country +
                      ')'
                    : 'a listed company')
                : 'Propose a new company record'}
            </dd>
            <dt>Customer note</dt>
            <dd>{review.note}</dd>
          </dl>
          {review.activeLink && (
            <p>
              This workspace is currently linked to {review.activeLink.organisation.name} (
              {review.activeLink.organisation.country}). Approving a different company replaces that
              link and keeps the history.
            </p>
          )}
          <h4>Evidence from the customer ({review.evidence.length})</h4>
          {review.evidence.length === 0 ? (
            <p>No evidence added.</p>
          ) : (
            <ul>
              {review.evidence.map((v) => (
                <li key={v.id}>
                  {isHidden(v.statement)
                    ? hiddenText
                    : v.kind.replaceAll('_', ' ').toLowerCase() +
                      ': ' +
                      v.statement +
                      (v.url ? ' (' + v.url + ')' : '')}
                </li>
              ))}
            </ul>
          )}
          <h4>Possible matches</h4>
          <p>Only staff see this. Customers are never told about other workspaces.</p>
          {review.candidates.organisations.length === 0 &&
            review.candidates.workspaces.length === 0 && <p>No match found.</p>}
          {review.candidates.organisations.length > 0 && (
            <ul aria-label="Matching companies on the list">
              {review.candidates.organisations.map((o) => (
                <li key={o.id}>
                  {o.name} ({o.country}) · {o.reasons.map((r) => reasonLabel[r] ?? r).join(', ')}
                  {o.linkedWorkspaces > 0
                    ? ` · already linked to ${o.linkedWorkspaces} other workspace${o.linkedWorkspaces === 1 ? '' : 's'}`
                    : ''}
                </li>
              ))}
            </ul>
          )}
          {review.candidates.workspaces.length > 0 && (
            <ul aria-label="Other workspaces with a similar request">
              {review.candidates.workspaces.map((w) => (
                <li key={w.claimId}>
                  Another workspace: {w.legalName} ({w.country}) · {stateLabel[w.state] ?? w.state}{' '}
                  · {w.reasons.map((r) => reasonLabel[r] ?? r).join(', ')}
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary>History</summary>
            <ol>
              {review.history.map((h) => (
                <li key={h.seq}>
                  {displayDate(h.at)}: {h.kind.replaceAll('_', ' ')} by{' '}
                  {h.by === 'staff' ? (h.byYou ? 'you' : 'staff') : 'the customer'}
                  {h.reason ? ' - ' + h.reason : ''}
                  {h.internalNote && !(isHidden(h.internalNote) && isHidden(h.reason))
                    ? isHidden(h.internalNote)
                      ? ' - ' + h.internalNote
                      : ' (staff only: ' + h.internalNote + ')'
                    : ''}
                </li>
              ))}
            </ol>
          </details>
          {review.decisions.length === 0 ? (
            <p>This request is closed. No further decision is possible.</p>
          ) : (
            <form onSubmit={(e) => void submit(e)}>
              <fieldset disabled={busy || !!pending}>
                <legend>Decide</legend>
                <label className="field">
                  Decision
                  <select
                    value={decision}
                    onChange={(e) => setDecision(e.target.value as Decision)}
                  >
                    {review.decisions.map((d) => (
                      <option key={d} value={d}>
                        {decisionLabel[d]}
                      </option>
                    ))}
                  </select>
                </label>
                {decision === 'approve' && (
                  <>
                    <label className="field">
                      Company on the list
                      <select
                        value={organisationId}
                        required
                        onChange={(e) => setOrganisationId(e.target.value)}
                      >
                        <option value="">Choose a company</option>
                        {review.candidates.organisations.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} ({o.country})
                          </option>
                        ))}
                      </select>
                    </label>
                    {review.candidates.organisations.length === 0 && (
                      <p>
                        No company on the list matches. Use Approve adding this company, create the
                        record in Companies and research, then come back to link it.
                      </p>
                    )}
                    {chosen && chosen.linkedWorkspaces > 0 && (
                      <label className="check-field">
                        <input type="checkbox" name="share" required />I confirm both workspaces may
                        be linked to this one company. Neither will see the other. Otherwise reject
                        this request as conflicting.
                      </label>
                    )}
                  </>
                )}
                <label className="field">
                  Reason the customer will read
                  <textarea name="reason" minLength={3} maxLength={1000} required />
                </label>
                <label className="field">
                  Internal note (staff only, optional)
                  <textarea name="internalNote" minLength={3} maxLength={1000} />
                </label>
              </fieldset>
              <button className="primary-link" type="submit" disabled={busy || !decision}>
                {pending ? 'Retry the Same Decision' : 'Record Decision'}
              </button>
            </form>
          )}
          <button
            className="text-link"
            type="button"
            disabled={busy}
            onClick={() => {
              setReview(null);
              setPending(null);
            }}
          >
            Back to the List
          </button>
        </section>
      )}
    </details>
  );
}
