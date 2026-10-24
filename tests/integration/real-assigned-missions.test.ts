import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerAssignedMissionService } from '../../packages/auth/src/customer-assigned-missions';
import { DeliveryService } from '../../packages/delivery/src/index';
import { CustomerDeliveryService } from '../../packages/delivery/src/customer-delivery';
import { MissionService } from '../../packages/missions/src/index';

// Staff assign a reviewed report to the real customer who made the request, and the customer accepts it into
// their saved reports. The sample suite (customer-delivery) proves the same rules for sample workspaces.
let f: Awaited<ReturnType<typeof fixture>>;
let intakeTenantId: string;
let missions: MissionService;
let delivery: DeliveryService;
let staff: CustomerDeliveryService;
let workspaceId: string;
let requestId: string;
let missionId: string;
let publicationId: string;
let link: { id: string; token: string };
let assignmentId: string;
const issuer =
  'https://ep-real-assigned-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
const future = (days = 1) => new Date(Date.now() + days * 86400000).toISOString();
const assigned = (who = 'assigned-alice') =>
  new CustomerAssignedMissionService(f.runtime, f.auth, options, sessionFor(who));
const saved = (who = 'assigned-alice') =>
  new CustomerSavedMissionService(f.runtime, f.auth, options, sessionFor(who));
const workspaces = (who: string) =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, sessionFor(who));
const staffCtx = () => ({
  ...f.users.owner.ctx,
  tenantId: intakeTenantId,
  purpose: 'commercial_qualification',
});
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
  email: 'assigned-alice@business.test',
  acknowledged: true,
});
const assignment = () => ({
  commandId: randomUUID(),
  requestId,
  linkId: link.id,
  reason: 'Reviewed report delivered to the company that made the request',
  approved: true,
});

beforeAll(async () => {
  vi.stubEnv('DATA_ENVIRONMENT', 'real');
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: 'local-bootstrap-fixture',
    executorId: f.serviceId,
    reason: 'Local fixture authority only; never a production customer',
  });
  await f.owner.query(
    "INSERT INTO app.intake_destination(tenant_id,service_id,owner_id,enabled,notice_version) VALUES($1,$2,$3,true,'synthetic-intake-2026-10-05-v1')",
    [f.tenantA, f.serviceId, f.users.owner.id],
  );
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Local functional fixture with owner-approved real use and deferred scanning',
  });
  intakeTenantId = (
    await f.owner.query('SELECT intake_tenant_id FROM customer_private.real_use_configuration')
  ).rows[0].intake_tenant_id;
  missions = new MissionService(f.runtime, 'real-assigned-fixture-secret', 'real');
  delivery = new DeliveryService(f.runtime, missions, 'real-assigned-fixture-secret');
  staff = new CustomerDeliveryService(f.runtime);
  workspaceId = (
    await workspaces('assigned-alice').provision({
      commandId: randomUUID(),
      name: 'Hospitality Supplier workspace',
    })
  ).id;
  const invitation = await workspaces('assigned-alice').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Colleague without inherited report scope',
  });
  await workspaces('assigned-bob').provision({
    commandId: randomUUID(),
    name: 'Other company workspace',
  });
  await workspaces('assigned-bob').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  const request = await new CustomerRequestService(
    f.runtime,
    f.auth,
    options,
    sessionFor('assigned-alice'),
  ).submit({ commandId: randomUUID(), workspaceId, brief: brief() }, (ctx, b) =>
    missions.prepareCustomerIntake(ctx, b),
  );
  requestId = request.id;
  missionId = (
    await f.owner.query('SELECT mission_id FROM customer_private.owned_request WHERE id=$1', [
      requestId,
    ])
  ).rows[0].mission_id;
  publicationId = (
    await delivery.publication(staffCtx(), {
      commandId: randomUUID(),
      missionId,
      title: 'Approved hotel textiles report',
      company: 'Hospitality supplier',
      objective: 'Review permitted buyer progress',
      brief: 'Approved report without the original private contact details.',
      nextAction: 'Review qualified evidence with the operator',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    })
  ).id;
  link = await delivery.share(staffCtx(), {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publicationId],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Private report for the company that made the request',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
}, 240000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});

test('a real request is stored as real, owned by the real workspace, and staff see it as an option', async () => {
  const row = (
    await f.owner.query(
      'SELECT t.synthetic,m.purpose FROM customer_private.owned_request r JOIN app.tenant t ON t.id=r.workspace_id JOIN app.mission m ON m.id=r.mission_id AND m.tenant_id=r.mission_tenant_id WHERE r.id=$1',
      [requestId],
    )
  ).rows[0];
  expect(row).toMatchObject({ synthetic: false, purpose: 'commercial_qualification' });
  const options = await staff.options(staffCtx(), missionId);
  expect(JSON.stringify(options)).toContain(requestId);
  expect(JSON.stringify(options)).not.toMatch(/assigned-alice|business\.test|token/i);
});

test('staff assign their own reviewed report once; a retry is the same assignment and one event', async () => {
  const value = assignment();
  assignmentId = (await staff.assign(staffCtx(), value)).id;
  expect(await staff.assign(staffCtx(), value)).toEqual({ id: assignmentId });
  const events = (
    await f.owner.query(
      "SELECT id,actor_id FROM app.domain_event WHERE aggregate_type='customer_delivery_assignment' AND aggregate_id=$1",
      [assignmentId],
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(events[0].actor_id).toBe(f.users.owner.id);
  await expect(
    staff.assign(staffCtx(), { ...value, reason: 'Different assignment review' }),
  ).rejects.toMatchObject({ status: 409 });
});

test('the real customer sees the delivery without any identity or bearer; colleagues and others do not', async () => {
  const page = await assigned().list();
  expect(page.assignments).toHaveLength(1);
  expect(page.assignments[0]).toMatchObject({
    id: assignmentId,
    requestId,
    available: true,
    title: 'Approved hotel textiles report',
    savedResourceId: null,
  });
  for (const secret of [link.token, issuer, 'assigned-alice', 'token_hash'])
    expect(JSON.stringify(page)).not.toContain(secret);
  expect((await assigned('assigned-bob').list()).assignments).toEqual([]);
  await expect(
    assigned('assigned-bob').accept({ commandId: randomUUID(), assignmentId, acknowledged: true }),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    staff.assign(staffCtx(), { ...assignment(), requestId: randomUUID() }),
  ).rejects.toMatchObject({ code: '42501' });
});

test('accepting needs the acknowledgement, then saves the report and opens the original approved content', async () => {
  await expect(
    assigned().accept({ commandId: randomUUID(), assignmentId, acknowledged: false }),
  ).rejects.toThrow();
  const command = { commandId: randomUUID(), assignmentId, acknowledged: true };
  const accepted = await assigned().accept(command);
  expect(await assigned().accept(command)).toEqual(accepted);
  expect(accepted.available).toBe(true);
  const original = await saved().command({
    action: 'view',
    resourceId: accepted.id,
    audience: 'CLIENT_PROGRESS',
  });
  expect(original.report.missions[0].publicationId).toBe(publicationId);
  expect(JSON.stringify(original)).not.toContain('assigned-alice@business.test');
  expect((await assigned().list()).assignments[0].savedResourceId).toBe(accepted.id);
  expect((await saved().list()).missions.map((m: { id: string }) => m.id)).toContain(accepted.id);
});

test('a real customer can answer a staff evidence request from the saved report', async () => {
  const [{ id: savedId }] = (await saved().list()).missions;
  const request = await delivery.request(staffCtx(), {
    commandId: randomUUID(),
    publicationId,
    ownerId: f.users.owner.id,
    title: 'Supporting evidence request',
    instructions: 'Send a short written confirmation of the delivery schedule',
    dueAt: future(),
  });
  await saved().command({
    action: 'respond',
    resourceId: savedId,
    audience: 'CLIENT_PROGRESS',
    commandId: randomUUID(),
    requestId: request.id,
    body: 'The delivery schedule is confirmed for the second week of November',
    acknowledged: true,
  });
  expect(
    JSON.stringify(
      await saved().command({ action: 'view', resourceId: savedId, audience: 'CLIENT_PROGRESS' }),
    ),
  ).toContain('second week of November');
});
