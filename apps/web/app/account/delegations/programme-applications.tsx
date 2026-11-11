'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { clearApplyIntent } from '../../../lib/programme-apply-intent';
import '../../delegations/[address]/programme-page.css';
import { customerHeaders, useCommandIds } from './pricing-client';
import {
  type Application,
  pageRequest,
  parseApplication,
  shortDay,
  statusWords,
} from './programme-page-client';

export type ApplyTarget = {
  address: string;
  version: number;
  title: string;
  organiser: string;
  open: boolean;
};
type Props = { subject: string; issuer: string; target: ApplyTarget | null; asked: boolean };

/** A person's own applications to programmes: send one, read the organiser's answer, join when invited, or take it
 * back. The organiser sees only the name and the statement written here. */
export function ProgrammeApplications(props: Props) {
  return <Scoped key={props.issuer + ':' + props.subject} {...props} />;
}

function Scoped({ subject, issuer, target, asked }: Props) {
  const headers = customerHeaders(subject, issuer);
  const headersRef = useRef(headers);
  const commands = useCommandIds();
  const sample = !realCustomerInput();
  const draftKey = target ? `corridra.programme-application.${target.address}` : '';
  const [rows, setRows] = useState<Application[]>([]);
  const [load, setLoad] = useState<'loading' | 'ready' | 'unavailable' | 'failed'>('loading');
  const [name, setName] = useState('');
  const [statement, setStatement] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [joining, setJoining] = useState<string | null>(null);
  const [joinConsent, setJoinConsent] = useState(false);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const writing = useRef(false);

  const read = useCallback(async () => {
    try {
      const r = await fetch('/api/customer-programme-pages?view=own', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: headersRef.current,
      });
      if (r.status === 503) return setLoad('unavailable');
      if (!r.ok) return setLoad('failed');
      const body = (await r.json()) as { applications?: unknown[] };
      setRows((body.applications ?? []).map(parseApplication));
      setLoad('ready');
    } catch {
      setLoad('failed');
    }
  }, []);
  useEffect(() => {
    // The read starts after this effect returns; state changes only when it settles.
    void Promise.resolve().then(read);
  }, [read]);
  // What was typed is kept in this browser until the application is sent.
  useEffect(() => {
    if (!draftKey) return;
    void Promise.resolve().then(() => {
      try {
        const kept = JSON.parse(window.sessionStorage.getItem(draftKey) ?? 'null') as {
          name?: string;
          statement?: string;
        } | null;
        if (kept?.name) setName(kept.name);
        if (kept?.statement) setStatement(kept.statement);
      } catch {
        /* No kept words. */
      }
    });
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey || (!name && !statement)) return;
    try {
      window.sessionStorage.setItem(draftKey, JSON.stringify({ name, statement }));
    } catch {
      /* The words stay on the screen. */
    }
  }, [draftKey, name, statement]);

  const live = target
    ? rows.find(
        (row) =>
          row.address === target.address &&
          ['SUBMITTED', 'WAITLISTED', 'INVITED', 'INVITATION_EXPIRED', 'JOINED'].includes(
            row.status,
          ),
      )
    : undefined;

  async function send() {
    if (!target || writing.current) return;
    const label = name.trim();
    const words = statement.trim();
    if ([...label].length < (sample ? 11 : 2) || [...label].length > 120)
      return setError('Write your company name or your own name (up to 120 characters).');
    if ([...words].length < 10 || [...words].length > 1000)
      return setError('Say what you want from this programme (10 to 1000 characters).');
    if (sample && (!label.startsWith('Synthetic ') || !words.startsWith('Synthetic ')))
      return setError(
        'This is a sample programme. Start the name and the statement with "Synthetic " and use no real details.',
      );
    if (/[\r\n]/.test(words)) return setError('Write the statement as one paragraph.');
    if (!consent) return setError('Tick the box to send your application to the organiser.');
    writing.current = true;
    setBusy(true);
    setError('');
    const result = await pageRequest(headers, {
      kind: 'application',
      action: 'apply',
      commandId: commands.forIntent('apply' + target.address + target.version + label + words),
      address: target.address,
      version: target.version,
      displayLabel: label,
      statement: words,
      consented: true,
    });
    writing.current = false;
    setBusy(false);
    if (!result.ok) return setError(result.message);
    commands.clear();
    clearApplyIntent();
    try {
      window.sessionStorage.removeItem(draftKey);
    } catch {
      /* Nothing to clear. */
    }
    setName('');
    setStatement('');
    setConsent(false);
    setNotice(
      'Your application was sent to the organiser. Their answer will appear here. Nothing is booked or charged yet.',
    );
    await read();
  }
  async function act(item: Application, action: 'withdraw' | 'join') {
    if (writing.current) return;
    if (action === 'join' && !joinConsent)
      return setRowError({ id: item.id, message: 'Tick the box to join the programme.' });
    if (
      action === 'withdraw' &&
      !window.confirm('Withdraw this application? The organiser will see it as withdrawn.')
    )
      return;
    writing.current = true;
    setBusy(true);
    setRowError(null);
    const result = await pageRequest(headers, {
      kind: 'application',
      action,
      commandId: commands.forIntent(action + item.id + item.decisionVersion),
      applicationId: item.id,
      ...(action === 'join' ? { consented: true } : { acknowledged: true }),
    });
    writing.current = false;
    setBusy(false);
    if (!result.ok) return setRowError({ id: item.id, message: result.message });
    commands.clear();
    if (action === 'join') {
      // The registration list on this page is read again from the server, so the new registration is shown as stored.
      window.history.replaceState(null, '', '/account/delegations');
      window.location.reload();
      return;
    }
    setJoining(null);
    await read();
  }

  if (load === 'unavailable') return null;
  return (
    <section className="detail-card programme-applications" aria-labelledby="applications-title">
      <h2 id="applications-title">Your applications</h2>
      {asked && !target && (
        <p role="status">
          That programme page is not available. It may have been taken down or its address may be
          wrong. Ask the organiser for the current link.
        </p>
      )}
      {target && !live && (
        <form
          className="programme-apply-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <h3>Apply to {target.title}</h3>
          <p className="programme-note">Organised by {target.organiser}.</p>
          {target.open ? (
            <>
              <label className="field">
                <span>Your company name, or your own name</span>
                <input
                  name="application-name"
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="organization"
                />
                <small>The organiser sees this name.</small>
              </label>
              <label className="field">
                <span>What you want from this programme</span>
                <textarea
                  name="application-statement"
                  rows={4}
                  maxLength={1000}
                  value={statement}
                  onChange={(event) => setStatement(event.target.value)}
                />
                <small>
                  For example what you want to buy or sell and who you want to meet. One paragraph.
                </small>
              </label>
              <label className="programme-page-agree">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />{' '}
                Send this name and statement to the organiser. They do not see my private requests,
                contacts or prices. Applying is not a booking.
              </label>
              {error && <p role="alert">{error}</p>}
              <button type="submit" className="primary-link" disabled={busy}>
                {busy ? 'Sending…' : 'Send Application'}
              </button>
            </>
          ) : (
            <p role="status">This programme is not taking applications right now.</p>
          )}
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {load === 'loading' && <p role="status">Loading your applications…</p>}
      {load === 'failed' && (
        <div role="alert">
          <p>Your applications could not be loaded. Nothing was changed.</p>
          <button type="button" className="text-link" onClick={() => void read()}>
            Try Again
          </button>
        </div>
      )}
      {load === 'ready' && rows.length === 0 && !target && (
        <p className="ux-empty">
          You have not applied to a programme. An organiser can send you the link to their programme
          page.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="programme-application-list">
          {rows.map((item) => (
            <li key={item.id}>
              <p>
                <strong>{item.title ?? 'Programme'}</strong>{' '}
                <span className="programme-public-state">{statusWords[item.status]}</span>
              </p>
              <p className="programme-note">
                Applied {shortDay(item.appliedAt)} as {item.displayLabel}.
                {item.status === 'SUBMITTED' ? ' The organiser has not answered yet.' : ''}
                {item.status === 'WAITLISTED'
                  ? ' The organiser put you on the waiting list. This is not a place.'
                  : ''}
                {item.status === 'INVITED' && item.invitationExpiresAt
                  ? ` You are invited. Join by ${shortDay(item.invitationExpiresAt)} (UTC).`
                  : ''}
                {item.status === 'INVITATION_EXPIRED'
                  ? ' Your invitation expired before you joined. Ask the organiser to invite you again.'
                  : ''}
                {item.status === 'JOINED'
                  ? ' You are registered. See your registration below.'
                  : ''}
              </p>
              {item.note && <p>From the organiser: {item.note}</p>}
              {item.address && (
                <p>
                  <a className="text-link" href={`/delegations/${item.address}`}>
                    Open the Programme Page
                  </a>
                </p>
              )}
              {item.status === 'INVITED' &&
                (joining === item.id ? (
                  <div className="programme-page-decline">
                    <label className="programme-page-agree">
                      <input
                        type="checkbox"
                        checked={joinConsent}
                        onChange={(event) => setJoinConsent(event.target.checked)}
                      />{' '}
                      Register me in this programme under the name {item.displayLabel}. The
                      organiser&apos;s terms, places and fees come next and are shown before you
                      accept them.
                    </label>
                    <div className="guide-actions-row">
                      <button
                        type="button"
                        className="primary-link"
                        disabled={busy}
                        onClick={() => void act(item, 'join')}
                      >
                        Confirm and Join
                      </button>
                      <button type="button" className="text-link" onClick={() => setJoining(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="primary-link"
                    disabled={busy}
                    onClick={() => {
                      setJoining(item.id);
                      setJoinConsent(false);
                      setRowError(null);
                    }}
                  >
                    Join the Programme
                  </button>
                ))}
              {['SUBMITTED', 'WAITLISTED', 'INVITED', 'INVITATION_EXPIRED'].includes(item.status) &&
                joining !== item.id && (
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => void act(item, 'withdraw')}
                  >
                    Withdraw Application
                  </button>
                )}
              {rowError?.id === item.id && <p role="alert">{rowError.message}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
