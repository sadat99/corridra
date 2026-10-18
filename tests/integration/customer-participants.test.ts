import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { fixture, rawContext } from './support';
import { sessionHash } from '../../packages/db/src/index';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammes } from '../../packages/db/src/customer-programme-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import {
  CustomerParticipantService,
  customerParticipantsEnabled,
} from '../../packages/auth/src/customer-participants';
const issuer =
  'https://ep-participant-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  programmeId: string,
  bobWorkspace: string,
  bobProgramme: string;
let preserved = false;
const session = (person = 'alice') => ({
  subject: 'synthetic-participant-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const service = (person = 'alice') =>
  new CustomerParticipantService(f.runtime, f.auth, options, async () => session(person));
const workspace = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const programmes = (person = 'alice') =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const invite = (programme = programmeId, target = workspaceId) => ({
  action: 'invite',
  commandId: randomUUID(),
  workspaceId: target,
  programmeId: programme,
  label: 'Synthetic participant invitation',
  acknowledged: true,
});
const accept = (token: string, programme = programmeId, label = 'Synthetic participant Bob') => ({
  action: 'accept',
  commandId: randomUUID(),
  programmeId: programme,
  token,
  displayLabel: label,
  consented: true,
});
const revoke = (id: string, kind = 'invitation') => ({
  action: 'revoke',
  commandId: randomUUID(),
  workspaceId,
  programmeId,
  kind,
  targetId: id,
  reason: 'Synthetic programme access cancellation',
  acknowledged: true,
});
async function snapshot() {
  const functions = (
    await f.owner.query(
      "SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid",
    )
  ).rows;
  const policies = (
    await f.owner.query(
      "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
    )
  ).rows;
  const tables = (
    await f.owner.query(
      "SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY c.oid",
    )
  ).rows;
  const rows: Record<string, string> = {};
  for (const t of tables) {
    const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    rows[t.oid] = (
      await f.owner.query(
        "SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text)::text,'')) digest FROM " +
          quote(t.nspname) +
          '.' +
          quote(t.relname) +
          ' v',
      )
    ).rows[0].digest;
  }
  const receipts: Record<string, unknown> = {};
  for (const schema of [
    'migrations',
    'customer_migrations',
    'customer_commercial_migrations',
    'customer_company_migrations',
    'customer_decision_migrations',
    'customer_delivery_migrations',
    'customer_programme_migrations',
  ])
    receipts[schema] = (
      await f.owner.query('SELECT * FROM ' + schema + '.applied ORDER BY name')
    ).rows;
  return { functions, policies, tables, rows, receipts };
}
async function raw(hash: string, sql: string, args: unknown[] = []) {
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    const r = await db.query(sql, args);
    await db.query('COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
async function proof(person: string, work: (hash: string) => Promise<unknown>, ms = 25000) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+$4*interval '1 millisecond')",
    [hash, issuer, session(person).subject, ms],
  );
  try {
    return await work(hash);
  } finally {
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerCompanies(f.owner);
  await migrateCustomerDecisions(f.owner);
  await migrateCustomerDelivery(f.owner);
  await migrateCustomerProgrammes(f.owner);
  for (const person of ['alice', 'bob', 'charlie', 'dana', 'member', 'admin'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(person).subject,
      executorId: f.serviceId,
      reason: 'Explicit fictional participant authority fixture,no real customer account',
    });
  workspaceId = (
    await workspace().provision({ commandId: randomUUID(), name: 'Synthetic organiser workspace' })
  ).id;
  bobWorkspace = (
    await workspace('bob').provision({
      commandId: randomUUID(),
      name: 'Synthetic participant own workspace',
    })
  ).id;
  programmeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic organiser programme',
      reportingPurpose: 'Synthetic participant privacy and independent account acceptance',
      acknowledged: true,
    })
  ).id;
  bobProgramme = (
    await programmes('bob').create({
      commandId: randomUUID(),
      workspaceId: bobWorkspace,
      name: 'Synthetic other programme',
      reportingPurpose: 'Synthetic separate organiser and participant authority',
      acknowledged: true,
    })
  ).id;
  const wi = await workspace().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic existing colleague',
  });
  await workspace('member').access({ action: 'accept', commandId: randomUUID(), token: wi.token });
  await f.owner.query(
    "INSERT INTO customer.membership(tenant_id,principal_id,role) SELECT $1,id,'admin' FROM customer_private.principal WHERE issuer=$2 AND subject=$3",
    [workspaceId, issuer, session('admin').subject],
  );
  const before = await snapshot();
  await migrateCustomerParticipants(f.owner);
  const after = await snapshot();
  for (const fn of before.functions)
    expect(after.functions.find((p) => p.name === fn.name)).toEqual(fn);
  expect(after.policies).toEqual(before.policies);
  expect(after.tables.filter((t) => before.tables.some((b) => b.oid === t.oid))).toEqual(
    before.tables,
  );
  for (const t of before.tables) expect(after.rows[t.oid]).toBe(before.rows[t.oid]);
  expect(after.receipts).toEqual(before.receipts);
  preserved = true;
});
afterAll(async () => {
  await f?.close();
});
test('optional participant installation preserves every populated current function,ACL,RLS,row and receipt and is repeatable', async () => {
  expect(preserved).toBe(true);
  await migrateCustomerParticipants(f.owner);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_participant_migrations.applied'))
      .rows[0].n,
  ).toBe(1);
});
test('current owner/admin issue a code once;concurrent exact retries reveal no recovered secret or duplicate events', async () => {
  const input = invite();
  const results = await Promise.all([service().command(input), service().command(input)]);
  expect(results[0].id).toBe(results[1].id);
  expect(results.filter((r) => r.token)).toHaveLength(1);
  expect(results.find((r) => r.token).token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const stored = (
    await f.owner.query('SELECT * FROM customer_private.programme_invitation WHERE id=$1', [
      results[0].id,
    ])
  ).rows[0];
  expect(stored.token_hash).toBe(sessionHash(results.find((r) => r.token).token));
  expect(JSON.stringify(stored)).not.toContain(results.find((r) => r.token).token);
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.domain_event WHERE correlation_id=$1 AND type='customer.programme.invite'",
        [input.commandId],
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    service().command({ ...input, label: 'Synthetic conflicting label' }),
  ).rejects.toThrow('conflicts');
  const admin = await service('admin').command(invite());
  expect(admin.token).toBeTruthy();
});
test('colleagues,foreign workspaces,unknown identities,anonymous and unverified providers cannot administer registrations', async () => {
  for (const person of ['member', 'bob', 'unknown']) {
    await expect(service(person).command(invite())).rejects.toThrow();
    await expect(service(person).list({ workspaceId, programmeId })).rejects.toThrow();
  }
  await expect(service().command(invite(bobProgramme, workspaceId))).rejects.toThrow();
  for (const read of [async () => null, async () => ({ ...session(), emailVerified: false })])
    await expect(
      new CustomerParticipantService(f.runtime, f.auth, options, read).command(invite()),
    ).rejects.toThrow();
  await expect(
    new CustomerParticipantService(f.runtime, f.auth, options, async () => {
      throw Error('Provider unavailable');
    }).command(invite()),
  ).rejects.toThrow('Customer identity is unavailable');
});
test('participant previews only the invited programme and explicitly registers without workspace or staff access', async () => {
  const invitation = await service().command(invite());
  const preview = await service('bob').preview({ token: invitation.token });
  expect(preview).toMatchObject({
    programmeId,
    name: 'Synthetic organiser programme',
    synthetic: true,
  });
  expect(Object.keys(preview).sort()).toEqual([
    'expiresAt',
    'name',
    'programmeId',
    'reportingPurpose',
    'synthetic',
  ]);
  const input = accept(invitation.token);
  const [a, b] = await Promise.all([service('bob').command(input), service('bob').command(input)]);
  expect(a).toEqual(b);
  expect(a.status).toBe('REGISTERED');
  expect((await workspace('bob').list()).some((w) => w.id === workspaceId)).toBe(false);
  await expect(programmes('bob').list({ workspaceId })).rejects.toThrow();
  await expect(service('bob').list({ workspaceId, programmeId })).rejects.toThrow();
  await expect(
    service('charlie').command(accept(invitation.token, programmeId, 'Synthetic other person')),
  ).rejects.toThrow('unavailable');
  const owner = await service().list({ workspaceId, programmeId });
  expect(owner.registrations.find((r: { id: string }) => r.id === a.id)).toMatchObject({
    displayLabel: 'Synthetic participant Bob',
    status: 'REGISTERED',
  });
  expect(JSON.stringify(owner)).not.toMatch(
    /token_hash|principal_id|subject|email|mission|quotation|contract|payment/,
  );
  const own = await service('bob').own();
  expect(own.registrations.find((r: { id: string }) => r.id === a.id)).toMatchObject({
    name: 'Synthetic organiser programme',
    displayLabel: 'Synthetic participant Bob',
  });
  expect((await service('charlie').own()).registrations).toEqual([]);
});
test('missing consent,extra authority fields,wrong programme and unknown codes fail without registering', async () => {
  const i = await service().command(invite());
  for (const value of [
    { ...accept(i.token), consented: false },
    { ...accept(i.token), workspaceId },
    { ...accept(i.token), programmeId: bobProgramme },
    { ...accept(i.token), token: randomBytes(32).toString('base64url') },
  ])
    await expect(service('charlie').command(value)).rejects.toThrow();
  expect((await service('charlie').own()).registrations).toEqual([]);
  await expect(service().command({ ...invite(), acknowledged: false })).rejects.toThrow();
});
test('registration is independent of invitation revocation,but registration revocation clears the granted view and denies stale accepts', async () => {
  const i = await service().command(invite());
  const v = accept(i.token, programmeId, 'Synthetic participant Charlie');
  const registered = await service('charlie').command(v);
  await service().command(revoke(i.id));
  await expect(service('charlie').preview({ token: i.token })).rejects.toThrow('unavailable');
  expect(
    (await service('charlie').own()).registrations.find(
      (r: { id: string }) => r.id === registered.id,
    ),
  ).toHaveProperty('name');
  await service().command(revoke(registered.id, 'registration'));
  const record = (await service('charlie').own()).registrations.find(
    (r: { id: string }) => r.id === registered.id,
  );
  expect(record).toEqual({ id: registered.id, programmeId, status: 'REVOKED', synthetic: true });
  await expect(service('charlie').command(v)).rejects.toThrow('unavailable');
});
test('participant can withdraw their own consented registration only,and an old or new code cannot silently re-enrol it', async () => {
  const i = await service().command(invite());
  const registered = await service('dana').command(
    accept(i.token, programmeId, 'Synthetic participant Dana'),
  );
  const withdrawal = {
    action: 'withdraw',
    commandId: randomUUID(),
    registrationId: registered.id,
    reason: 'Synthetic participant chooses to withdraw',
    acknowledged: true,
  };
  await expect(service('bob').command(withdrawal)).rejects.toThrow('unavailable');
  const [a, b] = await Promise.all([
    service('dana').command(withdrawal),
    service('dana').command(withdrawal),
  ]);
  expect(a).toEqual(b);
  expect(a.status).toBe('WITHDRAWN');
  const ownerResult = await service().command(revoke(registered.id, 'registration'));
  expect(ownerResult.status).toBe('WITHDRAWN');
  const fresh = await service().command(invite());
  await expect(
    service('dana').command(accept(fresh.token, programmeId, 'Synthetic participant Dana')),
  ).rejects.toThrow('unavailable');
});
test('runtime and auth cannot mint/read private invitations or registrations,call helpers or forge a staff authority', async () => {
  for (const role of [f.runtime, f.auth])
    for (const table of [
      'programme_invitation',
      'programme_registration',
      'programme_participant_revocation',
      'programme_participant_command',
    ])
      await expect(role.query('SELECT * FROM customer_private.' + table)).rejects.toThrow(
        'permission',
      );
  await expect(
    f.runtime.query('SELECT customer_private.participant_scope($1,$2,$3,false)', [
      randomUUID(),
      workspaceId,
      programmeId,
    ]),
  ).rejects.toThrow('permission');
  const actor = await proof('bob', async (hash) => raw(hash, 'SELECT app.actor_id() id'));
  expect((actor as { rows: { id: null }[] }).rows[0].id).toBeNull();
  for (const name of [
    'programme_invitation',
    'programme_registration',
    'programme_participant_revocation',
    'programme_participant_command',
  ])
    await expect(f.owner.query('DELETE FROM customer_private.' + name)).rejects.toThrow(
      'Immutable',
    );
});
test('new commands append exactly one genuine service/customer domain event,audit,outbox and delivery atomically', async () => {
  const input = invite();
  const created = await service().command(input);
  const e = (
    await f.owner.query('SELECT * FROM app.domain_event WHERE correlation_id=$1', [input.commandId])
  ).rows;
  expect(e).toHaveLength(1);
  expect(e[0].actor_id).toBe(f.serviceId);
  expect(e[0].payload).toMatchObject({
    programme_id: programmeId,
    resource_id: created.id,
    initiator_kind: 'customer',
    synthetic: true,
  });
  expect(JSON.stringify(e)).not.toContain(created.token);
  for (const [table, key] of [
    ['audit_event', 'domain_event_id'],
    ['outbox', 'event_id'],
    ['outbox_delivery', 'event_id'],
  ])
    expect(
      (
        await f.owner.query('SELECT count(*)::int n FROM app.' + table + ' WHERE ' + key + '=$1', [
          e[0].id,
        ])
      ).rows[0].n,
    ).toBe(1);
});
test('participant and invitation paging are independently bounded,read-only and creator-scoped', async () => {
  const before = (await f.owner.query('SELECT count(*)::int n FROM app.domain_event')).rows[0].n;
  const first = await service().list({ workspaceId, programmeId, pageSize: 1 });
  expect(first.invitations).toHaveLength(1);
  expect(first.nextInvitationAfter).toBe(first.invitations[0].id);
  const next = await service().list({
    workspaceId,
    programmeId,
    pageSize: 1,
    invitationAfter: first.nextInvitationAfter,
  });
  expect(next.invitations[0].id).not.toBe(first.invitations[0].id);
  await expect(service().list({ workspaceId, programmeId, pageSize: 26 })).rejects.toThrow();
  expect((await f.owner.query('SELECT count(*)::int n FROM app.domain_event')).rows[0].n).toBe(
    before,
  );
  const own = await service('bob').own({ pageSize: 1 });
  expect(own.registrations).toHaveLength(1);
  expect(Object.keys(own.registrations[0])).not.toContain('principalId');
});
test('proof expiry after a workspace lock wait creates no invitation,receipt or events', async () => {
  const lock = await f.owner.connect();
  await lock.query('BEGIN');
  await lock.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||$1,0))",
    [workspaceId],
  );
  const command = randomUUID(),
    payload = {
      workspaceId,
      programmeId,
      label: 'Synthetic expired command',
      tokenHash: sessionHash('synthetic-unissued-token'),
      acknowledged: true,
    };
  let failure: unknown;
  try {
    const pending = proof(
      'alice',
      (hash) =>
        raw(hash, "SELECT customer.programme_participant_command($1,'invite',$2)", [
          command,
          JSON.stringify(payload),
        ]),
      150,
    ).catch((e) => {
      failure = e;
    });
    await new Promise((r) => setTimeout(r, 250));
    await lock.query('COMMIT');
    await pending;
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  expect(String(failure)).toMatch(/expired|denied|unavailable/);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_participant_command WHERE command_id=$1',
        [command],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.domain_event WHERE correlation_id=$1', [
        command,
      ])
    ).rows[0].n,
  ).toBe(0);
});
test('feature cannot activate outside all independent programme/workspace synthetic gates', () => {
  const enabled = {
    VERCEL_ENV: 'preview',
    DATA_ENVIRONMENT: 'synthetic',
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
  };
  expect(customerParticipantsEnabled(enabled)).toBe(true);
  for (const flag of [
    'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
    'CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED',
    'CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED',
  ])
    expect(customerParticipantsEnabled({ ...enabled, [flag]: 'false' })).toBe(false);
  expect(customerParticipantsEnabled({ ...enabled, DATA_ENVIRONMENT: 'real' })).toBe(false);
  expect(customerParticipantsEnabled({})).toBe(false);
  expect(customerParticipantsEnabled({ CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true' })).toBe(
    false,
  );
  for (const production of ['production'])
    expect(
      customerParticipantsEnabled({
        VERCEL_ENV: production,
        DATA_ENVIRONMENT: 'synthetic',
        CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
        CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
        CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
      }),
    ).toBe(false);
});
test('existing tenant owners still cannot read these private registrations through original staff RLS', async () => {
  for (const user of [f.users.owner, f.users.operator, f.users.viewer])
    await expect(
      rawContext(f.runtime, user.ctx, 'SELECT * FROM customer_private.programme_registration'),
    ).rejects.toThrow('permission');
});

test('invitation expiry after waiting for workspace lock denies acceptance without a receipt or registration', async () => {
  const token = randomBytes(32).toString('base64url'),
    command = randomUUID();
  const principal = (
    await f.owner.query('SELECT id FROM customer_private.principal WHERE subject=$1', [
      session().subject,
    ])
  ).rows[0].id;
  const lock = await f.owner.connect();
  await lock.query('BEGIN');
  await lock.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||$1,0))",
    [workspaceId],
  );
  await f.owner.query(
    "INSERT INTO customer_private.programme_invitation(workspace_id,programme_id,created_by,label,token_hash,created_at,expires_at) VALUES($1,$2,$3,'Synthetic expiring invitation',$4,clock_timestamp()-interval '1 second',clock_timestamp()+interval '300 milliseconds')",
    [workspaceId, programmeId, principal, sessionHash(token)],
  );
  let failure: unknown;
  try {
    const pending = service('member')
      .command({ ...accept(token, programmeId, 'Synthetic invited colleague'), commandId: command })
      .catch((e) => {
        failure = e;
      });
    await new Promise((r) => setTimeout(r, 450));
    await lock.query('COMMIT');
    await pending;
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  expect(String(failure)).toContain('unavailable');
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_participant_command WHERE command_id=$1',
        [command],
      )
    ).rows[0].n,
  ).toBe(0);
  await expect(service('member').preview({ token })).rejects.toThrow('unavailable');
});
test('proof expiry while a real event insert waits rolls back invitation,event,audit,outbox and command', async () => {
  const lock = await f.owner.connect();
  await lock.query('BEGIN');
  await lock.query('LOCK TABLE app.domain_event IN SHARE MODE');
  const command = randomUUID(),
    hash = sessionHash('synthetic-late-event-' + command);
  let failure: unknown;
  try {
    const pending = proof(
      'alice',
      (h) =>
        raw(h, "SELECT customer.programme_participant_command($1,'invite',$2)", [
          command,
          JSON.stringify({
            workspaceId,
            programmeId,
            label: 'Synthetic late event invitation',
            tokenHash: hash,
            acknowledged: true,
          }),
        ]),
      150,
    ).catch((e) => {
      failure = e;
    });
    await new Promise((r) => setTimeout(r, 300));
    await lock.query('COMMIT');
    await pending;
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  expect(String(failure)).toMatch(/expired|denied|unavailable/);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_invitation WHERE token_hash=$1',
        [hash],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.domain_event WHERE correlation_id=$1', [
        command,
      ])
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_participant_command WHERE command_id=$1',
        [command],
      )
    ).rows[0].n,
  ).toBe(0);
});
test('revocation committed while acceptance waits is authoritative rather than a stale invitation read', async () => {
  const invitation = await service().command(invite());
  await proof('alice', async (hash) => {
    const db = await f.runtime.connect();
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    await db.query("SELECT customer.programme_participant_command($1,'revoke',$2)", [
      randomUUID(),
      JSON.stringify({
        workspaceId,
        programmeId,
        kind: 'invitation',
        targetId: invitation.id,
        reason: 'Synthetic concurrent invitation revocation',
        acknowledged: true,
      }),
    ]);
    let failure: unknown;
    try {
      const pending = service('member')
        .command(accept(invitation.token, programmeId, 'Synthetic waiting member'))
        .catch((e) => {
          failure = e;
        });
      await new Promise((r) => setTimeout(r, 100));
      await db.query('COMMIT');
      await pending;
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
    expect(String(failure)).toContain('unavailable');
  });
});
test('own registered view serializes with programme revocation and does not expose revoked metadata after the wait', async () => {
  const invitation = await service('bob').command(invite(bobProgramme, bobWorkspace));
  const registered = await service('member').command(
    accept(invitation.token, bobProgramme, 'Synthetic private participant'),
  );
  await proof('bob', async (hash) => {
    const db = await f.runtime.connect();
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    await db.query("SELECT customer.programme_participant_command($1,'revoke',$2)", [
      randomUUID(),
      JSON.stringify({
        workspaceId: bobWorkspace,
        programmeId: bobProgramme,
        kind: 'registration',
        targetId: registered.id,
        reason: 'Synthetic concurrent registration revocation',
        acknowledged: true,
      }),
    ]);
    let result: Awaited<ReturnType<CustomerParticipantService['own']>>;
    try {
      const pending = service('member').own();
      await new Promise((r) => setTimeout(r, 100));
      await db.query('COMMIT');
      result = await pending;
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
    expect(result.registrations.find((r: { id: string }) => r.id === registered.id)).toEqual({
      id: registered.id,
      programmeId: bobProgramme,
      status: 'REVOKED',
      synthetic: true,
    });
  });
});
test('an existing registered user cannot reuse another customer consumed invitation to bypass its single-use boundary', async () => {
  const consumed = await service('bob').command(invite(bobProgramme, bobWorkspace));
  await service('alice').command(
    accept(consumed.token, bobProgramme, 'Synthetic organiser participant'),
  );
  const other = await service('bob').command(invite(bobProgramme, bobWorkspace));
  await service('charlie').command(
    accept(other.token, bobProgramme, 'Synthetic second participant'),
  );
  await expect(
    service('charlie').command(
      accept(consumed.token, bobProgramme, 'Synthetic second participant'),
    ),
  ).rejects.toThrow('unavailable');
});
test('installer rejects changed or unknown participant migration history without changing canonical records', async () => {
  const original = (await f.owner.query('SELECT * FROM customer_participant_migrations.applied'))
    .rows[0];
  await f.owner.query(
    'UPDATE customer_participant_migrations.applied SET sha256=$1 WHERE name=$2',
    ['0'.repeat(64), original.name],
  );
  try {
    await expect(migrateCustomerParticipants(f.owner)).rejects.toThrow('history mismatch');
  } finally {
    await f.owner.query(
      'UPDATE customer_participant_migrations.applied SET sha256=$1 WHERE name=$2',
      [original.sha256, original.name],
    );
  }
  await f.owner.query(
    'INSERT INTO customer_participant_migrations.applied(name,sha256) VALUES($1,$2)',
    ['9999_unknown.sql', '0'.repeat(64)],
  );
  try {
    await expect(migrateCustomerParticipants(f.owner)).rejects.toThrow('history mismatch');
  } finally {
    await f.owner.query('DELETE FROM customer_participant_migrations.applied WHERE name=$1', [
      '9999_unknown.sql',
    ]);
  }
  await migrateCustomerParticipants(f.owner);
});
