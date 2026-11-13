import { describe, expect, test } from 'vitest';
import {
  addCandidate,
  blockCompany,
  classifySupplyHeaders,
  createSource,
  hasContactShape,
  matchCandidate,
  supplyFileColumns,
  supplyKindsOnRoute,
  supplyWords,
} from '../../packages/domain/src/supply-sources';

// ADR-082 sections 3.3, 3.6, 5 (slice S3): the pure rules. The SQL checks the same shapes again; these cases pin the
// application side so the two cannot drift apart.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pack = (status: string, categories: string[]) => ({
  status,
  configuration: { sourceCategories: categories },
});
const all = ['supply.partner_organisation', 'supply.partner_person', 'supply.data_platform'];

describe('route binding', () => {
  test('staff research is offered with no pack, a legacy assignment, a draft or a paused pack', () => {
    expect(supplyKindsOnRoute(null)).toEqual(['staff_research']);
    expect(supplyKindsOnRoute(pack('DRAFT', all))).toEqual(['staff_research']);
    expect(supplyKindsOnRoute(pack('PAUSED', all))).toEqual(['staff_research']);
    expect(supplyKindsOnRoute(pack('ACTIVE', []))).toEqual(['staff_research']);
  });
  test('TESTING, LIMITED and ACTIVE packs offer exactly the kinds they list', () => {
    for (const status of ['TESTING', 'LIMITED', 'ACTIVE']) {
      expect(supplyKindsOnRoute(pack(status, all))).toEqual([
        'staff_research',
        'partner_organisation',
        'partner_person',
        'data_platform',
      ]);
      expect(supplyKindsOnRoute(pack(status, ['supply.data_platform']))).toEqual([
        'staff_research',
        'data_platform',
      ]);
      expect(supplyKindsOnRoute(pack(status, ['other.category']))).toEqual(['staff_research']);
    }
  });
  test('a new pack version listing a kind changes only the offered kinds', () => {
    const before = supplyKindsOnRoute(pack('TESTING', ['supply.partner_person']));
    const after = supplyKindsOnRoute(
      pack('TESTING', ['supply.partner_person', 'supply.data_platform']),
    );
    expect(after.filter((kind) => !before.includes(kind))).toEqual(['data_platform']);
  });
});

describe('contact shapes', () => {
  test('an email shape and a run of seven digits are contact details; a registration number passes the identifier rule', () => {
    expect(hasContactShape('jane@acme.example')).toBe(true);
    expect(hasContactShape('call +49 30 1234 5678')).toBe(true);
    expect(hasContactShape('(030) 123-4567')).toBe(true);
    expect(hasContactShape('Acme Trading Ltd')).toBe(false);
    expect(hasContactShape('HRB 123456')).toBe(false);
    expect(hasContactShape('1234567', { phone: false })).toBe(false);
    expect(hasContactShape('x@y.example', { phone: false })).toBe(true);
  });
  test('a candidate with contact details in the company name or note is refused with the exact sentence', () => {
    const base = {
      commandId: id(1),
      missionId: id(2),
      profileVersionId: id(3),
      sourceVersionId: id(4),
      companyName: 'Acme Trading Ltd',
      country: 'DE',
      observedAt: '2026-11-01T00:00:00Z',
      sourceLocator: 'https://registry.example/1',
    };
    expect(addCandidate.safeParse(base).success).toBe(true);
    for (const bad of [
      { companyName: 'jane@acme.example' },
      { companyName: 'Acme 030 1234 5678' },
      { nominationNote: 'ask jane@acme.example' },
      { nominationNote: 'phone 0301234567' },
    ]) {
      const result = addCandidate.safeParse({ ...base, ...bad });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(supplyWords.contactDetails);
    }
    expect(addCandidate.safeParse({ ...base, publicIdentifier: '1234567' }).success).toBe(true);
    expect(addCandidate.safeParse({ ...base, publicIdentifier: 'a@b.example' }).success).toBe(
      false,
    );
    expect(addCandidate.safeParse({ ...base, contactName: 'Jane' }).success).toBe(false);
  });
});

describe('file headers', () => {
  test('the eight are accepted, even though company_name contains the word name', () => {
    expect(classifySupplyHeaders([...supplyFileColumns])).toEqual({ personal: [], unknown: [] });
  });
  test('personal-looking headers are separated from other unknown ones', () => {
    expect(
      classifySupplyHeaders([
        'company_name',
        'Email',
        'phone_number',
        'contact',
        'colour',
        'person',
        'name',
      ]),
    ).toEqual({
      personal: ['Email', 'phone_number', 'contact', 'person', 'name'],
      unknown: ['colour'],
    });
  });
});

describe('commands', () => {
  test('a block or lift names an organisation or a company and country, never both or neither', () => {
    const base = { commandId: id(1), reason: 'Asked to stop', reference: 'ticket 41' };
    expect(blockCompany.safeParse({ ...base, organisationId: id(9) }).success).toBe(true);
    expect(
      blockCompany.safeParse({ ...base, companyName: 'Acme Ltd', country: 'DE' }).success,
    ).toBe(true);
    expect(blockCompany.safeParse(base).success).toBe(false);
    expect(
      blockCompany.safeParse({ ...base, organisationId: id(9), companyName: 'Acme', country: 'DE' })
        .success,
    ).toBe(false);
    expect(blockCompany.safeParse({ ...base, companyName: 'Acme' }).success).toBe(false);
    expect(
      blockCompany.safeParse({ ...base, organisationId: id(9), reference: 'jane@acme.example' })
        .success,
    ).toBe(false);
    expect(
      blockCompany.safeParse({ ...base, organisationId: id(9), reference: 'call 0301234567' })
        .success,
    ).toBe(false);
  });
  test('a reverse names the match it reverses; a match names an organisation', () => {
    const base = { commandId: id(1), candidateId: id(2), reason: 'Checked the register' };
    expect(
      matchCandidate.safeParse({ ...base, decision: 'MATCH', organisationId: id(3) }).success,
    ).toBe(true);
    expect(matchCandidate.safeParse({ ...base, decision: 'MATCH' }).success).toBe(false);
    expect(
      matchCandidate.safeParse({ ...base, decision: 'REVERSE', reverseOf: id(4) }).success,
    ).toBe(true);
    expect(matchCandidate.safeParse({ ...base, decision: 'REVERSE' }).success).toBe(false);
    expect(
      matchCandidate.safeParse({
        ...base,
        decision: 'MATCH',
        organisationId: id(3),
        reverseOf: id(4),
      }).success,
    ).toBe(false);
  });
  test('a source needs a label, a retention of 1 to 24 months and a status of its own', () => {
    const base = {
      commandId: id(1),
      kind: 'staff_research',
      status: 'active',
      label: 'Public registers',
      defaultRetentionMonths: 6,
      reason: 'Staff research',
    };
    expect(createSource.safeParse(base).success).toBe(true);
    expect(createSource.safeParse({ ...base, defaultRetentionMonths: 25 }).success).toBe(false);
    expect(createSource.safeParse({ ...base, kind: 'invented' }).success).toBe(false);
    expect(createSource.safeParse({ ...base, status: 'retired' }).success).toBe(false);
  });
});
