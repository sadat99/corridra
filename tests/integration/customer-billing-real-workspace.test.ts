import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { rawContext } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerBilling } from '../../packages/db/src/customer-billing-migrate';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerBillingService } from '../../packages/auth/src/customer-billing';
import { CustomerBillingStaffService } from '../../packages/delivery/src/customer-billing-staff';

// ADR-060: billing records are synthetic only, even when real-use admission is installed and enabled. A real
// workspace reads no plan, asks for none and is served nothing, and staff cannot see or change one.
let f: Awaited<ReturnType<typeof fixture>>;
let realWorkspace: string;
const issuer =
  'https://ep-billing-real-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  openAdmission: true,
  dataMode: 'real' as const,
};
const session = async () => ({
  subject: 'billing-real-owner',
  email: 'owner@business.test',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 60000),
});
const svc = () => new CustomerBillingService(f.runtime, f.auth, options, session);
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
  await migrateCustomerBilling(f.owner);
  const workspace = await new CustomerWorkspaceService(
    f.runtime,
    f.auth,
    options,
    session,
  ).provision({
    commandId: randomUUID(),
    name: 'Dhaka Imports',
  });
  realWorkspace = workspace.id;
  expect(workspace.synthetic).toBe(false);
}, 120000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});

test('a real workspace reads no plan, asks for none and has no billing role, even with real use enabled', async () => {
  await expect(svc().plans({ workspaceId: realWorkspace })).rejects.toThrow(/unavailable/i);
  await expect(svc().overview({ workspaceId: realWorkspace })).rejects.toThrow(/unavailable/i);
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
  ).rejects.toThrow(/unavailable|owner or admin/i);
  await expect(
    svc().command({
      action: 'cancel',
      commandId: randomUUID(),
      workspaceId: realWorkspace,
      subscriptionId: randomUUID(),
    }),
  ).rejects.toThrow(/unavailable|owner or admin/i);
});

test('the table itself refuses a billing record for a real workspace, and staff see none', async () => {
  const plan = (
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
    [sub, realWorkspace, principal, plan.id, plan.billing_interval, 'a'.repeat(64)],
  );
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_subscription_event(subscription_id,tenant_id,seq,kind,status_after,actor_kind,customer_actor) VALUES($1,$2,1,'requested','requested','customer',$3)",
      [sub, realWorkspace, principal],
    ),
  ).rejects.toThrow(/synthetic only/i);
  const staff = new CustomerBillingStaffService(f.runtime);
  const listed = await staff.list(f.users.owner.ctx, { pageSize: 50 });
  expect(listed.subscriptions).toEqual([]);
  await expect(staff.view(f.users.owner.ctx, sub)).rejects.toThrow(/unavailable/i);
  const raw = await rawContext(
    f.runtime,
    f.users.owner.ctx,
    'SELECT app.billing_plan_staff_list() r',
    [],
  );
  expect(raw.rows[0].r.plans).toHaveLength(3);
});
