import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerOrganisationProfileService } from '../../packages/auth/src/customer-organisation-profiles';
import {
  CustomerMemberRoleService,
  customerMemberCommandInput,
  customerMemberRolesEnabled,
} from '../../packages/auth/src/customer-member-roles';

// Invented provider-session fixtures exercise the real restricted SQL logins.
// They do not establish private managed-provider/email acceptance.
const issuer = 'https://ep-roles-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
let f: Awaited<ReturnType<typeof fixture>>, workspaceId: string, otherWorkspace: string;
const members: Record<string, string> = {};
let before: Awaited<ReturnType<typeof snapshot>>;
const session = (person: string): CustomerSession => ({
  subject: 'synthetic-roles-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const workspaces = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const profiles = (person = 'alice') =>
  new CustomerOrganisationProfileService(f.runtime, f.auth, options, async () => session(person));
const roles = (person = 'alice') =>
  new CustomerMemberRoleService(f.runtime, f.auth, options, async () => session(person));
const setRole = (
  person: string,
  member: string,
  role: 'admin' | 'member',
  expectedRole: 'admin' | 'member',
  target = workspaceId,
) =>
  roles(person).command({
    action: 'set_role',
    commandId: randomUUID(),
    workspaceId: target,
    memberId: member,
    role,
    expectedRole,
  });
const leave = (person: string, target = workspaceId) =>
  roles(person).command({ action: 'leave', commandId: randomUUID(), workspaceId: target });
async function join(person: string, target = workspaceId) {
  const invited = await workspaces('alice').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: target,
    label: 'Synthetic invited ' + person,
  });
  const accepted = await workspaces(person).access({
    action: 'accept',
    commandId: randomUUID(),
    token: invited.token!,
  });
  return accepted.memberId!;
}
async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.workspace_member_role) role_rows,
 (SELECT count(*)::int FROM customer_private.workspace_member_request) requests,
 (SELECT count(*)::int FROM customer_private.workspace_access_revocation) revocations,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_workspace_access') events,
 (SELECT count(*)::int FROM app.audit_event a JOIN app.domain_event e ON e.id=a.domain_event_id WHERE e.aggregate_type='customer_workspace_access') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_workspace_access') outbox,
 (SELECT count(*)::int FROM app.membership) staff,
 (SELECT count(*)::int FROM customer.membership) initial_members`)
  ).rows[0];
}
async function snapshot() {
  const functions = (
    await f.owner.query(
      `SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1`,
    )
  ).rows;
  const tables = (
    await f.owner.query(
      `SELECT n.nspname,c.relname,c.relacl::text acl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1,2`,
    )
  ).rows;
  const records: Record<string, string> = {};
  for (const row of tables) {
    const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    records[row.nspname + '.' + row.relname] = (
      await f.owner.query(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) d FROM ${q(row.nspname)}.${q(row.relname)} t`,
      )
    ).rows[0].d;
  }
  return {
    functions,
    tables,
    records,
    policies: (
      await f.owner.query(
        "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
      )
    ).rows,
  };
}
const profileCanEdit = async (person: string) =>
  (await profiles(person).view({ workspaceId })).canEdit;

beforeAll(async () => {
  f = await fixture();
  // Stage the released base plus the profile module, populated, before this module exists.
  await migrateCustomerOrganisationProfiles(f.owner);
  for (const person of people)
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'synthetic-roles-' + person,
      executorId: f.serviceId,
      reason: 'Explicit invented member-role test identity; no real account or email',
    });
  workspaceId = (
    await workspaces().provision({
      commandId: randomUUID(),
      name: 'Synthetic team roles workspace',
    })
  ).id;
  otherWorkspace = (
    await workspaces('erin').provision({
      commandId: randomUUID(),
      name: 'Synthetic separate private workspace',
    })
  ).id;
  for (const person of ['bob', 'carol', 'dave']) members[person] = await join(person);
  before = await snapshot();
  await migrateCustomerMemberRoles(f.owner);
});
afterAll(async () => {
  await f?.close();
});

test('installing the module on a populated database changes only the three role readers and adds only new objects', async () => {
  const after = await snapshot();
  const oldByName = new Map(before.functions.map((r) => [r.name, r]));
  const changed = after.functions
    .filter(
      (r) => oldByName.has(r.name) && JSON.stringify(oldByName.get(r.name)) !== JSON.stringify(r),
    )
    .map((r) => r.name)
    .sort();
  expect(changed).toEqual([
    'customer.collaborative_workspaces()',
    'customer.workspace_access_list(uuid,uuid,uuid,integer)',
    'customer_private.organisation_profile_role(uuid,uuid)',
  ]);
  // Each replaced function differs only in the role expression: identical ACL, identical other text.
  for (const name of changed) {
    const o = oldByName.get(name)!;
    const n = after.functions.find((r) => r.name === name)!;
    expect(n.acl).toBe(o.acl);
    expect(n.definition).toContain('workspace_member_role_now');
    expect(n.definition.replaceAll(/\s+/g, ' ').length).toBeGreaterThan(o.definition.length / 2);
  }
  const addedFunctions = after.functions
    .filter((r) => !oldByName.has(r.name))
    .map((r) => r.name)
    .sort();
  expect(addedFunctions).toEqual([
    'customer.workspace_member_command(uuid,text,jsonb)',
    'customer_private.workspace_member_role_now(uuid)',
  ]);
  const oldTables = new Set(before.tables.map((t) => t.nspname + '.' + t.relname));
  expect(
    after.tables
      .map((t) => t.nspname + '.' + t.relname)
      .filter((t) => !oldTables.has(t))
      .sort(),
  ).toEqual([
    'customer_private.workspace_member_request',
    'customer_private.workspace_member_role',
  ]);
  for (const [name, digest] of Object.entries(before.records))
    expect(after.records[name]).toBe(digest);
  expect(
    after.policies.filter(
      (p) =>
        !before.policies.some((q) => q.policyname === p.policyname && q.tablename === p.tablename),
    ),
  ).toEqual([]);
  for (const t of before.tables) {
    const n = after.tables.find((x) => x.nspname === t.nspname && x.relname === t.relname)!;
    expect(n.acl).toBe(t.acl);
    expect(n.relrowsecurity).toBe(t.relrowsecurity);
  }
});

test('before any role change every invited member keeps exactly the old role and read-only profile access', async () => {
  for (const person of ['bob', 'carol', 'dave']) {
    expect((await workspaces(person).list()).find((w) => w.id === workspaceId)?.role).toBe(
      'member',
    );
    expect(await profileCanEdit(person)).toBe(false);
  }
  expect(await profileCanEdit('alice')).toBe(true);
  const page = await workspaces().listAccess({ workspaceId });
  expect(page.memberships.map((m) => [m.role, m.roleVersion])).toEqual([
    ['member', 0],
    ['member', 0],
    ['member', 0],
  ]);
});

test('only the workspace owner can change a role, and the change takes effect everywhere roles are read', async () => {
  const start = await counts();
  const result = await setRole('alice', members.bob, 'admin', 'member');
  expect(result).toEqual({
    workspaceId,
    memberId: members.bob,
    role: 'admin',
    roleVersion: 1,
  });
  expect((await workspaces('bob').list()).find((w) => w.id === workspaceId)?.role).toBe('admin');
  expect(await profileCanEdit('bob')).toBe(true);
  expect(await profileCanEdit('carol')).toBe(false);
  const page = await workspaces().listAccess({ workspaceId });
  expect(page.memberships.find((m) => m.id === members.bob)).toMatchObject({
    role: 'admin',
    roleVersion: 1,
    status: 'active',
  });
  const end = await counts();
  expect(end.role_rows).toBe(start.role_rows + 1);
  expect(end.events).toBe(start.events + 1);
  expect(end.audits).toBe(start.audits + 1);
  expect(end.outbox).toBe(start.outbox + 1);
  expect(end.staff).toBe(start.staff);
  expect(end.initial_members).toBe(start.initial_members);
  const event = (
    await f.owner.query(
      "SELECT type,payload FROM app.domain_event WHERE type='customer.workspace.member.role_changed'",
    )
  ).rows;
  expect(event).toHaveLength(1);
  expect(event[0].payload).toMatchObject({
    memberId: members.bob,
    role: 'admin',
    synthetic: true,
    initiator_kind: 'customer',
  });
});

test('an admin or a plain member cannot change roles, and an owner of another workspace cannot reach this team', async () => {
  const start = await counts();
  await expect(setRole('bob', members.carol, 'admin', 'member')).rejects.toThrow(/owner required/i);
  await expect(setRole('carol', members.carol, 'admin', 'member')).rejects.toThrow(
    /owner required/i,
  );
  await expect(setRole('erin', members.carol, 'admin', 'member', otherWorkspace)).rejects.toThrow(
    /unavailable/i,
  );
  await expect(setRole('erin', members.carol, 'admin', 'member')).rejects.toThrow();
  expect(await counts()).toEqual(start);
  expect(await profileCanEdit('carol')).toBe(false);
});

test('stale, repeated and unknown requests are refused and write nothing', async () => {
  const start = await counts();
  await expect(setRole('alice', members.bob, 'member', 'member')).rejects.toThrow(/role changed/i);
  await expect(setRole('alice', members.bob, 'admin', 'admin')).rejects.toThrow(/already has/i);
  await expect(setRole('alice', randomUUID(), 'admin', 'member')).rejects.toThrow(/unavailable/i);
  // The service validates the shape before it reaches SQL.
  for (const bad of [
    {
      action: 'set_role',
      commandId: randomUUID(),
      workspaceId,
      memberId: members.bob,
      role: 'owner',
      expectedRole: 'admin',
    },
    {
      action: 'set_role',
      commandId: randomUUID(),
      workspaceId,
      memberId: members.bob,
      role: 'viewer',
      expectedRole: 'admin',
    },
    {
      action: 'set_role',
      commandId: randomUUID(),
      workspaceId,
      memberId: members.bob,
      role: 'admin',
    },
    { action: 'leave', commandId: randomUUID(), workspaceId, memberId: members.bob },
    { action: 'leave', commandId: randomUUID(), workspaceId, role: 'admin' },
    { action: 'delete', commandId: randomUUID(), workspaceId, memberId: members.bob },
  ])
    expect(customerMemberCommandInput.safeParse(bad).success).toBe(false);
  // The same checks hold if SQL is called directly with a hostile payload.
  for (const payload of [
    { workspaceId, memberId: members.bob, role: 'owner', expectedRole: 'admin' },
    { workspaceId, memberId: members.bob, role: 'admin', expectedRole: 'admin', extra: 1 },
    { workspaceId, memberId: 5, role: 'admin', expectedRole: 'admin' },
  ])
    await expect(
      roles('alice').command({ action: 'set_role', commandId: randomUUID(), ...payload }),
    ).rejects.toThrow();
  expect(await counts()).toEqual(start);
});

test('a repeated command id returns the first answer once, and the same id with a different request conflicts', async () => {
  const command = {
    action: 'set_role' as const,
    commandId: randomUUID(),
    workspaceId,
    memberId: members.carol,
    role: 'admin' as const,
    expectedRole: 'member' as const,
  };
  const start = await counts();
  const first = await roles('alice').command(command);
  const retry = await roles('alice').command(command);
  expect(retry).toEqual(first);
  const end = await counts();
  expect(end.role_rows).toBe(start.role_rows + 1);
  expect(end.events).toBe(start.events + 1);
  await expect(roles('alice').command({ ...command, memberId: members.dave })).rejects.toThrow(
    /conflicts/i,
  );
  await expect(
    roles('alice').command({ ...command, role: 'member', expectedRole: 'admin' }),
  ).rejects.toThrow(/conflicts/i);
  expect(await counts()).toEqual(end);
});

test('demoting returns the member to the old access, each change is a new history row, and history cannot be rewritten', async () => {
  const demoted = await setRole('alice', members.carol, 'member', 'admin');
  expect(demoted.roleVersion).toBe(2);
  expect(await profileCanEdit('carol')).toBe(false);
  expect((await workspaces('carol').list()).find((w) => w.id === workspaceId)?.role).toBe('member');
  const history = (
    await f.owner.query(
      'SELECT version,role FROM customer_private.workspace_member_role WHERE member_id=$1 ORDER BY version',
      [members.carol],
    )
  ).rows;
  expect(history).toEqual([
    { version: 1, role: 'admin' },
    { version: 2, role: 'member' },
  ]);
  await expect(
    f.owner.query(
      "UPDATE customer_private.workspace_member_role SET role='admin' WHERE member_id=$1",
      [members.carol],
    ),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM customer_private.workspace_member_role'),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM customer_private.workspace_member_request'),
  ).rejects.toThrow();
});

test('the runtime and auth logins cannot read or write the new tables or call the private helper', async () => {
  for (const pool of [f.runtime, f.auth]) {
    await expect(
      pool.query('SELECT * FROM customer_private.workspace_member_role'),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      pool.query(
        'INSERT INTO customer_private.workspace_member_role(tenant_id,member_id,version,role,changed_by) VALUES($1,$2,9,$3,$4)',
        [workspaceId, members.dave, 'admin', randomUUID()],
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      pool.query('SELECT customer_private.workspace_member_role_now($1)', [members.bob]),
    ).rejects.toThrow(/permission denied/i);
  }
  // Calling the command without a customer session is denied.
  await expect(
    f.runtime.query("SELECT customer.workspace_member_command($1,'leave',$2)", [
      randomUUID(),
      JSON.stringify({ workspaceId }),
    ]),
  ).rejects.toThrow(/denied/i);
});

test('a member can leave only their own membership, loses all access, and nobody else can make them leave', async () => {
  // A person with no active membership here cannot "leave" someone else's.
  await expect(leave('erin')).rejects.toThrow(/unavailable/i);
  const start = await counts();
  const left = await leave('dave');
  expect(left).toEqual({ workspaceId, memberId: members.dave, status: 'left' });
  const end = await counts();
  expect(end.revocations).toBe(start.revocations + 1);
  expect(end.events).toBe(start.events + 1);
  expect((await workspaces('dave').list()).map((w) => w.id)).not.toContain(workspaceId);
  expect(await workspaces().listAccess({ workspaceId })).toMatchObject({
    memberships: expect.arrayContaining([
      expect.objectContaining({ id: members.dave, status: 'revoked' }),
    ]),
  });
  await expect(leave('dave')).rejects.toThrow(/unavailable/i);
  await expect(setRole('alice', members.dave, 'admin', 'member')).rejects.toThrow(/unavailable/i);
  await expect(profiles('dave').view({ workspaceId })).rejects.toThrow();
  // Bob's own membership is untouched by Dave leaving.
  expect((await workspaces('bob').list()).map((w) => w.id)).toContain(workspaceId);
});

test('an owner-revoked or account-disabled member cannot be given a role or leave', async () => {
  const frank = await join('frank');
  await workspaces('alice').access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId,
    kind: 'membership',
    targetId: frank,
  });
  await expect(setRole('alice', frank, 'admin', 'member')).rejects.toThrow(/unavailable/i);
  await expect(leave('frank')).rejects.toThrow(/unavailable/i);
  await f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject=$1',
    ['synthetic-roles-carol'],
  );
  await expect(setRole('alice', members.carol, 'admin', 'member')).rejects.toThrow(/unavailable/i);
});

test('the original owner has no member row, so cannot be demoted, removed or made to leave', async () => {
  const owner = (
    await f.owner.query(
      'SELECT count(*)::int n FROM customer_private.workspace_member m JOIN customer_private.principal p ON p.id=m.principal_id WHERE p.subject=$1',
      ['synthetic-roles-alice'],
    )
  ).rows[0].n;
  expect(owner).toBe(0);
  await expect(leave('alice')).rejects.toThrow(/unavailable/i);
  expect((await workspaces('alice').list()).find((w) => w.id === workspaceId)?.role).toBe('owner');
});

test('the flag, synthetic and production gates stay binding and the installer is repeatable', async () => {
  const on = { DATA_ENVIRONMENT: 'synthetic', CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true' };
  expect(customerMemberRolesEnabled(on)).toBe(false);
  expect(
    customerMemberRolesEnabled({ ...on, CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED: 'true' }),
  ).toBe(true);
  expect(
    customerMemberRolesEnabled({
      ...on,
      CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED: 'true',
      DATA_ENVIRONMENT: 'real',
    }),
  ).toBe(false);
  expect(
    customerMemberRolesEnabled({
      ...on,
      CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED: 'true',
      VERCEL_ENV: 'production',
    }),
  ).toBe(false);
  const disabled = new CustomerMemberRoleService(
    f.runtime,
    f.auth,
    { ...options, enabled: false },
    async () => session('alice'),
  );
  await expect(
    disabled.command({
      action: 'leave',
      commandId: randomUUID(),
      workspaceId,
      memberId: members.bob,
    }),
  ).rejects.toThrow();
  const first = (await f.owner.query('SELECT * FROM customer_member_role_migrations.applied')).rows;
  await migrateCustomerMemberRoles(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM customer_member_role_migrations.applied')).rows,
  ).toEqual(first);
  expect(first).toHaveLength(1);
  await f.owner.query('UPDATE customer_member_role_migrations.applied SET sha256=$1', [
    randomBytes(32).toString('hex'),
  ]);
  await expect(migrateCustomerMemberRoles(f.owner)).rejects.toThrow(/history mismatch/i);
  await f.owner.query('UPDATE customer_member_role_migrations.applied SET sha256=$1', [
    first[0].sha256,
  ]);
});
