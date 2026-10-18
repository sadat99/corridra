import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerRequestDetails } from '../../packages/db/src/customer-detail-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  admitSyntheticCustomerRequests,
  revokeSyntheticCustomerRequest,
} from '../../packages/auth/src/customer-request-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import {
  CustomerRequestDetailService,
  customerRequestDetailsEnabled,
} from '../../packages/auth/src/customer-request-details';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
const issuer = 'https://ep-detail-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  created: { id: string },
  original: ReturnType<typeof brief>;
const principals: Record<string, string> = {};
const session = (person: string) => ({
  subject: 'synthetic-detail-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const workspace = (person: string) =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const requests = (person = 'alice') =>
  new CustomerRequestService(f.runtime, f.auth, options, async () => session(person));
const details = (person = 'alice') =>
  new CustomerRequestDetailService(f.runtime, f.auth, options, async () => session(person));
const brief = () => ({
  objective: 'Source suppliers' as const,
  market: 'China',
  attendance: 'Not decided' as const,
  startDate: '',
  endDate: '',
  timezone: 'Asia/Dhaka',
  offer: 'Synthetic machinery requirements 工厂 বাংলা ' + randomUUID(),
  website: 'https://example.invalid/',
  outcomes: ['Supplier visits' as const],
  notes: 'Original exclusions and support obligations',
  name: 'Synthetic Person',
  company: 'Fictional Company',
  email: 'detail@example.invalid',
  acknowledged: true as const,
  experience: {
    schemaVersion: 1 as const,
    companyCountry: 'BD',
    marketCode: 'CN',
    job: 'machinery_procurement',
    requirements: {
      objective: 'Find a suitable machine',
      role: 'IMPORTER' as const,
      product: 'Synthetic packaging machine',
      budgetMinor: '1234',
      currency: 'BHD',
      budgetBasis: 'One machine; installation excluded',
      machinery: { installationReferences: 'Supplier installation required' },
    },
  },
});
async function submit() {
  const missions = new MissionService(f.runtime, 'synthetic-detail-secret');
  const value = brief();
  return {
    original: value,
    result: await requests().submit(
      { commandId: randomUUID(), workspaceId, brief: value },
      (context, b) => missions.prepareCustomerIntake(context, b),
    ),
  };
}
let oldFunctions: unknown, oldReceipts: unknown;
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerAuthority(f.owner);
  for (const person of ['alice', 'bob', 'carol']) {
    principals[person] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(person).subject,
        executorId: f.serviceId,
        reason: 'Fictional isolated request detail permission fixture',
      })
    ).id;
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[person],
      reason: 'Fictional isolated request detail admission fixture',
    });
  }
  workspaceId = (
    await workspace('bob').provision({
      commandId: randomUUID(),
      name: 'Synthetic owner confidentiality workspace',
    })
  ).id;
  const invitation = await workspace('bob').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic participant',
  });
  await workspace('alice').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  const saved = await submit();
  created = saved.result;
  original = saved.original;
  oldFunctions = (
    await f.owner.query(
      `SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid`,
    )
  ).rows;
  oldReceipts = (await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name'))
    .rows;
  await migrateCustomerRequestDetails(f.owner);
});
afterAll(async () => {
  await f?.close();
});
test('separate additive disclosure module retains the accepted three-module lifecycle and all existing functions/ACLs/receipts', async () => {
  const old = oldFunctions as { oid: number }[];
  expect(
    (
      await f.owner.query(
        'SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p WHERE p.oid=ANY($1::oid[]) ORDER BY p.oid',
        [old.map((p) => p.oid)],
      )
    ).rows,
  ).toEqual(oldFunctions);
  expect(
    (await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name')).rows,
  ).toEqual(oldReceipts);
  expect(oldReceipts).toHaveLength(3);
  await migrateCustomerRequestDetails(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM customer_detail_migrations.applied')).rows,
  ).toHaveLength(1);
});
test('creator reopens exact original structured requirements and money without disclosing bearer or canonical tenant identifiers', async () => {
  const result = await details().detail(created.id, session('alice').subject, issuer);
  expect(result.original).toEqual(original);
  expect(result.progress.status).toBe('DRAFT');
  expect(result.available).toBe(true);
  expect(Object.keys(result).sort()).toEqual([
    'available',
    'createdAt',
    'id',
    'original',
    'progress',
    'synthetic',
    'workspaceId',
  ]);
  expect(result.original.experience.requirements.budgetMinor).toBe('1234');
});
test('workspace owner,other admitted customer,unknown resource and mismatched account/issuer are denied', async () => {
  for (const who of ['bob', 'carol'])
    await expect(details(who).detail(created.id)).rejects.toMatchObject({ code: '42501' });
  await expect(details().detail(randomUUID())).rejects.toMatchObject({ code: '42501' });
  await expect(details().detail(created.id, session('bob').subject, issuer)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    details().detail(
      created.id,
      session('alice').subject,
      'https://ep-other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    ),
  ).rejects.toMatchObject({ status: 409 });
});
test('restricted SQL cannot read source or call detail without proof;auth side cannot use the read port', async () => {
  for (const sql of [
    "SELECT customer.private_request_detail('" + created.id + "')",

    'SELECT * FROM customer_private.owned_request',
  ])
    await expect(f.runtime.query(sql)).rejects.toMatchObject({ code: '42501' });
  expect((await f.runtime.query('SELECT * FROM app.mission_intake')).rows).toEqual([]);
  await expect(
    f.auth.query('SELECT customer.private_request_detail($1)', [created.id]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    f.runtime.query('SELECT * FROM customer_detail_migrations.applied'),
  ).rejects.toMatchObject({ code: '42501' });
});
test('fresh identity,active request admission and independent resource revocation remain mandatory', async () => {
  const noSession = new CustomerRequestDetailService(f.runtime, f.auth, options, async () => null);
  await expect(noSession.detail(created.id)).rejects.toMatchObject({ status: 401 });
  const unverified = new CustomerRequestDetailService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    emailVerified: false,
  }));
  await expect(unverified.detail(created.id)).rejects.toMatchObject({ status: 403 });
  const revoked = await submit();
  await revokeSyntheticCustomerRequest(f.owner, {
    requestId: revoked.result.id,
    reason: 'Explicit synthetic private source revocation fixture',
  });
  await expect(details().detail(revoked.result.id)).rejects.toMatchObject({ code: '42501' });
});
test('original retention expiry removes both content and progress without modifying historic source rows', async () => {
  await f.owner.query(
    `CREATE FUNCTION customer_private.detail_short_retention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.retention_until:=clock_timestamp()+interval '500 milliseconds'; RETURN NEW; END $$`,
  );
  await f.owner.query(
    'CREATE TRIGGER detail_short_retention BEFORE INSERT ON app.mission_intake FOR EACH ROW EXECUTE FUNCTION customer_private.detail_short_retention()',
  );
  let saved: Awaited<ReturnType<typeof submit>>;
  try {
    saved = await submit();
  } finally {
    await f.owner.query('DROP TRIGGER detail_short_retention ON app.mission_intake');
    await f.owner.query('DROP FUNCTION customer_private.detail_short_retention()');
  }
  await f.owner.query('SELECT pg_sleep(0.6)');
  const result = await details().detail(saved!.result.id);
  expect(result).toMatchObject({ available: false, original: null, progress: null });
});
test('detail gate requires its independent flag plus synthetic request admission mode and stays off in production', () => {
  expect(customerRequestDetailsEnabled({})).toBe(false);
  expect(
    customerRequestDetailsEnabled({
      CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED: 'true',
      CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
      DATA_ENVIRONMENT: 'synthetic',
    }),
  ).toBe(true);
  expect(
    customerRequestDetailsEnabled({
      CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED: 'true',
      CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
      DATA_ENVIRONMENT: 'synthetic',
      VERCEL_ENV: 'production',
    }),
  ).toBe(false);
  expect(
    customerRequestDetailsEnabled({
      CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED: 'true',
      CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
      DATA_ENVIRONMENT: 'real',
    }),
  ).toBe(false);
});
