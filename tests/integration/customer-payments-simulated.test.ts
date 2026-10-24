import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { realStaffFixture } from './real-staff-fixture';
import { migrateCustomerInvoicingReal } from '../../packages/db/src/customer-invoicing-real-migrate';
import { configureRealBilling } from '../../packages/auth/src/customer-billing-real-configuration';
import { configureRealInvoicing } from '../../packages/auth/src/customer-invoicing-real-configuration';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerBillingService, type BillingPlan } from '../../packages/auth/src/customer-billing';
import { CustomerRealInvoicingService } from '../../packages/auth/src/customer-invoicing-real';
import { CustomerBillingStaffService } from '../../packages/delivery/src/customer-billing-staff';
import { CustomerRealInvoicingStaffService } from '../../packages/delivery/src/customer-invoicing-real-staff';
import { migrateCustomerPaymentsSimulated } from '../../packages/db/src/customer-payments-simulated-migrate';
import { configureSimulatedPayments } from '../../packages/auth/src/customer-payments-simulated-configuration';
import { CustomerSimulatedPaymentsService } from '../../packages/auth/src/customer-payments-simulated';
import { CustomerSimulatedPaymentsStaffService } from '../../packages/delivery/src/customer-payments-simulated-staff';

// ADR-065: the simulated payment provider Corridra Pay (madeup) for real invoices (billing stage 3). No network, card or
// bank account is involved, no money moves, and a simulated attempt never changes an invoice. The control starts closed,
// the application switch is separate, and every reference says (madeup).
const issuer =
  'https://ep-simulated-payments-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
let subscriptionId: string;
let periodStart: string;
let second: {
  id: string;
  ctx: { token: string; tenantId: string; purpose: string };
  email: string;
};
let billing: CustomerBillingStaffService;
let staff: CustomerRealInvoicingStaffService;
let simStaff: CustomerSimulatedPaymentsStaffService;
let invoiceId: string;
const runtime = () => [s.f.runtime, s.f.auth, options] as const;
const customer = (who = 'inv-owner') =>
  new CustomerRealInvoicingService(...runtime(), sessionFor(who));
const pay = (who = 'inv-owner') =>
  new CustomerSimulatedPaymentsService(...runtime(), sessionFor(who));
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
  s = await realStaffFixture(issuer, 'simulated-payments-fixture-secret');
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_BILLING_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED', 'true');
  await migrateCustomerInvoicingReal(s.f.owner);
  await migrateCustomerPaymentsSimulated(s.f.owner);
  billing = new CustomerBillingStaffService(
    s.f.runtime,
    () => process.env.CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED === 'true',
  );
  staff = new CustomerRealInvoicingStaffService(s.f.runtime);
  simStaff = new CustomerSimulatedPaymentsStaffService(s.f.runtime);
  second = await addStaff('finance-second', 'admin');
  const provision = async (who: string, name: string) =>
    (
      await new CustomerWorkspaceService(...runtime(), sessionFor(who)).provision({
        commandId: randomUUID(),
        name,
      })
    ).id as string;
  workspaceId = await provision('inv-owner', 'Dhaka Imports');
  await provision('inv-other', 'Chattogram Exports');
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
  await control({ enabled: true });
  const proposal = await prepare();
  const issued = await decide(proposal.proposalId);
  invoiceId = issued.invoice.id as string;
}, 300000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

const sim = (over: Record<string, unknown> = {}) =>
  configureSimulatedPayments(s.f.owner, {
    reason: 'Local fixture control for simulated payment tests',
    ...over,
  });
const start = (amountMinor = '4000', who = 'inv-owner', command = randomUUID()) =>
  pay(who).command({
    action: 'start',
    commandId: command,
    workspaceId,
    invoiceId,
    amountMinor,
  });
const complete = (
  attemptId: string,
  outcome: 'succeeded' | 'declined',
  who = 'inv-owner',
  command = randomUUID(),
) =>
  pay(who).command({
    action: 'complete',
    commandId: command,
    workspaceId,
    attemptId,
    outcome,
  });
const refund = (attemptId: string, amountMinor: string, who = first(), reason?: string) =>
  simStaff.command(who, {
    action: 'refund',
    commandId: randomUUID(),
    attemptId,
    amountMinor,
    reason: reason ?? 'Made-up refund for a rehearsal of the flow',
  });
const ledger = async () =>
  (
    await s.f.owner.query(
      `SELECT (SELECT count(*)::int FROM customer_private.real_invoice_payment) AS payments,
      (SELECT count(*)::int FROM customer_private.real_invoice_credit) AS credits,
      (SELECT count(*)::int FROM customer_private.real_invoice) AS invoices`,
    )
  ).rows[0] as { payments: number; credits: number; invoices: number };

test('installing is repeatable, refuses a changed history and leaves the control closed', async () => {
  const applied = (
    await s.f.owner.query('SELECT name,sha256 FROM customer_payments_simulated_migrations.applied')
  ).rows;
  expect(applied.map((r: { name: string }) => r.name)).toEqual(['0001_simulated_payments.sql']);
  expect(
    (
      await s.f.owner.query(
        'SELECT count(*)::int n FROM customer_private.simulated_payments_control',
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (await s.f.owner.query('SELECT customer_private.simulated_payments_open() o')).rows[0].o,
  ).toBe(false);
  await migrateCustomerPaymentsSimulated(s.f.owner);
  await s.f.owner.query('UPDATE customer_payments_simulated_migrations.applied SET sha256=$1', [
    createHash('sha256').update('x').digest('hex'),
  ]);
  await expect(migrateCustomerPaymentsSimulated(s.f.owner)).rejects.toThrow(/history mismatch/i);
  await s.f.owner.query('UPDATE customer_payments_simulated_migrations.applied SET sha256=$1', [
    applied[0].sha256,
  ]);
  await migrateCustomerPaymentsSimulated(s.f.owner);
});

test('with the control closed customers are told it is switched off, staff are refused, and the switch is separate', async () => {
  await expect(pay().overview({ workspaceId })).rejects.toMatchObject({ code: '55000' });
  await expect(start()).rejects.toMatchObject({ code: '55000' });
  await expect(simStaff.list(first())).rejects.toMatchObject({ status: 503 });
  await expect(refund(randomUUID(), '100')).rejects.toMatchObject({ status: 503 });
  await expect(pay('inv-other').overview({ workspaceId })).rejects.toThrow(/unavailable/i);
  vi.stubEnv('CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED', 'false');
  await expect(pay().overview({ workspaceId })).rejects.toMatchObject({ status: 503 });
  await expect(start()).rejects.toMatchObject({ status: 503 });
  vi.stubEnv('CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED', 'true');
  // Real invoicing off closes simulated payments too, whatever their own control says.
  expect(await sim({ enabled: true })).toMatchObject({
    enabled: true,
    refundWindowDays: 14,
    changed: true,
  });
  await control({ enabled: false });
  await expect(pay().overview({ workspaceId })).rejects.toMatchObject({ code: '55000' });
  await control({ enabled: true });
});

test('an owner sees what can be paid, the made-up provider and the made-up refund policy; a member sees nothing', async () => {
  const view = await pay().overview({ workspaceId });
  expect(view).toMatchObject({
    workspaceId,
    canPay: true,
    simulated: true,
    moneyMoves: false,
    paymentTaken: false,
    synthetic: false,
    provider: { name: 'Corridra Pay (madeup)', madeup: true, refundWindowDays: 14 },
  });
  expect(view.provider.refundPolicy).toContain('(madeup)');
  expect(view.payable).toEqual([
    {
      invoiceId,
      number: number('INV', 1),
      currency: 'SGD',
      outstandingMinor: '10900',
    },
  ]);
  expect(view.attempts).toEqual([]);
  expect(await pay('inv-member').overview({ workspaceId })).toMatchObject({
    canPay: false,
    payable: [],
    attempts: [],
  });
  await expect(pay('inv-other').overview({ workspaceId })).rejects.toThrow(/unavailable/i);
});

test('a checkout is started for one invoice with a made-up reference, within what is outstanding, one at a time', async () => {
  const before = await ledger();
  const command = randomUUID();
  const started = await start('4000', 'inv-owner', command);
  expect(started.attempt).toMatchObject({
    invoiceId,
    invoiceNumber: number('INV', 1),
    workspaceId,
    amountMinor: '4000',
    currency: 'SGD',
    state: 'started',
    providerName: 'Corridra Pay (madeup)',
    simulated: true,
    madeup: true,
    moneyMoves: false,
    refundedMinor: '0',
    refundableMinor: '0',
  });
  expect(started.attempt.providerRef).toMatch(/^SIMPAY-[0-9A-F]{12} \(madeup\)$/);
  // The same command gives the same answer; a different request under it conflicts.
  expect(await start('4000', 'inv-owner', command)).toEqual(started);
  await expect(start('4001', 'inv-owner', command)).rejects.toThrow(/conflicts with original/i);
  // One live attempt per invoice.
  await expect(start('1000')).rejects.toMatchObject({ code: '23505' });
  // A member and an outsider cannot start one.
  await expect(start('1000', 'inv-member')).rejects.toMatchObject({ code: '42501' });
  await expect(start('1000', 'inv-other')).rejects.toThrow();
  expect(await ledger()).toEqual(before);
  await complete(started.attempt.id, 'declined');
});

test('the amount is whole minor units and never above what is outstanding; shapes are strict', async () => {
  await expect(start('10901')).rejects.toMatchObject({ code: '23514' });
  for (const bad of ['0', '-5', '12.5', '', '0100', '1000000000000'])
    await expect(start(bad)).rejects.toThrow();
  await expect(
    pay().command({
      action: 'start',
      commandId: randomUUID(),
      workspaceId,
      invoiceId,
      amountMinor: '1000',
      extra: 'x',
    } as never),
  ).rejects.toThrow();
  await expect(
    s.f.runtime.query("SELECT customer.simulated_payment_command($1,'start',$2)", [
      randomUUID(),
      JSON.stringify({ workspaceId, invoiceId, amountMinor: '1000' }),
    ]),
  ).rejects.toThrow();
  // The whole outstanding amount can be tried.
  const all = await start('10900');
  expect(all.attempt.amountMinor).toBe('10900');
  await complete(all.attempt.id, 'declined');
});

test('only the person who started a checkout finishes it, once, and a decline can be tried again', async () => {
  const started = await start('4000');
  const id = started.attempt.id as string;
  await expect(complete(id, 'succeeded', 'inv-member')).rejects.toMatchObject({ code: '42501' });
  await expect(complete(id, 'succeeded', 'inv-other')).rejects.toThrow();
  const declined = await complete(id, 'declined');
  expect(declined.attempt).toMatchObject({ state: 'declined', refundableMinor: '0' });
  expect(declined.attempt.decidedAt).toBeTruthy();
  // A second outcome is refused, whatever it is.
  await expect(complete(id, 'succeeded')).rejects.toBeTruthy();
  // A declined attempt frees the invoice for another try.
  const again = await start('4000');
  const ok = await complete(again.attempt.id, 'succeeded');
  expect(ok.attempt).toMatchObject({
    state: 'succeeded',
    refundedMinor: '0',
    refundableMinor: '4000',
  });
  expect(ok.attempt.refundOpenUntil).toBeTruthy();
});

test('a simulated attempt never changes an invoice, a balance, a payment or a credit note', async () => {
  const view = await customer().overview({ workspaceId });
  expect(view.invoices[0]).toMatchObject({
    id: invoiceId,
    paidMinor: '0',
    creditedMinor: '0',
    outstandingMinor: '10900',
    status: 'unpaid',
    payments: [],
    credits: [],
  });
  expect(view.balances[0]).toMatchObject({ paidMinor: '0', outstandingMinor: '10900' });
  expect(await ledger()).toMatchObject({ payments: 0, credits: 0 });
});

test('an expired checkout cannot be finished and frees the invoice', async () => {
  const principal = (
    await s.f.owner.query(
      'SELECT created_by FROM customer_private.simulated_payment_attempt LIMIT 1',
    )
  ).rows[0].created_by as string;
  const id = randomUUID();
  await s.f.owner.query(
    `INSERT INTO customer_private.simulated_payment_attempt(id,tenant_id,invoice_id,amount_minor,currency,provider_ref,created_by,created_at,expires_at)
    VALUES($1,$2,$3,1000,'SGD','SIMPAY-ABCDEF012345 (madeup)',$4,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')`,
    [id, workspaceId, invoiceId, principal],
  );
  expect(
    (await s.f.owner.query('SELECT customer_private.simulated_payment_state($1) s', [id])).rows[0]
      .s,
  ).toBe('expired');
  await expect(complete(id, 'succeeded')).rejects.toMatchObject({ code: '23514' });
  const next = await start('1000');
  await complete(next.attempt.id, 'declined');
});

test('staff see every attempt with the workspace name and record made-up refunds inside the window', async () => {
  const list = await simStaff.list(first());
  expect(list.simulated).toBe(true);
  expect(list.moneyMoves).toBe(false);
  expect(list.provider).toMatchObject({ name: 'Corridra Pay (madeup)', madeup: true });
  const paid = list.attempts.find((a: { state: string }) => a.state === 'succeeded');
  expect(paid).toMatchObject({ workspaceName: 'Dhaka Imports', amountMinor: '4000' });
  const part = await refund(paid.id, '1000');
  expect(part).toMatchObject({ state: 'refunded', simulated: true });
  expect(part.attempt).toMatchObject({ refundedMinor: '1000', refundableMinor: '3000' });
  expect(part.attempt.refunds).toHaveLength(1);
  // The customer sees the refund too.
  const view = await pay().overview({ workspaceId });
  const mine = view.attempts.find((a: { id: string }) => a.id === paid.id);
  expect(mine).toMatchObject({ refundedMinor: '1000', refundableMinor: '3000' });
  // Never more than the attempt, never on a declined attempt, plain text only.
  await expect(refund(paid.id, '3001')).rejects.toMatchObject({ code: '23514' });
  const declined = list.attempts.find((a: { state: string }) => a.state === 'declined');
  await expect(refund(declined.id, '100')).rejects.toMatchObject({ code: '23514' });
  await expect(
    refund(paid.id, '100', first(), 'See https://example.com for the reason'),
  ).rejects.toThrow();
  await refund(paid.id, '3000');
  await expect(refund(paid.id, '1')).rejects.toMatchObject({ code: '23514' });
  expect(await ledger()).toMatchObject({ payments: 0, credits: 0 });
});

test('a refund after the made-up window is refused, and a refund is idempotent by command', async () => {
  const principal = (
    await s.f.owner.query(
      'SELECT created_by FROM customer_private.simulated_payment_attempt LIMIT 1',
    )
  ).rows[0].created_by as string;
  const id = randomUUID();
  await s.f.owner.query(
    `INSERT INTO customer_private.simulated_payment_attempt(id,tenant_id,invoice_id,amount_minor,currency,provider_ref,created_by,created_at,expires_at)
    VALUES($1,$2,$3,500,'SGD','SIMPAY-0123456789AB (madeup)',$4,clock_timestamp()-interval '20 days',clock_timestamp()+interval '10 minutes')`,
    [id, workspaceId, invoiceId, principal],
  );
  await s.f.owner.query(
    `INSERT INTO customer_private.simulated_payment_outcome(attempt_id,tenant_id,outcome,refund_window_days,decided_by,decided_at)
    VALUES($1,$2,'succeeded',14,$3,clock_timestamp()-interval '20 days')`,
    [id, workspaceId, principal],
  );
  await expect(refund(id, '100')).rejects.toMatchObject({ code: '23514' });
  const fresh = await start('2000');
  const ok = await complete(fresh.attempt.id, 'succeeded');
  const commandId = randomUUID();
  const input = {
    action: 'refund',
    commandId,
    attemptId: ok.attempt.id,
    amountMinor: '500',
    reason: 'Made-up refund to check the replay rule',
  };
  const a = await simStaff.command(first(), input);
  expect(await simStaff.command(first(), input)).toEqual(a);
  await expect(simStaff.command(first(), { ...input, amountMinor: '600' })).rejects.toThrow(
    /conflicts with original/i,
  );
  expect(a.attempt.refundedMinor).toBe('500');
});

test('the refund window is a setting: a new window applies to later outcomes and is recorded with them', async () => {
  expect(await sim({ refundWindowDays: 3 })).toMatchObject({ refundWindowDays: 3, changed: true });
  expect(await sim({ refundWindowDays: 3 })).toMatchObject({ changed: false });
  const started = await start('1500');
  const done = await complete(started.attempt.id, 'succeeded');
  const stored = (
    await s.f.owner.query(
      'SELECT refund_window_days FROM customer_private.simulated_payment_outcome WHERE attempt_id=$1',
      [done.attempt.id],
    )
  ).rows[0];
  expect(stored.refund_window_days).toBe(3);
  expect((await pay().overview({ workspaceId })).provider.refundPolicy).toContain(
    '3 days (madeup)',
  );
  await sim({ refundWindowDays: 14 });
});

test('staff authority: a sample operator, read-only roles and the customer login are refused', async () => {
  await expect(simStaff.list(s.f.users.owner.ctx)).rejects.toThrow();
  await expect(refund(randomUUID(), '100', s.f.users.owner.ctx)).rejects.toThrow();
  for (const role of ['operator', 'reviewer', 'viewer'] as const)
    await expect(
      simStaff.list({
        ...s.f.users[role].ctx,
        tenantId: s.intakeTenantId,
        purpose: 'commercial_qualification',
      }),
    ).rejects.toThrow();
  await expect(s.f.runtime.query('SELECT app.simulated_payments_staff_list()')).rejects.toThrow();
});

test('every record is append-only; the runtime logins reach no table or private function', async () => {
  for (const table of [
    'simulated_payments_control',
    'simulated_payment_attempt',
    'simulated_payment_outcome',
    'simulated_payment_refund',
    'simulated_payment_customer_command',
    'simulated_payment_staff_command',
  ]) {
    await expect(
      s.f.owner.query(`UPDATE customer_private.${table} SET created_at=now()`),
    ).rejects.toThrow();
    await expect(s.f.owner.query(`DELETE FROM customer_private.${table}`)).rejects.toThrow();
    await expect(
      s.f.runtime.query(`SELECT * FROM customer_private.${table}`),
    ).rejects.toMatchObject({ code: '42501' });
  }
  for (const sql of [
    'SELECT customer_private.simulated_payments_open()',
    'SELECT customer_private.simulated_payment_state($1)',
    'SELECT customer_private.simulated_payment_json($1,$2)',
  ])
    await expect(s.f.runtime.query(sql, [randomUUID(), 'customer'])).rejects.toMatchObject({
      code: '42501',
    });
  await expect(
    s.f.auth.query('SELECT customer.simulated_payments_overview($1)', [workspaceId]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    s.f.runtime.query('SELECT * FROM customer_payments_simulated_migrations.applied'),
  ).rejects.toMatchObject({ code: '42501' });
});

test('events carry no amount or text, customers are attributed to the service executor and staff to themselves', async () => {
  const events = (
    await s.f.owner.query(
      `SELECT type,payload FROM app.domain_event WHERE type LIKE 'customer.simulated_payments.%' ORDER BY occurred_at`,
    )
  ).rows as { type: string; payload: Record<string, unknown> }[];
  expect(events.map((e) => e.type)).toEqual(
    expect.arrayContaining([
      'customer.simulated_payments.attempt.started',
      'customer.simulated_payments.attempt.declined',
      'customer.simulated_payments.attempt.succeeded',
      'customer.simulated_payments.refund.recorded',
    ]),
  );
  for (const e of events) {
    expect(Object.keys(e.payload).sort()).toEqual(
      ['attemptId', 'initiator_id', 'initiator_kind', 'seq', 'simulated', 'synthetic'].sort(),
    );
    expect(e.payload).toMatchObject({ simulated: true, synthetic: false });
  }
});

test('a synthetic workspace cannot use the simulated flow and a real operator reaches no sample payment', async () => {
  await expect(
    s.f.owner.query(
      `INSERT INTO customer_private.simulated_payment_attempt(tenant_id,invoice_id,amount_minor,currency,provider_ref,created_by,expires_at)
      SELECT t.id,$1,100,'SGD','SIMPAY-FFFFFFFFFFFF (madeup)',(SELECT created_by FROM customer_private.simulated_payment_attempt LIMIT 1),clock_timestamp()+interval '5 minutes'
      FROM app.tenant t WHERE t.synthetic LIMIT 1`,
      [invoiceId],
    ),
  ).rejects.toThrow();
  await expect(
    s.f.owner.query(
      `INSERT INTO customer_private.simulated_payment_attempt(tenant_id,invoice_id,amount_minor,currency,provider_ref,created_by,expires_at)
      VALUES($1,$2,100,'SGD','not-madeup',(SELECT created_by FROM customer_private.simulated_payment_attempt LIMIT 1),clock_timestamp()+interval '5 minutes')`,
      [workspaceId, invoiceId],
    ),
  ).rejects.toThrow();
});
