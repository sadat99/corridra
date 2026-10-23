'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DeliveryReport } from '@corridra/delivery/report';
import { displayMoney as amount, displayDate } from '@corridra/domain/locale';
import {
  usePrivateCapability,
  checkedResponse,
  accessDenied,
} from '../components/private-capability';
import { AccessState } from '../components/access-state';
import { ParticipantScope } from '../components/participant-scope';
import { OperatorWorkbench } from '../components/operator-workbench';
import { MissionPassport } from '../components/mission-passport';
import { MissionExperienceView, AgendaView } from './mission-experience-view';
export function DeliveryView({
  audience,
  capability,
  endpoint = '/api/delivery',
}: {
  audience: DeliveryReport['audience'];
  capability?: string;
  endpoint?: string;
}) {
  const scope = usePrivateCapability(capability);
  return (
    <ScopedDeliveryView
      key={`${endpoint}:${audience}:${scope}`}
      audience={audience}
      capability={scope}
      endpoint={endpoint}
    />
  );
}
function ScopedDeliveryView({
  audience,
  capability,
  endpoint,
}: {
  audience: DeliveryReport['audience'];
  capability: string;
  endpoint: string;
}) {
  const [report, setReport] = useState<DeliveryReport | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [readInterrupted, setReadInterrupted] = useState(false),
    [failureKind, setFailureKind] = useState<'denied' | 'unavailable'>('unavailable');
  const [pendingResponse, setPendingResponse] = useState<{
    requestId: string;
    body: string;
    acknowledged: boolean;
    commandId: string;
  } | null>(null);
  const inFlight = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);
  const token = useRef(''),
    commands = useRef(new Map<string, string>());
  async function post(input: Record<string, unknown>) {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, audience, token: token.current }),
    });
    try {
      return await checkedResponse(r);
    } catch (e) {
      if (accessDenied(e)) {
        setReport(null);
        setFailureKind('denied');
      }
      throw e;
    }
  }
  async function refresh() {
    const next = await (await post({ action: 'view' })).json();
    setReport(next);
    setReadInterrupted(false);
    setError('');
  }
  useEffect(() => {
    token.current = capability;
    let active = true;
    const controller = new AbortController();
    if (!/^[a-f0-9]{64}$/.test(token.current)) {
      Promise.resolve().then(() => {
        if (active) {
          setFailureKind('denied');
          setError('Open the private link shared by your Corridra operator.');
        }
      });
      return () => {
        active = false;
      };
    }
    fetch(endpoint, {
      signal: controller.signal,
      cache: 'no-store',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'view', audience, token: token.current }),
    })
      .then(async (r) => {
        await checkedResponse(r);
        const value = await r.json();
        if (active) setReport(value);
      })
      .catch((e) => {
        if (active) {
          setFailureKind(accessDenied(e) ? 'denied' : 'unavailable');
          setError(e.message);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [audience, capability, endpoint]);
  function command(key: string) {
    let id = commands.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      commands.current.set(key, id);
    }
    return id;
  }
  async function respond(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    if (
      inFlight.current ||
      readInterrupted ||
      (pendingResponse && pendingResponse.requestId !== requestId)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const body = String(data.get('body'));
    const key = `response:${requestId}:${body}`;
    const request = pendingResponse ?? {
      requestId,
      body,
      acknowledged: data.get('acknowledged') === 'on',
      commandId: command(key),
    };
    setPendingResponse(request);
    try {
      await post({ action: 'respond', ...request });
      setPendingResponse(null);
      setNotice('Response received as a self-declaration. Your operator will review it.');
      await refresh().catch((e) => {
        setReadInterrupted(true);
        setError(e.message);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function download(format: 'CSV' | 'PDF') {
    if (!report) return;
    if (inFlight.current || readInterrupted) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await post({
        action: 'export',
        format,
        purpose: report.purpose,
        commandId: command(`export:${format}`),
      });
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement('a');
      a.href = url;
      a.download = `corridra-programme.${format.toLowerCase()}`;
      document.body.append(a);
      a.click();
      a.remove();
      // Allow the browser to consume the blob before releasing its URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNotice('Report downloaded for the approved reporting purpose.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!report)
    return (
      <AccessState kind={error ? failureKind : 'loading'}>
        <p ref={feedback} tabIndex={-1}>
          {error || 'Opening your approved view…'}
        </p>
        {error && (
          <>
            <p>
              Use the original private link. If it expired or was revoked, ask the person who shared
              it for a new reviewed link.
            </p>
            {
              <button
                className="text-link"
                disabled={busy}
                onClick={() => {
                  token.current = capability;
                  if (!/^[a-f0-9]{64}$/.test(token.current)) {
                    setError('Open the private link shared by your Corridra operator.');
                    return;
                  }
                  if (inFlight.current) return;
                  inFlight.current = true;
                  setBusy(true);
                  void refresh()
                    .then(() => setError(''))
                    .catch((e) => setError(e.message))
                    .finally(() => {
                      inFlight.current = false;
                      setBusy(false);
                    });
                }}
              >
                Retry approved view
              </button>
            }
            <Link className="text-link" href="/account">
              Customer account
            </Link>
            <Link className="text-link" href="/">
              Back to Corridra
            </Link>
          </>
        )}
      </AccessState>
    );
  const count = report.missions.reduce(
    (sum, m) => ({
      held: sum.held + m.outcomes.heldMeetings,
      qualified: sum.qualified + m.outcomes.qualified,
      proposals: sum.proposals + m.outcomes.proposals,
      contracts: sum.contracts + m.outcomes.contracts,
    }),
    { held: 0, qualified: 0, proposals: 0, contracts: 0 },
  );
  return (
    <div className="delivery-view ux-delivery" data-operator-workbench>
      {error && (
        <p ref={feedback} tabIndex={-1} className="ux-error-summary" role="alert">
          {error}
        </p>
      )}
      {readInterrupted && (
        <p>
          Progress could not be refreshed. This is the last approved view. Refresh before sending
          another response or export.
        </p>
      )}
      <p role="status">{notice}</p>
      {report.purpose === 'synthetic_validation' && (
        <p className="evidence-label">
          Sample data. The people and companies in this report are invented.
        </p>
      )}
      <OperatorWorkbench
        label="Approved report sections"
        sections={[
          { label: 'Sharing scope', heading: 'Approved sharing scope' },
          ...(audience === 'INSTITUTION_REPORT'
            ? [{ label: 'Programme overview', heading: 'Programme overview' }]
            : []),
          ...(report.missions.length
            ? [
                { label: 'Next decision', heading: 'Next action' },
                { label: 'Mission request', heading: 'Mission request' },
              ]
            : []),
          ...(report.missions.some((m) => m.experience)
            ? [
                { label: 'Requirements', heading: 'Requirements and decisions' },
                { label: 'Supplier offers', heading: 'Original quotations and comparison' },
              ]
            : []),
          ...(report.delegation
            ? [{ label: 'Delegation agenda', heading: 'Approved delegation agenda' }]
            : []),
          ...(report.missions.length ? [{ label: 'Itinerary', heading: 'Itinerary' }] : []),
          ...(report.missions.some((m) => m.requests)
            ? [{ label: 'Evidence requests', heading: 'Evidence requests' }]
            : []),
        ]}
      />
      <ParticipantScope
        purpose={report.purpose}
        expiresAt={report.expiresAt}
        generatedAt={report.generatedAt}
        audience={
          audience === 'CLIENT_PROGRESS'
            ? 'Client mission progress'
            : 'Institution programme report'
        }
      />
      <p>
        {report.programme || 'Your approved mission'} · {report.approvedParticipants} approved{' '}
        {report.approvedParticipants === 1 ? 'participant' : 'participants'}
      </p>
      <p>Purpose: {report.purpose}</p>
      <p>
        Updated {displayDate(report.generatedAt)} · Link expires {displayDate(report.expiresAt)}
      </p>
      <button
        disabled={busy}
        onClick={() => {
          if (inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          refresh()
            .catch((e) => {
              setError(e.message);
              setReadInterrupted(true);
            })
            .finally(() => {
              inFlight.current = false;
              setBusy(false);
            });
        }}
      >
        Refresh progress
      </button>
      {audience === 'INSTITUTION_REPORT' && (
        <section className="ux-programme-overview" aria-labelledby="programme-overview-title">
          <div className="ux-programme-heading">
            <div>
              <p className="label">APPROVED PROGRAMME</p>
              <h2 id="programme-overview-title">Programme overview</h2>
              <p>{report.programme || 'Approved participant report'}</p>
            </div>
            <p className="ux-scope-note">
              Only the approved participants and publications in this private view are counted.
              Attendance, contracts and cash remain separate observations.
            </p>
          </div>
          <dl className="delivery-metrics">
            <div>
              <dt>Approved companies</dt>
              <dd>{report.approvedCompanies}</dd>
            </div>
            <div>
              <dt>Qualified counterparties</dt>
              <dd>{report.qualifiedCounterparties}</dd>
            </div>
            <div>
              <dt>Qualified opportunities</dt>
              <dd>{count.qualified}</dd>
            </div>
            <div>
              <dt>Held meetings</dt>
              <dd>{report.heldMeetingsDistinct ?? count.held}</dd>
            </div>
            <div>
              <dt>Proposals reached</dt>
              <dd>{count.proposals}</dd>
            </div>
            <div>
              <dt>Contracts reached</dt>
              <dd>{count.contracts}</dd>
            </div>
          </dl>
          {report.companyCountBasis && (
            <p>
              {report.companyCountBasis} Shared agenda activities count once; participant
              engagements remain separate.
            </p>
          )}
          {report.totals.length > 0 && (
            <>
              <h2>Approved programme totals</h2>
              <ul>
                {report.totals.map((t) => (
                  <li key={t.currency}>
                    Contracts {amount(t.contractMinor, t.currency)} · Invoices{' '}
                    {amount(t.invoiceMinor, t.currency)} · Confirmed cash{' '}
                    {amount(t.confirmedCashMinor, t.currency)} · Repeat cash{' '}
                    {amount(t.repeatCashMinor, t.currency)} (included)
                  </li>
                ))}
              </ul>
            </>
          )}
          {report.allowExport && (
            <p>
              <button disabled={busy || readInterrupted} onClick={() => void download('CSV')}>
                Download CSV
              </button>{' '}
              <button disabled={busy || readInterrupted} onClick={() => void download('PDF')}>
                Download PDF
              </button>
            </p>
          )}
        </section>
      )}
      {report.delegation && (
        <section>
          <h2>Approved delegation agenda</h2>
          {report.delegation.context && (
            <>
              <p>Organiser: {report.delegation.context.organiser}</p>
              <p>{report.delegation.context.purpose}</p>
              <p>
                {displayDate(
                  report.delegation.context.startsAt,
                  report.delegation.context.timezone,
                )}{' '}
                to{' '}
                {displayDate(report.delegation.context.endsAt, report.delegation.context.timezone)}
              </p>
            </>
          )}
          <AgendaView agenda={report.delegation.agenda} />
        </section>
      )}
      {report.missions.map((m) => (
        <article key={m.publicationId} className="delivery-card ux-participant-mission">
          <MissionPassport mission={m} />
          <h3>Mission request</h3>
          <p>{m.objective}</p>
          <p>{m.brief}</p>
          {m.experience && (
            <details className="ux-mission-detail">
              <summary>Requirements, targets and original supplier offers</summary>
              <MissionExperienceView experience={m.experience} />
            </details>
          )}
          <h3>Itinerary</h3>
          {m.itinerary.length ? (
            <ul>
              {m.itinerary.map((mt, i) => (
                <li key={`${mt.label}-${i}`}>
                  <strong>{mt.label}</strong> · {mt.status.toLowerCase().replaceAll('_', ' ')}
                  <p>
                    {mt.scheduleChanged
                      ? 'Schedule changed. Please await an updated itinerary from your operator.'
                      : mt.startsAt
                        ? `${new Date(mt.startsAt).toLocaleString('en', { timeZone: mt.timezone })} (${mt.timezone}) · ${mt.location ?? 'Location to be confirmed'}`
                        : 'Schedule to be confirmed.'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No meetings have been approved for this itinerary yet.</p>
          )}
          {m.totals.length > 0 && (
            <>
              <h3>Recorded commercial outcomes</h3>
              <ul>
                {m.totals.map((t) => (
                  <li key={t.currency}>
                    Contracts {amount(t.contractMinor, t.currency)} · Invoices{' '}
                    {amount(t.invoiceMinor, t.currency)} · Confirmed cash{' '}
                    {amount(t.confirmedCashMinor, t.currency)} · Repeat cash{' '}
                    {amount(t.repeatCashMinor, t.currency)} (included in confirmed cash)
                  </li>
                ))}
              </ul>
            </>
          )}
          {m.requests && (
            <>
              <h3>Evidence requests</h3>
              {m.requests.length === 0 && <p>No evidence responses are requested.</p>}
              {m.requests.map((r) => (
                <section key={r.id}>
                  <h4>{r.title}</h4>
                  <p>{r.instructions}</p>
                  <p>
                    {r.status.toLowerCase()} · Due {displayDate(r.dueAt)}
                  </p>
                  {r.response && <p>Your declaration: {r.response}</p>}
                  {r.status === 'OPEN' && (
                    <form className="operator-form" onSubmit={(e) => void respond(e, r.id)}>
                      <fieldset disabled={busy || readInterrupted || !!pendingResponse}>
                        <legend className="sr-only">Evidence response</legend>
                        <label>
                          Response
                          <textarea name="body" minLength={3} maxLength={2000} required />
                        </label>
                        <label>
                          <input type="checkbox" name="acknowledged" required /> This response is my
                          declaration. Supporting documents will follow the operator&apos;s
                          controlled collection and review process.
                        </label>
                      </fieldset>
                      <button
                        disabled={
                          busy ||
                          readInterrupted ||
                          (!!pendingResponse && pendingResponse.requestId !== r.id)
                        }
                      >
                        {pendingResponse?.requestId === r.id
                          ? 'Retry same evidence response'
                          : 'Send response'}
                      </button>
                    </form>
                  )}
                </section>
              ))}
            </>
          )}
        </article>
      ))}
      <p className="delivery-attribution">{report.attribution}</p>
    </div>
  );
}
