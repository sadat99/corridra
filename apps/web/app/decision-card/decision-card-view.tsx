'use client';
import { useEffect, useState } from 'react';
import { cardFromAnswer, tokenFromHash } from '../../lib/decision-card-page';
import { DecisionCardPage, type CardPageState } from './decision-card-page';

/**
 * Reads the link secret from the address fragment, takes it out of the address bar at once, and sends it in a
 * POST body. It is never put in a query string, never stored, and the request carries no cookies. Every answer
 * that is not an open card, including a network failure, shows the same single message.
 */
export function DecisionCardView() {
  const [state, setState] = useState<CardPageState>({ kind: 'loading' });
  useEffect(() => {
    const token = tokenFromHash(window.location.hash);
    // Out of the address bar before anything is sent, whatever it held.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const controller = new AbortController();
    if (!token) {
      queueMicrotask(() => setState({ kind: 'unavailable' }));
      return () => controller.abort();
    }
    fetch('/api/decision-card', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
      .then(async (response) => cardFromAnswer(response.ok ? await response.json() : null))
      .catch(() => null)
      .then((card) => {
        if (!controller.signal.aborted)
          setState(card ? { kind: 'open', card } : { kind: 'unavailable' });
      });
    return () => controller.abort();
  }, []);
  return <DecisionCardPage state={state} />;
}
