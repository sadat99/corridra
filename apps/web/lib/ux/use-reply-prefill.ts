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
  const [state, setState] = useState<PrefillState>({ kind: 'idle' });
  useEffect(() => {
    if (!replyId || !isUuid(replyId)) {
      setState({ kind: 'idle' });
      return;
    }
    let active = true;
    setState({ kind: 'loading' });
    fetch(
      `/api/workspace/reply-quotation-prefill?tenant=${encodeURIComponent(tenant)}&reply=${replyId}`,
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
        if (active) setState(next);
      });
    return () => {
      active = false;
    };
  }, [tenant, replyId]);
  return state;
}
