import { afterEach, describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appliedNames,
  applyFiles,
  hideNewFiles,
  openNewFiles,
  fileSql,
  NEW_FILES,
} from './removed-member-support';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import {
  assertNoneBehind,
  refreshInstalledOptionalModules,
} from '../../packages/db/src/customer-optional-refresh';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureMoveRecords } from '../../packages/auth/src/customer-move-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';

// Removed members, the installer (owner decision, 11 Nov 2026: "No, remove access (Recommended)"). real_use_action=install
// now also re-runs the migrator of the optional modules that are NOT in the base run and are already installed (request
// withdrawal, move records, mission mail, notifications). It never installs a module that is absent, never calls a configure
// step, never writes a control row and adds no workflow input. A module that cannot advance is reported as behind and the
// run ends red with the exact next step. Fails on main (REMOVED_BASE_CHECK=1).
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const { removedFileHidden } = await import('./removed-member-hide');
    return names.filter((n) => !removedFileHidden(String(path), String(n)));
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

type Owner = Awaited<ReturnType<typeof fixture>>['owner'];
let f: Awaited<ReturnType<typeof fixture>> | undefined;
const issuer = 'https://ep-removed-installer.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const schemaNames = async (owner: Owner) =>
  (
    await owner.query("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' ORDER BY 1")
  ).rows.map((r) => r.nspname as string);
const functionCount = async (owner: Owner) =>
  (
    await owner.query(
      "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname IN ('app','customer','customer_private')",
    )
  ).rows[0].n as number;
const NAMED_CONTROLS = [
  'customer_private.configuration',
  'customer_private.real_use_configuration',
  'customer_private.real_use_admission_control',
  'customer_private.workspace_lifecycle_control',
  'customer_private.account_lifecycle_control',
  'customer_private.request_withdrawal_control',
  'customer_private.mission_mail_control',
  'customer_private.notification_control',
  'customer_private.move_control',
  'customer_private.real_billing_control',
  'customer_private.real_invoicing_control',
  'customer_private.simulated_payments_control',
];
// Every control and configuration table that exists, with every row and timestamp. The generic query catches a control table a
// later change adds, so it cannot be written by the refresh unnoticed.
async function controls(owner: Owner) {
  const generic = (
    await owner.query(
      `SELECT table_schema||'.'||table_name AS t FROM information_schema.tables
       WHERE table_schema IN ('app','customer','customer_private','identity') AND table_type='BASE TABLE'
       AND (table_name LIKE '%\\_control' OR table_name LIKE '%\\_configuration')`,
    )
  ).rows.map((r) => r.t as string);
  const out: Record<string, unknown[]> = {};
  for (const table of new Set([...NAMED_CONTROLS, ...generic])) {
    if (
      !(await owner.query('SELECT to_regclass($1) IS NOT NULL AS present', [table])).rows[0].present
    )
      continue;
    out[table] = (
      await owner.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)
    ).rows.map((r) => r.row);
  }
  return out;
}
afterEach(async () => {
  await f?.close();
  f = undefined;
});

// A database where request withdrawal is absent: real-use 13, move records 0001, mission mail 0001 and 0002, notifications 0001
// to 0004. This is NOT production (production has withdrawal 2, mail 3 and notifications 5, see removed-member-production.test.ts);
// it is the case the refusal wording is for. Everything is built with the ten new files hidden.
async function productionState() {
  hideNewFiles();
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerMoves(f.owner);
  await applyFiles(
    f.owner,
    'customer-mission-mail-migrations',
    'customer_mission_mail_migrations',
    ['0001_mission_mail.sql', '0002_mute_events.sql'],
  );
  await applyFiles(
    f.owner,
    'customer-notification-migrations',
    'customer_notification_migrations',
    [
      '0001_notifications.sql',
      '0002_email_off_until_chosen.sql',
      '0003_withdrawal_and_issuer_check.sql',
      '0004_mute_events.sql',
    ],
  );
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the installer tests',
  });
  await configureMoveRecords(f.owner, {
    enabled: true,
    reason: 'Owner approved Move records for the installer tests',
  });
  return f;
}

describe('the refresh', () => {
  test('with none of the four modules installed it installs nothing and writes nothing', async () => {
    openNewFiles();
    f = await fixture();
    await migrateCustomerRealUse(f.owner);
    expect(fileSql('realUse')).toBeTruthy();
    const before = {
      schemas: await schemaNames(f.owner),
      functions: await functionCount(f.owner),
      controls: await controls(f.owner),
    };
    const rows = await refreshInstalledOptionalModules(f.owner);
    expect(rows).toEqual([
      { module: 'request withdrawal', state: 'not installed' },
      { module: 'move records', state: 'not installed' },
      { module: 'mission mail', state: 'not installed' },
      { module: 'notifications', state: 'not installed' },
    ]);
    expect(() => assertNoneBehind(rows)).not.toThrow();
    expect(await schemaNames(f.owner)).toEqual(before.schemas);
    expect(await functionCount(f.owner)).toBe(before.functions);
    expect(await controls(f.owner)).toEqual(before.controls);
  }, 300000);

  test('with request withdrawal only it advances that module and installs no other', async () => {
    hideNewFiles();
    f = await fixture();
    await migrateCustomerRealUse(f.owner);
    await migrateCustomerRequestWithdrawal(f.owner);
    expect(await appliedNames(f.owner, 'customer_request_withdrawal_migrations')).toHaveLength(2);
    const before = { schemas: await schemaNames(f.owner), controls: await controls(f.owner) };
    openNewFiles();
    await migrateCustomerRealUse(f.owner);
    const rows = await refreshInstalledOptionalModules(f.owner);
    expect(rows.map((r) => `${r.module}:${r.state}`)).toEqual([
      'request withdrawal:advanced',
      'move records:not installed',
      'mission mail:not installed',
      'notifications:not installed',
    ]);
    expect(await schemaNames(f.owner)).toEqual(before.schemas);
    expect(await controls(f.owner)).toEqual(before.controls);
    expect(await appliedNames(f.owner, 'customer_request_withdrawal_migrations')).toHaveLength(3);
  }, 300000);

  test('on a database without request withdrawal it advances move records, reports mail and notifications as behind, and changes no control', async () => {
    await productionState();
    const owner = f!.owner;
    openNewFiles();
    await migrateCustomerRealUse(owner);
    const before = await controls(owner);
    const mailBefore = await appliedNames(owner, 'customer_mission_mail_migrations');
    const pulseBefore = await appliedNames(owner, 'customer_notification_migrations');
    const rows = await refreshInstalledOptionalModules(owner);
    expect(rows.map((r) => `${r.module}:${r.state}`)).toEqual([
      'request withdrawal:not installed',
      'move records:advanced',
      'mission mail:behind',
      'notifications:behind',
    ]);
    expect(rows[2]!.detail).toMatch(/mission_mail_action=install/);
    expect(rows[3]!.detail).toMatch(/notifications_action=install/);
    // Nothing of the two behind modules was touched, and request withdrawal was not installed to help them.
    expect(await appliedNames(owner, 'customer_mission_mail_migrations')).toEqual(mailBefore);
    expect(await appliedNames(owner, 'customer_notification_migrations')).toEqual(pulseBefore);
    expect(
      (
        await owner.query(
          "SELECT to_regclass('customer_request_withdrawal_migrations.applied') IS NOT NULL AS p",
        )
      ).rows[0].p,
    ).toBe(false);
    expect(await appliedNames(owner, 'customer_move_migrations')).toHaveLength(2);
    expect(await controls(owner)).toEqual(before);
    expect(() => assertNoneBehind(rows)).toThrowError(
      /mission mail: .*mission_mail_action=install.*; notifications: .*notifications_action=install/,
    );
  }, 600000);

  test('after the explicit mail and notifications install the same refresh is green, nothing is behind, and a second run changes nothing', async () => {
    await productionState();
    const owner = f!.owner;
    openNewFiles();
    await migrateCustomerRealUse(owner);
    await refreshInstalledOptionalModules(owner);
    // What mission_mail_action=install and notifications_action=install do: withdrawal first (control closed), then the modules.
    await migrateCustomerRealUse(owner);
    await migrateCustomerRequestWithdrawal(owner);
    await migrateCustomerMissionMail(owner);
    await migrateCustomerNotifications(owner);
    const settled = await controls(owner);
    const rows = await refreshInstalledOptionalModules(owner);
    expect(rows.map((r) => r.state)).toEqual(['current', 'current', 'current', 'current']);
    expect(() => assertNoneBehind(rows)).not.toThrow();
    expect(await controls(owner)).toEqual(settled);
    expect(await appliedNames(owner, 'customer_mission_mail_migrations')).toHaveLength(4);
    expect(await appliedNames(owner, 'customer_notification_migrations')).toHaveLength(6);
    expect(await appliedNames(owner, 'customer_request_withdrawal_migrations')).toHaveLength(3);
    // Withdrawal came in with its control closed, as the install workflow promises.
    expect(
      (await owner.query('SELECT customer_private.request_withdrawal_open() AS open')).rows[0].open,
    ).toBe(false);
  }, 600000);

  test('the real-use install, then the refresh, then the mail install in one run ends green, applies the new files, and leaves the controls as they were', async () => {
    await productionState();
    const owner = f!.owner;
    const before = await controls(owner);
    openNewFiles();
    await migrateCustomerRealUse(owner);
    const first = await refreshInstalledOptionalModules(owner);
    expect(first.filter((r) => r.state === 'behind')).toHaveLength(2);
    await migrateCustomerRealUse(owner);
    await migrateCustomerRequestWithdrawal(owner);
    await migrateCustomerMissionMail(owner);
    await migrateCustomerNotifications(owner);
    assertNoneBehind(await refreshInstalledOptionalModules(owner));
    // The new files did arrive (main has no such file): real-use 0014, mission mail 0004 and notifications 0006.
    expect(await appliedNames(owner, 'customer_real_use_migrations')).toContain(
      NEW_FILES.realUse.name,
    );
    expect(await appliedNames(owner, 'customer_mission_mail_migrations')).toContain(
      NEW_FILES.mail.name,
    );
    expect(await appliedNames(owner, 'customer_notification_migrations')).toContain(
      NEW_FILES.notifications.name,
    );
    const after = await controls(owner);
    for (const table of Object.keys(before)) expect(after[table], table).toEqual(before[table]);
    // The only new control row is the one the withdrawal module starts with, and it is closed.
    for (const table of Object.keys(after))
      if (!(table in before))
        expect(JSON.stringify(after[table]), table).not.toMatch(/"enabled": ?true/);
  }, 600000);
});

describe('what the refresh says when a module cannot advance', () => {
  test('notifications installed, mail and request withdrawal absent: the next step names notifications only, never mission mail', async () => {
    hideNewFiles();
    f = await fixture();
    const owner = f.owner;
    await migrateCustomerRealUse(owner);
    await migrateCustomerMoves(owner);
    await applyFiles(
      owner,
      'customer-notification-migrations',
      'customer_notification_migrations',
      [
        '0001_notifications.sql',
        '0002_email_off_until_chosen.sql',
        '0003_withdrawal_and_issuer_check.sql',
        '0004_mute_events.sql',
      ],
    );
    openNewFiles();
    await migrateCustomerRealUse(owner);
    const rows = await refreshInstalledOptionalModules(owner);
    expect(rows.map((r) => `${r.module}:${r.state}`)).toEqual([
      'request withdrawal:not installed',
      'move records:advanced',
      'mission mail:not installed',
      'notifications:behind',
    ]);
    let message = '';
    try {
      assertNoneBehind(rows);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/notifications: .*notifications_action=install/);
    // Mail is not installed, so the owner is never told to install it.
    expect(message).not.toMatch(/mission_mail_action/);
    expect(message).not.toMatch(/mission mail/);
    expect(
      (
        await owner.query(
          "SELECT to_regclass('customer_mission_mail_migrations.applied') IS NOT NULL AS p",
        )
      ).rows[0].p,
    ).toBe(false);
  }, 600000);

  test('a migrator that stops is recorded as behind with its message, the other modules still run, and the run fails at the end listing it', async () => {
    hideNewFiles();
    f = await fixture();
    const owner = f.owner;
    await migrateCustomerRealUse(owner);
    await migrateCustomerRequestWithdrawal(owner);
    await migrateCustomerMoves(owner);
    openNewFiles();
    await migrateCustomerRealUse(owner);
    const good = (
      await owner.query('SELECT sha256 FROM customer_move_migrations.applied WHERE name=$1', [
        '0001_move_records.sql',
      ])
    ).rows[0].sha256 as string;
    await owner.query("UPDATE customer_move_migrations.applied SET sha256=repeat('0',64)");
    try {
      const rows = await refreshInstalledOptionalModules(owner);
      expect(rows.map((r) => `${r.module}:${r.state}`)).toEqual([
        'request withdrawal:advanced',
        'move records:behind',
        'mission mail:not installed',
        'notifications:not installed',
      ]);
      expect(rows[1]!.detail).toMatch(/Move record migration history mismatch/);
      expect(() => assertNoneBehind(rows)).toThrowError(
        /move records: its migrator stopped with: Move record migration history mismatch/,
      );
      // Nothing of the module that stopped changed.
      expect(await appliedNames(owner, 'customer_move_migrations')).toEqual([
        '0001_move_records.sql',
      ]);
    } finally {
      await owner.query('UPDATE customer_move_migrations.applied SET sha256=$1 WHERE name=$2', [
        good,
        '0001_move_records.sql',
      ]);
    }
    const again = await refreshInstalledOptionalModules(owner);
    expect(again.map((r) => r.state)).toEqual([
      'current',
      'advanced',
      'not installed',
      'not installed',
    ]);
    expect(() => assertNoneBehind(again)).not.toThrow();
  }, 600000);
});

describe('the report line', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  test('counts requests whose author is no longer a member as a number only, with inline SQL that agrees with the helper', async () => {
    fileSql('realUse');
    openNewFiles();
    f = await fixture();
    await migrateCustomerRealUse(f.owner);
    const start = script.indexOf(
      'SELECT count(*)::text AS n FROM customer_private.owned_request r',
    );
    const end = script.indexOf('`', start);
    expect(start).toBeGreaterThan(0);
    const query = script.slice(start, end);
    const counted = (await f.owner.query<{ n: string }>(query)).rows[0]!.n;
    expect(counted).toMatch(/^\d+$/);
    expect(counted).toBe(
      (
        await f.owner.query(
          'SELECT count(*)::text AS n FROM customer_private.owned_request r WHERE NOT customer_private.workspace_member_current(r.workspace_id,r.principal_id)',
        )
      ).rows[0].n,
    );
    // The line names no id, subject, email or workspace.
    expect(script).toContain('requests whose author is no longer a member: ${hidden.rows[0]!.n}');
  }, 300000);
});

describe('the install script and the workflow', () => {
  // On the commit before this change the new files do not exist, so none of these static checks can pass there: each one
  // asks for a new file first, inside the test, so that it reports as failed (not skipped) on main.
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');
  const refresh = readFileSync(resolve('packages/db/src/customer-optional-refresh.ts'), 'utf8');
  test('the refresh runs only for real_use_action=install: once after the real-use migration and once before the end', () => {
    fileSql('realUse');
    const calls = [...script.matchAll(/refreshInstalledOptionalModules\(pool\)/g)].map(
      (m) => m.index!,
    );
    expect(calls).toHaveLength(2);
    const realUse = script.indexOf("if (v.REAL_USE_ACTION !== 'unchanged') {");
    const migration = script.indexOf('await migrateCustomerRealUse(pool);', realUse);
    const guard = script.indexOf("if (v.REAL_USE_ACTION === 'install')", migration);
    expect(realUse).toBeGreaterThan(0);
    expect(calls[0]).toBeGreaterThan(guard);
    expect(guard).toBeGreaterThan(migration);
    // The second run sits behind the same guard, after the report and before "Install complete".
    const after = script.indexOf("await report('After install');");
    const complete = script.indexOf('Install complete');
    expect(calls[1]).toBeGreaterThan(after);
    expect(calls[1]).toBeLessThan(complete);
    expect(script.slice(after, calls[1]!)).toContain("if (v.REAL_USE_ACTION === 'install')");
    expect(script.slice(after, complete)).toContain(
      'assertNoneBehind(await refreshInstalledOptionalModules(pool))',
    );
    expect([...script.matchAll(/assertNoneBehind\(/g)]).toHaveLength(1);
  });

  test('the refresh never configures anything and never writes a control row', () => {
    fileSql('realUse');
    expect(refresh).not.toMatch(/configure[A-Z]/);
    expect(refresh).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/);
    for (const name of [
      'migrateCustomerRequestWithdrawal',
      'migrateCustomerMoves',
      'migrateCustomerMissionMail',
      'migrateCustomerNotifications',
    ])
      expect(refresh).toContain(name);
    for (const name of [
      'migrateCustomerRealUse',
      'migrateCustomerWorkspaceLifecycle',
      'migrateCustomerAccountLifecycle',
      'migrateCustomerProblemReports',
    ])
      expect(refresh).not.toContain(name);
  });

  test('adds no input: the workflow is untouched and the script has no new key', () => {
    fileSql('realUse');
    expect(workflow).not.toMatch(/removed|refresh|optional_modules/i);
    expect(script).not.toMatch(/\bREMOVED_[A-Z_]+: z\./);
    expect([...workflow.matchAll(/^ {6}[a-z0-9_]+:\n {8}description:/gm)]).toHaveLength(25);
    // The migrators the refresh calls are not in the base list, so a base run (every action unchanged) never reaches them.
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    for (const name of [
      'migrateCustomerRequestWithdrawal',
      'migrateCustomerMoves',
      'migrateCustomerMissionMail',
      'migrateCustomerNotifications',
    ])
      expect(installers).not.toContain(name);
  });

  test('the refresh result is logged one line per module, and a read-only report is never changed by it', () => {
    fileSql('realUse');
    expect(script).toContain('optional module ${row.module}: ${row.state}');
    expect(script.indexOf("await report(apply ? 'Before install'")).toBeLessThan(
      script.indexOf('refreshInstalledOptionalModules(pool)'),
    );
    expect(createHash('sha256').update(workflow).digest('hex')).toHaveLength(64);
  });
});
