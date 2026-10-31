'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { displayMoney } from '@corridra/domain/locale';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';

// ADR-065: the staff side of the simulated payment provider "Corridra Pay (madeup)". Staff can see every simulated
// attempt and record a made-up refund inside the made-up window. Nothing here is real money and no invoice changes.
type Attempt = {
  id: string;
  invoiceNumber: string;
  workspaceName?: string;
  amountMinor: string;
  currency: string;
  state: 'started' | 'expired' | 'succeeded' | 'declined';
  providerRef: string;
  createdAt: string;
  refundedMinor: string;
  refundableMinor: string;
  refundOpenUntil: string | null;
  refunds: { seq: number; amountMinor: string; reason: string; recordedAt: string }[];
};
type Listing = {
  attempts: Attempt[];
  provider: { name: string; madeup: true; refundWindowDays: number };
};
const stateText: Record<Attempt['state'], string> = {
  started: 'waiting at checkout (madeup)',
  succeeded: 'approved (madeup)',
  declined: 'declined (madeup)',
  expired: 'expired (madeup)',
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
      ? 'The simulated payment flow is unavailable.'
      : status === 409 || status === 400
        ? 'That refund was refused: it is above what is left, the made-up window has passed, or the reason has a link or email address. Reload and check.'
        : 'This could not be completed. Try again.';
}
function when(value: string) {
  return new Date(value).toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Singapore',
  });
}

export function CustomerSimulatedPayments({ tenant }: { tenant: string }) {
  // The simulated flow exists only in a real deployment; a sample deployment asks the server nothing about it.
  return realCustomerInput() ? <Scoped key={tenant} tenant={tenant} /> : null;
}
function Scoped({ tenant }: { tenant: string }) {
  const [data, setData] = useState<Listing | null>(null),
    [refunding, setRefunding] = useState<Attempt | null>(null),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [ok, setOk] = useState(false),
    [fault, setFault] = useState(''),
    [off, setOff] = useState(false),
    [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const task = useRef<AbortController | null>(null);
  const endpoint =
    '/api/workspace/customer-simulated-payments?tenant=' + encodeURIComponent(tenant);
  const call = useCallback(
    async (body?: Record<string, unknown>) => {
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      try {
        const r = await fetch(endpoint, {
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
  const load = useCallback(async () => {
    const r = await call();
    if (!r) return;
    if (r.status === 503) {
      setOff(true);
      return;
    }
    const body = r.body as Listing | null;
    if (r.status !== 200 || !body || !Array.isArray(body.attempts)) {
      setData(null);
      setFault(plainError(r.status));
      return;
    }
    setFault('');
    setData(body);
  }, [call]);
  useEffect(() => {
    void Promise.resolve().then(() => load());
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        task.current?.abort();
        setData(null);
        setRefunding(null);
        setMessage('Customer details were cleared while you were away. Reload to continue.');
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      task.current?.abort();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [load]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!refunding || busy) return;
    const body = pending ?? {
      action: 'refund',
      commandId: crypto.randomUUID(),
      attemptId: refunding.id,
      amountMinor: amount.trim(),
      reason: reason.trim(),
    };
    setPending(body);
    setBusy(true);
    setMessage('');
    setOk(false);
    const r = await call(body);
    setBusy(false);
    if (!r) return;
    if (r.status !== 200) {
      const unsure = r.status === 0 || (r.status >= 500 && r.status !== 503);
      if (!unsure) setPending(null);
      setMessage(
        unsure
          ? 'Could not confirm that this was saved. Send the same refund again; it cannot be done twice.'
          : plainError(r.status),
      );
      return;
    }
    setPending(null);
    setOk(true);
    setMessage('Refund recorded (madeup). No money moved.');
    setRefunding(null);
    setAmount('');
    setReason('');
    await load();
  }
  if (off) return null;
  return (
    <section aria-label="Simulated payments" className="detail-card" data-madeup-panel>
      <h3>Simulated payments (madeup)</h3>
      <p>
        Attempts customers made in the made-up payment flow. No money moves and no invoice changes.
        You can record a made-up refund inside the made-up window
        {data ? ' of ' + data.provider.refundWindowDays + ' days (madeup)' : ''}.
      </p>
      {fault && <p role="alert">{fault}</p>}
      {message && <p role={ok ? 'status' : 'alert'}>{message}</p>}
      {data === null && !fault && <p role="status">Loading simulated payments…</p>}
      {data && (
        <section aria-label="Simulated attempts">
          {data.attempts.length === 0 ? (
            <p>No simulated payment has been tried.</p>
          ) : (
            <ul>
              {data.attempts.map((a) => (
                <li key={a.id}>
                  <strong>{a.invoiceNumber}</strong> · {a.workspaceName} ·{' '}
                  {money(a.amountMinor, a.currency)} · {stateText[a.state]} · {a.providerRef}
                  {a.refundedMinor !== '0'
                    ? ' · refunded ' + money(a.refundedMinor, a.currency) + ' (madeup)'
                    : ''}
                  {a.refundableMinor !== '0' && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                          setPending(null);
                          setMessage('');
                          setRefunding(a);
                          setAmount(a.refundableMinor);
                        }}
                      >
                        Refund {a.invoiceNumber} (madeup)
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {refunding && (
        <form aria-label="Record made-up refund" onSubmit={(e) => void submit(e)}>
          <h4>
            Refund for {refunding.invoiceNumber} (madeup), up to{' '}
            {money(refunding.refundableMinor, refunding.currency)} until{' '}
            {refunding.refundOpenUntil ? when(refunding.refundOpenUntil) : ''}
          </h4>
          <fieldset disabled={busy}>
            <div className="field">
              <label htmlFor="sim-refund-amount">Amount in {refunding.currency} minor units</label>
              <input
                id="sim-refund-amount"
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
            <div className="field">
              <label htmlFor="sim-refund-reason">Reason (plain text, at least 10 characters)</label>
              <textarea
                id="sim-refund-reason"
                rows={2}
                required
                minLength={10}
                maxLength={500}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setPending(null);
                }}
              />
            </div>
          </fieldset>
          <button type="submit" className="button button-secondary" disabled={busy}>
            {pending ? 'Send the same refund again' : 'Record refund (madeup)'}
          </button>{' '}
          <button type="button" className="text-link" onClick={() => setRefunding(null)}>
            Not now
          </button>
        </form>
      )}
    </section>
  );
}
