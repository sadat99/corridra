'use client';

import { useSyncExternalStore } from 'react';

// The last reply a person marked as read, per request. It lives in this browser only (the same
// idea as the language choice): the server never learns what was read, and "forget" clears it.
const seenKey = 'corridra.move.seen';

export const storageWords = 'This device cannot remember what you have read.';

export function parseSeen(text: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

// Where storage is blocked the mark is kept for this visit only (the same rule as the language choice).
let memory: string | null = null;
const listeners = new Set<() => void>();
function snapshot(): string {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(seenKey) ?? '{}';
  } catch {
    return '{}';
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === seenKey) memory = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Whether this browser refuses to keep anything, asked afresh each time (a probe write that is removed at once). */
export function storageBlocked(): boolean {
  try {
    const probe = `${seenKey}.probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return false;
  } catch {
    return true;
  }
}

function commit(value: Record<string, string>) {
  memory = JSON.stringify(value);
  try {
    window.localStorage.setItem(seenKey, memory);
  } catch {
    /* The mark still applies to this visit. */
  }
  listeners.forEach((listener) => listener());
}

/** The raw stored text; null on the server and on the first paint, so nothing is shown as new before the device is asked. */
export function useSeen(): string | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** True when this browser cannot keep what was read. */
export function useStorageBlocked(): boolean {
  return useSyncExternalStore(subscribe, storageBlocked, () => false);
}

export function markSeen(
  current: Record<string, string> | null,
  requestId: string,
  latestReplyAt: string,
) {
  commit({ ...(current ?? {}), [requestId]: latestReplyAt });
}

export function forgetSeen() {
  commit({});
}
