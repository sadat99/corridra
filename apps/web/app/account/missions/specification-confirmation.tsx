'use client';
import { useEffect, useRef, useState } from 'react';
import {
  specificationReviewList,
  specificationConfirmationReceipt,
  type specificationConfirmationInput,
} from '@corridra/domain/specification-confirmation';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import type { z } from 'zod';
import { SpecificationFields } from '../../../components/specification-fields';
import { savedMissionHeaders, savedMissionRead, type SavedMissionScope } from '../saved-missions';
type Props = SavedMissionScope & { resourceId: string };
export function SpecificationConfirmation(props: Props) {
  return (
    <PrivateConfirmation
      key={JSON.stringify([props.subject, props.issuer, props.resourceId])}
      {...props}
    />
  );
}
function PrivateConfirmation({ subject, issuer, resourceId }: Props) {
  const [data, setData] = useState<z.infer<typeof specificationReviewList> | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<z.infer<typeof specificationConfirmationInput> | null>(null),
    [checked, setChecked] = useState<Record<string, boolean>>({});
  const controller = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  function clear() {
    controller.current?.abort();
    setData(null);
    setPending(null);
    setChecked({});
    setBusy(false);
    inFlight.current = false;
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden) clear();
    };
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', hide);
    return () => {
      controller.current?.abort();
      window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(
      clear,
      Math.max(0, Math.min(60000, Date.parse(data.expiresAt) - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [data]);
  async function load() {
    if (inFlight.current) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setData(null);
    setPending(null);
    setChecked({});
    setBusy(true);
    setMessage('');
    try {
      const value = specificationReviewList.parse(
        await fetch(
          '/api/customer-specification-confirmations?resourceId=' + encodeURIComponent(resourceId),
          {
            headers: savedMissionHeaders({ subject, issuer }),
            cache: 'no-store',
            signal: task.signal,
          },
        ).then(savedMissionRead),
      );
      if (
        value.resourceId !== resourceId ||
        !customerProvenanceAllowed(value.synthetic) ||
        Date.parse(value.expiresAt) <= Date.now()
      )
        throw new Error('denied');
      if (!task.signal.aborted) setData(value);
    } catch (error) {
      if (!task.signal.aborted)
        setMessage(
          error instanceof Error && error.message === 'unavailable'
            ? 'Specification confirmation is not available yet.'
            : 'Your current access could not be checked. Reload before confirming.',
        );
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  async function confirm(review: z.infer<typeof specificationReviewList>['reviews'][number]) {
    if (inFlight.current) return;
    const command = pending ?? {
      resourceId,
      commandId: crypto.randomUUID(),
      requestId: review.requestId,
      requirementId: review.requirementId,
      requirementVersion: review.requirementVersion,
      requirementDigest: review.requirementDigest,
      acknowledged: true as const,
    };
    if (!checked[review.requestId] || command.requestId !== review.requestId) return;
    inFlight.current = true;
    setPending(command);
    setBusy(true);
    setMessage('');
    try {
      const receipt = specificationConfirmationReceipt.parse(
        await fetch('/api/customer-specification-confirmations', {
          method: 'POST',
          headers: savedMissionHeaders({ subject, issuer }),
          body: JSON.stringify(command),
        }).then(savedMissionRead),
      );
      if (receipt.id !== command.commandId) throw new Error('denied');
      setPending(null);
      setData(null);
      setChecked({});
      setMessage(
        'Your confirmation was recorded. It does not authorise a purchase, contract or payment.',
      );
    } catch (error) {
      if (error instanceof Error && ['denied', 'unavailable'].includes(error.message)) {
        setData(null);
        setPending(null);
        setChecked({});
        setMessage('Access or requirements changed. Reload before confirming.');
      } else
        setMessage(
          'The response was interrupted. Retry the same confirmation to check whether it was recorded.',
        );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Confirm the commercial requirements"
      className="detail-card"
      lang="en"
      dir="ltr"
    >
      <h2>Confirm the commercial requirements</h2>
      <p>
        Check the product, specification and obligations. Confirmation records the requirements for
        the next commercial step. It does not authorise a purchase, contract or payment.
      </p>
      <button type="button" disabled={busy} onClick={() => void load()}>
        Review current requirements
      </button>
      {message && <p role="status">{message}</p>}
      {data && data.reviews.length === 0 && (
        <p>No specification confirmation has been requested.</p>
      )}
      {data?.reviews.map((review) => (
        <article key={review.requestId} style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <h3>{review.fields?.product ?? 'Previous requirement review'}</h3>
          <p>
            {review.state === 'CONFIRMED'
              ? 'Confirmation recorded for these requirements.'
              : review.state === 'REVIEW_REQUIRED'
                ? 'The requirements changed or need a new review. Ask Corridra for an updated request.'
                : review.state === 'RESPONDED'
                  ? 'Your reply is recorded. A reply does not confirm the specification.'
                  : review.state === 'CANCELLED'
                    ? 'This confirmation request was cancelled.'
                    : 'Corridra is waiting for your review.'}
          </p>
          {review.declaration && <p>{review.declaration}</p>}
          {review.fields && <SpecificationFields fields={review.fields} />}
          {review.state === 'OPEN' && (
            <>
              <p>
                If anything needs changing, reply to the requirement question below. Corridra can
                issue a revised request.
              </p>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={checked[review.requestId] ?? false}
                  disabled={busy || !!pending}
                  onChange={(event) =>
                    setChecked((old) => ({ ...old, [review.requestId]: event.target.checked }))
                  }
                />{' '}
                I reviewed these exact requirements and confirm they reflect what I need.
              </label>
              <button
                type="button"
                disabled={
                  busy ||
                  !checked[review.requestId] ||
                  (!!pending && pending.requestId !== review.requestId)
                }
                onClick={() => void confirm(review)}
              >
                {pending?.requestId === review.requestId
                  ? 'Retry same confirmation'
                  : 'Confirm these requirements'}
              </button>
            </>
          )}
        </article>
      ))}
    </section>
  );
}
