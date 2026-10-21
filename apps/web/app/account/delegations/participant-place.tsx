'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OwnPlace } from '@corridra/auth/customer-programme-terms';
import {
  failureText,
  money,
  parseOwnPlace,
  participantReason,
  roleLabel,
  termsApi,
  TermsError,
} from './terms-client';

type Props = { subject: string; issuer: string; registrationId: string };
type Phase = 'loading' | 'ready' | 'denied' | 'unavailable' | 'failed';

// The participant's own side: read the terms and criteria, apply for a place, accept newer terms, give a place up.
export function ParticipantPlace(props: Props) {
  return (
    <ScopedPlace key={props.issuer + ':' + props.subject + ':' + props.registrationId} {...props} />
  );
}

function Terms({ terms, fees }: { terms: NonNullable<OwnPlace['terms']>; fees: OwnPlace['fees'] }) {
  return (
    <dl>
      <dt>What is included</dt>
      <dd>{terms.included}</dd>
      {terms.excluded && (
        <>
          <dt>What is not included</dt>
          <dd>{terms.excluded}</dd>
        </>
      )}
      <dt>Cancelling</dt>
      <dd>{terms.cancellationTerms}</dd>
      <dt>If the plan changes</dt>
      <dd>{terms.changeTerms}</dd>
      <dt>Fees</dt>
      <dd>
        {terms.feesApply ? (terms.feeNote ?? 'A fee applies.') : 'No fee applies.'}
        {terms.feesApply &&
          (fees.length === 0
            ? ' The organiser has not recorded a fee for you yet.'
            : ' Recorded for you by the organiser: ' +
              fees.map((f) => money(f.dueMinor, f.exponent) + ' ' + f.currency).join(', ') +
              '. Nothing is collected here.')}
      </dd>
    </dl>
  );
}

function ScopedPlace({ subject, issuer, registrationId }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<OwnPlace | null>(null);
  const [profile, setProfile] = useState('');
  const [agree, setAgree] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const task = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intent = useRef<{ signature: string; commandId: string } | null>(null);
  const writing = useRef(false);
  const api = useRef(termsApi(subject, issuer));

  const lose = useCallback((to: Phase) => {
    if (timer.current) clearTimeout(timer.current);
    setData(null);
    setProfile('');
    setAgree(false);
    setConfirmCancel(false);
    intent.current = null;
    setPhase(to);
  }, []);
  const load = useCallback(async () => {
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    try {
      const body = parseOwnPlace(
        await api.current.get({ view: 'place', registrationId }, controller.signal),
        registrationId,
      );
      if (controller.signal.aborted || !active.current) return;
      setData(body);
      setPhase('ready');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => lose('failed'),
        Math.max(Date.parse(body.expiresAt) - Date.now(), 1000),
      );
    } catch (e) {
      if (controller.signal.aborted || !active.current) return;
      if (e instanceof TermsError && e.kind === 'denied') lose('denied');
      else if (e instanceof TermsError && e.kind === 'unavailable') lose('unavailable');
      else lose('failed');
    }
  }, [lose, registrationId]);
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    return () => {
      active.current = false;
      task.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function send(input: Record<string, unknown>, message: string) {
    if (writing.current) return;
    const signature = JSON.stringify(input);
    if (intent.current?.signature !== signature)
      intent.current = { signature, commandId: crypto.randomUUID() };
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await api.current.post('enrol', {
        commandId: intent.current.commandId,
        registrationId,
        acknowledged: true,
        ...input,
      });
      intent.current = null;
      setNotice(message);
      setAgree(false);
      setConfirmCancel(false);
      await load();
    } catch (e) {
      if (e instanceof TermsError && e.kind === 'denied') lose('denied');
      else setError(failureText(e));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  const status = data?.enrolment.status ?? 'NOT_APPLIED';
  const canApply = status === 'NOT_APPLIED' || status === 'NOT_ELIGIBLE' || status === 'CANCELLED';
  const full = !!data && !data.placesAvailable && !data.waitlist;
  const needsTerms = !!data?.terms;
  // Matches the database: criteria with every list empty and no minimum accept anyone, so no profile is needed.
  const needsProfile =
    !!data?.criteria &&
    (data.criteria.roles.length > 0 ||
      data.criteria.sectors.length > 0 ||
      data.criteria.countries.length > 0 ||
      data.criteria.sizeBands.length > 0 ||
      data.criteria.minProfileFields > 0);
  const applyReady =
    !!data && !busy && !full && (!needsTerms || agree) && (!needsProfile || profile !== '');
  const c = data?.criteria;
  return (
    <section
      className="detail-card"
      aria-label={'Your place in ' + (data?.programmeName ?? 'this programme')}
      aria-busy={phase === 'loading' || busy}
    >
      <h4>Your place</h4>
      {phase === 'loading' && <p role="status">Checking your place…</p>}
      {phase === 'unavailable' && <p role="status">Places are unavailable right now.</p>}
      {phase === 'denied' && (
        <p role="alert">Your access changed. Private details were cleared. Reload your account.</p>
      )}
      {phase === 'failed' && (
        <>
          <p role="alert">Your place could not be loaded. Reload to check access and try again.</p>
          <button type="button" className="text-link" onClick={() => void load()}>
            Reload my place
          </button>
        </>
      )}
      {phase === 'ready' && data && (
        <>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
          <p>
            <span
              className="ux-status"
              data-tone={
                status === 'PLACED' ? 'positive' : status === 'NOT_ELIGIBLE' ? 'critical' : 'info'
              }
            >
              {status === 'PLACED'
                ? 'Your place is confirmed'
                : status === 'WAITLISTED'
                  ? 'On the waiting list' +
                    (data.enrolment.position ? ', number ' + data.enrolment.position : '')
                  : status === 'NOT_ELIGIBLE'
                    ? 'Not eligible'
                    : status === 'CANCELLED'
                      ? 'You gave up your place'
                      : 'No place yet'}
            </span>
          </p>
          {status === 'NOT_ELIGIBLE' && (
            <>
              <p>This programme could not accept your application for these reasons:</p>
              <ul>
                {data.enrolment.reasons.map((code) => (
                  <li key={code}>{participantReason[code]}</li>
                ))}
              </ul>
              <p>You can update your organisation profile and apply again.</p>
            </>
          )}
          {data.terms && (
            <details>
              <summary>Programme terms, version {data.terms.version}</summary>
              <Terms terms={data.terms} fees={data.fees} />
            </details>
          )}
          {c && (
            <details>
              <summary>Who can take part</summary>
              <ul>
                {c.roles.length > 0 && (
                  <li>Commercial roles: {c.roles.map((r) => roleLabel[r] ?? r).join(', ')}</li>
                )}
                {c.sectors.length > 0 && <li>Sectors: {c.sectors.join(', ')}</li>}
                {c.countries.length > 0 && <li>Countries: {c.countries.join(', ')}</li>}
                {c.sizeBands.length > 0 && <li>Company size: {c.sizeBands.join(', ')}</li>}
                {c.minProfileFields > 0 && (
                  <li>At least {c.minProfileFields} of 7 organisation profile details filled in</li>
                )}
              </ul>
            </details>
          )}
          {(status === 'PLACED' || status === 'WAITLISTED') &&
            data.termsCurrent === false &&
            data.terms && (
              <div className="operator-form">
                <h5>The terms changed</h5>
                <p>
                  {data.acceptedVersion
                    ? 'You accepted version ' + data.acceptedVersion + '. '
                    : ''}
                  Read version {data.terms.version} above and accept it to keep your place in good
                  standing.
                </p>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={agree}
                    disabled={busy}
                    onChange={(e) => setAgree(e.target.checked)}
                  />
                  I accept version {data.terms.version} of the programme terms.
                </label>
                <button
                  type="button"
                  className="primary-link"
                  disabled={busy || !agree}
                  onClick={() =>
                    void send(
                      { action: 'accept_terms', termsVersion: data.terms!.version },
                      'Terms accepted.',
                    )
                  }
                >
                  Accept the new terms
                </button>
              </div>
            )}
          {status === 'PLACED' && data.tasks.length > 0 && (
            <>
              <h5>Programme tasks</h5>
              <ul>
                {data.tasks.map((t, i) => (
                  <li key={i}>
                    {t.title}
                    {t.dueOn ? ' · due ' + t.dueOn : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {canApply && (
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!applyReady) return;
                void send(
                  {
                    action: 'apply',
                    termsVersion: data.terms ? data.terms.version : null,
                    profileWorkspaceId: needsProfile ? profile : null,
                  },
                  data.placesAvailable
                    ? 'Your application was received.'
                    : 'You are on the waiting list.',
                );
              }}
            >
              <h5>{status === 'NOT_APPLIED' ? 'Apply for a place' : 'Apply again'}</h5>
              {full && <p role="status">This programme is full and has no waiting list.</p>}
              {!full && !data.placesAvailable && (
                <p role="status">All places are taken. You can join the waiting list.</p>
              )}
              {needsProfile && (
                <label className="field">
                  Organisation profile to check
                  <select
                    value={profile}
                    disabled={busy}
                    onChange={(e) => setProfile(e.target.value)}
                  >
                    <option value="">Choose a workspace</option>
                    {data.profileChoices.map((w) => (
                      <option key={w.workspaceId} value={w.workspaceId}>
                        {w.name}
                        {w.hasProfile ? '' : ' (no profile yet)'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {needsTerms && (
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={agree}
                    disabled={busy}
                    onChange={(e) => setAgree(e.target.checked)}
                  />
                  I have read and accept version {data.terms!.version} of the programme terms.
                </label>
              )}
              <button type="submit" className="primary-link" disabled={!applyReady}>
                {!data.placesAvailable && data.waitlist
                  ? 'Join the waiting list'
                  : 'Apply for a place'}
              </button>
            </form>
          )}
          {(status === 'PLACED' || status === 'WAITLISTED') && (
            <div className="operator-form">
              <h5>Give up my place</h5>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={confirmCancel}
                  disabled={busy}
                  onChange={(e) => setConfirmCancel(e.target.checked)}
                />
                I want to give up my place. The next person waiting is offered it. My registration
                stays.
              </label>
              <button
                type="button"
                className="text-link"
                disabled={busy || !confirmCancel}
                onClick={() => void send({ action: 'cancel' }, 'You gave up your place.')}
              >
                Give up my place
              </button>
            </div>
          )}
          <button type="button" className="text-link" disabled={busy} onClick={() => void load()}>
            Reload my place
          </button>
        </>
      )}
    </section>
  );
}
