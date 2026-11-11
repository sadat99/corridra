import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { digest, harness, type Fixture } from './revamp-g4-support';
import { installShippedG4G5, shippedFiles } from './revamp-g4-g5-shipped';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';

// ERASURE_BASE_CHECK=1 (or REMOVED_BASE_CHECK=1) keeps the erasure file away from the migrators, which is how the cases that need it
// are shown to fail on main. Without those variables nothing is hidden. See removed-member-hide.ts.
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

// CRUD G4 and G5 are installed and enabled in production, so the follow-up reaches an installed database. This builds a
// database exactly the way production was built (the files of merge f62e093d, recorded with their hashes), puts data and the
// module controls in it, and then runs the current installers over it.
let old: Fixture;
let fresh: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
let workspaceId: string;
let catMember: string;

const workspaceSchema = 'customer_workspace_lifecycle_migrations';
const accountSchema = 'customer_account_lifecycle_migrations';
const changedFunctions = [
  'customer.account_lifecycle_command(uuid,text,jsonb)',
  'customer.erasure_queue(bigint,integer,text)',
  'customer.erasure_transition(uuid,uuid,text,text,text)',
  'customer.provision_workspace(uuid,text)',
  'customer.workspace_lifecycle_state(uuid)',
  'customer_private.account_chain_tenant(uuid)',
];
const newFunctions = [
  'customer.erasure_request_reach(uuid,timestamp with time zone,uuid)',
  'customer_private.erasure_in_scope(uuid)',
  'customer_private.member_role_keeps_access_guard()',
  'customer_private.revocation_keeps_access_guard()',
  'customer_private.workspace_member_keeps_access(uuid)',
];
const newFiles = {
  workspace: [
    '0005_member_protection.sql',
    '0006_provisioning_closed_account.sql',
    '0007_archive_gate_late.sql',
    '0008_member_role_guard_late.sql',
    '0009_keeps_access_in_state.sql',
  ],
  account: [
    '0002_account_chain_and_undo_words.sql',
    '0003_erasure_queue_scope.sql',
    '0004_erasure_scope_by_workspaces.sql',
    '0005_removed_member_erasure.sql',
  ],
};
// The one new function an application login may call: the staff reach list of the erasure file (owner decisions 11 Nov 2026:
// "Yes, add an erasure path (Recommended)", "Staff by hand, tracked (Recommended)"). It is granted to the runtime login only.
const staffCallable = ['customer.erasure_request_reach(uuid,timestamp with time zone,uuid)'];
const recordTables = [
  'customer_private.workspace_revision',
  'customer_private.workspace_lifecycle_request',
  'customer_private.workspace_transfer_offer',
  'customer_private.workspace_transfer_outcome',
  'customer_private.workspace_ownership_history',
  'customer_private.workspace_lifecycle_control',
  'customer_private.account_lifecycle_control',
  'customer_private.account_closure_event',
  'customer_private.account_lifecycle_request',
  'customer_private.erasure_request',
  'customer_private.erasure_status_event',
  'customer_private.workspace_access_revocation',
  'customer_private.workspace_member',
  'customer.membership',
  'customer.workspace',
  'app.tenant',
  'app.domain_event',
  'app.audit_event',
];

async function functions(pool: Fixture) {
  const rows = (
    await pool.owner.query(
      `SELECT p.oid::regprocedure::text AS name,md5(pg_get_functiondef(p.oid)) AS def,coalesce(p.proacl::text,'') AS acl
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('app','customer','customer_private') AND p.prokind='f' ORDER BY 1`,
    )
  ).rows as { name: string; def: string; acl: string }[];
  return new Map(rows.map((row) => [row.name, row]));
}
const triggers = async (pool: Fixture) =>
  (
    await pool.owner.query(
      `SELECT c.oid::regclass::text||':'||t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('customer','customer_private') ORDER BY 1`,
    )
  ).rows.map((row) => row.name as string);
const registry = async (pool: Fixture, schema: string) =>
  (
    await pool.owner.query(
      `SELECT name,sha256,applied_at::text AS at FROM ${schema}.applied ORDER BY name`,
    )
  ).rows as { name: string; sha256: string; at: string }[];
const controls = async (pool: Fixture) =>
  (
    await pool.owner.query(
      `SELECT customer_private.workspace_lifecycle_open() AS workspace,customer_private.account_lifecycle_open() AS account`,
    )
  ).rows[0] as { workspace: boolean; account: boolean };

beforeAll(async () => {
  old = await fixture();
  await migrateCustomerRealUse(old.owner);
  await migrateCustomerProgrammeLifecycle(old.owner);
  await migrateCustomerMemberRoles(old.owner);
  await installShippedG4G5(old.owner);
  h = harness(old, 'g45up');
  ids = await h.admit(['ann', 'ben', 'cat', 'dan']);
  await h.setControl(true);
  await old.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(1,true,$1,$2)',
    [old.serviceId, 'Fixture control for the upgrade tests'],
  );
  // Data made by the shipped functions: a workspace handed from ann to ben, a member who closed, an erasure request.
  workspaceId = await h.provision('ann', 'Synthetic upgrade workspace');
  const benMember = await h.join('ann', 'ben', workspaceId);
  catMember = await h.join('ann', 'cat', workspaceId);
  const offer = await h.ownership('ann', 'offer', {
    workspaceId,
    memberId: benMember,
    confirmName: 'Synthetic upgrade workspace',
    expectedVersion: 0,
  });
  await h.ownership('ben', 'accept', { offerId: offer.offerId });
  const account = (person: string, operation: string, input: Record<string, unknown> = {}) =>
    h.sql(person, 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
      randomUUID(),
      operation,
      JSON.stringify(input),
    ]);
  await account('cat', 'close', { confirmation: 'Close my account' });
  const own = await h.provision('dan', 'Synthetic dan upgrade workspace');
  await h.lifecycle('dan', 'archive', {
    workspaceId: own,
    expectedVersion: 0,
    confirmName: 'Synthetic dan upgrade workspace',
  });
  await account('dan', 'file_erasure');
  await account('dan', 'close', { confirmation: 'Close my account' });
  // The account module is paused in production state for this test: the upgrade must not touch either value.
  await old.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(2,false,$1,$2)',
    [old.serviceId, 'Paused by the upgrade test fixture'],
  );
});
afterAll(async () => {
  await old?.close();
  await fresh?.close();
});

describe('the follow-up reaches an installed database', () => {
  let before: {
    functions: Map<string, { name: string; def: string; acl: string }>;
    triggers: string[];
    workspaceRegistry: Awaited<ReturnType<typeof registry>>;
    accountRegistry: Awaited<ReturnType<typeof registry>>;
    tables: Record<string, string>;
    controls: { workspace: boolean; account: boolean };
  };

  test('the shipped files install the old way, and the database holds only the shipped files', async () => {
    before = {
      functions: await functions(old),
      triggers: await triggers(old),
      workspaceRegistry: await registry(old, workspaceSchema),
      accountRegistry: await registry(old, accountSchema),
      tables: await digest(old, recordTables),
      controls: await controls(old),
    };
    expect(before.workspaceRegistry.map((row) => row.name)).toEqual(
      (await shippedFiles('workspace')).map((file) => file.name),
    );
    expect(before.accountRegistry.map((row) => row.name)).toEqual(
      (await shippedFiles('account')).map((file) => file.name),
    );
    expect(before.controls).toEqual({ workspace: true, account: false });
    expect(before.functions.has('customer_private.account_chain_tenant(uuid)')).toBe(true);
    expect(before.functions.has('customer_private.erasure_in_scope(uuid)')).toBe(false);
  });

  test('the account installer applies only the new files, and changes only the named functions', async () => {
    await migrateCustomerAccountLifecycle(old.owner);
    const after = await functions(old);
    for (const [name, row] of before.functions) {
      const now = after.get(name);
      expect(now, name).toBeDefined();
      expect(now!.acl, name).toBe(row.acl);
      if (changedFunctions.includes(name)) expect(now!.def, name).not.toBe(row.def);
      else expect(now!.def, name).toBe(row.def);
    }
    expect([...after.keys()].filter((name) => !before.functions.has(name)).sort()).toEqual(
      newFunctions,
    );
    // no new function is callable by the application logins, except the staff reach list, which only the runtime login may call
    for (const name of newFunctions) {
      const rights = (
        await old.owner.query(
          `SELECT has_function_privilege('corridra_runtime',$1::regprocedure,'EXECUTE') AS runtime,
            has_function_privilege('corridra_auth',$1::regprocedure,'EXECUTE') AS auth,has_function_privilege('public',$1::regprocedure,'EXECUTE') AS pub`,
          [name],
        )
      ).rows[0];
      expect(rights, name).toEqual({
        runtime: staffCallable.includes(name),
        auth: false,
        pub: false,
      });
    }
    const names = await triggers(old);
    expect(before.triggers.filter((name) => !names.includes(name))).toEqual([]);
    expect(names.filter((name) => !before.triggers.includes(name)).sort()).toEqual([
      'customer_private.account_chain:account_chain_immutable',
      'customer_private.workspace_access_revocation:workspace_revocation_keeps_access',
      'customer_private.workspace_member_role:workspace_member_role_keeps_access',
    ]);
  });

  test('recorded hashes of the shipped files are untouched and the new files are recorded with their own hashes', async () => {
    const workspace = await registry(old, workspaceSchema);
    const account = await registry(old, accountSchema);
    expect(workspace.slice(0, before.workspaceRegistry.length)).toEqual(before.workspaceRegistry);
    expect(account.slice(0, before.accountRegistry.length)).toEqual(before.accountRegistry);
    const expectedWorkspace = (await shippedFiles('workspace')).map((file) => file.name);
    expect(workspace.map((row) => row.name)).toEqual([...expectedWorkspace, ...newFiles.workspace]);
    expect(account.map((row) => row.name)).toEqual([
      ...(await shippedFiles('account')).map((file) => file.name),
      ...newFiles.account,
    ]);
    // the shipped hashes are the ones that were recorded in production, byte for byte
    for (const file of await shippedFiles('workspace'))
      expect(workspace.find((row) => row.name === file.name)?.sha256).toBe(file.hash);
    for (const file of await shippedFiles('account'))
      expect(account.find((row) => row.name === file.name)?.sha256).toBe(file.hash);
  });

  test('the module controls are exactly as they were: workspace enabled, account paused, no control row added', async () => {
    expect(await controls(old)).toEqual(before.controls);
    const now = await digest(old, [
      'customer_private.workspace_lifecycle_control',
      'customer_private.account_lifecycle_control',
    ]);
    expect(now['customer_private.workspace_lifecycle_control']).toBe(
      before.tables['customer_private.workspace_lifecycle_control'],
    );
    expect(now['customer_private.account_lifecycle_control']).toBe(
      before.tables['customer_private.account_lifecycle_control'],
    );
  });

  test('every existing row is unchanged, and the new chain table is filled from the events that exist', async () => {
    const now = await digest(old, recordTables);
    expect(now).toEqual(before.tables);
    const chain = (
      await old.owner.query('SELECT principal_id,tenant_id FROM customer_private.account_chain')
    ).rows;
    expect(chain).toEqual(
      expect.arrayContaining([
        { principal_id: ids.cat, tenant_id: workspaceId },
        expect.objectContaining({ principal_id: ids.dan }),
      ]),
    );
    expect(chain).toHaveLength(2);
  });

  test('a member who closed before the upgrade and is removed after it can still undo', async () => {
    await h.sql('ben', 'SELECT customer.workspace_access_command($1,$2,$3)', [
      randomUUID(),
      'revoke',
      JSON.stringify({ workspaceId, kind: 'membership', targetId: catMember }),
    ]);
    const undone = await h.sql<{ r: Record<string, unknown> }>(
      'cat',
      'SELECT customer.account_lifecycle_command($1,$2,$3) AS r',
      [randomUUID(), 'undo', '{}'],
    );
    expect(undone.r).toMatchObject({ operation: 'undo', changed: true, status: 'active' });
    // the new protections work on the upgraded database too: the owner who came in by invitation cannot leave
    await expect(
      h.sql('ben', 'SELECT customer.workspace_member_command($1,$2,$3)', [
        randomUUID(),
        'leave',
        JSON.stringify({ workspaceId }),
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('running the installers again is a no-op', async () => {
    const functionsBefore = await functions(old);
    const registryBefore = [
      await registry(old, workspaceSchema),
      await registry(old, accountSchema),
    ];
    const tablesBefore = await digest(old, recordTables);
    await migrateCustomerAccountLifecycle(old.owner);
    await migrateCustomerWorkspaceLifecycle(old.owner);
    expect(await functions(old)).toEqual(functionsBefore);
    expect([await registry(old, workspaceSchema), await registry(old, accountSchema)]).toEqual(
      registryBefore,
    );
    expect(await digest(old, recordTables)).toEqual(tablesBefore);
    expect(await controls(old)).toEqual(before.controls);
  });

  test('a changed applied file is still refused: shipped or new, in either module', async () => {
    for (const [schema, name, run] of [
      [workspaceSchema, '0003_archive_enforcement.sql', migrateCustomerWorkspaceLifecycle],
      [workspaceSchema, '0005_member_protection.sql', migrateCustomerWorkspaceLifecycle],
      [accountSchema, '0001_account_closure_and_erasure.sql', migrateCustomerAccountLifecycle],
      [accountSchema, '0003_erasure_queue_scope.sql', migrateCustomerAccountLifecycle],
      [accountSchema, '0004_erasure_scope_by_workspaces.sql', migrateCustomerAccountLifecycle],
      [accountSchema, '0005_removed_member_erasure.sql', migrateCustomerAccountLifecycle],
    ] as const) {
      const recorded = (
        await old.owner.query(`SELECT sha256 FROM ${schema}.applied WHERE name=$1`, [name])
      ).rows[0].sha256 as string;
      await old.owner.query(
        `UPDATE ${schema}.applied SET sha256='0'||substr(sha256,2) WHERE name=$1`,
        [name],
      );
      try {
        await expect(run(old.owner), name).rejects.toThrow(/migration history mismatch/);
      } finally {
        await old.owner.query(`UPDATE ${schema}.applied SET sha256=$2 WHERE name=$1`, [
          name,
          recorded,
        ]);
      }
    }
    await migrateCustomerAccountLifecycle(old.owner);
  });

  test('an upgraded database has exactly the functions of a database installed fresh from the current files', async () => {
    fresh = await fixture('corridra_upgrade');
    await migrateCustomerRealUse(fresh.owner);
    await migrateCustomerProgrammeLifecycle(fresh.owner);
    await migrateCustomerMemberRoles(fresh.owner);
    await migrateCustomerAccountLifecycle(fresh.owner);
    const upgraded = await functions(old);
    const installed = await functions(fresh);
    expect([...upgraded.keys()]).toEqual([...installed.keys()]);
    for (const [name, row] of installed) expect(upgraded.get(name), name).toEqual(row);
    expect(await triggers(old)).toEqual(await triggers(fresh));
    expect((await registry(fresh, workspaceSchema)).map((row) => [row.name, row.sha256])).toEqual(
      (await registry(old, workspaceSchema)).map((row) => [row.name, row.sha256]),
    );
  });
});
