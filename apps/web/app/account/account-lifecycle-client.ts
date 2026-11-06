import type { CustomerAccountLifecycleState } from '@corridra/auth/customer-account-lifecycle';

const endpoint = '/api/customer-account-lifecycle';
export type AccountState = CustomerAccountLifecycleState;
export type AccountCommand =
  { action: 'close'; confirmation: string } | { action: 'undo' } | { action: 'file_erasure' };
export const accountEndpoint = endpoint;

/** The person's own account state. Anything but an open answer means the control is closed or unavailable. */
export async function readAccountState(signal?: AbortSignal): Promise<AccountState | null> {
  try {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) return null;
    const value = (await response.json()) as AccountState;
    return value && value.open === true ? value : null;
  } catch {
    return null;
  }
}
