'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { displayDate } from '@corridra/domain/locale';
import { savedMissionHeaders, savedMissionRead, type SavedMissionScope } from '../saved-missions';
const record = z
  .object({
    id: z.uuid(),
    targetId: z.uuid(),
    company: z.string().max(2000),
    decision: z.enum(['SELECT', 'DECLINE', 'NEED_INFORMATION']),
    rationale: z.string().max(10000),
    nextAction: z.string().max(10000),
    dueAt: z.iso.datetime({ offset: true }),
    requirementCurrent: z.boolean(),
    quotationId: z.uuid().nullable(),
    sourceKind: z.string().max(100),
    claimStatus: z.string().max(100),
  })
  .strict();
const result = z.discriminatedUnion('state', [
  z
    .object({
      resourceId: z.uuid(),
      state: z.literal('APPROVED'),
      synthetic: z.literal(true),
      version: z.number().int().positive(),
      expiresAt: z.iso.datetime({ offset: true }),
      decisions: z.array(record).max(30),
    })
    .strict(),
  z
    .object({
      resourceId: z.uuid(),
      state: z.enum(['NOT_APPROVED', 'SOURCE_UNAVAILABLE']),
      synthetic: z.literal(true),
      decisions: z.array(z.never()).max(0),
    })
    .strict(),
]);
type Scope = SavedMissionScope & { resourceId: string };
export function DecisionHistory(props: Scope) {
  return (
    <PrivateHistory
      key={JSON.stringify([props.issuer, props.subject, props.resourceId])}
      {...props}
    />
  );
}
function PrivateHistory({ subject, issuer, resourceId }: Scope) {
  const [data, setData] = useState<z.infer<typeof result> | null>(null),
    [status, setStatus] = useState('idle');
  const controller = useRef<AbortController | null>(null);
  function clear() {
    controller.current?.abort();
    setData(null);
    setStatus('refresh');
  }
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') clear();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', clear);
    return () => {
      controller.current?.abort();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', clear);
    };
  }, []);
  useEffect(() => {
    if (!data) return;
    const remaining = data.state === 'APPROVED' ? Date.parse(data.expiresAt) - Date.now() : 60000;
    const timer = setTimeout(clear, Math.max(0, Math.min(remaining, 60000)));
    return () => clearTimeout(timer);
  }, [data]);
  function load() {
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setData(null);
    setStatus('loading');
    void fetch('/api/customer-decisions?resourceId=' + encodeURIComponent(resourceId), {
      cache: 'no-store',
      signal: task.signal,
      headers: savedMissionHeaders({ subject, issuer }),
    })
      .then(savedMissionRead)
      .then((value) => {
        const parsed = result.parse(value);
        if (
          parsed.resourceId !== resourceId ||
          (parsed.state === 'APPROVED' && Date.parse(parsed.expiresAt) <= Date.now())
        )
          throw Error('failed');
        if (!task.signal.aborted) {
          setData(parsed);
          setStatus('ready');
        }
      })
      .catch((error: unknown) => {
        if (!task.signal.aborted) {
          setData(null);
          setStatus(
            error instanceof Error && ['denied', 'unavailable'].includes(error.message)
              ? error.message
              : 'failed',
          );
        }
      });
  }
  return (
    <section
      className="ux-mission-detail"
      aria-label="Reviewed commercial decisions"
      style={{ overflowWrap: 'anywhere' }}
    >
      <h2>Commercial decisions</h2>
      <p>
        Recorded selections, declines and information requests require separate approval for this
        private report. A selection does not establish an order, contract or payment.
      </p>
      {!data && (
        <p role="status">
          {status === 'loading'
            ? 'Checking approved decisions…'
            : status === 'denied'
              ? 'This account no longer has access. Return to your account and sign in again.'
              : status === 'unavailable'
                ? 'Reviewed decision history is unavailable.'
                : status === 'failed'
                  ? 'Decision history could not be checked. Try again.'
                  : status === 'refresh'
                    ? 'Private details cleared. Refresh to check current access.'
                    : 'Load the decisions explicitly approved for this report.'}
        </p>
      )}
      <button type="button" onClick={load} disabled={status === 'loading'}>
        {data || status === 'refresh' ? 'Refresh reviewed decisions' : 'Load reviewed decisions'}
      </button>
      {status === 'denied' && (
        <a href="/account" className="text-link">
          Return to your account
        </a>
      )}
      {data?.state === 'NOT_APPROVED' && (
        <p>
          No commercial decision disclosure has been approved. This does not mean no decisions
          exist.
        </p>
      )}
      {data?.state === 'SOURCE_UNAVAILABLE' && (
        <p>
          Approved decision sources are unavailable. Ask your operator to review the disclosure.
        </p>
      )}
      {data?.state === 'APPROVED' && (
        <>
          <p className="evidence-label">
            Synthetic reviewed disclosure · version {data.version}. Access expires{' '}
            {displayDate(data.expiresAt)}.
          </p>
          {!data.decisions.length && (
            <p>No decisions are included in the current approved revision.</p>
          )}
          {data.decisions.map((d) => (
            <article className="delivery-card" key={d.id}>
              <h3>{d.company}</h3>
              <p>
                <strong>
                  {d.decision === 'SELECT'
                    ? 'Selected'
                    : d.decision === 'DECLINE'
                      ? 'Declined'
                      : 'More information needed'}
                </strong>{' '}
                · canonical state: {d.decision}
              </p>
              <p>{d.rationale}</p>
              <p>Next action: {d.nextAction}</p>
              <p>Due {displayDate(d.dueAt)}.</p>
              <p className="evidence-label">
                {d.sourceKind} · {d.claimStatus}.{' '}
                {d.requirementCurrent
                  ? 'Original requirement remains current.'
                  : 'The requirement has changed; review the original context.'}
              </p>
              {d.quotationId && (
                <p>
                  Original approved quotation reference: {d.quotationId}. Review its terms and
                  uncertainties above.
                </p>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
