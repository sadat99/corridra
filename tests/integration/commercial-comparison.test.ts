import { describe, expect, it } from 'vitest';
import { compareOffers, type OfferTerms } from '../../packages/domain/src/commercial-missions';

const now = '2026-10-28T00:00:00Z';
const terms: OfferTerms = {
  specification: 'Truck tire 315/80 R22.5, load index 156/150',
  quantity: '100',
  unit: 'pieces',
  unitPriceMinor: '10000',
  totalPriceMinor: '1000000',
  toolingMinor: '0',
  setupMinor: '0',
  packagingMinor: '0',
  leadTime: 'Four weeks',
  validUntil: '2026-12-31T23:59:59Z',
  incoterm: 'FOB',
  shipping: 'EXCLUDED',
  paymentTerms: 'Thirty percent deposit',
};
const offer = (id: string, changes: Partial<OfferTerms> = {}) => ({
  id,
  currency: 'CNY',
  requirementId: 'current-requirement',
  terms: { ...terms, ...changes },
  uncertainties: 'Supplier declaration, not independently verified',
});

describe('quotation scope comparison', () => {
  it('requires machinery obligations even when both suppliers omit them, without imposing them on finished goods', () => {
    const input = [offer('machine-a'), offer('machine-b')];
    for (const item of compareOffers(input, now, 'MACHINERY')) {
      expect(item.status).toBe('NOT COMPARABLE');
      expect(item.missing).toEqual(
        expect.arrayContaining(['installation', 'warranty', 'training', 'spares']),
      );
    }
    expect(
      compareOffers(input, now, 'GENERAL').every(
        (item) => item.status === 'COMPARABLE ON SUPPLIED TERMS',
      ),
    ).toBe(true);
    const explicit = input.map((item) => ({
      ...item,
      terms: {
        ...item.terms,
        installation: 'Customer arranges installation',
        warranty: 'One year parts',
        training: 'Remote training included',
        spares: 'Quoted separately',
      },
    }));
    expect(
      compareOffers(explicit, now, 'MACHINERY').every(
        (item) => item.status === 'COMPARABLE ON SUPPLIED TERMS',
      ),
    ).toBe(true);
  });
  it('flags both technically different tires, in either order, without changing either offer', () => {
    const first = offer('tire-a');
    const second = offer('tire-b', { specification: 'Truck tire 385/65 R22.5, load index 160' });
    const original = structuredClone([first, second]);
    for (const input of [
      [first, second],
      [second, first],
    ]) {
      const compared = compareOffers(input, now);
      expect(compared.map((item) => item.status)).toEqual(['NOT COMPARABLE', 'NOT COMPARABLE']);
      expect(compared.every((item) => item.differences.includes('specification'))).toBe(true);
      expect(compared.map((item) => item.terms.specification)).toEqual(
        input.map((item) => item.terms.specification),
      );
    }
    expect([first, second]).toEqual(original);
  });

  it.each([
    ['moq', '10', '200'],
    ['leadTime', 'Four weeks', 'Twelve weeks'],
    ['paymentTerms', 'Thirty percent deposit', 'Full payment before production'],
    ['warranty', 'Two years parts and labour', 'Parts only for one year'],
    ['installation', 'On-site commissioning included', 'Customer arranges installation'],
    ['training', 'On-site training included', 'Remote guidance only'],
    ['spares', 'Initial spares included', 'All spares excluded'],
  ] as const)(
    'requires review of differing supplied %s obligations on both offers',
    (key, a, b) => {
      const result = compareOffers(
        [offer('machine-a', { [key]: a }), offer('machine-b', { [key]: b })],
        now,
      );
      expect(result.every((item) => item.status === 'NOT COMPARABLE')).toBe(true);
      expect(result.every((item) => item.differences.includes(key))).toBe(true);
    },
  );

  it('does not claim currency or requirement equivalence for the first offer', () => {
    for (const change of [{ currency: 'USD' }, { requirementId: 'other-requirement' }]) {
      const result = compareOffers([offer('a'), { ...offer('b'), ...change }], now);
      expect(result.every((item) => item.status === 'NOT COMPARABLE')).toBe(true);
    }
  });

  it('keeps price differences comparable when the supplied scope matches', () => {
    const result = compareOffers(
      [offer('a'), offer('b', { unitPriceMinor: '11000', totalPriceMinor: '1100000' })],
      now,
    );
    expect(result.every((item) => item.status === 'COMPARABLE ON SUPPLIED TERMS')).toBe(true);
    expect(result.map((item) => item.derivedTotal?.amountMinor)).toEqual(['1000000', '1100000']);
  });

  it('keeps missing terms missing without inventing an obligation for a complete peer', () => {
    const { leadTime, ...partial } = terms;
    void leadTime;
    const result = compareOffers([offer('complete'), { ...offer('partial'), terms: partial }], now);
    expect(result[0].status).toBe('COMPARABLE ON SUPPLIED TERMS');
    expect(result[1].status).toBe('NOT COMPARABLE');
    expect(result[1].missing).toContain('leadTime');
  });

  it('does not let superseded scope invalidate current matching offers', () => {
    const result = compareOffers(
      [
        { ...offer('old', { specification: 'Old specification' }), evidenceCurrent: false },
        offer('current-a'),
        offer('current-b'),
      ],
      now,
    );
    expect(result.map((item) => item.status)).toEqual([
      'NOT COMPARABLE',
      'COMPARABLE ON SUPPLIED TERMS',
      'COMPARABLE ON SUPPLIED TERMS',
    ]);
  });
});
