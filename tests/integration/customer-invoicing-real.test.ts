import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { rawContext } from './support';
import { realStaffFixture } from './real-staff-fixture';
import { migrateCustomerInvoicingReal } from '../../packages/db/src/customer-invoicing-real-migrate';
import { configureRealBilling } from '../../packages/auth/src/customer-billing-real-configuration';
import {
  configureRealInvoicing,
  defaultRealInvoicingEntity,
} from '../../packages/auth/src/customer-invoicing-real-configuration';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerBillingService, type BillingPlan } from '../../packages/auth/src/customer-billing';
import {
  CustomerRealInvoicingService,
  type RealInvoice,
} from '../../packages/auth/src/customer-invoicing-real';
import { CustomerBillingStaffService } from '../../packages/delivery/src/customer-billing-staff';
import { CustomerRealInvoicingStaffService } from '../../packages/delivery/src/customer-invoicing-real-staff';
import { CustomerInvoicingStaffService } from '../../packages/delivery/src/customer-invoicing-staff';

// ADR-064: real invoices, payment records and credit notes (billing stage 2). Nothing is collected: no processor, card or
// bank account is involved. The control starts closed, the application switch is separate, and an invoice or credit note
// is prepared by one staff person and approved by a second unless the owner records otherwise.
const issuer =
  'https://ep-invoicing-real-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
let otherWorkspaceId: string;
let memberWorkspaceId: string;
let subscriptionId: string;
let periodStart: string;
let second: {
  id: string;
  ctx: { token: string; tenantId: string; purpose: string };
  email: string;
};
let billing: CustomerBillingStaffService;
let staff: CustomerRealInvoicingStaffService;
const runtime = () => [s.f.runtime, s.f.auth, options] as const;
const customer = (who = 'inv-owner') =>
  new CustomerRealInvoicingService(...runtime(), sessionFor(who));
const plans = (who = 'inv-owner') => new CustomerBillingService(...runtime(), sessionFor(who));
const first = () => s.ctx;
const utcToday = () => new Date().toISOString().slice(0, 10);
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const singaporeYear = () => Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 4));
const number = (prefix: string, seq: number) =>
  `${prefix}-${singaporeYear()}-${String(seq).padStart(6, '0')}`;
const control = (over: Record<string, unknown> = {}) =>
  configureRealInvoicing(s.f.owner, {
    reason: 'Local fixture control for real invoicing tests',
    ...over,
  });

async function addStaff(label: string, role: 'owner' | 'admin') {
  const id = randomUUID();
  const identityId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const sessionId = randomUUID();
  const email = `${label}@example.invalid`;
  const client = await s.f.owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [s.f.serviceId, randomUUID(), randomUUID()],
    );
    await client.query(
      'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,true,true)',
      [identityId, 'Staff ' + label, email],
    );
    await client.query(
      "INSERT INTO identity.principal(id,identity_id,operating_country) VALUES($1,$2,'DE')",
      [id, identityId],
    );
    await client.query(
      'INSERT INTO identity.session(id,"userId",token,"expiresAt") VALUES($1,$2,$3,now()+interval \'1 hour\')',
      [sessionId, identityId, token],
    );
    await client.query("INSERT INTO identity.assurance VALUES($1,now(),'totp')", [sessionId]);
    await client.query(
      `INSERT INTO app.membership(tenant_id,user_id,role,allowed_purposes,allowed_classifications,allowed_countries)
      SELECT tenant_id,$3,$4,allowed_purposes,allowed_classifications,allowed_countries FROM app.membership WHERE tenant_id=$1 AND user_id=$2`,
      [s.intakeTenantId, s.f.users.owner.id, id, role],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return {
    id,
    email,
    ctx: { token, tenantId: s.intakeTenantId, purpose: 'commercial_qualification' },
  };
}
const prepare = (over: Record<string, unknown> = {}, who = first()) =>
  staff.command(who, {
    action: 'prepare_invoice',
    commandId: randomUUID(),
    subscriptionId,
    periodStart,
    dueOn: days(30),
    billToName: 'Dhaka Imports Limited',
    billToAddress: 'House 12, Road 5, Gulshan, Dhaka 1212, Bangladesh',
    ...over,
  });
const decide = (
  proposalId: string,
  decision: 'approve' | 'reject' = 'approve',
  who = second.ctx,
  reason?: string,
) =>
  staff.command(who, {
    action: 'decide',
    commandId: randomUUID(),
    proposalId,
    decision,
    ...(reason ? { reason } : {}),
  });
const issue = async (over: Record<string, unknown> = {}) => {
  const proposal = await prepare(over);
  return decide(proposal.proposalId);
};
const pendingPeriods = async () => (await staff.pending(first())).periods;

async function writePlanAndActivate(
  workspace: string,
  who: string,
  key: string,
  over: Record<string, unknown> = {},
) {
  const body = {
    planKey: key,
    expectedVersion: 0,
    title: 'Growth monthly ' + key,
    summary: 'A monthly plan for a company that runs several programmes at once.',
    interval: 'month',
    priceMinor: '10000',
    currency: 'SGD',
    taxTreatment: 'price_excludes_tax',
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
  };
  await billing.revisePlan(first(), { commandId: randomUUID(), ...body });
  const shown = (await plans(who).plans({ workspaceId: workspace })).plans.find(
    (p: BillingPlan) => p.key === key,
  )!;
  const asked = await plans(who).command({
    action: 'request',
    commandId: randomUUID(),
    workspaceId: workspace,
    planKey: shown.key,
    planVersion: shown.version,
    planDigest: shown.digest,
    acknowledged: true,
  });
  const detail = await billing.view(first(), asked.id);
  await billing.command(first(), {
    action: 'activate',
    commandId: randomUUID(),
    subscriptionId: asked.id,
    expectedSeq: detail.lastSeq,
    periodStart: utcToday(),
    customerNote: 'Welcome. Your plan starts today and is recorded.',
  });
  return asked.id as string;
}

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-invoicing-fixture-secret');
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_BILLING_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED', 'true');
  await migrateCustomerInvoicingReal(s.f.owner);
  billing = new CustomerBillingStaffService(
    s.f.runtime,
    () => process.env.CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED === 'true',
  );
  staff = new CustomerRealInvoicingStaffService(s.f.runtime);
  second = await addStaff('finance-second', 'admin');
  const provision = async (who: string, name: string) =>
    (
      await new CustomerWorkspaceService(...runtime(), sessionFor(who)).provision({
        commandId: randomUUID(),
        name,
      })
    ).id as string;
  workspaceId = await provision('inv-owner', 'Dhaka Imports');
  otherWorkspaceId = await provision('inv-other', 'Chattogram Exports');
  memberWorkspaceId = workspaceId;
  // A plain member of the first workspace.
  const invitation = await new CustomerWorkspaceService(
    ...runtime(),
    sessionFor('inv-owner'),
  ).access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Finance colleague',
  });
  await new CustomerWorkspaceService(...runtime(), sessionFor('inv-member')).access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token!,
  });
  await configureRealBilling(s.f.owner, {
    enabled: true,
    reason: 'Local fixture control for real invoicing tests',
  });
  subscriptionId = await writePlanAndActivate(workspaceId, 'inv-owner', 'growth-sgd');
  periodStart = utcToday();
}, 300000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

test('installing is repeatable, refuses a changed history, leaves the control closed and does nothing for sample invoicing', async () => {
  await migrateCustomerInvoicingReal(s.f.owner);
  const applied = (
    await s.f.owner.query('SELECT name,sha256 FROM customer_invoicing_real_migrations.applied')
  ).rows;
  expect(applied.map((r: { name: string }) => r.name)).toEqual(['0001_real_invoicing.sql']);
  expect(
    (await s.f.owner.query('SELECT count(*)::int n FROM customer_private.real_invoicing_control'))
      .rows[0].n,
  ).toBe(0);
  expect((await s.f.owner.query('SELECT customer_private.real_invoicing_open() o')).rows[0].o).toBe(
    false,
  );
  await s.f.owner.query('UPDATE customer_invoicing_real_migrations.applied SET sha256=$1', [
    createHash('sha256').update('x').digest('hex'),
  ]);
  await expect(migrateCustomerInvoicingReal(s.f.owner)).rejects.toThrow(/history mismatch/i);
  await s.f.owner.query('UPDATE customer_invoicing_real_migrations.applied SET sha256=$1', [
    applied[0].sha256,
  ]);
  await migrateCustomerInvoicingReal(s.f.owner);
  // The sample module and its tables are untouched.
  expect(
    (await s.f.owner.query('SELECT count(*)::int n FROM customer_private.invoicing_invoice'))
      .rows[0].n,
  ).toBe(0);
});

test('with the control closed a real workspace is told invoices are switched off, and staff are refused', async () => {
  await expect(customer().overview({ workspaceId })).rejects.toMatchObject({ code: '55000' });
  await expect(staff.pending(first())).rejects.toMatchObject({ status: 503 });
  await expect(prepare()).rejects.toMatchObject({ status: 503 });
  // A person outside the workspace learns nothing, open or closed.
  await expect(customer('inv-other').overview({ workspaceId })).rejects.toThrow(/unavailable/i);
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED', 'false');
  await expect(customer().overview({ workspaceId })).rejects.toMatchObject({ status: 503 });
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED', 'true');
});

test('install seeds the supplier details with every made-up field marked, and the control stays closed until enabled', async () => {
  const seeded = await control({});
  expect(seeded).toMatchObject({
    enabled: false,
    requireSecondApprover: true,
    entityChanged: true,
  });
  const entity = (
    await s.f.owner.query('SELECT * FROM customer_private.real_invoicing_entity ORDER BY version')
  ).rows;
  expect(entity).toHaveLength(1);
  expect(entity[0]).toMatchObject({
    version: 1,
    legal_name: 'Corridra Pte Ltd',
    address: '101 Robinson Road, Singapore 180239',
    country: 'SG',
    gst_rate_bps: 900,
    payment_terms_days: 30,
  });
  expect(entity[0].placeholder_fields.sort()).toEqual(
    [
      'finance_label',
      'gst_registered',
      'gst_registration_no',
      'payment_instructions',
      'uen',
    ].sort(),
  );
  for (const field of ['uen', 'gst_registration_no', 'payment_instructions', 'finance_label'])
    expect(entity[0][field]).toContain('(madeup)');
  // Running install again changes nothing.
  expect(await control({})).toMatchObject({ entityChanged: false, controlChanged: false });
  await expect(
    s.f.owner.query('UPDATE customer_private.real_invoicing_entity SET legal_name=$1', ['Other']),
  ).rejects.toThrow();
  expect((await s.f.owner.query('SELECT customer_private.real_invoicing_open() o')).rows[0].o).toBe(
    false,
  );
  await control({ enabled: true });
  expect((await s.f.owner.query('SELECT customer_private.real_invoicing_open() o')).rows[0].o).toBe(
    true,
  );
});

test('staff see the period that needs an invoice and the supplier details in force', async () => {
  const pending = await staff.pending(first());
  expect(pending.secondApproverRequired).toBe(true);
  expect(pending.supplier).toMatchObject({
    legalName: 'Corridra Pte Ltd',
    gstRegistered: true,
    gstRateBps: 900,
  });
  expect(pending.supplier.madeupFields).toContain('gst_registration_no');
  expect(pending.periods).toHaveLength(1);
  expect(pending.periods[0]).toMatchObject({
    subscriptionId,
    periodStart,
    priceMinor: '10000',
    currency: 'SGD',
    taxTreatment: 'price_excludes_tax',
  });
});

test('a sample operator workspace cannot prepare or approve a real invoice, and a real operator cannot reach a sample one', async () => {
  await expect(
    staff.command(s.f.users.owner.ctx, {
      action: 'prepare_invoice',
      commandId: randomUUID(),
      subscriptionId,
      periodStart,
      dueOn: days(30),
      billToName: 'Dhaka Imports Limited',
      billToAddress: 'House 12, Road 5, Gulshan, Dhaka 1212, Bangladesh',
    }),
  ).rejects.toThrow();
  await expect(staff.pending(s.f.users.owner.ctx)).rejects.toThrow();
  await expect(new CustomerInvoicingStaffService(s.f.runtime).pending(first())).rejects.toThrow();
  for (const role of ['operator', 'reviewer', 'viewer'] as const)
    await expect(
      staff.pending({
        ...s.f.users[role].ctx,
        tenantId: s.intakeTenantId,
        purpose: 'commercial_qualification',
      }),
    ).rejects.toThrow();
});

test('an invoice is prepared by one person and issued by a second, with GST in exact minor units and a legal number', async () => {
  const prepared = await prepare();
  expect(prepared).toMatchObject({
    kind: 'invoice',
    state: 'waiting_for_approval',
    secondApproverRequired: true,
  });
  const waiting = (await staff.pending(first())).proposals;
  expect(waiting).toHaveLength(1);
  expect(waiting[0]).toMatchObject({
    id: prepared.proposalId,
    preparedByYou: true,
    billToName: 'Dhaka Imports Limited',
    preview: { currency: 'SGD', feeMinor: '10000', taxMinor: '900', totalMinor: '10900' },
  });
  // The period no longer shows as waiting to be invoiced, and cannot be prepared twice.
  expect(await pendingPeriods()).toEqual([]);
  await expect(prepare()).rejects.toThrow(/already invoiced or waiting/i);
  // The preparer cannot approve their own.
  await expect(decide(prepared.proposalId, 'approve', first())).rejects.toThrow(/second person/i);
  // Nothing was issued yet.
  expect(
    (await s.f.owner.query('SELECT count(*)::int n FROM customer_private.real_invoice')).rows[0].n,
  ).toBe(0);
  const approved = await decide(prepared.proposalId);
  expect(approved.state).toBe('issued');
  const invoice = approved.invoice as RealInvoice & { selfApproved: boolean };
  expect(invoice).toMatchObject({
    number: number('INV', 1),
    title: 'Tax Invoice',
    currency: 'SGD',
    taxTreatment: 'price_excludes_tax',
    gstRegistered: true,
    taxLabel: 'GST',
    taxRateBps: 900,
    planFeeMinor: '10000',
    taxMinor: '900',
    amountExcludingTaxMinor: '10000',
    totalMinor: '10900',
    paidMinor: '0',
    creditedMinor: '0',
    outstandingMinor: '10900',
    status: 'unpaid',
    overdue: false,
    selfApproved: false,
    billTo: { name: 'Dhaka Imports Limited' },
    supplier: { legalName: 'Corridra Pte Ltd', address: '101 Robinson Road, Singapore 180239' },
    moneyDomain: 'B',
    synthetic: false,
  });
  // Made-up supplier data is stated on the face of the document.
  expect(invoice.madeupFields).toContain('gst_registration_no');
  expect(invoice.label).toMatch(/madeup/);
  expect(invoice.label).toMatch(/Not a valid tax invoice/);
  expect(invoice.supplier.gstRegistrationNo).toContain('(madeup)');
  // Already decided.
  await expect(decide(prepared.proposalId)).rejects.toThrow(/already been decided/i);
});

test('a real owner or admin reads the invoice with exact money and no internal detail; a member sees only that invoices exist', async () => {
  const seen = await customer().overview({ workspaceId });
  expect(seen.synthetic).toBe(false);
  expect(seen.canRead).toBe(true);
  expect(seen.paymentTaken).toBe(false);
  expect(seen.invoices).toHaveLength(1);
  expect(seen.invoices[0]).toMatchObject({
    number: number('INV', 1),
    totalMinor: '10900',
    status: 'unpaid',
  });
  expect(seen.balances).toEqual([
    {
      currency: 'SGD',
      invoicedMinor: '10900',
      paidMinor: '0',
      creditedMinor: '0',
      outstandingMinor: '10900',
      overdueMinor: '0',
    },
  ]);
  const text = JSON.stringify(seen);
  expect(text).not.toMatch(/selfApproved|preparedBy|issuedBy|position|reference|recordedAt/);
  const member = await customer('inv-member').overview({ workspaceId });
  expect(member).toMatchObject({ canRead: false, invoicesExist: true, invoices: [], balances: [] });
  await expect(customer('inv-other').overview({ workspaceId })).rejects.toThrow(/unavailable/i);
  // The other workspace has none.
  expect(await customer('inv-other').overview({ workspaceId: otherWorkspaceId })).toMatchObject({
    invoicesExist: false,
    invoices: [],
  });
  // A real session cannot read invoices through the sample overview, and the sample overview refuses a real workspace.
  await expect(
    s.f.runtime.query('SELECT customer.invoicing_overview($1)', [workspaceId]),
  ).rejects.toMatchObject({ code: '42501' });
});

test('payments are exact, in order, never above what is outstanding and never future dated; a stale screen is refused', async () => {
  const listed = (await staff.list(first())).invoices as (RealInvoice & { position: number })[];
  const inv = listed[0];
  const pay = (over: Record<string, unknown>) =>
    staff.command(first(), {
      action: 'payment',
      commandId: randomUUID(),
      invoiceId: inv.id,
      expectedPosition: 0,
      amountMinor: '4000',
      receivedOn: utcToday(),
      method: 'bank_transfer',
      reference: 'Transfer received from Dhaka Imports',
      ...over,
    });
  await expect(pay({ amountMinor: '10901' })).rejects.toThrow(/more than is still outstanding/i);
  await expect(pay({ receivedOn: days(3) })).rejects.toThrow(/future/i);
  await expect(pay({ reference: 'See https://example.test/receipt' })).rejects.toThrow();
  await expect(pay({ reference: 'Mail me@business.test' })).rejects.toThrow();
  const first1 = await pay({});
  expect(first1.invoice).toMatchObject({
    status: 'partly_paid',
    paidMinor: '4000',
    outstandingMinor: '6900',
  });
  await expect(pay({ expectedPosition: 0 })).rejects.toThrow(/changed; reload/i);
  const second1 = await pay({ expectedPosition: 1, amountMinor: '6900' });
  expect(second1.invoice).toMatchObject({
    status: 'paid',
    paidMinor: '10900',
    outstandingMinor: '0',
  });
  await expect(pay({ expectedPosition: 2, amountMinor: '1' })).rejects.toThrow(
    /more than is still outstanding/i,
  );
  // The customer sees amounts and dates but not the reference.
  const seen = await customer().overview({ workspaceId });
  expect(seen.invoices[0].status).toBe('paid');
  expect(seen.invoices[0].payments).toEqual([
    { seq: 1, amountMinor: '4000', receivedOn: utcToday(), method: 'bank_transfer' },
    { seq: 2, amountMinor: '6900', receivedOn: utcToday(), method: 'bank_transfer' },
  ]);
  expect(JSON.stringify(seen)).not.toContain('Transfer received');
});

test('a credit note is prepared and approved the same way, numbered in its own series, and cannot exceed what is unpaid', async () => {
  // Fully paid: nothing left to credit.
  const inv = ((await staff.list(first())).invoices as (RealInvoice & { position: number })[])[0];
  await expect(
    staff.command(first(), {
      action: 'prepare_credit',
      commandId: randomUUID(),
      invoiceId: inv.id,
      expectedPosition: inv.position,
      amountMinor: '1',
      reason: 'Customer asked for a correction to the bill',
    }),
  ).rejects.toThrow(/more than is still unpaid/i);
});

test('a second invoice continues the legal number, rounding GST half up, with a tax-inclusive price keeping the total', async () => {
  // A second subscription with a tax-inclusive price that needs rounding: 10001 includes 826 of GST (825.8).
  const sub = await writePlanAndActivate(otherWorkspaceId, 'inv-other', 'growth-inclusive', {
    priceMinor: '10001',
    taxTreatment: 'price_includes_tax',
  });
  const result = await decideNew(sub);
  expect(result.invoice).toMatchObject({
    number: number('INV', 2),
    planFeeMinor: '10001',
    taxMinor: '826',
    amountExcludingTaxMinor: '9175',
    totalMinor: '10001',
    taxTreatment: 'price_includes_tax',
  });
  // An exclusive price that lands on a half rounds up: 1050 at 9% is 94.5, so 95.
  const half = await writePlanAndActivate(otherWorkspaceId, 'inv-other', 'growth-half', {
    priceMinor: '1050',
  });
  const halfResult = await decideNew(half);
  expect(halfResult.invoice).toMatchObject({
    number: number('INV', 3),
    taxMinor: '95',
    totalMinor: '1145',
  });
});
async function decideNew(sub: string) {
  const proposal = await staff.command(first(), {
    action: 'prepare_invoice',
    commandId: randomUUID(),
    subscriptionId: sub,
    periodStart: utcToday(),
    dueOn: days(14),
    billToName: 'Chattogram Exports Limited',
    billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
  });
  return decide(proposal.proposalId);
}

test('credit notes: prepared and approved like invoices, numbered in their own series, exact, and refused once the invoice changed', async () => {
  const list = async () =>
    (await staff.list(first())).invoices as (RealInvoice & { position: number })[];
  const inv = (await list()).find((i) => i.number === number('INV', 2))!;
  const credit = (
    amount: string,
    expectedPosition: number,
    reason = 'Customer asked for a correction to the bill',
  ) =>
    staff.command(first(), {
      action: 'prepare_credit',
      commandId: randomUUID(),
      invoiceId: inv.id,
      expectedPosition,
      amountMinor: amount,
      reason,
    });
  await expect(credit('10002', inv.position)).rejects.toThrow(/more than is still unpaid/i);
  await expect(credit('2000', inv.position + 1)).rejects.toThrow(/changed; reload/i);
  await expect(credit('2000', inv.position, 'See https://example.test/why')).rejects.toThrow();
  const prepared = await credit('2000', inv.position);
  // Only one credit note can wait for approval on an invoice at a time.
  await expect(credit('100', inv.position)).rejects.toThrow(/already waiting/i);
  await expect(decide(prepared.proposalId, 'approve', first())).rejects.toThrow(/second person/i);
  const approved = await decide(prepared.proposalId);
  expect(approved.invoice).toMatchObject({
    creditedMinor: '2000',
    outstandingMinor: '8001',
    status: 'unpaid',
    credits: [{ seq: 1, number: number('CN', 1), amountMinor: '2000' }],
  });
  // A credit note waiting while the invoice changes is refused at approval, and the invoice is not touched.
  const stale = await credit('1000', inv.position + 1);
  await staff.command(first(), {
    action: 'payment',
    commandId: randomUUID(),
    invoiceId: inv.id,
    expectedPosition: inv.position + 1,
    amountMinor: '8000',
    receivedOn: utcToday(),
    method: 'bank_transfer',
    reference: 'Transfer received from Chattogram Exports',
  });
  await expect(decide(stale.proposalId)).rejects.toThrow(
    /changed after this credit note was prepared/i,
  );
  const after = (await list()).find((i) => i.id === inv.id)!;
  expect(after).toMatchObject({
    creditedMinor: '2000',
    paidMinor: '8000',
    outstandingMinor: '1',
    status: 'partly_paid',
  });
  // The customer sees the credit note number and reason.
  const seen = await customer('inv-other').overview({ workspaceId: otherWorkspaceId });
  const mine = seen.invoices.find((i) => i.number === number('INV', 2))!;
  expect(mine.credits[0]).toMatchObject({
    number: number('CN', 1),
    reason: 'Customer asked for a correction to the bill',
  });
  // A rejection needs a reason and ends the proposal.
  const rejected = await decide(
    stale.proposalId,
    'reject',
    second.ctx,
    'The invoice changed so this is withdrawn',
  );
  expect(rejected.state).toBe('rejected');
});

test('a rejected invoice proposal frees the period to be prepared again, with the reason kept', async () => {
  const sub = await writePlanAndActivate(otherWorkspaceId, 'inv-other', 'growth-reject');
  const p1 = await staff.command(first(), {
    action: 'prepare_invoice',
    commandId: randomUUID(),
    subscriptionId: sub,
    periodStart: utcToday(),
    dueOn: days(30),
    billToName: 'Chattogram Exports Limited',
    billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
  });
  await expect(decide(p1.proposalId, 'reject', second.ctx)).rejects.toThrow();
  const rejected = await decide(
    p1.proposalId,
    'reject',
    second.ctx,
    'The billing address needs checking first',
  );
  expect(rejected.state).toBe('rejected');
  expect(
    (await pendingPeriods()).some((p: { subscriptionId: string }) => p.subscriptionId === sub),
  ).toBe(true);
  const reason = (
    await s.f.owner.query(
      'SELECT decision,reason FROM customer_private.real_invoicing_decision WHERE proposal_id=$1',
      [p1.proposalId],
    )
  ).rows[0];
  expect(reason).toMatchObject({
    decision: 'rejected',
    reason: 'The billing address needs checking first',
  });
  const again = await staff.command(first(), {
    action: 'prepare_invoice',
    commandId: randomUUID(),
    subscriptionId: sub,
    periodStart: utcToday(),
    dueOn: days(30),
    billToName: 'Chattogram Exports Limited',
    billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh, corrected',
  });
  const issued = await decide(again.proposalId);
  expect(issued.invoice.number).toBe(number('INV', 4));
});

test('numbers stay gap free and unique when two invoices are approved at the same moment', async () => {
  const subs: string[] = [];
  for (const key of ['growth-race-a', 'growth-race-b'])
    subs.push(await writePlanAndActivate(otherWorkspaceId, 'inv-other', key));
  const proposals = [];
  for (const sub of subs)
    proposals.push(
      await staff.command(first(), {
        action: 'prepare_invoice',
        commandId: randomUUID(),
        subscriptionId: sub,
        periodStart: utcToday(),
        dueOn: days(30),
        billToName: 'Chattogram Exports Limited',
        billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
      }),
    );
  const results = await Promise.all(proposals.map((p) => decide(p.proposalId)));
  const numbers = results.map((r) => r.invoice.number as string).sort();
  expect(numbers).toEqual([number('INV', 5), number('INV', 6)]);
  const all = (
    await s.f.owner.query(
      'SELECT invoice_seq FROM customer_private.real_invoice WHERE invoice_year=$1 ORDER BY invoice_seq',
      [singaporeYear()],
    )
  ).rows.map((r: { invoice_seq: number }) => r.invoice_seq);
  expect(all).toEqual([1, 2, 3, 4, 5, 6]);
});

test('the database itself refuses a gap, a repeat, a wrong total and a sample workspace, whoever writes', async () => {
  const row = (
    await s.f.owner.query(
      'SELECT * FROM customer_private.real_invoice ORDER BY invoice_seq LIMIT 1',
    )
  ).rows[0];
  const insert = (over: Record<string, unknown>) => {
    const r = { ...row, ...over };
    delete (r as Record<string, unknown>).id;
    delete (r as Record<string, unknown>).created_at;
    const cols = Object.keys(r);
    return s.f.owner.query(
      `INSERT INTO customer_private.real_invoice(${cols.join(',')}) VALUES(${cols.map((_, i) => '$' + (i + 1)).join(',')})`,
      cols.map((c) => (r as Record<string, unknown>)[c]),
    );
  };
  // A gap in the sequence, a repeat of a number, and a total that does not add up.
  await expect(insert({ invoice_seq: 99, proposal_id: randomUUID() })).rejects.toThrow();
  await expect(insert({ proposal_id: randomUUID() })).rejects.toThrow();
  await expect(
    insert({ invoice_seq: 7, total_minor: 1, proposal_id: randomUUID() }),
  ).rejects.toThrow();
  // History cannot be rewritten or removed.
  await expect(
    s.f.owner.query('UPDATE customer_private.real_invoice SET total_minor=1'),
  ).rejects.toThrow();
  await expect(s.f.owner.query('DELETE FROM customer_private.real_invoice')).rejects.toThrow();
  await expect(
    s.f.owner.query('UPDATE customer_private.real_invoice_payment SET amount_minor=1'),
  ).rejects.toThrow();
  await expect(
    s.f.owner.query('DELETE FROM customer_private.real_invoice_credit'),
  ).rejects.toThrow();
  await expect(
    s.f.owner.query('DELETE FROM customer_private.real_invoicing_decision'),
  ).rejects.toThrow();
  await expect(
    s.f.owner.query('DELETE FROM customer_private.real_invoicing_proposal'),
  ).rejects.toThrow();
});

test('the runtime logins reach no table and no private function, and the staff functions need a real operator session', async () => {
  for (const table of [
    'real_invoice',
    'real_invoice_payment',
    'real_invoice_credit',
    'real_invoicing_proposal',
    'real_invoicing_decision',
    'real_invoicing_entity',
    'real_invoicing_control',
    'real_invoicing_command',
  ])
    for (const pool of [s.f.runtime, s.f.auth])
      await expect(pool.query(`SELECT * FROM customer_private.${table}`)).rejects.toMatchObject({
        code: '42501',
      });
  for (const sql of [
    'SELECT customer_private.real_invoicing_open()',
    'SELECT customer_private.real_invoicing_paid($1)',
    'SELECT customer_private.real_invoicing_emit($1,$1,$2,$2,1,1,$1,$1)',
  ])
    await expect(s.f.runtime.query(sql, [randomUUID(), 'invoice.issued'])).rejects.toMatchObject({
      code: '42501',
    });
  await expect(
    s.f.auth.query('SELECT customer.real_invoicing_overview($1)', [workspaceId]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(s.f.auth.query('SELECT app.real_invoicing_staff_pending()')).rejects.toMatchObject({
    code: '42501',
  });
  // Without a staff session nothing is returned even to the runtime login.
  await expect(s.f.runtime.query('SELECT app.real_invoicing_staff_pending()')).rejects.toThrow();
  await expect(
    rawContext(s.f.runtime, s.f.users.owner.ctx, 'SELECT app.real_invoicing_staff_pending()'),
  ).rejects.toThrow();
  await expect(
    s.f.runtime.query('SELECT * FROM customer_invoicing_real_migrations.applied'),
  ).rejects.toMatchObject({ code: '42501' });
});

test('the same command id gives the same answer once; a different request under it conflicts', async () => {
  const sub = await writePlanAndActivate(otherWorkspaceId, 'inv-other', 'growth-replay');
  const commandId = randomUUID();
  const input = {
    action: 'prepare_invoice',
    commandId,
    subscriptionId: sub,
    periodStart: utcToday(),
    dueOn: days(30),
    billToName: 'Chattogram Exports Limited',
    billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
  };
  const a = await staff.command(first(), input);
  const b = await staff.command(first(), input);
  expect(b).toEqual(a);
  await expect(staff.command(first(), { ...input, dueOn: days(20) })).rejects.toThrow(
    /conflicts with original/i,
  );
  expect(
    (
      await s.f.owner.query(
        'SELECT count(*)::int n FROM customer_private.real_invoicing_proposal WHERE subscription_id=$1',
        [sub],
      )
    ).rows[0].n,
  ).toBe(1);
  await decide(a.proposalId, 'reject', second.ctx, 'Held back for a billing address check');
});

test('events carry ids, numbers and sequence only: never an amount, a name, an address, a date, a reference or a reason', async () => {
  const events = (
    await s.f.owner.query(
      "SELECT type,payload FROM app.domain_event WHERE type LIKE 'customer.real_invoicing.%' ORDER BY occurred_at",
    )
  ).rows;
  expect(events.length).toBeGreaterThan(8);
  const kinds = new Set(events.map((e: { type: string }) => e.type));
  for (const k of [
    'invoice.prepared',
    'invoice.issued',
    'invoice.rejected',
    'credit.prepared',
    'credit.issued',
    'payment.recorded',
  ])
    expect(kinds.has('customer.real_invoicing.' + k), k).toBe(true);
  for (const e of events) {
    expect(Object.keys(e.payload).sort()).toEqual(
      ['documentId', 'initiator_id', 'initiator_kind', 'number', 'seq', 'synthetic'].sort(),
    );
    expect(e.payload.synthetic).toBe(false);
  }
  const text = JSON.stringify(events);
  expect(text).not.toMatch(
    /Dhaka|Chattogram|Gulshan|Agrabad|Transfer received|correction to the bill|10900|SGD/,
  );
  for (const table of ['app.audit_event', 'app.outbox'])
    expect(
      (
        await s.f.owner.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [
          workspaceId,
        ])
      ).rows[0].n,
    ).toBeGreaterThan(0);
});

test('GST: a non-SGD plan is refused while the supplier is registered; an unregistered supplier issues a plain Invoice with no tax; old documents keep their version', async () => {
  const bdt = await writePlanAndActivate(otherWorkspaceId, 'inv-other', 'growth-bdt', {
    currency: 'BDT',
    priceMinor: '4900000',
  });
  await expect(
    staff.command(first(), {
      action: 'prepare_invoice',
      commandId: randomUUID(),
      subscriptionId: bdt,
      periodStart: utcToday(),
      dueOn: days(30),
      billToName: 'Chattogram Exports Limited',
      billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
    }),
  ).rejects.toThrow(/Singapore dollars/i);
  const tbc = await writePlanAndActivate(otherWorkspaceId, 'inv-other', 'growth-tbc', {
    taxTreatment: 'tax_to_be_confirmed',
  });
  await expect(
    staff.command(first(), {
      action: 'prepare_invoice',
      commandId: randomUUID(),
      subscriptionId: tbc,
      periodStart: utcToday(),
      dueOn: days(30),
      billToName: 'Chattogram Exports Limited',
      billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
    }),
  ).rejects.toThrow(/tax treatment before invoicing/i);
  // The supplier becomes unregistered: a new version, old documents untouched.
  const before = (await customer().overview({ workspaceId })).invoices[0];
  expect(before.title).toBe('Tax Invoice');
  const changed = await control({
    entity: {
      ...defaultRealInvoicingEntity,
      gstRegistered: false,
      gstRegistrationNo: null,
      madeupFields: ['uen', 'payment_instructions', 'finance_label'],
    },
  });
  expect(changed.entityChanged).toBe(true);
  const plain = await staff.command(first(), {
    action: 'prepare_invoice',
    commandId: randomUUID(),
    subscriptionId: bdt,
    periodStart: utcToday(),
    dueOn: days(30),
    billToName: 'Chattogram Exports Limited',
    billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
  });
  const issued = await decide(plain.proposalId);
  expect(issued.invoice).toMatchObject({
    title: 'Invoice',
    gstRegistered: false,
    taxRateBps: null,
    planFeeMinor: '4900000',
    taxMinor: '0',
    totalMinor: '4900000',
    currency: 'BDT',
  });
  expect(issued.invoice.supplier.gstRegistrationNo).toBeNull();
  const tbcIssued = await decide(
    (
      await staff.command(first(), {
        action: 'prepare_invoice',
        commandId: randomUUID(),
        subscriptionId: tbc,
        periodStart: utcToday(),
        dueOn: days(30),
        billToName: 'Chattogram Exports Limited',
        billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
      })
    ).proposalId,
  );
  expect(tbcIssued.invoice).toMatchObject({ title: 'Invoice', taxMinor: '0', totalMinor: '10000' });
  const after = (await customer().overview({ workspaceId })).invoices.find(
    (i) => i.number === number('INV', 1),
  )!;
  expect(after).toMatchObject({ title: 'Tax Invoice', taxMinor: '900', gstRegistered: true });
  expect(after.supplier.gstRegistrationNo).toContain('(madeup)');
  // Restore the registered supplier for the later tests.
  await control({ entity: defaultRealInvoicingEntity });
});

test('one person may do both only when the owner records it; the document says so; the named finance approver is then the only approver', async () => {
  // Default: refused.
  const sub = await writePlanAndActivate(otherWorkspaceId, 'inv-other', 'growth-self');
  const prepare1 = () =>
    staff.command(first(), {
      action: 'prepare_invoice',
      commandId: randomUUID(),
      subscriptionId: sub,
      periodStart: utcToday(),
      dueOn: days(30),
      billToName: 'Chattogram Exports Limited',
      billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
    });
  const p = await prepare1();
  await expect(decide(p.proposalId, 'approve', first())).rejects.toThrow(/second person/i);
  await control({ requireSecondApprover: false });
  expect((await staff.pending(first())).secondApproverRequired).toBe(false);
  const self = await decide(p.proposalId, 'approve', first());
  expect(self.invoice).toMatchObject({ selfApproved: true });
  // Naming a finance approver means only that account can approve, even when a second person is not required.
  await control({ entity: { ...defaultRealInvoicingEntity, approverEmail: second.email } });
  const sub2 = await writePlanAndActivate(otherWorkspaceId, 'inv-other', 'growth-named');
  const p2 = await staff.command(first(), {
    action: 'prepare_invoice',
    commandId: randomUUID(),
    subscriptionId: sub2,
    periodStart: utcToday(),
    dueOn: days(30),
    billToName: 'Chattogram Exports Limited',
    billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
  });
  await expect(decide(p2.proposalId, 'approve', first())).rejects.toThrow(
    /named finance approver/i,
  );
  await expect(
    control({ entity: { ...defaultRealInvoicingEntity, approverEmail: 'nobody@example.invalid' } }),
  ).rejects.toThrow(/not an active staff account/i);
  const named = await decide(p2.proposalId, 'approve', second.ctx);
  expect(named.invoice).toMatchObject({ selfApproved: false });
  await control({ requireSecondApprover: true, entity: defaultRealInvoicingEntity });
  expect((await staff.pending(first())).secondApproverRequired).toBe(true);
});

test('pausing closes customers and staff and keeps every record; opening again restores them', async () => {
  const count = async () =>
    (await s.f.owner.query('SELECT count(*)::int n FROM customer_private.real_invoice')).rows[0].n;
  const before = await count();
  expect(before).toBeGreaterThan(5);
  await control({ enabled: false });
  await expect(customer().overview({ workspaceId })).rejects.toMatchObject({ code: '55000' });
  await expect(staff.pending(first())).rejects.toMatchObject({ status: 503 });
  await expect(staff.list(first())).rejects.toMatchObject({ status: 503 });
  expect(await count()).toBe(before);
  // Closing real plans closes invoices too, whatever the invoicing control says.
  await control({ enabled: true });
  await configureRealBilling(s.f.owner, {
    enabled: false,
    reason: 'Local fixture pause of real plans',
  });
  await expect(customer().overview({ workspaceId })).rejects.toMatchObject({ code: '55000' });
  await expect(staff.pending(first())).rejects.toMatchObject({ status: 503 });
  await configureRealBilling(s.f.owner, {
    enabled: true,
    reason: 'Local fixture reopening of real plans',
  });
  expect((await customer().overview({ workspaceId })).invoices.length).toBeGreaterThan(0);
  expect(await count()).toBe(before);
});
