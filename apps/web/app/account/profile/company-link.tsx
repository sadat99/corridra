'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { linkStatusText, type LinkStatus } from '../company-link-status';

const evidenceKinds = [
  ['REGISTRATION_STATEMENT', 'Registration statement'],
  ['WEBSITE_STATEMENT', 'Website statement'],
  ['TRADE_REFERENCE_STATEMENT', 'Trade reference statement'],
  ['AUTHORISATION_STATEMENT', 'Authorisation statement'],
] as const;
const evidenceLimit = 8;
type Organisation = { name: string; country: string };
type Claim = {
  state: 'pending' | 'needs_evidence' | 'rejected';
  awaitingCreation: boolean;
  kind: 'EXISTING' | 'PROPOSED_NEW';
  filedAt: string;
  profileVersion: number;
  profileChanged: boolean;
  id?: string;
  version?: number;
  note?: string;
  evidenceCount?: number;
  evidence?: { id: string; kind: string; statement: string; url: string | null }[];
  history?: { seq: number; kind: string; at: string; by: string; reason: string | null }[];
  decision?: { kind: string; reason: string; at: string } | null;
  target?: Organisation | null;
  canAddEvidence?: boolean;
  canWithdraw?: boolean;
};
type View = {
  workspaceId: string;
  expiresAt: string;
  canEdit: boolean;
  commandId?: string;
  status: LinkStatus;
  currentProfileVersion: number;
  canFile: boolean;
  link: null | {
    organisation: Organisation;
    linkedAt: string;
    reviewedProfileVersion: number;
    profileChanged: boolean;
    label: string;
    reason?: string | null;
  };
  claim: Claim | null;
};
type Found = { id: string; name: string; country: string };
const statuses = ['none', 'pending', 'needs_evidence', 'approved', 'rejected'];
function parseView(value: unknown, workspaceId: string): View {
  const v = value as View;
  if (
    !v ||
    v.workspaceId !== workspaceId ||
    !statuses.includes(v.status) ||
    typeof v.canEdit !== 'boolean' ||
    typeof v.canFile !== 'boolean' ||
    !Number.isInteger(v.currentProfileVersion) ||
    !Number.isFinite(Date.parse(v.expiresAt)) ||
    Date.parse(v.expiresAt) <= Date.now() ||
    Date.parse(v.expiresAt) > Date.now() + 65000 ||
    (v.claim !== null && typeof v.claim !== 'object') ||
    (v.link !== null &&
      (typeof v.link !== 'object' || typeof v.link.organisation?.name !== 'string'))
  )
    throw Error('Invalid company link');
  return v;
}
const day = (value: string) => new Date(value).toISOString().slice(0, 10);

export function CompanyLink(props: { subject: string; issuer: string; workspaceId: string }) {
  const { subject, issuer, workspaceId } = props;
  const id = useId(),
    [view, setView] = useState<View | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{ text: string; error: boolean } | null>(null),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [kind, setKind] = useState<'EXISTING' | 'PROPOSED_NEW'>('EXISTING'),
    [term, setTerm] = useState(''),
    [found, setFound] = useState<Found[] | null>(null),
    [chosen, setChosen] = useState(''),
    [note, setNote] = useState(''),
    [evKind, setEvKind] = useState<string>(evidenceKinds[0][0]),
    [statement, setStatement] = useState(''),
    [url, setUrl] = useState(''),
    [confirmWithdraw, setConfirmWithdraw] = useState(false),
    [changing, setChanging] = useState(false);
  const active = useRef(false),
    task = useRef<AbortController | null>(null),
    flight = useRef(false),
    feedback = useRef<HTMLParagraphElement>(null);
  const headers = useCallback(
    (extra?: Record<string, string>) => ({
      'x-corridra-customer-subject': subject,
      'x-corridra-customer-issuer': issuer,
      ...extra,
    }),
    [subject, issuer],
  );
  const clear = useCallback((why: string) => {
    task.current?.abort();
    flight.current = false;
    setBusy(false);
    setLoading(false);
    setView(null);
    setPending(null);
    setFound(null);
    setConfirmWithdraw(false);
    setMessage({ text: why, error: true });
  }, []);
  const send = useCallback(
    async (body?: Record<string, unknown>) => {
      if (flight.current) return;
      flight.current = true;
      setBusy(true);
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const r = await fetch(
          '/api/customer-organisation-links' +
            (body ? '' : '?' + new URLSearchParams({ workspaceId })),
          {
            method: body ? 'POST' : 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: headers(body ? { 'content-type': 'application/json' } : undefined),
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: controller.signal,
          },
        );
        if (!active.current || controller.signal.aborted) return;
        if ([401, 403].includes(r.status)) {
          clear('Access to this company link changed. Local details were cleared.');
          return;
        }
        if (r.status === 503) {
          clear('Company links are not available right now.');
          return;
        }
        if (r.status === 409) {
          setPending(null);
          setMessage({
            text: 'This request changed or the profile was edited. The latest details are loaded; check them and try again.',
            error: true,
          });
          const again = await fetch(
            '/api/customer-organisation-links?' + new URLSearchParams({ workspaceId }),
            {
              credentials: 'same-origin',
              cache: 'no-store',
              headers: headers(),
              signal: controller.signal,
            },
          );
          if (again.ok && active.current && !controller.signal.aborted)
            setView(parseView(await again.json(), workspaceId));
          return;
        }
        if (r.status === 400) {
          setPending(null);
          setMessage({
            text: 'Check the text and the example, test or invalid website host, then try again.',
            error: true,
          });
          return;
        }
        if (!r.ok) throw Error('Company link request failed');
        const v = parseView(await r.json(), workspaceId);
        if (body && v.commandId !== body.commandId) throw Error('Acknowledgement did not match');
        if (active.current && !controller.signal.aborted) {
          setView(v);
          setPending(null);
          if (body) {
            setMessage({ text: 'Saved.', error: false });
            setNote('');
            setStatement('');
            setUrl('');
            setFound(null);
            setChosen('');
            setConfirmWithdraw(false);
            setChanging(false);
          } else setMessage(null);
        }
      } catch {
        if (active.current)
          setMessage({
            text: body
              ? 'The change could not be confirmed. Retry the same request.'
              : 'The company link could not be loaded. Try again.',
            error: true,
          });
      } finally {
        clearTimeout(timeout);
        if (active.current) {
          flight.current = false;
          setBusy(false);
          setLoading(false);
        }
      }
    },
    [workspaceId, headers, clear],
  );
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void send();
    });
    const hide = () => {
      if (document.visibilityState === 'hidden')
        clear('Details cleared while away. Reload to check access.');
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      active.current = false;
      task.current?.abort();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [send, clear]);
  useEffect(() => {
    if (!view) return;
    const timer = setTimeout(
      () => clear('Access must be checked again. Reload the company link.'),
      Math.max(0, Date.parse(view.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [view, clear]);
  useEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);
  async function search() {
    if (busy || term.trim().length < 3) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch(
        '/api/customer-organisation-links?' +
          new URLSearchParams({ scope: 'search', workspaceId, q: term.trim() }),
        { credentials: 'same-origin', cache: 'no-store', headers: headers() },
      );
      if (!r.ok) throw Error('search');
      const body = (await r.json()) as { workspaceId: string; organisations: Found[] };
      if (body.workspaceId !== workspaceId || !Array.isArray(body.organisations))
        throw Error('search');
      setFound(body.organisations);
      setChosen('');
    } catch {
      setMessage({ text: 'The company list could not be searched. Try again.', error: true });
    } finally {
      setBusy(false);
    }
  }
  function file() {
    if (!view || busy) return;
    const body =
      pending?.action === 'file'
        ? pending
        : {
            action: 'file',
            commandId: crypto.randomUUID(),
            workspaceId,
            expectedProfileVersion: view.currentProfileVersion,
            kind,
            organisationId: kind === 'EXISTING' ? chosen : null,
            note: note.trim(),
          };
    setPending(body);
    void send(body);
  }
  function addEvidence() {
    const claim = view?.claim;
    if (!claim?.id || busy) return;
    const body =
      pending?.action === 'add_evidence'
        ? pending
        : {
            action: 'add_evidence',
            commandId: crypto.randomUUID(),
            workspaceId,
            claimId: claim.id,
            expectedVersion: claim.version,
            evidenceKind: evKind,
            statement: statement.trim(),
            url: url.trim() === '' ? null : url.trim(),
          };
    setPending(body);
    void send(body);
  }
  function withdraw() {
    const claim = view?.claim;
    if (!claim?.id || busy) return;
    const body =
      pending?.action === 'withdraw'
        ? pending
        : {
            action: 'withdraw',
            commandId: crypto.randomUUID(),
            workspaceId,
            claimId: claim.id,
            expectedVersion: claim.version,
          };
    setPending(body);
    void send(body);
  }
  const claim = view?.claim ?? null;
  const open = view && claim && ['pending', 'needs_evidence'].includes(claim.state);
  const showForm = view?.canEdit && view.canFile && (view.status !== 'approved' || changing);
  return (
    <section aria-label="Company link" aria-busy={loading || busy} className="detail-card">
      <h2>Company link</h2>
      <p>
        A company link means Corridra staff checked that your company is the same as a company
        record, using the evidence you gave. It does not check who you are, and it does not make
        your company profile verified.
      </p>
      {loading && <p role="status">Loading your company link…</p>}
      {message && (
        <p
          ref={feedback}
          tabIndex={-1}
          role={message.error ? 'alert' : 'status'}
          className={message.error ? 'ux-error-summary' : 'ux-draft-notice'}
        >
          {message.text}
        </p>
      )}
      {view && (
        <>
          <p>
            <span
              className="ux-status"
              data-tone={view.status === 'approved' ? 'positive' : 'neutral'}
            >
              {linkStatusText(view.status, view.link?.organisation.name ?? null)}
            </span>
          </p>
          {view.status === 'none' && (
            <p>
              {view.canEdit
                ? view.currentProfileVersion >= 1
                  ? 'No company link has been requested yet.'
                  : 'Save your company profile first, then you can request a company link.'
                : 'No company link has been requested for this workspace.'}
            </p>
          )}
          {view.link && (
            <>
              <p>
                <strong>
                  {view.link.organisation.name} ({view.link.organisation.country})
                </strong>
              </p>
              <p>{view.link.label}</p>
              {view.link.profileChanged && (
                <p>
                  Your company profile has changed since this link was reviewed (version{' '}
                  {view.link.reviewedProfileVersion}). The link still stands until staff change it.
                </p>
              )}
              {view.link.reason && <p>Staff note: {view.link.reason}</p>}
            </>
          )}
          {claim && (
            <>
              {claim.state === 'pending' && claim.awaitingCreation && (
                <p>
                  Staff approved adding your company to the list. The link follows once the record
                  exists.
                </p>
              )}
              {claim.state === 'pending' && !claim.awaitingCreation && (
                <p>Your request is waiting for Corridra staff.</p>
              )}
              {claim.state === 'needs_evidence' && (
                <p>Staff need more evidence before they decide.</p>
              )}
              {claim.decision && <p>Staff note: {claim.decision.reason}</p>}
              <dl>
                <dt>Request</dt>
                <dd>
                  {claim.kind === 'EXISTING'
                    ? `Match to ${claim.target ? claim.target.name + ' (' + claim.target.country + ')' : 'a listed company'}`
                    : 'Propose a new company record'}
                </dd>
                <dt>Based on profile version</dt>
                <dd>
                  {claim.profileVersion}
                  {claim.profileChanged ? ' (the profile has changed since)' : ''}
                </dd>
                <dt>Sent</dt>
                <dd>{day(claim.filedAt)}</dd>
                {claim.note && (
                  <>
                    <dt>Your note</dt>
                    <dd>{claim.note}</dd>
                  </>
                )}
              </dl>
              {claim.evidence && (
                <>
                  <h3>
                    Evidence ({claim.evidence.length} of {evidenceLimit})
                  </h3>
                  {claim.evidence.length === 0 ? (
                    <p>No evidence added yet.</p>
                  ) : (
                    <ul>
                      {claim.evidence.map((e) => (
                        <li key={e.id}>
                          {evidenceKinds.find(([k]) => k === e.kind)?.[1] ?? e.kind}: {e.statement}
                          {e.url ? ` (${e.url})` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
          {open && claim.canAddEvidence && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addEvidence();
              }}
            >
              <fieldset disabled={busy}>
                <legend>Add evidence</legend>
                <p>Text only. Files are not accepted here.</p>
                <div>
                  <label htmlFor={id + 'ek'}>Type of evidence</label>
                  <select id={id + 'ek'} value={evKind} onChange={(e) => setEvKind(e.target.value)}>
                    {evidenceKinds.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={id + 'es'}>
                    {' '}
                    {realCustomerInput() ? 'Statement' : 'Statement (start with Synthetic)'}{' '}
                  </label>
                  <textarea
                    id={id + 'es'}
                    required
                    minLength={realCustomerInput() ? 2 : 11}
                    maxLength={1000}
                    rows={3}
                    value={statement}
                    onChange={(e) => setStatement(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor={id + 'eu'}>
                    Link (optional, example, test or invalid hosts only)
                  </label>
                  <input
                    id={id + 'eu'}
                    maxLength={200}
                    placeholder="https://registry.example"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
              </fieldset>
              <button type="submit" className="button button-primary" disabled={busy}>
                {pending?.action === 'add_evidence' ? 'Retry the same evidence' : 'Add evidence'}
              </button>
            </form>
          )}
          {open &&
            claim.canAddEvidence === false &&
            (claim.evidenceCount ?? 0) >= evidenceLimit && (
              <p>The evidence limit for this request is reached.</p>
            )}
          {open && claim.canWithdraw && !confirmWithdraw && (
            <button
              data-intent="destructive"
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => setConfirmWithdraw(true)}
            >
              Withdraw this request
            </button>
          )}
          {open && claim.canWithdraw && confirmWithdraw && (
            <div role="group" aria-label="Confirm withdrawal">
              <p>Withdraw this request? You can send a new one afterwards.</p>
              <button
                data-intent="destructive"
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={withdraw}
              >
                Confirm withdrawal
              </button>{' '}
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => setConfirmWithdraw(false)}
              >
                Keep the request
              </button>
            </div>
          )}
          {view.status === 'approved' && view.canEdit && view.canFile && !changing && (
            <button type="button" className="text-link" onClick={() => setChanging(true)}>
              Request a different company link
            </button>
          )}
          {showForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                file();
              }}
            >
              <fieldset disabled={busy || view.currentProfileVersion < 1}>
                <legend>
                  {view.status === 'approved'
                    ? 'Request a different company link'
                    : 'Request a company link'}
                </legend>
                <p>
                  The request is based on your saved company profile (version{' '}
                  {view.currentProfileVersion}).
                </p>
                <label>
                  <input
                    type="radio"
                    name={id + 'kind'}
                    checked={kind === 'EXISTING'}
                    onChange={() => setKind('EXISTING')}
                  />{' '}
                  My company is already on the Corridra company list
                </label>
                <label>
                  <input
                    type="radio"
                    name={id + 'kind'}
                    checked={kind === 'PROPOSED_NEW'}
                    onChange={() => setKind('PROPOSED_NEW')}
                  />{' '}
                  My company is not on the list yet
                </label>
                {kind === 'EXISTING' && (
                  <div>
                    <label htmlFor={id + 'q'}>Search the list (at least 3 letters)</label>
                    <input
                      id={id + 'q'}
                      value={term}
                      maxLength={80}
                      onChange={(e) => setTerm(e.target.value)}
                    />{' '}
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || term.trim().length < 3}
                      onClick={() => void search()}
                    >
                      Search
                    </button>
                    {found && found.length === 0 && (
                      <p>
                        No listed company matches. Try another word, or choose the other option.
                      </p>
                    )}
                    {found && found.length > 0 && (
                      <fieldset>
                        <legend>Choose your company</legend>
                        {found.map((o) => (
                          <label key={o.id}>
                            <input
                              type="radio"
                              name={id + 'org'}
                              checked={chosen === o.id}
                              onChange={() => setChosen(o.id)}
                            />{' '}
                            {o.name} ({o.country})
                          </label>
                        ))}
                      </fieldset>
                    )}
                  </div>
                )}
                <div>
                  <label htmlFor={id + 'note'}>
                    {realCustomerInput()
                      ? 'Why this is your company'
                      : 'Why this is your company (start with Synthetic)'}{' '}
                  </label>
                  <textarea
                    id={id + 'note'}
                    required
                    minLength={realCustomerInput() ? 2 : 11}
                    maxLength={1000}
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </fieldset>
              <button
                type="submit"
                className="button button-primary"
                disabled={
                  busy || view.currentProfileVersion < 1 || (kind === 'EXISTING' && !chosen)
                }
              >
                {pending?.action === 'file' ? 'Retry the same request' : 'Request company link'}
              </button>
            </form>
          )}
          {claim?.history && claim.history.length > 0 && (
            <details>
              <summary>Request history</summary>
              <ol>
                {claim.history.map((h) => (
                  <li key={h.seq}>
                    {day(h.at)}: {h.kind.replaceAll('_', ' ')} by{' '}
                    {h.by === 'staff' ? 'Corridra staff' : 'your team'}
                    {h.reason ? ` - ${h.reason}` : ''}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      {!loading && !view && (
        <button type="button" className="text-link" disabled={busy} onClick={() => void send()}>
          Reload company link
        </button>
      )}
    </section>
  );
}
