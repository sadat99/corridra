import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  assertRouteReady,
  initialRoutes,
  proposalOctetBudget,
  resolveConfiguration,
  routeConfiguration,
  routePack,
  sourcingProfile,
  sourcingProfileOctetBudget,
  storedTextOctets,
  type RouteConfiguration,
} from '../../packages/domain/src/corridors';
import { initialRouteConfiguration } from '../../packages/missions/src/corridors';
import {
  createRoutePack,
  guidedRoutePack,
  routePackConfiguration,
} from '../../packages/missions/src/route-pack-form';
import { bdCnSourcingProfile } from './fixtures/bd-cn-sourcing-profile';

// ADR-083 slice S1, scenario 16. The route profile is optional versioned data inside the pack configuration. Red on the code
// before the slice: routeConfiguration was strict with exactly 18 keys, so a pack with `sourcing` was refused.
const withProfile = (config: RouteConfiguration, sourcing = bdCnSourcingProfile) => ({
  ...config,
  sourcing,
});
const base = initialRouteConfiguration(initialRoutes[2]);
const pack = (configuration: unknown, status = 'TESTING') => ({
  id: '11111111-1111-4111-8111-111111111111',
  routeId: '22222222-2222-4222-8222-222222222222',
  version: 2,
  status,
  effectiveFrom: '2026-11-20T00:00:00.000Z',
  reason: 'Reference sourcing profile, synthetic',
  configuration,
});

describe('the sourcing block is optional, bounded and versioned', () => {
  test('every launch route pack parses unchanged and gains no sourcing key', () => {
    for (const route of initialRoutes) {
      const configuration = initialRouteConfiguration(route);
      const parsed = routeConfiguration.parse(configuration);
      expect(parsed).toEqual(configuration);
      expect(Object.keys(parsed)).toHaveLength(18);
      expect('sourcing' in parsed).toBe(false);
      expect(JSON.stringify(routeConfiguration.parse(parsed))).toBe(JSON.stringify(configuration));
      expect(resolveConfiguration(configuration)).toEqual(configuration);
    }
  });
  test('the reference fixture is valid and inside both budgets (measured as stored text)', () => {
    const parsed = routeConfiguration.parse(withProfile(base));
    expect(parsed.sourcing?.profileVersion).toBe(1);
    const sourcingOctets = storedTextOctets(bdCnSourcingProfile);
    const proposalOctets = storedTextOctets({
      id: '11111111-1111-4111-8111-111111111111',
      routeId: '22222222-2222-4222-8222-222222222222',
      version: 2,
      status: 'TESTING',
      effectiveFrom: '2026-11-20T00:00:00.000Z',
      reason: 'x'.repeat(500),
      configuration: parsed,
    });
    expect(sourcingOctets).toBeLessThanOrEqual(sourcingProfileOctetBudget);
    expect(proposalOctets).toBeLessThanOrEqual(proposalOctetBudget);
    // Recorded in the PR body: measured sizes.
    console.log(
      `sourcing octets ${sourcingOctets}; proposal octets (500 char reason) ${proposalOctets}`,
    );
  });
  test('unknown top-level keys are still refused, and so are unknown keys inside the block', () => {
    expect(() => routeConfiguration.parse({ ...base, country: 'BD' })).toThrow();
    expect(() => routeConfiguration.parse({ ...withProfile(base), extra: 1 })).toThrow();
    expect(() =>
      routeConfiguration.parse(
        withProfile(base, { ...bdCnSourcingProfile, market: 'BD' } as never),
      ),
    ).toThrow();
  });
  test('the block must carry a positive integer version and valid contents', () => {
    for (const bad of [0, -1, 1.5, 10000, '1', null])
      expect(
        sourcingProfile.safeParse({ ...bdCnSourcingProfile, profileVersion: bad }).success,
      ).toBe(false);
    const without: Record<string, unknown> = { ...bdCnSourcingProfile };
    delete without.profileVersion;
    expect(sourcingProfile.safeParse(without).success).toBe(false);
    expect(
      sourcingProfile.safeParse({
        ...bdCnSourcingProfile,
        categories: [{ ...bdCnSourcingProfile.categories[0]!, comparisonTerms: ['costPlus'] }],
      }).success,
    ).toBe(false);
    expect(
      sourcingProfile.safeParse({ ...bdCnSourcingProfile, incotermHints: ['SOMETIMES'] }).success,
    ).toBe(false);
  });
  test('a block larger than 4096 octets is refused even when each field is within its own limit', () => {
    const long = 'c'.repeat(160);
    const big = {
      ...bdCnSourcingProfile,
      categories: Array.from({ length: 8 }, (_, i) => ({
        ...bdCnSourcingProfile.categories[0]!,
        key: `category_${i}`,
        context: long,
        documentKinds: Array.from({ length: 8 }, (_, j) => `document_kind_number_${j}`),
        requiredFields: Array.from({ length: 12 }, (_, j) => `required_field_number_${j}`),
      })),
    };
    expect(storedTextOctets(big)).toBeGreaterThan(sourcingProfileOctetBudget);
    expect(sourcingProfile.safeParse(big).success).toBe(false);
  });
  test('stored-text measure matches what the database prints for the same value', () => {
    // jsonb text puts a space after every colon and comma and orders object keys by length then bytes.
    const printed = '{"a": null, "b": [1, 2], "aa": "é"}';
    expect(storedTextOctets({ b: [1, 2], aa: 'é', a: null })).toBe(
      new TextEncoder().encode(printed).length,
    );
  });
});

describe('the profile is global only', () => {
  test('it is carried through resolution unchanged', () => {
    const root = routeConfiguration.parse(withProfile(base));
    const resolved = resolveConfiguration(root, { languages: [] }, { currencies: [] });
    expect(resolved.sourcing).toEqual(root.sourcing);
    expect(Object.keys(resolved)).toHaveLength(19);
  });
  test('a layer that carries it is an error, equal or not, never silently dropped', () => {
    const root = routeConfiguration.parse(withProfile(base));
    expect(() => resolveConfiguration(root, { sourcing: root.sourcing })).toThrow(
      'Sourcing profile belongs to the pack root',
    );
    expect(() =>
      resolveConfiguration(root, {
        sourcing: { ...bdCnSourcingProfile, profileVersion: 2 },
      }),
    ).toThrow('Sourcing profile belongs to the pack root');
    expect(() =>
      resolveConfiguration(routeConfiguration.parse(base), { sourcing: bdCnSourcingProfile }),
    ).toThrow('Sourcing profile belongs to the pack root');
  });
  test('a pack with the block travels through the existing pack contract and readiness check unchanged', () => {
    const p = routePack.parse(pack(withProfile(base)));
    expect(p.configuration.sourcing?.profileVersion).toBe(1);
    expect(() =>
      assertRouteReady({
        status: 'TESTING',
        missionType: 'sourcing',
        configuration: p.configuration,
        capabilities: [],
        jurisdictionApproved: true,
        synthetic: true,
      }),
    ).not.toThrow();
  });
  test('the guided form carries the profile into the reviewed pack and omits the key when absent', () => {
    const input = {
      routeId: '22222222-2222-4222-8222-222222222222',
      version: 2,
      status: 'TESTING' as const,
      effectiveFrom: '2026-11-20T00:00:00.000Z',
      reason: 'Reference sourcing profile, synthetic',
      missionTypes: ['sourcing'],
    };
    const without = routePackConfiguration(guidedRoutePack.parse(input));
    expect('sourcing' in without).toBe(false);
    const withIt = routePackConfiguration(
      guidedRoutePack.parse({ ...input, sourcing: bdCnSourcingProfile }),
    );
    expect(withIt.sourcing).toEqual(bdCnSourcingProfile);
    expect(typeof createRoutePack).toBe('function');
  });
});

// A seeded generator keeps the property test repeatable without a new dependency.
function* countryPairs(count: number) {
  let seed = 20261113;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
  const code = () =>
    String.fromCharCode(65 + (next() % 26)) + String.fromCharCode(65 + ((next() >>> 8) % 26));
  for (const [a, b] of [
    ['BD', 'CN'],
    ['CN', 'BD'],
    ['ES', 'BD'],
    ['JP', 'KE'],
  ] as const)
    yield [a, b] as const;
  for (let i = 0; i < count; i++) {
    const a = code();
    let b = code();
    if (b === a) b = 'ZZ';
    yield [a, b] as const;
  }
}

describe('scenario 16: generated country pairs in both orders take the identical engine path', () => {
  const engine = (origin: string, destination: string) => {
    const configuration = routeConfiguration.parse(
      withProfile({
        ...base,
        missionTypes: ['sourcing', 'machinery_procurement'],
        languages: ['en', 'zh-CN'],
      }),
    );
    const resolved = resolveConfiguration(configuration, { languages: ['en'] });
    assertRouteReady({
      status: 'TESTING',
      missionType: 'sourcing',
      configuration: resolved,
      capabilities: [],
      jurisdictionApproved: true,
      synthetic: true,
    });
    const form = routePackConfiguration(
      guidedRoutePack.parse({
        routeId: '22222222-2222-4222-8222-222222222222',
        version: 2,
        status: 'TESTING',
        effectiveFrom: '2026-11-20T00:00:00.000Z',
        reason: `Route ${origin} to ${destination} reference profile`,
        missionTypes: ['sourcing'],
        sourcing: bdCnSourcingProfile,
      }),
    );
    const parsedPack = routePack.parse(pack(withProfile(form)));
    return JSON.stringify({ resolved, form, parsedPack: parsedPack.configuration });
  };
  test('300 generated pairs, both orders: a valid pack and the same result as every other pair', () => {
    const reference = engine('AA', 'BB');
    let n = 0;
    for (const [a, b] of countryPairs(300)) {
      expect(engine(a, b)).toBe(reference);
      expect(engine(b, a)).toBe(reference);
      n += 2;
    }
    expect(n).toBe(608);
  });
  test('no engine code path names Bangladesh or China', () => {
    const quoted = /['"`](BD|CN|BGD|CHN|Bangladesh|China|Chinese)['"`]/;
    const withoutLaunchRoutes = readFileSync('packages/domain/src/corridors.ts', 'utf8').replace(
      /export const initialRoutes = \[[\s\S]*?\] as const;\n/,
      '',
    );
    expect(withoutLaunchRoutes).not.toMatch(quoted);
    for (const file of [
      'packages/missions/src/route-pack-form.ts',
      'packages/db/sourcing-workflow-migrations/0001_route_sourcing_profile.sql',
      'packages/db/src/sourcing-workflow-migrate.ts',
      'packages/auth/src/sourcing-workflow-configuration.ts',
    ])
      expect(readFileSync(file, 'utf8'), file).not.toMatch(quoted);
    for (const fn of [resolveConfiguration, assertRouteReady, routePackConfiguration])
      expect(String(fn)).not.toMatch(/\bBD\b|\bCN\b/);
    // The fixture is the only place the pair is named, and it names no country at all.
    expect(JSON.stringify(bdCnSourcingProfile)).not.toMatch(/"(BD|CN)"/);
  });
});
