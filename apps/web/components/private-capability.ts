'use client';
import { useSyncExternalStore } from 'react';
function subscribe(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}
/** Capability remains in memory/fragment. A changed scope remounts its private view. */
export function usePrivateCapability(provided?: string) {
  const fragment = useSyncExternalStore(
    subscribe,
    () => window.location.hash.slice(1),
    () => '',
  );
  return provided ?? fragment;
}
export class ParticipantRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function accessDenied(error: unknown) {
  return error instanceof ParticipantRequestError && [401, 403, 404, 410].includes(error.status);
}
export async function checkedResponse(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ParticipantRequestError(
      typeof body?.error === 'string'
        ? body.error
        : 'The request could not be completed. Please try again.',
      response.status,
    );
  }
  return response;
}
