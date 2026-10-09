'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DeliveryReport } from '@corridra/delivery/report';
function amount(value: string, currency: string) {
  const places = currency === 'JPY' ? 0 : 2,
    negative = value.startsWith('-'),
    digits = value.replace(/^-/, '').padStart(places + 1, '0');
  return `${currency} ${negative ? '-' : ''}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`;
}
export function DeliveryView({ audience }: { audience: DeliveryReport['audience'] }) {
  const [report, setReport] = useState<DeliveryReport | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const token = useRef(''),
    commands = useRef(new Map<string, string>());
  async function post(input: Record<string, unknown>) {
    const r = await fetch('/api/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, audience, token: token.current }),
    });
    if (!r.ok) throw new Error((await r.json()).error ?? 'The request could not be completed');
    return r;
  }
  async function refresh() {
    const next = await (await post({ action: 'view' })).json();
    setReport(next);
  }
  useEffect(() => {
    token.current = window.location.hash.slice(1);
    let active = true;
    if (!/^[a-f0-9]{64}$/.test(token.current)) {
      Promise.resolve().then(() => {
        if (active) setError('Open the private link shared by your Corridra operator.');
      });
      return () => {
        active = false;
      };
    }
    fetch('/api/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'view', audience, token: token.current }),
    })
      .then(async (r) => {
        const value = await r.json();
        if (!r.ok) throw new Error(value.error);
        if (active) setReport(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [audience]);
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
    setBusy(true);
    setError('');
    const body = String(data.get('body'));
    const key = `response:${requestId}:${body}`;
    try {
      await post({
        action: 'respond',
        requestId,
        body,
        acknowledged: data.get('acknowledged') === 'on',
        commandId: command(key),
      });
      await refresh();
      setNotice('Response received as a self-declaration. Your operator will review it.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  }
  async function download(format: 'CSV' | 'PDF') {
    if (!report) return;
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
      setBusy(false);
    }
  }
  if (!report)
    return <p role={error ? 'alert' : 'status'}>{error || 'Opening your approved view…'}</p>;
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
    <div className="delivery-view">
      {error && <p role="alert">{error}</p>}
      <p role="status">{notice}</p>
      <p>
        {report.programme || 'Your approved mission'} · {report.approvedParticipants} approved{' '}
        {report.approvedParticipants === 1 ? 'participant' : 'participants'}
      </p>
      <p>Purpose: {report.purpose}</p>
      <p>
        Updated {new Date(report.generatedAt).toLocaleString()} · Link expires{' '}
        {new Date(report.expiresAt).toLocaleString()}
      </p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          refresh()
            .catch((e) => {
              setError(e.message);
              setReport(null);
            })
            .finally(() => setBusy(false));
        }}
      >
        Refresh progress
      </button>
      {audience === 'INSTITUTION_REPORT' && (
        <>
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
              <dd>{count.held}</dd>
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
              <button disabled={busy} onClick={() => void download('CSV')}>
                Download CSV
              </button>{' '}
              <button disabled={busy} onClick={() => void download('PDF')}>
                Download PDF
              </button>
            </p>
          )}
        </>
      )}
      {report.missions.map((m) => (
        <article key={m.publicationId} className="delivery-card">
          <h2>
            {m.company}: {m.title}
          </h2>
          <p>Progress: {m.status.replaceAll('_', ' ').toLowerCase()}</p>
          <h3>Mission brief</h3>
          <p>{m.objective}</p>
          <p>{m.brief}</p>
          <h3>Next action</h3>
          <p>
            {m.nextAction} · Due {new Date(m.dueAt).toLocaleString()}
          </p>
          <p>Reviewed {new Date(m.reviewedAt).toLocaleString()}</p>
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
                    {r.status.toLowerCase()} · Due {new Date(r.dueAt).toLocaleString()}
                  </p>
                  {r.response && <p>Your declaration: {r.response}</p>}
                  {r.status === 'OPEN' && (
                    <form onSubmit={(e) => void respond(e, r.id)}>
                      <label>
                        Response
                        <textarea name="body" minLength={3} maxLength={2000} required />
                      </label>
                      <label>
                        <input type="checkbox" name="acknowledged" required /> This response is my
                        declaration. Supporting documents will follow the operator&apos;s controlled
                        collection and review process.
                      </label>
                      <button disabled={busy}>Send response</button>
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
