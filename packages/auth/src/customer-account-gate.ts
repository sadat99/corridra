import { DomainError } from '@corridra/domain';
import type { DatabaseClient } from '@corridra/db';

// The closed-account check the customer session boundary runs. It lives in its own file, with no import of the
// session boundary, so the boundary can call it without a circular import.
// It does nothing at all unless the app flag is on, and does nothing until the optional account lifecycle module is
// installed. It never reads the module control: pausing the module never reopens a closed account.
export function customerAccountGateEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED === 'true';
}

// An installed module is cached for the life of the process. A missing one is probed again after a minute, so
// installing the module is noticed without a restart.
const reprobeAfterMs = 60000;
let probe: { installed: boolean; at: number } | undefined;
export function resetClosedAccountGateCache() {
  probe = undefined;
}
async function moduleInstalled(db: DatabaseClient) {
  const now = Date.now();
  if (probe && (probe.installed || now - probe.at < reprobeAfterMs)) return probe.installed;
  const row = (
    await db.query<{ installed: boolean }>(
      "SELECT to_regprocedure('customer.account_closed_gate()') IS NOT NULL AS installed",
    )
  ).rows[0];
  probe = { installed: row?.installed === true, at: now };
  return probe.installed;
}

export const accountClosedCode = 'account_closed';
// Throws a 403 with code account_closed when the signed-in person has closed the account. The transaction is the
// person's own: the database answers about customer.actor_id() only.
export async function closedAccountGate(db: DatabaseClient): Promise<void> {
  if (!(await moduleInstalled(db))) return;
  const closed = (
    await db.query<{ closed: boolean }>('SELECT customer.account_closed_gate() AS closed')
  ).rows[0]?.closed;
  if (!closed) return;
  const state = (
    await db.query<{ state: { status: string; undoUntil: string | null } }>(
      'SELECT customer.account_lifecycle_state() AS state',
    )
  ).rows[0]?.state;
  const until =
    state?.status === 'closed' && state.undoUntil
      ? new Date(state.undoUntil).toISOString().slice(0, 10)
      : null;
  throw new DomainError(
    until ? `Your account is closed. Undo is available until ${until}.` : 'Your account is closed.',
    403,
    accountClosedCode,
  );
}
