import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerServiceRequests } from '../../packages/db/src/customer-service-request-migrate';
import { migrateCustomerProgrammePricing } from '../../packages/db/src/customer-programme-pricing-migrate';
import { migrateCustomerProgrammeTerms } from '../../packages/db/src/customer-programme-terms-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerProgrammePricingService } from '../../packages/auth/src/customer-programme-pricing';

let f: Awaited<ReturnType<typeof fixture>>;
const options = {
  enabled: true,
  synthetic: true,
  production: false,
  issuer: 'https://ep-preservation-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
};
const session = async () => ({
  subject: 'legacy-preserved-owner',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 60000),
});
let workspaceId: string;
let pricing: CustomerProgrammePricingService;
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerServiceRequests(f.owner);
  await migrateCustomerProgrammePricing(f.owner);
  await migrateCustomerProgrammeTerms(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer: options.issuer,
    subject: 'legacy-preserved-owner',
    executorId: f.serviceId,
    reason: 'Synthetic populated upgrade preservation fixture',
  });
  workspaceId = (
    await new CustomerWorkspaceService(f.runtime, f.auth, options, session).provision({
      commandId: randomUUID(),
      name: 'Synthetic preserved workspace',
    })
  ).id;
  await new CustomerProgrammeService(f.runtime, f.auth, options, session).create({
    commandId: randomUUID(),
    workspaceId,
    name: 'Synthetic preserved programme',
    reportingPurpose: 'Synthetic preserved planning history',
    acknowledged: true,
  });
  pricing = new CustomerProgrammePricingService(f.runtime, f.auth, options, session);
  await pricing.saveTemplate({
    commandId: randomUUID(),
    workspaceId,
    expectedVersion: 0,
    templateId: null,
    retired: false,
    name: 'Synthetic preserved price',
    description: 'Synthetic exact original pricing',
    content: {
      currency: 'EUR',
      tiers: [{ label: 'Synthetic standard', amountMinor: '12345' }],
      earlyBird: [],
      groupDiscounts: [],
    },
  });
});
afterAll(async () => {
  await f?.close();
});
const policies = `SELECT n.nspname,c.relname,p.polname,p.polcmd,p.polroles::text,
  pg_get_expr(p.polqual,p.polrelid) AS qual,pg_get_expr(p.polwithcheck,p.polrelid) AS check
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('app','customer','customer_private','identity') ORDER BY 1,2,3`;
const grants = `SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,p.proacl::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('app','customer','customer_private','identity') ORDER BY 1,2,3`;
test('populated upgrade preserves legacy rows, exact pricing, existing policies and function grants', async () => {
  const oldPolicies = (await f.owner.query(policies)).rows;
  const oldGrants = (await f.owner.query(grants)).rows;
  const tables = (
    await f.owner.query<{
      schema: string;
      name: string;
    }>(`SELECT schemaname AS schema,tablename AS name FROM pg_tables
    WHERE schemaname IN ('app','customer','customer_private','identity','migrations') ORDER BY 1,2`)
  ).rows;
  const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
  const before = new Map<string, unknown[]>();
  for (const table of tables) {
    const key = quote(table.schema) + '.' + quote(table.name);
    before.set(
      key,
      (
        await f.owner.query(`SELECT to_jsonb(t) AS value FROM ${key} t ORDER BY to_jsonb(t)::text`)
      ).rows.map((row) => row.value),
    );
  }
  await migrateCustomerRealUse(f.owner);
  for (const [table, rows] of before) {
    const current = (
      await f.owner.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)
    ).rows.map((row) => row.value);
    // Newly seeded catalogue entries are additive; every prior row remains exact.
    expect(current, table).toEqual(expect.arrayContaining(rows));
  }
  expect((await f.owner.query(policies)).rows).toEqual(expect.arrayContaining(oldPolicies));
  expect((await f.owner.query(grants)).rows).toEqual(expect.arrayContaining(oldGrants));
  const prices = await pricing.templates({ workspaceId });
  expect(prices.templates[0].content.tiers[0].amountMinor).toBe('12345');
  const programmes = await new CustomerProgrammeService(f.runtime, f.auth, options, session).list({
    workspaceId,
  });
  expect(programmes.programmes[0].name).toBe('Synthetic preserved programme');
  expect(programmes.programmes[0].synthetic).toBe(true);
  expect(
    (await f.owner.query('SELECT * FROM customer_private.real_use_configuration')).rowCount,
  ).toBe(0);
});
