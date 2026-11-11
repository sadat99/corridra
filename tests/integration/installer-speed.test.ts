import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  NEW_FILES,
  appliedNames,
  applyFiles,
  hideNewFiles,
  openNewFiles,
} from './removed-member-support';
import { fixture } from './support';
import type { DatabaseClient, DatabasePool } from '../../packages/db/src/index';
import { endMigrationRun, startMigrationRun } from '../../packages/db/src/migration-run';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import {
  assertNoneBehind,
  refreshInstalledOptionalModules,
} from '../../packages/db/src/customer-optional-refresh';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerSavedMissions } from '../../packages/db/src/customer-commercial-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { migrateCustomerRequestDetails } from '../../packages/db/src/customer-detail-migrate';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerMissionDrafts } from '../../packages/db/src/customer-mission-draft-migrate';
import { migrateCustomerProgrammes } from '../../packages/db/src/customer-programme-migrate';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammeContext } from '../../packages/db/src/customer-programme-context-migrate';
import { migrateCustomerProgrammeEconomics } from '../../packages/db/src/customer-programme-economics-migrate';
import { migrateCustomerProgrammeCoordination } from '../../packages/db/src/customer-programme-coordination-migrate';
import { migrateCustomerProgrammeTemplates } from '../../packages/db/src/customer-programme-templates-migrate';
import { migrateCustomerProgrammePricing } from '../../packages/db/src/customer-programme-pricing-migrate';
import { migrateCustomerMissionShares } from '../../packages/db/src/customer-mission-share-migrate';
import { migrateCustomerAdmission } from '../../packages/db/src/customer-admission-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerOrganisationLinks } from '../../packages/db/src/customer-organisation-link-migrate';
import { migrateCustomerRequestAdmission } from '../../packages/db/src/customer-request-admission-migrate';
import { migrateCustomerProgrammeTerms } from '../../packages/db/src/customer-programme-terms-migrate';
import { migrateCustomerServiceRequests } from '../../packages/db/src/customer-service-request-migrate';
import { migrateCustomerBilling } from '../../packages/db/src/customer-billing-migrate';
import { migrateCustomerInvoicing } from '../../packages/db/src/customer-invoicing-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerProgrammeProjections } from '../../packages/db/src/customer-programme-projection-migrate';
import { migrateCustomerBooks } from '../../packages/db/src/customer-book-migrate';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';

// Installer run time (KI-51). One installer run executes each migrator body at most once per pool instead of once for every
// module that depends on it, and the optional-module refresh does not call a migrator for a module that already has exactly
// its files. Real PostgreSQL. The migrators and the refresh are driven in the order the install script drives them (the script
// itself insists on the Frankfurt host and the migrator login, so it cannot be started here; installer-speed-static.test.ts
// proves it starts and ends the run). The ten removed member files are hidden while the production state is built, as in the
// removed member suites, so "genuinely behind" is a real state.
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

const baseInstallers = [
  migrateCustomerAuthority,
  migrateCustomerSavedMissions,
  migrateCustomerCompanies,
  migrateCustomerDecisions,
  migrateCustomerDelivery,
  migrateCustomerRequestDetails,
  migrateCustomerOrganisationProfiles,
  migrateCustomerMissionDrafts,
  migrateCustomerProgrammes,
  migrateCustomerParticipants,
  migrateCustomerProgrammeContext,
  migrateCustomerProgrammeEconomics,
  migrateCustomerProgrammeCoordination,
  migrateCustomerProgrammeTemplates,
  migrateCustomerProgrammePricing,
  migrateCustomerMissionShares,
  migrateCustomerAdmission,
  migrateCustomerMemberRoles,
  migrateCustomerOrganisationLinks,
  migrateCustomerRequestAdmission,
  migrateCustomerProgrammeTerms,
  migrateCustomerServiceRequests,
  migrateCustomerBilling,
  migrateCustomerInvoicing,
  migrateCommercialReadiness,
  migrateCustomerProgrammeProjections,
  migrateCustomerBooks,
  migrateCustomerDecisionCards,
];

type Fixture = Awaited<ReturnType<typeof fixture>>;
let f: Fixture | undefined;
let started: DatabasePool | undefined;
afterEach(async () => {
  if (started) endMigrationRun(started);
  started = undefined;
  openNewFiles();
  await f?.close();
  f = undefined;
});

// The statements a migrator body sends, counted by what identifies it: the advisory lock every body takes, and the schema
// each body creates for its own registry. A body that is skipped sends neither.
function counting(pool: DatabasePool) {
  const seen = { locks: 0, schemas: new Map<string, number>() };
  const wrapped: DatabasePool = {
    query: pool.query.bind(pool) as DatabasePool['query'],
    end: () => pool.end(),
    connect: async (): Promise<DatabaseClient> => {
      const client = await pool.connect();
      return {
        release: (error?: Error | boolean) => client.release(error),
        query: ((text: unknown, ...rest: unknown[]) => {
          if (typeof text === 'string') {
            if (text.includes('pg_advisory_xact_lock')) seen.locks += 1;
            const schema = /^CREATE SCHEMA IF NOT EXISTS (\w+)/.exec(text)?.[1];
            if (schema) seen.schemas.set(schema, (seen.schemas.get(schema) ?? 0) + 1);
          }
          return (client.query as (...a: unknown[]) => unknown)(text, ...rest);
        }) as DatabaseClient['query'],
      };
    },
  };
  return { wrapped, seen };
}

async function registries(owner: Fixture['owner']) {
  const out: Record<string, string[]> = {};
  const schemas = (
    await owner.query(
      "SELECT nspname FROM pg_namespace WHERE (nspname LIKE '%\\_migrations' OR nspname='migrations') AND to_regclass(nspname||'.applied') IS NOT NULL ORDER BY 1",
    )
  ).rows.map((r) => r.nspname as string);
  for (const schema of schemas) out[schema] = await appliedNames(owner, schema);
  return out;
}

// Every control and configuration table with its rows, so "no control changed" is a comparison and not a promise.
async function controls(owner: Fixture['owner']) {
  const tables = (
    await owner.query(
      `SELECT table_schema||'.'||table_name AS t FROM information_schema.tables
       WHERE table_schema IN ('app','customer','customer_private','identity') AND table_type='BASE TABLE'
       AND (table_name LIKE '%\\_control' OR table_name LIKE '%\\_configuration' OR table_name='configuration') ORDER BY 1`,
    )
  ).rows.map((r) => r.t as string);
  const out: Record<string, unknown[]> = {};
  for (const table of tables)
    out[table] = (
      await owner.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)
    ).rows.map((r) => r.row);
  return out;
}

// What the install job does for apply=yes with real_use_action=install and mission_mail_action=install and
// notifications_action=install: the base installers, real-use, the refresh, the withdrawal tables first (twice, once per
// mail module), the two mail modules, and the refresh again with the refusal check.
async function installRun(pool: DatabasePool) {
  for (const install of baseInstallers) await install(pool);
  await migrateCustomerRealUse(pool);
  const first = await refreshInstalledOptionalModules(pool);
  await migrateCustomerRealUse(pool);
  await migrateCustomerRequestWithdrawal(pool);
  await migrateCustomerMissionMail(pool);
  await migrateCustomerRealUse(pool);
  await migrateCustomerRequestWithdrawal(pool);
  await migrateCustomerNotifications(pool);
  const last = await refreshInstalledOptionalModules(pool);
  assertNoneBehind(last);
  return { first, last };
}

// The state production is in: real-use 13, request withdrawal 2, move records 1, mission mail 3, notifications 5.
async function productionLadder(owner: Fixture['owner']) {
  await migrateCustomerRealUse(owner);
  await migrateCustomerRequestWithdrawal(owner);
  await migrateCustomerMoves(owner);
  await migrateCustomerMissionMail(owner);
  await migrateCustomerNotifications(owner);
}

describe('a no-op install run on a fully installed ladder', () => {
  test('with the run started every migrator body runs at most once, without it the same steps repeat them many times, and nothing changes', async () => {
    openNewFiles();
    f = await fixture();
    const owner = f.owner;
    await installRun(owner);
    const settled = { registries: await registries(owner), controls: await controls(owner) };

    const plain = counting(owner);
    const plainRows = await installRun(plain.wrapped);

    const memo = counting(owner);
    started = memo.wrapped;
    startMigrationRun(memo.wrapped);
    const memoRows = await installRun(memo.wrapped);
    endMigrationRun(memo.wrapped);

    // The same answer either way, and a database that was already current is left exactly as it was.
    expect(memoRows.last).toEqual(plainRows.last);
    expect(memoRows.last.map((row) => row.state)).toEqual([
      'current',
      'current',
      'current',
      'current',
    ]);
    expect(await registries(owner)).toEqual(settled.registries);
    expect(await controls(owner)).toEqual(settled.controls);
    // At most one execution per distinct migrator with the run, and enough migrators seen for that to mean something.
    expect(memo.seen.schemas.size).toBeGreaterThanOrEqual(20);
    for (const [schema, times] of memo.seen.schemas) expect(times, schema).toBe(1);
    // Without the run the same steps repeat them: the test would pass vacuously if it did not.
    expect(Math.max(...plain.seen.schemas.values())).toBeGreaterThan(5);
    expect(plain.seen.locks).toBeGreaterThan(memo.seen.locks * 5);
    expect(memo.seen.locks).toBeLessThanOrEqual(memo.seen.schemas.size + 3);
  }, 900000);

  test('the refresh calls no migrator for a module that already has exactly its files, and calls it when the registry differs', async () => {
    openNewFiles();
    f = await fixture();
    const owner = f.owner;
    await installRun(owner);
    const idle = counting(owner);
    const rows = await refreshInstalledOptionalModules(idle.wrapped);
    expect(rows.map((row) => row.state)).toEqual(['current', 'current', 'current', 'current']);
    expect(idle.seen.locks).toBe(0);
    // One recorded hash that is wrong: that module's migrator runs again and refuses it, so the module is behind.
    const good = (
      await owner.query('SELECT sha256 FROM customer_move_migrations.applied WHERE name=$1', [
        '0001_move_records.sql',
      ])
    ).rows[0].sha256 as string;
    await owner.query(
      "UPDATE customer_move_migrations.applied SET sha256=repeat('0',64) WHERE name='0001_move_records.sql'",
    );
    try {
      const busy = counting(owner);
      const changed = await refreshInstalledOptionalModules(busy.wrapped);
      expect(busy.seen.locks).toBeGreaterThan(0);
      expect(changed.map((row) => `${row.module}:${row.state}`)).toEqual([
        'request withdrawal:current',
        'move records:behind',
        'mission mail:current',
        'notifications:current',
      ]);
      expect(changed[1]!.detail).toMatch(/Move record migration history mismatch/);
      expect(() => assertNoneBehind(changed)).toThrowError(/move records/);
    } finally {
      await owner.query('UPDATE customer_move_migrations.applied SET sha256=$1 WHERE name=$2', [
        good,
        '0001_move_records.sql',
      ]);
    }
  }, 900000);
});

describe('a module that is genuinely behind is still advanced inside a started run', () => {
  test('real-use install then refresh then the second refresh: every optional module advances, the new files arrive and no control changes', async () => {
    hideNewFiles();
    f = await fixture();
    const owner = f.owner;
    for (const install of baseInstallers) await install(owner);
    await productionLadder(owner);
    const before = {
      controls: await controls(owner),
      realUse: await appliedNames(owner, 'customer_real_use_migrations'),
    };
    expect(before.realUse).not.toContain(NEW_FILES.realUse.name);
    expect(await appliedNames(owner, 'customer_move_migrations')).toEqual([
      '0001_move_records.sql',
    ]);

    openNewFiles();
    started = owner;
    startMigrationRun(owner);
    for (const install of baseInstallers) await install(owner);
    await migrateCustomerRealUse(owner);
    const first = await refreshInstalledOptionalModules(owner);
    expect(first.map((row) => `${row.module}:${row.state}`)).toEqual([
      'request withdrawal:advanced',
      'move records:advanced',
      'mission mail:advanced',
      'notifications:advanced',
    ]);
    assertNoneBehind(await refreshInstalledOptionalModules(owner));

    expect(await appliedNames(owner, 'customer_real_use_migrations')).toContain(
      NEW_FILES.realUse.name,
    );
    for (const key of ['withdrawal', 'move', 'mail', 'notifications'] as const)
      expect(await appliedNames(owner, NEW_FILES[key].registry), key).toContain(
        NEW_FILES[key].name,
      );
    expect(await controls(owner)).toEqual(before.controls);
  }, 900000);

  test('with request withdrawal absent the refresh reports mail and notifications behind, and the mail install in the same run then ends green', async () => {
    hideNewFiles();
    f = await fixture();
    const owner = f.owner;
    await migrateCustomerRealUse(owner);
    await migrateCustomerMoves(owner);
    await applyFiles(
      owner,
      'customer-mission-mail-migrations',
      'customer_mission_mail_migrations',
      ['0001_mission_mail.sql', '0002_mute_events.sql'],
    );
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
    const before = await controls(owner);

    openNewFiles();
    started = owner;
    startMigrationRun(owner);
    await migrateCustomerRealUse(owner);
    const first = await refreshInstalledOptionalModules(owner);
    expect(first.map((row) => `${row.module}:${row.state}`)).toEqual([
      'request withdrawal:not installed',
      'move records:advanced',
      'mission mail:behind',
      'notifications:behind',
    ]);
    // What mission_mail_action=install and notifications_action=install do next, in the same run.
    await migrateCustomerRealUse(owner);
    await migrateCustomerRequestWithdrawal(owner);
    await migrateCustomerMissionMail(owner);
    await migrateCustomerNotifications(owner);
    const last = await refreshInstalledOptionalModules(owner);
    expect(last.map((row) => row.state)).toEqual(['current', 'current', 'current', 'current']);
    assertNoneBehind(last);

    expect(await appliedNames(owner, 'customer_real_use_migrations')).toContain(
      NEW_FILES.realUse.name,
    );
    expect(await appliedNames(owner, 'customer_mission_mail_migrations')).toContain(
      NEW_FILES.mail.name,
    );
    expect(await appliedNames(owner, 'customer_notification_migrations')).toContain(
      NEW_FILES.notifications.name,
    );
    expect(await appliedNames(owner, 'customer_request_withdrawal_migrations')).toContain(
      NEW_FILES.withdrawal.name,
    );
    const after = await controls(owner);
    for (const table of Object.keys(before)) expect(after[table], table).toEqual(before[table]);
    for (const table of Object.keys(after))
      if (!(table in before))
        expect(JSON.stringify(after[table]), table).not.toMatch(/"enabled": ?true/);
  }, 900000);

  test('a module that cannot advance inside the run is reported behind and is retried, not remembered as done', async () => {
    hideNewFiles();
    f = await fixture();
    const owner = f.owner;
    await productionLadder(owner);
    openNewFiles();
    started = owner;
    startMigrationRun(owner);
    await migrateCustomerRealUse(owner);
    const good = (
      await owner.query('SELECT sha256 FROM customer_move_migrations.applied WHERE name=$1', [
        '0001_move_records.sql',
      ])
    ).rows[0].sha256 as string;
    await owner.query("UPDATE customer_move_migrations.applied SET sha256=repeat('0',64)");
    try {
      const rows = await refreshInstalledOptionalModules(owner);
      expect(rows.find((row) => row.module === 'move records')?.state).toBe('behind');
      expect(() => assertNoneBehind(rows)).toThrowError(/Move record migration history mismatch/);
      expect(await appliedNames(owner, 'customer_move_migrations')).toEqual([
        '0001_move_records.sql',
      ]);
    } finally {
      await owner.query('UPDATE customer_move_migrations.applied SET sha256=$1 WHERE name=$2', [
        good,
        '0001_move_records.sql',
      ]);
    }
    // The failure was not kept: with the hash right again the same run advances the module.
    const again = await refreshInstalledOptionalModules(owner);
    expect(again.find((row) => row.module === 'move records')?.state).toBe('advanced');
    assertNoneBehind(again);
    expect(await appliedNames(owner, 'customer_move_migrations')).toHaveLength(2);
  }, 900000);
});
