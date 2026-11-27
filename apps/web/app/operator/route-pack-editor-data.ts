'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  FactVersion,
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
type Move = { route: string | null; view?: EditorView | null; section?: number | null };
/**
 * PR 2b: the editor registers one guard while a route holds edits that are not saved. A move to another route (or to none) asks
 * it first: it answers true when it took the move over (it asks the person, and calls `go` only after "Leave Route"), false when
 * the move may go on. Moves inside the same route (a view, a section) are never asked, and Back and Forward are never blocked.
 */
export type LeaveGuard = (go: () => void) => boolean;
let leaveGuard: LeaveGuard | null = null;
export function setLeaveGuard(guard: LeaveGuard | null) {
  leaveGuard = guard;
}
function move(next: Move, focus?: string) {
  pendingFocus = focus ?? null;
  routeNotFound = false;
  window.history.pushState(window.history.state, '', addressFor(window.location.href, next));
  window.dispatchEvent(new Event(addressEvent));
}
export function goTo(next: Move, focus?: string) {
  const current = parseAddress(window.location.search).route;
  if (leaveGuard && next.route !== current && leaveGuard(() => move(next, focus))) return;
  move(next, focus);
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
  /**
   * Asks again quietly (after a save): a failed answer keeps the list that was shown, so the open route and its "Saved" line
   * stay on screen. A later read or Try Again still shows a failure.
   */
  refresh: () => void;
  /** ADR-093 Phase 3, PR 4: the one-person module is installed (the list's capabilities), for the import save line. */
  onePersonPublication: boolean;
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
  const [result, setResult] = useState<{
    state: ReadState;
    routes: RouteSummary[];
    onePersonPublication?: boolean;
  }>({
    state: 'unknown',
    routes: [],
  });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  // Set by `refresh` for the one read it starts: that read may not replace a list that was shown with a failure.
  const quiet = useRef(false);
  useEffect(() => {
    // Taken before anything else, so a refresh asked while disabled never makes a later read keep a list.
    const keepShown = quiet.current;
    quiet.current = false;
    if (!enabled) return;
    let live = true;
    const show = (next: {
      state: ReadState;
      routes: RouteSummary[];
      onePersonPublication?: boolean;
    }) =>
      setResult((shown) =>
        keepShown && next.state !== 'ready' && shown.state === 'ready' ? shown : next,
      );
    read<OverviewList>('route-pack-overview', tenant)
      .then((answer) => {
        if (!live) return;
        show({
          state:
            answer.state === 'ready' && !Array.isArray(answer.body.routes) ? 'error' : answer.state,
          routes:
            answer.state === 'ready' && Array.isArray(answer.body.routes) ? answer.body.routes : [],
          onePersonPublication:
            answer.state === 'ready' && answer.body.capabilities?.onePersonPublication === true,
        });
      })
      .catch(() => live && show({ state: 'error', routes: [] }))
      .finally(() => live && setRetrying(false));
    return () => {
      live = false;
    };
  }, [tenant, enabled, refreshKey, attempt]);
  const retry = useCallback(() => {
    setRetrying(true);
    setAttempt((count) => count + 1);
  }, []);
  const refresh = useCallback(() => {
    quiet.current = true;
    setAttempt((count) => count + 1);
  }, []);
  return {
    state: result.state,
    routes: result.routes,
    onePersonPublication: result.onePersonPublication === true,
    retry,
    retrying,
    refresh,
  };
}

type RouteRead = Omit<DetailData, 'retry' | 'retrying' | 'reload'> & { routeId: string | null };
/** One route in full with its pack history. A failed pack history never blocks the view. */
export async function readRoute(tenant: string, routeId: string): Promise<RouteRead> {
  const [detail, history] = await Promise.all([
    read<OverviewRoute>('route-pack-overview', tenant, { routeId }),
    read<{ versions: PackVersion[] }>('route-pack-pack-history', tenant, { routeId }),
  ]);
  const packHistory =
    history.state === 'ready' && Array.isArray(history.body.versions)
      ? history.body.versions
      : null;
  // PR 4: a role without audit.read is refused the pack history (403) and draws no pack rows; any other miss is a failed read.
  const packHistoryState: PackHistoryState = packHistory
    ? 'ready'
    : history.state === 'denied'
      ? 'denied'
      : 'failed';
  return detail.state === 'ready'
    ? { state: 'ready', detail: detail.body, packHistory, packHistoryState, routeId }
    : {
        state: detail.state === 'denied' ? 'denied' : detail.state === 'off' ? 'off' : 'error',
        detail: null,
        packHistory: null,
        packHistoryState: 'failed',
        routeId,
      };
}

export type PackHistoryState = 'ready' | 'denied' | 'failed';
export type DetailData = {
  /** `off`: the route read answered 404 (the switch is off or the module is gone): never an error, the page falls back. */
  state: 'loading' | 'off' | 'denied' | 'error' | 'ready';
  /** Null while it loads, or when the route is not in this workspace. */
  detail: OverviewRoute | null;
  /** Newest first. Null when the read failed or the reader may not see it: the page then leaves that one line out. */
  packHistory: PackVersion[] | null;
  /** PR 4: whether the pack history was read, refused to this role (no pack rows are drawn) or failed. */
  packHistoryState: PackHistoryState;
  retry: () => void;
  retrying: boolean;
  /**
   * Reads the route again without the loading state (the rows stay) and answers with what was read, for the conflict flow of
   * Save Route Facts. Only an answer that is ready replaces what the page shows; a failed read changes nothing.
   */
  reload: () => Promise<{ state: RouteRead['state']; detail: OverviewRoute | null }>;
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
  const [result, setResult] = useState<RouteRead>({
    state: 'loading',
    detail: null,
    packHistory: null,
    packHistoryState: 'failed',
    routeId: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!routeId) return;
    let live = true;
    readRoute(tenant, routeId)
      .then((answer) => live && setResult(answer))
      .catch(
        () =>
          live &&
          setResult({
            state: 'error',
            detail: null,
            packHistory: null,
            packHistoryState: 'failed',
            routeId,
          }),
      )
      .finally(() => live && setRetrying(false));
    return () => {
      live = false;
    };
  }, [tenant, routeId, refreshKey, attempt]);
  // The route a reload belongs to: an answer that arrives after the person moved to another route is dropped.
  const asked = useRef<string | null>(null);
  useEffect(() => {
    asked.current = routeId ? `${tenant}/${routeId}` : null;
  }, [tenant, routeId]);
  const reload = useCallback(async () => {
    if (!routeId) return { state: 'error' as const, detail: null };
    const key = `${tenant}/${routeId}`;
    try {
      const answer = await readRoute(tenant, routeId);
      if (answer.state === 'ready' && asked.current === key) setResult(answer);
      return { state: answer.state, detail: answer.detail };
    } catch {
      return { state: 'error' as const, detail: null };
    }
  }, [tenant, routeId]);
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
    packHistoryState: mine ? result.packHistoryState : 'failed',
    retry,
    retrying,
    reload,
  };
}

/**
 * ADR-093 Phase 3, PR 4: the fact history of one route, newest first (up to 100), read when History is first opened. Any role
 * that reads route facts may read it (missions.read).
 */
export async function readFactHistory(
  tenant: string,
  routeId: string,
): Promise<{ state: 'ready'; versions: FactVersion[] } | { state: 'failed' }> {
  try {
    const answer = await read<{ versions: FactVersion[] }>('route-pack-fact-history', tenant, {
      routeId,
    });
    return answer.state === 'ready' && Array.isArray(answer.body.versions)
      ? { state: 'ready', versions: answer.body.versions }
      : { state: 'failed' };
  } catch {
    return { state: 'failed' };
  }
}
