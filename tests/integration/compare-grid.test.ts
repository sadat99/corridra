import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogs } from '../../apps/web/lib/i18n/messages';

// The shared comparison table (UI/UX.v4 row "Compare", owner approval of 20 November 2026). Rendered on the server
// with the default state (Differences Only on); the browser behaviour is in tests/ux/compare-grid.spec.ts.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (t: unknown, p?: unknown, ...c: unknown[]) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const plain = (html: string) => html.replace(/[  ]/g, ' ').replace(/&#x27;/g, "'");

type Column = Record<string, unknown>;
const column = (id: string, supplier: string, over: Column = {}): Column => ({
  id,
  supplier,
  revision: 1,
  currency: 'USD',
  trust: 'Self-declared',
  comparable: true,
  ...over,
});
const row = (label: string, same: boolean, ...cells: Record<string, unknown>[]) => ({
  label,
  same,
  cells,
});
const v = (value: string | null, extra: Record<string, unknown> = {}) => ({ value, ...extra });
const grid = async (props: Record<string, unknown>) => {
  const { CompareGrid } = await loadWeb('components/ux/compare-grid');
  return plain(render(ce(CompareGrid, { locale: 'en', ...props })));
};
const rowLabels = (html: string) =>
  [...html.matchAll(/<th scope="row"[^>]*>(.*?)<\/th>/g)].map((m) => m[1]);

const two = [
  column('a', 'Lantern Cutting Works'),
  column('b', '绿野机械有限公司', {
    supplierLang: 'zh',
    currency: 'CNY',
    trust: 'Evidence available',
    comparable: false,
    reason: 'Missing: Lead time.',
  }),
];
const rowsTwo = [
  row('Original unit price', false, v('USD 18,400.00', { money: true }), v('CNY 9.00')),
  row('Incoterm', true, v('FOB'), v('FOB')),
  row('Payment terms', true, v('30% deposit'), v('30% deposit')),
  row('Lead time', false, v('45 days'), v(null)),
  row('Shipping scope', false, v(null, { excluded: true }), v(null, { excluded: true })),
];

describe('the comparison table', () => {
  it('is one real table: a column head per supplier, a frozen row label per term and the word Terms in the corner', async () => {
    const html = await grid({ columns: two, rows: rowsTwo });
    expect(html.match(/<table/g)).toHaveLength(1);
    // Explicit roles, so it stays a table when two suppliers on a phone are laid out row by row.
    expect(html).toContain('role="table" data-cols="2"');
    expect(
      html.match(/<th scope="col" role="columnheader" class="compare-grid-head"/g),
    ).toHaveLength(2);
    expect(html).toContain(
      '<th scope="col" role="columnheader" class="compare-grid-corner">Terms</th>',
    );
    expect(html.match(/<th scope="row" role="rowheader"/g)).toHaveLength(3);
    expect(html.match(/<td role="cell"/g)).toHaveLength(6);
    expect(html).toContain('role="region" aria-label="Quotes side by side" tabindex="0"');
    expect(html).toContain('<b lang="zh" dir="auto">绿野机械有限公司</b>');
    // No phone card strip and no duplicated content: each supplier name appears once.
    expect(html.match(/Lantern Cutting Works/g)).toHaveLength(1);
    expect(html).not.toContain('one card per supplier');
  });

  it('puts the verdict on top of each column, with the engine reason as written', async () => {
    const html = await grid({ columns: two, rows: rowsTwo });
    expect(html).toContain('Comparable');
    expect(html).toContain('Not comparable yet');
    expect(html).toContain('Missing: Lead time.');
    // The verdict sits in the column head, before the first body row.
    expect(html.indexOf('<tbody')).toBeGreaterThan(0);
    expect(html.indexOf('Not comparable yet')).toBeLessThan(html.indexOf('<tbody'));
  });

  it('shows the trust label once per supplier in the head, never repeated under each value', async () => {
    const html = await grid({ columns: two, rows: rowsTwo });
    expect(html.match(/Self-declared/g)).toHaveLength(1);
    expect(html.match(/Evidence available/g)).toHaveLength(1);
    expect(html.indexOf('<tbody')).toBeGreaterThan(0);
    const body = html.slice(html.indexOf('<tbody'));
    expect(body).not.toMatch(/Self-declared|Evidence available|Verified|Derived|Outcome observed/);
  });

  it('folds only the rows marked the same by default, and says how many in words', async () => {
    const html = await grid({ columns: two, rows: rowsTwo });
    expect(rowLabels(html)).toEqual(['Original unit price', 'Lead time', 'Shipping scope']);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('>Differences Only</button>');
    expect(html).toContain(
      '<p role="status" class="compare-grid-status">2 terms are the same in both.</p>',
    );
    expect(html).toContain('>Show Them</button>');
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it('counts for three or more quotes, and says when every term is the same', async () => {
    const three = [...two, column('c', 'Changzhou Spintech')];
    const rows = [
      row('Incoterm', true, v('FOB'), v('FOB'), v('FOB')),
      row('Lead time', false, v('45 days'), v('60 days'), v('45 days')),
    ];
    expect(await grid({ columns: three, rows })).toContain('1 term is the same in all 3 quotes.');
    const same = await grid({ columns: three, rows: rows.slice(0, 1) });
    expect(same).toContain('Every term is the same in all 3 quotes.');
    const pair = await grid({ columns: two, rows: [rowsTwo[1]] });
    expect(pair).toContain('Every term is the same in both quotes.');
  });

  it('draws a blank as the 30 px hatched square with its words, and an exclusion as the striped one', async () => {
    const html = await grid({ columns: two, rows: rowsTwo });
    expect(html).toContain('data-fill="hatched" data-size="30"');
    expect(html).toContain('<b>Not stated</b><small>Left blank. It is not zero.</small>');
    expect(html).toContain('data-fill="striped" data-size="30"');
    expect(html).toContain('<b>Excluded</b><small>Not part of the price.</small>');
    // Never a zero for a blank and never the stored word.
    expect(html).not.toContain('EXCLUDED');
    expect(html).not.toMatch(/>0<|>0\.00</);
  });

  it('keeps every amount as quoted, says so once, and never converts', async () => {
    const html = await grid({ columns: two, rows: rowsTwo });
    expect(html).toContain('USD 18,400.00');
    expect(html).toContain('CNY 9.00');
    expect(
      html.match(/Prices stay in the currency each supplier quoted\. We do not convert them\./g),
    ).toHaveLength(1);
    expect(html).not.toMatch(/exchange rate|equivalent|converted to|cheapest|lowest|best price/i);
  });

  it('says how shipping is excluded under the table, even when its row is folded', async () => {
    expect(await grid({ columns: two, rows: rowsTwo, shippingExcluded: 2 })).toContain(
      'Shipping: Excluded in both. Not part of the price.',
    );
    const three = [...two, column('c', 'Changzhou Spintech')];
    expect(await grid({ columns: three, rows: [], shippingExcluded: 3 })).toContain(
      'Shipping: Excluded in all 3 quotes. Not part of the price.',
    );
    expect(await grid({ columns: three, rows: [], shippingExcluded: 1 })).toContain(
      'Shipping: Excluded in 1 of 3 quotes. Not part of those prices.',
    );
    expect(await grid({ columns: two, rows: rowsTwo })).not.toContain('Shipping:');
  });

  it('with one quote has no control and says there is nothing to compare yet', async () => {
    const html = await grid({
      columns: two.slice(0, 1),
      rows: [row('Incoterm', false, v('FOB'))],
    });
    expect(html).not.toContain('Differences Only');
    expect(html).toContain('There is only one quote so far, so there is nothing to compare yet.');
    expect(html).toContain('1 quote · 1 comparable · 0 not comparable yet');
  });

  it('with three or more suppliers names them in a cue the scroll region points to, never a live region', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => column(`s${i}`, `Supplier ${i + 1}`));
    const html = await grid({ columns: ten, rows: [] });
    // Before the region is measured the cue line is there but says nothing, so it never claims a scroll that is not
    // there; the browser spec checks the words once measured.
    const id = /<p id="([^"]+)" class="compare-grid-cue"><\/p>/.exec(html);
    expect(id).not.toBeNull();
    // Nothing claims an edge before the measure either: no fade, no frozen edge shadow.
    expect(html).toContain('data-at-start="true" data-at-end="true" data-overflow="false"');
    expect(html).toContain(`aria-describedby="${id![1]}"`);
    expect(html).toContain('style="--cols:10"');
    // Two suppliers have no cue.
    expect(await grid({ columns: two, rows: rowsTwo })).not.toContain('compare-grid-cue');
  });

  it('marks its own words with their language when it sits in an English region', async () => {
    const html = await grid({ locale: 'ar', markLang: true, columns: two, rows: rowsTwo });
    expect(html).toContain(`lang="ar" dir="rtl">${catalogs.ar['compare.heading']}`);
    expect(html).toContain(catalogs.ar['compare.money']);
    // Arabic counts use the locale digits.
    expect(html).toContain(new Intl.NumberFormat('ar').format(2));
  });
});
