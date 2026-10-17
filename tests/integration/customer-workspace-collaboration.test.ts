import { beforeAll, afterAll, expect, test } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { sessionHash } from '../../packages/db/src/index';

// Invented provider-session fixtures exercise the real restricted SQL logins.
// They do not establish private managed-provider/email acceptance.
const issuer =
  'https://ep-collaboration-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'eve', 'past'];
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  otherWorkspace: string,
  bobMember: string;
let oldSnapshot: Awaited<ReturnType<typeof snapshot>>, oldReceipt: unknown;
const principals: Record<string, string> = {};
const subject = (person: string) => 'synthetic-collaboration-' + person;
const session = (person: string): CustomerSession => ({
  subject: subject(person),
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const service = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const invite = (label = 'Synthetic invited teammate', target = workspaceId) => ({
  action: 'invite' as const,
  commandId: randomUUID(),
  workspaceId: target,
  label,
});
const accept = (token: string) => ({ action: 'accept' as const, commandId: randomUUID(), token });
const revoke = (kind: 'invitation' | 'membership', targetId: string, target = workspaceId) => ({
  action: 'revoke' as const,
  commandId: randomUUID(),
  workspaceId: target,
  kind,
  targetId,
});
async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.workspace_invitation) invitations,
 (SELECT count(*)::int FROM customer_private.workspace_member) members,
 (SELECT count(*)::int FROM customer_private.workspace_invitation_acceptance) acceptances,
 (SELECT count(*)::int FROM customer_private.workspace_access_revocation) revocations,
 (SELECT count(*)::int FROM customer_private.workspace_access_request) requests,
 (SELECT count(*)::int FROM app.domain_event) events,
 (SELECT count(*)::int FROM app.audit_event) audits,
 (SELECT count(*)::int FROM app.outbox) outbox,
 (SELECT count(*)::int FROM app.outbox_delivery) deliveries,
 (SELECT count(*)::int FROM app.membership) staff,
 (SELECT count(*)::int FROM customer.membership) initial_members,
 (SELECT count(*)::int FROM customer_private.session_proof) proofs`)
  ).rows[0];
}
async function snapshot(previous?: { tables: { oid: number }[]; functions: { oid: number }[] }) {
  const functions = (
    await f.owner.query(
      `SELECT p.oid,p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('app','identity','customer','customer_private') AND ($1::oid[] IS NULL OR p.oid=ANY($1)) ORDER BY p.oid`,
      [previous?.functions.map((r) => r.oid) ?? null],
    )
  ).rows;
  const tables = (
    await f.owner.query(
      `SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') AND ($1::oid[] IS NULL OR c.oid=ANY($1)) ORDER BY c.oid`,
      [previous?.tables.map((r) => r.oid) ?? null],
    )
  ).rows;
  const records = [];
  for (const row of tables) {
    const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    records.push({
      oid: row.oid,
      digest: (
        await f.owner.query(
          `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) digest FROM ${quote(row.nspname)}.${quote(row.relname)} t`,
        )
      ).rows[0].digest,
    });
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
    coreHistory: (await f.owner.query('SELECT * FROM migrations.applied ORDER BY name')).rows,
  };
}
beforeAll(async () => {
  f = await fixture();
  // Deliberately stage the released module1 in this NEW upgrade test only.
  // The unchanged migration runner and every original fixture continue installing all current files.
  const first = await readFile(
    'packages/db/customer-migrations/0001_synthetic_workspace_authority.sql',
    'utf8',
  );
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(first);
    await db.query('CREATE SCHEMA customer_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE customer_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    await db.query('INSERT INTO customer_migrations.applied(name,sha256) VALUES($1,$2)', [
      '0001_synthetic_workspace_authority.sql',
      createHash('sha256').update(first).digest('hex'),
    ]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
  for (const person of people)
    principals[person] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: subject(person),
        executorId: f.serviceId,
        reason: 'Explicit invented collaboration test identity; no real account or email',
      })
    ).id;
  workspaceId = (
    await service().provision({
      commandId: randomUUID(),
      name: 'Synthetic preserved collaboration workspace',
    })
  ).id;
  otherWorkspace = (
    await service('carol').provision({
      commandId: randomUUID(),
      name: 'Synthetic separate private workspace',
    })
  ).id;
  oldSnapshot = await snapshot();
  oldReceipt = (await f.owner.query('SELECT * FROM customer_migrations.applied')).rows;
  await migrateCustomerAuthority(f.owner);
});
afterAll(async () => {
  await f?.close();
});

test('populated additive collaboration upgrade preserves every old row, function, ACL, policy and migration receipt', async () => {
  expect(await snapshot(oldSnapshot)).toEqual(oldSnapshot);
  expect(
    (
      await f.owner.query(
        "SELECT * FROM customer_migrations.applied WHERE name='0001_synthetic_workspace_authority.sql'",
      )
    ).rows,
  ).toEqual(oldReceipt);
  await migrateCustomerAuthority(f.owner);
  const names = (await readdir('packages/db/customer-migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort();
  const expected = await Promise.all(
    names.map(async (name) => ({
      name,
      sha256: createHash('sha256')
        .update(await readFile('packages/db/customer-migrations/' + name))
        .digest('hex'),
    })),
  );
  expect(
    (await f.owner.query('SELECT name,sha256 FROM customer_migrations.applied ORDER BY name')).rows,
  ).toEqual(expected);
  expect((await f.owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0].n).toBe(
    29,
  );
  expect((await service().list()).map((w) => w.id)).toEqual([workspaceId]);
});

test('first invitation returns one secret; lost-response retry keeps the invitation but cannot recover or rotate its token', async () => {
  const command = invite();
  const before = await counts();
  const issued = await service().access(command);
  expect(issued.token?.length).toBe(43);
  expect(/^[A-Za-z0-9_-]{43}$/.test(issued.token!)).toBe(true);
  expect(issued.issued).toBe(true);
  const retry = await service().access(command);
  expect(retry.invitationId).toBe(issued.invitationId);
  expect(retry.expiresAt).toBe(issued.expiresAt);
  expect(retry.token).toBeNull();
  expect(retry.issued).toBe(false);
  const stored = (
    await f.owner.query(
      'SELECT token_hash,extract(epoch FROM expires_at-created_at) ttl FROM customer_private.workspace_invitation WHERE id=$1',
      [issued.invitationId],
    )
  ).rows[0];
  expect(stored.token_hash === sessionHash(issued.token!)).toBe(true);
  expect(Number(stored.ttl)).toBeGreaterThan(86399);
  expect(Number(stored.ttl)).toBeLessThan(86401);
  const privateRows = (
    await f.owner.query(
      'SELECT to_jsonb(t) record FROM customer_private.workspace_access_request t',
    )
  ).rows;
  const events = (
    await f.owner.query(
      "SELECT payload FROM app.domain_event WHERE aggregate_type='customer_workspace_access'",
    )
  ).rows;
  expect(JSON.stringify([...privateRows, ...events]).includes(issued.token!)).toBe(false);
  const after = await counts();
  for (const key of ['invitations', 'requests', 'events', 'audits', 'outbox', 'deliveries'])
    expect(after[key] - before[key]).toBe(1);
  await expect(
    service().access({ ...command, label: 'Synthetic changed request' }),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(service().access({ ...command, workspaceId: otherWorkspace })).rejects.toMatchObject(
    { code: '42501' },
  );
  await expect(
    service().access({
      ...revoke('invitation', issued.invitationId!),
      commandId: command.commandId,
    }),
  ).rejects.toMatchObject({ code: '23514' });
  expect(await counts()).toEqual(after);
});

test('admitted recipient joins as a member, repeats safely and never receives owner or staff authority', async () => {
  const issued = await service().access(invite());
  const request = accept(issued.token!);
  const before = await counts();
  const joined = await service('bob').access(request);
  bobMember = joined.memberId!;
  expect(joined.workspace).toMatchObject({
    id: workspaceId,
    role: 'member',
    synthetic: true,
    organisationId: null,
  });
  expect((await service('bob').list()).map((w) => ({ id: w.id, role: w.role }))).toEqual([
    { id: workspaceId, role: 'member' },
  ]);
  const after = await counts();
  for (const key of [
    'members',
    'acceptances',
    'requests',
    'events',
    'audits',
    'outbox',
    'deliveries',
  ])
    expect(after[key] - before[key]).toBe(1);
  expect(after.staff).toBe(before.staff);
  expect(after.initial_members).toBe(before.initial_members);
  const repeated = await service('bob').access(request);
  expect(repeated.memberId).toBe(bobMember);
  expect(repeated.workspace).toEqual(joined.workspace);
  expect(await counts()).toEqual(after);
  await expect(service('carol').access(accept(issued.token!))).rejects.toMatchObject({
    code: '42501',
  });
  expect(await counts()).toEqual(after);
  const duplicate = await service('bob').access(accept(issued.token!));
  expect(duplicate.memberId).toBe(bobMember);
  expect((await counts()).members).toBe(after.members);
  expect((await counts()).events).toBe(after.events);
  await expect(
    service('bob').access({
      ...request,
      action: 'invite',
      workspaceId,
      label: 'Synthetic command reuse',
    }),
  ).rejects.toThrow();
});

test('concurrent recipients cannot consume the same token twice', async () => {
  const issued = await service().access(invite('Synthetic single use'));
  const before = await counts();
  const results = await Promise.allSettled([
    service('dave').access(accept(issued.token!)),
    service('eve').access(accept(issued.token!)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason.code === '42501').toBe(true);
  const after = await counts();
  for (const key of [
    'members',
    'acceptances',
    'requests',
    'events',
    'audits',
    'outbox',
    'deliveries',
  ])
    expect(after[key] - before[key]).toBe(1);
});

test('owner cancellation and expiry deny acceptance without erasing invitation history', async () => {
  const issued = await service().access(invite('Synthetic cancelled invitation'));
  const command = revoke('invitation', issued.invitationId!);
  const before = await counts();
  expect((await service().access(command)).status).toBe('cancelled');
  const after = await counts();
  expect(after.revocations - before.revocations).toBe(1);
  expect(after.events - before.events).toBe(1);
  await service().access(command);
  expect(await counts()).toEqual(after);
  await expect(service('bob').access(accept(issued.token!))).rejects.toMatchObject({
    code: '42501',
  });
  expect(await counts()).toEqual(after);
  // An explicitly backdated synthetic fixture exercises the real DB clock without rewriting history.
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  await f.owner.query(
    `INSERT INTO customer_private.workspace_invitation(id,tenant_id,created_by,label,token_hash,created_at,expires_at)
 VALUES($1,$2,$3,'Synthetic historical expiry',$4,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day')`,
    [id, workspaceId, principals.alice, sessionHash(token)],
  );
  const expired = await counts();
  await expect(service('bob').access(accept(token))).rejects.toMatchObject({ code: '42501' });
  expect(await counts()).toEqual(expired);
  const page = await service().listAccess({ workspaceId, pageSize: 100 });
  expect(page.invitations.find((i) => i.id === id)?.status).toBe('expired');
  expect(page.invitations.find((i) => i.id === issued.invitationId)?.status).toBe('cancelled');
});

test('accepted membership survives invitation expiry, but account disablement denies all subsequent authority', async () => {
  const token = randomBytes(32).toString('base64url');
  const invitationId = randomUUID(),
    memberId = randomUUID();
  // Insert an explicitly historical, already accepted synthetic fixture. No history is rewritten.
  await f.owner.query(
    `INSERT INTO customer_private.workspace_invitation(id,tenant_id,created_by,label,token_hash,created_at,expires_at)
 VALUES($1,$2,$3,'Synthetic historical acceptance',$4,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day')`,
    [invitationId, workspaceId, principals.alice, sessionHash(token)],
  );
  await f.owner.query(
    `INSERT INTO customer_private.workspace_member(id,tenant_id,principal_id,source_invitation_id,created_at)
 VALUES($1,$2,$3,$4,clock_timestamp()-interval '2 days')`,
    [memberId, workspaceId, principals.past, invitationId],
  );
  await f.owner.query(
    `INSERT INTO customer_private.workspace_invitation_acceptance(invitation_id,tenant_id,principal_id,member_id,accepted_at)
 VALUES($1,$2,$3,$4,clock_timestamp()-interval '2 days')`,
    [invitationId, workspaceId, principals.past, memberId],
  );
  expect((await service('past').list()).map((w) => w.id)).toEqual([workspaceId]);
  const before = await counts();
  expect((await service('past').access(accept(token))).memberId).toBe(memberId);
  expect((await counts()).events).toBe(before.events);
  expect((await counts()).members).toBe(before.members);
  expect(
    (await service().listAccess({ workspaceId, pageSize: 100 })).invitations.find(
      (i) => i.id === invitationId,
    )?.status,
  ).toBe('accepted');
  await f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE id=$1',
    [principals.past],
  );
  const disabled = await counts();
  await expect(service('past').list()).rejects.toMatchObject({ code: '42501' });
  await expect(service('past').access(accept(token))).rejects.toMatchObject({ code: '42501' });
  await expect(service('past').listAccess({ workspaceId })).rejects.toMatchObject({
    code: '42501',
  });
  expect(await counts()).toEqual(disabled);
  expect(
    (await service().listAccess({ workspaceId, pageSize: 100 })).memberships.find(
      (m) => m.id === memberId,
    )?.status,
  ).toBe('account-disabled');
});

test('revocation removes only the invited grant; old tokens and commands cannot resurrect it, while a new invitation may grant fresh access', async () => {
  const page = await service().listAccess({ workspaceId });
  const original = page.invitations.find((i) => i.memberId === bobMember)!;
  const command = revoke('membership', bobMember);
  const before = await counts();
  await service().access(command);
  const after = await counts();
  expect(after.events - before.events).toBe(1);
  expect(after.revocations - before.revocations).toBe(1);
  await service().access(command);
  expect(await counts()).toEqual(after);
  expect((await service('bob').list()).some((w) => w.id === workspaceId)).toBe(false);
  await expect(service().access(revoke('invitation', original.id))).rejects.toMatchObject({
    code: '23514',
  });
  const fresh = await service().access(invite('Synthetic renewed access'));
  const joined = await service('bob').access(accept(fresh.token!));
  expect(joined.memberId === bobMember).toBe(false);
  expect(joined.workspace?.role).toBe('member');
  const requests = (
    await f.owner.query(
      "SELECT command_id,request FROM customer_private.workspace_access_request WHERE actor_id=$1 AND operation='accept' AND result->>'memberId'=$2",
      [principals.bob, bobMember],
    )
  ).rows;
  for (const previous of requests) {
    await expect(
      raw('bob', 'SELECT customer.workspace_access_command($1,$2,$3)', [
        previous.command_id,
        'accept',
        JSON.stringify(previous.request),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  }
  expect((await service('bob').list()).filter((w) => w.id === workspaceId)).toHaveLength(1);
  const current = await service().listAccess({ workspaceId });
  expect(current.memberships.find((m) => m.id === bobMember)?.status).toBe('revoked');
  expect(current.memberships.find((m) => m.id === joined.memberId)?.status).toBe('active');
});

test('members and other owners cannot administer a workspace, remove its original owner or forge elevated roles', async () => {
  const initial = (
    await f.owner.query('SELECT * FROM customer.membership ORDER BY tenant_id,principal_id')
  ).rows;
  const before = await counts();
  for (const person of ['bob', 'carol']) {
    await expect(service(person).listAccess({ workspaceId })).rejects.toMatchObject({
      code: '42501',
    });
    await expect(service(person).access(invite())).rejects.toMatchObject({ code: '42501' });
    await expect(service(person).access(revoke('membership', bobMember))).rejects.toMatchObject({
      code: '42501',
    });
  }
  await expect(service().access(revoke('membership', principals.alice))).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    service().access(revoke('invitation', randomUUID(), otherWorkspace)),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(service().access({ ...invite(), role: 'owner' })).rejects.toThrow();
  await expect(
    service().access({ ...revoke('membership', bobMember), subject: subject('alice') }),
  ).rejects.toThrow();
  expect(await counts()).toEqual(before);
  expect(
    (await f.owner.query('SELECT * FROM customer.membership ORDER BY tenant_id,principal_id')).rows,
  ).toEqual(initial);
  const own = await service().access(invite('Synthetic self invitation'));
  const ownBefore = await counts();
  await expect(service().access(accept(own.token!))).rejects.toMatchObject({ code: '23514' });
  expect(await counts()).toEqual(ownBefore);
});

test('owner access pages preserve all records and expose no token, provider subject or contact information', async () => {
  const expectedInvites = (
    await f.owner.query(
      'SELECT id FROM customer_private.workspace_invitation WHERE tenant_id=$1 ORDER BY id',
      [workspaceId],
    )
  ).rows.map((r) => r.id);
  const expectedMembers = (
    await f.owner.query(
      'SELECT id FROM customer_private.workspace_member WHERE tenant_id=$1 ORDER BY id',
      [workspaceId],
    )
  ).rows.map((r) => r.id);
  const invites: string[] = [],
    members: string[] = [];
  let invitationAfter: string | undefined, memberAfter: string | undefined;
  do {
    const page = await service().listAccess({ workspaceId, pageSize: 2, invitationAfter });
    expect(page.ownerProtected).toBe(true);
    invites.push(...page.invitations.map((i) => i.id));
    invitationAfter = page.nextInvitationAfter ?? undefined;
    expect(/token|hash|subject|email|principal/i.test(JSON.stringify(page))).toBe(false);
  } while (invitationAfter);
  do {
    const page = await service().listAccess({ workspaceId, pageSize: 2, memberAfter });
    members.push(...page.memberships.map((i) => i.id));
    memberAfter = page.nextMemberAfter ?? undefined;
  } while (memberAfter);
  expect(invites).toEqual(expectedInvites);
  expect(members).toEqual(expectedMembers);
  await expect(service().listAccess({ workspaceId, pageSize: 101 })).rejects.toThrow();
  expect((await service('carol').listAccess({ workspaceId: otherWorkspace })).invitations).toEqual(
    [],
  );
});

test('fresh verification, admission, issuer/subject context and disabled/production gates remain binding', async () => {
  const command = invite();
  const before = await counts();
  for (const [candidate, status] of [
    [null, 401],
    [{ ...session('alice'), emailVerified: false }, 403],
    [{ ...session('alice'), expiresAt: new Date(0) }, 401],
  ] as const) {
    const client = new CustomerWorkspaceService(f.runtime, f.auth, options, async () => candidate);
    await expect(client.access(command, subject('alice'), issuer)).rejects.toMatchObject({
      status,
    });
    await expect(
      client.listAccess({ workspaceId }, subject('alice'), issuer),
    ).rejects.toMatchObject({ status });
  }
  await expect(service().access(command, subject('bob'), issuer)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    service().access(
      command,
      subject('alice'),
      issuer.replace('ep-collaboration-fixture', 'ep-other'),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(service('unadmitted').access(command)).rejects.toMatchObject({ code: '42501' });
  for (const gate of [
    { ...options, enabled: false },
    { ...options, production: true },
    { ...options, synthetic: false },
  ]) {
    const client = new CustomerWorkspaceService(f.runtime, f.auth, gate, async () =>
      session('alice'),
    );
    await expect(client.access(command)).rejects.toMatchObject({ status: 503 });
  }
  expect(await counts()).toEqual(before);
});

test('private tables/helpers and SQL input are protected; customer proof never becomes staff authority', async () => {
  const before = await counts();
  for (const table of [
    'workspace_invitation',
    'workspace_member',
    'workspace_invitation_acceptance',
    'workspace_access_revocation',
    'workspace_access_request',
  ])
    for (const pool of [f.runtime, f.auth])
      await expect(pool.query('SELECT * FROM customer_private.' + table)).rejects.toMatchObject({
        code: '42501',
      });
  for (const pool of [f.runtime, f.auth])
    await expect(
      pool.query('SELECT customer_private.lock_workspace_access($1,$2)', [
        randomUUID(),
        workspaceId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  expect((await raw('bob', 'SELECT app.actor_id() actor')).rows[0].actor).toBeNull();
  await expect(
    raw('alice', 'SELECT customer.workspace_access_command($1,$2,$3)', [
      randomUUID(),
      'invite',
      JSON.stringify({
        workspaceId,
        label: 'Synthetic SQL role forgery',
        tokenHash: sessionHash('not-a-live-token'),
        role: 'owner',
      }),
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    raw('alice', 'SELECT customer.workspace_access_command($1,$2,$3)', [
      randomUUID(),
      'revoke',
      JSON.stringify({ workspaceId: otherWorkspace, kind: 'membership', targetId: bobMember }),
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  expect(await counts()).toEqual(before);
  const linked = (
    await f.owner.query(
      'SELECT id FROM customer_private.workspace_invitation WHERE tenant_id=$1 LIMIT 1',
      [workspaceId],
    )
  ).rows[0].id;
  await expect(
    f.owner.query(
      'INSERT INTO customer_private.workspace_member(tenant_id,principal_id,source_invitation_id) VALUES($1,$2,$3)',
      [otherWorkspace, principals.carol, linked],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    f.owner.query('UPDATE customer_private.workspace_invitation SET label=label WHERE id=$1', [
      linked,
    ]),
  ).rejects.toThrow();
  expect(await counts()).toEqual(before);
});

test('acceptance and cancellation serialize so a token is never both accepted and cancelled', async () => {
  const issued = await service().access(invite('Synthetic acceptance cancellation race'));
  const before = await counts();
  const results = await Promise.allSettled([
    service().access(revoke('invitation', issued.invitationId!)),
    service('bob').access(accept(issued.token!)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const state = (
    await f.owner.query(
      `SELECT EXISTS(SELECT FROM customer_private.workspace_invitation_acceptance WHERE invitation_id=$1) accepted,
 EXISTS(SELECT FROM customer_private.workspace_access_revocation WHERE invitation_id=$1) cancelled`,
      [issued.invitationId],
    )
  ).rows[0];
  expect(Number(state.accepted) + Number(state.cancelled)).toBe(1);
  expect((await counts()).events - before.events).toBe(1);
});

test('a proof that expires while waiting for the workspace lock cannot perform the command', async () => {
  const blocker = await f.owner.connect();
  await blocker.query('BEGIN');
  await blocker.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||$1,0))",
    [workspaceId],
  );
  const before = await counts();
  let pid = 0;
  const pending = raw(
    'alice',
    'SELECT customer.workspace_access_command($1,$2,$3)',
    [
      randomUUID(),
      'invite',
      JSON.stringify({
        workspaceId,
        label: 'Synthetic expired waiting proof',
        tokenHash: sessionHash(randomBytes(32).toString('hex')),
      }),
    ],
    2000,
    (p) => {
      pid = p;
    },
  ).then(
    () => ({ code: 'unexpected-success' }),
    (error) => error,
  );
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      if (pid)
        waiting = !!(
          await f.owner.query(
            "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",
            [pid],
          )
        ).rowCount;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await f.owner.query('SELECT pg_sleep(2.1)');
  } finally {
    await blocker.query('COMMIT');
    blocker.release();
  }
  expect((await pending).code).toBe('42501');
  expect(await counts()).toEqual(before);
});

async function raw(
  person: string,
  sql: string,
  args: unknown[] = [],
  ttl = 25000,
  onPid?: (pid: number) => void,
) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+$4::double precision*interval '1 millisecond')",
    [hash, issuer, subject(person), ttl],
  );
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_hash','',true),set_config('corridra.tenant_id',$2,true)",
      [hash, workspaceId],
    );
    if (onPid) onPid((await db.query('SELECT pg_backend_pid() pid')).rows[0].pid);
    const result = await db.query(sql, args);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}
