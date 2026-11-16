import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { harness, type Fixture } from './revamp-g4-support';
import type { DatabasePool } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import {
  dataCleanupKeepList,
  inventoryDataCleanup,
} from '../../packages/auth/src/customer-data-cleanup';

// U2 data cleanup inventory, real database: it counts made-up and QA-named workspaces and records and writes nothing. Its
// lines are printed in public Actions logs, so they carry counts and 8-character ids, and a name only from the keep list.
// Every workspace and person here is invented.
let f: Fixture;
let h: ReturnType<typeof harness>;
let people: Record<string, string>;
const ids: Record<string, string> = {};
const typed = {
  demo: 'Synthetic Demo Mill',
  archivedByMember: 'Synthetic Member Archived',
  realHarbour: 'Harbour Trading Ltd',
  realQa: 'QA Test Real Co',
};
const keptName = dataCleanupKeepList[1].name;

// md5 over every row of every user table, so a test can prove that nothing at all was written or rewritten.
async function everyTable() {
  const tables = (
    await f.owner.query<{ name: string }>(
      "SELECT format('%I.%I',schemaname,relname) AS name FROM pg_stat_user_tables ORDER BY 1",
    )
  ).rows.map((row) => row.name);
  const result: Record<string, string> = {};
  for (const table of tables)
    result[table] = (
      await f.owner.query<{ d: string }>(
        `SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS d FROM ${table} t`,
      )
    ).rows[0]!.d;
  return result;
}
// The inventory on a connection that records every statement it sends.
async function recordedInventory() {
  const statements: string[] = [];
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
  return { inventory: await inventoryDataCleanup(recording), statements };
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
function expectReadOnly(statements: string[]) {
  expect(statements[0]).toBe('BEGIN READ ONLY');
  expect(statements.at(-1)).toBe('ROLLBACK');
  expect(
    statements.filter((text) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|COMMIT)\b/i.test(text)),
  ).toEqual([]);
}
// What may appear in the public log: no typed name, no full id, no email.
function expectSafe(lines: string[]) {
  const printed = lines.join('\n');
  for (const name of Object.values(typed)) expect(printed).not.toContain(name);
  for (const id of Object.values(ids)) expect(printed).not.toContain(id);
  expect(printed).not.toMatch(/@/);
  expect(printed).toContain(`${ids.kept!.slice(0, 8)} ${keptName}: kept, used by`);
}

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'dc');
  people = await h.admit(['alice', 'bob', 'dave']);
  ids.demo = await h.provision('alice', typed.demo);
  ids.kept = await h.provision('bob', keptName);
  ids.archivedByMember = await h.provision('dave', typed.archivedByMember);
  ids.realHarbour = await realWorkspace(typed.realHarbour, people.alice!);
  ids.realQa = await realWorkspace(typed.realQa, people.alice!);
}, 120000);
afterAll(async () => {
  await f?.close();
});

describe('without the workspace lifecycle module', () => {
  test('the inventory counts made-up and QA-named workspaces, writes nothing and runs read only', async () => {
    const before = await everyTable();
    const { inventory, statements } = await recordedInventory();
    expectReadOnly(statements);
    expect(await everyTable()).toEqual(before);
    expect(inventory.installed).toEqual({ workspaces: true, lifecycle: false });
    expect(inventory.totals).toEqual({ synthetic: 3, real: 2 });
    expect(inventory.synthetic.kept).toEqual([
      { id: ids.kept, name: keptName, usedBy: 'scripts/qa/signed-in-sweep.ts' },
    ]);
    expect(inventory.synthetic.createdByPerson.sort()).toEqual(
      [ids.demo, ids.archivedByMember].sort(),
    );
    expect(inventory.qa).toEqual({ kept: [], listedOnly: [ids.realQa] });
    expect(inventory.lines).toContain(
      'synthetic workspaces held, created by a person (never archived here): 2',
    );
    expect(inventory.lines).toContain('synthetic workspaces archived now: lifecycle not installed');
    expect(inventory.lines).toContain(`  ${ids.realQa!.slice(0, 8)}`);
    expect(inventory.lines.at(-1)).toBe('Nothing was archived, changed or deleted.');
  });

  test('a name a person typed never reaches the output; only counts, short ids and kept names do', async () => {
    expectSafe((await inventoryDataCleanup(f.owner)).lines);
  });
});

describe('with the workspace lifecycle module', () => {
  beforeAll(async () => {
    await migrateCustomerWorkspaceLifecycle(f.owner);
    await h.setControl(true);
    await h.lifecycle('dave', 'archive', {
      workspaceId: ids.archivedByMember,
      expectedVersion: 0,
      confirmName: typed.archivedByMember,
    });
  });

  test('the inventory counts what is archived now and still writes nothing', async () => {
    const before = await everyTable();
    const { inventory, statements } = await recordedInventory();
    expectReadOnly(statements);
    expect(await everyTable()).toEqual(before);
    expect(inventory.installed).toEqual({ workspaces: true, lifecycle: true });
    expect(inventory.synthetic.archived).toBe(1);
    expect(inventory.lines).toContain('synthetic workspaces archived now: 1');
    // Archived or not, a workspace a person created is only counted.
    expect(inventory.synthetic.createdByPerson).toContain(ids.archivedByMember);
    expectSafe(inventory.lines);
  });

  test('a QA-named real workspace and every person-created workspace stay exactly as they were', async () => {
    const archived = async (target: string) =>
      (
        await f.owner.query<{ a: boolean }>('SELECT customer_private.workspace_archived($1) AS a', [
          target,
        ])
      ).rows[0]!.a;
    await inventoryDataCleanup(f.owner);
    expect(await archived(ids.realQa!)).toBe(false);
    expect(await archived(ids.demo!)).toBe(false);
    expect(await archived(ids.archivedByMember!)).toBe(true);
  });
});
