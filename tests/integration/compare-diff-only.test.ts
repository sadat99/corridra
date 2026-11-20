import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareOffers } from '../../packages/domain/src/commercial-missions';
import { quoteCardsFrom } from '../../apps/web/lib/quote-cards';
import { termDiff } from '../../apps/web/lib/term-diff';
import { catalogs } from '../../apps/web/lib/i18n/messages';

// CMP1 (17 November 2026), V3-04-077: the Compare cards fold term rows every offer states identically,
// behind a visible count and a control. Pure rules first, then the rendered sample.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (t: unknown, p?: unknown, ...c: unknown[]) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const t = (label: string, value: string | null, extra: Record<string, unknown> = {}) => ({
  label,
  value,
  ...extra,
});
const o = (currency: string, ...terms: ReturnType<typeof t>[]) => ({ currency, terms });

describe('termDiff', () => {
  it('folds a term every offer states identically', () => {
    const d = termDiff([o('USD', t('Incoterm', 'FOB')), o('USD', t('Incoterm', 'FOB'))]);
    expect(d.same).toEqual(['Incoterm']);
    expect(d.allSame).toBe(true);
  });
  it('shows a term one offer leaves not stated', () => {
    const d = termDiff([o('USD', t('Lead time', '45 days')), o('USD', t('Lead time', null))]);
    expect(d.same).toEqual([]);
  });
  it('shows a term missing in every offer', () => {
    const d = termDiff([o('USD', t('Warranty', null)), o('USD', t('Warranty', null))]);
    expect(d.same).toEqual([]);
    expect(d.allSame).toBe(false);
  });
  it('shows excluded shipping, even when every offer excludes it', () => {
    const ex = t('Shipping scope', null, { state: 'excluded' });
    expect(termDiff([o('USD', ex), o('USD', ex)]).same).toEqual([]);
  });
  it('shows a term whose value differs', () => {
    expect(termDiff([o('USD', t('Incoterm', 'FOB')), o('USD', t('Incoterm', 'CIF'))]).same).toEqual(
      [],
    );
  });
  it('never folds an amount across different currencies', () => {
    const m = (v: string) => t('Tooling', v, { money: true });
    expect(termDiff([o('USD', m('0')), o('EUR', m('0'))]).same).toEqual([]);
    expect(termDiff([o('USD', m('USD 0.00')), o('USD', m('USD 0.00'))]).same).toEqual(['Tooling']);
  });
  it('folds nothing for a single offer', () => {
    expect(termDiff([o('USD', t('Incoterm', 'FOB'))]).same).toEqual([]);
  });
  it('shows a term one offer omits from its list', () => {
    const d = termDiff([
      o('USD', t('Incoterm', 'FOB'), t('Spares', 'Yes')),
      o('USD', t('Incoterm', 'FOB')),
    ]);
    expect(d.same).toEqual(['Incoterm']);
    expect(d.total).toBe(2);
  });
});

const when = '2099-01-01T00:00:00.000Z';
const full = {
  specification: 'Auto cutter 2.5 m bed',
  quantity: '2',
  unit: 'unit',
  unitPriceMinor: '1840000',
  totalPriceMinor: '3680000',
  leadTime: '45 days',
  validUntil: when,
  incoterm: 'FOB' as const,
  shipping: 'EXCLUDED' as const,
  paymentTerms: '30% deposit, 70% before shipping',
  toolingMinor: '0',
  setupMinor: '0',
  packagingMinor: '0',
};
const offer = (id: string, terms: Record<string, unknown>) => ({
  id,
  targetId: id === 'b' ? 't2' : 't1',
  currency: 'USD',
  terms,
  revision: id === 'b' ? 3 : 2,
  uncertainties: 'None stated',
  sourceKind: 'self_declaration',
  claimStatus: 'self_declared',
  superseded: false,
  assignmentCurrent: true,
});
const company = (id: string, name: string) => ({
  id,
  company: name,
  country: 'China',
  fit: 'HIGH',
  rationale: '',
  uncertainty: '',
  gaps: '',
  verification: '',
});
const shortlist = [company('t1', 'Lantern Cutting Works'), company('t2', '绿野机械有限公司')];
const offers = [
  offer('a', full),
  offer('b', { ...full, leadTime: undefined, paymentTerms: undefined }),
];
const verdicts = compareOffers(
  offers.map((x) => ({
    id: x.id,
    currency: x.currency,
    terms: x.terms as never,
    requirementId: '1',
    uncertainties: '',
    evidenceCurrent: true,
  })),
);
const cards = quoteCardsFrom({
  offers: offers as never[],
  verdicts,
  shortlist: shortlist as never,
});
const rows = (html: string) =>
  [...html.matchAll(/<th scope="row"[^>]*>(.*?)<\/th>/g)].map((m) => m[1]);
const plain = (html: string) => html.replace(/[\u00a0\u202f]/g, ' ');

// UI/UX.v4 row "Compare" (20 Nov 2026): the lens's "Side by Side" view is the shared table; the fold rule is the
// same termDiff, now over the price rows too, and the words name both quotes or all of them.
describe('Compare lens, differences only', () => {
  it('hides identical rows, keeps differing rows, states the count, and leaves the verdicts alone', async () => {
    const { CompareLens, sideBySide } = await loadWeb('components/compare-lens');
    const folded = plain(render(ce(CompareLens, { cards, matrix: ce('table') })));
    const grid = sideBySide(cards) as { rows: { label: string; same: boolean }[] };
    const shown = rows(folded);
    // Lead time and payment (Not stated in one offer) stay; shipping (excluded) stays; incoterm folds.
    expect(shown).toContain('Lead time');
    expect(shown).toContain('Payment terms');
    expect(shown).toContain('Shipping scope');
    expect(shown).not.toContain('Incoterm');
    expect(termDiff(cards).same).toContain('Incoterm');
    // The count is exactly the rows left out, and every row is either shown or counted.
    const same = grid.rows.filter((row) => row.same).map((row) => row.label);
    expect(same.length).toBeGreaterThan(1);
    expect(folded).toContain(`${same.length} terms are the same in both.`);
    expect(grid.rows.map((row) => row.label).filter((label) => !shown.includes(label))).toEqual(
      same,
    );
    expect(folded).toContain('Differences Only');
    expect(folded).toContain('aria-pressed="true"');
    expect(folded).toContain('role="status"');
    // Folding changes the body only: the column heads (verdict, seal, engine reason, currency, trust) are identical
    // to the same table with nothing folded.
    const { CompareGrid } = await loadWeb('components/ux/compare-grid');
    const unfolded = plain(
      render(
        ce(CompareGrid, {
          locale: 'en',
          columns: cards,
          rows: grid.rows.map((row) => ({ ...row, same: false })),
          regionLabel: 'compare.regionReport',
        }),
      ),
    );
    const heads = (html: string) => html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(heads(folded).length).toBeGreaterThan(200);
    expect(heads(folded)).toEqual(heads(unfolded));
    expect(rows(unfolded)).toEqual(grid.rows.map((row) => row.label));
    // The verdicts and the engine reason are as the engine gave them, in the column heads.
    expect(folded).toContain('Missing: Lead time, Payment terms.');
    expect(folded).toContain('Comparable');
    expect(folded).toContain('Not comparable yet');
    expect(folded.match(/USD/g)?.length).toBeGreaterThan(0);
  });
  it('folds every identical term but never the prices, built from quoteCardsFrom output', async () => {
    const { CompareLens, sideBySide } = await loadWeb('components/compare-lens');
    const stated = {
      ...full,
      moq: '1',
      warranty: '12 months',
      installation: 'Included',
      training: 'On site',
      spares: '2 years',
    };
    const pair = [offer('a', stated), offer('b', stated)];
    const same = quoteCardsFrom({
      offers: pair as never[],
      verdicts: compareOffers(
        pair.map((x) => ({
          id: x.id,
          currency: 'USD',
          terms: x.terms as never,
          requirementId: '1',
          uncertainties: '',
          evidenceCurrent: true,
        })),
      ),
      shortlist: shortlist as never,
    });
    const grid = sideBySide(same) as { rows: { label: string; same: boolean }[] };
    // The two price rows and excluded shipping always show; every other term is identical and folds.
    expect(grid.rows.filter((row) => !row.same).map((row) => row.label)).toEqual([
      'Original unit price',
      'Original total',
      'Shipping scope',
    ]);
    const html = render(ce(CompareLens, { cards: same, matrix: ce('table') }));
    expect(html).toContain(`${grid.rows.length - 3} terms are the same in both.`);
    expect(rows(html)).toEqual(['Original unit price', 'Original total', 'Shipping scope']);
    // With the prices always in view, "every term is the same" is never said while prices show.
    expect(html).not.toContain('Every term is the same');
  });
  it('never folds equal prices quoted per a different unit or on a different Incoterm', async () => {
    const { CompareLens, sideBySide } = await loadWeb('components/compare-lens');
    const ten = { ...full, unitPriceMinor: '1000', totalPriceMinor: '2000' };
    const pair = [offer('a', ten), offer('b', { ...ten, unit: 'set', incoterm: 'CIF' })];
    const priced = quoteCardsFrom({
      offers: pair as never[],
      verdicts: compareOffers(
        pair.map((x) => ({
          id: x.id,
          currency: 'USD',
          terms: x.terms as never,
          requirementId: '1',
          uncertainties: '',
          evidenceCurrent: true,
        })),
      ),
      shortlist: shortlist as never,
    });
    // Two equal amounts, USD 10.00 each, but per a different unit and on a different Incoterm.
    for (const card of priced as { unitPrice: string | null }[])
      expect(card.unitPrice).toMatch(/^USD\s10\.00$/);
    const grid = sideBySide(priced) as { rows: { label: string; same: boolean }[] };
    const folded = grid.rows.filter((row) => row.same).map((row) => row.label);
    expect(folded).not.toContain('Original unit price');
    expect(folded).not.toContain('Original total');
    const html = plain(render(ce(CompareLens, { cards: priced, matrix: ce('table') })));
    const shown = rows(html);
    expect(shown).toContain('Original unit price');
    expect(shown).toContain('Original total');
    // The count is exactly the rows left out, and the prices are not among them.
    expect(html).toContain(`${folded.length} terms are the same in both.`);
    expect(grid.rows.map((row) => row.label).filter((label) => !shown.includes(label))).toEqual(
      folded,
    );
  });
  it('keeps one live status region and counts in the locale digits', async () => {
    const { CompareLens } = await loadWeb('components/compare-lens');
    const html = render(ce(CompareLens, { cards, matrix: ce('table') }));
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(new Intl.NumberFormat('bn').format(7)).toBe('৭');
  });
  it('shows no control for a single offer, and says there is nothing to compare yet', async () => {
    const { CompareLens } = await loadWeb('components/compare-lens');
    const html = render(ce(CompareLens, { cards: cards.slice(0, 1), matrix: ce('table') }));
    expect(html).not.toContain('Differences Only');
    expect(rows(html)).toContain('Incoterm');
    expect(html).toContain('There is only one quote so far, so there is nothing to compare yet.');
  });
  it('names the view Side by Side and keeps the Table view', async () => {
    const { CompareLens } = await loadWeb('components/compare-lens');
    const html = render(ce(CompareLens, { cards, matrix: ce('table', { id: 'matrix' }) }));
    expect(html).toContain('>Side by Side</button>');
    expect(html).toContain('>Table</button>');
    expect(html).not.toContain('>Cards</button>');
  });
  it('carries the comparison keys in all seven catalogues', () => {
    for (const cat of Object.values(catalogs))
      for (const k of [
        'compare.sideBySide',
        'compare.diffOnly',
        'compare.sameBoth',
        'compare.sameBothOne',
        'compare.sameAll',
        'compare.sameAllOne',
        'compare.allSameBoth',
        'compare.allSameAll',
        'compare.onlyOne',
        'compare.showAll',
        'compare.shownAll',
        'compare.money',
        'compare.notStatedLine',
        'compare.ask',
      ] as const)
        expect((cat as Record<string, string>)[k]).toBeTruthy();
  });
});
