import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerBillingReal } from '../../packages/db/src/customer-billing-real-migrate';
import { migrateCustomerInvoicing } from '../../packages/db/src/customer-invoicing-migrate';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureRealBilling } from '../../packages/auth/src/customer-billing-real-configuration';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import {
  CustomerBillingService,
  type BillingOverview,
  type BillingPlan,
} from '../../packages/auth/src/customer-billing';
import { CustomerInvoicingService } from '../../packages/auth/src/customer-invoicing';
import { CustomerInvoicingStaffService } from '../../packages/delivery/src/customer-invoicing-staff';
import { CustomerBillingStaffService } from '../../packages/delivery/src/customer-billing-staff';

// ADR-062: real plans and subscriptions for real workspaces. No money moves: nothing here charges, invoices or
// collects. The database control starts closed and the application switch is separate; both must be on.
let f: Awaited<ReturnType<typeof fixture>>;
let intakeTenantId: string;
let realWorkspace: string;
let otherRealWorkspace: string;
const issuer =
  'https://ep-billing-real-2-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
  expiresAt: new Date(Date.now() + 60000),
});
const svc = (subject = 'billing-real-owner') =>
  new CustomerBillingService(f.runtime, f.auth, options, sessionFor(subject));
const realStaff = () => ({ ...f.users.owner.ctx, tenantId: intakeTenantId });
const sampleStaff = () => f.users.owner.ctx;
let staff: CustomerBillingStaffService;
const planBody = (over: Record<string, unknown> = {}) => ({
  planKey: 'growth-monthly',
  expectedVersion: 0,
  title: 'Growth monthly',
  summary: 'A monthly plan for a company that runs several programmes at once.',
  interval: 'month',
  priceMinor: '4900000',
  currency: 'BDT',
  taxTreatment: 'tax_to_be_confirmed',
  included: ['A shared workspace for a team'],
  excluded: ['Any support commitment'],
  active: true,
  entitlements: [
    { key: 'workspace_members', mode: 'limit', limit: 8 },
    { key: 'active_programmes', mode: 'limit', limit: 4 },
    { key: 'programme_participants', mode: 'unlimited', limit: null },
    { key: 'open_service_requests', mode: 'limit', limit: 2 },
    { key: 'report_exports', mode: 'included', limit: null },
  ],
  ...over,
});
const revise = (ctx: ReturnType<typeof realStaff>, over: Record<string, unknown> = {}) =>
  staff.revisePlan(ctx, { commandId: randomUUID(), ...planBody(over) });
const today = () => new Date().toISOString().slice(0, 10);
async function ask(key = 'growth-monthly', subject = 'billing-real-owner', target = realWorkspace) {
  const shown = (await svc(subject).plans({ workspaceId: target })).plans.find(
    (p: BillingPlan) => p.key === key,
  )!;
  return svc(subject).command({
    action: 'request',
    commandId: randomUUID(),
    workspaceId: target,
    planKey: shown.key,
    planVersion: shown.version,
    planDigest: shown.digest,
    acknowledged: true,
  });
}
const overview = (subject = 'billing-real-owner', target = realWorkspace) =>
  svc(subject).overview({ workspaceId: target }) as Promise<BillingOverview>;
const control = async (enabled: boolean, reason = 'Local fixture control for real plan tests') =>
  configureRealBilling(f.owner, { enabled, reason });
const events = async (target: string) =>
  (
    await f.owner.query(
      "SELECT e.type,e.payload FROM app.domain_event e WHERE e.tenant_id=$1 AND e.aggregate_type IN ('customer_billing_subscription') ORDER BY e.occurred_at",
      [target],
    )
  ).rows;

beforeAll(async () => {
  vi.stubEnv('DATA_ENVIRONMENT', 'real');
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_BILLING_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED', 'true');
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
  await migrateCustomerInvoicing(f.owner);
  await migrateCustomerBillingReal(f.owner);
  staff = new CustomerBillingStaffService(
    f.runtime,
    () => process.env.CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED === 'true',
  );
  const provision = async (subject: string, name: string) =>
    (
      await new CustomerWorkspaceService(f.runtime, f.auth, options, sessionFor(subject)).provision(
        {
          commandId: randomUUID(),
          name,
        },
      )
    ).id as string;
  realWorkspace = await provision('billing-real-owner', 'Dhaka Imports');
  otherRealWorkspace = await provision('billing-real-other', 'Chattogram Exports');
}, 180000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});

test('installing is repeatable, refuses a changed history, and leaves the control closed', async () => {
  await migrateCustomerBillingReal(f.owner);
  const applied = (
    await f.owner.query('SELECT name,sha256 FROM customer_billing_real_migrations.applied')
  ).rows;
  expect(applied).toHaveLength(1);
  expect(applied[0].name).toBe('0001_real_billing.sql');
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_private.real_billing_control'))
      .rows[0].n,
  ).toBe(0);
  expect((await f.owner.query('SELECT customer_private.real_billing_open() o')).rows[0].o).toBe(
    false,
  );
  await f.owner.query('UPDATE customer_billing_real_migrations.applied SET sha256=$1', [
    createHash('sha256').update('x').digest('hex'),
  ]);
  await expect(migrateCustomerBillingReal(f.owner)).rejects.toThrow(/history mismatch/i);
  await f.owner.query('UPDATE customer_billing_real_migrations.applied SET sha256=$1', [
    applied[0].sha256,
  ]);
  await migrateCustomerBillingReal(f.owner);
});

test('with the control closed a real workspace is told plans are switched off, and nothing is recorded', async () => {
  const before = (
    await f.owner.query('SELECT count(*)::int n FROM customer_private.billing_plan_view')
  ).rows[0].n;
  await expect(svc().plans({ workspaceId: realWorkspace })).rejects.toMatchObject({
    code: '55000',
  });
  await expect(svc().overview({ workspaceId: realWorkspace })).rejects.toMatchObject({
    code: '55000',
  });
  await expect(
    svc().command({
      action: 'cancel',
      commandId: randomUUID(),
      workspaceId: realWorkspace,
      subscriptionId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: '55000' });
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_private.billing_plan_view')).rows[0]
      .n,
  ).toBe(before);
  // A person who is not in the workspace learns nothing, open or closed.
  await expect(svc('billing-real-other').plans({ workspaceId: realWorkspace })).rejects.toThrow(
    /unavailable/i,
  );
  // Staff in a real operator workspace are refused while the control is closed, and cannot write a real plan.
  await expect(staff.plans(realStaff())).rejects.toThrow();
  await expect(revise(realStaff())).rejects.toThrow();
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_plan_version(plan_key,version,title,summary,billing_interval,price_minor,currency,tax_treatment,included,excluded,active,synthetic,source,created_by,staff_tenant_id) VALUES('closed-plan',1,'Closed plan','A plan written while closed.','month',1,'BDT','tax_to_be_confirmed',ARRAY['One thing'],ARRAY['Another thing'],true,false,'STAFF',$1,$2)",
      [f.users.owner.id, intakeTenantId],
    ),
  ).rejects.toThrow(/control to be open/i);
});

test('sample workspaces and sample staff behave as before while the control is closed', async () => {
  const sample = await sampleStaff();
  const listed = await staff.plans(sample);
  expect(listed.synthetic).toBe(true);
  expect(listed.plans.map((p: { key: string }) => p.key).sort()).toEqual([
    'example-organiser',
    'example-organiser-bdt',
    'example-starter',
  ]);
  expect((await staff.list(sample)).synthetic).toBe(true);
});

test('with the control open but the application switch off, a real workspace is refused and the showing is rolled back', async () => {
  await control(true);
  await revise(realStaff());
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED', 'false');
  const before = (
    await f.owner.query('SELECT count(*)::int n FROM customer_private.billing_plan_view')
  ).rows[0].n;
  await expect(svc().plans({ workspaceId: realWorkspace })).rejects.toMatchObject({ status: 503 });
  await expect(svc().overview({ workspaceId: realWorkspace })).rejects.toMatchObject({
    status: 503,
  });
  await expect(staff.plans(realStaff())).rejects.toMatchObject({ status: 503 });
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_private.billing_plan_view')).rows[0]
      .n,
  ).toBe(before);
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED', 'true');
});

test('a real workspace reads only the real catalogue, with the whole plan and no pretence of a sale', async () => {
  const shown = await svc().plans({ workspaceId: realWorkspace });
  expect(shown.synthetic).toBe(false);
  expect(shown.canRequest).toBe(true);
  expect(shown.entitlementsEnforced).toBe(false);
  expect(shown.invoicing).toBe('not_enabled');
  expect(shown.paymentTaken).toBe(false);
  expect(shown.plans.map((p: BillingPlan) => p.key)).toEqual(['growth-monthly']);
  expect(shown.plans[0]).toMatchObject({
    title: 'Growth monthly',
    priceMinor: '4900000',
    currency: 'BDT',
    taxTreatment: 'tax_to_be_confirmed',
    synthetic: false,
  });
  expect(shown.plans[0].entitlements).toHaveLength(5);
  // The sample catalogue is not offered to a real workspace and cannot be requested by it.
  const sample = shown.plans.find((p: BillingPlan) => p.key.startsWith('example-'));
  expect(sample).toBeUndefined();
  const sampleRow = (
    await f.owner.query(
      "SELECT id FROM customer_private.billing_plan_version WHERE plan_key='example-starter'",
    )
  ).rows[0];
  expect(sampleRow).toBeTruthy();
  await expect(
    svc().command({
      action: 'request',
      commandId: randomUUID(),
      workspaceId: realWorkspace,
      planKey: 'example-starter',
      planVersion: 1,
      planDigest: 'a'.repeat(64),
      acknowledged: true,
    }),
  ).rejects.toThrow();
});

test('real plan rules: a real plan never claims to be a sample, never borrows an example key, and keys stay in one catalogue', async () => {
  await expect(
    revise(realStaff(), { planKey: 'real-sample-plan', title: 'Sample growth plan' }),
  ).rejects.toThrow();
  await expect(
    revise(realStaff(), { planKey: 'example-growth', title: 'Growth plan' }),
  ).rejects.toThrow();
  await expect(
    revise(realStaff(), { planKey: 'example-starter', expectedVersion: 1, title: 'Starter' }),
  ).rejects.toThrow(/other catalogue/i);
  // Sample staff cannot take over a real key, and cannot write a sample plan without saying so.
  await expect(
    revise(sampleStaff(), { title: 'Synthetic growth plan', expectedVersion: 1 }),
  ).rejects.toThrow(/other catalogue/i);
  await expect(
    revise(sampleStaff(), { planKey: 'sample-ok', title: 'Growth plan' }),
  ).rejects.toThrow();
  const ok = await revise(sampleStaff(), { planKey: 'sample-ok', title: 'Sample growth plan' });
  expect(ok).toMatchObject({ planKey: 'sample-ok', version: 1, synthetic: true });
  // A real workspace never sees it; a sample workspace never sees the real one.
  expect(
    (await svc().plans({ workspaceId: realWorkspace })).plans.map((p: BillingPlan) => p.key),
  ).toEqual(['growth-monthly']);
  const realOnly = await staff.plans(realStaff());
  expect(realOnly.synthetic).toBe(false);
  expect(realOnly.plans.map((p: { key: string }) => p.key)).toEqual(['growth-monthly']);
});

test('a real plan revision is a new immutable version, and an old version cannot be requested', async () => {
  const v1 = (await svc().plans({ workspaceId: realWorkspace })).plans[0] as BillingPlan;
  const v2 = await revise(realStaff(), { expectedVersion: 1, priceMinor: '5200000' });
  expect(v2).toMatchObject({ version: 2, synthetic: false });
  await expect(revise(realStaff(), { expectedVersion: 1 })).rejects.toThrow(/changed/i);
  await expect(
    svc().command({
      action: 'request',
      commandId: randomUUID(),
      workspaceId: realWorkspace,
      planKey: v1.key,
      planVersion: v1.version,
      planDigest: v1.digest,
      acknowledged: true,
    }),
  ).rejects.toThrow();
  await expect(
    f.owner.query(
      "UPDATE customer_private.billing_plan_version SET price_minor=1 WHERE plan_key='growth-monthly'",
    ),
  ).rejects.toThrow();
  await expect(
    f.owner.query(
      "DELETE FROM customer_private.billing_plan_version WHERE plan_key='growth-monthly'",
    ),
  ).rejects.toThrow();
});

test('the real lifecycle: show, ask, activate, hold, renew, cancel, keep and end, with exact money and no payment', async () => {
  await expect(ask('growth-monthly', 'billing-real-other')).rejects.toThrow(
    /unavailable|owner or admin/i,
  );
  const asked = await ask();
  expect(asked).toMatchObject({
    status: 'requested',
    planKey: 'growth-monthly',
    planVersion: 2,
    priceMinor: '5200000',
    currency: 'BDT',
    synthetic: false,
  });
  const first = await overview();
  expect(first.synthetic).toBe(false);
  expect(first.pending).toMatchObject({ id: asked.id, status: 'requested' });
  expect(first.actions).toEqual(['withdraw']);
  const row = (await staff.list(realStaff())).subscriptions.find(
    (s: { id: string }) => s.id === asked.id,
  );
  expect(row).toMatchObject({ workspaceName: 'Dhaka Imports', status: 'requested' });
  // Sample staff see no real subscription and cannot open one.
  expect(
    (await staff.list(sampleStaff())).subscriptions.some((s: { id: string }) => s.id === asked.id),
  ).toBe(false);
  await expect(staff.view(sampleStaff(), asked.id)).rejects.toThrow(/unavailable/i);
  const detail = await staff.view(realStaff(), asked.id);
  expect(detail.synthetic).toBe(false);
  expect(detail.plan).toMatchObject({ key: 'growth-monthly', version: 2, synthetic: false });
  const note = 'Welcome. Your plan starts today and is recorded only, nothing is charged yet.';
  await staff.command(realStaff(), {
    action: 'activate',
    commandId: randomUUID(),
    subscriptionId: asked.id,
    expectedSeq: detail.lastSeq,
    periodStart: today(),
    customerNote: note,
  });
  const held = await overview();
  expect(held.current).toMatchObject({ id: asked.id, status: 'active', periodElapsed: false });
  expect(held.entitlements).toHaveLength(5);
  expect(held.entitlementsEnforced).toBe(false);
  expect(held.paymentTaken).toBe(false);
  expect(held.invoicing).toBe('not_enabled');
  expect(held.actions).toEqual(['request', 'cancel']);
  expect(held.subscriptions[0].timeline.find((e) => e.kind === 'activated')?.note).toBe(note);
  const afterActivation = await staff.view(realStaff(), asked.id);
  await staff.command(realStaff(), {
    action: 'note',
    commandId: randomUUID(),
    subscriptionId: asked.id,
    expectedSeq: afterActivation.lastSeq,
    internalNote: 'Agreed on a call, bank details to follow',
  });
  // The internal note is never shown to the customer.
  expect(JSON.stringify(await overview())).not.toContain('bank details');
  const cancel = await svc().command({
    action: 'cancel',
    commandId: randomUUID(),
    workspaceId: realWorkspace,
    subscriptionId: asked.id,
  });
  expect(cancel.status).toBe('cancel_scheduled');
  const keep = await svc().command({
    action: 'keep',
    commandId: randomUUID(),
    workspaceId: realWorkspace,
    subscriptionId: asked.id,
  });
  expect(keep.status).toBe('active');
  const now = await staff.view(realStaff(), asked.id);
  await staff.command(realStaff(), {
    action: 'renew',
    commandId: randomUUID(),
    subscriptionId: asked.id,
    expectedSeq: now.lastSeq,
    customerNote: null,
  });
  const renewed = await staff.view(realStaff(), asked.id);
  await staff.command(realStaff(), {
    action: 'end',
    commandId: randomUUID(),
    subscriptionId: asked.id,
    expectedSeq: renewed.lastSeq,
    customerNote: 'Ended at your request after the call, thank you for trying it.',
  });
  expect((await overview()).current).toBeNull();
  // No invoice of any kind was created.
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.invoicing_invoice WHERE tenant_id=$1',
        [realWorkspace],
      )
    ).rows[0].n,
  ).toBe(0);
});

test('events for a real workspace carry ids, versions and the real flag, never text or amounts', async () => {
  const rows = await events(realWorkspace);
  expect(rows.length).toBeGreaterThan(5);
  for (const row of rows) {
    expect(row.payload.synthetic).toBe(false);
    expect(
      Object.keys(row.payload)
        .sort()
        .every((k) =>
          [
            'subscriptionId',
            'seq',
            'status',
            'planKey',
            'planVersion',
            'synthetic',
            'initiator_kind',
            'initiator_id',
          ].includes(k),
        ),
    ).toBe(true);
    expect(JSON.stringify(row.payload)).not.toMatch(/5200000|BDT|bank|Welcome/);
  }
});

test('one plan at a time and one open request, per real workspace, under concurrency', async () => {
  const second = await revise(realStaff(), {
    planKey: 'scale-yearly',
    title: 'Scale yearly',
    interval: 'year',
    priceMinor: '52000000',
  });
  expect(second.version).toBe(1);
  const [a, b] = await Promise.allSettled([
    ask('growth-monthly', 'billing-real-other', otherRealWorkspace),
    ask('scale-yearly', 'billing-real-other', otherRealWorkspace),
  ]);
  expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
});

test('the record is kept when the control is paused, and the workspace is told plans are switched off', async () => {
  await control(false, 'Pausing real plans for the fixture check');
  await expect(overview()).rejects.toMatchObject({ code: '55000' });
  await expect(staff.list(realStaff())).rejects.toThrow();
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.billing_subscription WHERE tenant_id=$1',
        [realWorkspace],
      )
    ).rows[0].n,
  ).toBe(1);
  await control(true);
  expect((await overview()).subscriptions).toHaveLength(1);
});

test('the table refuses a real workspace holding a sample plan and refuses sample notes without the prefix', async () => {
  const sample = (
    await f.owner.query(
      "SELECT id,billing_interval FROM customer_private.billing_plan_version WHERE plan_key='example-starter' AND version=1",
    )
  ).rows[0];
  const principal = (
    await f.owner.query(
      "SELECT id FROM customer_private.principal WHERE subject='billing-real-owner'",
    )
  ).rows[0].id;
  const sub = randomUUID();
  await f.owner.query(
    'INSERT INTO customer_private.billing_subscription(id,tenant_id,created_by,plan_id,billing_interval,plan_digest) VALUES($1,$2,$3,$4,$5,$6)',
    [sub, otherRealWorkspace, principal, sample.id, sample.billing_interval, 'a'.repeat(64)],
  );
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_subscription_event(subscription_id,tenant_id,seq,kind,status_after,actor_kind,customer_actor) VALUES($1,$2,1,'requested','requested','customer',$3)",
      [sub, otherRealWorkspace, principal],
    ),
  ).rejects.toThrow(/other catalogue/i);
  const sampleTenant = (
    await f.owner.query(
      'SELECT tenant_id FROM customer.workspace w JOIN app.tenant t ON t.id=w.tenant_id WHERE t.synthetic LIMIT 1',
    )
  ).rows[0]?.tenant_id;
  if (sampleTenant) {
    const s2 = randomUUID();
    await f.owner.query(
      'INSERT INTO customer_private.billing_subscription(id,tenant_id,created_by,plan_id,billing_interval,plan_digest) VALUES($1,$2,$3,$4,$5,$6)',
      [s2, sampleTenant, principal, sample.id, sample.billing_interval, 'a'.repeat(64)],
    );
    await expect(
      f.owner.query(
        "INSERT INTO customer_private.billing_subscription_event(subscription_id,tenant_id,seq,kind,status_after,actor_kind,staff_actor,staff_tenant_id,customer_note) VALUES($1,$2,1,'requested','requested','customer',NULL,NULL,'No prefix')",
        [s2, sampleTenant],
      ),
    ).rejects.toThrow();
  }
});

test('invoicing is untouched: a real workspace still gets no invoice view and real staff cannot reach invoicing', async () => {
  const invoicing = new CustomerInvoicingService(
    f.runtime,
    f.auth,
    options,
    sessionFor('billing-real-owner'),
  );
  await expect(invoicing.overview({ workspaceId: realWorkspace })).rejects.toThrow();
  const invoicingStaff = new CustomerInvoicingStaffService(f.runtime);
  await expect(invoicingStaff.list(realStaff())).rejects.toThrow();
  await expect(invoicingStaff.pending(realStaff())).rejects.toThrow();
});

test('runtime logins reach the functions and no table of the new module', async () => {
  await expect(
    rawContext(f.runtime, realStaff(), 'SELECT * FROM customer_private.real_billing_control', []),
  ).rejects.toThrow(/permission denied/i);
  await expect(
    rawContext(f.runtime, realStaff(), 'SELECT customer_private.real_billing_open()', []),
  ).rejects.toThrow(/permission denied/i);
  await expect(
    rawContext(f.runtime, realStaff(), 'SELECT customer_private.billing_workspace_role($1,$2)', [
      realWorkspace,
      randomUUID(),
    ]),
  ).rejects.toThrow(/permission denied/i);
});
