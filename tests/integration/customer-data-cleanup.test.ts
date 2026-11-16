import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { harness, type Fixture } from './revamp-g4-support';
import type { DatabasePool } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import {
  migrateCustomerDataCleanup,
  originalWorkspaceArchivedDefinition,
} from '../../packages/db/src/customer-data-cleanup-migrate';
import {
  configureDataCleanup,
  dataCleanupKeepList,
  inventoryDataCleanup,
} from '../../packages/auth/src/customer-data-cleanup';

// U2 data cleanup, real database, real restricted roles: an owner-run, reversible archive of made-up workspaces. Nothing is
// deleted or updated; only rows in customer_private.data_cleanup_archive are appended. QA-named real workspaces are listed
// only. Every workspace and person here is invented.
let f: Fixture;
let h: ReturnType<typeof harness>;
let people: Record<string, string>;
const ids: Record<string, string> = {};
const archiveReason = 'Fixture archive of made-up workspaces for the data cleanup tests';
const restoreReason = 'Fixture restore of workspaces archived by the data cleanup tests';

// md5 over every row of every user table, so a test can prove that nothing at all was written or rewritten.
async function everyTable(except: string[] = []) {
  const tables = (
    await f.owner.query<{ name: string }>(
      "SELECT format('%I.%I',schemaname,relname) AS name FROM pg_stat_user_tables ORDER BY 1",
    )
  ).rows.map((row) => row.name);
  const result: Record<string, string> = {};
  for (const table of tables.filter((name) => !except.includes(name)))
    result[table] = (
      await f.owner.query<{ d: string }>(
        `SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS d FROM ${table} t`,
      )
    ).rows[0]!.d;
  return result;
}
// A real (not made-up) workspace, written as the offline provisioning does, because synthetic mode only creates made-up ones.
async function realWorkspace(name: string, creator: string) {
  const id = randomUUID();
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [f.serviceId, randomUUID(), randomUUID()],
    );
    await db.query('INSERT INTO app.tenant(id,name,synthetic) VALUES($1,$2,false)', [id, name]);
    await db.query('INSERT INTO customer.workspace(tenant_id,created_by) VALUES($1,$2)', [
      id,
      creator,
    ]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
  return id;
}
const archived = async (target: string) =>
  (
    await f.owner.query<{ a: boolean }>('SELECT customer_private.workspace_archived($1) AS a', [
      target,
    ])
  ).rows[0]!.a;
const cleanupRows = async () =>
  (
    await f.owner.query<{
      tenant_id: string;
      category: string;
      action: string;
      batch_id: string;
      executor_id: string;
      reason: string;
    }>(
      'SELECT tenant_id,category,action,batch_id,executor_id,reason FROM customer_private.data_cleanup_archive ORDER BY created_at,id',
    )
  ).rows;
const listedState = async (person: string) =>
  Object.fromEntries(
    ((await h.state(person)) as { workspaceId: string; archived: boolean }[]).map((row) => [
      row.workspaceId,
      row.archived,
    ]),
  );
// The function as it was before this module, created for one connection only, next to the live one.
async function sideBySide(targets: string[]) {
  const db = await f.owner.connect();
  try {
    const original = originalWorkspaceArchivedDefinition.replace(
      'customer_private.workspace_archived(',
      'pg_temp.original_workspace_archived(',
    );
    expect(original).not.toBe(originalWorkspaceArchivedDefinition);
    await db.query(original);
    return (
      await db.query<{ id: string; before: boolean; now: boolean }>(
        `SELECT id::text,pg_temp.original_workspace_archived(id) AS before,customer_private.workspace_archived(id) AS now
        FROM unnest($1::uuid[]) id`,
        [targets],
      )
    ).rows;
  } finally {
    await db.query('DISCARD TEMP');
    db.release();
  }
}

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'dc');
  people = await h.admit(['alice', 'bob', 'carol', 'dave']);
  ids.demo = await h.provision('alice', 'Synthetic Demo Mill');
  ids.kept = await h.provision('bob', dataCleanupKeepList[1].name);
  ids.memberRestore = await h.provision('carol', 'Synthetic Member Restore');
  ids.memberArchived = await h.provision('dave', 'Synthetic Member Archived');
  ids.archivedRestored = await h.provision('dave', 'Synthetic Archived Then Restored');
  ids.renamed = await h.provision('dave', 'Synthetic Before Rename');
  ids.realHarbour = await realWorkspace('Harbour Trading Ltd', people.alice!);
  ids.realQa = await realWorkspace('QA Test Real Co', people.alice!);
}, 120000);
afterAll(async () => {
  await f?.close();
});

describe('before the module is installed', () => {
  test('the inventory lists made-up and QA-named workspaces, writes nothing and runs read only', async () => {
    const before = await everyTable();
    const statements: string[] = [];
    // Records each statement the inventory sends on its one connection.
    const recording = {
      query: f.owner.query.bind(f.owner),
      end: f.owner.end.bind(f.owner),
      async connect() {
        const db = await f.owner.connect();
        return {
          query: (text: string, values?: unknown[]) => {
            statements.push(text);
            return db.query(text, values);
          },
          release: () => db.release(),
        };
      },
    } as unknown as DatabasePool;
    const inventory = await inventoryDataCleanup(recording);
    expect(statements[0]).toBe('BEGIN READ ONLY');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(
      statements.filter((text) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(text)),
    ).toEqual([]);
    expect(await everyTable()).toEqual(before);
    expect(inventory.installed).toEqual({ workspaces: true, lifecycle: false, cleanup: false });
    expect(inventory.totals).toEqual({ synthetic: 6, real: 2 });
    expect(inventory.synthetic.toArchive.map((row) => row.id).sort()).toEqual(
      [ids.demo, ids.memberRestore, ids.memberArchived, ids.archivedRestored, ids.renamed].sort(),
    );
    expect(inventory.synthetic.kept).toEqual([
      { id: ids.kept, name: dataCleanupKeepList[1].name, usedBy: 'scripts/qa/signed-in-sweep.ts' },
    ]);
    expect(inventory.qa).toEqual({
      kept: [],
      listedOnly: [{ id: ids.realQa, name: 'QA Test Real Co' }],
    });
    expect(inventory.lines).toContain(
      `  ${ids.realQa!.slice(0, 8)} QA Test Real Co: listed only, not archived`,
    );
    expect(inventory.lines).toContain(
      `  ${ids.kept!.slice(0, 8)} ${dataCleanupKeepList[1].name}: kept, used by scripts/qa/signed-in-sweep.ts`,
    );
    // No full id, no email and no real workspace that is not QA-named.
    const printed = inventory.lines.join('\n');
    expect(printed).not.toContain(ids.demo);
    expect(printed).not.toMatch(/@/);
    expect(printed).not.toContain('Harbour Trading Ltd');
  });
});

describe('with the module installed', () => {
  beforeAll(async () => {
    await migrateCustomerWorkspaceLifecycle(f.owner);
    await h.setControl(true);
    // Mixed member histories before any cleanup: an archive, an archive then a restore, and a rename.
    await h.lifecycle('dave', 'archive', {
      workspaceId: ids.memberArchived,
      expectedVersion: 0,
      confirmName: 'Synthetic Member Archived',
    });
    await h.lifecycle('dave', 'archive', {
      workspaceId: ids.archivedRestored,
      expectedVersion: 0,
      confirmName: 'Synthetic Archived Then Restored',
    });
    await h.lifecycle('dave', 'restore', { workspaceId: ids.archivedRestored, expectedVersion: 1 });
    await h.lifecycle('dave', 'rename', {
      workspaceId: ids.renamed,
      name: 'Synthetic After Rename',
      reason: 'The fixture renames this workspace once',
      expectedVersion: 0,
    });
    await migrateCustomerDataCleanup(f.owner);
  });

  test('installing writes no cleanup row, and a never-cleaned workspace answers exactly as the previous function', async () => {
    expect(await cleanupRows()).toEqual([]);
    const all = Object.values(ids);
    const compared = await sideBySide(all);
    expect(compared).toHaveLength(all.length);
    for (const row of compared) expect(row.now, row.id).toBe(row.before);
    expect(compared.find((row) => row.id === ids.memberArchived)).toMatchObject({ now: true });
    expect(compared.find((row) => row.id === ids.archivedRestored)).toMatchObject({ now: false });
    // Installing again is a no-op and keeps the one applied file.
    await migrateCustomerDataCleanup(f.owner);
    expect(
      (await f.owner.query('SELECT name FROM customer_data_cleanup_migrations.applied')).rows,
    ).toEqual([{ name: '0001_data_cleanup_archive.sql' }]);
  });

  test('archive needs a reason and the schema owner, and writes nothing when refused', async () => {
    await expect(
      configureDataCleanup(f.owner, { action: 'archive', reason: 'short' }),
    ).rejects.toThrow();
    await expect(
      configureDataCleanup(f.owner, { action: 'delete', reason: archiveReason }),
    ).rejects.toThrow();
    await expect(
      configureDataCleanup(f.runtime, { action: 'archive', reason: archiveReason }),
    ).rejects.toThrow();
    expect(await cleanupRows()).toEqual([]);
  });

  test('archive writes one row per made-up workspace not kept or held back, in one batch, and changes nothing else', async () => {
    const before = await everyTable(['customer_private.data_cleanup_archive']);
    const result = await configureDataCleanup(f.owner, {
      action: 'archive',
      reason: archiveReason,
    });
    const expected = [ids.demo, ids.memberRestore, ids.archivedRestored, ids.renamed].sort();
    expect(result).toMatchObject({ archived: 4, restored: 0 });
    const rows = await cleanupRows();
    expect(rows.map((row) => row.tenant_id).sort()).toEqual(expected);
    for (const row of rows)
      expect(row).toMatchObject({
        category: 'synthetic_workspace',
        action: 'archive',
        batch_id: result.batchId,
        reason: archiveReason,
      });
    expect(new Set(rows.map((row) => row.executor_id)).size).toBe(1);
    expect(await everyTable(['customer_private.data_cleanup_archive'])).toEqual(before);
    for (const target of expected) expect(await archived(target!)).toBe(true);
    // Kept, already archived by its member, real and QA-named real workspaces are not written.
    for (const target of [ids.kept, ids.realHarbour, ids.realQa])
      expect(await archived(target!)).toBe(false);
    const inventory = await inventoryDataCleanup(f.owner);
    expect(inventory.synthetic.toArchive).toEqual([]);
    expect(inventory.cleanupArchived.map((row) => row.id).sort()).toEqual(expected);
    expect(inventory.synthetic.heldBack).toContainEqual({
      id: ids.memberArchived,
      name: 'Synthetic Member Archived',
      reason: 'already archived',
    });
  });

  test('a QA-named real workspace is never archived, and the table cannot hold any category but made-up workspaces', async () => {
    expect((await cleanupRows()).map((row) => row.tenant_id)).not.toContain(ids.realQa);
    expect(await archived(ids.realQa!)).toBe(false);
    await expect(
      f.owner.query(
        `INSERT INTO customer_private.data_cleanup_archive(tenant_id,category,action,batch_id,executor_id,reason)
        VALUES($1,'qa_workspace','archive',$2,$3,$4)`,
        [ids.realQa, randomUUID(), f.serviceId, archiveReason],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('the member sees the workspace archived and new work is refused; another workspace is unchanged', async () => {
    expect(await listedState('alice')).toEqual({ [ids.demo!]: true });
    expect(await h.state('alice', ids.demo)).toMatchObject({ archived: true, version: 0 });
    await expect(
      h.workspaces('alice').access({
        action: 'invite',
        commandId: randomUUID(),
        workspaceId: ids.demo,
        label: 'Synthetic invited after cleanup',
      }),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      f.owner.query('SELECT customer_private.workspace_open_guard($1)', [ids.demo]),
    ).rejects.toMatchObject({ code: '55000' });
    expect(await listedState('bob')).toEqual({ [ids.kept!]: false });
    await h.workspaces('bob').access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId: ids.kept,
      label: 'Synthetic invited to a kept workspace',
    });
  });

  test('the runtime and sign-in logins can neither read nor write the archive table', async () => {
    for (const pool of [f.runtime, f.auth]) {
      await expect(
        pool.query('SELECT count(*) FROM customer_private.data_cleanup_archive'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        pool.query(
          `INSERT INTO customer_private.data_cleanup_archive(tenant_id,category,action,batch_id,executor_id,reason)
          VALUES($1,'synthetic_workspace','restore',$2,$3,$4)`,
          [ids.demo, randomUUID(), f.serviceId, restoreReason],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  test('archive rows are append only', async () => {
    await expect(
      f.owner.query("UPDATE customer_private.data_cleanup_archive SET action='restore'"),
    ).rejects.toThrow();
    await expect(
      f.owner.query('DELETE FROM customer_private.data_cleanup_archive'),
    ).rejects.toThrow();
    expect(await cleanupRows()).toHaveLength(4);
  });

  test('a second archive writes nothing', async () => {
    const before = await cleanupRows();
    expect(
      await configureDataCleanup(f.owner, { action: 'archive', reason: archiveReason }),
    ).toEqual({
      batchId: null,
      archived: 0,
      restored: 0,
    });
    expect(await cleanupRows()).toEqual(before);
  });

  test("a member's restore after a cleanup archive wins", async () => {
    await h.lifecycle('carol', 'restore', { workspaceId: ids.memberRestore, expectedVersion: 0 });
    expect(await archived(ids.memberRestore!)).toBe(false);
    expect(await h.state('carol', ids.memberRestore)).toMatchObject({
      archived: false,
      version: 1,
    });
  });

  test('restore undoes the cleanup archive by tenant id only, and a second restore writes nothing', async () => {
    // A name changed after the archive does not matter: restore reads tenant ids from the archive rows.
    await f.owner.query("UPDATE app.tenant SET name='Synthetic Demo Mill moved' WHERE id=$1", [
      ids.demo,
    ]);
    const result = await configureDataCleanup(f.owner, {
      action: 'restore',
      reason: restoreReason,
    });
    expect(result).toMatchObject({ archived: 0, restored: 3 });
    const restores = (await cleanupRows()).filter((row) => row.action === 'restore');
    expect(restores.map((row) => row.tenant_id).sort()).toEqual(
      [ids.demo, ids.archivedRestored, ids.renamed].sort(),
    );
    for (const row of restores)
      expect(row).toMatchObject({ category: 'synthetic_workspace', batch_id: result.batchId });
    for (const target of [ids.demo, ids.archivedRestored, ids.renamed, ids.memberRestore])
      expect(await archived(target!)).toBe(false);
    // A member's own archive is not a cleanup archive and stays.
    expect(await archived(ids.memberArchived!)).toBe(true);
    expect(await listedState('alice')).toEqual({ [ids.demo!]: false });
    expect(
      await configureDataCleanup(f.owner, { action: 'restore', reason: restoreReason }),
    ).toEqual({ batchId: null, archived: 0, restored: 0 });
    expect((await inventoryDataCleanup(f.owner)).cleanupArchived).toEqual([]);
  });

  test('a workspace never cleaned still answers exactly as the previous function after archive and restore', async () => {
    const neverCleaned = [ids.kept, ids.memberArchived, ids.realHarbour, ids.realQa] as string[];
    for (const row of await sideBySide(neverCleaned)) expect(row.now, row.id).toBe(row.before);
  });
});

describe('the fingerprint on the replaced function', () => {
  test('a changed workspace_archived stops the install and writes nothing', async () => {
    const g = await fixture('corridra_upgrade');
    try {
      await migrateCustomerRealUse(g.owner);
      await migrateCustomerWorkspaceLifecycle(g.owner);
      await g.owner
        .query(`CREATE OR REPLACE FUNCTION customer_private.workspace_archived(target uuid) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT false $$`);
      await expect(migrateCustomerDataCleanup(g.owner)).rejects.toThrow(
        'Data cleanup prerequisite differs: customer_private.workspace_archived',
      );
      const left = (
        await g.owner.query<{ table: string | null; registry: string | null }>(
          "SELECT to_regclass('customer_private.data_cleanup_archive')::text AS table,to_regclass('customer_data_cleanup_migrations.applied')::text AS registry",
        )
      ).rows[0];
      expect(left).toEqual({ table: null, registry: null });
    } finally {
      await g.close();
    }
  }, 120000);
});
