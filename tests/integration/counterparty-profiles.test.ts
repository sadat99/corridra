import { describe, expect, test } from 'vitest';
import {
  briefCardFields,
  canonicalJson,
  counterpartyProfileFields,
  looksLikeContact,
  profileMaxBytes,
  profileRoles,
  saveCounterpartyProfile,
} from '../../packages/domain/src/counterparty-profiles';

// ADR-082 section 3.1: the one strict, role-agnostic profile schema. No database needed.
const good = {
  productCategory: { key: 'home_textiles', words: 'Cotton hotel towels and bed linen' },
  counterpartyTypes: ['importer', 'distributor'],
  candidatesWanted: 20,
  deadline: '2026-12-15',
};
const refuses = (change: Record<string, unknown>) =>
  expect(counterpartyProfileFields.safeParse({ ...good, ...change }).success).toBe(false);
const lines = (count: number, length = 160) =>
  Array.from({ length: count }, (_, i) => `${String.fromCharCode(97 + i)}`.repeat(length));

describe('the profile fields', () => {
  test('a minimal profile is valid and fills every default', () => {
    const fields = counterpartyProfileFields.parse(good);
    expect(fields).toMatchObject({
      sizeBand: 'any',
      orderSizeBand: 'any',
      pricePositioning: 'any',
      channels: [],
      requiredCertifications: [],
      mustHaves: [],
      niceToHaves: [],
      exclusions: { organisationIds: [], nameKeys: [] },
    });
    expect(fields).not.toHaveProperty('eventContext');
    expect(fields).not.toHaveProperty('sellerNotes');
  });

  test('every role names the same schema: the role is not a field', () => {
    expect([...profileRoles]).toEqual(['BUYER', 'SUPPLIER', 'DISTRIBUTOR', 'PARTNER']);
    for (const role of profileRoles)
      expect(
        saveCounterpartyProfile.safeParse({
          commandId: crypto.randomUUID(),
          missionId: crypto.randomUUID(),
          role,
          expectedVersion: 0,
          fields: good,
          reason: 'Written from the brief',
        }).success,
      ).toBe(true);
    refuses({ role: 'BUYER' });
  });

  test('the route is not a field, and unknown keys are refused at every level', () => {
    refuses({ route: 'BD-DE' });
    refuses({ origin: 'BD', targetMarket: 'DE' });
    refuses({ productCategory: { key: 'home_textiles', words: 'Towels', extra: 1 } });
    refuses({ exclusions: { organisationIds: [], nameKeys: [], extra: [] } });
    refuses({ eventContext: { month: '2026-11', country: 'DE', venue: 'Hall 4' } });
  });

  test('required fields and bounded counts', () => {
    for (const name of ['productCategory', 'counterpartyTypes', 'candidatesWanted', 'deadline']) {
      const rest = Object.fromEntries(Object.entries(good).filter(([key]) => key !== name));
      expect(counterpartyProfileFields.safeParse(rest).success, name).toBe(false);
    }
    refuses({ counterpartyTypes: [] });
    refuses({ counterpartyTypes: ['importer', 'importer'] });
    refuses({ counterpartyTypes: ['spaceship'] });
    refuses({
      counterpartyTypes: [
        'importer',
        'distributor',
        'wholesaler',
        'retailer',
        'brand_owner',
        'manufacturer',
        'online_retailer',
        'agent',
        'institutional_buyer',
      ],
    });
    refuses({ candidatesWanted: 0 });
    refuses({ candidatesWanted: 101 });
    refuses({ candidatesWanted: 2.5 });
    expect(counterpartyProfileFields.safeParse({ ...good, candidatesWanted: 100 }).success).toBe(
      true,
    );
    expect(counterpartyProfileFields.safeParse({ ...good, candidatesWanted: 1 }).success).toBe(
      true,
    );
    refuses({ channels: Array.from({ length: 11 }, (_, i) => `channel_${i}`) });
    refuses({ requiredCertifications: Array.from({ length: 11 }, (_, i) => `cert_${i}`) });
    refuses({ channels: ['Bad Key!'] });
    refuses({ sizeBand: 'huge' });
    refuses({ orderSizeBand: 'micro' });
    refuses({ pricePositioning: 'luxury' });
  });

  test('dates and event context', () => {
    refuses({ deadline: '2026-02-30' });
    refuses({ deadline: 'next week' });
    refuses({ eventContext: { month: '2026-13', country: 'DE' } });
    refuses({ eventContext: { month: '2026-11', country: 'Germany' } });
    const ok = counterpartyProfileFields.parse({
      ...good,
      eventContext: { month: '2026-11', country: 'DE', name: 'Textile fair' },
    });
    expect(ok.eventContext?.nameNonIdentifying).toBe(false);
  });

  test('must-have lines are 3 to 160 characters, up to 10, with no repeats', () => {
    refuses({ mustHaves: ['ab'] });
    refuses({ mustHaves: [lines(1, 161)[0]] });
    refuses({ mustHaves: lines(11, 5) });
    refuses({ niceToHaves: ['same line', 'same line'] });
    expect(
      counterpartyProfileFields.safeParse({ ...good, mustHaves: lines(10, 160) }).success,
    ).toBe(true);
  });

  test('words that look like a way to reach someone are refused, in every brief card line', () => {
    for (const text of [
      'Ask buyer@example.com for samples',
      'See https://example.invalid/catalogue',
      'Visit www.example.invalid',
      'Call +880 1711 223344',
      'Phone 0049 30 1234567',
      'shop.example.com stocks it',
    ]) {
      expect(looksLikeContact(text), text).toBe(true);
      refuses({ mustHaves: [text] });
      refuses({ niceToHaves: [text] });
      refuses({ productCategory: { key: 'home_textiles', words: text } });
      refuses({ eventContext: { month: '2026-11', country: 'DE', name: text } });
    }
    for (const text of [
      'Sells in 5 star hotels',
      'Annual volume 100 to 500 pieces',
      'Carries organic cotton lines since 2018',
    ])
      expect(looksLikeContact(text), text).toBe(false);
  });

  test('exclusions are organisation ids and name keys; seller notes stop at 1000 characters', () => {
    refuses({ exclusions: { organisationIds: ['not-a-uuid'], nameKeys: [] } });
    refuses({ exclusions: { organisationIds: [], nameKeys: ['Bad Key'] } });
    refuses({ sellerNotes: 'x'.repeat(1001) });
    expect(
      counterpartyProfileFields.safeParse({ ...good, sellerNotes: 'x'.repeat(1000) }).success,
    ).toBe(true);
  });

  test('a profile larger than 8000 bytes is refused', () => {
    const big = {
      mustHaves: lines(10, 160),
      niceToHaves: lines(10, 160).map((l) => `n${l.slice(1)}`),
      sellerNotes: 'x'.repeat(1000),
      exclusions: {
        organisationIds: Array.from({ length: 50 }, () => crypto.randomUUID()),
        nameKeys: Array.from({ length: 50 }, (_, i) => `name_key_${String(i).padStart(30, '0')}`),
      },
    };
    expect(profileMaxBytes).toBe(8000);
    expect(JSON.stringify({ ...good, ...big }).length).toBeGreaterThan(8000);
    refuses(big);
  });
});

describe('the save command and its helpers', () => {
  const base = {
    commandId: crypto.randomUUID(),
    missionId: crypto.randomUUID(),
    role: 'SUPPLIER',
    expectedVersion: 0,
    fields: good,
    reason: 'Written from the brief',
  };
  test('needs ids, a role, an expected version and a reason; nothing else', () => {
    expect(saveCounterpartyProfile.safeParse(base).success).toBe(true);
    for (const change of [
      { commandId: 'x' },
      { missionId: 'x' },
      { role: 'SELLER' },
      { expectedVersion: -1 },
      { expectedVersion: 1.5 },
      { reason: 'no' },
      { tenantId: crypto.randomUUID() },
      { createdBy: crypto.randomUUID() },
    ])
      expect(saveCounterpartyProfile.safeParse({ ...base, ...change }).success).toBe(false);
  });

  test('canonical JSON ignores key order and undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe(
      canonicalJson({ a: { d: [3, { x: 2, y: 1 }] }, b: 1 }),
    );
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });

  test('the brief card never carries exclusions or seller notes, and shows lines only when approved', () => {
    const fields = counterpartyProfileFields.parse({
      ...good,
      mustHaves: ['Holds an import licence', 'Pays by letter of credit'],
      niceToHaves: ['Has a showroom'],
      exclusions: { organisationIds: [crypto.randomUUID()], nameKeys: ['rival_co'] },
      sellerNotes: 'Private words from the seller',
      eventContext: { month: '2026-11', country: 'DE', name: 'Textile fair' },
    });
    const card = briefCardFields(fields, ['Holds an import licence']);
    expect(card).not.toHaveProperty('exclusions');
    expect(card).not.toHaveProperty('sellerNotes');
    expect(card.mustHaves).toEqual(['Holds an import licence']);
    expect(card.niceToHaves).toEqual([]);
    expect(card.eventContext).toEqual({ month: '2026-11', country: 'DE' });
    const named = briefCardFields(
      { ...fields, eventContext: { ...fields.eventContext!, nameNonIdentifying: true } },
      [],
    );
    expect(named.eventContext).toEqual({ month: '2026-11', country: 'DE', name: 'Textile fair' });
    expect(JSON.stringify(card)).not.toContain('rival_co');
    expect(JSON.stringify(card)).not.toContain('Private words');
  });
});
