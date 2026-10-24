import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerInvoicing } from '../../packages/db/src/customer-invoicing-migrate';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerInvoicingService } from '../../packages/auth/src/customer-invoicing';
import { CustomerInvoicingStaffService } from '../../packages/delivery/src/customer-invoicing-staff';

// ADR-061: invoices are sample records only, even when real-use admission is installed and enabled. A real
// workspace reads none, and staff can neither see nor issue anything for one.
let f: Awaited<ReturnType<typeof fixture>>;
let realWorkspace: string;
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
const session = async () => ({
  subject: 'invoicing-real-owner',
  email: 'owner@business.test',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 60000),
});
const svc = () => new CustomerInvoicingService(f.runtime, f.auth, options, session);
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
  await migrateCustomerInvoicing(f.owner);
  const workspace = await new CustomerWorkspaceService(
    f.runtime,
    f.auth,
    options,
    session,
  ).provision({ commandId: randomUUID(), name: 'Dhaka Imports' });
  realWorkspace = workspace.id;
  expect(workspace.synthetic).toBe(false);
}, 120000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});

test('a real workspace reads no invoice and has no billing role, even with real use enabled', async () => {
  await expect(svc().overview({ workspaceId: realWorkspace })).rejects.toThrow(/unavailable/i);
});

test('staff see no invoice of a real workspace and cannot issue one for it, and the tables refuse it', async () => {
  const staff = new CustomerInvoicingStaffService(f.runtime);
  const listed = await staff.list(f.users.owner.ctx, { pageSize: 50 });
  expect(listed.invoices).toEqual([]);
  expect((await staff.pending(f.users.owner.ctx)).periods).toEqual([]);
  await expect(
    staff.command(f.users.owner.ctx, {
      action: 'issue',
      commandId: randomUUID(),
      subscriptionId: randomUUID(),
      periodStart: new Date().toISOString().slice(0, 10),
      planFeeMinor: '4900',
      taxMinor: '0',
      dueOn: new Date().toISOString().slice(0, 10),
    }),
  ).rejects.toThrow(/unavailable/i);
  await expect(staff.view(f.users.owner.ctx, randomUUID())).rejects.toThrow(/unavailable/i);
  const principal = (
    await f.owner.query(
      "SELECT id FROM customer_private.principal WHERE subject='invoicing-real-owner'",
    )
  ).rows[0].id;
  const plan = (
    await f.owner.query(
      "SELECT id,billing_interval FROM customer_private.billing_plan_version WHERE plan_key='example-organiser' AND version=1",
    )
  ).rows[0];
  const sub = randomUUID();
  await f.owner.query(
    'INSERT INTO customer_private.billing_subscription(id,tenant_id,created_by,plan_id,billing_interval,plan_digest) VALUES($1,$2,$3,$4,$5,$6)',
    [sub, realWorkspace, principal, plan.id, plan.billing_interval, 'a'.repeat(64)],
  );
  await expect(
    f.owner.query(
      `INSERT INTO customer_private.invoicing_invoice(invoice_no,tenant_id,subscription_id,plan_id,period_start,period_end,issue_date,due_date,currency,tax_treatment,plan_fee_minor,tax_minor,total_minor,issued_by,staff_tenant_id)
 VALUES(1,$1,$2,$3,current_date,current_date+30,current_date,current_date+10,'USD','price_excludes_tax',4900,0,4900,$4,$5)`,
      [realWorkspace, sub, plan.id, f.users.owner.id, f.tenantA],
    ),
  ).rejects.toThrow(/synthetic only/i);
});
