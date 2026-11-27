'use client';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type {
  OverviewList,
  OverviewRoute,
  PackVersion,
  RouteSummary,
} from '../../lib/route-pack-editor-read';
import {
  addressFor,
  parseAddress,
  type EditorView,
  type RouteAddress,
} from '../../lib/route-pack-editor-view';

// ADR-093 Phase 3, PR 1: what the Settings page asks the server for, and the browser address it keeps. Reads only.

// The address. `route`, `view` and `section` are query words beside `workspace`. A change is `history.pushState`, which Next.js
// lets a page use for shallow routing, so Back and Forward move through the states; the store is told by a custom event for our
// own pushes (pushState fires none) and by `popstate` for Back and Forward. The server snapshot is empty, so the first render
// is the page without a route, as on main.
const addressEvent = 'corridra-route-pack-address';
// An unknown route key is taken out of the address (replaceState); the page keeps the fact that it was asked for until the next
// move, so the one quiet line can say it.
let routeNotFound = false;
const subscribe = (notify: () => void) => {
  const back = () => {
    routeNotFound = false;
    notify();
  };
  window.addEventListener('popstate', back);
  window.addEventListener(addressEvent, notify);
  return () => {
    window.removeEventListener('popstate', back);
    window.removeEventListener(addressEvent, notify);
  };
};
const notFoundMark = '#route-not-found';
const currentSearch = () => window.location.search + (routeNotFound ? notFoundMark : '');
const noSearch = () => '';
/** The id of the heading focus moves to after the next render, when a person chose a route or a section by click. */
let pendingFocus: string | null = null;
export const takePendingFocus = () => {
  const target = pendingFocus;
  pendingFocus = null;
  return target;
};
export function useRouteAddress(): RouteAddress & { routeNotFound: boolean } {
  const snapshot = useSyncExternalStore(subscribe, currentSearch, noSearch);
  return useMemo(
    () => ({
      ...parseAddress(snapshot.replace(notFoundMark, '')),
      routeNotFound: snapshot.endsWith(notFoundMark),
    }),
    [snapshot],
  );
}
export function goTo(
  next: { route: string | null; view?: EditorView | null; section?: number | null },
  focus?: string,
) {
  pendingFocus = focus ?? null;
  routeNotFound = false;
  window.history.pushState(window.history.state, '', addressFor(window.location.href, next));
  window.dispatchEvent(new Event(addressEvent));
}
/** Takes the route out of the address without a new history entry (an unknown route key). */
export function leaveRoute() {
  routeNotFound = true;
  window.history.replaceState(
    window.history.state,
    '',
    addressFor(window.location.href, { route: null }),
  );
  window.dispatchEvent(new Event(addressEvent));
}

// The reads. 404 is "not here" (the switch is off or the module is not installed), never an error; 403 is a role without
// access; anything else is an error to retry.
export type ReadState = 'unknown' | 'off' | 'denied' | 'error' | 'ready';
const base = '/api/team-control';
async function read<T>(action: string, tenant: string, extra: Record<string, string> = {}) {
  const response = await fetch(`${base}/${action}?${new URLSearchParams({ tenant, ...extra })}`, {
    cache: 'no-store',
  });
  if (response.status === 404) return { state: 'off' as const };
  if (response.status === 403) return { state: 'denied' as const };
  if (!response.ok) return { state: 'error' as const };
  try {
    return { state: 'ready' as const, body: (await response.json()) as T };
  } catch {
    return { state: 'error' as const };
  }
}

export type OverviewData = {
  state: ReadState;
  routes: RouteSummary[];
  /** Asks again; `retrying` is true until the answer arrives. */
  retry: () => void;
  retrying: boolean;
};
/**
 * The list of routes with their completeness. Asked once `enabled`, and again whenever `refreshKey` changes identity (the
 * catalogue the page already loads: after Refresh Reviewed Configuration, Create Reviewed Route and a saved pack). While it is
 * asked again the last answer stays, so the list does not jump. Not asked at all while disabled (the desk switch is off).
 */
export function useRoutePackOverview(
  tenant: string,
  enabled: boolean,
  refreshKey: unknown,
): OverviewData {
  const [result, setResult] = useState<{ state: ReadState; routes: RouteSummary[] }>({
    state: 'unknown',
    routes: [],
  });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    read<OverviewList>('route-pack-overview', tenant)
      .then((answer) => {
        if (!live) return;
        setResult({
          state:
            answer.state === 'ready' && !Array.isArray(answer.body.routes) ? 'error' : answer.state,
          routes:
            answer.state === 'ready' && Array.isArray(answer.body.routes) ? answer.body.routes : [],
        });
      })
      .catch(() => live && setResult({ state: 'error', routes: [] }))
      .finally(() => live && setRetrying(false));
    return () => {
      live = false;
    };
  }, [tenant, enabled, refreshKey, attempt]);
  const retry = useCallback(() => {
    setRetrying(true);
    setAttempt((count) => count + 1);
  }, []);
  return { ...result, retry, retrying };
}

export type DetailData = {
  /** `off`: the route read answered 404 (the switch is off or the module is gone): never an error, the page falls back. */
  state: 'loading' | 'off' | 'denied' | 'error' | 'ready';
  /** Null while it loads, or when the route is not in this workspace. */
  detail: OverviewRoute | null;
  /** Newest first. Null when the read failed or the reader may not see it: the page then leaves that one line out. */
  packHistory: PackVersion[] | null;
  retry: () => void;
  retrying: boolean;
};
/**
 * One route in full, with its pack history. Both reads start together; a failed pack history never blocks the view. A newer
 * request makes an older answer be dropped.
 */
export function useRouteDetail(
  tenant: string,
  routeId: string | null,
  refreshKey: unknown,
): DetailData {
  const [result, setResult] = useState<
    Omit<DetailData, 'retry' | 'retrying'> & { routeId: string | null }
  >({ state: 'loading', detail: null, packHistory: null, routeId: null });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!routeId) return;
    let live = true;
    Promise.all([
      read<OverviewRoute>('route-pack-overview', tenant, { routeId }),
      read<{ versions: PackVersion[] }>('route-pack-pack-history', tenant, { routeId }),
    ])
      .then(([detail, history]) => {
        if (!live) return;
        const packHistory =
          history.state === 'ready' && Array.isArray(history.body.versions)
            ? history.body.versions
            : null;
        setResult(
          detail.state === 'ready'
            ? { state: 'ready', detail: detail.body, packHistory, routeId }
            : {
                state:
                  detail.state === 'denied' ? 'denied' : detail.state === 'off' ? 'off' : 'error',
                detail: null,
                packHistory: null,
                routeId,
              },
        );
      })
      .catch(() => live && setResult({ state: 'error', detail: null, packHistory: null, routeId }))
      .finally(() => live && setRetrying(false));
    return () => {
      live = false;
    };
  }, [tenant, routeId, refreshKey, attempt]);
  const retry = useCallback(() => {
    setRetrying(true);
    setAttempt((count) => count + 1);
  }, []);
  // An answer for another route is not this route's: until its own arrives the view is loading.
  const mine = result.routeId === routeId;
  return {
    state: mine ? result.state : 'loading',
    detail: mine ? result.detail : null,
    packHistory: mine ? result.packHistory : null,
    retry,
    retrying,
  };
}
