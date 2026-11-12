'use client';
import type { FeeDispute } from '@corridra/auth/customer-programme-economics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { disputeApi, parseOpenDisputes, reasonWords } from './fee-dispute-client';
import { failureText, TermsError } from './terms-client';

type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  programmeId: string;
  // Participant labels by registration, from the economics summary the organiser already sees.
  labels: Record<string, string>;
};

// "Fee questions": what participants asked about their fee. The organiser answers with one of two words. Nothing here reads
// or changes an amount, the ledger or a payment status.
export function ProgrammeFeeDisputeReview(props: Props) {
  return (
    <Scoped
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId + ':' + props.programmeId}
      {...props}
    />
  );
}

function Scoped({ subject, issuer, workspaceId, programmeId, labels }: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'hidden'>('loading');
  const [items, setItems] = useState<FeeDispute[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const writing = useRef(false);
  const intent = useRef<{ signature: string; commandId: string } | null>(null);
  const api = useRef(disputeApi(subject, issuer));

  const load = useCallback(async () => {
    try {
      const body = parseOpenDisputes(
        await api.current.get({ view: 'open', workspaceId, programmeId }),
        workspaceId,
        programmeId,
      );
      if (!active.current) return;
      setItems(body.disputes);
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

  async function answer(d: FeeDispute, outcome: 'RESOLVED' | 'DECLINED') {
    if (writing.current) return;
    setError('');
    const input = { action: 'decide', workspaceId, programmeId, disputeId: d.id, outcome };
    const signature = JSON.stringify(input);
    if (intent.current?.signature !== signature)
      intent.current = { signature, commandId: crypto.randomUUID() };
    writing.current = true;
    setBusy(true);
    try {
      await api.current.post({ ...input, commandId: intent.current.commandId });
      intent.current = null;
      setNotice('Saved. No amount was changed.');
      await load();
    } catch (e) {
      if (e instanceof TermsError && e.kind === 'denied') setPhase('hidden');
      else setError(failureText(e));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  if (phase !== 'ready' || (items.length === 0 && !notice)) return null;
  return (
    <div aria-busy={busy}>
      <h5>Fee Questions</h5>
      {notice && <p role="status">{notice}</p>}
      {items.length > 0 && (
        <details open={items.length <= 3}>
          <summary>
            {items.length === 1 ? '1 question' : items.length + ' questions'} waiting for you
          </summary>
          <p>
            A participant asked about their fee. Check your own records and change them yourself
            where needed. Answering here records your reply only. It does not change any amount.
          </p>
          <ul>
            {items.map((d) => (
              <li key={d.id}>
                {labels[d.registrationId] ?? 'A participant'}: {reasonWords[d.reason]}, asked{' '}
                {d.filedAt.slice(0, 10)}.
                <div className="guide-actions-row">
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => void answer(d, 'RESOLVED')}
                  >
                    Mark as Sorted Out
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => void answer(d, 'DECLINED')}
                  >
                    Nothing to Change
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {error && <p role="alert">{error}</p>}
        </details>
      )}
    </div>
  );
}
