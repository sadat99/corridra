import { beforeAll, afterAll, expect, test } from 'vitest';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  admitSyntheticCustomerRequests,
  revokeSyntheticCustomerRequest,
} from '../../packages/auth/src/customer-request-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import {
  CustomerRequestService,
  customerRequestsEnabled,
} from '../../packages/auth/src/customer-requests';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { sessionHash } from '../../packages/db/src/index';
const issuer = 'https://ep-request-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>, missions: MissionService;
let workspaceId: string, otherWorkspace: string, memberId: string;
let before: Awaited<ReturnType<typeof snapshot>>, receipts: unknown;
const principals: Record<string, string> = {};
const session = (person: string): CustomerSession => ({
  subject: 'synthetic-request-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const workspace = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const service = (person = 'alice') =>
  new CustomerRequestService(f.runtime, f.auth, options, async () => session(person));
const prepare = (context: Parameters<MissionService['prepareCustomerIntake']>[0], brief: unknown) =>
  missions.prepareCustomerIntake(context, brief);
const brief = () => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: 'Synthetic hotel towels ' + randomUUID(),
  website: 'https://example.invalid/catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic test only',
  name: 'Test Person',
  company: 'Example Test Company',
  email: 'mission@example.invalid',
  acknowledged: true,
});
const input = (target = workspaceId) => ({
  commandId: randomUUID(),
  workspaceId: target,
  brief: brief(),
});
async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM app.mission) missions,
 (SELECT count(*)::int FROM app.mission_intake) intakes,
 (SELECT count(*)::int FROM customer_private.owned_request) bindings,
 (SELECT count(*)::int FROM app.domain_event) events,
 (SELECT count(*)::int FROM app.audit_event) audits,
 (SELECT count(*)::int FROM app.outbox) outbox`)
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
    ).rows.filter(
      (row) =>
        !previous ||
        tables.some((t) => t.nspname === row.schemaname && t.relname === row.tablename),
    ),
    coreHistory: (await f.owner.query('SELECT * FROM migrations.applied ORDER BY name')).rows,
  };
}
beforeAll(async () => {
  f = await fixture();
  missions = new MissionService(f.runtime, 'synthetic-only-request-secret');
  // Stage released modules unchanged; compare all populated old schemas before additive upgrade.
  for (const name of [
    '0001_synthetic_workspace_authority.sql',
    '0002_workspace_collaboration.sql',
  ]) {
    const sql = await readFile('packages/db/customer-migrations/' + name, 'utf8');
    await f.owner.query(sql);
  }
  await f.owner.query('CREATE SCHEMA customer_migrations');
  await f.owner.query(
    'REVOKE ALL ON SCHEMA customer_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
  );
  await f.owner.query(
    'CREATE TABLE customer_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of [
    '0001_synthetic_workspace_authority.sql',
    '0002_workspace_collaboration.sql',
  ]) {
    const sql = await readFile('packages/db/customer-migrations/' + name, 'utf8');
    await f.owner.query('INSERT INTO customer_migrations.applied(name,sha256) VALUES($1,$2)', [
      name,
      createHash('sha256').update(sql).digest('hex'),
    ]);
  }
  for (const person of ['alice', 'bob', 'carol', 'unadmitted'])
    principals[person] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(person).subject,
        executorId: f.serviceId,
        reason: 'Explicit fictional request test principal, never real provider data',
      })
    ).id;
  workspaceId = (
    await workspace().provision({
      commandId: randomUUID(),
      name: 'Synthetic private request workspace',
    })
  ).id;
  otherWorkspace = (
    await workspace('carol').provision({
      commandId: randomUUID(),
      name: 'Synthetic separate request workspace',
    })
  ).id;
  const invitation = await workspace().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic private request participant',
  });
  memberId = (
    await workspace('bob').access({
      action: 'accept',
      commandId: randomUUID(),
      token: invitation.token,
    })
  ).memberId!;
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await missions.submit(randomUUID(), brief());
  before = await snapshot();
  receipts = (await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name')).rows;
  await migrateCustomerAuthority(f.owner);
  for (const person of ['alice', 'bob', 'carol'])
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[person],
      reason: 'Explicit invented synthetic request scope, no commercial activation',
    });
});
afterAll(async () => {
  await f?.close();
});

test('populated additive upgrade preserves all original rows, functions, policies, RLS, ACLs and receipts', async () => {
  expect(await snapshot(before)).toEqual(before);
  expect(
    (
      await f.owner.query(
        "SELECT * FROM customer_migrations.applied WHERE name<'0003' ORDER BY name",
      )
    ).rows,
  ).toEqual(receipts);
  await migrateCustomerAuthority(f.owner);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_migrations.applied')).rows[0].n,
  ).toBe(3);
});

test('request gate is independent, default-off, synthetic-only and hard-disabled in production', async () => {
  expect(customerRequestsEnabled({})).toBe(false);
  expect(
    customerRequestsEnabled({
      CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
      DATA_ENVIRONMENT: 'synthetic',
    }),
  ).toBe(false);
  expect(
    customerRequestsEnabled({
      CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
      DATA_ENVIRONMENT: 'synthetic',
    }),
  ).toBe(true);
  expect(
    customerRequestsEnabled({
      CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
      DATA_ENVIRONMENT: 'synthetic',
      VERCEL_ENV: 'production',
    }),
  ).toBe(false);
  for (const override of [{ enabled: false }, { synthetic: false }, { production: true }])
    await expect(
      new CustomerRequestService(f.runtime, f.auth, { ...options, ...override }, async () =>
        session('alice'),
      ).list(),
    ).rejects.toThrow('unavailable');
  await expect(service('unadmitted').list()).rejects.toThrow('denied');
  await expect(service('unknown').list()).rejects.toThrow('denied');
  await expect(service().list({}, session('bob').subject, issuer)).rejects.toThrow(
    'account changed',
  );
  const unverified = new CustomerRequestService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    emailVerified: false,
  }));
  await expect(unverified.list()).rejects.toThrow('Verify your email');
});

test('canonical creation, exact source preservation, atomic events, concurrent idempotency and conflict denial', async () => {
  const value = input();
  const prior = await counts();
  const [first, second] = await Promise.all([
    service().submit(value, prepare),
    service().submit(value, prepare),
  ]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({
    workspaceId,
    synthetic: true,
    available: true,
    progress: { status: 'DRAFT', replies: [] },
  });
  const after = await counts();
  expect(after.missions - prior.missions).toBe(1);
  expect(after.bindings - prior.bindings).toBe(1);
  expect(after.events - prior.events).toBe(2);
  expect(after.audits - prior.audits).toBe(2);
  expect(after.outbox - prior.outbox).toBe(2);
  const owned = (
    await f.owner.query('SELECT * FROM customer_private.owned_request WHERE id=$1', [first.id])
  ).rows[0];
  const canonical = (
    await f.owner.query('SELECT * FROM app.mission_intake WHERE id=$1', [owned.mission_id])
  ).rows[0];
  expect(canonical.brief).toEqual(value.brief);
  expect(canonical.receipt_hash).toBe(owned.receipt_hash);
  const event = (
    await f.owner.query(
      "SELECT actor_id,payload FROM app.domain_event WHERE type='customer.request.bound' AND aggregate_id=$1",
      [first.id],
    )
  ).rows[0];
  expect(event.actor_id).toBe(f.serviceId);
  expect(event.payload.initiator_id).toBe(principals.alice);
  expect(JSON.stringify(first)).not.toContain(owned.receipt_hash);
  expect(JSON.stringify(first)).not.toContain(owned.mission_id);
  await expect(
    service().submit({ ...value, brief: { ...value.brief, notes: 'Conflicting retry' } }, prepare),
  ).rejects.toThrow('conflicts');
  const rotated = new MissionService(f.runtime, 'rotated-synthetic-secret');
  const retry = await service().submit(value, (context, body) =>
    rotated.prepareCustomerIntake(context, body),
  );
  expect(retry).toEqual(first);
  expect(await counts()).toEqual(after);
});

test('owner and teammates never inherit another creator request; cross-workspace submission denied', async () => {
  const value = input();
  const owned = await service('bob').submit(value, prepare);
  expect((await service('bob').list()).requests.map((r: { id: string }) => r.id)).toContain(
    owned.id,
  );
  expect((await service().list()).requests.map((r: { id: string }) => r.id)).not.toContain(
    owned.id,
  );
  expect((await service('carol').list()).requests).toEqual([]);
  await expect(service('carol').submit(input(), prepare)).rejects.toThrow(
    'Workspace access denied',
  );
  await expect(service().submit(input(otherWorkspace), prepare)).rejects.toThrow(
    'Workspace access denied',
  );
  await workspace().access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId,
    kind: 'membership',
    targetId: memberId,
  });
  await expect(service('bob').submit(input(), prepare)).rejects.toThrow('Workspace access denied');
  expect(
    await service('bob').submit(value, () => {
      throw new Error('Must not derive a new key');
    }),
  ).toEqual(owned);
  expect((await service('bob').list()).requests[0].id).toBe(owned.id);
});

test('anonymous duplicates yield no ownership; untrusted keys and fields cannot claim a canonical case', async () => {
  const value = input();
  await missions.submit(randomUUID(), value.brief);
  const prior = await counts();
  await expect(service().submit(value, prepare)).rejects.toThrow('no private ownership');
  expect(await counts()).toEqual(prior);
  await expect(
    service().submit({ ...input(), missionId: randomUUID() }, prepare),
  ).rejects.toThrow();
  await expect(
    service().submit({ ...input(), requestKey: randomUUID() }, prepare),
  ).rejects.toThrow();
});

test('restricted SQL roles cannot mint authority, read private digests or bypass staff MFA/RLS', async () => {
  for (const pool of [f.runtime, f.auth]) {
    await expect(pool.query('SELECT * FROM customer_private.owned_request')).rejects.toThrow(
      'permission denied',
    );
    await expect(pool.query('SELECT * FROM customer_private.request_admission')).rejects.toThrow(
      'permission denied',
    );
    await expect(
      admitSyntheticCustomerRequests(pool, {
        principalId: principals.alice,
        reason: 'Forged direct SQL request admission',
      }),
    ).rejects.toThrow();
  }
  await expect(
    f.runtime.query('SELECT customer.submit_private_request($1,$2,$3::jsonb)', [
      randomUUID(),
      workspaceId,
      JSON.stringify(brief()),
    ]),
  ).rejects.toThrow('denied');
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds')",
    [hash, issuer, session('alice').subject],
  );
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    expect((await db.query('SELECT app.actor_id() actor')).rows[0].actor).toBeNull();
    expect((await db.query('SELECT * FROM app.mission')).rows).toEqual([]);
    await expect(
      db.query('SELECT customer.submit_private_request($1,$2,$3::jsonb)', [
        randomUUID(),
        workspaceId,
        JSON.stringify(brief()),
      ]),
    ).rejects.toThrow('attestation required');
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
});

test('factory or binding audit failure rolls back all canonical rows and events', async () => {
  const value = input();
  const prior = await counts();
  await f.owner.query('UPDATE app.intake_destination SET enabled=false');
  try {
    await expect(service().submit(value, prepare)).rejects.toThrow('Intake unavailable');
  } finally {
    await f.owner.query('UPDATE app.intake_destination SET enabled=true');
  }
  expect(await counts()).toEqual(prior);
  await f.owner.query(
    `CREATE FUNCTION customer_private.test_fail_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic forced binding audit failure'; END $$`,
  );
  await f.owner.query(
    'CREATE TRIGGER test_fail_binding BEFORE INSERT ON customer_private.owned_request FOR EACH ROW EXECUTE FUNCTION customer_private.test_fail_binding()',
  );
  try {
    await expect(service().submit(value, prepare)).rejects.toThrow('forced binding audit failure');
  } finally {
    await f.owner.query('DROP TRIGGER test_fail_binding ON customer_private.owned_request');
    await f.owner.query('DROP FUNCTION customer_private.test_fail_binding()');
  }
  expect(await counts()).toEqual(prior);
  expect((await service().submit(value, prepare)).available).toBe(true);
});

test('original retention expiry and independent resource revocation deny content without rewriting originals', async () => {
  const value = input();
  // A new source gets a short original retention at INSERT, never a historical rewrite.
  await f.owner.query(
    `CREATE FUNCTION customer_private.test_short_retention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.retention_until:=clock_timestamp()+interval '100 milliseconds'; RETURN NEW; END $$`,
  );
  await f.owner.query(
    'CREATE TRIGGER test_short_retention BEFORE INSERT ON app.mission_intake FOR EACH ROW EXECUTE FUNCTION customer_private.test_short_retention()',
  );
  let result;
  try {
    result = await service().submit(value, prepare);
  } finally {
    await f.owner.query('DROP TRIGGER test_short_retention ON app.mission_intake');
    await f.owner.query('DROP FUNCTION customer_private.test_short_retention()');
  }
  await f.owner.query('SELECT pg_sleep(0.15)');
  const retry = await service().submit(value, prepare);
  expect(retry.available).toBe(false);
  expect(retry.progress).toBeNull();
  await revokeSyntheticCustomerRequest(f.owner, {
    requestId: result.id,
    reason: 'Synthetic independently revoked resource scope',
  });
  await expect(service().submit(value, prepare)).rejects.toThrow('unavailable');
  expect((await service().list()).requests.map((r: { id: string }) => r.id)).not.toContain(
    result.id,
  );
  await f.owner.query(
    'UPDATE customer_private.request_admission SET disabled_at=clock_timestamp() WHERE principal_id=$1',
    [principals.carol],
  );
  expect(
    (
      await admitSyntheticCustomerRequests(f.owner, {
        principalId: principals.carol,
        reason: 'Repeated admission must never revive disabled scope',
      })
    ).active,
  ).toBe(false);
  await expect(service('carol').list()).rejects.toThrow('denied');
});

test('creator-only pagination is bounded and exhaustive across live and expired private references', async () => {
  for (let n = 0; n < 3; n++) await service().submit(input(), prepare);
  const expected = (
    await f.owner.query(
      `SELECT o.id FROM customer_private.owned_request o
    WHERE principal_id=$1 AND NOT EXISTS(SELECT FROM customer_private.request_revocation r WHERE r.request_id=o.id)
    ORDER BY o.id`,
      [principals.alice],
    )
  ).rows.map((row) => row.id);
  const found: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await service().list({ pageSize: 2, ...(after ? { after } : {}) });
    expect(result.requests.length).toBeLessThanOrEqual(2);
    for (const row of result.requests) found.push(row.id);
    if (result.nextAfter === null) break;
    expect(result.nextAfter).toBe(result.requests.at(-1).id);
    after = result.nextAfter;
    if (page === 19) throw new Error('Private pagination did not terminate');
  }
  expect(found).toEqual(expected);
  expect(new Set(found).size).toBe(found.length);
  expect(
    (await service('bob').list()).requests.every((row: { id: string }) => !found.includes(row.id)),
  ).toBe(true);
  await expect(service().list({ pageSize: 101 })).rejects.toThrow();
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds')",
    [hash, issuer, session('alice').subject],
  );
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    await expect(db.query('SELECT customer.private_requests(NULL,101)')).rejects.toThrow(
      'Invalid page size',
    );
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
});

test('proof expiry after global intake lock cannot create a mission, binding or event', async () => {
  const value = input();
  const prior = await counts();
  const lock = await f.owner.connect();
  await lock.query('BEGIN');
  await lock.query("SELECT pg_advisory_xact_lock(hashtext('corridra:intake'))");
  const short = new CustomerRequestService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    expiresAt: new Date(Date.now() + 500),
  }));
  const pending = short.submit(value, prepare);
  const checked = expect(pending).rejects.toThrow('expired');
  try {
    let waiting = false;
    for (let n = 0; n < 20; n++) {
      waiting = (
        await f.owner.query(
          "SELECT EXISTS(SELECT FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE 'SELECT customer.submit_private_request%') waiting",
        )
      ).rows[0].waiting;
      if (waiting) break;
      await f.owner.query('SELECT pg_sleep(0.01)');
    }
    expect(waiting).toBe(true);
    await f.owner.query('SELECT pg_sleep(0.7)');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  await checked;
  expect(await counts()).toEqual(prior);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_private.request_attestation'))
      .rows[0].n,
  ).toBe(0);
});

test('resource revocation waiting on read lock is observed before content returns', async () => {
  const value = input();
  const result = await service().submit(value, prepare);
  const lock = await f.owner.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM customer_private.owned_request WHERE id=$1 FOR UPDATE', [
    result.id,
  ]);
  const pending = service().submit(value, prepare);
  const checked = expect(pending).rejects.toThrow('unavailable');
  try {
    await f.owner.query('SELECT pg_sleep(0.1)');
    await lock.query(
      "INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,'Synthetic serialized private read revocation')",
      [result.id],
    );
    await lock.query('COMMIT');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  await checked;
});

test('request admission disable serializes against new commands and never revives by re-admission', async () => {
  const value = input();
  const prior = await counts();
  const lock = await f.owner.connect();
  await lock.query('BEGIN');
  await lock.query(
    'SELECT principal_id FROM customer_private.request_admission WHERE principal_id=$1 FOR UPDATE',
    [principals.alice],
  );
  const pending = service().submit(value, prepare);
  const checked = expect(pending).rejects.toThrow('denied');
  try {
    await f.owner.query('SELECT pg_sleep(0.1)');
    await lock.query(
      'UPDATE customer_private.request_admission SET disabled_at=clock_timestamp() WHERE principal_id=$1',
      [principals.alice],
    );
    await lock.query('COMMIT');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  await checked;
  expect(await counts()).toEqual(prior);
  expect(
    (
      await admitSyntheticCustomerRequests(f.owner, {
        principalId: principals.alice,
        reason: 'Repeated admission is never reactivation authority',
      })
    ).active,
  ).toBe(false);
  await expect(service().list()).rejects.toThrow('denied');
});
