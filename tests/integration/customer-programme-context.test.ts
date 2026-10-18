import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammeContext } from '../../packages/db/src/customer-programme-context-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import {
  CustomerProgrammeContextService,
  customerProgrammeContextInput,
} from '../../packages/auth/src/customer-programme-context';
const issuer = 'https://ep-context-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  programmeId: string,
  registrationId: string;
const session = (person = 'alice') => ({
  subject: 'synthetic-context-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const service = (person = 'alice') =>
  new CustomerProgrammeContextService(f.runtime, f.auth, options, async () => session(person));
const participants = (person = 'alice') =>
  new CustomerParticipantService(f.runtime, f.auth, options, async () => session(person));
const input = (expectedVersion = 0) => ({
  commandId: randomUUID(),
  workspaceId,
  programmeId,
  expectedVersion,
  organiser: 'Synthetic organiser',
  marketCode: 'EU',
  purpose: 'Synthetic factory programme',
  startsAt: '2026-12-01T09:00:00+06:00',
  endsAt: '2026-12-03T17:00:00+06:00',
  timezone: 'Asia/Dhaka',
  reason: 'Initial synthetic planning',
  shared: true,
  acknowledged: true,
});
async function definitions() {
  return (
    await f.owner.query(
      "SELECT oid::regprocedure::text name,pg_get_functiondef(oid) definition,proacl,proowner,proconfig,prosecdef,provolatile FROM pg_proc WHERE oid IN ('app.guard_delivery_experience()'::regprocedure,'app.record_change()'::regprocedure,'app.delivery_guard()'::regprocedure) ORDER BY name",
    )
  ).rows;
}
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerParticipants(f.owner);
  for (const person of ['alice', 'bob', 'outsider'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(person).subject,
      executorId: f.serviceId,
      reason: 'Explicit fictional programme context test only',
    });
  workspaceId = (
    await new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session()).provision(
      { commandId: randomUUID(), name: 'Synthetic context workspace' },
    )
  ).id;
  programmeId = (
    await new CustomerProgrammeService(f.runtime, f.auth, options, async () => session()).create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic context programme',
      reportingPurpose: 'Synthetic participant planning test only',
      acknowledged: true,
    })
  ).id;
  const before = await definitions();
  const policies = (
    await f.owner.query('SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname')
  ).rows;
  await migrateCustomerProgrammeContext(f.owner);
  await migrateCustomerProgrammeContext(f.owner);
  const after = await definitions();
  for (let i = 0; i < before.length; i++) {
    expect({ ...after[i], definition: before[i].definition }).toEqual(before[i]);
    if (before[i].name === 'app.delivery_guard()')
      expect(after[i].definition).toEqual(before[i].definition);
    else
      expect(after[i].definition).toContain(
        before[i].definition.slice(
          before[i].definition.indexOf(' IF ', before[i].definition.indexOf('BEGIN')),
        ),
      );
  }
  expect(
    (await f.owner.query('SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname'))
      .rows,
  ).toEqual(policies);
  const invitation = await participants().command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    label: 'Synthetic participant invitation',
    acknowledged: true,
  });
  const accepted = await participants('bob').command({
    action: 'accept',
    commandId: randomUUID(),
    programmeId,
    token: invitation.token,
    displayLabel: 'Synthetic participant Bob',
    consented: true,
  });
  registrationId = accepted.id;
}, 60000);
afterAll(async () => {
  await Promise.all([f.owner.end(), f.runtime.end(), f.auth.end()]);
});
test('canonical context, real customer responsibility and service event attribution', async () => {
  const v = input();
  const result = await service().command(v);
  expect(result.currentVersion).toBe(1);
  expect(result.context.marketCode).toBe('EU');
  expect(result.context.timezone).toBe('Asia/Dhaka');
  const rows = (
    await f.owner.query('SELECT * FROM app.delivery_programme_context WHERE programme_id=$1', [
      programmeId,
    ])
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].details.ownerKind).toBe('CUSTOMER');
  expect(rows[0].created_by).toBe(f.serviceId);
  expect(rows[0].details.ownerId).not.toBe(f.serviceId);
  const events = (
    await f.owner.query(
      "SELECT e.*,a.actor_id audit_actor,o.event_id outbox_event FROM app.domain_event e JOIN app.audit_event a ON a.domain_event_id=e.id JOIN app.outbox o ON o.event_id=e.id WHERE e.aggregate_type='delivery_programme_context' AND e.aggregate_id=$1",
      [rows[0].id],
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(events[0].actor_id).toBe(f.serviceId);
  expect(events[0].payload.initiator_id).toBe(rows[0].details.ownerId);
  expect(events[0].payload.authority).toBe('customer_programme_context');
  expect(events[0].payload).not.toHaveProperty('purpose');
  expect(
    (await f.owner.query('SELECT * FROM customer_private.context_execution_grant')).rowCount,
  ).toBe(0);
  expect(await service().command(v)).toEqual(expect.objectContaining({ currentVersion: 1 }));
  await expect(
    service().command({ ...v, purpose: 'Synthetic changed retry' }),
  ).rejects.toHaveProperty('code', '23514');
});
test('only exact active registered participant sees positive allowlist', async () => {
  const result = await service('bob').view({ registrationId });
  expect(result.context.version).toBe(1);
  expect(result).not.toHaveProperty('workspaceId');
  expect(result).not.toHaveProperty('reason');
  expect(JSON.stringify(result)).not.toMatch(/ownerId|created_by|executorId|tenant_id/);
  await expect(service('outsider').view({ registrationId })).rejects.toHaveProperty(
    'code',
    '42501',
  );
  await expect(service('bob').view({ workspaceId, programmeId })).rejects.toHaveProperty(
    'code',
    '42501',
  );
  await expect(service('bob').command(input(1))).rejects.toHaveProperty('code', '42501');
});
test('optimistic concurrency, unsharing and superseded retries preserve original versions', async () => {
  const old = (
    await f.owner.query(
      'SELECT to_jsonb(c) value FROM app.delivery_programme_context c WHERE programme_id=$1',
      [programmeId],
    )
  ).rows[0].value;
  const a = input(1),
    b = input(1);
  a.shared = false;
  b.shared = false;
  const settled = await Promise.allSettled([service().command(a), service().command(b)]);
  expect(settled.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect(settled.filter((x) => x.status === 'rejected')).toHaveLength(1);
  expect((await service('bob').view({ registrationId })).context).toBeNull();
  expect(
    (
      await f.owner.query(
        'SELECT to_jsonb(c) value FROM app.delivery_programme_context c WHERE id=$1',
        [old.id],
      )
    ).rows[0].value,
  ).toEqual(old);
  await expect(service().command(input(0))).rejects.toHaveProperty('code', '23514');
});
test('strict fields, valid market/timezone and finite ordered dates are enforced in backend', async () => {
  expect(
    customerProgrammeContextInput.safeParse({ ...input(2), ownerId: randomUUID() }).success,
  ).toBe(false);
  expect(
    customerProgrammeContextInput.safeParse({ ...input(2), endsAt: input().startsAt }).success,
  ).toBe(false);
  await expect(service().command({ ...input(2), marketCode: 'XX' })).rejects.toBeDefined();
  await expect(service().command({ ...input(2), timezone: 'Fake/Zone' })).rejects.toBeDefined();
  expect((await service().view({ workspaceId, programmeId })).currentVersion).toBe(2);
});
test('direct canonical writes and forged settings cannot bypass staff scope', async () => {
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_context_execution','forged',true)");
    await expect(
      db.query(
        'INSERT INTO app.delivery_programme_context(id,tenant_id,programme_id,version,details,created_by) VALUES($1,$2,$3,3,$4,$5)',
        [
          randomUUID(),
          workspaceId,
          programmeId,
          { ...input(), ownerKind: 'CUSTOMER' },
          f.serviceId,
        ],
      ),
    ).rejects.toHaveProperty('code', '42501');
    await db.query('ROLLBACK');
    await expect(
      db.query('SELECT customer_private.context_execution_context($1,$2)', [
        'app.delivery_programme_context',
        {},
      ]),
    ).rejects.toBeDefined();
  } finally {
    db.release();
  }
});
test('registration revocation removes shared context access', async () => {
  await service().command(input(2));
  expect((await service('bob').view({ registrationId })).context.version).toBe(3);
  await participants().command({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    kind: 'registration',
    targetId: registrationId,
    reason: 'Synthetic cancellation test',
    acknowledged: true,
  });
  await expect(service('bob').view({ registrationId })).rejects.toHaveProperty('code', '42501');
  expect((await service().view({ workspaceId, programmeId })).currentVersion).toBe(3);
});
test('proof expiry after the canonical programme lock wait leaves no context or events', async () => {
  const { sessionHash } = await import('../../packages/db/src/index');
  const hash = sessionHash(randomUUID());
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '500 milliseconds')",
    [hash, issuer, session().subject],
  );
  const lock = await f.owner.connect(),
    db = await f.runtime.connect();
  const command = randomUUID();
  try {
    await lock.query('BEGIN');
    await lock.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text||':programme:'||$2::text,0))",
      [workspaceId, programmeId],
    );
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    const v = input(3);
    const { organiser, marketCode, purpose, startsAt, endsAt, timezone, reason } = v;
    const pending = db.query('SELECT customer.programme_context_command($1,$2,$3,$4,$5,$6)', [
      command,
      workspaceId,
      programmeId,
      3,
      { organiser, marketCode, purpose, startsAt, endsAt, timezone, reason },
      true,
    ]);
    const denied = expect(pending).rejects.toHaveProperty('code', '42501');
    await lock.query('SELECT pg_sleep(0.7)');
    await lock.query('COMMIT');
    await denied;
  } finally {
    await db.query('ROLLBACK');
    await lock.query('ROLLBACK');
    db.release();
    lock.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
  expect(
    (
      await f.owner.query(
        'SELECT * FROM customer_private.programme_context_command WHERE command_id=$1',
        [command],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (await f.owner.query('SELECT * FROM app.domain_event WHERE correlation_id=$1', [command]))
      .rowCount,
  ).toBe(0);
  expect((await service().view({ workspaceId, programmeId })).currentVersion).toBe(3);
});
test('staff context retains human ownership and original exact JSON contract', async () => {
  const { rawContext } = await import('./support');
  const id = randomUUID();
  await rawContext(
    f.runtime,
    f.users.owner.ctx,
    "INSERT INTO app.delivery_programme(id,tenant_id,name,reporting_purpose,created_by) VALUES($1,$2,'Synthetic original staff programme','Original staff compatibility fixture',app.actor_id())",
    [id, f.tenantA],
  );
  const v = input();
  const details = {
    organiser: v.organiser,
    marketCode: v.marketCode,
    purpose: v.purpose,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    timezone: v.timezone,
    reason: v.reason,
    ownerId: f.users.owner.id,
  };
  await rawContext(
    f.runtime,
    f.users.owner.ctx,
    'INSERT INTO app.delivery_programme_context(id,tenant_id,programme_id,version,details,created_by) VALUES($1,$2,$3,1,$4,app.actor_id())',
    [randomUUID(), f.tenantA, id, details],
  );
  expect(
    (
      await f.owner.query(
        'SELECT details FROM app.delivery_programme_context WHERE programme_id=$1',
        [id],
      )
    ).rows[0].details,
  ).toEqual(details);
  await expect(
    rawContext(
      f.runtime,
      f.users.owner.ctx,
      'INSERT INTO app.delivery_programme_context(id,tenant_id,programme_id,version,details,created_by) VALUES($1,$2,$3,2,$4,app.actor_id())',
      [randomUUID(), f.tenantA, id, { ...details, ownerKind: 'CUSTOMER' }],
    ),
  ).rejects.toBeDefined();
  await expect(
    rawContext(
      f.runtime,
      f.users.viewer.ctx,
      'INSERT INTO app.delivery_programme_context(id,tenant_id,programme_id,version,details,created_by) VALUES($1,$2,$3,2,$4,app.actor_id())',
      [randomUUID(), f.tenantA, id, details],
    ),
  ).rejects.toHaveProperty('code', '42501');
});
test('context feature remains opt-in, synthetic and production hard off', async () => {
  const { customerProgrammeContextEnabled } =
    await import('../../packages/auth/src/customer-programme-context');
  const env = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMME_CONTEXT_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
    VERCEL_ENV: 'preview',
  };
  expect(customerProgrammeContextEnabled(env)).toBe(true);
  expect(customerProgrammeContextEnabled({ ...env, VERCEL_ENV: 'production' })).toBe(false);
  expect(customerProgrammeContextEnabled({ ...env, DATA_ENVIRONMENT: 'real' })).toBe(false);
  expect(
    customerProgrammeContextEnabled({
      ...env,
      CORRIDRA_CUSTOMER_PROGRAMME_CONTEXT_ENABLED: 'false',
    }),
  ).toBe(false);
});
