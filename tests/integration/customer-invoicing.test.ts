import { beforeAll, afterAll, expect, test } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { accessFixture } from './access-fixture';
import { rawContext } from './support';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerBilling } from '../../packages/db/src/customer-billing-migrate';
import { migrateCustomerInvoicing } from '../../packages/db/src/customer-invoicing-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import {
  CustomerBillingService,
  customerBillingEnabled,
  type BillingPlan,
} from '../../packages/auth/src/customer-billing';
import {
  CustomerInvoicingService,
  customerInvoicingEnabled,
  type Invoice,
  type InvoicingOverview,
} from '../../packages/auth/src/customer-invoicing';
import { CustomerBillingStaffService } from '../../packages/delivery/src/customer-billing-staff';
import {
  CustomerInvoicingStaffService,
  staffInvoicingCommandInput,
} from '../../packages/delivery/src/customer-invoicing-staff';

// Invented provider-session fixtures exercise the real restricted SQL logins and the real staff session rows.
const issuer = 'https://ep-invoicing-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'erin'];
let f: Awaited<ReturnType<typeof accessFixture>>;
let workspaceId: string, otherWorkspace: string;
let billingStaff: CustomerBillingStaffService;
let staff: CustomerInvoicingStaffService;
const members: Record<string, string> = {};
let before: Awaited<ReturnType<typeof snapshot>>;
const session = (person: string): CustomerSession => ({
  subject: 'synthetic-invoicing-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const billing = (person = 'alice') =>
  new CustomerBillingService(f.runtime, f.auth, options, async () => session(person));
const invoicing = (person = 'alice') =>
  new CustomerInvoicingService(f.runtime, f.auth, options, async () => session(person));
const workspaces = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const roles = (person = 'alice') =>
  new CustomerMemberRoleService(f.runtime, f.auth, options, async () => session(person));
const staffCtx = () => f.users.owner.ctx;
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const note = 'Synthetic note for the customer to read';
let freshCount = 0;
const freshWorkspace = async (person = 'alice') =>
  (
    await workspaces(person).provision({
      commandId: randomUUID(),
      name: 'Synthetic invoicing workspace ' + ++freshCount,
    })
  ).id as string;
const overview = async (target = workspaceId, person = 'alice') =>
  (await invoicing(person).overview({ workspaceId: target })) as InvoicingOverview;

// Requests a plan for a workspace and has staff activate it for the current month. Returns the subscription id.
async function hold(key: string, target: string, start = day(), person = 'alice') {
  const shown = await billing(person).plans({ workspaceId: target });
  const plan = shown.plans.find((p: BillingPlan) => p.key === key)!;
  const sub = await billing(person).command({
    action: 'request',
    commandId: randomUUID(),
    workspaceId: target,
    planKey: plan.key,
    planVersion: plan.version,
    planDigest: plan.digest,
    acknowledged: true,
  });
  const detail = await billingStaff.view(staffCtx(), sub.id);
  await billingStaff.command(staffCtx(), {
    action: 'activate',
    commandId: randomUUID(),
    subscriptionId: sub.id,
    expectedSeq: detail.lastSeq,
    periodStart: start,
    customerNote: null,
  });
  return sub.id as string;
}
// A held subscription in a workspace of its own: the common starting point.
async function held(key = 'example-organiser') {
  const target = await freshWorkspace();
  const sub = await hold(key, target);
  return { target, sub };
}
const issueBody = (sub: string, over: Record<string, unknown> = {}) => ({
  action: 'issue',
  commandId: randomUUID(),
  subscriptionId: sub,
  periodStart: day(),
  planFeeMinor: '4900',
  taxMinor: '490',
  dueOn: day(14),
  ...over,
});
const issue = (sub: string, over: Record<string, unknown> = {}) =>
  staff.command(staffCtx(), issueBody(sub, over)) as Promise<Invoice & { position: number }>;
const position = async (id: string) =>
  ((await staff.view(staffCtx(), id)).invoice.position as number) ?? 0;
const pay = async (id: string, amountMinor: string, over: Record<string, unknown> = {}) =>
  staff.command(staffCtx(), {
    action: 'payment',
    commandId: randomUUID(),
    invoiceId: id,
    expectedPosition: await position(id),
    amountMinor,
    receivedOn: day(),
    method: 'bank_transfer',
    reference: 'Synthetic transfer reference 0001',
    ...over,
  }) as Promise<Invoice>;
const credit = async (id: string, amountMinor: string, over: Record<string, unknown> = {}) =>
  staff.command(staffCtx(), {
    action: 'credit',
    commandId: randomUUID(),
    invoiceId: id,
    expectedPosition: await position(id),
    amountMinor,
    reason: 'Synthetic credit for a rehearsal correction',
    ...over,
  }) as Promise<Invoice>;
// A plan of the staff's own whose price includes tax, used for the third tax treatment.
async function includesTaxPlan() {
  const key = 'example-inclusive-' + randomUUID().slice(0, 8);
  await billingStaff.revisePlan(staffCtx(), {
    commandId: randomUUID(),
    planKey: key,
    expectedVersion: 0,
    title: 'Inclusive monthly (sample plan)',
    summary: 'An example monthly plan whose price already includes tax. The price is invented.',
    interval: 'month',
    priceMinor: '12000',
    currency: 'USD',
    taxTreatment: 'price_includes_tax',
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
  });
  return key;
}
// Time travel for overdue tests: owner-only surgery that moves an invoice into the past. The triggers that forbid
// exactly this are switched off for the one statement and switched on again.
async function backdateInvoice(invoiceId: string, days: number) {
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      'ALTER TABLE customer_private.invoicing_invoice DISABLE TRIGGER invoicing_invoice_immutable',
    );
    await db.query(
      'ALTER TABLE customer_private.invoicing_invoice DISABLE TRIGGER invoicing_invoice_guard',
    );
    await db.query(
      'UPDATE customer_private.invoicing_invoice SET issue_date=issue_date-$2::int,due_date=due_date-$2::int WHERE id=$1',
      [invoiceId, days],
    );
    await db.query(
      'ALTER TABLE customer_private.invoicing_invoice ENABLE TRIGGER invoicing_invoice_immutable',
    );
    await db.query(
      'ALTER TABLE customer_private.invoicing_invoice ENABLE TRIGGER invoicing_invoice_guard',
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
async function snapshot() {
  const functions = (
    await f.owner.query(
      `SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1`,
    )
  ).rows;
  const tables = (
    await f.owner.query(
      `SELECT n.nspname,c.relname,c.relacl::text acl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1,2`,
    )
  ).rows;
  const records: Record<string, string> = {};
  for (const row of tables) {
    const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    records[row.nspname + '.' + row.relname] = (
      await f.owner.query(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) d FROM ${q(row.nspname)}.${q(row.relname)} t`,
      )
    ).rows[0].d;
  }
  return {
    functions,
    tables,
    records,
    policies: (
      await f.owner.query(
        "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
      )
    ).rows,
    triggers: (
      await f.owner.query(
        "SELECT c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1,2",
      )
    ).rows,
  };
}
async function chainCounts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.invoicing_invoice) invoices,
 (SELECT count(*)::int FROM customer_private.invoicing_payment) payments,
 (SELECT count(*)::int FROM customer_private.invoicing_credit) credits,
 (SELECT count(*)::int FROM customer_private.invoicing_command) commands,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_invoice') events,
 (SELECT count(*)::int FROM app.audit_event a JOIN app.domain_event e ON e.id=a.domain_event_id WHERE e.aggregate_type='customer_invoice') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_invoice') outbox`)
  ).rows[0];
}

beforeAll(async () => {
  f = await accessFixture();
  billingStaff = new CustomerBillingStaffService(f.runtime);
  staff = new CustomerInvoicingStaffService(f.runtime);
  // Stage everything this module reads, populated, before the module exists.
  await migrateCustomerMemberRoles(f.owner);
  await migrateCustomerBilling(f.owner);
  for (const person of people)
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(person).subject,
      executorId: f.serviceId,
      reason: 'Explicit invented invoicing test identity; no real account or email',
    });
  workspaceId = (
    await workspaces().provision({ commandId: randomUUID(), name: 'Synthetic invoicing workspace' })
  ).id;
  otherWorkspace = (
    await workspaces('dave').provision({
      commandId: randomUUID(),
      name: 'Synthetic separate private workspace',
    })
  ).id;
  for (const person of ['bob', 'carol']) {
    const invited = await workspaces('alice').access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      label: 'Synthetic invited ' + person,
    });
    members[person] = (
      await workspaces(person).access({
        action: 'accept',
        commandId: randomUUID(),
        token: invited.token!,
      })
    ).memberId!;
  }
  await roles().command({
    action: 'set_role',
    commandId: randomUUID(),
    workspaceId,
    memberId: members.bob,
    role: 'admin',
    expectedRole: 'member',
  });
  before = await snapshot();
  await migrateCustomerInvoicing(f.owner);
}, 120000);
afterAll(async () => {
  await f?.close();
});

test('installing the module on a populated database adds only new objects and changes no existing function, table, policy or row', async () => {
  const after = await snapshot();
  const oldFunctions = new Map(before.functions.map((r) => [r.name, r]));
  for (const [name, row] of oldFunctions) {
    const now = after.functions.find((r) => r.name === name)!;
    expect(now).toEqual(row);
  }
  const added = after.functions.filter((r) => !oldFunctions.has(r.name)).map((r) => r.name);
  expect(added.filter((n) => !/^(customer|customer_private|app)\.invoicing_/.test(n))).toEqual([]);
  expect(added).toContain('app.invoicing_staff_command(uuid,text,jsonb)');
  const oldTables = new Set(before.tables.map((t) => t.nspname + '.' + t.relname));
  expect(
    after.tables
      .map((t) => t.nspname + '.' + t.relname)
      .filter((t) => !oldTables.has(t))
      .sort(),
  ).toEqual(
    ['command', 'credit', 'invoice', 'payment'].map((n) => 'customer_private.invoicing_' + n).sort(),
  );
  for (const [name, digest] of Object.entries(before.records))
    expect(after.records[name]).toBe(digest);
  expect(
    after.policies.filter(
      (p) =>
        !before.policies.some((q) => q.policyname === p.policyname && q.tablename === p.tablename),
    ),
  ).toEqual([]);
  for (const t of before.tables) {
    const n = after.tables.find((x) => x.nspname === t.nspname && x.relname === t.relname)!;
    expect(n.acl).toBe(t.acl);
    expect(n.relrowsecurity).toBe(t.relrowsecurity);
  }
  const triggers = after.triggers.filter(
    (t) => !before.triggers.some((o) => o.relname === t.relname && o.tgname === t.tgname),
  );
  expect(triggers.every((t) => /^invoicing_/.test(t.relname))).toBe(true);
  // The module needs only the billing module: the paid-service module is not installed.
  expect(
    (await f.owner.query("SELECT to_regclass('customer_private.service_request') r")).rows[0].r,
  ).toBeNull();
  const applied = (
    await f.owner.query('SELECT name,sha256 FROM customer_invoicing_migrations.applied')
  ).rows;
  expect(applied).toHaveLength(1);
  const sql = await readFile('packages/db/customer-invoicing-migrations/' + applied[0].name, 'utf8');
  expect(applied[0].sha256).toBe(createHash('sha256').update(sql).digest('hex'));
});

test('the runtime and auth logins can reach only the five intended functions and none of the tables', async () => {
  for (const pool of [f.runtime, f.auth])
    for (const t of ['invoice', 'payment', 'credit', 'command']) {
      await expect(pool.query('SELECT * FROM customer_private.invoicing_' + t)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(pool.query('DELETE FROM customer_private.invoicing_' + t)).rejects.toThrow(
        /permission denied/i,
      );
    }
  await expect(
    f.runtime.query(
      "INSERT INTO customer_private.invoicing_payment(invoice_id,tenant_id,seq,amount_minor,received_on,method,reference,recorded_by,staff_tenant_id) VALUES($1,$1,1,1,current_date,'cash','Synthetic x1 reference',$1,$1)",
      [randomUUID()],
    ),
  ).rejects.toThrow(/permission denied/i);
  const exec = async (role: string) =>
    (
      await f.owner.query(
        `SELECT p.oid::regprocedure::text name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.proname LIKE 'invoicing\\_%' AND n.nspname IN ('app','customer','customer_private') AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY 1`,
        [role],
      )
    ).rows.map((r) => r.name);
  expect(await exec('corridra_runtime')).toEqual(
    [
      'app.invoicing_staff_command(uuid,text,jsonb)',
      'app.invoicing_staff_list(uuid,integer)',
      'app.invoicing_staff_pending()',
      'app.invoicing_staff_view(uuid)',
      'customer.invoicing_overview(uuid)',
    ].sort(),
  );
  expect(await exec('corridra_auth')).toEqual([]);
  // Called without a customer session the customer function is denied; staff functions need the staff authority.
  await expect(
    f.runtime.query('SELECT customer.invoicing_overview($1)', [workspaceId]),
  ).rejects.toThrow(/denied/i);
  await expect(f.runtime.query('SELECT app.invoicing_staff_pending()')).rejects.toThrow();
  const hostile = await rawContext(
    f.runtime,
    f.users.viewer.ctx,
    'SELECT app.invoicing_staff_list(NULL,10) r',
    [],
  ).catch((e) => e);
  expect(String(hostile)).toMatch(/owner or admin|denied|fresh authenticator/i);
  const good = await rawContext(
    f.runtime,
    staffCtx(),
    'SELECT app.invoicing_staff_pending() r',
    [],
  );
  expect(Array.isArray(good.rows[0].r.periods)).toBe(true);
});

test('an invoice covers one activated period, states exact amounts for each tax treatment and numbers follow without gaps', async () => {
  // Price excludes tax: the stated tax is added.
  const a = await held('example-organiser');
  const first = await issue(a.sub, { taxMinor: '490' });
  expect(first).toMatchObject({
    number: expect.stringMatching(/^SAMPLE-INV-\d{6}$/),
    workspaceId: a.target,
    currency: 'USD',
    taxTreatment: 'price_excludes_tax',
    planFeeMinor: '4900',
    taxMinor: '490',
    totalMinor: '5390',
    paidMinor: '0',
    creditedMinor: '0',
    outstandingMinor: '5390',
    status: 'unpaid',
    overdue: false,
    moneyDomain: 'B',
    label: 'Sample record, not a tax invoice',
    synthetic: true,
    position: 0,
    payments: [],
    credits: [],
  });
  expect(first.issueDate).toBe(day());
  expect(first.dueDate).toBe(day(14));
  expect(first.periodStart).toBe(day());
  // Zero tax is a statement, not an absence.
  const zeroHeld = await held('example-organiser');
  const zero = await issue(zeroHeld.sub, { taxMinor: '0' });
  expect(zero).toMatchObject({ taxMinor: '0', totalMinor: '4900' });
  // Price includes tax: the stated tax is inside the price and the total is the price.
  const key = await includesTaxPlan();
  const b = await freshWorkspace();
  const bSub = await hold(key, b);
  const included = await issue(bSub, { planFeeMinor: '12000', taxMinor: '1000' });
  expect(included).toMatchObject({
    taxTreatment: 'price_includes_tax',
    planFeeMinor: '12000',
    taxMinor: '1000',
    totalMinor: '12000',
  });
  // Tax to be confirmed: no tax amount is stated; BDT stays BDT.
  const c = await freshWorkspace();
  const cSub = await hold('example-organiser-bdt', c);
  const unconfirmed = await issue(cSub, { planFeeMinor: '480000', taxMinor: null });
  expect(unconfirmed).toMatchObject({
    currency: 'BDT',
    taxTreatment: 'tax_to_be_confirmed',
    planFeeMinor: '480000',
    taxMinor: null,
    totalMinor: '480000',
  });
  // Numbers follow in order without gaps, and a credit note number sequence is its own.
  const numbers = (
    await f.owner.query('SELECT invoice_no FROM customer_private.invoicing_invoice ORDER BY invoice_no')
  ).rows.map((r) => r.invoice_no);
  expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  const issued = [first, zero, included, unconfirmed].map((i) => i.number);
  expect(issued.every((n) => /^SAMPLE-INV-\d{6}$/.test(n))).toBe(true);
  expect(new Set(issued).size).toBe(4);
});

test('an invoice is refused for an unknown period, a free plan, a wrong fee or tax, a bad due date or a period already invoiced', async () => {
  const a = await held('example-organiser');
  await expect(issue(a.sub, { periodStart: day(-40) })).rejects.toThrow(
    /activated or renewed/i,
  );
  await expect(issue(randomUUID())).rejects.toThrow(/unavailable/i);
  await expect(issue(a.sub, { planFeeMinor: '4800' })).rejects.toThrow(/equal the plan price/i);
  await expect(issue(a.sub, { taxMinor: null })).rejects.toThrow(/tax amount/i);
  await expect(issue(a.sub, { dueOn: day(-1) })).rejects.toThrow(/within 90 days/i);
  await expect(issue(a.sub, { dueOn: day(91) })).rejects.toThrow(/within 90 days/i);
  // Nothing was written by the refusals, then the right one works once.
  expect((await staff.pending(staffCtx())).periods.some((p: { subscriptionId: string }) => p.subscriptionId === a.sub)).toBe(true);
  const ok = await issue(a.sub);
  await expect(issue(a.sub)).rejects.toThrow(/already invoiced/i);
  expect(
    (await staff.pending(staffCtx())).periods.some((p: { subscriptionId: string }) => p.subscriptionId === a.sub),
  ).toBe(false);
  expect(ok.status).toBe('unpaid');
  // A free plan cannot be invoiced and never appears among the periods to invoice.
  const free = await held('example-starter');
  await expect(issue(free.sub, { planFeeMinor: '1' })).rejects.toThrow(/free plan/i);
  expect(
    (await staff.pending(staffCtx())).periods.some((p: { subscriptionId: string }) => p.subscriptionId === free.sub),
  ).toBe(false);
  // Tax inside the price cannot be more than the price.
  const key = await includesTaxPlan();
  const b = await freshWorkspace();
  const bSub = await hold(key, b);
  await expect(issue(bSub, { planFeeMinor: '12000', taxMinor: '12001' })).rejects.toThrow(
    /cannot be more than the price/i,
  );
  // A tax-to-be-confirmed plan cannot be given a tax amount.
  const c = await freshWorkspace();
  const cSub = await hold('example-organiser-bdt', c);
  await expect(issue(cSub, { planFeeMinor: '480000', taxMinor: '100' })).rejects.toThrow(
    /to be confirmed/i,
  );
});

test('two staff issuing the same period at the same moment produce one invoice, and different periods get different numbers', async () => {
  const a = await held('example-organiser');
  const settled = await Promise.allSettled([issue(a.sub), issue(a.sub)]);
  expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .every((r) => /already invoiced/i.test(String(r.reason))),
  ).toBe(true);
  const b = await held('example-organiser');
  const c = await held('example-organiser');
  const both = await Promise.all([issue(b.sub), issue(c.sub)]);
  expect(new Set(both.map((i) => i.number)).size).toBe(2);
  const numbers = (
    await f.owner.query('SELECT invoice_no FROM customer_private.invoicing_invoice ORDER BY invoice_no')
  ).rows.map((r) => r.invoice_no);
  expect(numbers).toEqual(numbers.map((_, i) => i + 1));
});

test('a renewed period is invoiced on its own and the earlier period keeps its invoice', async () => {
  const a = await held('example-organiser');
  const first = await issue(a.sub);
  const detail = await billingStaff.view(staffCtx(), a.sub);
  await billingStaff.command(staffCtx(), {
    action: 'renew',
    commandId: randomUUID(),
    subscriptionId: a.sub,
    expectedSeq: detail.lastSeq,
    customerNote: null,
  });
  const periods = (await staff.pending(staffCtx())).periods.filter(
    (p: { subscriptionId: string }) => p.subscriptionId === a.sub,
  );
  expect(periods).toHaveLength(1);
  expect(periods[0].periodStart).toBe(first.periodEnd);
  const second = await issue(a.sub, { periodStart: periods[0].periodStart });
  expect(second.periodStart).toBe(first.periodEnd);
  expect(second.number).not.toBe(first.number);
  expect((await overview(a.target)).invoices.map((i) => i.number)).toEqual([
    second.number,
    first.number,
  ]);
});

test('payments are recorded against what is outstanding, name the position they saw and cannot be dated in the future or before the invoice', async () => {
  const a = await held('example-organiser');
  const inv = await issue(a.sub, { taxMinor: '490' });
  expect(inv.totalMinor).toBe('5390');
  const partly = await pay(inv.id, '2000');
  expect(partly).toMatchObject({
    status: 'partly_paid',
    paidMinor: '2000',
    outstandingMinor: '3390',
    position: 1,
  });
  expect(partly.payments).toHaveLength(1);
  expect(partly.payments[0]).toMatchObject({ seq: 1, amountMinor: '2000', method: 'bank_transfer' });
  // More than is outstanding, a stale position, a future date and a date before the invoice are all refused.
  await expect(pay(inv.id, '3391')).rejects.toThrow(/more than is still outstanding/i);
  await expect(pay(inv.id, '100', { expectedPosition: 0 })).rejects.toThrow(/reload/i);
  await expect(pay(inv.id, '100', { receivedOn: day(1) })).rejects.toThrow(/future/i);
  await expect(pay(inv.id, '100', { receivedOn: day(-1) })).rejects.toThrow(
    /before the invoice/i,
  );
  await expect(pay(inv.id, '100', { method: 'card' })).rejects.toThrow();
  await expect(pay(inv.id, '100', { reference: 'A real transfer from my bank' })).rejects.toThrow();
  const done = await pay(inv.id, '3390', { method: 'cash', reference: 'Synthetic cash handover 0002' });
  expect(done).toMatchObject({ status: 'paid', outstandingMinor: '0', paidMinor: '5390', position: 2 });
  // Nothing more can be paid or credited.
  await expect(pay(inv.id, '1')).rejects.toThrow(/more than is still outstanding/i);
  await expect(credit(inv.id, '1')).rejects.toThrow(/more than is still unpaid/i);
  expect((await staff.view(staffCtx(), inv.id)).actions).toEqual([]);
});

test('credit notes reduce what is unpaid, never more, and every status is derived from the three record kinds', async () => {
  // Nothing paid, everything credited.
  const a = await held('example-organiser');
  const one = await issue(a.sub, { taxMinor: '0' });
  await expect(credit(one.id, '4901')).rejects.toThrow(/more than is still unpaid/i);
  const partlyCredited = await credit(one.id, '900');
  expect(partlyCredited).toMatchObject({ status: 'unpaid', creditedMinor: '900', outstandingMinor: '4000' });
  expect(partlyCredited.credits[0]).toMatchObject({
    seq: 1,
    number: expect.stringMatching(/^SAMPLE-CN-\d{6}$/),
    amountMinor: '900',
  });
  const credited = await credit(one.id, '4000');
  expect(credited).toMatchObject({ status: 'credited', paidMinor: '0', outstandingMinor: '0' });
  // Paid and credited.
  const b = await held('example-organiser');
  const two = await issue(b.sub, { taxMinor: '0' });
  await pay(two.id, '1000');
  const settled = await credit(two.id, '3900');
  expect(settled).toMatchObject({ status: 'settled', paidMinor: '1000', creditedMinor: '3900', outstandingMinor: '0' });
  // Credit numbers are gap-free and their own sequence.
  const numbers = (
    await f.owner.query('SELECT credit_no FROM customer_private.invoicing_credit ORDER BY credit_no')
  ).rows.map((r) => r.credit_no);
  expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  // A credit needs a reason that is invented text.
  const c = await held('example-organiser');
  const three = await issue(c.sub, { taxMinor: '0' });
  await expect(credit(three.id, '100', { reason: 'Customer was unhappy' })).rejects.toThrow();
  await expect(credit(three.id, '100', { reason: 'Synthetic' })).rejects.toThrow();
});

test('an invoice is overdue only while something is unpaid after its due date', async () => {
  const a = await held('example-organiser');
  const inv = await issue(a.sub, { taxMinor: '0', dueOn: day(5) });
  expect(inv.overdue).toBe(false);
  // Due today is not yet overdue; the day after it is.
  const dueToday = await held('example-organiser');
  const same = await issue(dueToday.sub, { taxMinor: '0', dueOn: day() });
  expect(same.overdue).toBe(false);
  await backdateInvoice(same.id, 1);
  expect(((await staff.view(staffCtx(), same.id)).invoice as Invoice).overdue).toBe(true);
  await backdateInvoice(inv.id, 10);
  const late = (await staff.view(staffCtx(), inv.id)).invoice as Invoice;
  expect(late).toMatchObject({ overdue: true, status: 'unpaid' });
  expect((await overview(a.target)).balances).toEqual([
    {
      currency: 'USD',
      invoicedMinor: '4900',
      paidMinor: '0',
      creditedMinor: '0',
      outstandingMinor: '4900',
      overdueMinor: '4900',
    },
  ]);
  await pay(inv.id, '4900', { receivedOn: day(-3) });
  expect(((await staff.view(staffCtx(), inv.id)).invoice as Invoice).overdue).toBe(false);
  expect((await overview(a.target)).balances[0]).toMatchObject({ outstandingMinor: '0', overdueMinor: '0' });
});

test('two payments or credits sent at the same moment for the same position cannot both land or exceed what is outstanding', async () => {
  const a = await held('example-organiser');
  const inv = await issue(a.sub, { taxMinor: '0' });
  const expectedPosition = await position(inv.id);
  const send = (amountMinor: string) =>
    staff.command(staffCtx(), {
      action: 'payment',
      commandId: randomUUID(),
      invoiceId: inv.id,
      expectedPosition,
      amountMinor,
      receivedOn: day(),
      method: 'bank_transfer',
      reference: 'Synthetic simultaneous reference',
    });
  const settled = await Promise.allSettled([send('3000'), send('3000')]);
  expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  // Even with fresh positions the database never lets the sum pass the total.
  const b = await held('example-organiser');
  const second = await issue(b.sub, { taxMinor: '0' });
  const pos = await position(second.id);
  const race = await Promise.allSettled([
    staff.command(staffCtx(), {
      action: 'payment',
      commandId: randomUUID(),
      invoiceId: second.id,
      expectedPosition: pos,
      amountMinor: '4000',
      receivedOn: day(),
      method: 'cash',
      reference: 'Synthetic race payment',
    }),
    staff.command(staffCtx(), {
      action: 'credit',
      commandId: randomUUID(),
      invoiceId: second.id,
      expectedPosition: pos,
      amountMinor: '4000',
      reason: 'Synthetic race credit',
    }),
  ]);
  expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const view = (await staff.view(staffCtx(), second.id)).invoice as Invoice;
  expect(BigInt(view.paidMinor) + BigInt(view.creditedMinor)).toBeLessThanOrEqual(4900n);
});

test('staff commands replay once, conflict on other content and need the staff authority', async () => {
  const a = await held('example-organiser');
  const body = issueBody(a.sub);
  const start = await chainCounts();
  const first = (await staff.command(staffCtx(), body)) as Invoice;
  const again = (await staff.command(staffCtx(), body)) as Invoice;
  expect(again).toEqual(first);
  const end = await chainCounts();
  expect(end.invoices).toBe(start.invoices + 1);
  expect(end.events).toBe(start.events + 1);
  expect(end.commands).toBe(start.commands + 1);
  await expect(staff.command(staffCtx(), { ...body, taxMinor: '1' })).rejects.toThrow(/conflicts/i);
  await expect(
    staff.command(staffCtx(), {
      action: 'credit',
      commandId: body.commandId,
      invoiceId: first.id,
      expectedPosition: 0,
      amountMinor: '1',
      reason: 'Synthetic conflicting reason',
    }),
  ).rejects.toThrow(/conflicts/i);
  // Someone without the staff authority reads and writes nothing.
  for (const ctx of [f.users.viewer.ctx])
    await expect(staff.list(ctx, {})).rejects.toThrow(/owner or admin|denied|fresh authenticator/i);
  // Malformed requests are refused before the database.
  for (const bad of [
    { ...body, commandId: randomUUID(), planFeeMinor: '49.00' },
    { ...body, commandId: randomUUID(), taxMinor: '-1' },
    { ...body, commandId: randomUUID(), extra: true },
    { action: 'refund', commandId: randomUUID(), invoiceId: first.id },
    { action: 'payment', commandId: randomUUID(), invoiceId: first.id, expectedPosition: 0, amountMinor: '0', receivedOn: day(), method: 'cash', reference: 'Synthetic ok ref' },
  ])
    expect(staffInvoicingCommandInput.safeParse(bad).success).toBe(false);
});

test('owners and admins read their invoices and balances; a member only learns that invoices exist; outsiders read nothing', async () => {
  const sub = await hold('example-organiser', workspaceId);
  const inv = await issue(sub, { taxMinor: '490' });
  await pay(inv.id, '1000', { reference: 'Synthetic private transfer text' });
  const owner = await overview();
  const admin = await overview(workspaceId, 'bob');
  for (const view of [owner, admin]) {
    expect(view).toMatchObject({ canRead: true, invoicesExist: true, paymentTaken: false, synthetic: true });
    expect(view.invoices).toHaveLength(1);
    expect(view.invoices[0]).toMatchObject({
      number: inv.number,
      totalMinor: '5390',
      paidMinor: '1000',
      outstandingMinor: '4390',
      status: 'partly_paid',
    });
    // Customers see what was paid and when, never the staff reference or who recorded it.
    expect(JSON.stringify(view)).not.toMatch(/private transfer text|recordedAt|recordedBy|issuedAt|position/);
    expect(view.balances).toEqual([
      {
        currency: 'USD',
        invoicedMinor: '5390',
        paidMinor: '1000',
        creditedMinor: '0',
        outstandingMinor: '4390',
        overdueMinor: '0',
      },
    ]);
  }
  const member = await overview(workspaceId, 'carol');
  expect(member).toMatchObject({ canRead: false, invoicesExist: true, invoices: [], balances: [] });
  // Outsiders: a forged workspace id and a workspace of their own with nothing issued.
  await expect(overview(workspaceId, 'dave')).rejects.toThrow(/unavailable/i);
  await expect(overview(otherWorkspace, 'alice')).rejects.toThrow(/unavailable/i);
  expect(await overview(otherWorkspace, 'dave')).toMatchObject({
    canRead: true,
    invoicesExist: false,
    invoices: [],
    balances: [],
  });
  // There is no customer command that touches an invoice.
  await expect(
    f.runtime.query("SELECT customer.invoicing_overview($1)", [workspaceId]),
  ).rejects.toThrow(/denied/i);
});

test('balances are per currency and are never added or converted across currencies', async () => {
  const target = await freshWorkspace();
  const usd = await hold('example-organiser', target);
  const first = await issue(usd, { taxMinor: '0' });
  await pay(first.id, '1000');
  // A change of plan to a taka plan: the old plan ends in the same step, the old invoice stays.
  const bdt = await hold('example-organiser-bdt', target, day(1));
  const second = await issue(bdt, { periodStart: day(1), planFeeMinor: '480000', taxMinor: null });
  const view = await overview(target);
  expect(view.invoices.map((i) => [i.currency, i.totalMinor])).toEqual([
    ['BDT', '480000'],
    ['USD', '4900'],
  ]);
  expect(view.balances).toEqual([
    {
      currency: 'BDT',
      invoicedMinor: '480000',
      paidMinor: '0',
      creditedMinor: '0',
      outstandingMinor: '480000',
      overdueMinor: '0',
    },
    {
      currency: 'USD',
      invoicedMinor: '4900',
      paidMinor: '1000',
      creditedMinor: '0',
      outstandingMinor: '3900',
      overdueMinor: '0',
    },
  ]);
  expect(second.currency).toBe('BDT');
  const detail = await staff.view(staffCtx(), second.id);
  expect(detail.workspaceBalances).toEqual(view.balances);
});

test('direct SQL cannot write a wrong total, a wrong fee, an over-payment, an over-credit, a wrong date or a gap in the numbers', async () => {
  const a = await held('example-organiser');
  const inv = await issue(a.sub, { taxMinor: '0' });
  const sub = (
    await f.owner.query(
      'SELECT s.tenant_id,s.plan_id,e.period_start,e.period_end FROM customer_private.billing_subscription s JOIN customer_private.billing_subscription_event e ON e.subscription_id=s.id AND e.kind=\'activated\' WHERE s.id=$1',
      [a.sub],
    )
  ).rows[0];
  const b = await held('example-organiser');
  const row = (
    await f.owner.query(
      'SELECT s.tenant_id,s.plan_id,e.period_start,e.period_end FROM customer_private.billing_subscription s JOIN customer_private.billing_subscription_event e ON e.subscription_id=s.id AND e.kind=\'activated\' WHERE s.id=$1',
      [b.sub],
    )
  ).rows[0];
  const next = (await f.owner.query('SELECT max(invoice_no)+1 n FROM customer_private.invoicing_invoice')).rows[0].n;
  const insert = (over: Record<string, unknown> = {}) => {
    const v = {
      invoice_no: next,
      tenant_id: row.tenant_id,
      subscription_id: b.sub,
      plan_id: row.plan_id,
      period_start: row.period_start,
      period_end: row.period_end,
      issue_date: day(),
      due_date: day(10),
      currency: 'USD',
      tax_treatment: 'price_excludes_tax',
      plan_fee_minor: 4900,
      tax_minor: 0,
      total_minor: 4900,
      issued_by: f.users.owner.id,
      staff_tenant_id: f.tenantA,
      ...over,
    };
    const keys = Object.keys(v);
    return f.owner.query(
      `INSERT INTO customer_private.invoicing_invoice(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
      Object.values(v),
    );
  };
  await expect(insert({ total_minor: 4901 })).rejects.toThrow();
  await expect(insert({ plan_fee_minor: 4800, total_minor: 4800 })).rejects.toThrow(/match the plan price/i);
  await expect(insert({ currency: 'BDT' })).rejects.toThrow(/match the plan price/i);
  await expect(insert({ tax_treatment: 'tax_to_be_confirmed', tax_minor: null })).rejects.toThrow(
    /match the plan price/i,
  );
  await expect(insert({ money_domain: 'A' })).rejects.toThrow();
  await expect(insert({ synthetic: false })).rejects.toThrow();
  await expect(insert({ invoice_no: next + 1 })).rejects.toThrow(/in order/i);
  await expect(insert({ invoice_no: 1 })).rejects.toThrow();
  await expect(insert({ issue_date: day(-5), due_date: day(5) })).rejects.toThrow(/day it is recorded/i);
  await expect(insert({ due_date: day(120) })).rejects.toThrow();
  await expect(insert({ period_start: day(-60), period_end: day(-30) })).rejects.toThrow(
    /activated or renewed/i,
  );
  await expect(insert({ plan_id: (await f.owner.query("SELECT id FROM customer_private.billing_plan_version WHERE plan_key='example-starter'")).rows[0].id })).rejects.toThrow();
  await expect(insert({ tenant_id: otherWorkspace })).rejects.toThrow();
  // The one right row goes in.
  await insert();
  expect(sub.tenant_id).toBe(a.target);
  const payment = (over: Record<string, unknown> = {}) => {
    const v = {
      invoice_id: inv.id,
      tenant_id: inv.workspaceId,
      seq: 1,
      amount_minor: 1000,
      received_on: day(),
      method: 'cash',
      reference: 'Synthetic direct reference',
      recorded_by: f.users.owner.id,
      staff_tenant_id: f.tenantA,
      ...over,
    };
    const keys = Object.keys(v);
    return f.owner.query(
      `INSERT INTO customer_private.invoicing_payment(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
      Object.values(v),
    );
  };
  await expect(payment({ amount_minor: 4901 })).rejects.toThrow(/more than is still outstanding/i);
  await expect(payment({ amount_minor: 0 })).rejects.toThrow();
  await expect(payment({ amount_minor: -5 })).rejects.toThrow();
  await expect(payment({ received_on: day(1) })).rejects.toThrow(/future/i);
  await expect(payment({ received_on: day(-1) })).rejects.toThrow(/before the invoice/i);
  await expect(payment({ seq: 2 })).rejects.toThrow(/in order/i);
  await expect(payment({ method: 'card' })).rejects.toThrow();
  await expect(payment({ reference: 'A bank statement line' })).rejects.toThrow();
  await expect(payment({ tenant_id: otherWorkspace })).rejects.toThrow();
  await payment();
  await expect(payment({ seq: 2, amount_minor: 3901 })).rejects.toThrow(/more than is still outstanding/i);
  const cred = (over: Record<string, unknown> = {}) => {
    const v = {
      credit_no: 1000000,
      invoice_id: inv.id,
      tenant_id: inv.workspaceId,
      seq: 1,
      amount_minor: 100,
      issued_on: day(),
      reason: 'Synthetic direct reason',
      issued_by: f.users.owner.id,
      staff_tenant_id: f.tenantA,
      ...over,
    };
    const keys = Object.keys(v);
    return f.owner.query(
      `INSERT INTO customer_private.invoicing_credit(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
      Object.values(v),
    );
  };
  await expect(cred()).rejects.toThrow(/in order/i);
  const nextCredit = (await f.owner.query('SELECT coalesce(max(credit_no),0)+1 n FROM customer_private.invoicing_credit')).rows[0].n;
  await expect(cred({ credit_no: nextCredit, amount_minor: 3901 })).rejects.toThrow(/more than is still unpaid/i);
  await expect(cred({ credit_no: nextCredit, reason: 'Not invented' })).rejects.toThrow();
  await expect(cred({ credit_no: nextCredit, issued_on: day(-4) })).rejects.toThrow(/day it is recorded/i);
  await cred({ credit_no: nextCredit });
});

test('invoices, payments, credit notes and commands cannot be rewritten or deleted, even by the database owner', async () => {
  const a = await held('example-organiser');
  const inv = await issue(a.sub, { taxMinor: '0' });
  await pay(inv.id, '100');
  await credit(inv.id, '100');
  for (const [table, set] of [
    ['invoicing_invoice', 'total_minor=1'],
    ['invoicing_payment', 'amount_minor=1'],
    ['invoicing_credit', 'amount_minor=1'],
    ['invoicing_command', "operation='issue'"],
  ] as const) {
    await expect(f.owner.query(`UPDATE customer_private.${table} SET ${set}`)).rejects.toThrow();
    await expect(f.owner.query(`DELETE FROM customer_private.${table}`)).rejects.toThrow();
  }
});

test('the tables reference no participant, programme, cost, trade-value or contributor ledger', async () => {
  const refs = (
    await f.owner.query(
      `SELECT DISTINCT cl.relnamespace::regnamespace::text||'.'||cl.relname AS target
 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class cl ON cl.oid=c.confrelid
 WHERE c.contype='f' AND t.relnamespace='customer_private'::regnamespace AND t.relname LIKE 'invoicing\\_%' ORDER BY 1`,
    )
  ).rows.map((r) => r.target);
  expect(refs).toEqual([
    'app.currency',
    'app.tenant',
    'customer.workspace',
    'customer_private.billing_plan_version',
    'customer_private.billing_subscription',
    'customer_private.invoicing_invoice',
    'identity.principal',
  ]);
  // No function of the module reads another money ledger.
  const body = (
    await f.owner.query(
      `SELECT string_agg(pg_get_functiondef(p.oid),' ') d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.proname LIKE 'invoicing\\_%' AND n.nspname IN ('app','customer','customer_private')`,
    )
  ).rows[0].d as string;
  expect(body).not.toMatch(/programme|participant|cost_|revenue|trade_value|obligation|ledger/i);
});

test('events carry ids, the sample number and a sequence only, one chain per change, and never an amount, date, reference or reason', async () => {
  const a = await held('example-organiser');
  const start = await chainCounts();
  const inv = await issue(a.sub, { taxMinor: '490' });
  await pay(inv.id, '1234', { reference: 'Synthetic secret payment words' });
  await credit(inv.id, '777', { reason: 'Synthetic secret credit words' });
  const end = await chainCounts();
  expect(end.events).toBe(start.events + 3);
  expect(end.audits).toBe(start.audits + 3);
  expect(end.outbox).toBe(start.outbox + 3);
  expect(end.commands).toBe(start.commands + 3);
  const events = (
    await f.owner.query(
      "SELECT type,aggregate_version,tenant_id,payload::text p FROM app.domain_event WHERE aggregate_type='customer_invoice' AND aggregate_id=$1 ORDER BY aggregate_version",
      [inv.id],
    )
  ).rows;
  expect(events.map((e) => e.type)).toEqual([
    'customer.invoicing.invoice.issued',
    'customer.invoicing.payment.recorded',
    'customer.invoicing.credit.issued',
  ]);
  expect(events.map((e) => e.aggregate_version)).toEqual([1, 2, 3]);
  for (const e of events) {
    expect(e.tenant_id).toBe(a.target);
    expect(e.p).not.toMatch(/secret|words|5390|4900|490|1234|777|USD|reference|reason|amount|date/i);
    expect(JSON.parse(e.p)).toMatchObject({ invoiceId: inv.id, number: inv.number, synthetic: true });
  }
});

test('a workspace that is not a sample workspace is refused everywhere, and staff see nothing of it', async () => {
  const a = await held('example-organiser');
  const inv = await issue(a.sub, { taxMinor: '0' });
  await f.owner.query('UPDATE app.tenant SET synthetic=false WHERE id=$1', [a.target]);
  try {
    await expect(overview(a.target)).rejects.toThrow(/unavailable/i);
    await expect(staff.view(staffCtx(), inv.id)).rejects.toThrow(/unavailable/i);
    await expect(pay(inv.id, '1')).rejects.toThrow();
    await expect(credit(inv.id, '1')).rejects.toThrow();
    expect(
      (await staff.list(staffCtx(), { pageSize: 50 })).invoices.some((i: Invoice) => i.id === inv.id),
    ).toBe(false);
    await expect(
      f.owner.query(
        "INSERT INTO customer_private.invoicing_payment(invoice_id,tenant_id,seq,amount_minor,received_on,method,reference,recorded_by,staff_tenant_id) VALUES($1,$2,1,1,$3,'cash','Synthetic direct reference',$4,$5)",
        [inv.id, a.target, day(), f.users.owner.id, f.tenantA],
      ),
    ).rejects.toThrow(/synthetic only/i);
  } finally {
    await f.owner.query('UPDATE app.tenant SET synthetic=true WHERE id=$1', [a.target]);
  }
  expect((await overview(a.target)).invoices).toHaveLength(1);
});

test('staff list pages through invoices newest first and view shows the position and actions', async () => {
  const first = await staff.list(staffCtx(), { pageSize: 2 });
  expect(first.invoices).toHaveLength(2);
  expect(first.nextAfter).toBe(first.invoices[1].id);
  const numbers = first.invoices.map((i: Invoice) => i.number);
  expect(numbers).toEqual([...numbers].sort().reverse());
  const second = await staff.list(staffCtx(), { pageSize: 2, after: first.nextAfter });
  expect(second.invoices[0].number < first.invoices[1].number).toBe(true);
  await expect(staff.list(staffCtx(), { pageSize: 2, after: randomUUID() })).rejects.toThrow(
    /invalid page/i,
  );
  const view = await staff.view(staffCtx(), first.invoices[0].id);
  expect(view.invoice.workspaceName).toBeTruthy();
  expect(Array.isArray(view.actions)).toBe(true);
  await expect(staff.view(staffCtx(), randomUUID())).rejects.toThrow(/unavailable/i);
});

test('revoked, left and disabled members lose access at once, and the original owner keeps it', async () => {
  expect((await overview(workspaceId, 'carol')).canRead).toBe(false);
  await workspaces('alice').access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId,
    kind: 'membership',
    targetId: members.carol,
  });
  await expect(overview(workspaceId, 'carol')).rejects.toThrow(/unavailable/i);
  await f.owner.query(
    "UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject='synthetic-invoicing-bob'",
  );
  await expect(overview(workspaceId, 'bob')).rejects.toThrow(/denied/i);
  expect((await overview(workspaceId)).canRead).toBe(true);
});

test('the flags, synthetic and production gates stay binding and the installer is repeatable', async () => {
  const on = {
    DATA_ENVIRONMENT: 'synthetic',
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_BILLING_ENABLED: 'true',
  };
  expect(customerBillingEnabled(on)).toBe(true);
  expect(customerInvoicingEnabled(on)).toBe(false);
  expect(customerInvoicingEnabled({ ...on, CORRIDRA_CUSTOMER_INVOICING_ENABLED: 'true' })).toBe(true);
  expect(customerInvoicingEnabled({ ...on, CORRIDRA_CUSTOMER_INVOICING_ENABLED: 'yes' })).toBe(false);
  // Invoicing needs billing: the invoicing switch alone is not enough.
  expect(
    customerInvoicingEnabled({
      DATA_ENVIRONMENT: 'synthetic',
      CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
      CORRIDRA_CUSTOMER_INVOICING_ENABLED: 'true',
    }),
  ).toBe(false);
  expect(
    customerInvoicingEnabled({
      ...on,
      CORRIDRA_CUSTOMER_INVOICING_ENABLED: 'true',
      DATA_ENVIRONMENT: 'real',
    }),
  ).toBe(false);
  expect(
    customerInvoicingEnabled({
      ...on,
      CORRIDRA_CUSTOMER_INVOICING_ENABLED: 'true',
      VERCEL_ENV: 'production',
    }),
  ).toBe(false);
  for (const override of [{ enabled: false }, { synthetic: false }, { production: true }])
    await expect(
      new CustomerInvoicingService(f.runtime, f.auth, { ...options, ...override }, async () =>
        session('alice'),
      ).overview({ workspaceId }),
    ).rejects.toThrow(/unavailable/i);
  const expired = new CustomerInvoicingService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    expiresAt: new Date(Date.now() - 1000),
  }));
  await expect(expired.overview({ workspaceId })).rejects.toThrow(/sign in/i);
  const first = (await f.owner.query('SELECT * FROM customer_invoicing_migrations.applied')).rows;
  await migrateCustomerInvoicing(f.owner);
  expect((await f.owner.query('SELECT * FROM customer_invoicing_migrations.applied')).rows).toEqual(first);
  expect(first).toHaveLength(1);
  await f.owner.query('UPDATE customer_invoicing_migrations.applied SET sha256=$1', [
    randomBytes(32).toString('hex'),
  ]);
  await expect(migrateCustomerInvoicing(f.owner)).rejects.toThrow(/history mismatch/i);
  await f.owner.query('UPDATE customer_invoicing_migrations.applied SET sha256=$1', [first[0].sha256]);
});
