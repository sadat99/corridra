'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { currencies, formatMoney, parseMoney } from '@corridra/domain/opportunities';
import type { PaymentDeclaration } from '@corridra/auth/customer-programme-economics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { declarationApi, parsePending, today } from './payment-declaration-client';
import { failureText, TermsError } from './terms-client';

type Code = keyof typeof currencies;
type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  programmeId: string;
  // Called after an acknowledgement, because the ledger changed and the totals must be read again.
  onDecided: () => void;
};

// "Awaiting your check": what participants say they paid. A declaration is not proof of bank receipt and changes no amount
// until the organiser acknowledges it; then one payment entry is written to the organiser's own ledger.
export function ProgrammePaymentReview(props: Props) {
  return (
    <Scoped
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId + ':' + props.programmeId}
      {...props}
    />
  );
}

function Scoped({ subject, issuer, workspaceId, programmeId, onDecided }: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'hidden'>('loading');
  const [items, setItems] = useState<PaymentDeclaration[]>([]);
  const [open, setOpen] = useState<{ id: string; mode: 'ack' | 'reject' } | null>(null);
  const [received, setReceived] = useState('');
  const [receivedOn, setReceivedOn] = useState(today());
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const writing = useRef(false);
  const intent = useRef<{ signature: string; commandId: string } | null>(null);
  const api = useRef(declarationApi(subject, issuer));

  const load = useCallback(async () => {
    try {
      const body = parsePending(
        await api.current.get({ view: 'pending', workspaceId, programmeId }),
        workspaceId,
        programmeId,
      );
      if (!active.current) return;
      setItems(body.declarations);
      setPhase('ready');
    } catch {
      // Not installed, not switched on, or access changed: the list is simply not shown.
      if (active.current) setPhase('hidden');
    }
  }, [workspaceId, programmeId]);
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    return () => {
      active.current = false;
    };
  }, [load]);

  function begin(d: PaymentDeclaration, mode: 'ack' | 'reject') {
    setOpen({ id: d.id, mode });
    setReceived(formatMoney(d.amountMinor, d.currency as Code).slice(4));
    setReceivedOn(d.paidOn);
    setReason(realCustomerInput() ? '' : 'Synthetic ');
    setConfirm(false);
    setError('');
  }
  async function decide(d: PaymentDeclaration, mode: 'ack' | 'reject') {
    if (writing.current) return;
    setError('');
    let receivedAmountMinor: string | null = null;
    let received_on: string | null = null;
    let why: string | null = null;
    if (mode === 'ack') {
      try {
        const minor = parseMoney(received, d.currency as Code);
        if (!/^[1-9][0-9]{0,17}$/.test(minor)) throw Error('amount');
        receivedAmountMinor = minor;
      } catch {
        return setError('Enter the amount you received, using the currency’s decimal places.');
      }
      if (!receivedOn || receivedOn > today())
        return setError('Choose the day you received it. It cannot be a future day.');
      received_on = receivedOn;
      if (!confirm) return setError('Confirm that you have checked this against your own records.');
    } else {
      why = reason.trim();
      if (why.length < 10) return setError('Give a reason of at least ten characters.');
      if (!realCustomerInput() && !/^Synthetic .{3,}/.test(why))
        return setError('Start the reason with the word Synthetic and add a few words.');
    }
    const input = {
      action: 'decide',
      workspaceId,
      programmeId,
      declarationId: d.id,
      decision: mode === 'ack' ? 'ACKNOWLEDGED' : 'REJECTED',
      reason: why,
      receivedAmountMinor,
      receivedOn: received_on,
    };
    const signature = JSON.stringify(input);
    if (intent.current?.signature !== signature)
      intent.current = { signature, commandId: crypto.randomUUID() };
    writing.current = true;
    setBusy(true);
    try {
      await api.current.post({ ...input, commandId: intent.current.commandId });
      intent.current = null;
      setOpen(null);
      setNotice(
        mode === 'ack'
          ? 'Acknowledged. One payment entry was added to your records.'
          : 'Not accepted. Nothing was added to your records, and the participant can read your reason.',
      );
      await load();
      if (mode === 'ack') onDecided();
    } catch (e) {
      if (e instanceof TermsError && e.kind === 'denied') setPhase('hidden');
      else {
        setError(failureText(e));
        // Another organiser may have decided it first: show the latest list.
        if (e instanceof TermsError && e.kind === 'conflict') void load();
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  if (phase !== 'ready' || (items.length === 0 && !notice)) return null;
  return (
    <div className="operator-form" aria-busy={busy}>
      {notice && <p role="status">{notice}</p>}
      {items.length > 0 && (
        <details open>
          <summary>Awaiting Your Check ({items.length})</summary>
          <p>
            Participants tell you here what they say they paid. This is not proof of payment and it
            changes no amount in your records until you acknowledge it.
          </p>
          <ul>
            {items.map((d) => (
              <li key={d.id}>
                <p>
                  {d.registrationLabel ?? 'A participant'} says they paid{' '}
                  {formatMoney(d.amountMinor, d.currency as Code)} on {d.paidOn}.
                  {d.payerReference ? ' Their reference: ' + d.payerReference + '.' : ''}
                  {d.note ? ' Note: ' + d.note : ''}
                </p>
                {d.outstandingMinor !== undefined && (
                  <p>
                    Outstanding in your records for this participant:{' '}
                    {formatMoney(d.outstandingMinor, d.currency as Code)}
                  </p>
                )}
                {open?.id !== d.id && (
                  <div className="guide-actions-row">
                    <button
                      type="button"
                      className="primary-link"
                      disabled={busy}
                      onClick={() => begin(d, 'ack')}
                    >
                      Acknowledge
                    </button>
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => begin(d, 'reject')}
                    >
                      Not Accepted
                    </button>
                  </div>
                )}
                {open?.id === d.id && open.mode === 'ack' && (
                  <form
                    className="operator-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void decide(d, 'ack');
                    }}
                  >
                    <label className="field">
                      Amount you received ({d.currency})
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={received}
                        disabled={busy}
                        onChange={(e) => setReceived(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      Date received
                      <input
                        type="date"
                        value={receivedOn}
                        min="2000-01-01"
                        max={today()}
                        disabled={busy}
                        onChange={(e) => setReceivedOn(e.target.value)}
                      />
                    </label>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={confirm}
                        disabled={busy}
                        onChange={(e) => setConfirm(e.target.checked)}
                      />
                      I checked this against my own records. Adding it records a payment in my own
                      bookkeeping. Corridra does not check or hold any money.
                    </label>
                    {error && <p role="alert">{error}</p>}
                    <button type="submit" className="primary-link" disabled={busy}>
                      {busy ? 'Saving…' : 'Acknowledge Payment'}
                    </button>
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => setOpen(null)}
                    >
                      Cancel
                    </button>
                  </form>
                )}
                {open?.id === d.id && open.mode === 'reject' && (
                  <form
                    className="operator-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void decide(d, 'reject');
                    }}
                  >
                    <label className="field">
                      {realCustomerInput()
                        ? 'Reason the participant will read'
                        : 'Reason the participant will read (start with Synthetic)'}
                      <input
                        type="text"
                        maxLength={300}
                        value={reason}
                        disabled={busy}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    {error && <p role="alert">{error}</p>}
                    <button type="submit" className="primary-link" disabled={busy}>
                      {busy ? 'Saving…' : 'Send Reason'}
                    </button>
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => setOpen(null)}
                    >
                      Cancel
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
