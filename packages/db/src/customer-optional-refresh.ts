import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
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

const directories = {
  'request withdrawal': 'customer-request-withdrawal-migrations',
  'move records': 'customer-move-migrations',
  'mission mail': 'customer-mission-mail-migrations',
  notifications: 'customer-notification-migrations',
} as const;

// True only when the recorded files and the module's files are the same names with the same sha256 (same algorithm as the
// migrators). Then there is nothing to apply and the migrator, which would re-check every prerequisite first, is not called.
// Any difference (a missing, extra or changed file) is false, and the migrator then runs and refuses or advances as always.
async function registryMatchesFiles(pool: DatabasePool, module: keyof typeof registries) {
  const directory = new URL(`../${directories[module]}/`, import.meta.url);
  const files = new Map<string, string>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')))
    files.set(
      name,
      createHash('sha256')
        .update(await readFile(new URL(name, directory), 'utf8'))
        .digest('hex'),
    );
  const applied = await pool.query<{ name: string; sha256: string }>(
    `SELECT name,sha256 FROM ${registries[module]}.applied`,
  );
  return (
    applied.rows.length === files.size &&
    applied.rows.every((row) => files.get(row.name) === row.sha256)
  );
}

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
  const notInstalled = (module: OptionalRefresh['module']) =>
    result.push({ module, state: 'not installed' });
  const behind = (module: OptionalRefresh['module'], detail: string) =>
    result.push({ module, state: 'behind', detail });
  // A module that already has exactly its files is current and its migrator is not called. Otherwise its migrator runs; if it
  // cannot, that module is recorded as behind with the reason, and the others still run.
  const advance = async (module: OptionalRefresh['module'], migrate: () => Promise<void>) => {
    // A check that cannot be made is not a reason to stop: the migrator then decides, as it always did.
    if (await registryMatchesFiles(pool, module).catch(() => false)) {
      result.push({ module, state: 'current' });
      return;
    }
    try {
      await migrate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      behind(
        module,
        `its migrator stopped with: ${message}. Nothing of this module changed. Fix the cause, then run Install customer modules again with apply=yes and real_use_action=install`,
      );
      return;
    }
    const after = await appliedCount(pool, module);
    result.push({
      module,
      state: after !== null && after > (counts[module] ?? 0) ? 'advanced' : 'current',
    });
  };

  if (counts['request withdrawal'] === null) notInstalled('request withdrawal');
  else await advance('request withdrawal', () => migrateCustomerRequestWithdrawal(pool));

  if (counts['move records'] === null) notInstalled('move records');
  else await advance('move records', () => migrateCustomerMoves(pool));

  if (counts['mission mail'] === null) notInstalled('mission mail');
  else if (counts['request withdrawal'] === null)
    behind(
      'mission mail',
      'mission mail 0003 needs request withdrawal. Run Install customer modules with apply=yes and mission_mail_action=install, which installs request withdrawal first (its control stays closed)',
    );
  else await advance('mission mail', () => migrateCustomerMissionMail(pool));

  if (counts.notifications === null) notInstalled('notifications');
  else if (counts['request withdrawal'] === null || counts['move records'] === null) {
    const missing = [
      ...(counts['request withdrawal'] === null ? ['request withdrawal'] : []),
      ...(counts['move records'] === null ? ['move records'] : []),
    ].join(' and ');
    behind(
      'notifications',
      `notifications 0005 needs ${missing}. Run Install customer modules with apply=yes and notifications_action=install, which installs ${missing} first (their controls stay closed)`,
    );
  } else await advance('notifications', () => migrateCustomerNotifications(pool));
  return result;
}

// The refusal names every module that is behind and, for each, the step that fixes that one. The steps come from the rows, so a
// module that is not installed is never told to be installed.
export function assertNoneBehind(rows: OptionalRefresh[]) {
  const behind = rows.filter((row) => row.state === 'behind');
  if (behind.length === 0) return;
  throw new Error(
    'Removed member access is installed everywhere it could be, but these optional modules still need a step: ' +
      behind.map((row) => `${row.module}: ${row.detail ?? 'cannot advance'}`).join('; ') +
      '. No switch or control is changed by any of these steps.',
  );
}
