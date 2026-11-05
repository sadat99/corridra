import { describe, expect, it } from 'vitest';
import type { MissionExperience } from '../../packages/delivery/src/report';
import { sourceLedger } from '../../apps/web/lib/source-ledger';
import { compareExperienceOffers } from '../../apps/web/lib/experience-offers';

// The Source room's comparison (approved work rooms, 5 Nov 2026): one column per supplier, the engine's own
// verdicts, the currency each supplier quoted, and a missing term kept missing.
const at = '2026-11-05T00:00:00Z';
const machine = (over: Record<string, unknown> = {}) => ({
  specification: 'Ring spinning frame',
  quantity: '2',
  unit: 'sets',
  unitPriceMinor: '4850000',
  totalPriceMinor: '9700000',
  toolingMinor: '0',
  setupMinor: '0',
  packagingMinor: '0',
  leadTime: '75 days',
  validUntil: '2099-01-01T00:00:00Z',
  incoterm: 'FOB' as const,
  shipping: 'EXCLUDED' as const,
  paymentTerms: '30 percent deposit',
  installation: 'Included',
  warranty: '12 months',
  training: '5 days',
  spares: '1 year kit',
  ...over,
});
const offer = (
  id: string,
  targetId: string,
  over: Partial<MissionExperience['quotations'][number]> = {},
): MissionExperience['quotations'][number] => ({
  id,
  targetId,
  currency: 'USD',
  terms: machine(),
  revision: 1,
  uncertainties: 'None stated',
  sourceKind: 'supplier_document',
  claimStatus: 'verified',
  superseded: false,
  assignmentCurrent: true,
  ...over,
});
const target = (id: string, company: string, country: string) =>
  ({
    id,
    company,
    country,
    fit: 'HIGH',
    rationale: 'Fits',
    uncertainty: 'None',
    gaps: 'None',
    verification: 'Verified',
  }) as MissionExperience['shortlist'][number];
const experience = (quotations: MissionExperience['quotations']): MissionExperience => ({
  schemaVersion: 1,
  requirements: {
    version: 1,
    fields: { objective: 'Source', role: 'BUYER', product: 'Spinning frames' },
    sourceKind: 'customer',
    claimStatus: 'self_declared',
    current: true,
  },
  shortlist: [
    target('t1', 'Zhejiang Jingwei', 'Shaoxing, China'),
    target('t2', '青岛宏达纺织机械', 'Qingdao, China'),
    target('t3', 'Changzhou Spintech', 'Changzhou, China'),
  ],
  quotations,
  agenda: [],
  documentAccess: 'None',
});

describe('the Source room comparison', () => {
  const e = experience([
    offer('qa', 't1'),
    offer('qb', 't2', {
      currency: 'CNY',
      claimStatus: 'evidence_available',
      terms: machine({ unitPriceMinor: '35200000', totalPriceMinor: '70400000' }),
    }),
    offer('qc', 't3', {
      claimStatus: 'self_declared',
      terms: machine({ warranty: undefined, installation: undefined }),
    }),
    offer('old', 't1', { superseded: true }),
  ]);

  it('puts each current supplier in a column, with how it is backed, and keeps earlier offers out by default', () => {
    const ledger = sourceLedger(e, { at });
    expect(ledger.columns.map((c) => c.supplier)).toEqual([
      'Zhejiang Jingwei',
      '青岛宏达纺织机械',
      'Changzhou Spintech',
    ]);
    expect(ledger.columns.map((c) => c.trust)).toEqual([
      'Verified',
      'Evidence available',
      'Self-declared',
    ]);
    expect(ledger.columns[1]!.supplierLang).toBe('zh');
    expect(ledger.earlier).toBe(1);
    const all = sourceLedger(e, { at, includeEarlier: true });
    expect(all.columns).toHaveLength(4);
    expect(all.columns[3]!.historical).toBe(true);
  });

  it('takes every verdict from the comparison engine, never a rule of its own', () => {
    const ledger = sourceLedger(e, { at });
    const verdicts = compareExperienceOffers(e, at).slice(0, 3);
    expect(ledger.columns.map((c) => c.comparable)).toEqual(
      verdicts.map((v) => v.status === 'COMPARABLE ON SUPPLIED TERMS'),
    );
    expect(ledger.comparable + ledger.notComparable).toBe(3);
    for (const column of ledger.columns) expect(Boolean(column.reason)).toBe(!column.comparable);
  });

  it('keeps each price in the currency quoted and a missing term missing', () => {
    const ledger = sourceLedger(e, { at });
    const price = ledger.rows.find((r) => r.label === 'Original price')!;
    expect(price.cells[0]!.value).toMatch(/^USD/);
    expect(price.cells[1]!.value).toMatch(/^CNY/);
    expect(price.cells[1]!.sub).toMatch(/^CNY\s.* for 2 sets$/);
    const warranty = ledger.rows.find((r) => r.label === 'Warranty')!;
    expect(warranty.cells.map((c) => c.value)).toEqual(['12 months', '12 months', null]);
    expect(warranty.differs).toBe(true);
  });

  it('shows the price and the machinery obligations first, and every other term after them', () => {
    const ledger = sourceLedger(e, { at });
    expect(ledger.rows.filter((r) => r.key).map((r) => r.label)).toEqual([
      'Original price',
      'Incoterm',
      'Lead time',
      'Installation',
      'Warranty',
      'Training',
      'Spares',
    ]);
    expect(ledger.rows.find((r) => r.label === 'Lead time')!.differs).toBe(false);
    expect(ledger.rows.some((r) => r.label === 'Payment terms' && !r.key)).toBe(true);
  });

  // sourceledger-money.md M-03 and M-04: no ranking, no sum across currencies, an omission never reads cheaper.
  it('keeps the suppliers in the order given, ranks none and never sums or converts across currencies', () => {
    const cheaperButMissing = experience([
      offer('qa', 't1'),
      offer('qc', 't3', {
        terms: machine({ unitPriceMinor: '100', totalPriceMinor: '200', installation: undefined }),
      }),
      offer('qb', 't2', { currency: 'CNY' }),
    ]);
    const ledger = sourceLedger(cheaperButMissing, { at });
    expect(ledger.columns.map((c) => c.id)).toEqual(['qa', 'qc', 'qb']);
    const cheap = ledger.columns[1]!;
    expect(cheap.comparable).toBe(false);
    expect(ledger.rows.find((r) => r.label === 'Installation')!.cells[1]!.value).toBeNull();
    for (const row of ledger.rows)
      for (const [index, cell] of row.cells.entries()) {
        const text = `${cell.value ?? ''} ${cell.sub ?? ''}`;
        const currency = cheaperButMissing.quotations[index]!.currency;
        for (const other of ['USD', 'CNY'].filter((c) => c !== currency))
          expect(text, `${row.label} ${index}`).not.toContain(other);
      }
    expect(JSON.stringify(ledger)).not.toMatch(/best|cheapest|lowest|recommended/i);
  });

  // Guardian review of PR 314: a stated total without a unit price is shown, never "Not stated".
  it('shows a stated total when the supplier gave no unit price, and Not stated only when neither was given', () => {
    const ledger = sourceLedger(
      experience([
        offer('qa', 't1', { terms: machine({ unitPriceMinor: undefined }) }),
        offer('qb', 't2', {
          terms: machine({ unitPriceMinor: undefined, totalPriceMinor: undefined }),
        }),
      ]),
      { at },
    );
    const price = ledger.rows.find((r) => r.label === 'Original price')!;
    expect(price.cells[0]!.value).toMatch(/^USD\s97,000\.00$/);
    expect(price.cells[0]!.sub).toBe('Total for 2 sets; no unit price stated');
    expect(price.cells[1]!.value).toBeNull();
  });

  it('shows nothing when no offer is current, and says how many earlier ones are kept', () => {
    const ledger = sourceLedger(experience([offer('old', 't1', { superseded: true })]), { at });
    expect(ledger.columns).toEqual([]);
    expect(ledger.earlier).toBe(1);
  });
});
