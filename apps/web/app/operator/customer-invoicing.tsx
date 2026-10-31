'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { displayMoney } from '@corridra/domain/locale';

type Period = {
  subscriptionId: string;
  workspaceName: string;
  planTitle: string;
  interval: string;
  periodStart: string;
  periodEnd: string;
  priceMinor: string;
  currency: string;
  taxTreatment: string;
};
type Invoice = {
  id: string;
  number: string;
  workspaceName?: string;
  planTitle: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  taxTreatment: string;
  planFeeMinor: string;
  taxMinor: string | null;
  totalMinor: string;
  paidMinor: string;
  creditedMinor: string;
  outstandingMinor: string;
  status: string;
  overdue: boolean;
  position: number;
  payments: {
    seq: number;
    amountMinor: string;
    receivedOn: string;
    method: string;
    reference: string;
  }[];
  credits: { seq: number; number: string; amountMinor: string; issuedOn: string; reason: string }[];
};
type Detail = {
  invoice: Invoice;
  actions: string[];
  workspaceBalances: {
    currency: string;
    invoicedMinor: string;
    paidMinor: string;
    creditedMinor: string;
    outstandingMinor: string;
    overdueMinor: string;
  }[];
};
const starter = 'Synthetic ';
const methods: [string, string][] = [
  ['bank_transfer', 'Bank transfer'],
  ['cash', 'Cash'],
  ['other', 'Other'],
];
const taxLine: Record<string, string> = {
  price_excludes_tax: 'price excludes tax, so the tax you state is added to the total',
  price_includes_tax: 'price includes tax, so the tax you state is inside the price',
  tax_to_be_confirmed: 'tax is to be confirmed, so no tax amount is stated',
};
function money(minor: string, currency: string) {
  try {
    return displayMoney(minor, currency);
  } catch {
    return minor + ' ' + currency;
  }
}
function plainError(status: number | null) {
  return status === 401 || status === 403
    ? 'Owner or admin access with a fresh authenticator check is required.'
    : status === 503
      ? 'Invoices are unavailable.'
      : status === 409
        ? 'The invoice or period changed, or the details were refused. Reload and check.'
        : status === 400
          ? 'Check the details. Amounts are whole minor units, text starts with Synthetic, the fee must equal the plan price and the due date is within 90 days.'
          : 'This could not be completed. Try again.';
}
// Dates on an invoice are calendar days, so they are written as days and never shifted by a time zone.
function displayDate(day: string) {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export function CustomerInvoicing({ tenant }: { tenant: string }) {
  return <Scoped key={tenant} tenant={tenant} />;
}
function Scoped({ tenant }: { tenant: string }) {
  const [periods, setPeriods] = useState<Period[] | null>(null),
    [rows, setRows] = useState<Invoice[] | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [preparing, setPreparing] = useState<Period | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [fault, setFault] = useState(''),
    [off, setOff] = useState(false),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [tax, setTax] = useState('0'),
    [due, setDue] = useState(inDays(14)),
    [amount, setAmount] = useState(''),
    [received, setReceived] = useState(today()),
    [method, setMethod] = useState('bank_transfer'),
    [reference, setReference] = useState(starter),
    [creditAmount, setCreditAmount] = useState(''),
    [reason, setReason] = useState(starter);
  const task = useRef<AbortController | null>(null);
  const endpoint = '/api/workspace/customer-billing?tenant=' + encodeURIComponent(tenant);
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
  const loadAll = useCallback(async () => {
    const p = await call('&scope=pending');
    if (!p) return;
    if (p.status === 503) {
      setOff(true);
      return;
    }
    const pb = p.body as { periods?: Period[] } | null;
    if (p.status !== 200 || !pb || !Array.isArray(pb.periods)) {
      setPeriods(null);
      setFault(plainError(p.status));
      return;
    }
    const l = await call('&scope=invoices');
    if (!l) return;
    const lb = l.body as { invoices?: Invoice[] } | null;
    if (l.status !== 200 || !lb || !Array.isArray(lb.invoices)) {
      setRows(null);
      setFault(plainError(l.status));
      return;
    }
    setFault('');
    setPeriods(pb.periods);
    setRows(lb.invoices);
  }, [call]);
  const open = useCallback(
    async (id: string) => {
      const r = await call('&scope=invoice&invoiceId=' + encodeURIComponent(id));
      if (!r) return;
      const body = r.body as Detail | null;
      if (r.status !== 200 || !body?.invoice || body.invoice.id !== id) {
        setDetail(null);
        setFault(plainError(r.status === 200 ? 0 : r.status));
        return;
      }
      setFault('');
      setDetail(body);
    },
    [call],
  );
  useEffect(() => {
    void Promise.resolve().then(() => loadAll());
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        task.current?.abort();
        setDetail(null);
        setRows(null);
        setPeriods(null);
        setPreparing(null);
        setMessage('Customer details were cleared while you were away. Reload to continue.');
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      task.current?.abort();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [loadAll]);
  async function send(body: Record<string, unknown>) {
    if (busy) return;
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
    const saved = r.body as { id?: string } | null;
    setPending(null);
    setMessage('Saved.');
    setPreparing(null);
    setAmount('');
    setCreditAmount('');
    setReference(starter);
    setReason(starter);
    if (typeof saved?.id === 'string') await open(saved.id);
    await loadAll();
  }
  const change = (set: () => void) => {
    set();
    setPending(null);
  };
  function prepare(p: Period) {
    setPending(null);
    setMessage('');
    setPreparing(p);
    setTax(p.taxTreatment === 'tax_to_be_confirmed' ? '' : '0');
    setDue(inDays(14));
  }
  function submitIssue(e: FormEvent) {
    e.preventDefault();
    if (!preparing) return;
    void send(
      pending ?? {
        action: 'issue',
        commandId: crypto.randomUUID(),
        subscriptionId: preparing.subscriptionId,
        periodStart: preparing.periodStart,
        planFeeMinor: preparing.priceMinor,
        taxMinor: preparing.taxTreatment === 'tax_to_be_confirmed' ? null : tax.trim(),
        dueOn: due,
      },
    );
  }
  function submitPayment(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    void send(
      pending ?? {
        action: 'payment',
        commandId: crypto.randomUUID(),
        invoiceId: detail.invoice.id,
        expectedPosition: detail.invoice.position,
        amountMinor: amount.trim(),
        receivedOn: received,
        method,
        reference: reference.trim(),
      },
    );
  }
  function submitCredit(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    void send(
      pending ?? {
        action: 'credit',
        commandId: crypto.randomUUID(),
        invoiceId: detail.invoice.id,
        expectedPosition: detail.invoice.position,
        amountMinor: creditAmount.trim(),
        reason: reason.trim(),
      },
    );
  }
  if (off) return null;
  const can = (a: string) => !!detail && detail.actions.includes(a);
  const inv = detail?.invoice ?? null;
  return (
    <section aria-label="Customer sample invoices" className="detail-card" data-madeup-panel>
      <h3>Customer sample invoices (madeup)</h3>
      <p>
        Sample invoices for plan periods you activated. They record what is asked for, what the team
        says was received and any credit. Nothing is collected and no money moves. Every note starts
        with Synthetic.
      </p>
      {fault && <p role="alert">{fault}</p>}
      {message && <p role={message === 'Saved.' ? 'status' : 'alert'}>{message}</p>}
      {periods === null && !fault && <p role="status">Loading invoices…</p>}
      {periods && (
        <section aria-label="Periods to invoice">
          <h4>Periods to invoice</h4>
          {periods.length === 0 ? (
            <p>Every paid period already has an invoice.</p>
          ) : (
            <ul>
              {periods.map((p) => (
                <li key={p.subscriptionId + p.periodStart}>
                  <strong>{p.planTitle}</strong> · {p.workspaceName} · {displayDate(p.periodStart)}{' '}
                  until {displayDate(p.periodEnd)} · {money(p.priceMinor, p.currency)}{' '}
                  <button type="button" className="text-link" onClick={() => prepare(p)}>
                    Prepare invoice for {p.workspaceName}, {displayDate(p.periodStart)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {preparing && (
        <form aria-label="Issue invoice" onSubmit={submitIssue}>
          <h4>
            Invoice for {preparing.workspaceName}, {displayDate(preparing.periodStart)} until{' '}
            {displayDate(preparing.periodEnd)}
          </h4>
          <p>
            Plan fee {money(preparing.priceMinor, preparing.currency)} (set by the plan). For this
            plan the {taxLine[preparing.taxTreatment]}.
          </p>
          <fieldset disabled={busy}>
            {preparing.taxTreatment !== 'tax_to_be_confirmed' && (
              <div className="field">
                <label htmlFor="invoice-tax">
                  Tax amount in {preparing.currency} minor units (0 if none)
                </label>
                <input
                  id="invoice-tax"
                  inputMode="numeric"
                  pattern="(0|[1-9][0-9]{0,10})"
                  required
                  value={tax}
                  onChange={(e) => change(() => setTax(e.target.value))}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="invoice-due">Due on (within 90 days)</label>
              <input
                id="invoice-due"
                type="date"
                required
                value={due}
                onChange={(e) => change(() => setDue(e.target.value))}
              />
            </div>
          </fieldset>
          <button type="submit" className="button" disabled={busy}>
            {pending ? 'Send the same invoice again' : 'Issue sample invoice'}
          </button>{' '}
          <button type="button" className="text-link" onClick={() => setPreparing(null)}>
            Not now
          </button>
        </form>
      )}
      {rows && (
        <section aria-label="Sample invoices">
          <h4>Sample invoices</h4>
          {rows.length === 0 ? (
            <p>No invoice has been issued.</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <strong>{r.number}</strong> · {r.workspaceName} · {r.status.replace('_', ' ')}
                  {r.overdue ? ' (overdue)' : ''} · still to pay{' '}
                  {money(r.outstandingMinor, r.currency)}{' '}
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setPending(null);
                      setMessage('');
                      void open(r.id);
                    }}
                  >
                    Open {r.number}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {inv && detail && (
        <section aria-label="Invoice detail">
          <h4>
            {inv.number} for {inv.workspaceName}
          </h4>
          <p>
            Status: {inv.status.replace('_', ' ')}
            {inv.overdue ? ', overdue' : ''}. Period {displayDate(inv.periodStart)} until{' '}
            {displayDate(inv.periodEnd)}. Issued {displayDate(inv.issueDate)}, due{' '}
            {displayDate(inv.dueDate)}.
          </p>
          <p>
            Fee {money(inv.planFeeMinor, inv.currency)}
            {inv.taxMinor === null
              ? ', tax to be confirmed'
              : ', tax ' + money(inv.taxMinor, inv.currency)}
            . Total {money(inv.totalMinor, inv.currency)}. Paid {money(inv.paidMinor, inv.currency)}
            . Credited {money(inv.creditedMinor, inv.currency)}. Still to pay{' '}
            {money(inv.outstandingMinor, inv.currency)}.
          </p>
          <ol>
            {inv.payments.map((p) => (
              <li key={'p' + p.seq}>
                Payment {money(p.amountMinor, inv.currency)} · {displayDate(p.receivedOn)} ·{' '}
                {p.method.replace('_', ' ')} · {p.reference}
              </li>
            ))}
            {inv.credits.map((c) => (
              <li key={'c' + c.seq}>
                Credit {c.number} {money(c.amountMinor, inv.currency)} · {displayDate(c.issuedOn)} ·{' '}
                {c.reason}
              </li>
            ))}
          </ol>
          {can('payment') && (
            <form aria-label="Record payment" onSubmit={submitPayment}>
              <fieldset disabled={busy}>
                <div className="field">
                  <label htmlFor="invoice-pay-amount">
                    Amount received in {inv.currency} minor units
                  </label>
                  <input
                    id="invoice-pay-amount"
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,11}"
                    required
                    value={amount}
                    onChange={(e) => change(() => setAmount(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="invoice-pay-date">Received on</label>
                  <input
                    id="invoice-pay-date"
                    type="date"
                    required
                    max={today()}
                    min={inv.issueDate}
                    value={received}
                    onChange={(e) => change(() => setReceived(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="invoice-pay-method">How</label>
                  <select
                    id="invoice-pay-method"
                    value={method}
                    onChange={(e) => change(() => setMethod(e.target.value))}
                  >
                    {methods.map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="invoice-pay-ref">Reference (start with Synthetic)</label>
                  <input
                    id="invoice-pay-ref"
                    required
                    minLength={11}
                    maxLength={120}
                    value={reference}
                    onChange={(e) => change(() => setReference(e.target.value))}
                  />
                </div>
              </fieldset>
              <button type="submit" className="button" disabled={busy}>
                {pending ? 'Send the same payment again' : 'Record payment'}
              </button>
            </form>
          )}
          {can('credit') && (
            <form aria-label="Issue credit note" onSubmit={submitCredit}>
              <fieldset disabled={busy}>
                <div className="field">
                  <label htmlFor="invoice-credit-amount">
                    Credit amount in {inv.currency} minor units
                  </label>
                  <input
                    id="invoice-credit-amount"
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,11}"
                    required
                    value={creditAmount}
                    onChange={(e) => change(() => setCreditAmount(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="invoice-credit-reason">
                    Reason the customer reads (start with Synthetic)
                  </label>
                  <textarea
                    id="invoice-credit-reason"
                    rows={2}
                    required
                    minLength={11}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => change(() => setReason(e.target.value))}
                  />
                </div>
              </fieldset>
              <button
                type="submit"
                className="button button-secondary"
                data-intent="destructive"
                disabled={busy}
              >
                {pending ? 'Send the same credit again' : 'Issue credit note'}
              </button>
            </form>
          )}
          {!can('payment') && <p>Nothing is outstanding, so no payment or credit can be added.</p>}
        </section>
      )}
    </section>
  );
}
