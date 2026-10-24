'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DeliveryReport } from '@corridra/delivery/report';
import { MissionPassport } from '../../../components/mission-passport';
import { MissionExperienceView } from '../../mission-experience-view';
import { displayDate, displayMoney } from '@corridra/domain/locale';
import { missionStatus } from '@corridra/domain/missions';
import { timeZone } from '@corridra/domain/geography';
import { currency } from '@corridra/domain/opportunities';
import { requirementFields, offerTerms } from '@corridra/domain/commercial-missions';
import { savedMissionHeaders, savedMissionRead, type SavedMissionScope } from '../saved-missions';
import { DecisionHistory } from './decision-history';
export type ReportSection = 'all' | 'compare' | 'evidence';
type Scope = SavedMissionScope & {
  resourceId: string;
  decisionsEnabled?: boolean;
  /** UX update (`CORRIDRA_UX_LENSES`, read on the server): the offers as cards. */
  lenses?: boolean;
  /** The Room shows the report in two lenses. `all` is the whole page, as it has always been. */
  section?: ReportSection;
};
function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function text(value: unknown): value is string {
  return typeof value === 'string';
}
function report(value: unknown, id: string): DeliveryReport {
  const wrapper = value as { resourceId?: unknown; report?: DeliveryReport } | null;
  const r = wrapper?.report;
  if (
    wrapper?.resourceId !== id ||
    !r ||
    r.schemaVersion !== 1 ||
    r.audience !== 'CLIENT_PROGRESS' ||
    r.allowExport !== false ||
    !date(r.expiresAt) ||
    !text(r.purpose) ||
    !text(r.attribution) ||
    !Array.isArray(r.missions) ||
    r.missions.length !== 1
  )
    throw new Error('failed');
  for (const m of r.missions) {
    if (
      !text(m.publicationId) ||
      !text(m.title) ||
      !text(m.company) ||
      !text(m.objective) ||
      !text(m.brief) ||
      !text(m.nextAction) ||
      !date(m.dueAt) ||
      !date(m.reviewedAt) ||
      !date(m.updatedAt) ||
      !missionStatus.options.includes(m.status as (typeof missionStatus.options)[number]) ||
      !Array.isArray(m.itinerary) ||
      !Array.isArray(m.totals) ||
      !m.outcomes ||
      ![
        'opportunities',
        'qualified',
        'proposals',
        'contracts',
        'rfqs',
        'samples',
        'heldMeetings',
      ].every(
        (key) =>
          Number.isInteger(m.outcomes[key as keyof typeof m.outcomes]) &&
          m.outcomes[key as keyof typeof m.outcomes] >= 0,
      )
    )
      throw new Error('failed');
    if (
      !m.itinerary.every(
        (mt) =>
          text(mt.label) &&
          text(mt.status) &&
          typeof mt.scheduleChanged === 'boolean' &&
          (mt.startsAt === undefined || date(mt.startsAt)) &&
          (mt.endsAt === undefined || date(mt.endsAt)) &&
          (mt.timezone === undefined || timeZone.safeParse(mt.timezone).success) &&
          (mt.location === undefined || text(mt.location)),
      )
    )
      throw new Error('failed');
    for (const t of m.totals)
      for (const key of [
        'contractMinor',
        'invoiceMinor',
        'confirmedCashMinor',
        'repeatCashMinor',
      ] as const)
        try {
          displayMoney(t[key], t.currency);
        } catch {
          throw new Error('failed');
        }
    const e = m.experience;
    if (e) {
      if (
        e.schemaVersion !== 1 ||
        !Array.isArray(e.shortlist) ||
        !Array.isArray(e.quotations) ||
        !Array.isArray(e.agenda) ||
        !text(e.documentAccess) ||
        (e.requirements !== null &&
          (!e.requirements ||
            !requirementFields.safeParse(e.requirements.fields).success ||
            typeof e.requirements.current !== 'boolean' ||
            !text(e.requirements.sourceKind) ||
            !text(e.requirements.claimStatus)))
      )
        throw new Error('failed');
      if (
        !e.shortlist.every((t) =>
          [
            'id',
            'company',
            'country',
            'fit',
            'rationale',
            'uncertainty',
            'gaps',
            'verification',
          ].every((k) => text(t[k as keyof typeof t])),
        )
      )
        throw new Error('failed');
      if (
        !e.quotations.every(
          (q) =>
            offerTerms.safeParse(q.terms).success &&
            currency.safeParse(q.currency).success &&
            text(q.targetId) &&
            text(q.id) &&
            text(q.uncertainties) &&
            text(q.sourceKind) &&
            text(q.claimStatus) &&
            typeof q.superseded === 'boolean' &&
            typeof q.assignmentCurrent === 'boolean' &&
            Number.isInteger(q.revision) &&
            q.revision > 0,
        )
      )
        throw new Error('failed');
      if (
        !e.agenda.every(
          (a) =>
            text(a.id) &&
            text(a.label) &&
            text(a.state) &&
            text(a.nextAction) &&
            text(a.responsibility) &&
            date(a.dueAt) &&
            Array.isArray(a.meetings) &&
            a.meetings.every(
              (mt) =>
                text(mt.id) &&
                text(mt.status) &&
                typeof mt.scheduleChanged === 'boolean' &&
                (mt.startsAt === undefined || date(mt.startsAt)) &&
                (mt.timezone === undefined || timeZone.safeParse(mt.timezone).success),
            ),
        )
      )
        throw new Error('failed');
    }
    if (
      m.requests &&
      !m.requests.every(
        (q) =>
          text(q.id) &&
          text(q.title) &&
          text(q.instructions) &&
          date(q.dueAt) &&
          text(q.status) &&
          (q.response === undefined || text(q.response)),
      )
    )
      throw new Error('failed');
  }
  return r;
}
export function SavedCommercialReport(props: Scope) {
  return (
    <PrivateReport
      key={JSON.stringify([props.issuer, props.subject, props.resourceId])}
      {...props}
    />
  );
}
function PrivateReport({
  subject,
  issuer,
  resourceId,
  decisionsEnabled = false,
  lenses = false,
  section = 'all',
}: Scope) {
  const responsePrefix = useId();
  const [data, setData] = useState<DeliveryReport | null>(null),
    [status, setStatus] = useState('loading');
  const [drafts, setDrafts] = useState<Record<string, { body: string; acknowledged: boolean }>>({});
  const [pending, setPending] = useState<{
    requestId: string;
    body: string;
    acknowledged: true;
    commandId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const read = useCallback(() => {
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    void fetch('/api/customer-saved-missions', {
      method: 'POST',
      cache: 'no-store',
      signal: task.signal,
      headers: savedMissionHeaders({ subject, issuer }),
      body: JSON.stringify({ action: 'view', resourceId, audience: 'CLIENT_PROGRESS' }),
    })
      .then(savedMissionRead)
      .then((value) => {
        const next = report(value, resourceId);
        if (!task.signal.aborted) {
          setData(next);
          setStatus('ready');
        }
      })
      .catch((error) => {
        if (!task.signal.aborted) {
          setData(null);
          if (error instanceof Error && error.message === 'denied') {
            setPending(null);
            setDrafts({});
            setNotice(
              'Access or request state changed. Local response recovery was cleared for privacy.',
            );
          }
          setStatus(
            error instanceof Error && ['denied', 'unavailable'].includes(error.message)
              ? error.message
              : 'failed',
          );
        }
      });
  }, [subject, issuer, resourceId]);
  useEffect(() => {
    function clear() {
      controller.current?.abort();
      setData(null);
      setStatus('loading');
      setBusy(false);
    }
    function visible() {
      if (document.hidden) clear();
      else read();
    }
    function show(event: PageTransitionEvent) {
      if (event.persisted) {
        clear();
        read();
      }
    }
    read();
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.current?.abort();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [read]);
  async function respond(requestId: string) {
    if (inFlight.current || (pending && pending.requestId !== requestId)) return;
    const draft = drafts[requestId];
    const command =
      pending ??
      (draft?.acknowledged && draft.body.trim().length >= 3
        ? {
            requestId,
            body: draft.body,
            acknowledged: true as const,
            commandId: crypto.randomUUID(),
          }
        : null);
    if (!command) {
      setNotice('Enter a response and acknowledge that it is your unverified declaration.');
      return;
    }
    setPending(command);
    setBusy(true);
    setNotice('');
    inFlight.current = true;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    try {
      const value = await savedMissionRead(
        await fetch('/api/customer-saved-missions', {
          method: 'POST',
          signal: task.signal,
          headers: savedMissionHeaders({ subject, issuer }),
          body: JSON.stringify({
            action: 'respond',
            resourceId,
            audience: 'CLIENT_PROGRESS',
            ...command,
          }),
        }),
      );
      const result = value as {
        resourceId?: unknown;
        response?: { id?: unknown; claimStatus?: unknown };
      };
      if (
        result?.resourceId !== resourceId ||
        result.response?.id !== command.commandId ||
        result.response.claimStatus !== 'self_declared'
      )
        throw new Error('failed');
      if (!task.signal.aborted) {
        setPending(null);
        setDrafts((old) => {
          const next = { ...old };
          delete next[requestId];
          return next;
        });
        setNotice('Response recorded as your self-declaration. It still requires review.');
        setBusy(false);
        read();
      }
    } catch (error) {
      if (!task.signal.aborted) {
        if (error instanceof Error && error.message === 'denied') {
          setData(null);
          setPending(null);
          setDrafts({});
          setStatus('denied');
          setNotice(
            'Access or request state changed. Local response recovery was cleared for privacy.',
          );
        } else
          setNotice(
            'Response delivery could not be confirmed. Retry the same response before changing it.',
          );
      }
    } finally {
      inFlight.current = false;
      if (!task.signal.aborted) setBusy(false);
    }
  }
  const showCompare = section === 'all' || section === 'compare';
  const showEvidence = section === 'all' || section === 'evidence';
  const showRest = section === 'all';
  return (
    <section
      className="delivery-view ux-saved-commercial-report"
      aria-label="Approved saved commercial report"
    >
      {showRest && (
        <a className="text-link ux-back" href="/account#saved-commercial-missions">
          Back to my saved commercial missions
        </a>
      )}
      <p>
        {realCustomerInput()
          ? 'Your submitted information. This is the operator-approved report scope,not automatic access to every company,contact,offer or participant record.'
          : 'Sample data only. This is the operator-approved report scope,not automatic access to every company,contact,offer or participant record.'}{' '}
      </p>
      {status === 'loading' && <p role="status">Opening your approved commercial report…</p>}
      {status === 'denied' && (
        <p role="alert">
          This saved mission is unavailable or access could not be confirmed. No commercial report
          content is shown.
        </p>
      )}
      {status === 'unavailable' && (
        <p role="status">
          Saved commercial reports are temporarily unavailable. Your original invitation is
          separate.
        </p>
      )}
      {status === 'failed' && (
        <p role="alert">Your approved report could not be loaded. Try again.</p>
      )}
      {data && status === 'ready' && (
        <>
          <p>
            Approved purpose: {data.purpose}. Original access expires {displayDate(data.expiresAt)}.
          </p>
          {data.missions.map((m) => (
            <article className="delivery-card ux-participant-mission" key={m.publicationId}>
              {showCompare && (
                <>
                  {showRest && (
                    <>
                      <MissionPassport mission={m} />
                      <h2>Commercial objective</h2>
                      <p>{m.objective}</p>
                      <p>{m.brief}</p>
                    </>
                  )}
                  {m.experience ? (
                    <details className="ux-mission-detail" open>
                      <summary>
                        Companies,qualification,requirements and original quotations
                      </summary>
                      <MissionExperienceView experience={m.experience} lenses={lenses} />
                    </details>
                  ) : (
                    <p>
                      No company shortlist or supplier quotation has been approved for this report
                      yet.
                    </p>
                  )}
                </>
              )}
              {showEvidence && decisionsEnabled && (
                <DecisionHistory subject={subject} issuer={issuer} resourceId={resourceId} />
              )}
              {showRest && (
                <>
                  <h2>Meetings and visits</h2>
                  {m.itinerary.length ? (
                    <ul>
                      {m.itinerary.map((meeting, index) => (
                        <li key={index}>
                          <strong>{meeting.label}</strong> · {meeting.status}
                          <p>
                            {meeting.scheduleChanged
                              ? 'The schedule changed. A new reviewed itinerary is required.'
                              : meeting.startsAt
                                ? displayDate(meeting.startsAt, meeting.timezone ?? 'UTC') +
                                  ' · ' +
                                  (meeting.location ?? 'Location not supplied')
                                : 'No confirmed appointment time supplied.'}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ux-empty">
                      No meetings or visits have been approved for this itinerary yet.
                    </p>
                  )}
                  <h2>Recorded commercial progress</h2>
                  <p>
                    Qualified opportunities: {m.outcomes.qualified}. Proposals:{' '}
                    {m.outcomes.proposals}. Contracts: {m.outcomes.contracts}. Meetings held:{' '}
                    {m.outcomes.heldMeetings}.
                  </p>
                  {m.totals.length ? (
                    <ul>
                      {m.totals.map((t) => (
                        <li key={t.currency}>
                          Customer contracts {displayMoney(t.contractMinor, t.currency)} · Invoices{' '}
                          {displayMoney(t.invoiceMinor, t.currency)} · Confirmed cash{' '}
                          {displayMoney(t.confirmedCashMinor, t.currency)} · Repeat cash{' '}
                          {displayMoney(t.repeatCashMinor, t.currency)} (included in confirmed
                          cash). These are customer trade observations,not Corridra or organiser
                          revenue.
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      No financial amounts are shared in this report. Missing shared amounts do not
                      mean zero.
                    </p>
                  )}
                </>
              )}
              {showEvidence && m.requests && (
                <section>
                  <h2>Evidence requests and declarations</h2>
                  {m.requests.length === 0 ? (
                    <p>No evidence responses are requested.</p>
                  ) : (
                    m.requests.map((q) => (
                      <article key={q.id}>
                        <h3>{q.title}</h3>
                        <p>{q.instructions}</p>
                        <p>
                          {q.status} · Due {displayDate(q.dueAt)}
                        </p>
                        {q.response && <p>Your self-declared response: {q.response}</p>}
                        {(q.status === 'OPEN' || pending?.requestId === q.id) && (
                          <form
                            className="operator-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void respond(q.id);
                            }}
                          >
                            <fieldset disabled={busy || !!pending}>
                              <legend>Reply to this evidence request</legend>
                              <div className="field">
                                <label htmlFor={responsePrefix + q.id}>Your response</label>
                                <textarea
                                  id={responsePrefix + q.id}
                                  name="body"
                                  minLength={3}
                                  maxLength={2000}
                                  required
                                  value={drafts[q.id]?.body ?? ''}
                                  onChange={(event) =>
                                    setDrafts((old) => ({
                                      ...old,
                                      [q.id]: {
                                        body: event.target.value,
                                        acknowledged: old[q.id]?.acknowledged ?? false,
                                      },
                                    }))
                                  }
                                />
                              </div>
                              <label>
                                <input
                                  type="checkbox"
                                  required
                                  checked={drafts[q.id]?.acknowledged ?? false}
                                  onChange={(event) =>
                                    setDrafts((old) => ({
                                      ...old,
                                      [q.id]: {
                                        body: old[q.id]?.body ?? '',
                                        acknowledged: event.target.checked,
                                      },
                                    }))
                                  }
                                />{' '}
                                This is my self-declared response. Supporting documents must follow
                                the operator-controlled review process.
                              </label>
                            </fieldset>
                            <button
                              className="primary-link"
                              disabled={busy || (!!pending && pending.requestId !== q.id)}
                            >
                              {pending?.requestId === q.id
                                ? 'Retry same response'
                                : 'Send response'}
                            </button>
                            {pending?.requestId === q.id && (
                              <button
                                type="button"
                                className="text-link"
                                disabled={busy}
                                onClick={() => {
                                  setPending(null);
                                  setNotice(
                                    'Local retry cleared. This does not cancel or change any response already recorded. Refresh the report before sending different information.',
                                  );
                                }}
                              >
                                Clear local response retry
                              </button>
                            )}
                          </form>
                        )}
                      </article>
                    ))
                  )}
                  <p>
                    Your original private invitation also remains available in{' '}
                    <a className="text-link" href="/account#customer-missions">
                      My shared missions
                    </a>
                    . Responses are self-declarations,not verified conclusions or supplier
                    quotations.
                  </p>
                </section>
              )}
            </article>
          ))}
          <p>{data.attribution}</p>
        </>
      )}
      {status !== 'loading' && (
        <button
          className="text-link"
          type="button"
          onClick={() => {
            setData(null);
            setStatus('loading');
            read();
          }}
        >
          Refresh approved commercial report
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
