'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { displayMoney } from '@corridra/domain/locale';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';

// ADR-064: the staff side of real invoices. Staff prepare an invoice or a credit note; a second named person approves
// it, and only then does it get its legal number. Payments are records of money the team received. Nothing is collected
// here and no money moves.
type Supplier = {
  legalName: string;
  address: string;
  country: string;
  uen: string | null;
  gstRegistered: boolean;
  gstRegistrationNo: string | null;
  taxLabel: string;
  gstRateBps: number;
  paymentTermsDays: number;
  financeLabel: string | null;
  approverNamed: boolean;
  madeupFields: string[];
};
type Period = {
  subscriptionId: string;
  workspaceName: string;
  planTitle: string;
  periodStart: string;
  periodEnd: string;
  priceMinor: string;
  currency: string;
};
type Proposal = {
  id: string;
  kind: 'invoice' | 'credit';
  workspaceName: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  billToName: string | null;
  billToAddress: string | null;
  invoiceNumber: string | null;
  amountMinor: string | null;
  reason: string | null;
  preparedByYou: boolean;
  preview: {
    currency: string;
    planTitle: string;
    feeMinor: string;
    taxMinor: string;
    totalMinor: string;
  } | null;
};
type Pending = {
  periods: Period[];
  proposals: Proposal[];
  secondApproverRequired: boolean;
  supplier: Supplier;
};
type Row = {
  id: string;
  number: string;
  title: string;
  workspaceName?: string;
  planTitle: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalMinor: string;
  paidMinor: string;
  creditedMinor: string;
  outstandingMinor: string;
  status: string;
  overdue: boolean;
  position: number;
  madeupFields: string[];
  payments: {
    seq: number;
    amountMinor: string;
    receivedOn: string;
    method: string;
    reference: string;
  }[];
  credits: { seq: number; number: string; amountMinor: string; issuedOn: string; reason: string }[];
};
type Detail = { invoice: Row; actions: string[] };

const methods: [string, string][] = [
  ['bank_transfer', 'Bank transfer'],
  ['cash', 'Cash'],
  ['other', 'Other'],
];
const fieldText: Record<string, string> = {
  uen: 'company registration number (UEN)',
  gst_registration_no: 'GST registration number',
  gst_registered: 'GST registration status',
  payment_instructions: 'payment instructions',
  finance_label: 'finance contact',
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
        ? 'This changed, or it was refused (for example you prepared it yourself, or the amount is above what is unpaid). Reload and check.'
        : status === 400
          ? 'Check the details. Text is plain: no links or email addresses and one line for an address. Amounts are whole minor units.'
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
// Invoices, payments and credit notes are dated by the Singapore calendar day, so the screen uses it too.
const singaporeDay = (n: number) =>
  new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const today = () => singaporeDay(0);
const inDays = (n: number) => singaporeDay(n);

export function CustomerRealInvoicing({ tenant }: { tenant: string }) {
  // Real invoices exist only in a real deployment; a sample deployment asks the server nothing about them.
  return realCustomerInput() ? <Scoped key={tenant} tenant={tenant} /> : null;
}
function Scoped({ tenant }: { tenant: string }) {
  const [data, setData] = useState<Pending | null>(null),
    [rows, setRows] = useState<Row[] | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [preparing, setPreparing] = useState<Period | null>(null),
    [rejecting, setRejecting] = useState<Proposal | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [ok, setOk] = useState(false),
    [fault, setFault] = useState(''),
    [off, setOff] = useState(false),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [billName, setBillName] = useState(''),
    [billAddress, setBillAddress] = useState(''),
    [due, setDue] = useState(inDays(30)),
    [amount, setAmount] = useState(''),
    [received, setReceived] = useState(today()),
    [method, setMethod] = useState('bank_transfer'),
    [reference, setReference] = useState(''),
    [creditAmount, setCreditAmount] = useState(''),
    [reason, setReason] = useState(''),
    [rejectReason, setRejectReason] = useState('');
  const task = useRef<AbortController | null>(null);
  const endpoint =
    '/api/workspace/customer-billing?invoicing=real&tenant=' + encodeURIComponent(tenant);
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
    const pb = p.body as Pending | null;
    if (p.status !== 200 || !pb || !Array.isArray(pb.periods) || !Array.isArray(pb.proposals)) {
      setData(null);
      setFault(plainError(p.status));
      return;
    }
    const l = await call('&scope=invoices');
    if (!l) return;
    const lb = l.body as { invoices?: Row[] } | null;
    if (l.status !== 200 || !lb || !Array.isArray(lb.invoices)) {
      setRows(null);
      setFault(plainError(l.status));
      return;
    }
    setFault('');
    setData(pb);
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
        setData(null);
        setPreparing(null);
        setRejecting(null);
        setMessage('Customer details were cleared while you were away. Reload to continue.');
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      task.current?.abort();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [loadAll]);
  async function send(body: Record<string, unknown>, done: string) {
    if (busy) return;
    setPending(body);
    setBusy(true);
    setMessage('');
    setOk(false);
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
    const saved = r.body as { invoice?: { id?: string } } | null;
    setPending(null);
    setOk(true);
    setMessage(done);
    setPreparing(null);
    setRejecting(null);
    setAmount('');
    setCreditAmount('');
    setReference('');
    setReason('');
    setRejectReason('');
    if (typeof saved?.invoice?.id === 'string') await open(saved.invoice.id);
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
    setDue(inDays(data?.supplier.paymentTermsDays ?? 30));
  }
  function submitInvoice(e: FormEvent) {
    e.preventDefault();
    if (!preparing) return;
    void send(
      pending ?? {
        action: 'prepare_invoice',
        commandId: crypto.randomUUID(),
        subscriptionId: preparing.subscriptionId,
        periodStart: preparing.periodStart,
        dueOn: due,
        billToName: billName.trim(),
        billToAddress: billAddress.trim(),
      },
      'Prepared. A second person now needs to approve it.',
    );
  }
  function approve(p: Proposal) {
    setMessage('');
    void send(
      pending ?? {
        action: 'decide',
        commandId: crypto.randomUUID(),
        proposalId: p.id,
        decision: 'approve',
      },
      p.kind === 'invoice'
        ? 'Approved. The invoice now has its number.'
        : 'Approved. The credit note now has its number.',
    );
  }
  function submitReject(e: FormEvent) {
    e.preventDefault();
    if (!rejecting) return;
    void send(
      pending ?? {
        action: 'decide',
        commandId: crypto.randomUUID(),
        proposalId: rejecting.id,
        decision: 'reject',
        reason: rejectReason.trim(),
      },
      'Rejected. Nothing was issued.',
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
      'Payment recorded.',
    );
  }
  function submitCredit(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    void send(
      pending ?? {
        action: 'prepare_credit',
        commandId: crypto.randomUUID(),
        invoiceId: detail.invoice.id,
        expectedPosition: detail.invoice.position,
        amountMinor: creditAmount.trim(),
        reason: reason.trim(),
      },
      'Prepared. A second person now needs to approve the credit note.',
    );
  }
  if (off) return null;
  const can = (a: string) => !!detail && detail.actions.includes(a);
  const inv = detail?.invoice ?? null;
  const s = data?.supplier ?? null;
  return (
    <section aria-label="Customer invoices" className="detail-card">
      <h3>Customer invoices</h3>
      <p>
        Real invoices and credit notes for plan periods you activated. You prepare one; a second
        person approves it, and only then does it get its number. Payments are records of money the
        team received. Nothing is collected and no money moves.
      </p>
      {fault && <p role="alert">{fault}</p>}
      {message && <p role={ok ? 'status' : 'alert'}>{message}</p>}
      {data === null && !fault && <p role="status">Loading invoices…</p>}
      {data && s && (
        <section aria-label="Supplier details">
          <h4>Supplier on every document</h4>
          <p>
            {s.legalName}, {s.address}, {s.country}.{s.uen ? ' UEN ' + s.uen + '.' : ''}{' '}
            {s.gstRegistered
              ? s.taxLabel +
                ' registered' +
                (s.gstRegistrationNo ? ' (' + s.gstRegistrationNo + ')' : '') +
                ', rate ' +
                s.gstRateBps / 100 +
                '%.'
              : 'Not ' + s.taxLabel + ' registered, so documents are plain invoices.'}{' '}
            Payment terms {s.paymentTermsDays} days.
          </p>
          <p>
            {data.secondApproverRequired
              ? s.approverNamed
                ? 'Only the named finance person can approve.'
                : 'A second owner or admin approves; you cannot approve what you prepared.'
              : 'One person may prepare and approve. Each document says it was self approved.'}
          </p>
          {s.madeupFields.length > 0 && (
            <p role="note">
              <strong>Made-up organisation data (madeup):</strong>{' '}
              {s.madeupFields.map((f) => fieldText[f] ?? f).join(', ')}. Every document issued now
              says so and is not a valid tax invoice. Replace these details before sending any
              document to a customer.
            </p>
          )}
        </section>
      )}
      {data && (
        <section aria-label="Periods to invoice">
          <h4>Periods to invoice</h4>
          {data.periods.length === 0 ? (
            <p>Every paid period already has an invoice or one waiting for approval.</p>
          ) : (
            <ul>
              {data.periods.map((p) => (
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
        <form aria-label="Prepare invoice" onSubmit={submitInvoice}>
          <h4>
            Invoice for {preparing.workspaceName}, {displayDate(preparing.periodStart)} until{' '}
            {displayDate(preparing.periodEnd)}
          </h4>
          <p>
            Plan fee {money(preparing.priceMinor, preparing.currency)} (set by the plan). The tax
            and the total are worked out when the invoice is approved.
          </p>
          <fieldset disabled={busy}>
            <div className="field">
              <label htmlFor="real-bill-name">Bill to: company name</label>
              <input
                id="real-bill-name"
                required
                minLength={2}
                maxLength={120}
                value={billName}
                onChange={(e) => change(() => setBillName(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="real-bill-address">
                Bill to: address on one line (no links or email addresses)
              </label>
              <input
                id="real-bill-address"
                required
                minLength={5}
                maxLength={300}
                value={billAddress}
                onChange={(e) => change(() => setBillAddress(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="real-invoice-due">Due on</label>
              <input
                id="real-invoice-due"
                type="date"
                required
                value={due}
                onChange={(e) => change(() => setDue(e.target.value))}
              />
            </div>
          </fieldset>
          <button type="submit" className="button" disabled={busy}>
            {pending ? 'Send the same invoice again' : 'Prepare invoice for approval'}
          </button>{' '}
          <button type="button" className="text-link" onClick={() => setPreparing(null)}>
            Not now
          </button>
        </form>
      )}
      {data && (
        <section aria-label="Waiting for approval">
          <h4>Waiting for approval</h4>
          {data.proposals.length === 0 ? (
            <p>Nothing is waiting.</p>
          ) : (
            <ul>
              {data.proposals.map((p) => (
                <li key={p.id}>
                  <strong>{p.kind === 'invoice' ? 'Invoice' : 'Credit note'}</strong> ·{' '}
                  {p.workspaceName}
                  {p.kind === 'invoice' && p.periodStart && p.periodEnd
                    ? ' · ' + displayDate(p.periodStart) + ' until ' + displayDate(p.periodEnd)
                    : ''}
                  {p.kind === 'credit' && p.invoiceNumber ? ' · against ' + p.invoiceNumber : ''}
                  {p.preview
                    ? ' · fee ' +
                      money(p.preview.feeMinor, p.preview.currency) +
                      ', tax ' +
                      money(p.preview.taxMinor, p.preview.currency) +
                      ', total ' +
                      money(p.preview.totalMinor, p.preview.currency)
                    : ''}
                  {p.kind === 'credit' && p.amountMinor ? ' · amount ' + p.amountMinor : ''}
                  {p.billToName ? ' · bill to ' + p.billToName : ''}
                  {p.reason ? ' · ' + p.reason : ''}
                  {p.preparedByYou && data.secondApproverRequired ? (
                    <> · You prepared this. Another person needs to approve or reject it.</>
                  ) : (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy}
                        onClick={() => approve(p)}
                      >
                        Approve {p.kind === 'invoice' ? 'invoice' : 'credit note'} for{' '}
                        {p.workspaceName}
                      </button>{' '}
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy}
                        onClick={() => {
                          setPending(null);
                          setMessage('');
                          setRejecting(p);
                        }}
                      >
                        Reject for {p.workspaceName}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {rejecting && (
        <form aria-label="Reject" onSubmit={submitReject}>
          <div className="field">
            <label htmlFor="real-reject-reason">
              Why are you rejecting this {rejecting.kind === 'invoice' ? 'invoice' : 'credit note'}?
            </label>
            <textarea
              id="real-reject-reason"
              rows={2}
              required
              minLength={3}
              maxLength={500}
              value={rejectReason}
              onChange={(e) => change(() => setRejectReason(e.target.value))}
            />
          </div>
          <button
            type="submit"
            className="button button-secondary"
            data-intent="destructive"
            disabled={busy}
          >
            {pending ? 'Send the same rejection again' : 'Reject'}
          </button>{' '}
          <button type="button" className="text-link" onClick={() => setRejecting(null)}>
            Not now
          </button>
        </form>
      )}
      {rows && (
        <section aria-label="Issued invoices">
          <h4>Issued invoices</h4>
          {rows.length === 0 ? (
            <p>No invoice has been issued.</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <strong>{r.number}</strong> · {r.workspaceName} · {r.status.replace('_', ' ')}
                  {r.overdue ? ' (overdue)' : ''} · still to pay{' '}
                  {money(r.outstandingMinor, r.currency)}
                  {r.madeupFields.length > 0 ? ' · contains made-up data (madeup)' : ''}{' '}
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
            Total {money(inv.totalMinor, inv.currency)}. Paid {money(inv.paidMinor, inv.currency)}.
            Credited {money(inv.creditedMinor, inv.currency)}. Still to pay{' '}
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
                  <label htmlFor="real-pay-amount">
                    Amount received in {inv.currency} minor units
                  </label>
                  <input
                    id="real-pay-amount"
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,11}"
                    required
                    value={amount}
                    onChange={(e) => change(() => setAmount(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="real-pay-date">Received on</label>
                  <input
                    id="real-pay-date"
                    type="date"
                    required
                    max={today()}
                    min={inv.issueDate}
                    value={received}
                    onChange={(e) => change(() => setReceived(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="real-pay-method">How</label>
                  <select
                    id="real-pay-method"
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
                  <label htmlFor="real-pay-ref">Bank reference (plain text)</label>
                  <input
                    id="real-pay-ref"
                    required
                    minLength={2}
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
            <form aria-label="Prepare credit note" onSubmit={submitCredit}>
              <fieldset disabled={busy}>
                <div className="field">
                  <label htmlFor="real-credit-amount">
                    Credit amount in {inv.currency} minor units
                  </label>
                  <input
                    id="real-credit-amount"
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,11}"
                    required
                    value={creditAmount}
                    onChange={(e) => change(() => setCreditAmount(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="real-credit-reason">Reason the customer reads</label>
                  <textarea
                    id="real-credit-reason"
                    rows={2}
                    required
                    minLength={10}
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
                {pending ? 'Send the same credit again' : 'Prepare credit note for approval'}
              </button>
            </form>
          )}
          {!can('payment') && <p>Nothing is outstanding, so no payment or credit can be added.</p>}
        </section>
      )}
    </section>
  );
}
