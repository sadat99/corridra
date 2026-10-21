import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { MissionService, digest } from '../../packages/missions/src/index';
let f: Awaited<ReturnType<typeof fixture>>;
let real: MissionService;
const issuer =
  'https://ep-real-guest-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const brief = () => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'No',
  startDate: '',
  endDate: '',
  timezone: 'Europe/Madrid',
  offer: 'Hotel towels for hospitality distributors',
  website: 'https://business.test/catalogue',
  outcomes: ['Relevant meetings'],
  notes: '',
  name: 'Request owner',
  company: 'Hospitality supplier',
  email: 'owner@business.test',
  acknowledged: true,
});
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  real = new MissionService(f.runtime, 'guest-handoff-local-test-secret', 'real');
});
afterAll(async () => {
  await f?.close();
});
test('installation alone does not open real admission and restricted roles cannot change activation', async () => {
  await expect(real.stagePendingRequest(randomUUID(), brief())).rejects.toMatchObject({
    code: '42501',
  });
  for (const pool of [f.runtime, f.auth])
    await expect(
      pool.query('SELECT * FROM customer_private.real_use_configuration'),
    ).rejects.toMatchObject({ code: '42501' });
  await expect(
    new MissionService(f.runtime, 'guest-handoff-local-test-secret').stagePendingRequest(
      randomUUID(),
      brief(),
    ),
  ).rejects.toMatchObject({ status: 503 });
  const tenant = randomUUID();
  await f.owner.query(
    "INSERT INTO app.tenant(id,name,synthetic) VALUES($1,'Real-use test workspace',false)",
    [tenant],
  );
  await f.owner.query(
    "INSERT INTO customer_private.real_use_configuration(issuer,executor_id,intake_tenant_id,owner_id,notice_version,enabled) VALUES($1,$2,$3,$4,'real-intake-2026-10-21-v1',true)",
    [issuer, f.serviceId, tenant, f.users.owner.id],
  );
  await f.owner.query(
    "INSERT INTO customer_private.real_use_admission_control(version,enabled,executor_id,reason) VALUES(1,true,$1,'Explicit local fixture admission')",
    [f.serviceId],
  );
});
test('handoff retries preserve one immutable private request and only a hash of the capability', async () => {
  const id = randomUUID();
  const first = await real.stagePendingRequest(id, brief());
  const again = await real.stagePendingRequest(id, brief());
  expect(again).toEqual(first);
  const capability = real.pendingRequestCapability(first.cookie);
  expect(capability.id).toBe(id);
  const row = (
    await f.owner.query('SELECT * FROM customer_private.pending_request WHERE id=$1', [id])
  ).rows[0];
  expect(row.possession_hash).toBe(capability.hash);
  expect(row.brief.email).toBe('owner@business.test');
  expect(row.email_hash).toBe(digest('owner@business.test'));
  expect(JSON.stringify(row)).not.toContain(first.cookie.split('.')[1]);
  await expect(
    real.stagePendingRequest(id, {
      ...brief(),
      offer: 'Changed request content for a different supplier',
    }),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    f.owner.query('UPDATE customer_private.pending_request SET brief=$2 WHERE id=$1', [
      id,
      brief(),
    ]),
  ).rejects.toThrow();
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.pending_request WHERE id=$1',
        [id],
      )
    ).rows[0].n,
  ).toBe(1);
  for (const pool of [f.runtime, f.auth])
    await expect(
      pool.query('SELECT brief FROM customer_private.pending_request'),
    ).rejects.toMatchObject({ code: '42501' });
});
test('passwords and identity fields cannot enter pending mission data, even through direct SQL', async () => {
  for (const field of ['password', 'newPassword', 'sessionToken', 'accountSubject']) {
    await expect(
      real.stagePendingRequest(randomUUID(), { ...brief(), [field]: 'must-never-be-persisted' }),
    ).rejects.toThrow();
    await expect(
      f.runtime.query('SELECT customer.stage_pending_request($1,$2,$3::jsonb)', [
        randomUUID(),
        'a'.repeat(64),
        { ...brief(), [field]: 'must-never-be-persisted' },
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  }
  await expect(
    f.auth.query('SELECT customer.stage_pending_request($1,$2,$3::jsonb)', [
      randomUUID(),
      'a'.repeat(64),
      brief(),
    ]),
  ).rejects.toMatchObject({ code: '42501' });
});
test('forged, malformed and cross-secret capabilities fail, and possession alone cannot claim a request', async () => {
  const saved = await real.stagePendingRequest(randomUUID(), brief());
  for (const value of [
    '',
    saved.cookie + 'extra',
    saved.cookie.slice(0, -1) + (saved.cookie.endsWith('0') ? '1' : '0'),
  ])
    expect(() => real.pendingRequestCapability(value)).toThrow();
  expect(() =>
    new MissionService(f.runtime, 'different-local-secret', 'real').pendingRequestCapability(
      saved.cookie,
    ),
  ).toThrow();
  const cap = real.pendingRequestCapability(saved.cookie);
  await expect(
    f.runtime.query('SELECT customer.pending_request_for_claim($1,$2)', [cap.id, cap.hash]),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_private.pending_request_claim'))
      .rows[0].n,
  ).toBe(0);
});

test('only fresh verified identity with matching email and possession can read the pending claim', async () => {
  const { CustomerSessionBoundary } = await import('../../packages/auth/src/customer-session');
  const { admitSyntheticCustomer } = await import('../../packages/auth/src/customer-admission');
  for (const subject of ['guest-owner', 'other-account'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject,
      executorId: f.serviceId,
      reason: 'Explicit local handoff identity fixture; no production person',
    });
  class Reader extends CustomerSessionBoundary {
    read(cap: { id: string; hash: string }) {
      return this.transaction(
        async (db) =>
          (
            await db.query('SELECT customer.pending_request_for_claim($1,$2) result', [
              cap.id,
              cap.hash,
            ])
          ).rows[0].result,
      );
    }
  }
  const reader = (
    subject: string,
    email: string,
    emailVerified = true,
    expiresAt = new Date(Date.now() + 60000),
  ) =>
    new Reader(
      f.runtime,
      f.auth,
      { enabled: true, synthetic: false, production: false, issuer, dataMode: 'real' },
      async () => ({ subject, email, emailVerified, expiresAt }),
    );
  const saved = await real.stagePendingRequest(randomUUID(), brief());
  const cap = real.pendingRequestCapability(saved.cookie);
  const result = await reader('guest-owner', 'owner@business.test').read(cap);
  expect(result.brief).toEqual(brief());
  expect(result.requestId).toBeNull();
  await expect(reader('other-account', 'different@business.test').read(cap)).rejects.toMatchObject({
    code: '42501',
  });
  await expect(reader('guest-owner', 'owner@business.test', false).read(cap)).rejects.toMatchObject(
    { status: 403 },
  );
  await expect(
    reader('guest-owner', 'owner@business.test', true, new Date(0)).read(cap),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    reader('guest-owner', 'owner@business.test').read({ ...cap, hash: 'f'.repeat(64) }),
  ).rejects.toMatchObject({ code: '42501' });
  await f.owner.query(
    "UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE issuer=$1 AND subject='guest-owner'",
    [issuer],
  );
  await expect(reader('guest-owner', 'owner@business.test').read(cap)).rejects.toMatchObject({
    code: '42501',
  });
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_private.session_proof')).rows[0].n,
  ).toBe(0);
});

test('verified submission-first claim creates one real private request and retries concurrently without duplicate ownership', async () => {
  const { CustomerRequestService } = await import('../../packages/auth/src/customer-requests');
  const service = new CustomerRequestService(
    f.runtime,
    f.auth,
    {
      enabled: true,
      synthetic: false,
      production: false,
      issuer,
      dataMode: 'real',
      openAdmission: true,
    },
    async () => ({
      subject: 'canonical-guest-owner',
      email: 'owner@business.test',
      emailVerified: true,
      expiresAt: new Date(Date.now() + 60000),
    }),
  );
  const saved = await real.stagePendingRequest(randomUUID(), brief());
  const cap = real.pendingRequestCapability(saved.cookie);
  const prepare = (
    context: Parameters<MissionService['prepareCustomerIntake']>[0],
    body: unknown,
  ) => real.prepareCustomerIntake(context, body);
  const [first, second] = await Promise.all([
    service.claimPending(cap, prepare),
    service.claimPending(cap, prepare),
  ]);
  expect(first).toEqual(second);
  expect(first.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(first.synthetic).toBe(false);
  const rows = (
    await f.owner.query(
      `SELECT r.id,t.synthetic,m.purpose,i.notice_version,i.brief->>'email' email FROM customer_private.owned_request r JOIN app.mission m ON m.id=r.mission_id AND m.tenant_id=r.mission_tenant_id JOIN app.tenant t ON t.id=r.workspace_id JOIN app.mission_intake i ON i.id=m.id AND i.tenant_id=m.tenant_id WHERE r.command_id=$1`,
      [cap.id],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: first.id,
    synthetic: false,
    purpose: 'commercial_qualification',
    notice_version: 'real-intake-2026-10-21-v1',
    email: 'owner@business.test',
  });
  const listed = await service.list();
  expect(listed.requests.some((r: { id: string }) => r.id === first.id)).toBe(true);
  const outsider = new CustomerRequestService(
    f.runtime,
    f.auth,
    {
      enabled: true,
      synthetic: false,
      production: false,
      issuer,
      dataMode: 'real',
      openAdmission: true,
    },
    async () => ({
      subject: 'canonical-other-account',
      email: 'other@business.test',
      emailVerified: true,
      expiresAt: new Date(Date.now() + 60000),
    }),
  );
  await expect(outsider.claimPending(cap, prepare)).rejects.toMatchObject({ code: '42501' });
  expect((await outsider.list()).requests).toEqual([]);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.pending_request_claim WHERE pending_id=$1',
        [cap.id],
      )
    ).rows[0].n,
  ).toBe(1);
});

test('real workspace budgets allow ordinary use and remain bounded', async () => {
  const client = 'local-budget-' + randomUUID();
  for (let i = 0; i < 120; i++) await real.budget(client);
  await expect(real.budget(client)).rejects.toMatchObject({ status: 429 });
  await expect(
    f.runtime.query('SELECT customer.real_request_budget($1,999999)', ['a'.repeat(64)]),
  ).rejects.toMatchObject({ code: '23514' });
});

test('pausing new admission preserves existing request access and retry history', async () => {
  const { CustomerRequestService } = await import('../../packages/auth/src/customer-requests');
  const service = new CustomerRequestService(
    f.runtime,
    f.auth,
    {
      enabled: true,
      synthetic: false,
      production: false,
      issuer,
      dataMode: 'real',
      openAdmission: true,
    },
    async () => ({
      subject: 'rollback-owner',
      email: 'rollback@business.test',
      emailVerified: true,
      expiresAt: new Date(Date.now() + 60000),
    }),
  );
  const saved = await real.stagePendingRequest(randomUUID(), {
    ...brief(),
    email: 'rollback@business.test',
  });
  const cap = real.pendingRequestCapability(saved.cookie);
  const prepare = (
    context: Parameters<MissionService['prepareCustomerIntake']>[0],
    body: unknown,
  ) => real.prepareCustomerIntake(context, body);
  const before = await service.claimPending(cap, prepare);
  await f.owner.query(
    "INSERT INTO customer_private.real_use_admission_control(version,enabled,executor_id,reason) VALUES(2,false,$1,'Pause new intake without changing prior records')",
    [f.serviceId],
  );
  expect(await real.realIntakeAvailable()).toBe(false);
  await expect(real.stagePendingRequest(randomUUID(), brief())).rejects.toMatchObject({
    code: '42501',
  });
  expect(await service.claimPending(cap, prepare)).toEqual(before);
  expect((await service.list()).requests.some((r: { id: string }) => r.id === before.id)).toBe(
    true,
  );
  await expect(
    f.owner.query(
      'UPDATE customer_private.real_use_admission_control SET enabled=true WHERE version=2',
    ),
  ).rejects.toThrow();
  for (const pool of [f.runtime, f.auth])
    await expect(
      pool.query('SELECT * FROM customer_private.real_use_admission_control'),
    ).rejects.toMatchObject({ code: '42501' });
  await f.owner.query(
    "INSERT INTO customer_private.real_use_admission_control(version,enabled,executor_id,reason) VALUES(3,true,$1,'Resume local fixture intake after rollback test')",
    [f.serviceId],
  );
  expect(await real.realIntakeAvailable()).toBe(true);
});
