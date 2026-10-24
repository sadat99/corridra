'use client';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  callBillingApi,
  dateTimeText,
  money,
  problemText,
  simulatedPaymentsPath,
  simulatedStateLabel,
  validSimulatedCommand,
  validSimulatedPayments,
  type SimulatedPayment,
  type SimulatedPaymentsOverview,
} from './billing-client';

type Props = { subject: string; issuer: string; workspaceId: string };

// ADR-065: a simulated payment provider, "Corridra Pay (madeup)". It stands in for a real provider so the flow can be
// tried end to end. No card or bank is used, no money moves, and the invoices do not change: the team records real
// money it receives separately. Everything shown here says (madeup).
export function SimulatedPaymentsSection(props: Props) {
  return (
    <ScopedPayments key={props.issuer + ':' + props.subject + ':' + props.workspaceId} {...props} />
  );
}

function ScopedPayments({ subject, issuer, workspaceId }: Props) {
  const id = useId();
  const [data, setData] = useState<SimulatedPaymentsOverview | null>(null),
    [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied' | 'off' | 'gone'>(
      'loading',
    ),
    [message, setMessage] = useState(''),
    [ok, setOk] = useState(false),
    [busy, setBusy] = useState(false),
    [picked, setPicked] = useState<string | null>(null),
    [amount, setAmount] = useState(''),
    [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const alive = useRef(false),
    task = useRef<AbortController | null>(null);
  const scope = { subject, issuer };
  const load = useCallback(async () => {
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    const result = await callBillingApi<SimulatedPaymentsOverview>(
      { subject, issuer },
      { workspaceId },
      null,
      validSimulatedPayments,
      controller.signal,
      simulatedPaymentsPath,
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
      setMessage(problemText(result.status, 'load the payment flow'));
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

  async function send(body: Record<string, unknown>, done: string) {
    if (busy) return;
    setPending(body);
    setBusy(true);
    setMessage('');
    setOk(false);
    const result = await callBillingApi<{ attempt: SimulatedPayment }>(
      scope,
      null,
      body,
      validSimulatedCommand,
      undefined,
      simulatedPaymentsPath,
    );
    setBusy(false);
    if (!result.ok) {
      const unsure =
        result.status === 'network' ||
        result.status === 'malformed' ||
        (typeof result.status === 'number' && result.status >= 500 && result.status !== 503);
      if (!unsure) setPending(null);
      setMessage(
        unsure
          ? 'Could not confirm that this was saved. Send the same action again; it cannot be done twice.'
          : problemText(result.status, 'do that'),
      );
      return;
    }
    setPending(null);
    setPicked(null);
    setOk(true);
    setMessage(done);
    await load();
  }
  function startPayment(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    void send(
      pending ?? {
        action: 'start',
        commandId: crypto.randomUUID(),
        workspaceId,
        invoiceId: picked,
        amountMinor: amount.trim(),
      },
      'Checkout opened (madeup). Approve or decline it below.',
    );
  }
  function finish(a: SimulatedPayment, outcome: 'succeeded' | 'declined') {
    void send(
      pending ?? {
        action: 'complete',
        commandId: crypto.randomUUID(),
        workspaceId,
        attemptId: a.id,
        outcome,
      },
      outcome === 'succeeded'
        ? 'Payment approved (madeup). No money moved and your invoice did not change.'
        : 'Payment declined (madeup). Nothing was charged.',
    );
  }

  // Switched off here: the rest of the page stays as it is, with nothing said about this flow.
  if (state === 'off') return null;
  const live = data?.attempts.find((a) => a.state === 'started') ?? null;
  const choice = data?.payable.find((p) => p.invoiceId === picked) ?? null;
  return (
    <section aria-labelledby={id + 'sim'}>
      <h2 id={id + 'sim'}>Try the payment flow (madeup)</h2>
      <p role="note">
        This is a simulation with made-up details (madeup). No card or bank is used, no money moves
        and your invoices do not change. The Corridra team records real money it receives on the
        invoice itself.
      </p>
      {state === 'loading' && <p role="status">Loading the payment flow…</p>}
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
      {state === 'ready' && data && (
        <>
          {message && <p role={ok ? 'status' : 'alert'}>{message}</p>}
          <p>
            Provider: {data.provider.name}. {data.provider.refundPolicy}.
          </p>
          {!data.canPay && (
            <div className="ux-state" data-state="restricted">
              <p className="ux-state-label">For owners and admins</p>
              <div role="status">Only a workspace owner or admin can try the payment flow.</div>
            </div>
          )}
          {data.canPay && live && (
            <section aria-label="Simulated checkout" className="detail-card">
              <h3>Checkout at {data.provider.name}</h3>
              <p>
                {live.invoiceNumber} · {money(live.amountMinor, live.currency)} · reference{' '}
                {live.providerRef}
              </p>
              <p>
                Open until {dateTimeText(live.expiresAt)}. Choose how this simulated payment ends.
              </p>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => finish(live, 'succeeded')}
              >
                {pending ? 'Send the same choice again' : 'Approve this payment (madeup)'}
              </button>{' '}
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => finish(live, 'declined')}
              >
                Decline this payment (madeup)
              </button>
            </section>
          )}
          {data.canPay && !live && data.payable.length === 0 && (
            <div className="ux-state" data-state="empty">
              <p className="ux-state-label">Nothing to pay</p>
              <div role="status">No invoice has anything still to pay.</div>
            </div>
          )}
          {data.canPay && !live && data.payable.length > 0 && (
            <section aria-label="Invoices you can try paying">
              <h3>Invoices still to pay</h3>
              <ul>
                {data.payable.map((p) => (
                  <li key={p.invoiceId}>
                    {p.number} · still to pay {money(p.outstandingMinor, p.currency)}{' '}
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        setPending(null);
                        setMessage('');
                        setPicked(p.invoiceId);
                        setAmount(p.outstandingMinor);
                      }}
                    >
                      Try paying {p.number} (madeup)
                    </button>
                  </li>
                ))}
              </ul>
              {choice && (
                <form aria-label="Start simulated payment" onSubmit={startPayment}>
                  <fieldset disabled={busy}>
                    <div className="field">
                      <label htmlFor={id + 'amt'}>
                        Amount in {choice.currency} minor units (up to {choice.outstandingMinor})
                      </label>
                      <input
                        id={id + 'amt'}
                        inputMode="numeric"
                        pattern="[1-9][0-9]{0,11}"
                        required
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          setPending(null);
                        }}
                      />
                    </div>
                  </fieldset>
                  <button type="submit" className="button" disabled={busy}>
                    {pending ? 'Send the same checkout again' : 'Open simulated checkout (madeup)'}
                  </button>{' '}
                  <button type="button" className="text-link" onClick={() => setPicked(null)}>
                    Not now
                  </button>
                </form>
              )}
            </section>
          )}
          {data.canPay && data.attempts.length > 0 && (
            <section aria-label="Simulated payments so far">
              <h3>Simulated payments so far</h3>
              <ul className="guide-list">
                {data.attempts.map((a) => {
                  const label = simulatedStateLabel[a.state];
                  return (
                    <li key={a.id} className="detail-card">
                      <p>
                        <strong>{a.invoiceNumber}</strong> · {money(a.amountMinor, a.currency)} ·{' '}
                        <span className="ux-status" data-tone={label.tone}>
                          {label.text}
                        </span>
                      </p>
                      <p>
                        Reference {a.providerRef} · started {dateTimeText(a.createdAt)}
                      </p>
                      {a.refunds.length > 0 && (
                        <ul>
                          {a.refunds.map((r) => (
                            <li key={r.seq}>
                              Refunded {money(r.amountMinor, a.currency)} (madeup) on{' '}
                              {dateTimeText(r.recordedAt)}.{' '}
                              <span style={{ overflowWrap: 'anywhere' }}>{r.reason}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {a.state === 'succeeded' && a.refundOpenUntil && (
                        <p>
                          Refunds (madeup) are possible until {dateTimeText(a.refundOpenUntil)}.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
