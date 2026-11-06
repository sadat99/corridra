import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { CounterpartyService } from '../../packages/counterparties/src/index';
import { EvidenceService, type ObjectStorage } from '../../packages/evidence/src/index';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { searchPalette, matches } from '../../apps/web/lib/palette-search';

// The team command palette's search (Navigation v1, Sensitive: yes). It reads through the same role-checked
// services as the workspace lists: it finds what the person may open, reports a read the role may not make as
// denied (never as empty), returns only a label and a line of detail, and never reaches another workspace.
let f: Awaited<ReturnType<typeof fixture>>;
let missions: MissionService;
let companies: CounterpartyService;
let evidence: EvidenceService;
const blobs = new Map<string, Uint8Array>();
const storage: ObjectStorage = {
  async put(k, b) {
    blobs.set(k, b);
  },
  async get(k) {
    if (!blobs.has(k)) throw new Error('Missing');
    return blobs.get(k)!;
  },
};
const word = randomUUID().slice(0, 8).replace(/\d/g, 'q');
const services = () => ({ missions, counterparties: companies });

beforeAll(async () => {
  f = await fixture();
  missions = new MissionService(f.runtime, 'palette-test-secret');
  companies = new CounterpartyService(f.runtime);
  evidence = new EvidenceService(f.runtime, storage, {
    async scan() {
      return { verdict: 'CLEAN', engine: 'test-contract' };
    },
  });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await missions.submit(randomUUID(), {
    objective: 'Sell in a new market',
    market: 'Spain',
    attendance: 'No',
    startDate: '',
    endDate: '',
    timezone: 'Europe/Madrid',
    offer: 'Synthetic palette offer',
    website: '',
    outcomes: ['Relevant meetings'],
    notes: '',
    name: 'Synthetic Person',
    company: `Palette${word} Trading`,
    email: 'palette@example.invalid',
    acknowledged: true,
  });
  const source = await evidence.createSource(f.users.operator.ctx, {
    kind: 'public_record',
    classification: 'PUBLIC',
    locator: 'https://example.invalid/registry',
    observedAt: new Date().toISOString(),
    purpose: 'synthetic_validation',
    retentionUntil: new Date(Date.now() + 86400000).toISOString(),
    aiPolicy: 'DENY',
  });
  await companies.command(f.users.operator.ctx, {
    action: 'ingest',
    commandId: randomUUID(),
    sourceId: source.id,
    name: `Distributor${word} Madrid`,
    country: 'ES',
    domain: `${word}.example.invalid`,
    address: 'Synthetic Test Business Park',
    identifierType: 'registry',
    identifier: randomUUID(),
  });
});
afterAll(async () => {
  await f?.close();
});

describe('matching', () => {
  test('every word must appear, in any order, case aside', () => {
    expect(matches('knit spain', 'Sell KNITWEAR', 'Spain')).toBe(true);
    expect(matches('knit france', 'Sell knitwear', 'Spain')).toBe(false);
    expect(matches('  ', 'anything')).toBe(true);
  });
});

describe('what each role finds', () => {
  for (const role of ['owner', 'operator', 'reviewer', 'viewer'] as const)
    test(`${role} finds the mission and the company by part of the name`, async () => {
      const found = await searchPalette(services(), f.users[role].ctx, `palette${word}`, 'all');
      expect(found.missions.map((h) => h.label)).toContain(`Palette${word} Trading`);
      const companyFound = await searchPalette(
        services(),
        f.users[role].ctx,
        `tributor${word}`,
        'all',
      );
      expect(companyFound.companies.map((h) => h.label)).toContain(`Distributor${word} Madrid`);
      expect(found.denied).toEqual([]);
    });

  test('a scope searches only that scope', async () => {
    const onlyCompanies = await searchPalette(
      services(),
      f.users.operator.ctx,
      `palette${word}`,
      'companies',
    );
    expect(onlyCompanies.missions).toEqual([]);
    const onlyMissions = await searchPalette(
      services(),
      f.users.operator.ctx,
      `tributor${word}`,
      'missions',
    );
    expect(onlyMissions.companies).toEqual([]);
  });

  test('a hit carries an id, a label and a line of detail and nothing else', async () => {
    const found = await searchPalette(
      services(),
      f.users.operator.ctx,
      `palette${word}`,
      'missions',
    );
    expect(found.missions.length).toBeGreaterThan(0);
    for (const hit of found.missions)
      expect(Object.keys(hit).sort()).toEqual(['detail', 'id', 'label']);
    expect(found.missions[0]!.detail).toBe('Sell in a new market · Spain');
  });

  test('a query under two characters, or one that matches nothing, finds nothing and reads nothing', async () => {
    expect(await searchPalette(services(), f.users.operator.ctx, 'p', 'all')).toEqual({
      missions: [],
      companies: [],
      denied: [],
      partial: [],
    });
    const none = await searchPalette(services(), f.users.operator.ctx, `zzz${word}nothing`, 'all');
    expect(none.missions).toEqual([]);
    expect(none.companies).toEqual([]);
  });
});

describe('another workspace is never searched', () => {
  test('a person from workspace B asking for workspace A gets denied for both scopes, not empty', async () => {
    const outsider = { ...f.users.owner.ctx, tenantId: f.tenantB };
    // The owner has no membership in workspace B, so every read is refused.
    const found = await searchPalette(services(), outsider, `palette${word}`, 'all');
    expect(found.missions).toEqual([]);
    expect(found.companies).toEqual([]);
    expect(found.denied.sort()).toEqual(['companies', 'missions']);
  });
  test('a member of workspace B does not see workspace A records when searching B', async () => {
    const memberB = Object.values(f.users).find((u) => u.ctx.tenantId === f.tenantB);
    if (!memberB) return;
    const found = await searchPalette(services(), memberB.ctx, `palette${word}`, 'all');
    expect(found.missions).toEqual([]);
  });
});
