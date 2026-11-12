// Pure gate shared by the removed member suites. It imports nothing, because the vi.mock of node:fs/promises in each suite
// loads it while that module is being replaced.
//
// The ten files of "removed member access" (owner decision 11 Nov 2026, "No, remove access (Recommended)") are kept away
// from the migrators in two cases: while a suite is building the state production is in today (globalThis.__removedHide is
// true), and for the whole run when REMOVED_BASE_CHECK=1. The second is how every suite is shown to fail on the commit before
// this change: the migrators then build exactly what main builds.
//
// The eleventh file, the erasure file of the account lifecycle module (owner decisions 11 Nov 2026: "Yes, add an erasure path
// (Recommended)", "Staff by hand, tracked (Recommended)", "One team only (Recommended)", "No, workspace decides (Recommended)"),
// is kept away in the same two cases and in two more: while a suite sets globalThis.__erasureHide (the state of main after the
// ten files, before the erasure file), and for the whole run when ERASURE_BASE_CHECK=1, which shows the erasure suite failing on
// main while the ten files stay in place.
export const REMOVED_FILES: Record<string, string[]> = {
  'customer-migrations': ['0004_workspace_member_current.sql'],
  'customer-real-use-migrations': ['0014_removed_member_access.sql'],
  'commercial-readiness-migrations': [
    '0011_removed_member_request_received.sql',
    '0012_removed_member_inbox.sql',
  ],
  'customer-move-migrations': ['0002_removed_member_moves.sql'],
  'customer-request-withdrawal-migrations': ['0003_removed_member_withdrawals.sql'],
  'customer-mission-mail-migrations': ['0004_removed_member_mail.sql'],
  'customer-notification-migrations': ['0006_removed_member_notifications.sql'],
  'customer-decision-card-migrations': ['0002_removed_member_decision_cards.sql'],
  'customer-programme-projection-migrations': ['0003_removed_member_projection.sql'],
};
export const ERASURE_FILES: Record<string, string[]> = {
  'customer-account-lifecycle-migrations': ['0005_removed_member_erasure.sql'],
};
// Files that come after the removed member files in a module's ladder and belong to a later change. These suites prove the
// ladder up to real-use 0014 (and its counts), so a later file is kept away from every migrator they use, as on main today.
export const LATER_FILES: Record<string, string[]> = {
  'customer-real-use-migrations': [
    '0015_participant_fee_status.sql',
    '0016_participant_payment_declaration.sql',
    '0017_experience_outreach_counts.sql',
  ],
};
export function removedFileHidden(directory: string, name: string) {
  const gate = globalThis as { __removedHide?: boolean; __erasureHide?: boolean };
  const last =
    directory
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? '';
  if (LATER_FILES[last]?.includes(name)) return true;
  const removedGate = process.env.REMOVED_BASE_CHECK === '1' || gate.__removedHide === true;
  if (ERASURE_FILES[last]?.includes(name))
    return removedGate || process.env.ERASURE_BASE_CHECK === '1' || gate.__erasureHide === true;
  return removedGate && (REMOVED_FILES[last]?.includes(name) ?? false);
}
