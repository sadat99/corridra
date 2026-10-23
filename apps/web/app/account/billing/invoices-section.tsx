'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  callBillingApi,
  dayText,
  invoiceStatusLabel,
  methodText,
  money,
  problemText,
  taxText,
  validInvoicing,
  type Invoice,
  type InvoicingOverview,
} from './billing-client';

type Props = { subject: string; issuer: string; workspaceId: string };

export function InvoicesSection(props: Props) {
  return (
    <ScopedInvoices key={props.issuer + ':' + props.subject + ':' + props.workspaceId} {...props} />
  );
}

function StatusBadges({ i }: { i: Invoice }) {
  const label = invoiceStatusLabel[i.status];
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

function ScopedInvoices({ subject, issuer, workspaceId }: Props) {
  const id = useId();
  const [data, setData] = useState<InvoicingOverview | null>(null),
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
    const result = await callBillingApi<InvoicingOverview>(
      { subject, issuer },
      { scope: 'invoices', workspaceId },
      null,
      validInvoicing,
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
        Invoices here are samples, not tax invoices. Nothing is collected through Corridra. When the
        team records money they received, it appears on the invoice.
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
            once a paid plan period has started.
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
              <li key={i.id} className="detail-card">
                <h3>
                  {i.number} · {i.planTitle}
                </h3>
                <p>
                  <StatusBadges i={i} />
                </p>
                <p>
                  For {dayText(i.periodStart)} until {dayText(i.periodEnd)}. Issued{' '}
                  {dayText(i.issueDate)}, due {dayText(i.dueDate)}.
                </p>
                <p>
                  Plan fee {money(i.planFeeMinor, i.currency)} ·{' '}
                  {i.taxMinor === null
                    ? taxText[i.taxTreatment] + ', so no tax is added yet'
                    : i.taxTreatment === 'price_includes_tax'
                      ? 'Tax inside the price ' + money(i.taxMinor, i.currency)
                      : 'Tax added ' + money(i.taxMinor, i.currency)}
                </p>
                <p>
                  Total <strong>{money(i.totalMinor, i.currency)}</strong> · Paid{' '}
                  {money(i.paidMinor, i.currency)} · Credited {money(i.creditedMinor, i.currency)} ·
                  Still to pay <strong>{money(i.outstandingMinor, i.currency)}</strong>
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
                          {methodText[p.method]}
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
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
