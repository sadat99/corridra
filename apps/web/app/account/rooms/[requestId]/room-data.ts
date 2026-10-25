'use client';

import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { missionStatus } from '@corridra/domain/missions';
import { useCallback, useEffect, useRef, useState } from 'react';

export type RoomDetail = {
  id: string;
  available: boolean;
  original: { objective?: string; market?: string } | null;
  progress: null | {
    status: string;
    receivedAt: string;
    replies: { body: string; createdAt: string }[];
  };
};
export type RoomState = 'loading' | 'ready' | 'denied' | 'unavailable' | 'failed';

function checked(value: unknown, requestId: string): RoomDetail {
  const d = value as Partial<RoomDetail> | null;
  if (
    !d ||
    d.id !== requestId ||
    !customerProvenanceAllowed((value as { synthetic?: unknown }).synthetic)
  )
    throw new Error('failed');
  if (d.available === false && d.original === null && d.progress === null) return d as RoomDetail;
  if (
    d.available !== true ||
    !d.original ||
    typeof d.original !== 'object' ||
    !d.progress ||
    !missionStatus.options.includes(d.progress.status as (typeof missionStatus.options)[number]) ||
    !Number.isFinite(Date.parse(d.progress.receivedAt)) ||
    !Array.isArray(d.progress.replies) ||
    !d.progress.replies.every(
      (r) => typeof r.body === 'string' && Number.isFinite(Date.parse(r.createdAt)),
    )
  )
    throw new Error('failed');
  return d as RoomDetail;
}

/**
 * Reads one request the way the saved request page does: from the private request interface, with the
 * person's own headers, never cached, and cleared when the page is hidden so nothing lingers on a
 * shared screen.
 */
export function useRoomDetail(requestId: string, subject: string, issuer: string) {
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [state, setState] = useState<RoomState>('loading');
  const controller = useRef<AbortController | null>(null);
  const read = useCallback(() => {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    void fetch('/api/customer-requests/' + encodeURIComponent(requestId), {
      signal: pending.signal,
      cache: 'no-store',
      headers: { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer },
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            [401, 403, 409].includes(response.status)
              ? 'denied'
              : response.status === 503
                ? 'unavailable'
                : 'failed',
          );
        const next = checked(await response.json(), requestId);
        if (!pending.signal.aborted) {
          setDetail(next);
          setState('ready');
        }
      })
      .catch((error) => {
        if (!pending.signal.aborted) {
          setDetail(null);
          setState(
            error instanceof Error && ['denied', 'unavailable'].includes(error.message)
              ? (error.message as RoomState)
              : 'failed',
          );
        }
      });
  }, [requestId, subject, issuer]);
  useEffect(() => {
    function clear() {
      controller.current?.abort();
      setDetail(null);
      setState('loading');
    }
    function visibility() {
      if (document.hidden) clear();
      else read();
    }
    function show(event: PageTransitionEvent) {
      if (event.persisted) {
        clear();
        read();
      }
    }
    read();
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      controller.current?.abort();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [read]);
  return { detail, state, retry: read };
}
