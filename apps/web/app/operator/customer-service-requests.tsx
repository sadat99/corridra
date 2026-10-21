'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { displayMoney, displayDate } from '@corridra/domain/locale';
import { CustomerServiceCatalogue } from './customer-service-catalogue';

type Summary = {
  id: string;
  workspaceName?: string;
  serviceTitle: string;
  contextKind: string;
  contextLabel: string;
  status: string;
  region: string;
  updatedAt: string;
  claimed?: boolean;
};
type Component = {
  position: number;
  kind: string;
  label: string;
  treatment: string;
  amountMinor: string | null;
};
type Quote = {
  version: number;
  currency: string;
  components: Component[];
  fixedTotalMinor: string;
  estimatedTotalMinor: string;
  exclusions: string[];
  assumptions: string[];
  scope: string;
  validUntil: string;
  expired: boolean;
};
type Detail = {
  request: Summary & { claimedByThisTeam: boolean };
  service: { title: string };
  need: { text: string; preferredFrom: string | null; preferredTo: string | null; region: string };
  quotes: Quote[];
  orderIntent: { quoteVersion: number; fixedTotalMinor: string; currency: string } | null;
  events: {
    seq: number;
    at: string;
    kind: string;
    status: string;
    actorKind: string;
    customerNote: string | null;
    internalNote: string | null;
    quoteVersion: number | null;
  }[];
  lastSeq: number;
};
type Row = { kind: string; label: string; treatment: string; amount: string };
const starter = 'Synthetic ';
const currencies = ['USD', 'EUR', 'GBP', 'BDT', 'JPY'];
const kinds: [string, string][] = [
  ['service_fee', 'Service fee'],
  ['local_cost', 'Local cost'],
  ['pass_through', 'Pass-through cost'],
  ['tax', 'Tax'],
];
const treatments: [string, string][] = [
  ['included', 'Included in the price'],
  ['estimate', 'Estimate on top'],
  ['not_included', 'Not included'],
];
const progressActions: Record<string, [string, string][]> = {
  requested: [['answer', 'Answer a question']],
  quoted: [['answer', 'Answer a question']],
  expired: [['answer', 'Answer a question']],
  accepted: [
    ['start', 'Start the work'],
    ['answer', 'Answer a question'],
    ['close', 'Close without delivering'],
  ],
  in_progress: [
    ['update', 'Add a progress update'],
    ['deliver', 'Mark as delivered'],
    ['answer', 'Answer a question'],
    ['close', 'Close without delivering'],
  ],
  delivered: [
    ['close', 'Close the request'],
    ['answer', 'Answer a question'],
  ],
};
const emptyRow = (): Row => ({
  kind: 'service_fee',
  label: starter,
  treatment: 'included',
  amount: '',
});
function money(minor: string | null, currency: string) {
  if (minor === null) return 'not stated';
  try {
    return displayMoney(minor, currency);
  } catch {
    return minor + ' ' + currency;
  }
}
function lines(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
function plainError(status: number | null) {
  return status === 401 || status === 403
    ? 'Owner or admin access with a fresh authenticator check is required.'
    : status === 503
      ? 'Paid-service requests are unavailable.'
      : status === 409
        ? 'The request changed or the details were refused. Reload and check the quote.'
        : status === 400
          ? 'Check the details. Every free-text field starts with Synthetic and amounts are whole minor units.'
          : 'This could not be completed. Try again.';
}

export function CustomerServiceRequests({ tenant }: { tenant: string }) {
  return <Scoped key={tenant} tenant={tenant} />;
}
function Scoped({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<Summary[] | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [fault, setFault] = useState(''),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [note, setNote] = useState(starter),
    [progress, setProgress] = useState(''),
    [internal, setInternal] = useState(starter);
  const [currency, setCurrency] = useState('USD'),
    [parts, setParts] = useState<Row[]>([
      emptyRow(),
      { kind: 'tax', label: starter, treatment: 'not_included', amount: '' },
    ]),
    [scope, setScope] = useState(starter),
    [exclusions, setExclusions] = useState(starter),
    [assumptions, setAssumptions] = useState(starter),
    [delivery, setDelivery] = useState(starter),
    [payment, setPayment] = useState(starter),
    [valid, setValid] = useState('');
  const task = useRef<AbortController | null>(null);
  const endpoint = '/api/workspace/customer-service-requests?tenant=' + encodeURIComponent(tenant);
  const call = useCallback(
    async (query: string, body?: Record<string, unknown>) => {
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      try {
        const r = await fetch(endpoint + query, {
          method: body ? 'POST' : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: body ? { 'content-type': 'application/json' } : undefined,
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return null;
        if (!r.ok) return { status: r.status, body: null as unknown };
        return { status: 200, body: (await r.json()) as unknown };
      } catch {
        return controller.signal.aborted ? null : { status: 0, body: null as unknown };
      }
    },
    [endpoint],
  );
  const loadList = useCallback(async () => {
    const r = await call('&scope=list');
    if (!r) return;
    if (r.status !== 200) {
      setRows(null);
      setFault(plainError(r.status));
      return;
    }
    const body = r.body as { requests?: Summary[] };
    if (!Array.isArray(body.requests)) {
      setFault(plainError(0));
      return;
    }
    setFault('');
    setRows(body.requests);
  }, [call]);
  const open = useCallback(
    async (id: string) => {
      const r = await call('&scope=detail&request=' + encodeURIComponent(id));
      if (!r) return;
      if (r.status !== 200) {
        setDetail(null);
        setFault(plainError(r.status));
        return;
      }
      const body = r.body as Detail;
      if (!body?.request || body.request.id !== id || !Array.isArray(body.events)) {
        setFault(plainError(0));
        return;
      }
      setFault('');
      setDetail(body);
    },
    [call],
  );
  useEffect(() => {
    void Promise.resolve().then(() => loadList());
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        task.current?.abort();
        setDetail(null);
        setRows(null);
        setMessage('Customer details were cleared while you were away. Reload to continue.');
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      task.current?.abort();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [loadList]);
  async function send(body: Record<string, unknown>) {
    if (busy || !detail) return;
    setPending(body);
    setBusy(true);
    setMessage('');
    const r = await call('', body);
    setBusy(false);
    if (!r) return;
    if (r.status !== 200) {
      const unsure = r.status === 0 || (r.status >= 500 && r.status !== 503);
      if (!unsure) setPending(null);
      setMessage(
        unsure
          ? 'Could not confirm that this was saved. Send the same action again; it cannot be done twice.'
          : plainError(r.status),
      );
      return;
    }
    setPending(null);
    setMessage('Saved.');
    setNote(starter);
    setInternal(starter);
    // One request at a time: the shared call helper cancels the previous one.
    await open(detail.request.id);
    await loadList();
  }
  const base = () =>
    detail
      ? {
          requestId: detail.request.id,
          expectedSeq: detail.lastSeq,
          commandId: crypto.randomUUID(),
        }
      : null;
  function submitQuote(e: FormEvent) {
    e.preventDefault();
    const b = base();
    if (!b || !valid) return;
    void send(
      pending ?? {
        action: 'quote',
        ...b,
        currency,
        components: parts.map((p) => ({
          kind: p.kind,
          label: p.label.trim(),
          treatment: p.treatment,
          amountMinor: p.amount.trim() === '' ? null : p.amount.trim(),
        })),
        scope: scope.trim(),
        exclusions: lines(exclusions),
        assumptions: lines(assumptions),
        deliveryTerms: delivery.trim(),
        paymentTerms: payment.trim(),
        validUntil: valid + 'T23:59:59.000Z',
      },
    );
  }
  function submitProgress(e: FormEvent) {
    e.preventDefault();
    const b = base();
    if (!b || !progress) return;
    void send(pending ?? { action: progress, ...b, customerNote: note.trim() });
  }
  function submitInternal(e: FormEvent) {
    e.preventDefault();
    const b = base();
    if (!b) return;
    void send(pending ?? { action: 'note', ...b, internalNote: internal.trim() });
  }
  const status = detail?.request.status ?? '';
  const latest = detail?.quotes.at(-1) ?? null;
  const edit = (set: () => void) => {
    set();
    setPending(null);
  };
  return (
    <section aria-label="Customer paid-service requests" className="detail-card">
      <h3>Customer paid-service requests</h3>
      <p>
        Sample requests from customers. A quote lists every cost, what is left out and what it
        assumes. Accepting a quote records an order intent only: no payment, no invoice, no billing.
      </p>
      {fault && <p role="alert">{fault}</p>}
      {message && <p role={message === 'Saved.' ? 'status' : 'alert'}>{message}</p>}
      {rows === null && !fault && <p role="status">Loading customer requests…</p>}
      {rows && rows.length === 0 && <p>No customer requests are waiting.</p>}
      {rows && rows.length > 0 && (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <strong>{r.serviceTitle}</strong> · {r.workspaceName} · {r.contextLabel} · {r.region}{' '}
              · <span>{r.status.replace('_', ' ')}</span>{' '}
              {r.claimed ? '· handled by your team' : '· not yet taken'}{' '}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setPending(null);
                  setMessage('');
                  void open(r.id);
                }}
              >
                Open {r.serviceTitle} for {r.workspaceName}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="text-link" onClick={() => void loadList()}>
        Reload the list
      </button>

      {detail && (
        <article aria-label="Selected customer request">
          <h4>
            {detail.service.title} for {detail.request.workspaceName}
          </h4>
          <p>
            Status: <strong>{status.replace('_', ' ')}</strong> · {detail.request.contextLabel} ·{' '}
            {detail.need.region}
          </p>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.need.text}</p>
          <p>
            Preferred dates:{' '}
            {detail.need.preferredFrom
              ? displayDate(detail.need.preferredFrom) +
                (detail.need.preferredTo
                  ? ' to ' + displayDate(detail.need.preferredTo)
                  : ' or later')
              : 'no preference'}
          </p>
          {detail.orderIntent && (
            <p>
              Order intent: quote version {detail.orderIntent.quoteVersion}, fixed price{' '}
              {money(detail.orderIntent.fixedTotalMinor, detail.orderIntent.currency)}. No payment
              taken, billing not enabled.
            </p>
          )}
          {latest && (
            <section aria-label="Latest quote">
              <h5>
                Latest quote, version {latest.version}
                {latest.expired ? ' (expired)' : ''}
              </h5>
              <p>{latest.scope}</p>
              <ul>
                {latest.components.map((c) => (
                  <li key={c.position}>
                    {c.label}:{' '}
                    {c.treatment === 'not_included'
                      ? 'not included'
                      : money(c.amountMinor, latest.currency)}{' '}
                    ({c.kind.replace('_', ' ')}, {c.treatment.replace('_', ' ')})
                  </li>
                ))}
              </ul>
              <p>
                Fixed {money(latest.fixedTotalMinor, latest.currency)}, estimates{' '}
                {money(latest.estimatedTotalMinor, latest.currency)}. Valid until{' '}
                {displayDate(latest.validUntil)}.
              </p>
            </section>
          )}
          <h5>Timeline, including internal notes</h5>
          <ol>
            {detail.events.map((e) => (
              <li key={e.seq}>
                {e.kind.replace('_', ' ')} · {e.actorKind} · {displayDate(e.at)}
                {e.customerNote && <> · customer sees: {e.customerNote}</>}
                {e.internalNote && <> · internal only: {e.internalNote}</>}
              </li>
            ))}
          </ol>

          {['requested', 'quoted', 'expired'].includes(status) && (
            <form onSubmit={submitQuote} aria-label="Prepare a quote">
              <fieldset disabled={busy}>
                <legend>{latest ? 'Prepare a new quote version' : 'Prepare a quote'}</legend>
                <p>
                  Amounts are whole minor units (for example 4500 is 45.00). A tax line is required:
                  mark it Not included if tax is left out.
                </p>
                <label className="field">
                  Currency
                  <select
                    value={currency}
                    onChange={(e) => edit(() => setCurrency(e.target.value))}
                  >
                    {currencies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                {parts.map((p, index) => (
                  <fieldset key={index}>
                    <legend>Cost {index + 1}</legend>
                    <label className="field">
                      Kind
                      <select
                        value={p.kind}
                        onChange={(e) =>
                          edit(() =>
                            setParts(
                              parts.map((x, i) =>
                                i === index ? { ...x, kind: e.target.value } : x,
                              ),
                            ),
                          )
                        }
                      >
                        {kinds.map(([v, t]) => (
                          <option key={v} value={v}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Label (start with Synthetic)
                      <input
                        required
                        minLength={11}
                        maxLength={200}
                        value={p.label}
                        onChange={(e) =>
                          edit(() =>
                            setParts(
                              parts.map((x, i) =>
                                i === index ? { ...x, label: e.target.value } : x,
                              ),
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      How it is counted
                      <select
                        value={p.treatment}
                        onChange={(e) =>
                          edit(() =>
                            setParts(
                              parts.map((x, i) =>
                                i === index ? { ...x, treatment: e.target.value } : x,
                              ),
                            ),
                          )
                        }
                      >
                        {treatments.map(([v, t]) => (
                          <option key={v} value={v}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Amount in minor units {p.treatment === 'not_included' ? '(optional)' : ''}
                      <input
                        inputMode="numeric"
                        pattern="(0|[1-9][0-9]{0,10})"
                        required={p.treatment !== 'not_included'}
                        value={p.amount}
                        onChange={(e) =>
                          edit(() =>
                            setParts(
                              parts.map((x, i) =>
                                i === index ? { ...x, amount: e.target.value } : x,
                              ),
                            ),
                          )
                        }
                      />
                    </label>
                    {parts.length > 2 && (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => edit(() => setParts(parts.filter((_, i) => i !== index)))}
                      >
                        Remove cost {index + 1}
                      </button>
                    )}
                  </fieldset>
                ))}
                {parts.length < 12 && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => edit(() => setParts([...parts, emptyRow()]))}
                  >
                    Add another cost
                  </button>
                )}
                <label className="field">
                  Scope (start with Synthetic)
                  <textarea
                    required
                    minLength={11}
                    maxLength={1000}
                    rows={3}
                    value={scope}
                    onChange={(e) => edit(() => setScope(e.target.value))}
                  />
                </label>
                <label className="field">
                  Left out, one per line (each starts with Synthetic)
                  <textarea
                    required
                    rows={3}
                    value={exclusions}
                    onChange={(e) => edit(() => setExclusions(e.target.value))}
                  />
                </label>
                <label className="field">
                  Assumptions, one per line (each starts with Synthetic)
                  <textarea
                    required
                    rows={3}
                    value={assumptions}
                    onChange={(e) => edit(() => setAssumptions(e.target.value))}
                  />
                </label>
                <label className="field">
                  Delivery terms (start with Synthetic)
                  <input
                    required
                    minLength={11}
                    maxLength={500}
                    value={delivery}
                    onChange={(e) => edit(() => setDelivery(e.target.value))}
                  />
                </label>
                <label className="field">
                  Payment terms, described only (start with Synthetic)
                  <input
                    required
                    minLength={11}
                    maxLength={500}
                    value={payment}
                    onChange={(e) => edit(() => setPayment(e.target.value))}
                  />
                </label>
                <label className="field">
                  Valid until (end of this day, UTC)
                  <input
                    type="date"
                    required
                    value={valid}
                    onChange={(e) => edit(() => setValid(e.target.value))}
                  />
                </label>
              </fieldset>
              <button type="submit" className="button" disabled={busy || !valid}>
                {pending ? 'Send the same quote again' : 'Send the quote to the customer'}
              </button>
            </form>
          )}

          {progressActions[status] && (
            <form onSubmit={submitProgress} aria-label="Tell the customer">
              <fieldset disabled={busy}>
                <legend>Tell the customer</legend>
                <label className="field">
                  What happened
                  <select
                    value={progress}
                    required
                    onChange={(e) => edit(() => setProgress(e.target.value))}
                  >
                    <option value="">Choose</option>
                    {progressActions[status].map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Note the customer will read (start with Synthetic)
                  <textarea
                    required
                    minLength={11}
                    maxLength={1000}
                    rows={3}
                    value={note}
                    onChange={(e) => edit(() => setNote(e.target.value))}
                  />
                </label>
              </fieldset>
              <button type="submit" className="button" disabled={busy || !progress}>
                Send to the customer
              </button>
            </form>
          )}

          {!['declined', 'withdrawn', 'closed'].includes(status) && (
            <form onSubmit={submitInternal} aria-label="Internal note">
              <fieldset disabled={busy}>
                <legend>Internal note (the customer never sees this)</legend>
                <label className="field">
                  Note (start with Synthetic)
                  <textarea
                    required
                    minLength={11}
                    maxLength={1000}
                    rows={2}
                    value={internal}
                    onChange={(e) => edit(() => setInternal(e.target.value))}
                  />
                </label>
              </fieldset>
              <button type="submit" className="button button-secondary" disabled={busy}>
                Save internal note
              </button>
            </form>
          )}
        </article>
      )}
      <CustomerServiceCatalogue tenant={tenant} />
    </section>
  );
}
