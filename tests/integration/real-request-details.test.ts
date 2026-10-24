import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { realStaffFixture } from './real-staff-fixture';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import {
  CustomerRequestDetailService,
  customerRequestDetailsEnabled,
} from '../../packages/auth/src/customer-request-details';

// A real customer reopens the exact request they submitted, and nobody else can. The sample suite
// (customer-request-details) proves the same rules for sample workspaces.
const issuer =
  'https://ep-real-details-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  openAdmission: true,
  dataMode: 'real' as const,
};
const sessionFor = (subject: string) => async () => ({
  subject,
  email: subject + '@business.test',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let workspaceId: string;
let created: { id: string };
let original: ReturnType<typeof brief>;
const workspaces = (who: string) =>
  new CustomerWorkspaceService(s.f.runtime, s.f.auth, options, sessionFor(who));
const requests = (who = 'details-alice') =>
  new CustomerRequestService(s.f.runtime, s.f.auth, options, sessionFor(who));
const details = (who = 'details-alice') =>
  new CustomerRequestDetailService(s.f.runtime, s.f.auth, options, sessionFor(who));
const brief = () => ({
  objective: 'Source suppliers' as const,
  market: 'China',
  attendance: 'Not decided' as const,
  startDate: '',
  endDate: '',
  timezone: 'Asia/Dhaka',
  offer: 'Packaging machinery requirements 工厂 বাংলা ' + randomUUID(),
  website: 'https://business.test/catalogue',
  outcomes: ['Supplier visits' as const],
  notes: 'Original exclusions and support obligations',
  name: 'Request owner',
  company: 'Packaging company',
  email: 'details-alice@business.test',
  acknowledged: true as const,
  experience: {
    schemaVersion: 1 as const,
    companyCountry: 'BD',
    marketCode: 'CN',
    job: 'machinery_procurement',
    requirements: {
      objective: 'Find a suitable machine',
      role: 'IMPORTER' as const,
      product: 'Packaging machine',
      budgetMinor: '1234',
      currency: 'BHD',
      budgetBasis: 'One machine; installation excluded',
      machinery: { installationReferences: 'Supplier installation required' },
    },
  },
});
async function submit(who = 'details-alice') {
  const value = brief();
  return {
    original: value,
    result: await requests(who).submit(
      { commandId: randomUUID(), workspaceId, brief: value },
      (context, b) => s.missions.prepareCustomerIntake(context, b),
    ),
  };
}

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-details-fixture-secret');
  // The workspace is owned by bob; alice joins it and makes the request, so ownership and authorship differ.
  workspaceId = (
    await workspaces('details-bob').provision({
      commandId: randomUUID(),
      name: 'Packaging company workspace',
    })
  ).id;
  const invitation = await workspaces('details-bob').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Colleague who makes the request',
  });
  await workspaces('details-alice').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  await workspaces('details-carol').provision({
    commandId: randomUUID(),
    name: 'Unrelated company workspace',
  });
  const saved = await submit();
  created = saved.result;
  original = saved.original;
}, 240000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

test('the creator reopens the exact original request and money, marked real, without bearer or tenant identifiers', async () => {
  const result = await details().detail(created.id, 'details-alice', issuer);
  expect(result.original).toEqual(original);
  expect(result.synthetic).toBe(false);
  expect(result.available).toBe(true);
  expect(result.progress.status).toBe('DRAFT');
  expect(result.original.experience.requirements.budgetMinor).toBe('1234');
  expect(Object.keys(result).sort()).toEqual([
    'available',
    'createdAt',
    'id',
    'original',
    'progress',
    'synthetic',
    'workspaceId',
  ]);
});

test('the request is stored as a real request in the real intake tenant', async () => {
  const row = (
    await s.f.owner.query(
      'SELECT t.synthetic,m.tenant_id,m.purpose FROM customer_private.owned_request r JOIN app.tenant t ON t.id=r.workspace_id JOIN app.mission m ON m.id=r.mission_id AND m.tenant_id=r.mission_tenant_id WHERE r.id=$1',
      [created.id],
    )
  ).rows[0];
  expect(row).toMatchObject({
    synthetic: false,
    tenant_id: s.intakeTenantId,
    purpose: 'commercial_qualification',
  });
});

test('the workspace owner, another customer, an unknown id and a mismatched account or issuer are refused', async () => {
  for (const who of ['details-bob', 'details-carol'])
    await expect(details(who).detail(created.id)).rejects.toMatchObject({ code: '42501' });
  await expect(details().detail(randomUUID())).rejects.toMatchObject({ code: '42501' });
  await expect(details().detail(created.id, 'details-bob', issuer)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    details().detail(
      created.id,
      'details-alice',
      'https://ep-other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    ),
  ).rejects.toMatchObject({ status: 409 });
});

test('a missing or unverified provider session is refused before anything is read', async () => {
  const none = new CustomerRequestDetailService(s.f.runtime, s.f.auth, options, async () => null);
  await expect(none.detail(created.id)).rejects.toMatchObject({ status: 401 });
  const unverified = new CustomerRequestDetailService(s.f.runtime, s.f.auth, options, async () => ({
    subject: 'details-alice',
    email: 'details-alice@business.test',
    emailVerified: false,
    expiresAt: new Date(Date.now() + 60000),
  }));
  await expect(unverified.detail(created.id)).rejects.toMatchObject({ status: 403 });
});

test('after the original intake retention ends, content and progress are gone and history is untouched', async () => {
  await s.f.owner.query(
    `CREATE FUNCTION customer_private.detail_short_retention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.retention_until:=clock_timestamp()+interval '500 milliseconds'; RETURN NEW; END $$`,
  );
  await s.f.owner.query(
    'CREATE TRIGGER detail_short_retention BEFORE INSERT ON app.mission_intake FOR EACH ROW EXECUTE FUNCTION customer_private.detail_short_retention()',
  );
  let saved: Awaited<ReturnType<typeof submit>>;
  try {
    saved = await submit();
  } finally {
    await s.f.owner.query('DROP TRIGGER detail_short_retention ON app.mission_intake');
    await s.f.owner.query('DROP FUNCTION customer_private.detail_short_retention()');
  }
  await s.f.owner.query('SELECT pg_sleep(0.6)');
  expect(await details().detail(saved!.result.id)).toMatchObject({
    available: false,
    original: null,
    progress: null,
  });
});

test('the application gate opens for real use only with the real-use switch, and never in production', () => {
  const on = {
    CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
    DATA_ENVIRONMENT: 'real',
  };
  expect(customerRequestDetailsEnabled(on)).toBe(false);
  expect(customerRequestDetailsEnabled({ ...on, CORRIDRA_REAL_USE_ENABLED: 'true' })).toBe(true);
  expect(customerRequestDetailsEnabled({})).toBe(false);
});
