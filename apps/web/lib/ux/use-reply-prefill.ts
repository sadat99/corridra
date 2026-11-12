'use client';
import { useEffect, useState } from 'react';
import { isUuid, type EligiblePrefill } from '../reply-review-view';

export type PrefillState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'eligible'; prefill: EligiblePrefill }
  | { kind: 'ineligible'; code: string }
  | { kind: 'unavailable' }
  | { kind: 'denied' }
  | { kind: 'error' };

/**
 * Asks once whether a published reply can be prepared as an offer (ADR-081). With no reply id nothing is requested.
 * The answer only decides what is shown; the database decides again when the offer is saved.
 */
export function useReplyPrefill(tenant: string, replyId: string | null): PrefillState {
  const valid = replyId && isUuid(replyId) ? replyId : null;
  // The answer is kept with the reply it belongs to, so a different reply is "loading" without setting state in the effect.
  const [answer, setAnswer] = useState<{ reply: string; state: PrefillState } | null>(null);
  useEffect(() => {
    if (!valid) return;
    let active = true;
    fetch(
      `/api/workspace/reply-quotation-prefill?tenant=${encodeURIComponent(tenant)}&reply=${valid}`,
      { cache: 'no-store' },
    )
      .then(async (response): Promise<PrefillState> => {
        if (response.status === 503) return { kind: 'unavailable' };
        if (response.status === 403) return { kind: 'denied' };
        if (!response.ok) return { kind: 'error' };
        const data = await response.json();
        if (data?.eligible === true && isUuid(data.missionId))
          return { kind: 'eligible', prefill: data as EligiblePrefill };
        if (data?.eligible === false && typeof data.reason === 'string')
          return { kind: 'ineligible', code: data.reason };
        return { kind: 'error' };
      })
      .catch((): PrefillState => ({ kind: 'error' }))
      .then((next) => {
        if (active) setAnswer({ reply: valid, state: next });
      });
    return () => {
      active = false;
    };
  }, [tenant, valid]);
  if (!valid) return { kind: 'idle' };
  return answer?.reply === valid ? answer.state : { kind: 'loading' };
}
