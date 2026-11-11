import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MissionExperience } from '../../packages/delivery/src/report';
import { sourceLedger } from '../../apps/web/lib/source-ledger';

// Source journey, comparison step (S47, 11 Nov 2026). Every column of the Source room's comparison says whose
// quote it is, which version of that quote, in which currency, and how the quote is backed. Before this, a
// column showed the supplier and place only, so a supplier's earlier and current quote read as the same quote,
// and a quote whose source status is not one of the five fact names showed no source at all.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const plain = (html: string) => html.replace(/ /g, ' ');

const at = '2026-11-11T00:00:00Z';
const terms = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});
type Offer = MissionExperience['quotations'][number];
const offer = (id: string, targetId: string, over: Partial<Offer> = {}): Offer => ({
  id,
  targetId,
  currency: 'USD',
  terms: terms(),
  revision: 1,
  uncertainties: 'None stated',
  sourceKind: 'supplier_document',
  claimStatus: 'self_declared',
  superseded: false,
  assignmentCurrent: true,
  ...over,
});
const target = (id: string, company: string) =>
  ({
    id,
    company,
    country: 'China',
    fit: 'HIGH',
    rationale: 'Fits',
    uncertainty: 'None',
    gaps: 'None',
    verification: 'Self-declared',
  }) as MissionExperience['shortlist'][number];
const experience: MissionExperience = {
  schemaVersion: 1,
  requirements: {
    version: 1,
    fields: { objective: 'Source', role: 'BUYER', product: 'Spinning frames' },
    sourceKind: 'customer',
    claimStatus: 'self_declared',
    current: true,
  },
  shortlist: [target('t1', 'Zhejiang Jingwei'), target('t2', '青岛宏达纺织机械')],
  quotations: [
    // The first supplier revised its quote: version 1 is kept as an earlier quote, version 2 is current.
    offer('q1', 't1', { superseded: true }),
    offer('q2', 't1', {
      revision: 2,
      terms: terms({ unitPriceMinor: '4700000', totalPriceMinor: '9400000' }),
    }),
    // The second supplier quoted in another currency, and its source status is not one of the five fact names.
    offer('q3', 't2', {
      revision: 3,
      currency: 'CNY',
      sourceKind: 'operator_transcription',
      claimStatus: 'unreviewed',
      terms: terms({ unitPriceMinor: '35200000', totalPriceMinor: '70400000' }),
    }),
  ],
  agenda: [],
  documentAccess: 'None',
};

describe('each comparison column keeps its quote version, currency and source', () => {
  it('carries the version and currency of every current quote', () => {
    const ledger = sourceLedger(experience, { at });
    expect(ledger.columns.map((c) => [c.supplier, c.revision, c.currency])).toEqual([
      ['Zhejiang Jingwei', 2, 'USD'],
      ['青岛宏达纺织机械', 3, 'CNY'],
    ]);
  });

  it('tells a supplier’s earlier quote from its current one by the version', () => {
    const ledger = sourceLedger(experience, { at, includeEarlier: true });
    const sameSupplier = ledger.columns.filter((c) => c.supplier === 'Zhejiang Jingwei');
    expect(sameSupplier.map((c) => [c.revision, c.historical])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('keeps the source kind and claim status exactly as the report states them', () => {
    const ledger = sourceLedger(experience, { at });
    expect(ledger.columns[0]!.provenance).toBe('supplier_document · self_declared');
    expect(ledger.columns[1]!.trust).toBeNull();
    expect(ledger.columns[1]!.provenance).toBe('operator_transcription · unreviewed');
  });

  it('shows the version, currency and source in every column heading and on every phone card', async () => {
    const { SourceLedger } = await loadWeb('components/source-ledger');
    const html = plain(render(ce(SourceLedger, { experience, language: 'en' })));
    // Once in the wide table and once on the phone card, for each of the two current quotes.
    expect(html.match(/Offer revision <span class="ledger-num">2<\/span> · USD/g)).toHaveLength(2);
    expect(html.match(/Offer revision <span class="ledger-num">3<\/span> · CNY/g)).toHaveLength(2);
    // A fact name where the product has one; otherwise the source as written, never nothing.
    expect(html.match(/Self-declared/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/operator_transcription · unreviewed/g)).toHaveLength(2);
    // Nothing about the comparison itself moved: no conversion, no ranking word, prices as quoted.
    expect(html).toContain('USD 47,000.00');
    expect(html).toContain('CNY 352,000.00');
    expect(html).not.toMatch(/exchange rate|equivalent|cheapest|lowest|best price/i);
  });
});
