'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { currencies, formatMoney, parseMoney } from '@corridra/domain/opportunities';
import type { PaymentDeclaration } from '@corridra/auth/customer-programme-economics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { declarationApi, parseOwnDeclarations, today } from './payment-declaration-client';
import { failureText, TermsError } from './terms-client';

type Code = keyof typeof currencies;
type Props = {
  subject: string;
  issuer: string;
  registrationId: string;
  // The currencies in which the organiser has recorded a fee for this participant.
  feeCurrencies: string[];
};
const blank = () => (realCustomerInput() ? '' : 'Synthetic ');
const clean = (v: string) => (v.trim() === 'Synthetic' ? '' : v.trim());
const wording = (v: string, min: number) =>
  v === '' || (realCustomerInput() ? v.length >= 2 : /^Synthetic .{3,}/.test(v) && v.length >= min);

// What the participant reads about each declaration. Nothing here says paid, received or confirmed until the organiser acknowledges it.
export function declarationState(d: PaymentDeclaration) {
  if (d.status === 'ACKNOWLEDGED') return 'Confirmed by the organiser';
  if (d.status === 'REJECTED') return 'Not accepted by the organiser: ' + d.reason;
  return 'Declared by you, not yet confirmed by the organiser';
}

// The participant's "I have paid" tool, inside the Fee status block. It tells the organiser; it never changes a recorded amount.
export function ParticipantPaymentDeclaration(props: Props) {
  return (
    <Scoped key={props.issuer + ':' + props.subject + ':' + props.registrationId} {...props} />
  );
}

function Scoped({ subject, issuer, registrationId, feeCurrencies }: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'hidden'>('loading');
  const [items, setItems] = useState<PaymentDeclaration[]>([]);
  const [currency, setCurrency] = useState(feeCurrencies[0] ?? '');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [reference, setReference] = useState(blank());
  const [note, setNote] = useState(blank());
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
      const body = parseOwnDeclarations(
        await api.current.get({ view: 'own', registrationId }),
        registrationId,
      );
      if (!active.current) return;
      setItems(body.declarations);
      setPhase('ready');
    } catch {
      // Not installed, not switched on, or access changed: the tool is simply not shown.
      if (active.current) setPhase('hidden');
    }
  }, [registrationId]);
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    return () => {
      active.current = false;
    };
  }, [load]);

  async function submit() {
    if (writing.current) return;
    setError('');
    const code = currency as Code;
    let amountMinor = '';
    try {
      if (!(code in currencies)) throw Error('currency');
      amountMinor = parseMoney(amount, code);
      if (!/^[1-9][0-9]{0,17}$/.test(amountMinor)) throw Error('amount');
    } catch {
      return setError('Enter the amount you paid, using the currency’s decimal places.');
    }
    if (!paidOn || paidOn > today())
      return setError('Choose the day you paid. It cannot be a future day.');
    const payerReference = clean(reference);
    const memo = clean(note);
    if (!wording(payerReference, 11) || !wording(memo, 11))
      return setError(
        realCustomerInput()
          ? 'Use at least two characters, or leave the field empty.'
          : 'Start with the word Synthetic and add a few words, or leave the field empty.',
      );
    if (!confirm) return setError('Confirm that you paid this amount to the organiser yourself.');
    const input = {
      action: 'declare',
      registrationId,
      currency: code,
      amountMinor,
      paidOn,
      payerReference: payerReference || null,
      note: memo || null,
    };
    const signature = JSON.stringify(input);
    if (intent.current?.signature !== signature)
      intent.current = { signature, commandId: crypto.randomUUID() };
    writing.current = true;
    setBusy(true);
    try {
      await api.current.post({ ...input, commandId: intent.current.commandId });
      intent.current = null;
      setAmount('');
      setReference(blank());
      setNote(blank());
      setConfirm(false);
      setNotice(
        'Sent to the organiser. It stays marked as not confirmed until the organiser checks it.',
      );
      await load();
    } catch (e) {
      if (e instanceof TermsError && e.kind === 'denied') setPhase('hidden');
      else setError(failureText(e));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  if (phase !== 'ready' || feeCurrencies.length === 0) return null;
  return (
    <div className="operator-form" aria-busy={busy}>
      <h5>Tell the Organiser You Paid</h5>
      <p>
        This tells the organiser what you did. It is not proof of payment, and the organiser checks
        it before anything is recorded. Corridra does not collect or check payments.
      </p>
      {items.length > 0 && (
        <ul aria-label="Your payment declarations">
          {items.map((d) => (
            <li key={d.id}>
              You say you paid {formatMoney(d.amountMinor, d.currency as Code)} on {d.paidOn}
              {d.payerReference ? ', your reference ' + d.payerReference : ''}.{' '}
              <span
                className="ux-status"
                data-tone={
                  d.status === 'ACKNOWLEDGED'
                    ? 'positive'
                    : d.status === 'REJECTED'
                      ? 'critical'
                      : 'info'
                }
              >
                {declarationState(d)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>I Have Paid</summary>
        <form
          className="operator-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            Currency
            <select value={currency} disabled={busy} onChange={(e) => setCurrency(e.target.value)}>
              {feeCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Amount you paid
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              disabled={busy}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="field">
            Date paid
            <input
              type="date"
              value={paidOn}
              min="2000-01-01"
              max={today()}
              disabled={busy}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </label>
          <label className="field">
            Your reference (optional)
            <input
              type="text"
              maxLength={120}
              value={reference}
              disabled={busy}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label className="field">
            Note for the organiser (optional)
            <input
              type="text"
              maxLength={500}
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={confirm}
              disabled={busy}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            I paid this amount to the organiser myself. I understand the organiser must check it.
          </label>
          {error && <p role="alert">{error}</p>}
          <button type="submit" className="primary-link" disabled={busy}>
            {busy ? 'Sending…' : 'Send to the Organiser'}
          </button>
        </form>
      </details>
    </div>
  );
}
