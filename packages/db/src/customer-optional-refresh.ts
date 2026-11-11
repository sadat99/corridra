import type { DatabasePool } from './index';
import { migrateCustomerRequestWithdrawal } from './customer-request-withdrawal-migrate';
import { migrateCustomerMoves } from './customer-move-migrate';
import { migrateCustomerMissionMail } from './customer-mission-mail-migrate';
import { migrateCustomerNotifications } from './customer-notification-migrate';

// The optional modules that are not part of the base install run and whose newest files must reach a database that
// already has them (removed member access, owner decision 11 Nov 2026). It re-runs the migrator of a module only when that
// module's registry already exists. It never installs a module that is absent, never calls a configure step and never writes
// a control row: those migrators run only the files not yet recorded, and none of the files names a control table.
// A module that cannot advance is reported as behind and nothing is forced; the caller ends the run with the exact next step.
// No runtime request receives this owner connection.
export type OptionalRefresh = {
  module: 'request withdrawal' | 'move records' | 'mission mail' | 'notifications';
  state: 'not installed' | 'current' | 'advanced' | 'behind';
  detail?: string;
};

const registries = {
  'request withdrawal': 'customer_request_withdrawal_migrations',
  'move records': 'customer_move_migrations',
  'mission mail': 'customer_mission_mail_migrations',
  notifications: 'customer_notification_migrations',
} as const;

// Number of applied files, or null when the module has no registry yet (it is not installed).
async function appliedCount(pool: DatabasePool, module: keyof typeof registries) {
  const schema = registries[module];
  const present = await pool.query<{ present: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [schema + '.applied'],
  );
  if (!present.rows[0]?.present) return null;
  const rows = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${schema}.applied`);
  return rows.rows[0]!.n;
}

export async function refreshInstalledOptionalModules(pool: DatabasePool) {
  const counts = {
    'request withdrawal': await appliedCount(pool, 'request withdrawal'),
    'move records': await appliedCount(pool, 'move records'),
    'mission mail': await appliedCount(pool, 'mission mail'),
    notifications: await appliedCount(pool, 'notifications'),
  };
  const result: OptionalRefresh[] = [];
  const settle = async (module: OptionalRefresh['module']) => {
    const after = await appliedCount(pool, module);
    result.push({
      module,
      state: after !== null && after > (counts[module] ?? 0) ? 'advanced' : 'current',
    });
  };
  const notInstalled = (module: OptionalRefresh['module']) =>
    result.push({ module, state: 'not installed' });

  if (counts['request withdrawal'] === null) notInstalled('request withdrawal');
  else {
    await migrateCustomerRequestWithdrawal(pool);
    await settle('request withdrawal');
  }

  if (counts['move records'] === null) notInstalled('move records');
  else {
    await migrateCustomerMoves(pool);
    await settle('move records');
  }

  if (counts['mission mail'] === null) notInstalled('mission mail');
  else if (counts['request withdrawal'] === null)
    result.push({
      module: 'mission mail',
      state: 'behind',
      detail:
        'mission mail 0003 needs request withdrawal; run mission_mail_action install, which installs request withdrawal first (its control stays closed)',
    });
  else {
    await migrateCustomerMissionMail(pool);
    await settle('mission mail');
  }

  if (counts.notifications === null) notInstalled('notifications');
  else if (counts['request withdrawal'] === null || counts['move records'] === null)
    result.push({
      module: 'notifications',
      state: 'behind',
      detail:
        'notifications 0005 needs request withdrawal and move records; run notifications_action install, which installs them first (their controls stay closed)',
    });
  else {
    await migrateCustomerNotifications(pool);
    await settle('notifications');
  }
  return result;
}

export function assertNoneBehind(rows: OptionalRefresh[]) {
  const behind = rows.filter((row) => row.state === 'behind');
  if (behind.length === 0) return;
  throw new Error(
    'Removed member access is installed for everything that could advance, but these optional modules are behind: ' +
      behind.map((row) => `${row.module} (${row.detail ?? 'cannot advance'})`).join('; ') +
      '. Next step: run Install customer modules again with apply=yes, mission_mail_action=install and notifications_action=install (they install request withdrawal, control closed, first). No switch is changed by this.',
  );
}
