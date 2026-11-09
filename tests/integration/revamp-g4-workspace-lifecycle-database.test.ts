import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { digest, harness, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';

// CRUD G4, real database, real restricted roles: an owner renames, archives and restores a workspace. Closed by
// default, owner only, one command id per decision, a stale version writes nothing, and nothing is deleted.
let f: Fixture;
let h: ReturnType<typeof harness>;
let workspaceId: string;
let otherWorkspace: string;
const original = 'Synthetic Atlas workspace';
const why = 'The company changed its trading name';
const rename = (name: string, expectedVersion: number, reason = why, target = workspaceId) => ({
  workspaceId: target,
  name,
  reason,
  expectedVersion,
});
const archive = (expectedVersion: number, confirmName: string, target = workspaceId) => ({
  workspaceId: target,
  expectedVersion,
  confirmName,
});
const restore = (expectedVersion: number, target = workspaceId) => ({
  workspaceId: target,
  expectedVersion,
});
const tenantName = async (target = workspaceId) =>
  (await f.owner.query('SELECT name FROM app.tenant WHERE id=$1', [target])).rows[0].name as string;
const dataTables = [
  'customer.workspace',
  'customer.membership',
  'customer_private.workspace_member',
  'customer_private.workspace_invitation',
  'customer_private.owned_request',
];

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'g4db');
  await h.admit(['alice', 'bob', 'carol', 'dave']);
  workspaceId = await h.provision('alice', original);
  otherWorkspace = await h.provision('dave', 'Synthetic Dave separate workspace');
  await h.makeAdmin('bob', workspaceId);
  await h.join('alice', 'carol', workspaceId);
  await migrateCustomerWorkspaceLifecycle(f.owner);
});
afterAll(async () => {
  await f?.close();
});

describe('a closed control', () => {
  test('refuses rename and archive with the module closed, and answers state with open false', async () => {
    const before = await h.lifecycleCounts();
    await expect(
      h.lifecycle('alice', 'rename', rename('Synthetic Beta workspace', 0)),
    ).rejects.toMatchObject({
      code: '0A000',
    });
    await expect(h.lifecycle('alice', 'archive', archive(0, original))).rejects.toMatchObject({
      code: '0A000',
    });
    expect(await h.lifecycleCounts()).toEqual(before);
    expect(await tenantName()).toBe(original);
    expect(await h.state('alice', workspaceId)).toMatchObject({
      open: false,
      archived: false,
      version: 0,
      name: original,
      role: 'owner',
      offer: null,
      ownerMemberId: null,
      history: [],
    });
  });
});

describe('rename, archive and restore', () => {
  beforeAll(() => h.setControl(true));

  test('rename writes a revision with the reason and the actor, and updates the name the team sees', async () => {
    const result = await h.lifecycle('alice', 'rename', rename('Synthetic Atlas Trading', 0));
    expect(result).toEqual({
      workspaceId,
      name: 'Synthetic Atlas Trading',
      archived: false,
      version: 1,
      operation: 'rename',
    });
    expect(await tenantName()).toBe('Synthetic Atlas Trading');
    const stored = (
      await f.owner.query(
        `SELECT r.kind,r.name,r.previous_name,r.reason,r.version,p.subject FROM customer_private.workspace_revision r
        JOIN customer_private.principal p ON p.id=r.changed_by WHERE r.tenant_id=$1`,
        [workspaceId],
      )
    ).rows;
    expect(stored).toEqual([
      {
        kind: 'rename',
        name: 'Synthetic Atlas Trading',
        previous_name: original,
        reason: why,
        version: 1,
        subject: 'synthetic-g4db-alice',
      },
    ]);
    const state = (await h.state('alice', workspaceId)) as Record<string, unknown>;
    expect(state).toMatchObject({ name: 'Synthetic Atlas Trading', version: 1, archived: false });
    expect(state.history).toEqual([
      expect.objectContaining({
        version: 1,
        kind: 'rename',
        name: 'Synthetic Atlas Trading',
        previousName: original,
        byYou: true,
        reason: why,
      }),
    ]);
    // Every member sees the new name in the workspace list, and a plain member never sees the reason.
    const listed = (
      await h.as('carol', async (db) =>
        (await db.query('SELECT id,name FROM customer.collaborative_workspaces()')).rows.find(
          (row) => row.id === workspaceId,
        ),
      )
    )?.name;
    expect(listed).toBe('Synthetic Atlas Trading');
    const memberView = (await h.state('carol', workspaceId)) as { history: { reason: unknown }[] };
    expect(memberView.history[0]!.reason).toBeNull();
    const adminView = (await h.state('bob', workspaceId)) as { history: { reason: unknown }[] };
    expect(adminView.history[0]!.reason).toBe(why);
  });

  test('a stale version writes nothing, shows the current name, and the same command id works with the fresh version', async () => {
    const before = await h.lifecycleCounts();
    const command = randomUUID();
    const stale = await h.lifecycle(
      'alice',
      'rename',
      rename('Synthetic Atlas Holdings', 0),
      command,
    );
    expect(stale).toEqual({
      stale: true,
      workspaceId,
      currentVersion: 1,
      currentName: 'Synthetic Atlas Trading',
      archived: false,
    });
    expect(await h.lifecycleCounts()).toEqual(before);
    expect(await tenantName()).toBe('Synthetic Atlas Trading');
    const retry = await h.lifecycle(
      'alice',
      'rename',
      rename('Synthetic Atlas Holdings', 1),
      command,
    );
    expect(retry).toMatchObject({ name: 'Synthetic Atlas Holdings', version: 2 });
  });

  test('a repeat of a command answers with the first result and writes nothing; the same id for anything else conflicts', async () => {
    const command = randomUUID();
    const input = rename('Synthetic Atlas Group', 2);
    const first = await h.lifecycle('alice', 'rename', input, command);
    const before = await h.lifecycleCounts();
    expect(await h.lifecycle('alice', 'rename', input, command)).toEqual(first);
    expect(await h.lifecycleCounts()).toEqual(before);
    await expect(
      h.lifecycle('alice', 'rename', rename('Synthetic Atlas Other', 2), command),
    ).rejects.toMatchObject({ code: '23514', message: 'Command conflicts with original request' });
    await expect(
      h.lifecycle('alice', 'archive', archive(3, 'Synthetic Atlas Group'), command),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await h.lifecycleCounts()).toEqual(before);
  });

  test('an unchanged name, a missing reason and an unlabelled name are refused', async () => {
    const before = await h.lifecycleCounts();
    await expect(
      h.lifecycle('alice', 'rename', rename('Synthetic Atlas Group', 3)),
    ).rejects.toMatchObject({ code: '23514', message: 'Name is unchanged' });
    await expect(
      h.lifecycle('alice', 'rename', rename('Synthetic Atlas New', 3, 'too short')),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      h.lifecycle('alice', 'rename', rename('Atlas New Name Without Label', 3)),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      h.lifecycle('alice', 'rename', rename('Synthetic Atlas\u0007Bell', 3)),
    ).rejects.toMatchObject({ code: '22023' });
    expect(await h.lifecycleCounts()).toEqual(before);
  });

  test('unknown keys, a bad id and a bad version are invalid input', async () => {
    const before = await h.lifecycleCounts();
    for (const [operation, input] of [
      ['rename', { ...rename('Synthetic Atlas New', 3), extra: 1 }],
      ['rename', { ...rename('Synthetic Atlas New', 3), workspaceId: 'not-a-uuid' }],
      ['rename', { ...rename('Synthetic Atlas New', 3), expectedVersion: '3' }],
      ['rename', { ...rename('Synthetic Atlas New', 3), expectedVersion: -1 }],
      ['archive', { workspaceId, expectedVersion: 3 }],
      ['restore', { ...restore(3), confirmName: 'x' }],
      ['delete', { workspaceId }],
    ] as const)
      await expect(h.lifecycle('alice', operation, input)).rejects.toMatchObject({ code: '22023' });
    expect(await h.lifecycleCounts()).toEqual(before);
  });

  test('archive needs the exact workspace name typed, then archives; restore brings it back with the same data', async () => {
    const name = await tenantName();
    const before = await h.lifecycleCounts();
    await expect(
      h.lifecycle('alice', 'archive', archive(3, 'synthetic atlas group')),
    ).rejects.toMatchObject({
      code: '22023',
      message: 'Type the workspace name to confirm',
    });
    expect(await h.lifecycleCounts()).toEqual(before);
    const data = await digest(f, dataTables);
    const archived = await h.lifecycle('alice', 'archive', archive(3, name));
    expect(archived).toEqual({
      workspaceId,
      name,
      archived: true,
      version: 4,
      operation: 'archive',
    });
    expect(await h.state('alice', workspaceId)).toMatchObject({ archived: true, version: 4 });
    expect(await h.state('carol')).toEqual(
      expect.arrayContaining([{ workspaceId, archived: true, version: 4 }]),
    );
    await expect(h.lifecycle('alice', 'archive', archive(4, name))).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      h.lifecycle('alice', 'rename', rename('Synthetic Atlas Archived', 4)),
    ).rejects.toMatchObject({ code: '23514', message: 'Restore the workspace before renaming it' });
    const restored = await h.lifecycle('alice', 'restore', restore(4));
    expect(restored).toEqual({
      workspaceId,
      name,
      archived: false,
      version: 5,
      operation: 'restore',
    });
    await expect(h.lifecycle('alice', 'restore', restore(5))).rejects.toMatchObject({
      code: '23514',
      message: 'This workspace is not archived',
    });
    // The same workspace, the same people and the same requests: only revisions were appended.
    expect(await digest(f, dataTables)).toEqual(data);
    expect(await tenantName()).toBe(name);
  });

  test('every operation writes exactly one event, audit, outbox and delivery row, with no name or reason in them', async () => {
    const before = await h.lifecycleCounts();
    const target = await h.provision('alice', 'Synthetic Chain workspace');
    const reason = 'A private reason that must stay out of events';
    const base = await h.lifecycleCounts();
    await h.lifecycle('alice', 'rename', rename('Synthetic Chain Renamed', 0, reason, target));
    await h.lifecycle('alice', 'archive', archive(1, 'Synthetic Chain Renamed', target));
    await h.lifecycle('alice', 'restore', restore(2, target));
    const after = await h.lifecycleCounts();
    for (const key of ['events', 'audits', 'outbox', 'deliveries'] as const)
      expect(after[key]! - base[key]!).toBe(3);
    expect(after.revisions! - base.revisions!).toBe(3);
    expect(after.requests! - base.requests!).toBe(3);
    expect(before.events).toBeLessThan(after.events!);
    const events = (
      await f.owner.query(
        "SELECT type,payload::text AS payload FROM app.domain_event WHERE tenant_id=$1 AND type LIKE 'customer.workspace.%' AND type NOT LIKE '%provisioned' ORDER BY aggregate_version",
        [target],
      )
    ).rows;
    expect(events.map((row) => row.type)).toEqual([
      'customer.workspace.renamed',
      'customer.workspace.archived',
      'customer.workspace.restored',
    ]);
    for (const row of events) {
      expect(row.payload).not.toContain('Chain');
      expect(row.payload).not.toContain(reason);
    }
  });
});

describe('who may change a workspace', () => {
  const names = () => tenantName();
  const denied = async (person: string, operation: string, input: Record<string, unknown>) => {
    const before = await h.lifecycleCounts();
    const name = await names();
    await expect(h.lifecycle(person, operation, input)).rejects.toMatchObject({ code: '42501' });
    expect(await h.lifecycleCounts()).toEqual(before);
    expect(await names()).toBe(name);
  };
  test('an admin, a member and the owner of another workspace are refused every operation, with no write', async () => {
    const name = await names();
    for (const person of ['bob', 'carol', 'dave']) {
      await denied(person, 'rename', rename('Synthetic Denied Rename', 5));
      await denied(person, 'archive', archive(5, name));
      await h.setControl(true);
    }
    // Restore is refused for them too, even while a workspace is archived.
    await h.lifecycle('alice', 'archive', archive(5, name));
    for (const person of ['bob', 'carol', 'dave']) await denied(person, 'restore', restore(6));
    await h.lifecycle('alice', 'restore', restore(6));
  });

  test('a person with no session and a person who cannot see the workspace get a denial, not its state', async () => {
    await expect(
      f.runtime.query('SELECT customer.workspace_lifecycle_command($1,$2,$3)', [
        randomUUID(),
        'rename',
        JSON.stringify(rename('Synthetic Anonymous Rename', 7)),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.runtime.query('SELECT customer.workspace_lifecycle_state($1)', [workspaceId]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(h.state('dave', workspaceId)).rejects.toMatchObject({ code: '42501' });
    expect(await h.state('dave')).toEqual([
      { workspaceId: otherWorkspace, archived: false, version: 0 },
    ]);
  });
});

describe('a paused control', () => {
  test('refuses rename and archive but still lets the owner restore, so a pause never traps an archive', async () => {
    const name = await tenantName();
    const version = ((await h.state('alice', workspaceId)) as { version: number }).version;
    await h.lifecycle('alice', 'archive', archive(version, name));
    await h.setControl(false);
    expect(await h.state('alice', workspaceId)).toMatchObject({ open: false, archived: true });
    await expect(
      h.lifecycle('alice', 'rename', rename('Synthetic Paused Rename', version + 1)),
    ).rejects.toMatchObject({ code: '0A000' });
    await expect(h.lifecycle('alice', 'archive', archive(version + 1, name))).rejects.toMatchObject(
      {
        code: '0A000',
      },
    );
    await expect(h.lifecycle('alice', 'restore', restore(version + 1))).resolves.toMatchObject({
      archived: false,
      version: version + 2,
    });
    await h.setControl(true);
  });
});

describe('the records', () => {
  test('are append only and unreachable by the application logins', async () => {
    const keys: Record<string, string> = {
      workspace_lifecycle_control: 'version',
      workspace_revision: 'id',
      workspace_lifecycle_request: 'actor_id',
      workspace_transfer_offer: 'id',
      workspace_transfer_outcome: 'offer_id',
      workspace_ownership_history: 'id',
    };
    const tables = Object.keys(keys);
    for (const [table, key] of Object.entries(keys)) {
      for (const pool of [f.runtime, f.auth])
        for (const statement of [
          `SELECT * FROM customer_private.${table}`,
          `UPDATE customer_private.${table} SET ${key}=${key}`,
          `DELETE FROM customer_private.${table}`,
        ])
          await expect(pool.query(statement)).rejects.toMatchObject({ code: '42501' });
    }
    for (const table of [
      'workspace_revision',
      'workspace_lifecycle_request',
      'workspace_lifecycle_control',
    ]) {
      await expect(
        f.owner.query(`UPDATE customer_private.${table} SET ${keys[table]}=${keys[table]}`),
      ).rejects.toMatchObject({
        message: 'Immutable record; append a new record',
      });
      await expect(f.owner.query(`DELETE FROM customer_private.${table}`)).rejects.toMatchObject({
        message: 'Immutable record; append a new record',
      });
    }
    expect(
      (
        await f.owner.query(
          `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='customer_private' AND c.relname = ANY($1) AND NOT c.relrowsecurity`,
          [tables],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
