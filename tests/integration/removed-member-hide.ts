// Pure gate shared by the removed member suites. It imports nothing, because the vi.mock of node:fs/promises in each suite
// loads it while that module is being replaced.
//
// The seven files of "removed member access" (owner decision 11 Nov 2026, "No, remove access (Recommended)") are kept away
// from the migrators in two cases: while a suite is building the state production is in today (globalThis.__removedHide is
// true), and for the whole run when REMOVED_BASE_CHECK=1. The second is how every suite is shown to fail on the commit before
// this change: the migrators then build exactly what main builds.
export const REMOVED_FILES: Record<string, string> = {
  'customer-migrations': '0004_workspace_member_current.sql',
  'customer-real-use-migrations': '0014_removed_member_access.sql',
  'commercial-readiness-migrations': '0011_removed_member_request_received.sql',
  'customer-move-migrations': '0002_removed_member_moves.sql',
  'customer-request-withdrawal-migrations': '0003_removed_member_withdrawals.sql',
  'customer-mission-mail-migrations': '0004_removed_member_mail.sql',
  'customer-notification-migrations': '0006_removed_member_notifications.sql',
};
export function removedFileHidden(directory: string, name: string) {
  const gate = globalThis as { __removedHide?: boolean };
  if (process.env.REMOVED_BASE_CHECK !== '1' && !gate.__removedHide) return false;
  const last =
    directory
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? '';
  return REMOVED_FILES[last] === name;
}
