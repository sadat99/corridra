'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  callBillingApi,
  dayText,
  madeupFieldText,
  methodText,
  money,
  problemText,
  ratePercent,
  realInvoiceStatusLabel,
  validRealInvoicing,
  type RealInvoice,
  type RealInvoicingOverview,
} from './billing-client';

type Props = { subject: string; issuer: string; workspaceId: string };

// ADR-064: real invoices, read-only. Corridra collects nothing through this page; it shows what the team issued and the
// payments the team recorded. A document whose supplier details are not yet real says so on its face.
export function RealInvoicesSection(props: Props) {
  return (
    <ScopedInvoices key={props.issuer + ':' + props.subject + ':' + props.workspaceId} {...props} />
  );
}

function StatusBadges({ i }: { i: RealInvoice }) {
  const label = realInvoiceStatusLabel[i.status];
  return (
    <>
      <span className="ux-status" data-tone={label.tone}>
        {label.text}
      </span>
      {i.overdue && (
        <>
          {' '}
          <span className="ux-status" data-tone="critical">
            Overdue
          </span>
        </>
      )}
    </>
  );
}

function madeupText(i: RealInvoice) {
  return i.madeupFields.map((f) => madeupFieldText[f] ?? f).join(', ');
}

function InvoiceDocument({ i }: { i: RealInvoice }) {
  const rate = ratePercent(i.taxRateBps);
  const print = () => {
    const body = document.body;
    const card = document.getElementById('real-invoice-' + i.id);
    if (!card) return;
    const done = () => {
      body.removeAttribute('data-print-invoice');
      card.removeAttribute('data-printing');
      window.removeEventListener('afterprint', done);
    };
    body.setAttribute('data-print-invoice', 'on');
    card.setAttribute('data-printing', 'on');
    window.addEventListener('afterprint', done);
    window.print();
  };
  return (
    <li id={'real-invoice-' + i.id} className="detail-card real-invoice">
      <h3>
        {i.title} {i.number}
      </h3>
      <p>
        <StatusBadges i={i} />
      </p>
      {i.madeupFields.length > 0 && (
        <p role="note" className="real-invoice-madeup">
          <strong>Contains made-up organisation data (madeup):</strong> {madeupText(i)}. This is not
          a valid tax invoice until the supplier details are real.
        </p>
      )}
      <div className="real-invoice-parties">
        <div>
          <p className="label">FROM</p>
          <p>
            <strong>{i.supplier.legalName}</strong>
            <br />
            {i.supplier.address}
            <br />
            {i.supplier.country}
          </p>
          {i.supplier.uen && <p>Company registration (UEN): {i.supplier.uen}</p>}
          {i.supplier.gstRegistrationNo && <p>GST registration: {i.supplier.gstRegistrationNo}</p>}
        </div>
        <div>
          <p className="label">BILL TO</p>
          <p>
            <strong>{i.billTo.name}</strong>
            <br />
            <span style={{ overflowWrap: 'anywhere' }}>{i.billTo.address}</span>
          </p>
        </div>
      </div>
      <p>
        Issued {dayText(i.issueDate)} · Due {dayText(i.dueDate)}
      </p>
      <div
        role="region"
        aria-label={'Lines of ' + i.number}
        tabIndex={0}
        style={{ overflowX: 'auto' }}
      >
        <table style={{ width: '100%' }}>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col">Amount ({i.currency})</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {i.planTitle} ({i.interval === 'month' ? 'monthly' : 'yearly'}),{' '}
                {dayText(i.periodStart)} until {dayText(i.periodEnd)}
              </td>
              <td>{money(i.planFeeMinor, i.currency)}</td>
            </tr>
            <tr>
              <td>Total before {i.taxLabel}</td>
              <td>{money(i.amountExcludingTaxMinor, i.currency)}</td>
            </tr>
            <tr>
              <td>
                {i.taxLabel}
                {rate ? ' at ' + rate : ''}
              </td>
              <td>{money(i.taxMinor, i.currency)}</td>
            </tr>
            <tr>
              <th scope="row">Total</th>
              <td>
                <strong>{money(i.totalMinor, i.currency)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Paid {money(i.paidMinor, i.currency)} · Credited {money(i.creditedMinor, i.currency)} ·
        Still to pay <strong>{money(i.outstandingMinor, i.currency)}</strong>
      </p>
      <p>
        <span style={{ overflowWrap: 'anywhere' }}>{i.paymentInstructions}</span>
      </p>
      <details className="ux-journey-disclosure">
        <summary>Payments and credit notes for {i.number}</summary>
        <p>Payments the team recorded</p>
        {i.payments.length === 0 ? (
          <p>None yet.</p>
        ) : (
          <ul>
            {i.payments.map((p) => (
              <li key={p.seq}>
                {money(p.amountMinor, i.currency)} on {dayText(p.receivedOn)} ·{' '}
                {methodText[p.method] ?? p.method}
              </li>
            ))}
          </ul>
        )}
        <p>Credit notes</p>
        {i.credits.length === 0 ? (
          <p>None.</p>
        ) : (
          <ul>
            {i.credits.map((c) => (
              <li key={c.seq}>
                {c.number}: {money(c.amountMinor, i.currency)} on {dayText(c.issuedOn)}.{' '}
                <span style={{ overflowWrap: 'anywhere' }}>{c.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
      <p className="real-invoice-actions">
        <button type="button" className="button button-secondary" onClick={print}>
          Print or save as PDF
        </button>
      </p>
    </li>
  );
}

function ScopedInvoices({ subject, issuer, workspaceId }: Props) {
  const id = useId();
  const [data, setData] = useState<RealInvoicingOverview | null>(null),
    [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied' | 'off' | 'gone'>(
      'loading',
    ),
    [message, setMessage] = useState('');
  const alive = useRef(false),
    task = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    const result = await callBillingApi<RealInvoicingOverview>(
      { subject, issuer },
      { scope: 'invoices', workspaceId },
      null,
      validRealInvoicing,
      controller.signal,
    );
    if (controller.signal.aborted || !alive.current) return;
    if (!result.ok) {
      setData(null);
      setState(
        result.status === 401 || result.status === 403
          ? 'denied'
          : result.status === 503
            ? 'off'
            : 'error',
      );
      setMessage(problemText(result.status, 'load your invoices'));
      return;
    }
    if (result.data.workspaceId !== workspaceId) {
      setData(null);
      setState('gone');
      setMessage('This answer did not match the workspace you opened. Reload the page.');
      return;
    }
    setData(result.data);
    setState('ready');
  }, [subject, issuer, workspaceId]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => load());
    return () => {
      alive.current = false;
      task.current?.abort();
    };
  }, [load]);

  // Switched off here: the rest of the page stays as it is, with nothing said about invoices.
  if (state === 'off') return null;
  return (
    <section aria-labelledby={id + 'inv'}>
      <h2 id={id + 'inv'}>Invoices</h2>
      <p>
        Invoices and credit notes issued by the Corridra team. Nothing is collected through
        Corridra: when the team records a payment it received, it appears on the invoice.
      </p>
      {state === 'loading' && <p role="status">Loading your invoices…</p>}
      {state !== 'loading' && state !== 'ready' && (
        <div className="ux-state" data-state={state === 'denied' ? 'denied' : 'unavailable'}>
          <p className="ux-state-label">
            {state === 'denied' ? 'Access required' : 'Temporarily unavailable'}
          </p>
          <div role="alert">{message}</div>
          {state !== 'denied' && (
            <div className="ux-state-actions">
              <button type="button" className="button button-secondary" onClick={() => void load()}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}
      {state === 'ready' && data && !data.canRead && (
        <div className="ux-state" data-state="restricted">
          <p className="ux-state-label">For owners and admins</p>
          <div role="status">
            {data.invoicesExist
              ? 'This workspace has invoices. Only a workspace owner or admin can read them.'
              : 'Invoices are shown to workspace owners and admins. There are none yet.'}
          </div>
        </div>
      )}
      {state === 'ready' && data && data.canRead && data.invoices.length === 0 && (
        <div className="ux-state" data-state="empty">
          <p className="ux-state-label">No invoices yet</p>
          <div role="status">
            The Corridra team has not issued an invoice for this workspace. An invoice appears here
            once the team has issued it.
          </div>
        </div>
      )}
      {state === 'ready' && data && data.canRead && data.invoices.length > 0 && (
        <>
          <div
            role="region"
            aria-label="What is still to pay"
            tabIndex={0}
            style={{ overflowX: 'auto' }}
          >
            <table style={{ width: '100%' }}>
              <caption style={{ textAlign: 'left' }}>
                Totals for each currency. Currencies are never added together or converted.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Currency</th>
                  <th scope="col">Invoiced</th>
                  <th scope="col">Paid</th>
                  <th scope="col">Credited</th>
                  <th scope="col">Still to pay</th>
                  <th scope="col">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {data.balances.map((b) => (
                  <tr key={b.currency}>
                    <td>{b.currency}</td>
                    <td>{money(b.invoicedMinor, b.currency)}</td>
                    <td>{money(b.paidMinor, b.currency)}</td>
                    <td>{money(b.creditedMinor, b.currency)}</td>
                    <td>
                      <strong>{money(b.outstandingMinor, b.currency)}</strong>
                    </td>
                    <td>{money(b.overdueMinor, b.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="guide-list">
            {data.invoices.map((i) => (
              <InvoiceDocument key={i.id} i={i} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
