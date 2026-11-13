import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { changeMemberNow } from './change-member';
import { AccessService } from '../../packages/auth/src/access';
import { configureSourcingWorkflow } from '../../packages/auth/src/sourcing-workflow-configuration';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateSourcingWorkflow } from '../../packages/db/src/sourcing-workflow-migrate';
import { initialRoutes, storedTextOctets } from '../../packages/domain/src/corridors';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { OperationsService } from '../../packages/missions/src/operations';
import { rawContext } from './support';
import { bdCnSourcingProfile } from './fixtures/bd-cn-sourcing-profile';

// ADR-083 slice S1, the database side. The guard of the route pack configuration is replaced once, hash-guarded, by an optional
// module whose control starts closed. Every refusal of the old guard still holds; the one new thing is an optional `sourcing`
// key that is bounded, versioned and refused unless the control is open.
let f: Awaited<ReturnType<typeof commercialFixture>>,
  routes: CorridorService,
  ops: OperationsService;
const reason = 'Synthetic sourcing route profile validation';
const registry = 'sourcing_workflow_migrations.applied';
const file = '0001_route_sourcing_profile.sql';
const base = () => initialRouteConfiguration(initialRoutes[2]);
let tick = 0;
const at = () => new Date(Date.now() + 1000 * ++tick).toISOString();
async function newRoute(origin: string, destination: string) {
  const routeId = randomUUID();
  await routes.createRoute(f.users.owner.ctx, { id: routeId, origin, destination, reason });
  return routeId;
}
async function append(
  routeId: string,
  version: number,
  configuration: unknown,
  status = 'TESTING',
) {
  return routes.appendPack(f.users.owner.ctx, {
    id: randomUUID(),
    routeId,
    version,
    status,
    effectiveFrom: at(),
    configuration,
    reason,
  });
}
const withoutKey = (key: string): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...base() };
  delete copy[key];
  return copy;
};
const withProfile = (extra: Record<string, unknown> = {}) => ({
  ...base(),
  sourcing: bdCnSourcingProfile,
  ...extra,
});
async function guardDefinition() {
  return (
    await f.owner.query(
      "SELECT pg_get_functiondef('app.guard_corridor_configuration()'::regprocedure) d,encode(sha256(convert_to(pg_get_functiondef('app.guard_corridor_configuration()'::regprocedure),'UTF8')),'hex') h",
    )
  ).rows[0] as { d: string; h: string };
}
async function functionHashes() {
  const rows = (
    await f.owner.query(
      `SELECT p.oid::regprocedure::text AS name,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS hash
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.prokind='f' ORDER BY 1`,
    )
  ).rows as { name: string; hash: string }[];
  return new Map(rows.map((row) => [row.name, row.hash]));
}
// The TypeScript contract refuses most bad shapes first, so the database guard is exercised directly: the runtime role under the
// same authority and the same trigger, with the row built by hand.
const rawInsert = (route: string, version: number, configuration: unknown) =>
  rawContext(
    f.runtime,
    f.users.owner.ctx,
    "INSERT INTO app.corridor_pack_version(id,tenant_id,route_id,version,status,configuration,effective_from,created_by,reason) VALUES($1,$2,$3,$4,'TESTING',$5,$6,app.actor_id(),$7)",
    [randomUUID(), f.tenantA, route, version, JSON.stringify(configuration), at(), reason],
  );
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
beforeAll(async () => {
  f = await commercialFixture();
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  routes = new CorridorService(f.runtime);
  ops = new OperationsService(f.runtime);
}, 120000);
afterAll(async () => {
  await f?.close();
});

test('before anything is installed the database refuses a pack with a sourcing block, and the module will not install without real use', async () => {
  const route = await newRoute('BD', 'CN');
  await expect(append(route, 1, withProfile())).rejects.toThrow(
    'Invalid or elevated pack configuration',
  );
  await expect(migrateSourcingWorkflow(f.owner)).rejects.toThrow(
    'customer real-use modules are not installed',
  );
  expect(
    (await f.owner.query("SELECT to_regclass('sourcing_workflow_migrations.applied') r")).rows[0].r,
  ).toBeNull();
  await append(route, 1, base());
});

test('with real use installed and no module, the sourcing block is still refused', async () => {
  await migrateCustomerRealUse(f.owner);
  const route = await newRoute('ES', 'BD');
  await expect(append(route, 1, withProfile())).rejects.toThrow(
    'Invalid or elevated pack configuration',
  );
});

test('a drifted guard definition stops the install and records nothing', async () => {
  const original = await guardDefinition();
  const drifted = original.d.replace(
    /RETURN NEW;(?![\s\S]*RETURN NEW;)/,
    'RETURN NEW; /* drift */',
  );
  expect(drifted).not.toBe(original.d);
  await f.owner.query(drifted);
  try {
    await expect(migrateSourcingWorkflow(f.owner)).rejects.toThrow(
      'Sourcing workflow prerequisite function differs: app.guard_corridor_configuration',
    );
    expect(
      (await f.owner.query("SELECT to_regclass('app.sourcing_workflow_control') r")).rows[0].r,
    ).toBeNull();
  } finally {
    await f.owner.query(original.d);
  }
  expect((await guardDefinition()).h).toBe(original.h);
});

test('install replaces exactly one function, adds the control closed, is repeatable and refuses a changed file', async () => {
  const before = await functionHashes();
  await migrateSourcingWorkflow(f.owner);
  await migrateSourcingWorkflow(f.owner);
  const after = await functionHashes();
  const changed = [...after]
    .filter(([name, hash]) => before.get(name) !== hash)
    .map(([name]) => name);
  expect(changed.sort()).toEqual([
    'app.guard_corridor_configuration()',
    'app.sourcing_workflow_enabled()',
  ]);
  expect([...before].filter(([name]) => !after.has(name))).toEqual([]);
  const applied = (await f.owner.query(`SELECT name,sha256 FROM ${registry}`)).rows;
  expect(applied).toEqual([
    { name: file, sha256: sha(`packages/db/sourcing-workflow-migrations/${file}`) },
  ]);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM app.sourcing_workflow_control')).rows[0].n,
  ).toBe(0);
  expect((await f.owner.query('SELECT app.sourcing_workflow_enabled() e')).rows[0].e).toBe(false);
  await f.owner.query(`UPDATE ${registry} SET sha256=repeat('0',64)`);
  await expect(migrateSourcingWorkflow(f.owner)).rejects.toThrow('history mismatch');
  await f.owner.query(`UPDATE ${registry} SET sha256=$1`, [applied[0].sha256]);
  await migrateSourcingWorkflow(f.owner);
});

test('the control is not reachable by runtime or auth roles and cannot be rewritten', async () => {
  for (const role of ['corridra_runtime', 'corridra_auth'])
    expect(
      (
        await f.owner.query(
          `SELECT has_table_privilege('${role}','app.sourcing_workflow_control','SELECT') s,has_table_privilege('${role}','app.sourcing_workflow_control','INSERT') i`,
        )
      ).rows[0],
    ).toEqual({ s: false, i: false });
});

test('while the control is closed a pack with a sourcing block is refused and packs without one are unchanged', async () => {
  const route = await newRoute('JP', 'KE');
  await expect(append(route, 1, withProfile())).rejects.toThrow(
    'Sourcing profile requires the sourcing workflow control to be open',
  );
  await append(route, 1, base());
  await append(route, 2, { ...base(), languages: ['en'] });
});

test('opening needs a reason and is repeatable; then the block is stored exactly and measured the same in the database', async () => {
  await expect(
    configureSourcingWorkflow(f.owner, { enabled: true, reason: 'short' }),
  ).rejects.toThrow();
  expect(
    await configureSourcingWorkflow(f.owner, {
      enabled: true,
      reason: 'Owner opened the sourcing route profile',
    }),
  ).toEqual({
    enabled: true,
    changed: true,
  });
  expect(
    await configureSourcingWorkflow(f.owner, {
      enabled: true,
      reason: 'Owner opened the sourcing route profile',
    }),
  ).toEqual({
    enabled: true,
    changed: false,
  });
  const route = await newRoute('TH', 'BD');
  const pack = await append(route, 1, withProfile());
  const row = (
    await f.owner.query(
      "SELECT configuration,octet_length((configuration->'sourcing')::text) AS octets FROM app.corridor_pack_version WHERE id=$1",
      [pack.id],
    )
  ).rows[0];
  expect(row.configuration.sourcing).toEqual(bdCnSourcingProfile);
  expect(Object.keys(row.configuration)).toHaveLength(19);
  expect(row.octets).toBe(storedTextOctets(bdCnSourcingProfile));
  expect(row.octets).toBeLessThanOrEqual(4096);
});

test('every refusal of the old guard still holds, with and without the block', async () => {
  const route = await newRoute('BR', 'MX');
  let version = 0;
  const direct = async (configuration: Record<string, unknown>, expected: string | RegExp) => {
    await expect(rawInsert(route, version + 1, configuration)).rejects.toThrow(expected);
  };
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['17 keys', withoutKey('coverage'), /Invalid or elevated pack configuration/],
    [
      'an unknown extra key',
      { ...base(), country: ['BD'] },
      /Invalid or elevated pack configuration/,
    ],
    [
      'reviewRequired false',
      { ...base(), reviewRequired: false },
      /Invalid or elevated pack configuration/,
    ],
    [
      'an array over 50',
      { ...base(), localities: Array.from({ length: 51 }, (_, i) => `l${i}`) },
      /Bounded configuration arrays required/,
    ],
    ['a non-string element', { ...base(), localities: [1] }, /Configuration strings required/],
    [
      'an unsupported channel',
      { ...base(), channels: ['EMAIL'] },
      /Unsupported currency or channel/,
    ],
    [
      'a pricing activation',
      { ...base(), pricingRef: randomUUID() },
      /Pricing activation belongs to a later reviewed service/,
    ],
    [
      'an unknown key beside the block',
      { ...base(), sourcing: bdCnSourcingProfile, country: ['BD'] },
      /Invalid or elevated pack configuration/,
    ],
    [
      'the block with a missing key',
      { ...withoutKey('coverage'), sourcing: bdCnSourcingProfile },
      /Invalid or elevated pack configuration/,
    ],
  ];
  for (const [name, configuration, expected] of cases) {
    await direct(configuration, expected);
    expect(name).toBeTruthy();
  }
  await append(route, 1, base());
  version = 1;
  // Sequence and date rules, with and without the block.
  await expect(append(route, 3, withProfile())).rejects.toThrow('Sequential pack version required');
  await expect(
    routes.appendPack(f.users.owner.ctx, {
      id: randomUUID(),
      routeId: route,
      version: 2,
      status: 'TESTING',
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      configuration: withProfile(),
      reason,
    }),
  ).rejects.toThrow('Pack effective date must increase');
});

test('the block is bounded and versioned by the database itself', async () => {
  const route = await newRoute('NO', 'SE');
  let version = 0;
  const insert = (sourcing: unknown) => rawInsert(route, version + 1, { ...base(), sourcing });
  const huge = { ...bdCnSourcingProfile, ports: ['x'.repeat(5000)] };
  for (const bad of [
    'text',
    ['array'],
    null,
    {},
    { ...bdCnSourcingProfile, profileVersion: 0 },
    { ...bdCnSourcingProfile, profileVersion: '1' },
    { ...bdCnSourcingProfile, profileVersion: 1.5 },
    { ...bdCnSourcingProfile, profileVersion: 10000 },
    huge,
  ])
    await expect(insert(bad)).rejects.toThrow('Bounded sourcing profile with a version required');
  await insert(bdCnSourcingProfile);
  version = 1;
  // Exactly at the budget is allowed, one octet over is not.
  const pad = (n: number) => ({ profileVersion: 1, ports: ['p'.repeat(n)] });
  const room = 4096 - storedTextOctets(pad(0));
  await insert(pad(room));
  version = 2;
  await expect(insert(pad(room + 1))).rejects.toThrow(
    'Bounded sourcing profile with a version required',
  );
});

test('a sourcing pack goes through the reviewed flow: self-publication fails, an independent reviewer publishes the exact block', async () => {
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  await routes.installTemplates(f.users.owner.ctx);
  await changeMemberNow(new AccessService(f.runtime), f.users.owner.ctx, {
    userId: f.users.reviewer.id,
    role: 'owner',
    revoked: false,
  });
  const routeId = await newRoute('CN', 'BD');
  const first = await routes.appendPack(f.users.owner.ctx, {
    id: randomUUID(),
    routeId,
    version: 1,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    configuration: base(),
    reason,
  });
  const pack = {
    id: randomUUID(),
    routeId,
    version: 2,
    status: 'TESTING' as const,
    effectiveFrom: new Date(Date.now() + 100).toISOString(),
    reason,
    configuration: { ...base(), sourcing: { ...bdCnSourcingProfile, profileVersion: 2 } },
  };
  const preview = await ops.preview(f.users.owner.ctx, pack);
  expect(preview.changedFields).toEqual(['sourcing']);
  const proposal = randomUUID();
  await ops.command(f.users.owner.ctx, {
    id: proposal,
    action: 'propose',
    basePackId: first.id,
    pack,
    reason,
  });
  expect(
    (
      await f.owner.query(
        'SELECT octet_length(proposed_pack::text) n FROM app.configuration_proposal WHERE id=$1',
        [proposal],
      )
    ).rows[0].n,
  ).toBeLessThanOrEqual(8192);
  await expect(
    ops.command(f.users.owner.ctx, {
      id: randomUUID(),
      action: 'decide',
      proposalId: proposal,
      decision: 'PUBLISH',
      reason,
    }),
  ).rejects.toThrow('independent');
  await ops.command(f.users.reviewer.ctx, {
    id: randomUUID(),
    action: 'decide',
    proposalId: proposal,
    decision: 'PUBLISH',
    reason,
  });
  const published = (
    await f.owner.query('SELECT configuration FROM app.corridor_pack_version WHERE id=$1', [
      pack.id,
    ])
  ).rows[0];
  expect(published.configuration.sourcing.profileVersion).toBe(2);
  expect(published.configuration).toEqual(pack.configuration);
});

test('pausing refuses new sourcing blocks, keeps every stored block readable and leaves other packs alone', async () => {
  const stored = (
    await f.owner.query(
      "SELECT count(*)::int n FROM app.corridor_pack_version WHERE configuration ? 'sourcing'",
    )
  ).rows[0].n;
  expect(stored).toBeGreaterThan(0);
  expect(
    await configureSourcingWorkflow(f.owner, {
      enabled: false,
      reason: 'Owner paused the sourcing route profile',
    }),
  ).toEqual({
    enabled: false,
    changed: true,
  });
  const route = await newRoute('FR', 'DE');
  await expect(append(route, 1, withProfile())).rejects.toThrow('control to be open');
  await append(route, 1, base());
  await append(route, 2, { ...base(), currencies: [] });
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.corridor_pack_version WHERE configuration ? 'sourcing'",
      )
    ).rows[0].n,
  ).toBe(stored);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM app.sourcing_workflow_control')).rows[0].n,
  ).toBe(2);
});
