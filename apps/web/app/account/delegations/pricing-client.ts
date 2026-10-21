'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Small shared browser helpers for the pricing, series and export sections. Nothing here decides authority:
// every answer is checked again by the database, and a denial simply clears what was shown.
export type Headers = Record<string, string>;
export type ViewState<T> = {
  status: 'loading' | 'ready' | 'failed' | 'denied' | 'unavailable';
  data: T | null;
  message: string;
};
export const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= max;
export const minorText = (v: unknown): v is string =>
  typeof v === 'string' && /^-?(0|[1-9][0-9]{0,24})$/.test(v);
export const syntheticOk = (v: string) => /^Synthetic .{3,}/.test(v.trim());
export const deniedMessage = 'Account or workspace access changed. Private details were cleared.';
export const expiredMessage = 'This private view expired. Reload to check access again.';

export function customerHeaders(subject: string, issuer: string): Headers {
  return { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer };
}

// Loads one private view. Passing null waits. The result is parsed by `check`, which throws on any unexpected shape.
export function usePrivateView<T extends { expiresAt: string }>(
  url: string | null,
  headers: Headers,
  check: (value: unknown) => T,
  unavailable: string,
): [ViewState<T>, () => void] {
  const [state, setState] = useState<ViewState<T>>({ status: 'loading', data: null, message: '' });
  const active = useRef(true);
  const task = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkRef = useRef(check);
  const headersRef = useRef(headers);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    checkRef.current = check;
    headersRef.current = headers;
  });
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    active.current = true;
    if (!url) return;
    const controller = new AbortController();
    task.current?.abort();
    task.current = controller;
    const lose = (status: 'denied' | 'failed' | 'unavailable', message: string) => {
      if (timer.current) clearTimeout(timer.current);
      if (!controller.signal.aborted && active.current) setState({ status, data: null, message });
    };
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setState((s) => (s.status === 'ready' ? s : { status: 'loading', data: null, message: '' }));
      try {
        const r = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: headersRef.current,
          signal: controller.signal,
        });
        if (controller.signal.aborted || !active.current) return;
        if ([401, 403, 409].includes(r.status)) return lose('denied', deniedMessage);
        if (r.status === 503) return lose('unavailable', unavailable);
        if (!r.ok) throw Error('read failed');
        const data = checkRef.current(await r.json());
        if (controller.signal.aborted || !active.current) return;
        if (timer.current) clearTimeout(timer.current);
        const wait = Date.parse(data.expiresAt) - Date.now();
        if (!(wait > 0)) return lose('failed', expiredMessage);
        timer.current = setTimeout(() => lose('failed', expiredMessage), wait);
        setState({ status: 'ready', data, message: '' });
      } catch {
        lose('failed', 'This could not be loaded. Reload to check access and try again.');
      }
    });
    return () => {
      active.current = false;
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [url, tick, unavailable]);
  return [state, reload];
}

export type WriteResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; kind: 'denied' | 'stale' | 'invalid' | 'failed'; message: string };

// One write. The caller supplies a stable command id so a retry of the same intent is safe.
export async function postJson(
  url: string,
  headers: Headers,
  payload: Record<string, unknown>,
): Promise<WriteResult> {
  const r = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const body: unknown = await r.json().catch(() => null);
  const changed =
    r.status === 409 &&
    object(body) &&
    typeof body.error === 'string' &&
    body.error.includes('account changed');
  if ([401, 403].includes(r.status) || changed)
    return { ok: false, kind: 'denied', message: deniedMessage };
  if (r.status === 409)
    return {
      ok: false,
      kind: 'stale',
      message:
        'This changed since you opened it, or one of the rows is not valid. Nothing was saved. Reload to see the latest.',
    };
  if (r.status === 400)
    return {
      ok: false,
      kind: 'invalid',
      message: 'Some details are not valid. Check the wording, numbers and dates.',
    };
  if (!r.ok || !object(body))
    return {
      ok: false,
      kind: 'failed',
      message: 'It could not be saved. What you typed is kept; try again.',
    };
  return { ok: true, body };
}

// Stable command ids per intent: the same typed request reuses its id until it succeeds.
export function useCommandIds() {
  const ids = useRef<Map<string, string>>(new Map());
  const forIntent = useCallback((signature: string) => {
    let id = ids.current.get(signature);
    if (!id) {
      id = crypto.randomUUID();
      ids.current.set(signature, id);
    }
    return id;
  }, []);
  const clear = useCallback(() => ids.current.clear(), []);
  return { forIntent, clear };
}

// Adds whole months to an ISO date, keeping the day where the month allows it and otherwise the last day.
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return (
    String(year).padStart(4, '0') +
    '-' +
    String(month + 1).padStart(2, '0') +
    '-' +
    String(Math.min(d, last)).padStart(2, '0')
  );
}
