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
const rows = (html: string) => [...html.matchAll(/<dt>(.*?)<\/dt>/g)].map((m) => m[1]);
const strip = (html: string) => html.replace(/<dl[\s\S]*?<\/dl>/g, '').replace(/ /g, ' ');

describe('Compare lens, differences only', () => {
  it('hides identical rows, keeps differing rows, states the count, and leaves the verdicts alone', async () => {
    const { CompareLens } = await loadWeb('components/compare-lens');
    const { QuoteCard } = await loadWeb('components/mr/quote-card');
    const folded = render(ce(CompareLens, { cards, matrix: ce('table') }));
    const unfolded = cards.map((c) => render(ce(QuoteCard, { ...c, labels: undefined }))).join('');
    const diff = termDiff(cards);
    const shown = rows(folded);
    // Lead time and payment (Not stated in one offer) stay; shipping (excluded) stays; incoterm folds.
    expect(shown).toContain('Lead time');
    expect(shown).toContain('Payment terms');
    expect(shown).toContain('Shipping scope');
    expect(shown).not.toContain('Incoterm');
    expect(diff.same).toContain('Incoterm');
    expect(folded).toContain(`${diff.same.length} terms are the same in every offer`);
    expect(folded).toContain('Differences only');
    expect(folded).toContain('aria-pressed="true"');
    // Nothing leaves the accessible content without the count line.
    const hidden = rows(unfolded).filter((l, i, a) => a.indexOf(l) === i && !shown.includes(l));
    expect(hidden.length).toBe(diff.same.length);
    expect(folded).toContain('role="status"');
    // Verdict, seal, engine reason and currency are byte-identical outside the term list.
    const verdictParts = (html: string) =>
      strip(html).match(/<p class="mr-quote-verdict">[\s\S]*?<\/p>/g);
    expect(verdictParts(folded)).toEqual(verdictParts(unfolded));
    expect(folded).toContain('Missing: Lead time, Payment terms.');
    expect(folded).toContain('Comparable on supplied terms');
    expect(folded).toContain('Not comparable yet');
    expect(folded.match(/USD/g)?.length).toBeGreaterThan(0);
  });
  it('says every term is the same when nothing differs, built from quoteCardsFrom output', async () => {
    const { CompareLens } = await loadWeb('components/compare-lens');
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
    const diff = termDiff(same);
    // Shipping is excluded in the sample, so that one row always shows; the rest are identical.
    expect(diff.same.length).toBe(diff.total - 1);
    const html = render(ce(CompareLens, { cards: same, matrix: ce('table') }));
    expect(html).toContain(`${diff.same.length} terms are the same in every offer`);
    const allSame = same.map((c) => ({
      ...c,
      terms: c.terms.filter((x) => x.state !== 'excluded'),
    }));
    const every = render(ce(CompareLens, { cards: allSame, matrix: ce('table') }));
    expect(every).toContain('terms are the same in every offer');
    expect(every).toContain('Every term is the same in all offers');
  });
  it('keeps one live status region and counts in the locale digits', async () => {
    const { CompareLens } = await loadWeb('components/compare-lens');
    const html = render(ce(CompareLens, { cards, matrix: ce('table') }));
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(new Intl.NumberFormat('bn').format(7)).toBe('৭');
  });
  it('shows no control for a single offer', async () => {
    const { CompareLens } = await loadWeb('components/compare-lens');
    const html = render(ce(CompareLens, { cards: cards.slice(0, 1), matrix: ce('table') }));
    expect(html).not.toContain('Differences only');
    expect(rows(html)).toContain('Incoterm');
  });
  it('carries the five keys in all seven catalogues', () => {
    for (const cat of Object.values(catalogs))
      for (const k of [
        'compare.diffOnly',
        'compare.sameHidden',
        'compare.sameHiddenOne',
        'compare.showAll',
        'compare.allSame',
        'compare.shownAll',
      ] as const)
        expect((cat as Record<string, string>)[k]).toBeTruthy();
  });
});
