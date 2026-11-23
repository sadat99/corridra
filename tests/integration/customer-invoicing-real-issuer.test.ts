import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { realStaffFixture } from './real-staff-fixture';
import { migrateCustomerInvoicingReal } from '../../packages/db/src/customer-invoicing-real-migrate';
import { configureRealBilling } from '../../packages/auth/src/customer-billing-real-configuration';
import {
  configureRealInvoicing,
  defaultRealInvoicingEntity,
} from '../../packages/auth/src/customer-invoicing-real-configuration';
import {
  InvoiceIssuerService,
  invoiceIssuerEnabled,
  issuerDetailsInput,
} from '../../packages/auth/src/customer-invoicing-real-issuer';
import {
  CustomerRealInvoicingStaffService,
  madeupSupplierFields,
} from '../../packages/delivery/src/customer-invoicing-real-staff';

// ADR-091 (unit B8): the owner types the invoice issuer details on an Owner-only staff screen, behind an authenticator
// check made for the save. A save writes a new append-only version with no made-up field left among the typed ones, so
// the real-invoice refusal (D3) lifts only then. Nothing here opens real invoices: the control and the switch stay off.
const issuer =
  'https://ep-invoice-issuer-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let service: InvoiceIssuerService;
type Ctx = { token: string; tenantId: string; purpose: string };
let admin: { id: string; ctx: Ctx; sessionId: string };
let secondOwner: { id: string; ctx: Ctx; sessionId: string };
const owner = () => s.ctx as Ctx;
const real = {
  legalName: 'Corridra Pte Ltd',
  address: '8 Marina View, Asia Square Tower 1, Singapore 018960',
  uen: '202612345K',
  gstRegistered: true,
  gstRegistrationNo: 'M2-1234567-8',
  paymentInstructions:
    'Pay by bank transfer to Corridra Pte Ltd, DBS Bank, account 072-123456-7, quoting the invoice number',
  financeLabel: 'Corridra finance desk',
};
const entities = async () =>
  (await s.f.owner.query('SELECT * FROM customer_private.real_invoicing_entity ORDER BY version'))
    .rows as Record<string, unknown>[];
const latest = async () => (await entities()).at(-1)!;
const save = (over: Record<string, unknown> = {}, who: Ctx = owner(), version?: number) =>
  (async () =>
    service.save(who, {
      commandId: randomUUID(),
      expectedVersion: version ?? ((await latest()).version as number),
      ...real,
      ...over,
    }))();

async function addStaff(label: string, role: 'owner' | 'admin') {
  const id = randomUUID();
  const identityId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const sessionId = randomUUID();
  const client = await s.f.owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [s.f.serviceId, randomUUID(), randomUUID()],
    );
    await client.query(
      'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,true,true)',
      [identityId, 'Staff ' + label, `${label}@example.invalid`],
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
    sessionId,
    ctx: { token, tenantId: s.intakeTenantId, purpose: 'commercial_qualification' },
  };
}
// The authenticator check of a session, aged or renewed. identity.assurance is the record the sign-in hook writes.
const ageCheck = (token: string, minutes: number) =>
  s.f.owner.query(
    `UPDATE identity.assurance a SET verified_at=clock_timestamp()-make_interval(mins => $2)
     FROM identity.session x WHERE x.id=a.session_id AND x.token=$1`,
    [token, minutes],
  );

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'invoice-issuer-fixture-secret');
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_BILLING_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED', 'true');
  await migrateCustomerInvoicingReal(s.f.owner);
  // Install seeds the supplier details with every made-up field marked and leaves the control closed.
  await configureRealInvoicing(s.f.owner, {
    reason: 'Local fixture install for the invoice issuer tests',
  });
  service = new InvoiceIssuerService(s.f.runtime);
  admin = await addStaff('issuer-admin', 'admin');
  secondOwner = await addStaff('issuer-second-owner', 'owner');
}, 300000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

test('the screen switch is off unless it is exactly "true"', () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1', ' true'])
    expect(invoiceIssuerEnabled({ CORRIDRA_INVOICE_ISSUER: value } as never), String(value)).toBe(
      false,
    );
  expect(invoiceIssuerEnabled({ CORRIDRA_INVOICE_ISSUER: 'true' } as never)).toBe(true);
});

test('installing adds the third migration, is repeatable and leaves the control closed', async () => {
  await migrateCustomerInvoicingReal(s.f.owner);
  expect(
    (
      await s.f.owner.query(
        'SELECT name FROM customer_invoicing_real_migrations.applied ORDER BY name',
      )
    ).rows.map((r: { name: string }) => r.name),
  ).toEqual([
    '0001_real_invoicing.sql',
    '0002_payment_approval_and_reversal.sql',
    '0003_owner_issuer_details.sql',
  ]);
  expect((await s.f.owner.query('SELECT customer_private.real_invoicing_open() o')).rows[0].o).toBe(
    false,
  );
  // The seeded version is not owner entered.
  expect(await latest()).toMatchObject({ version: 1, owner_entered_by: null });
});

test('before any save the owner sees which details are missing, never a made-up value', async () => {
  const view = await service.view(owner());
  expect(view).toMatchObject({
    version: 1,
    complete: false,
    enteredByOwner: false,
    realInvoicesOpen: false,
    synthetic: false,
    fixed: { country: 'SG', taxLabel: 'GST', gstRateBps: 900, paymentTermsDays: 30 },
  });
  expect([...view.madeupFields].sort()).toEqual(
    [...defaultRealInvoicingEntity.madeupFields].sort(),
  );
  // Real values are shown; every made-up one is blank so the owner types it.
  expect(view.details).toEqual({
    legalName: 'Corridra Pte Ltd',
    address: '101 Robinson Road, Singapore 180239',
    uen: null,
    gstRegistered: null,
    gstRegistrationNo: null,
    paymentInstructions: null,
    financeLabel: null,
  });
  expect(JSON.stringify(view)).not.toMatch(/madeup\)/i);
});

test('only the owner of the real staff workspace may read or save; an admin, another role and a sample workspace are refused', async () => {
  await expect(service.view(admin.ctx)).rejects.toMatchObject({ status: 403 });
  await expect(save({}, admin.ctx)).rejects.toMatchObject({ status: 403 });
  // The sample staff workspace of the fixture: its owner is refused too.
  const sample = s.f.users.owner.ctx as Ctx;
  await expect(service.view(sample)).rejects.toMatchObject({ status: 403 });
  await expect(save({}, sample)).rejects.toMatchObject({ status: 403 });
  const operator = s.f.users.operator.ctx as Ctx;
  await expect(service.view(operator)).rejects.toMatchObject({ status: 403 });
  await expect(service.view({ ...owner(), token: 'not-a-session' })).rejects.toThrow();
  expect(await entities()).toHaveLength(1);
});

test('a save without a recent authenticator check asks for one and writes nothing', async () => {
  await ageCheck(owner().token, 6);
  await expect(save()).rejects.toMatchObject({ status: 401, code: 'STEP_UP_REQUIRED' });
  // Reading needs no fresh check.
  await expect(service.view(owner())).resolves.toMatchObject({ version: 1 });
  expect(await entities()).toHaveLength(1);
  await ageCheck(owner().token, 0);
});

test('incomplete, made-up or unsafe details are refused in the service and in the database', async () => {
  const bad: Record<string, unknown>[] = [
    { uen: null },
    { uen: '' },
    { legalName: 'C' },
    { address: 'x' },
    { paymentInstructions: 'Pay to account 000-000000-0 (madeup)' },
    { financeLabel: 'Sadat FPA (MadeUp)' },
    { financeLabel: 'finance@corridra.com' },
    { paymentInstructions: 'See https://corridra.com/pay for details' },
    { gstRegistered: true, gstRegistrationNo: null },
    { gstRegistered: false, gstRegistrationNo: 'M2-1234567-8' },
    { gstRegistered: 'yes' },
    { country: 'BD' },
    { madeupFields: [] },
  ];
  for (const over of bad)
    await expect(save(over), JSON.stringify(over)).rejects.toMatchObject({ status: 400 });
  expect(() => issuerDetailsInput.parse({ ...real, commandId: randomUUID() })).toThrow();
  // The database repeats every rule for a caller that skips the service.
  const direct = async (input: Record<string, unknown>) => {
    const db = await s.f.runtime.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        `SELECT set_config('corridra.session_hash',encode(sha256(convert_to($1,'UTF8')),'hex'),true),set_config('corridra.tenant_id',$2,true),
         set_config('corridra.purpose',$3,true),set_config('corridra.correlation_id',$4,true),set_config('corridra.causation_id',$4,true)`,
        [owner().token, owner().tenantId, owner().purpose, randomUUID()],
      );
      return await db.query('SELECT app.real_invoicing_issuer_save($1,$2) result', [
        randomUUID(),
        JSON.stringify({ expectedVersion: 1, ...real, ...input }),
      ]);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  };
  for (const over of bad.slice(0, 11))
    await expect(direct(over), JSON.stringify(over)).rejects.toMatchObject({ code: '23514' });
  await expect(direct({ extra: 'x' })).rejects.toMatchObject({ code: '23514' });
  expect(await entities()).toHaveLength(1);
});

test('D3 stays in force while any detail is made up', async () => {
  await configureRealBilling(s.f.owner, {
    enabled: true,
    reason: 'Local fixture control for the invoice issuer tests',
  });
  await configureRealInvoicing(s.f.owner, {
    enabled: true,
    reason: 'Local fixture control for the invoice issuer tests',
  });
  const staff = new CustomerRealInvoicingStaffService(s.f.runtime, () => true);
  const pending = await staff.pending(owner());
  expect(madeupSupplierFields(pending.supplier).length).toBeGreaterThan(0);
  await expect(
    staff.command(owner(), {
      action: 'prepare_invoice',
      commandId: randomUUID(),
      subscriptionId: randomUUID(),
      periodStart: '2026-11-01',
      dueOn: '2026-12-01',
      billToName: 'Dhaka Imports Limited',
      billToAddress: 'House 12, Road 5, Gulshan, Dhaka 1212, Bangladesh',
    }),
  ).rejects.toMatchObject({ status: 409, code: 'MADEUP_SUPPLIER_DETAILS' });
});

let firstCommand: string;
test('a complete save by the owner writes one new version with no made-up field and keeps the earlier version', async () => {
  const before = await entities();
  firstCommand = randomUUID();
  const saved = await service.save(owner(), {
    commandId: firstCommand,
    expectedVersion: 1,
    ...real,
  });
  expect(saved).toMatchObject({
    state: 'saved',
    version: 2,
    complete: true,
    madeupFields: [],
    synthetic: false,
  });
  expect([...saved.changedFields].sort()).toEqual(
    [
      'address',
      'financeLabel',
      'gstRegistrationNo',
      'gstRegistered',
      'paymentInstructions',
      'uen',
    ].sort(),
  );
  const after = await entities();
  expect(after).toHaveLength(2);
  // Append only: the seeded version is byte for byte what it was.
  expect(after[0]).toEqual(before[0]);
  expect(after[1]).toMatchObject({
    version: 2,
    legal_name: real.legalName,
    address: real.address,
    uen: real.uen,
    gst_registered: true,
    gst_registration_no: real.gstRegistrationNo,
    payment_instructions: real.paymentInstructions,
    finance_label: real.financeLabel,
    placeholder_fields: [],
    owner_entered_by: s.f.users.owner.id,
    executor_id: s.f.users.owner.id,
    // What the screen does not ask for is carried from the version before.
    country: before[0]!.country,
    tax_label: before[0]!.tax_label,
    gst_rate_bps: before[0]!.gst_rate_bps,
    payment_terms_days: before[0]!.payment_terms_days,
    approver_principal_id: before[0]!.approver_principal_id,
  });
  const view = await service.view(owner());
  expect(view).toMatchObject({ version: 2, complete: true, enteredByOwner: true });
  expect(view.madeupFields).toEqual([]);
  expect(view.details).toEqual(real);
});

test('the save leaves one event and one audit line that carry field names and no value', async () => {
  const events = (
    await s.f.owner.query(
      "SELECT e.payload,e.actor_id,e.tenant_id,e.aggregate_version,(SELECT count(*)::int FROM app.audit_event a WHERE a.domain_event_id=e.id) audits FROM app.domain_event e WHERE e.type='customer.real_invoicing.issuer_saved'",
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    actor_id: s.f.users.owner.id,
    tenant_id: s.intakeTenantId,
    aggregate_version: 2,
    audits: 1,
  });
  expect(events[0].payload).toMatchObject({ version: 2, synthetic: false });
  const text = JSON.stringify(events[0].payload);
  for (const value of Object.values(real))
    if (typeof value === 'string') expect(text).not.toContain(value);
});

test('the same command answers the same result once; a changed request under it is refused', async () => {
  const again = await service.save(owner(), {
    commandId: firstCommand,
    expectedVersion: 1,
    ...real,
  });
  expect(again).toMatchObject({ state: 'saved', version: 2 });
  await expect(
    service.save(owner(), {
      commandId: firstCommand,
      expectedVersion: 1,
      ...real,
      financeLabel: 'Another finance desk',
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await entities()).toHaveLength(2);
  // The command record keeps a digest of the request, never the details themselves.
  const record = JSON.stringify(
    (await s.f.owner.query('SELECT * FROM customer_private.real_invoicing_issuer_command')).rows,
  );
  expect(record).not.toContain(real.paymentInstructions);
  expect(record).not.toContain(real.uen);
});

test('a save against an older version is refused, and saving the same details again writes nothing', async () => {
  await expect(save({ financeLabel: 'Late finance desk' }, owner(), 1)).rejects.toMatchObject({
    status: 409,
    code: 'ISSUER_DETAILS_CHANGED',
  });
  const same = await save();
  expect(same).toMatchObject({ state: 'unchanged', version: 2, changedFields: [] });
  expect(await entities()).toHaveLength(2);
});

test('another owner can correct a detail with their own check; each version names who typed it', async () => {
  const saved = await save({ financeLabel: 'Corridra accounts team' }, secondOwner.ctx);
  expect(saved).toMatchObject({ state: 'saved', version: 3, changedFields: ['financeLabel'] });
  expect(await latest()).toMatchObject({
    version: 3,
    owner_entered_by: secondOwner.id,
    finance_label: 'Corridra accounts team',
  });
  // An unregistered issuer carries no GST number.
  const plain = await save({ gstRegistered: false, gstRegistrationNo: null });
  expect(plain).toMatchObject({ state: 'saved', version: 4, complete: true });
  expect(await latest()).toMatchObject({ gst_registered: false, gst_registration_no: null });
  await save();
  expect(await latest()).toMatchObject({ version: 5, gst_registered: true });
});

test('D3 lifts once the owner has saved complete details', async () => {
  const staff = new CustomerRealInvoicingStaffService(s.f.runtime, () => true);
  const pending = await staff.pending(owner());
  expect(madeupSupplierFields(pending.supplier)).toEqual([]);
  expect(pending.supplier).toMatchObject({ version: 5, uen: real.uen, madeupFields: [] });
  // The command now passes the made-up guard and reaches the database, which answers about the subscription.
  await expect(
    staff.command(owner(), {
      action: 'prepare_invoice',
      commandId: randomUUID(),
      subscriptionId: randomUUID(),
      periodStart: '2026-11-01',
      dueOn: '2026-12-01',
      billToName: 'Dhaka Imports Limited',
      billToAddress: 'House 12, Road 5, Gulshan, Dhaka 1212, Bangladesh',
    }),
  ).rejects.not.toMatchObject({ code: 'MADEUP_SUPPLIER_DETAILS' });
});

test('a made-up field the screen does not ask for is kept marked, so the details stay incomplete', async () => {
  // The install path cannot mark the tax rate, so the fixture writes that version directly as the schema owner.
  await s.f.owner.query(
    `INSERT INTO customer_private.real_invoicing_entity(version,legal_name,address,country,uen,gst_registered,gst_registration_no,tax_label,
      gst_rate_bps,payment_terms_days,payment_instructions,finance_label,approver_principal_id,placeholder_fields,executor_id,reason)
     SELECT 6,legal_name,address,country,uen,gst_registered,gst_registration_no,tax_label,gst_rate_bps,payment_terms_days,
      payment_instructions,finance_label,approver_principal_id,'{gst_rate_bps}',executor_id,'Fixture: the tax rate marked as made up'
     FROM customer_private.real_invoicing_entity WHERE version=5`,
  );
  expect(await service.view(owner())).toMatchObject({
    version: 6,
    complete: false,
    enteredByOwner: false,
  });
  const saved = await save();
  expect(saved).toMatchObject({
    state: 'saved',
    version: 7,
    complete: false,
    madeupFields: ['gst_rate_bps'],
  });
  expect(await latest()).toMatchObject({ placeholder_fields: ['gst_rate_bps'] });
});

test('the runtime and auth logins reach no table and no private function, and history cannot be rewritten', async () => {
  for (const pool of [s.f.runtime, s.f.auth]) {
    await expect(
      pool.query('SELECT * FROM customer_private.real_invoicing_issuer_command'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      pool.query('SELECT customer_private.real_invoicing_issuer_owner(true)'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      pool.query('SELECT customer_private.real_invoicing_issuer_complete()'),
    ).rejects.toMatchObject({ code: '42501' });
  }
  await expect(s.f.auth.query('SELECT app.real_invoicing_issuer_view()')).rejects.toMatchObject({
    code: '42501',
  });
  // With no staff session the runtime login is refused by the function itself.
  await expect(s.f.runtime.query('SELECT app.real_invoicing_issuer_view()')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    s.f.owner.query("UPDATE customer_private.real_invoicing_entity SET finance_label='Changed'"),
  ).rejects.toThrow();
  await expect(
    s.f.owner.query('DELETE FROM customer_private.real_invoicing_issuer_command'),
  ).rejects.toThrow();
});

test('the rollback file removes the screen functions and keeps every saved version', async () => {
  const before = (await entities()).map((row) => {
    const kept = { ...row };
    delete kept.owner_entered_by;
    return kept;
  });
  await s.f.owner.query(
    readFileSync(
      'packages/db/customer-invoicing-real-migrations/rollback/0003_drop_owner_issuer_details.sql',
      'utf8',
    ),
  );
  expect(
    (
      await s.f.owner.query(
        "SELECT to_regprocedure('app.real_invoicing_issuer_save(uuid,jsonb)') IS NULL a,to_regprocedure('app.real_invoicing_issuer_view()') IS NULL b,to_regclass('customer_private.real_invoicing_issuer_command') IS NULL c",
      )
    ).rows[0],
  ).toEqual({ a: true, b: true, c: true });
  expect(await entities()).toEqual(before);
  expect(
    (
      await s.f.owner.query(
        'SELECT name FROM customer_invoicing_real_migrations.applied ORDER BY name',
      )
    ).rows.map((r: { name: string }) => r.name),
  ).toEqual(['0001_real_invoicing.sql', '0002_payment_approval_and_reversal.sql']);
  // With the functions gone the screen says the module is not installed, never an error page.
  await expect(service.view(owner())).rejects.toMatchObject({ status: 503 });
  // The staff side still works on the saved versions.
  const staff = new CustomerRealInvoicingStaffService(s.f.runtime, () => true);
  expect((await staff.pending(owner())).supplier).toMatchObject({ version: 7 });
});
