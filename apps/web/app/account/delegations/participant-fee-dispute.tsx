'use client';
import type { FeeDispute, FeeDisputeReason } from '@corridra/auth/customer-programme-economics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { disputeApi, parseOwnDisputes, reasonWords, statusWords } from './fee-dispute-client';
import { failureText, TermsError } from './terms-client';

type Props = { subject: string; issuer: string; registrationId: string };

// "Ask About Your Fee": the participant picks one reason from a short list. No amount and no words are sent. It tells the
// organiser to look; it never changes a recorded amount, the amount outstanding or a payment status.
export function ParticipantFeeDispute(props: Props) {
  return (
    <Scoped key={props.issuer + ':' + props.subject + ':' + props.registrationId} {...props} />
  );
}

function Scoped({ subject, issuer, registrationId }: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'hidden'>('loading');
  const [items, setItems] = useState<FeeDispute[]>([]);
  const [reason, setReason] = useState<FeeDisputeReason>('AMOUNT_WRONG');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const writing = useRef(false);
  const intent = useRef<{ reason: string; commandId: string } | null>(null);
  const api = useRef(disputeApi(subject, issuer));

  const load = useCallback(async () => {
    try {
      const body = parseOwnDisputes(
        await api.current.get({ view: 'own', registrationId }),
        registrationId,
      );
      if (!active.current) return;
      setItems(body.disputes);
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
    if (intent.current?.reason !== reason)
      intent.current = { reason, commandId: crypto.randomUUID() };
    writing.current = true;
    setBusy(true);
    try {
      await api.current.post({
        action: 'file',
        commandId: intent.current.commandId,
        registrationId,
        reason,
      });
      intent.current = null;
      setNotice('Sent to the organiser. Your fee and what you owe are not changed by this.');
      await load();
    } catch (e) {
      if (e instanceof TermsError && e.kind === 'denied') setPhase('hidden');
      else setError(failureText(e));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  if (phase !== 'ready') return null;
  const waiting = new Set(items.filter((d) => d.status === 'OPEN').map((d) => d.reason));
  return (
    <div className="operator-form" aria-busy={busy}>
      <h5>Ask About Your Fee</h5>
      <p>
        Tell the organiser that something about your fee looks wrong. This only sends them a
        question. It does not change your fee or what you owe, and Corridra does not collect or
        check payments.
      </p>
      {items.length > 0 && (
        <ul aria-label="Your fee questions">
          {items.map((d) => (
            <li key={d.id}>
              {reasonWords[d.reason]}.{' '}
              <span className="ux-status" data-tone={d.status === 'OPEN' ? 'info' : 'positive'}>
                {statusWords[d.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>Ask About My Fee</summary>
        <form
          className="operator-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            What is the question?
            <select
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value as FeeDisputeReason)}
            >
              {(Object.keys(reasonWords) as FeeDisputeReason[]).map((r) => (
                <option key={r} value={r}>
                  {reasonWords[r]}
                </option>
              ))}
            </select>
          </label>
          {waiting.has(reason) && (
            <p role="status">You already asked this. The organiser has not answered yet.</p>
          )}
          {error && <p role="alert">{error}</p>}
          <button type="submit" className="primary-link" disabled={busy || waiting.has(reason)}>
            {busy ? 'Sending…' : 'Send to the Organiser'}
          </button>
        </form>
      </details>
    </div>
  );
}
