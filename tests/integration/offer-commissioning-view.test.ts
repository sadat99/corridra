import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MissionExperience } from '../../packages/delivery/src/report';
import { compareOffers } from '../../packages/domain/src/commercial-missions';
import { quoteCardsFrom, referenceLine } from '../../apps/web/lib/quote-cards';
import { sourceLedger } from '../../apps/web/lib/source-ledger';
import { visitKindWord } from '../../apps/web/lib/visit-kinds';

// Part B of the commissioning term, and the visit kind and quote reference the approved detail has carried since real-use 0019: the
// words a buyer reads. A machinery offer that does not state commissioning says so on its card, in the comparison and in the ledger; a
// simple mission shows no machinery row; the quote reference is a date and eight characters, never a link; and a visit kind the
// product does not name shows nothing.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const plain = (html: string) => html.replace(/\u00a0/g, ' ');

const at = '2026-11-11T00:00:00Z';
const sourceId = '3f9a2c1d-1111-4222-8333-444455556666';
const observedAt = '2026-11-10T09:30:00Z';
type Offer = MissionExperience['quotations'][number];
const baseTerms = {
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
  warranty: 'One year',
  training: 'Two days',
  spares: 'Quoted separately',
};
const offer = (id: string, over: Partial<Offer> = {}): Offer => ({
  id,
  targetId: 't1',
  currency: 'USD',
  terms: baseTerms,
  revision: 1,
  uncertainties: 'None stated',
  sourceKind: 'supplier_document',
  claimStatus: 'self_declared',
  superseded: false,
  assignmentCurrent: true,
  sourceId,
  observedAt,
  ...over,
});
const experience = (
  assignmentType: string | null | undefined,
  quotations: Offer[],
  agenda: MissionExperience['agenda'] = [],
): MissionExperience => ({
  schemaVersion: 1,
  requirements: {
    version: 1,
    fields: { objective: 'Source', role: 'BUYER', product: 'Spinning frames' },
    sourceKind: 'customer',
    claimStatus: 'self_declared',
    current: true,
    ...(assignmentType === undefined ? {} : { assignmentType }),
  },
  shortlist: [
    {
      id: 't1',
      company: 'Zhejiang Jingwei',
      country: 'China',
      fit: 'HIGH',
      rationale: 'Fits',
      uncertainty: 'None',
      gaps: 'None',
      verification: 'Self-declared',
    },
  ],
  quotations,
  agenda,
  documentAccess: 'None',
});
const machinery = 'machinery_procurement';

describe('the visit kind', () => {
  it('has one plain word for each stored kind and nothing for any other', () => {
    expect(visitKindWord('FACTORY_VISIT')).toBe('Factory visit');
    expect(visitKindWord('SHOWROOM_VISIT')).toBe('Showroom visit');
    expect(visitKindWord('TRADE_FAIR_MEETING')).toBe('Trade fair meeting');
    expect(visitKindWord('TECHNICAL_EVALUATION')).toBe('Technical evaluation');
    expect(visitKindWord('BUYER_MEETING')).toBe('Buyer meeting');
    expect(visitKindWord('SUPPLIER_MEETING')).toBe('Supplier meeting');
    expect(visitKindWord('INSTITUTIONAL_MEETING')).toBe('Institutional meeting');
    for (const unknown of [
      'MYSTERY_KIND',
      'factory_visit',
      '',
      'constructor',
      '__proto__',
      null,
      undefined,
    ])
      expect(visitKindWord(unknown)).toBeUndefined();
  });

  it('is said before the status of a meeting, and an unknown or absent kind adds nothing', async () => {
    const { AgendaView } = await loadWeb('app/mission-experience-view');
    const item = (kind: string | undefined) => ({
      id: 'a1',
      itemId: 'i1',
      version: 1,
      label: 'Supplier visit',
      state: 'PROPOSED',
      nextAction: 'Confirm the time',
      dueAt: '2026-12-01T00:00:00Z',
      responsibility: 'Assigned programme operator',
      meetings: [
        {
          id: 'm1',
          status: 'SCHEDULED',
          scheduleChanged: false,
          ...(kind ? { activityKind: kind } : {}),
        },
      ],
    });
    const html = (kind: string | undefined) =>
      plain(render(ce(AgendaView, { agenda: [item(kind)], language: 'en' })));
    expect(html('FACTORY_VISIT')).toContain('Factory visit · scheduled:');
    expect(html('MYSTERY_KIND')).not.toContain('MYSTERY');
    expect(html('MYSTERY_KIND')).not.toContain(' · scheduled:');
    expect(html('MYSTERY_KIND')).toContain('scheduled:');
    expect(html(undefined)).not.toContain(' · scheduled:');
  });
});

describe('the quote reference', () => {
  it('is the quote date and the first eight characters of the source record, and nothing that opens anything', () => {
    expect(referenceLine({ sourceId, observedAt })).toBe(
      'Quoted Nov 10, 2026 · Source ref 3f9a2c1d',
    );
    expect(referenceLine({ observedAt })).toBe('Quoted Nov 10, 2026');
    expect(referenceLine({ sourceId })).toBe('Source ref 3f9a2c1d');
    expect(referenceLine({})).toBeUndefined();
    expect(referenceLine({ sourceId: 'not-an-id', observedAt: 'not a date' })).toBeUndefined();
    expect(referenceLine({ sourceId: 'https://example.invalid/file.pdf' })).toBeUndefined();
    expect(referenceLine({ sourceId, observedAt })).not.toMatch(/https?:|\/|\\/);
  });

  it('is on the ledger column and the phone card, and absent when the approved detail has no reference', async () => {
    const { SourceLedger } = await loadWeb('components/source-ledger');
    const withRef = plain(
      render(
        ce(SourceLedger, { experience: experience(machinery, [offer('q1')]), language: 'en' }),
      ),
    );
    expect(withRef.match(/Quoted Nov 10, 2026 · Source ref 3f9a2c1d/g)).toHaveLength(2);
    const without = plain(
      render(
        ce(SourceLedger, {
          experience: experience(machinery, [
            offer('q1', { sourceId: undefined, observedAt: undefined }),
          ]),
          language: 'en',
        }),
      ),
    );
    expect(without).not.toMatch(/Quoted [A-Z][a-z]{2} \d|Source ref/);
    expect(sourceLedger(experience(machinery, [offer('q1')]), { at }).columns[0]!.reference).toBe(
      'Quoted Nov 10, 2026 · Source ref 3f9a2c1d',
    );
  });
});

describe('commissioning in the comparison', () => {
  const cards = (context: 'GENERAL' | 'MACHINERY', over: Record<string, string> = {}) => {
    const offers = [offer('q1', { terms: { ...baseTerms, ...over } })];
    return quoteCardsFrom({
      offers,
      verdicts: compareOffers(
        offers.map((o) => ({
          id: o.id,
          currency: o.currency,
          terms: o.terms,
          requirementId: '1',
          uncertainties: o.uncertainties,
        })),
        at,
        context,
      ),
      shortlist: experience(machinery, offers).shortlist,
    });
  };
  const row = (view: ReturnType<typeof cards>) =>
    view[0]!.terms.find((t) => t.label === 'Commissioning');

  it('says "not stated" on a machinery card that leaves it out, with the reason, and is not comparable', () => {
    const [card] = cards('MACHINERY');
    expect(row([card!])).toEqual({ label: 'Commissioning', value: null });
    expect(card!.comparable).toBe(false);
    expect(card!.reason).toContain('Missing: Commissioning');
    expect(card!.terms.map((t) => t.label).indexOf('Commissioning')).toBe(
      card!.terms.map((t) => t.label).indexOf('Installation') + 1,
    );
  });

  it('shows the words the supplier gave, and makes the machinery offer comparable', () => {
    const [card] = cards('MACHINERY', { commissioning: 'Two engineers for five days' });
    expect(row([card!])?.value).toBe('Two engineers for five days');
    expect(card!.comparable).toBe(true);
  });

  it('adds no machinery row to a simple mission, unless the supplier stated it', () => {
    expect(row(cards('GENERAL'))).toBeUndefined();
    expect(row(cards('GENERAL', { commissioning: 'Optional, quoted on request' }))?.value).toBe(
      'Optional, quoted on request',
    );
  });

  it('puts Commissioning among the key rows of the ledger, after Installation, for a machinery mission only', () => {
    const rows = (type: string | null | undefined) =>
      sourceLedger(experience(type, [offer('q1')]), { at }).rows;
    const keys = rows(machinery)
      .filter((r) => r.key)
      .map((r) => r.label);
    expect(keys).toContain('Commissioning');
    expect(keys.indexOf('Commissioning')).toBe(keys.indexOf('Installation') + 1);
    expect(rows('sourcing').map((r) => r.label)).not.toContain('Commissioning');
    expect(rows(machinery).find((r) => r.label === 'Commissioning')!.cells).toEqual([
      { value: null },
    ]);
  });

  it('shows the matrix row for machinery or a stated term, and not otherwise', async () => {
    const { ComparisonMatrix } = await loadWeb('components/comparison-matrix');
    const html = (props: Record<string, unknown>) =>
      plain(
        render(
          ce(ComparisonMatrix, {
            offers: [offer('q1')],
            shortlist: experience(machinery, []).shortlist,
            language: 'en',
            ...props,
          }),
        ),
      );
    expect(html({})).not.toContain('Commissioning');
    expect(html({ machinery: true })).toMatch(
      /Commissioning<\/th><td class="ux-cell-missing"><span>NOT SUPPLIED/,
    );
    expect(
      html({ offers: [offer('q1', { terms: { ...baseTerms, commissioning: 'Included' } })] }),
    ).toMatch(/Commissioning<\/th><td><span>Included/);
  });

  it('uses one rule for the buyer and the team: a payload without the mission type keeps the earlier rule', async () => {
    const { MissionExperienceView } = await loadWeb('app/mission-experience-view');
    const html = (e: MissionExperience) =>
      plain(render(ce(MissionExperienceView, { experience: e })));
    expect(html(experience(machinery, [offer('q1')]))).toContain('Commissioning: NOT SUPPLIED');
    expect(html(experience('sourcing', [offer('q1')]))).not.toContain('Commissioning');
    expect(html(experience(machinery, [offer('q1')]))).toContain(
      'Quoted Nov 10, 2026 · Source ref 3f9a2c1d',
    );
  });
});
