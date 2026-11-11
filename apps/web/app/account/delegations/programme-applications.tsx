'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { clearApplyIntent } from '../../../lib/programme-apply-intent';
import '../../delegations/[address]/programme-page.css';
import { pp } from '../../../lib/i18n/programme-pages';
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
      return setError(pp('pp.apply.problem.name'));
    if ([...words].length < 10 || [...words].length > 1000)
      return setError(pp('pp.apply.problem.statement'));
    if (sample && (!label.startsWith('Synthetic ') || !words.startsWith('Synthetic ')))
      return setError(pp('pp.apply.problem.sample'));
    if (/[\r\n]/.test(words)) return setError(pp('pp.apply.problem.paragraph'));
    if (!consent) return setError(pp('pp.apply.problem.consent'));
    writing.current = true;
    setBusy(true);
    setError('');
    const result = await pageRequest(
      { subject, issuer },
      {
        kind: 'application',
        action: 'apply',
        commandId: commands.forIntent('apply' + target.address + target.version + label + words),
        address: target.address,
        version: target.version,
        displayLabel: label,
        statement: words,
        consented: true,
      },
    );
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
    setNotice(pp('pp.apply.sent'));
    await read();
  }
  async function act(item: Application, action: 'withdraw' | 'join') {
    if (writing.current) return;
    if (action === 'join' && !joinConsent)
      return setRowError({ id: item.id, message: pp('pp.apply.joinNeeded') });
    if (action === 'withdraw' && !window.confirm(pp('pp.apply.withdrawConfirm'))) return;
    writing.current = true;
    setBusy(true);
    setRowError(null);
    const result = await pageRequest(
      { subject, issuer },
      {
        kind: 'application',
        action,
        commandId: commands.forIntent(action + item.id + item.decisionVersion),
        applicationId: item.id,
        ...(action === 'join' ? { consented: true } : { acknowledged: true }),
      },
    );
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
      <h2 id="applications-title">{pp('pp.apply.heading')}</h2>
      {asked && !target && <p role="status">{pp('pp.apply.gone')}</p>}
      {target && !live && (
        <form
          className="programme-apply-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <h3>{pp('pp.apply.to', { title: target.title })}</h3>
          <p className="programme-note">
            {pp('pp.apply.organisedBy', { organiser: target.organiser })}
          </p>
          {target.open ? (
            <>
              <label className="field">
                <span>{pp('pp.apply.name.label')}</span>
                <input
                  name="application-name"
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="organization"
                />
                <small>{pp('pp.apply.name.hint')}</small>
              </label>
              <label className="field">
                <span>{pp('pp.apply.statement.label')}</span>
                <textarea
                  name="application-statement"
                  rows={4}
                  maxLength={1000}
                  value={statement}
                  onChange={(event) => setStatement(event.target.value)}
                />
                <small>{pp('pp.apply.statement.hint')}</small>
              </label>
              <label className="programme-page-agree">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />{' '}
                {pp('pp.apply.consent')}
              </label>
              <p className="programme-note">
                {pp('pp.apply.privacy')}{' '}
                <a className="text-link" href="/privacy">
                  {pp('pp.apply.privacyLink')}
                </a>
              </p>
              {error && <p role="alert">{error}</p>}
              <button type="submit" className="primary-link" disabled={busy}>
                {busy ? pp('pp.apply.sending') : pp('pp.apply.send')}
              </button>
            </>
          ) : (
            <p role="status">{pp('pp.apply.closed')}</p>
          )}
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {load === 'loading' && <p role="status">{pp('pp.apply.loading')}</p>}
      {load === 'failed' && (
        <div role="alert">
          <p>{pp('pp.apply.failed')}</p>
          <button type="button" className="text-link" onClick={() => void read()}>
            {pp('pp.tryAgain')}
          </button>
        </div>
      )}
      {load === 'ready' && rows.length === 0 && !target && (
        <p className="ux-empty">{pp('pp.apply.empty')}</p>
      )}
      {rows.length > 0 && (
        <ul className="programme-application-list">
          {rows.map((item) => (
            <li key={item.id}>
              <p>
                <strong>{item.title ?? pp('pp.apply.row.fallbackTitle')}</strong>{' '}
                <span className="programme-public-state">{statusWords[item.status]}</span>
              </p>
              <p className="programme-note">
                {pp('pp.apply.row.applied', {
                  date: shortDay(item.appliedAt),
                  name: item.displayLabel,
                })}
                {item.status === 'SUBMITTED' ? pp('pp.apply.row.submitted') : ''}
                {item.status === 'WAITLISTED' ? pp('pp.apply.row.waitlisted') : ''}
                {item.status === 'INVITED' && item.invitationExpiresAt
                  ? pp('pp.apply.row.invited', { date: shortDay(item.invitationExpiresAt) })
                  : ''}
                {item.status === 'INVITATION_EXPIRED' ? pp('pp.apply.row.expired') : ''}
                {item.status === 'JOINED' ? pp('pp.apply.row.joined') : ''}
              </p>
              {item.note && <p>{pp('pp.apply.row.note', { note: item.note })}</p>}
              {item.address && (
                <p>
                  <a className="text-link" href={`/delegations/${item.address}`}>
                    {pp('pp.apply.row.open')}
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
                      {pp('pp.apply.joinConsent', { name: item.displayLabel })}
                    </label>
                    <div className="guide-actions-row">
                      <button
                        type="button"
                        className="primary-link"
                        disabled={busy}
                        onClick={() => void act(item, 'join')}
                      >
                        {pp('pp.apply.joinConfirm')}
                      </button>
                      <button type="button" className="text-link" onClick={() => setJoining(null)}>
                        {pp('pp.cancel')}
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
                    {pp('pp.apply.join')}
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
                    {pp('pp.apply.withdraw')}
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
