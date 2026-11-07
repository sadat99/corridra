import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fixture } from './support';
import { digest, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureWorkspaceLifecycle } from '../../packages/auth/src/customer-workspace-lifecycle-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';

// CRUD G4, the install order. The workspace lifecycle module is optional: nothing installs it unless it is asked for.
// It never applies the real-use schema itself, installs with its control closed, is repeatable, and refuses to run
// over changed files. Pinning, intake and the real-use configuration are the existing owner steps.
const schema = 'customer_workspace_lifecycle_migrations';
let f: Fixture;
let g: Fixture;

const installed = async (pool: Fixture) =>
  (
    await pool.owner.query(
      "SELECT to_regclass('customer_private.workspace_lifecycle_control') IS NOT NULL AS present",
    )
  ).rows[0].present as boolean;
const applied = async (pool: Fixture) =>
  (await pool.owner.query(`SELECT name,sha256 FROM ${schema}.applied ORDER BY name`)).rows as {
    name: string;
    sha256: string;
  }[];
const open = async (pool: Fixture) =>
  (await pool.owner.query('SELECT customer_private.workspace_lifecycle_open() AS open')).rows[0]
    .open as boolean;
const reason = 'Opening workspace changes for the first customers';

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await pinCustomerAuthority(f.owner, {
    issuer: 'https://ep-g4-install.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    executorId: f.serviceId,
  });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  g = await fixture('corridra_upgrade');
});
afterAll(async () => {
  await f?.close();
  await g?.close();
});

describe('installing the workspace lifecycle module', () => {
  test('refuses, writing nothing, when the real-use schema is absent or not current: it never applies that schema itself', async () => {
    await expect(migrateCustomerWorkspaceLifecycle(g.owner)).rejects.toThrow(
      'The customer real-use schema is not current',
    );
    expect(await installed(g)).toBe(false);
    expect(
      (await g.owner.query(`SELECT to_regclass('${schema}.applied') IS NOT NULL AS present`))
        .rows[0].present,
    ).toBe(false);
    const last = (
      await f.owner.query(
        'SELECT name,sha256,applied_at FROM customer_real_use_migrations.applied ORDER BY name DESC LIMIT 1',
      )
    ).rows[0];
    await f.owner.query('DELETE FROM customer_real_use_migrations.applied WHERE name=$1', [
      last.name,
    ]);
    try {
      await expect(migrateCustomerWorkspaceLifecycle(f.owner)).rejects.toThrow(
        'The customer real-use schema is not current',
      );
      expect(await installed(f)).toBe(false);
    } finally {
      await f.owner.query(
        'INSERT INTO customer_real_use_migrations.applied(name,sha256,applied_at) VALUES($1,$2,$3)',
        [last.name, last.sha256, last.applied_at],
      );
    }
  });

  test('installs with the control closed, changes no existing row, and is repeatable', async () => {
    const tables = [
      'customer.workspace',
      'customer.membership',
      'customer_private.principal',
      'app.tenant',
      'app.domain_event',
      'app.audit_event',
    ];
    const before = await digest(f, tables);
    await migrateCustomerWorkspaceLifecycle(f.owner);
    expect(await installed(f)).toBe(true);
    expect(await open(f)).toBe(false);
    expect((await applied(f)).map((row) => row.name)).toContain('0001_workspace_lifecycle.sql');
    expect(await digest(f, tables)).toEqual(before);
    const once = await applied(f);
    await migrateCustomerWorkspaceLifecycle(f.owner);
    expect(await applied(f)).toEqual(once);
  });

  test('refuses to run over a changed applied file', async () => {
    const [first] = await applied(f);
    await f.owner.query(`UPDATE ${schema}.applied SET sha256=$2 WHERE name=$1`, [
      first!.name,
      'f'.repeat(64),
    ]);
    try {
      await expect(migrateCustomerWorkspaceLifecycle(f.owner)).rejects.toThrow(
        'Workspace lifecycle migration history mismatch',
      );
    } finally {
      await f.owner.query(`UPDATE ${schema}.applied SET sha256=$2 WHERE name=$1`, [
        first!.name,
        first!.sha256,
      ]);
    }
    await expect(migrateCustomerWorkspaceLifecycle(f.owner)).resolves.toBeUndefined();
  });
});

describe('opening and pausing the control', () => {
  test('is refused until real use is configured, then opens, repeats without a new row, and pauses', async () => {
    await expect(configureWorkspaceLifecycle(f.owner, { enabled: true, reason })).rejects.toThrow(
      'Real-use configuration has not been initialized',
    );
    expect(await open(f)).toBe(false);
    await configureCustomerRealUse(f.owner, {
      enabled: true,
      reason: 'Owner approved real work for the install order fixture tests',
    });
    await expect(configureWorkspaceLifecycle(f.owner, { enabled: true, reason })).resolves.toEqual({
      enabled: true,
      changed: true,
    });
    expect(await open(f)).toBe(true);
    await expect(configureWorkspaceLifecycle(f.owner, { enabled: true, reason })).resolves.toEqual({
      enabled: true,
      changed: false,
    });
    await expect(configureWorkspaceLifecycle(f.owner, { enabled: false, reason })).resolves.toEqual(
      {
        enabled: false,
        changed: true,
      },
    );
    expect(await open(f)).toBe(false);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.workspace_lifecycle_control',
        )
      ).rows[0].n,
    ).toBe(2);
  });

  test('is refused for a reason that is too short and when the module is not installed', async () => {
    await expect(
      configureWorkspaceLifecycle(f.owner, { enabled: true, reason: 'short' }),
    ).rejects.toThrow();
    await expect(configureWorkspaceLifecycle(g.owner, { enabled: true, reason })).rejects.toThrow(
      'Workspace lifecycle is not installed',
    );
  });
});
