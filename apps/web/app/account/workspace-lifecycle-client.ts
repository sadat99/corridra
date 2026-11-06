import { useCallback, useRef, useState } from 'react';
import type {
  CustomerWorkspaceLifecycleState,
  CustomerWorkspaceLifecycleSummary,
} from '@corridra/auth/customer-workspace-lifecycle';
import { limitWords, notReachedWords } from '../../lib/account-limit';

const endpoint = '/api/customer-workspace-lifecycle';
export type LifecycleState = CustomerWorkspaceLifecycleState;
export type LifecycleSummary = CustomerWorkspaceLifecycleSummary;
export type LifecycleCommand =
  | { action: 'rename'; workspaceId: string; name: string; reason: string; expectedVersion: number }
  | { action: 'archive'; workspaceId: string; expectedVersion: number; confirmName: string }
  | { action: 'restore'; workspaceId: string; expectedVersion: number }
  | {
      action: 'offer_transfer';
      workspaceId: string;
      memberId: string;
      confirmName: string;
      expectedVersion: number;
    }
  | { action: 'cancel_transfer'; workspaceId: string; offerId: string }
  | { action: 'accept_transfer' | 'decline_transfer'; offerId: string };
export type LifecycleDone = {
  workspaceId?: string;
  operation: string;
  name?: string;
  version?: number;
  expiresAt?: string;
};
export type LifecycleResult =
  | { kind: 'done'; done: LifecycleDone }
  | { kind: 'stale'; currentName: string; currentVersion: number }
  | { kind: 'archived' }
  | { kind: 'failed'; message: string; settled: boolean };

export const lifecycleWords = {
  denied: 'You do not have permission to do this.',
  unavailable: 'This is unavailable right now. Nothing was changed.',
  archived: 'This workspace is archived, so this was not saved. Restore it first.',
  notConfirmed: 'This was not confirmed. Try the same request again.',
} as const;

/** UTC with the zone named, written like "6 Nov 2026, 14:30 UTC". */
export const whenWords = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value)) + ' UTC';

export type SessionHeaders = Record<string, string>;
export const sessionHeaders = (subject: string, issuer: string): SessionHeaders => ({
  'x-corridra-customer-subject': subject,
  'x-corridra-customer-issuer': issuer,
});

/** The workspace list. Anything but a list means the control is closed or unavailable: show nothing. */
export async function readLifecycleList(headers: SessionHeaders, signal: AbortSignal) {
  const response = await fetch(endpoint, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers,
  });
  if (!response.ok) return null;
  const value: unknown = await response.json();
  return Array.isArray(value) ? (value as LifecycleSummary[]) : null;
}

export async function readLifecycleState(
  workspaceId: string,
  headers: SessionHeaders,
  signal: AbortSignal,
) {
  const response = await fetch(`${endpoint}?workspaceId=${encodeURIComponent(workspaceId)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers,
  });
  if (!response.ok) return null;
  const value = (await response.json()) as LifecycleState;
  return value && value.open === true && value.workspaceId === workspaceId ? value : null;
}

async function post(
  command: LifecycleCommand,
  commandId: string,
  headers: SessionHeaders,
): Promise<LifecycleResult> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ ...command, commandId }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
      code?: unknown;
      currentName?: unknown;
      currentVersion?: unknown;
    } | null;
    if (response.ok) return { kind: 'done', done: (body ?? {}) as LifecycleDone };
    if (response.status === 409 && body?.code === 'stale')
      return {
        kind: 'stale',
        currentName: String(body.currentName ?? ''),
        currentVersion: Number(body.currentVersion ?? 0),
      };
    if (response.status === 409 && body?.code === 'archived') return { kind: 'archived' };
    if (response.status === 429) return { kind: 'failed', message: limitWords, settled: false };
    if (response.status === 503)
      return { kind: 'failed', message: lifecycleWords.unavailable, settled: false };
    if (response.status === 403)
      return { kind: 'failed', message: lifecycleWords.denied, settled: true };
    // A refusal such as an expired or cancelled offer carries its own plain wording.
    if ([400, 409, 410].includes(response.status) && typeof body?.error === 'string')
      return { kind: 'failed', message: body.error, settled: true };
    return { kind: 'failed', message: lifecycleWords.notConfirmed, settled: false };
  } catch {
    return { kind: 'failed', message: notReachedWords, settled: false };
  }
}

/**
 * One command id per open dialog. It is sent again when an attempt is not settled (rate limit, outage, lost
 * answer) so the database answers a repeat with the same result, and a new one is made after any settled attempt.
 */
export function useLifecycleCommand(headers: SessionHeaders) {
  const commandId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const send = useCallback(
    async (command: LifecycleCommand): Promise<LifecycleResult | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      commandId.current ??= crypto.randomUUID();
      const result = await post(command, commandId.current, headers);
      if (result.kind !== 'failed' || result.settled) commandId.current = null;
      inFlight.current = false;
      setBusy(false);
      return result;
    },
    [headers],
  );
  return { send, busy };
}
