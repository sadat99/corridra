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
import {
  CustomerRealInvoicingStaffService,
  REVERSAL_REASON_MIN,
  realInvoicingStaffCommandInput,
} from '../../packages/delivery/src/customer-invoicing-real-staff';
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
// The database dates invoices, payments and credit notes by the Singapore calendar day, so the tests do too.
const utcToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const days = (n: number) =>
  new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
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
// A real payment is prepared by one person and approved by a second, the same as an invoice or a credit note.
const record = async (over: Record<string, unknown>) => {
  const proposal = await staff.command(first(), {
    action: 'prepare_payment',
    commandId: randomUUID(),
    ...over,
  });
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
  expect(applied.map((r: { name: string }) => r.name)).toEqual([
    '0001_real_invoicing.sql',
    '0002_payment_approval_and_reversal.sql',
  ]);
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
  for (const row of applied as { name: string; sha256: string }[])
    await s.f.owner.query(
      'UPDATE customer_invoicing_real_migrations.applied SET sha256=$1 WHERE name=$2',
      [row.sha256, row.name],
    );
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
    uen: '202612345X',
    gst_rate_bps: 900,
    payment_terms_days: 30,
  });
  // The UEN is real (owner, 1 Nov 2026); the other organisation details stay made up and marked.
  expect(entity[0].placeholder_fields.sort()).toEqual(
    ['finance_label', 'gst_registered', 'gst_registration_no', 'payment_instructions'].sort(),
  );
  for (const field of ['gst_registration_no', 'payment_instructions', 'finance_label'])
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
  // Every check runs when the payment is prepared; recording it needs a second person (see the next test).
  const base = (over: Record<string, unknown>) => ({
    invoiceId: inv.id,
    expectedPosition: 0,
    amountMinor: '4000',
    receivedOn: utcToday(),
    method: 'bank_transfer',
    reference: 'Transfer received from Dhaka Imports',
    ...over,
  });
  const pay = (over: Record<string, unknown>) =>
    staff.command(first(), { action: 'prepare_payment', commandId: randomUUID(), ...base(over) });
  const recorded = (over: Record<string, unknown>) => record(base(over));
  await expect(pay({ amountMinor: '10901' })).rejects.toThrow(/more than is still outstanding/i);
  await expect(pay({ receivedOn: days(3) })).rejects.toThrow(/future/i);
  await expect(pay({ reference: 'See https://example.test/receipt' })).rejects.toThrow();
  await expect(pay({ reference: 'Mail me@business.test' })).rejects.toThrow();
  const first1 = await recorded({});
  expect(first1.invoice).toMatchObject({
    status: 'partly_paid',
    paidMinor: '4000',
    outstandingMinor: '6900',
  });
  await expect(pay({ expectedPosition: 0 })).rejects.toThrow(/changed; reload/i);
  const second1 = await recorded({ expectedPosition: 1, amountMinor: '6900' });
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
    {
      seq: 1,
      amountMinor: '4000',
      receivedOn: utcToday(),
      method: 'bank_transfer',
      reversed: false,
    },
    {
      seq: 2,
      amountMinor: '6900',
      receivedOn: utcToday(),
      method: 'bank_transfer',
      reversed: false,
    },
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

test('real payments and their reversals need a second person, carry a reason, and the one-person payment command is refused while a second person is required', async () => {
  const view = async () => {
    const listed = (await staff.list(first())).invoices as (RealInvoice & { position: number })[];
    return listed.find((i) => i.number === number('INV', 1))!;
  };
  const inv = await view();
  expect(inv).toMatchObject({ status: 'paid', paidMinor: '10900' });
  const payment = (over: Record<string, unknown> = {}) => ({
    action: 'prepare_payment',
    commandId: randomUUID(),
    invoiceId: inv.id,
    expectedPosition: inv.position,
    amountMinor: '4000',
    receivedOn: utcToday(),
    method: 'bank_transfer',
    reference: 'Transfer received from Dhaka Imports',
    ...over,
  });
  const reversal = (over: Record<string, unknown> = {}) => ({
    action: 'prepare_payment_reversal',
    commandId: randomUUID(),
    invoiceId: inv.id,
    expectedPosition: inv.position,
    paymentSeq: 2,
    reason: 'The second payment was entered against the wrong invoice',
    ...over,
  });

  // The one-person payment command is gone in every mode: a payment is prepared, then approved.
  await expect(
    staff.command(first(), {
      action: 'payment',
      commandId: randomUUID(),
      invoiceId: inv.id,
      expectedPosition: inv.position,
      amountMinor: '1',
      receivedOn: utcToday(),
      method: 'cash',
      reference: 'Cash handed over at the office',
    }),
  ).rejects.toThrow(/prepare it for approval/i);

  // A reversal needs a plain reason, an existing payment and the position the person saw.
  await expect(staff.command(first(), reversal({ reason: 'Wrong' }))).rejects.toThrow();
  await expect(
    staff.command(first(), reversal({ reason: 'See https://example.test/why it is wrong' })),
  ).rejects.toThrow();
  await expect(staff.command(first(), reversal({ paymentSeq: 9 }))).rejects.toThrow(
    /no such payment/i,
  );
  await expect(
    staff.command(first(), reversal({ expectedPosition: inv.position + 1 })),
  ).rejects.toThrow(/changed; reload/i);

  const prepared = await staff.command(first(), reversal());
  expect(prepared).toMatchObject({
    kind: 'payment_reversal',
    state: 'waiting_for_approval',
    secondApproverRequired: true,
  });
  // Nothing changed yet; only one reversal of a payment can wait at a time.
  expect(await view()).toMatchObject({ status: 'paid', paidMinor: '10900' });
  await expect(staff.command(first(), reversal())).rejects.toThrow(/already waiting/i);
  // The preparer cannot approve; a second person can.
  await expect(decide(prepared.proposalId, 'approve', first())).rejects.toThrow(/second person/i);
  const pending = (await staff.pending(first())).proposals as {
    id: string;
    kind: string;
    paymentSeq: number;
    reason: string;
    preparedByYou: boolean;
  }[];
  expect(pending.find((x) => x.id === prepared.proposalId)).toMatchObject({
    kind: 'payment_reversal',
    paymentSeq: 2,
    reason: 'The second payment was entered against the wrong invoice',
    // The confirmation names the payment and its currency, whatever invoice page the screen has loaded.
    paymentAmountMinor: '6900',
    paymentReceivedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/),
    invoiceCurrency: 'SGD',
    preparedByYou: true,
  });
  const reversed = await decide(prepared.proposalId);
  expect(reversed).toMatchObject({ kind: 'payment_reversal', state: 'recorded' });
  expect(reversed.invoice).toMatchObject({
    status: 'partly_paid',
    paidMinor: '4000',
    outstandingMinor: '6900',
  });
  const after = await view();
  expect(after.position).toBe(inv.position + 1);
  expect(after.payments).toMatchObject([
    { seq: 1, reversed: false },
    { seq: 2, amountMinor: '6900', reversed: true },
  ]);
  // The original payment stays; the reason is for staff only.
  expect(JSON.stringify(after.payments[1])).toContain('wrong invoice');
  // A payment is reversed once.
  await expect(
    staff.command(first(), reversal({ expectedPosition: after.position })),
  ).rejects.toThrow(/already reversed/i);

  // The reversed amount can be paid again, again by two people, and the preparer's reference is kept.
  await expect(
    staff.command(first(), payment({ expectedPosition: after.position, amountMinor: '6901' })),
  ).rejects.toThrow(/more than is still outstanding/i);
  const again = await staff.command(
    first(),
    payment({ expectedPosition: after.position, amountMinor: '6900' }),
  );
  expect(again).toMatchObject({ kind: 'payment', state: 'waiting_for_approval' });
  await expect(
    staff.command(first(), payment({ expectedPosition: after.position, amountMinor: '100' })),
  ).rejects.toThrow(/already waiting/i);
  await expect(decide(again.proposalId, 'approve', first())).rejects.toThrow(/second person/i);
  const paidAgain = await decide(again.proposalId);
  expect(paidAgain).toMatchObject({ kind: 'payment', state: 'recorded' });
  expect(paidAgain.invoice).toMatchObject({
    status: 'paid',
    paidMinor: '10900',
    outstandingMinor: '0',
  });

  // A payment waiting while the invoice changes is refused at approval, and a rejection needs a reason.
  const now = await view();
  const waiting = await staff.command(
    first(),
    reversal({ expectedPosition: now.position, paymentSeq: 3 }),
  );
  const sneaky = await staff.command(
    first(),
    reversal({
      expectedPosition: now.position,
      paymentSeq: 1,
      reason: 'The first payment was a duplicate',
    }),
  );
  await decide(sneaky.proposalId);
  await expect(decide(waiting.proposalId)).rejects.toThrow(
    /changed after this reversal was prepared/i,
  );
  await expect(decide(waiting.proposalId, 'reject')).rejects.toThrow();
  const rejected = await decide(
    waiting.proposalId,
    'reject',
    second.ctx,
    'The invoice changed, so this is withdrawn',
  );
  expect(rejected.state).toBe('rejected');

  // Customers see that a payment was reversed, never why or the reference.
  const seen = await customer().overview({ workspaceId });
  const mine = seen.invoices.find((i) => i.number === number('INV', 1))!;
  expect(mine.payments.map((x: { reversed: boolean }) => x.reversed)).toEqual([true, true, false]);
  expect(JSON.stringify(seen)).not.toMatch(/duplicate|wrong invoice|Transfer received/i);

  // Each step is one event with ids, the number and a sequence only: never the amount, the date, the reference or the reason.
  const kinds = (
    await s.f.owner.query(
      `SELECT type,payload::text p FROM app.domain_event WHERE type LIKE 'customer.real_invoicing.payment%' ORDER BY occurred_at`,
    )
  ).rows as { type: string; p: string }[];
  const types = new Set(kinds.map((e) => e.type));
  for (const t of [
    'customer.real_invoicing.payment.prepared',
    'customer.real_invoicing.payment.recorded',
    'customer.real_invoicing.payment_reversal.prepared',
    'customer.real_invoicing.payment.reversed',
    'customer.real_invoicing.payment_reversal.rejected',
  ])
    expect(types.has(t)).toBe(true);
  for (const e of kinds)
    expect(
      e.p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>'),
    ).not.toMatch(
      /wrong invoice|duplicate|Transfer received|6900|4000|reason|reference|amount|method/i,
    );

  // The rows are append-only, and the database repeats the second-person rule for every writer.
  await expect(
    s.f.owner.query(
      "UPDATE customer_private.real_invoice_payment_reversal SET reason='Changed after the fact'",
    ),
  ).rejects.toThrow();
  await expect(
    s.f.owner.query('DELETE FROM customer_private.real_invoice_payment_reversal'),
  ).rejects.toThrow();
  await expect(
    s.f.owner.query(
      `INSERT INTO customer_private.real_invoice_payment(invoice_id,tenant_id,seq,amount_minor,received_on,method,reference,recorded_by,staff_tenant_id)
       SELECT invoice_id,tenant_id,99,1,received_on,method,'Direct write without approval',recorded_by,staff_tenant_id
       FROM customer_private.real_invoice_payment WHERE invoice_id=$1 LIMIT 1`,
      [inv.id],
    ),
  ).rejects.toThrow();
});

test('two people preparing a reversal of the same payment at once: exactly one waits for approval', async () => {
  const listed = (await staff.list(first())).invoices as (RealInvoice & { position: number })[];
  const inv = listed.find((i) => i.number === number('INV', 1))!;
  const body = () => ({
    action: 'prepare_payment_reversal',
    commandId: randomUUID(),
    invoiceId: inv.id,
    expectedPosition: inv.position,
    paymentSeq: 3,
    reason: 'Entered twice by mistake, so one is reversed',
  });
  const results = await Promise.allSettled([
    staff.command(first(), body()),
    staff.command(first(), body()),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  expect(String(failed.reason?.message ?? failed.reason)).toMatch(
    /already waiting|changed|reload/i,
  );
  const won = (
    results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
      proposalId: string;
    }>
  ).value;
  // Leave nothing waiting for the tests that follow.
  await decide(won.proposalId, 'reject', second.ctx, 'Withdrawn after the race rehearsal');
});

test('every position check the database holds on a proposal reaches 1500, the most an invoice can hold', async () => {
  const defs = (
    await s.f.owner.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid='customer_private.real_invoicing_proposal'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%expected_position%'`,
    )
  ).rows as { conname: string; def: string }[];
  // Credit, payment and payment reversal each carry one.
  expect(defs.length).toBe(3);
  for (const d of defs) {
    expect(d.def).toMatch(/expected_position >= 0\) AND \(expected_position <= 1500\)/);
    expect(d.def).not.toMatch(/1000/);
  }
});

test('the position a real command may carry reaches the most an invoice can hold: 500 payments, 500 credits and 500 reversals', () => {
  const base = {
    action: 'prepare_payment',
    commandId: randomUUID(),
    invoiceId: randomUUID(),
    amountMinor: '100',
    receivedOn: '2026-10-01',
    method: 'cash',
    reference: 'Cash handed over at the office',
  };
  expect(
    realInvoicingStaffCommandInput.safeParse({ ...base, expectedPosition: 1500 }).success,
  ).toBe(true);
  expect(
    realInvoicingStaffCommandInput.safeParse({ ...base, expectedPosition: 1501 }).success,
  ).toBe(false);
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
  await record({
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
    'real_invoice_payment_reversal',
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
      madeupFields: ['payment_instructions', 'finance_label'],
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

test('with one person allowed, a payment and a reversal still go through a proposal the same person self-approves, marked as such; the named finance approver is still enforced', async () => {
  const live = async () => {
    const listed = (await staff.list(first())).invoices as (RealInvoice & { position: number })[];
    return listed.find((i) => i.number === number('INV', 1))!;
  };
  const prep = async (action: string, over: Record<string, unknown>) => {
    const inv = await live();
    return staff.command(first(), {
      action,
      commandId: randomUUID(),
      invoiceId: inv.id,
      expectedPosition: inv.position,
      ...over,
    });
  };
  const payment = (amountMinor: string) =>
    prep('prepare_payment', {
      amountMinor,
      receivedOn: utcToday(),
      method: 'bank_transfer',
      reference: 'Transfer received from Dhaka Imports',
    });
  const lastRows = async (table: string) =>
    (
      await s.f.owner.query(
        `SELECT * FROM customer_private.${table} WHERE invoice_id=(SELECT id FROM customer_private.real_invoice WHERE invoice_year=$1 AND invoice_seq=1) ORDER BY seq DESC LIMIT 1`,
        [singaporeYear()],
      )
    ).rows[0];
  await control({ requireSecondApprover: false });
  try {
    // The one-person command stays closed even now, so the decision rules always apply.
    const inv = await live();
    await expect(
      staff.command(first(), {
        action: 'payment',
        commandId: randomUUID(),
        invoiceId: inv.id,
        expectedPosition: inv.position,
        amountMinor: '1',
        receivedOn: utcToday(),
        method: 'cash',
        reference: 'Cash handed over at the office',
      }),
    ).rejects.toThrow(/prepare it for approval/i);
    // A payment prepared and approved by the same person is recorded against its proposal and marked self approved.
    const prepared = await payment('100');
    expect(prepared).toMatchObject({ kind: 'payment', secondApproverRequired: false });
    const recorded = await decide(prepared.proposalId, 'approve', first());
    expect(recorded).toMatchObject({ kind: 'payment', state: 'recorded' });
    const row = await lastRows('real_invoice_payment');
    expect(row).toMatchObject({
      amount_minor: '100',
      self_approved: true,
      proposal_id: prepared.proposalId,
    });
    expect(row.approved_by).toBe(row.recorded_by);
    // The same for a reversal of it.
    const reversal = await prep('prepare_payment_reversal', {
      paymentSeq: row.seq,
      reason: 'Entered by mistake while rehearsing',
    });
    expect(await decide(reversal.proposalId, 'approve', first())).toMatchObject({
      kind: 'payment_reversal',
      state: 'recorded',
    });
    const undone = await lastRows('real_invoice_payment_reversal');
    expect(undone).toMatchObject({
      payment_seq: row.seq,
      self_approved: true,
      proposal_id: reversal.proposalId,
    });
    // Whatever the mode, no payment row exists without an approved proposal.
    await expect(
      s.f.owner.query(
        `INSERT INTO customer_private.real_invoice_payment(invoice_id,tenant_id,seq,amount_minor,received_on,method,reference,recorded_by,staff_tenant_id)
         SELECT invoice_id,tenant_id,seq+1,1,received_on,method,reference,recorded_by,staff_tenant_id FROM customer_private.real_invoice_payment WHERE id=$1`,
        [row.id],
      ),
    ).rejects.toThrow(/approved proposal/i);
    // Naming a finance approver means only that account can approve, for payments as for invoices.
    await control({ entity: { ...defaultRealInvoicingEntity, approverEmail: second.email } });
    const named = await payment('100');
    await expect(decide(named.proposalId, 'approve', first())).rejects.toThrow(
      /named finance approver/i,
    );
    const byNamed = await decide(named.proposalId, 'approve', second.ctx);
    expect(byNamed).toMatchObject({ kind: 'payment', state: 'recorded' });
    expect(await lastRows('real_invoice_payment')).toMatchObject({ self_approved: false });
    // Leave the invoice as it was for the tests that follow: reverse that last payment, approved by the named person.
    const tidy = await prep('prepare_payment_reversal', {
      paymentSeq: (await lastRows('real_invoice_payment')).seq,
      reason: 'Tidy up after the rehearsal',
    });
    await decide(tidy.proposalId, 'approve', second.ctx);
  } finally {
    await control({ requireSecondApprover: true, entity: defaultRealInvoicingEntity });
  }
  expect((await staff.pending(first())).secondApproverRequired).toBe(true);
});

test('a retried approval after a lost reply replays the recorded result, even while supplier details are made up, and an approval that would issue a document is refused and leaves nothing behind', async () => {
  // The same service with the live-environment guard switched on.
  const guarded = new CustomerRealInvoicingStaffService(s.f.runtime, () => true);
  const listed = (await staff.list(first())).invoices as (RealInvoice & { position: number })[];
  const inv = listed.find((i) => i.number === number('INV', 1))!;
  const prepared = await staff.command(first(), {
    action: 'prepare_payment',
    commandId: randomUUID(),
    invoiceId: inv.id,
    expectedPosition: inv.position,
    amountMinor: '100',
    receivedOn: utcToday(),
    method: 'bank_transfer',
    reference: 'Transfer received from Dhaka Imports',
  });
  expect((await staff.pending(first())).supplier.madeupFields.length).toBeGreaterThan(0);
  const commandId = randomUUID();
  const approve = () =>
    guarded.command(second.ctx, {
      action: 'decide',
      commandId,
      proposalId: prepared.proposalId,
      decision: 'approve',
    });
  const answer = await approve();
  expect(answer).toMatchObject({ kind: 'payment', state: 'recorded' });
  // The reply was lost; the retry gets the same answer and records nothing more.
  expect(await approve()).toEqual(answer);
  const paid = await s.f.owner.query(
    'SELECT count(*)::int n FROM customer_private.real_invoice_payment WHERE proposal_id=$1',
    [prepared.proposalId],
  );
  expect(paid.rows[0].n).toBe(1);
  // Undo it for the tests that follow.
  const rev = await staff.command(first(), {
    action: 'prepare_payment_reversal',
    commandId: randomUUID(),
    invoiceId: inv.id,
    expectedPosition: (await staff.list(first())).invoices.find(
      (i: RealInvoice) => i.number === number('INV', 1),
    ).position,
    paymentSeq: (
      await s.f.owner.query(
        'SELECT seq FROM customer_private.real_invoice_payment WHERE proposal_id=$1',
        [prepared.proposalId],
      )
    ).rows[0].seq,
    reason: 'Tidy up after the retry rehearsal',
  });
  await decide(rev.proposalId);

  // Approving an invoice while the details are made up is refused, and the whole command rolls back.
  const sub = await writePlanAndActivate(otherWorkspaceId, 'inv-other', 'growth-madeup-guard');
  const invoiceProposal = await staff.command(first(), {
    action: 'prepare_invoice',
    commandId: randomUUID(),
    subscriptionId: sub,
    periodStart: utcToday(),
    dueOn: days(30),
    billToName: 'Chattogram Exports Limited',
    billToAddress: 'Agrabad Commercial Area, Chattogram 4100, Bangladesh',
  });
  const before = (
    await s.f.owner.query('SELECT count(*)::int n FROM customer_private.real_invoice')
  ).rows[0].n;
  await expect(
    guarded.command(second.ctx, {
      action: 'decide',
      commandId: randomUUID(),
      proposalId: invoiceProposal.proposalId,
      decision: 'approve',
    }),
  ).rejects.toMatchObject({ code: 'MADEUP_SUPPLIER_DETAILS' });
  expect(
    (await s.f.owner.query('SELECT count(*)::int n FROM customer_private.real_invoice')).rows[0].n,
  ).toBe(before);
  expect(
    (await staff.pending(first())).proposals.some(
      (p: { id: string }) => p.id === invoiceProposal.proposalId,
    ),
  ).toBe(true);
  await decide(
    invoiceProposal.proposalId,
    'reject',
    second.ctx,
    'Left unissued by the guard rehearsal',
  );
});

test('a real prepare works at position 1001, the first position the old limit refused', async () => {
  const listed = (await staff.list(first())).invoices as (RealInvoice & { position: number })[];
  const inv = listed.find((i) => i.number === number('INV', 1))!;
  const def = (
    await s.f.owner.query(
      "SELECT pg_get_functiondef('customer_private.real_invoicing_position(uuid)'::regprocedure) AS def",
    )
  ).rows[0].def as string;
  const proposals: string[] = [];
  try {
    // Make the invoice read as having 1001 payments, credits and reversals, so the real command path and the real
    // proposal checks are the ones exercised.
    await s.f.owner.query(
      'CREATE OR REPLACE FUNCTION customer_private.real_invoicing_position(inv uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 1001 $$',
    );
    const base = { invoiceId: inv.id, expectedPosition: 1001 };
    const pay = await staff.command(first(), {
      action: 'prepare_payment',
      commandId: randomUUID(),
      ...base,
      amountMinor: '100',
      receivedOn: utcToday(),
      method: 'bank_transfer',
      reference: 'Transfer received from Dhaka Imports',
    });
    const credit = await staff.command(first(), {
      action: 'prepare_credit',
      commandId: randomUUID(),
      ...base,
      amountMinor: '100',
      reason: 'A rehearsal credit at a high position',
    });
    const seq = (
      await s.f.owner.query(
        'SELECT seq FROM customer_private.real_invoice_payment WHERE invoice_id=$1 AND NOT EXISTS(SELECT FROM customer_private.real_invoice_payment_reversal r WHERE r.invoice_id=real_invoice_payment.invoice_id AND r.payment_seq=real_invoice_payment.seq) ORDER BY seq DESC LIMIT 1',
        [inv.id],
      )
    ).rows[0].seq;
    const rev = await staff.command(first(), {
      action: 'prepare_payment_reversal',
      commandId: randomUUID(),
      ...base,
      paymentSeq: seq,
      reason: 'A rehearsal reversal at a high position',
    });
    proposals.push(pay.proposalId, credit.proposalId, rev.proposalId);
    // One more than the most an invoice can hold is refused before the database.
    await expect(
      staff.command(first(), {
        action: 'prepare_payment',
        commandId: randomUUID(),
        invoiceId: inv.id,
        expectedPosition: 1501,
        amountMinor: '100',
        receivedOn: utcToday(),
        method: 'bank_transfer',
        reference: 'Transfer received from Dhaka Imports',
      }),
    ).rejects.toThrow();
  } finally {
    await s.f.owner.query(def);
  }
  for (const id of proposals)
    await decide(id, 'reject', second.ctx, 'Withdrawn after the position rehearsal');
});

test('the shortest reversal reason is 20 characters in every layer: 19 refused, 20 accepted', async () => {
  const sqlMin = (await s.f.owner.query('SELECT customer_private.real_reversal_reason_min() AS n'))
    .rows[0].n;
  expect(sqlMin).toBe(20);
  expect(REVERSAL_REASON_MIN).toBe(20);
  const listed = (await staff.list(first())).invoices as (RealInvoice & { position: number })[];
  const inv = listed.find((i) => i.number === number('INV', 1))!;
  const live = (
    await s.f.owner.query(
      'SELECT seq FROM customer_private.real_invoice_payment p WHERE invoice_id=$1 AND NOT EXISTS(SELECT FROM customer_private.real_invoice_payment_reversal r WHERE r.invoice_id=p.invoice_id AND r.payment_seq=p.seq) ORDER BY seq DESC LIMIT 1',
      [inv.id],
    )
  ).rows[0].seq as number;
  const reasonOf = (n: number) => 'Entered by mistake'.padEnd(n, 'e');
  const prepare = (n: number) =>
    staff.command(first(), {
      action: 'prepare_payment_reversal',
      commandId: randomUUID(),
      invoiceId: inv.id,
      expectedPosition: inv.position,
      paymentSeq: live,
      reason: reasonOf(n),
    });
  // Command layer (the Zod schema and the database function): 19 refused, 20 accepted.
  await expect(prepare(19)).rejects.toThrow();
  const ok = await prepare(20);
  expect(ok).toMatchObject({ kind: 'payment_reversal', state: 'waiting_for_approval' });
  await decide(ok.proposalId, 'reject', second.ctx, 'Withdrawn after the length rehearsal');
  // Table layers, written directly as the owner inside a transaction that is rolled back.
  const client = await s.f.owner.connect();
  try {
    const prior = (
      await client.query(
        'SELECT tenant_id,prepared_by,staff_tenant_id FROM customer_private.real_invoicing_proposal WHERE invoice_id=$1 LIMIT 1',
        [inv.id],
      )
    ).rows[0];
    const tryProposal = async (reason: string) => {
      await client.query('SAVEPOINT p');
      try {
        await client.query(
          `INSERT INTO customer_private.real_invoicing_proposal(kind,tenant_id,invoice_id,expected_position,payment_seq,reason,prepared_by,staff_tenant_id)
           VALUES('payment_reversal',$1,$2,$3,$4,$5,$6,$7)`,
          [
            prior.tenant_id,
            inv.id,
            inv.position,
            live,
            reason,
            prior.prepared_by,
            prior.staff_tenant_id,
          ],
        );
        return 'accepted';
      } catch (error) {
        return (error as { code?: string }).code;
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT p');
      }
    };
    await client.query('BEGIN');
    expect(await tryProposal(reasonOf(19))).toBe('23514');
    expect(await tryProposal(reasonOf(20))).toBe('accepted');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

test('proposals are accepted at positions 1001 and 1500 and refused at 1501, for a payment, a reversal and a credit note', async () => {
  const listed = (await staff.list(first())).invoices as (RealInvoice & { position: number })[];
  const inv = listed.find((i) => i.number === number('INV', 1))!;
  const client = await s.f.owner.connect();
  try {
    const prior = (
      await client.query(
        'SELECT tenant_id,prepared_by,staff_tenant_id FROM customer_private.real_invoicing_proposal WHERE invoice_id=$1 LIMIT 1',
        [inv.id],
      )
    ).rows[0];
    const base = [prior.tenant_id, inv.id, prior.prepared_by, prior.staff_tenant_id];
    const inserts: Record<string, (position: number) => Promise<unknown>> = {
      payment: (position) =>
        client.query(
          `INSERT INTO customer_private.real_invoicing_proposal(kind,tenant_id,invoice_id,expected_position,amount_minor,received_on,method,reference,prepared_by,staff_tenant_id)
           VALUES('payment',$1,$2,$5,100,current_date,'cash','Cash handed over at the office',$3,$4)`,
          [...base, position],
        ),
      payment_reversal: (position) =>
        client.query(
          `INSERT INTO customer_private.real_invoicing_proposal(kind,tenant_id,invoice_id,expected_position,payment_seq,reason,prepared_by,staff_tenant_id)
           VALUES('payment_reversal',$1,$2,$5,1,'Entered by mistake while rehearsing',$3,$4)`,
          [...base, position],
        ),
      credit: (position) =>
        client.query(
          `INSERT INTO customer_private.real_invoicing_proposal(kind,tenant_id,invoice_id,expected_position,amount_minor,reason,prepared_by,staff_tenant_id)
           VALUES('credit',$1,$2,$5,100,'A rehearsal credit at a high position',$3,$4)`,
          [...base, position],
        ),
    };
    await client.query('BEGIN');
    for (const [kind, insert] of Object.entries(inserts)) {
      for (const position of [1001, 1500]) {
        await client.query('SAVEPOINT p');
        await insert(position);
        await client.query('ROLLBACK TO SAVEPOINT p');
      }
      await client.query('SAVEPOINT p');
      await expect(insert(1501), kind).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT p');
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
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
