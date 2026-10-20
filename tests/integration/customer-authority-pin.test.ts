import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerAdmission } from '../../packages/db/src/customer-admission-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import type { CustomerWorkspaceOptions } from '../../packages/auth/src/customer-session';

const production =
  'https://ep-shiny-glade-b2if1xhk.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth';
let f: Awaited<ReturnType<typeof fixture>>;
const keys = [
  'VERCEL_ENV',
  'DATA_ENVIRONMENT',
  'CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK',
  'CORRIDRA_CUSTOMER_ISSUER',
] as const;
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerAuthority(f.owner);
  await migrateCustomerAdmission(f.owner);
});
afterAll(async () => {
  await f?.close();
});

test('pinning creates the issuer and executor once and is repeatable', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.DATA_ENVIRONMENT = 'synthetic';
  process.env.CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK = 'synthetic-only';
  process.env.CORRIDRA_CUSTOMER_ISSUER = production;
  const input = { issuer: production, executorId: f.serviceId };
  expect(await pinCustomerAuthority(f.owner, input)).toEqual({ pinned: 'created' });
  expect(await pinCustomerAuthority(f.owner, input)).toEqual({ pinned: 'unchanged' });
  const rows = (
    await f.owner.query('SELECT issuer,executor_id,synthetic FROM customer_private.configuration')
  ).rows;
  expect(rows).toEqual([{ issuer: production, executor_id: f.serviceId, synthetic: true }]);
});

test('a different issuer or executor is refused once pinned', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.DATA_ENVIRONMENT = 'synthetic';
  process.env.CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK = 'synthetic-only';
  process.env.CORRIDRA_CUSTOMER_ISSUER = production;
  await expect(
    pinCustomerAuthority(f.owner, { issuer: production, executorId: randomUUID() }),
  ).rejects.toThrow(/active service executor|pinned/);
});

test('the issuer must pass the customer issuer rule before anything is written', async () => {
  await expect(
    pinCustomerAuthority(f.owner, { issuer: production, executorId: f.serviceId }),
  ).rejects.toThrow();
});

test('a person principal or a non-owner database role cannot pin', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.DATA_ENVIRONMENT = 'synthetic';
  process.env.CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK = 'synthetic-only';
  process.env.CORRIDRA_CUSTOMER_ISSUER = production;
  await expect(
    pinCustomerAuthority(f.owner, { issuer: production, executorId: f.users.owner.id }),
  ).rejects.toThrow();
  await expect(
    pinCustomerAuthority(f.runtime, { issuer: production, executorId: f.serviceId }),
  ).rejects.toThrow();
});

test('with the pin and open admission a production-style session gets a workspace end to end', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.DATA_ENVIRONMENT = 'synthetic';
  process.env.CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK = 'synthetic-only';
  process.env.CORRIDRA_CUSTOMER_ISSUER = production;
  const options: CustomerWorkspaceOptions = {
    enabled: true,
    synthetic: true,
    production: false,
    issuer: production,
    openAdmission: true,
  };
  const session = (): CustomerSession => ({
    subject: 'synthetic-production-newcomer',
    expiresAt: new Date(Date.now() + 3600000),
    emailVerified: true,
  });
  const service = new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session());
  const workspace = await service.provision({
    name: 'Synthetic production workspace',
    commandId: randomUUID(),
  });
  expect(workspace.role).toBe('owner');
  const rows = (
    await f.owner.query('SELECT issuer FROM customer_private.principal WHERE subject=$1', [
      'synthetic-production-newcomer',
    ])
  ).rows;
  expect(rows).toEqual([{ issuer: production }]);
  // The same service is refused when the production issuer is no longer owner-approved.
  delete process.env.CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK;
  await expect(
    service.provision({ name: 'Synthetic production workspace', commandId: randomUUID() }),
  ).rejects.toThrow();
});
