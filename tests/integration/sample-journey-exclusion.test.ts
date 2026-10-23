import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { MissionService } from '../../packages/missions/src/index';
import { OperationsService } from '../../packages/missions/src/operations';
import { withTenant } from '../../packages/db/src/index';

// A sample journey in the sample workspace must not change anything the real workspace reports.
// This is the proof the Rehearsal Mission proposal asked for, not an assumption.
const issuer = 'https://ep-sample-exclusion.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let f: Awaited<ReturnType<typeof fixture>>;
let missions: MissionService;
let operations: OperationsService;
let realTenant: string;
const real = () => ({
  ...f.users.owner.ctx,
  tenantId: realTenant,
  purpose: 'commercial_qualification',
});
const brief = (n: number) => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'No',
  startDate: '',
  endDate: '',
  timezone: 'Europe/Madrid',
  offer: `Synthetic Rehearsal towels for hospitality distributors ${n}`,
  website: 'https://example.invalid/catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic Rehearsal only',
  name: 'Synthetic Rehearsal Person',
  company: 'Synthetic Rehearsal Company',
  email: `rehearsal-${n}@example.invalid`,
  acknowledged: true,
});
const command = (id: string, version: number, action: string) => ({
  id,
  version,
  action,
  commandId: randomUUID(),
  reason: 'Synthetic rehearsal walk through the sample workspace',
  ownerId: f.users.operator.id,
  nextAction: 'Confirm target requirements',
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  marketCode: 'ES',
  targetProfile: 'Hospitality distributors interested in hotel towels',
});
const tables = [
  'mission',
  'mission_intake',
  'mission_participant',
  'mission_market',
  'domain_event',
  'audit_event',
  'outbox',
];
// Everything a real-workspace reader or total could be built from, for the real tenant only.
async function snapshot() {
  const counts: Record<string, number> = {};
  for (const table of tables)
    counts[table] = (
      await f.owner.query(`SELECT count(*)::int n FROM app.${table} WHERE tenant_id=$1`, [
        realTenant,
      ])
    ).rows[0].n;
  const strip = (value: unknown): unknown =>
    JSON.parse(
      JSON.stringify(value, (key, v) =>
        ['generatedAt', 'checkedAt', 'asOf', 'now', 'serverTime'].includes(key) ? undefined : v,
      ),
    );
  return {
    counts,
    queue: strip(await missions.queue(real())),
    open: strip(await missions.queue(real(), 'open')),
    dashboard: strip(await operations.dashboard(real())),
    control: strip(await operations.controlCenter(real())),
    reliability: strip(await operations.reliability(real())),
  };
}

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the sample exclusion fixture',
  });
  realTenant = (
    await f.owner.query('SELECT intake_tenant_id FROM customer_private.real_use_configuration')
  ).rows[0].intake_tenant_id as string;
  // The same staff owner holds both scopes, as the real operator would.
  await f.owner.query(
    `INSERT INTO app.membership(tenant_id,user_id,role,allowed_purposes,allowed_classifications,allowed_countries)
    SELECT $1,user_id,role,ARRAY['commercial_qualification'],allowed_classifications,allowed_countries
    FROM app.membership WHERE tenant_id=$2 AND user_id=$3 AND NOT EXISTS(SELECT FROM app.membership WHERE tenant_id=$1 AND user_id=$3)`,
    [realTenant, f.tenantA, f.users.owner.id],
  );
  missions = new MissionService(f.runtime, 'sample-journey-exclusion-local-secret');
  operations = new OperationsService(f.runtime);
});
afterAll(async () => {
  await f?.close();
});

test('a whole sample journey leaves every real workspace count, queue and dashboard unchanged', async () => {
  const before = await snapshot();
  const sampleBefore = (await missions.queue(f.users.operator.ctx)).total;
  const created: string[] = [];
  for (let n = 1; n <= 3; n++) {
    const result = await missions.submit(randomUUID(), brief(n));
    expect(result.id).toBeTruthy();
    created.push(result.id!);
  }
  for (const id of created) {
    await missions.command(f.users.operator.ctx, command(id, 1, 'qualify'));
    await missions.command(f.users.operator.ctx, command(id, 2, 'activate'));
  }
  await missions.command(f.users.operator.ctx, command(created[0], 3, 'targeting'));
  // The journey really happened in the sample workspace ...
  expect((await missions.queue(f.users.operator.ctx)).total).toBe(sampleBefore + 3);
  // ... and the real workspace cannot tell.
  const after = await snapshot();
  expect(after.counts).toEqual(before.counts);
  expect(after.queue).toEqual(before.queue);
  expect(after.open).toEqual(before.open);
  expect(after.dashboard).toEqual(before.dashboard);
  expect(after.control).toEqual(before.control);
  expect(after.reliability).toEqual(before.reliability);
});

test('a staff member scoped to real work cannot open the sample workspace, so nothing can mix the two', async () => {
  await expect(
    missions.queue({
      ...f.users.owner.ctx,
      tenantId: f.tenantA,
      purpose: 'commercial_qualification',
    }),
  ).rejects.toThrow();
  await expect(
    withTenant(
      f.runtime,
      { ...f.users.owner.ctx, tenantId: f.tenantA, purpose: 'commercial_qualification' },
      'missions.read',
      async ({ db }) => db.query('SELECT 1'),
    ),
  ).rejects.toThrow();
});
