import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// The shared comparison table (UI/UX.v4 row "Compare", owner approval of 20 November 2026): with more than two
// suppliers the table scrolls sideways inside its own region and the row label column stays frozen, so any number
// of suppliers can be checked. Own esbuild fixture, as compare-diff-only.spec.ts; the page tokens come from /plan.
// Every name and figure is invented sample data.
let script = '';
let styles = '';

const entry = `
import { createRoot } from 'react-dom/client';
import { CompareGrid } from ${JSON.stringify(resolve('apps/web/components/ux/compare-grid.tsx'))};

const { count, locale, dir } = window.__cmp;
const names = [
  'Lantern Cutting Works',
  '绿野机械有限公司（青岛）自动裁床事业部',
  'Changzhou Spintech Precision Machinery Company Limited',
  'Shaoxing Weaving',
  'Ningbo Tools',
  'شركة الخليج للآلات الصناعية',
  'Dhaka Garment Systems',
  'Foshan Cutters',
  'Suzhou Line',
  'Hangzhou Frames',
];
const columns = Array.from({ length: count }, (_, i) => ({
  id: 's' + i,
  supplier: names[i],
  supplierLang: /\\p{Script=Han}/u.test(names[i]) ? 'zh' : /\\p{Script=Arabic}/u.test(names[i]) ? 'ar' : undefined,
  place: 'China',
  revision: i + 1,
  currency: i % 3 === 1 ? 'CNY' : 'USD',
  trust: ['Self-declared', 'Evidence available', 'Verified'][i % 3],
  comparable: i % 2 === 0,
  reason: i % 2 === 0 ? undefined : 'Missing: Lead time, Payment terms.',
}));
const cells = (f) => columns.map((c, i) => f(c, i));
const rows = [
  { label: 'Original unit price', same: false, cells: cells((c, i) => ({ value: c.currency + ' ' + (18400 + i * 125).toLocaleString('en') + '.00', money: true })) },
  { label: 'Original total', same: false, cells: cells((c, i) => (i === 2 ? { value: null } : { value: c.currency + ' ' + (36800 + i * 250).toLocaleString('en') + '.00', sub: 'For 2 unit', money: true })) },
  { label: 'Quoted specification', same: count > 1, cells: cells(() => ({ value: 'Auto cutter 2.5 m bed' })) },
  { label: 'Commissioning', same: false, cells: cells((c, i) => ({ value: i % 2 ? null : 'Two engineers for five days' })) },
  { label: 'Minimum order quantity', same: false, cells: cells((c, i) => ({ value: i % 2 ? null : '1 set' })) },
  { label: 'Lead time', same: false, cells: cells((c, i) => ({ value: i % 2 ? null : 45 + i + ' days' })) },
  { label: 'Incoterm', same: count > 1, cells: cells(() => ({ value: 'FOB' })) },
  { label: 'Shipping scope', same: false, cells: cells(() => ({ value: 'EXCLUDED', excluded: true })) },
  { label: 'Payment terms', same: false, cells: cells((c, i) => ({ value: i % 2 ? null : '30% deposit, 70% before shipping' })) },
];
createRoot(document.getElementById('mount')).render(
  <main id="cmp-grid-fixture" lang={locale} dir={dir} className="ux-workspace ux-customer">
    <h1>Compare fixture</h1>
    <CompareGrid locale={locale} columns={columns} rows={rows} shippingExcluded={count} />
  </main>,
);
`;

test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: resolve('apps/web') },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    external: ['/flags/*'],
    write: false,
    outdir: 'out',
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'css' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  script = result.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
  styles = result.outputFiles.find((f) => f.path.endsWith('.css'))!.text;
});

async function mount(
  page: Page,
  width: number,
  count: number,
  { locale = 'en', dir = 'ltr' }: { locale?: string; dir?: 'ltr' | 'rtl' } = {},
) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/plan');
  await expect(
    page.getByRole('button', { name: /^(Continue|Pick One to Continue)$/ }),
  ).toBeEnabled();
  await page.evaluate(
    ({ css, cmp }) => {
      document.body.innerHTML = '<div id="mount"></div>';
      document.body.className = '';
      (window as unknown as { __cmp: unknown }).__cmp = cmp;
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    },
    { css: styles, cmp: { count, locale, dir } },
  );
  await page.addScriptTag({ content: 'window.process = { env: { NODE_ENV: "production" } };' });
  await page.addScriptTag({ content: script, type: 'module' });
  await page.waitForSelector('#cmp-grid-fixture .compare-grid-table');
}

const scroller = (page: Page) => page.locator('.compare-grid-scroll');
const rect = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
    });
const shots = process.env.COMPARE_SHOTS_DIR;

for (const width of [320, 390, 768, 1440])
  for (const count of [2, 3, 10])
    test(`${count} suppliers at ${width}px: no page overflow, labels whole, a supplier in view, axe clean`, async ({
      page,
    }) => {
      await mount(page, width, count);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      // Row labels wrap and are never cut: no label is wider inside than its box, and none uses an ellipsis.
      const cut = await page.$$eval('.compare-grid-label, .compare-grid-head > b', (els) =>
        els
          .filter(
            (el) =>
              el.scrollWidth > el.clientWidth + 1 ||
              getComputedStyle(el).textOverflow === 'ellipsis',
          )
          .map((el) => el.textContent),
      );
      expect(cut).toEqual([]);
      // At least one whole supplier column is in view next to the frozen labels.
      const box = await rect(page, '.compare-grid-scroll');
      const first = await rect(page, '.compare-grid-head');
      expect(first.right).toBeLessThanOrEqual(box.right + 1);
      expect(first.width).toBeGreaterThanOrEqual(8 * 16 - 1);
      // Two suppliers always fit side by side, from 320 up (row by row on a phone); ten scroll inside the region.
      const overflow = await scroller(page).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      if (count === 2) expect(overflow).toBe(false);
      if (count === 10) expect(overflow).toBe(true);
      // No word the comparison writes is broken across two lines: labels, verdicts, trust labels, blanks and values
      // wrap at spaces (or after a hyphen that is in the word). Supplier names are data and not checked here.
      const broken = await page.$$eval(
        '.compare-grid-label, .compare-grid-verdict, .compare-grid-head > .guide-tag, .compare-grid-blank, .compare-grid-value, .compare-grid-head > small',
        (els) => {
          const out: string[] = [];
          for (const el of els) {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
              const text = node.textContent ?? '';
              for (const match of text.matchAll(/[^\s-]+-?/g)) {
                const range = document.createRange();
                range.setStart(node, match.index!);
                range.setEnd(node, match.index! + match[0].length);
                const lines = new Set(
                  Array.from(range.getClientRects())
                    .filter((r) => r.width > 0)
                    .map((r) => Math.round(r.top)),
                );
                if (lines.size > 1) out.push(match[0]);
              }
            }
          }
          return out;
        },
      );
      expect(broken).toEqual([]);
      // Every control is a 44 px target.
      for (const name of ['Differences Only', 'Show Them']) {
        const b = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
        expect(b.height, name).toBeGreaterThanOrEqual(44);
      }
      // Nothing is smaller than 12 px.
      const tiny = await page.$$eval('#cmp-grid-fixture *', (els) =>
        els
          .filter((el) => el.childNodes.length && (el.textContent ?? '').trim())
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
          .map((el) => el.tagName),
      );
      expect(tiny).toEqual([]);
      const axe = await new AxeBuilder({ page }).include('#cmp-grid-fixture').analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      if (shots)
        await page.screenshot({ path: `${shots}/compare-${count}-${width}.png`, fullPage: true });
    });

test('the row labels stay frozen while the suppliers scroll, with a shadow only once scrolled', async ({
  page,
}) => {
  await mount(page, 390, 10);
  const before = await rect(page, '.compare-grid-label');
  const corner = await rect(page, '.compare-grid-corner');
  await expect(page.locator('.compare-grid')).toHaveAttribute('data-at-start', 'true');
  expect(
    await page
      .locator('.compare-grid-label')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow),
  ).toBe('none');
  await expect(page.locator('.compare-grid-cue')).toHaveText(
    '10 suppliers. Scroll sideways to see them all.',
  );
  await scroller(page).evaluate((el) => el.scrollTo({ left: 400 }));
  await expect(page.locator('.compare-grid')).toHaveAttribute('data-at-start', 'false');
  expect(await rect(page, '.compare-grid-label')).toEqual(before);
  expect(await rect(page, '.compare-grid-corner')).toEqual(corner);
  expect(
    await page
      .locator('.compare-grid-label')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow),
  ).not.toBe('none');
  // The first supplier has gone under the frozen column, not over it.
  const head = await rect(page, '.compare-grid-head');
  expect(head.left).toBeLessThan(before.right);
  if (shots)
    await page.screenshot({ path: `${shots}/compare-10-390-scrolled.png`, fullPage: true });
  const top = (await rect(page, '.compare-grid-scroll')).top;
  await scroller(page).evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(page.locator('.compare-grid-cue')).toHaveText('You have seen all 10 suppliers.');
  // The cue line keeps its height, so the table does not move when its words change.
  expect((await rect(page, '.compare-grid-scroll')).top).toBe(top);
});

test('right to left: the frozen column sits on the right and stays there while scrolling', async ({
  page,
}) => {
  await mount(page, 320, 10, { locale: 'ar', dir: 'rtl' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const box = await rect(page, '.compare-grid-scroll');
  const before = await rect(page, '.compare-grid-label');
  expect(Math.abs(before.right - box.right)).toBeLessThanOrEqual(2);
  await scroller(page).evaluate((el) => el.scrollTo({ left: -400 }));
  await expect(page.locator('.compare-grid')).toHaveAttribute('data-at-start', 'false');
  expect(await rect(page, '.compare-grid-label')).toEqual(before);
  // Arabic counts in Arabic digits.
  await expect(page.locator('.compare-grid-summary')).toContainText(
    new Intl.NumberFormat('ar').format(10),
  );
  const axe = await new AxeBuilder({ page }).include('#cmp-grid-fixture').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  if (shots) await page.screenshot({ path: `${shots}/compare-10-320-ar.png`, fullPage: true });
});

test('keyboard: Differences Only, Show Them, then the region, each with a visible focus ring', async ({
  page,
}) => {
  await mount(page, 390, 3);
  const toggle = page.getByRole('button', { name: 'Differences Only', exact: true });
  await toggle.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show Them', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const region = page.getByRole('region', { name: 'Quotes side by side' });
  await expect(region).toBeFocused();
  // The ring is drawn around the frame, outside the frozen column and the fade, on all four edges.
  const frame = page.locator('.compare-grid-frame');
  expect(await frame.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe('3px');
  expect(await frame.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  expect(
    Number.parseFloat(await frame.evaluate((el) => getComputedStyle(el).outlineOffset)),
  ).toBeGreaterThan(0);
  await expect(region).toHaveAttribute('aria-describedby', /.+/);
  // The arrow keys scroll the region.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test('Show Them unfolds the rows and hands focus back to Differences Only', async ({ page }) => {
  await mount(page, 390, 3);
  const status = page.locator('[role="status"].compare-grid-status');
  await expect(status).toHaveText('2 terms are the same in all 3 quotes.');
  const labels = () => page.locator('.compare-grid-label').allTextContents();
  expect(await labels()).not.toContain('Incoterm');
  await page.getByRole('button', { name: 'Show Them', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect(await labels()).toContain('Incoterm');
  await expect(page.getByRole('button', { name: 'Differences Only', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Differences Only' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(status).toHaveText('Showing every term');
  await expect(page.locator('[role="status"]')).toHaveCount(1);
});

test('forced colours: the frozen column keeps an opaque system background and a real edge, no fade', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await mount(page, 390, 10);
  const label = page.locator('.compare-grid-label').first();
  expect(await label.evaluate((el) => getComputedStyle(el).borderInlineEndWidth)).toBe('1px');
  expect(await label.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  expect(
    await page
      .locator('.compare-grid-frame')
      .evaluate((el) => getComputedStyle(el, '::after').display),
  ).toBe('none');
  // The hatched and striped squares stay drawn in system colours.
  const fills = await page.$$eval('.mr-quote-fill', (els) =>
    els.map((el) => getComputedStyle(el).backgroundImage),
  );
  expect(fills.length).toBeGreaterThan(0);
  for (const image of fills) expect(image).toContain('gradient');
  await scroller(page).evaluate((el) => el.scrollTo({ left: 400 }));
  await expect(page.locator('.compare-grid')).toHaveAttribute('data-at-start', 'false');
  expect(await label.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  if (shots) await page.screenshot({ path: `${shots}/compare-10-390-forced.png`, fullPage: true });
});

test('reduced motion: nothing in the comparison moves or scrolls smoothly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page, 390, 10);
  const moving = await page.$$eval('#cmp-grid-fixture *', (els) =>
    els
      .filter((el) => {
        const s = getComputedStyle(el);
        return (
          // The global reduced motion rule leaves 0.01 ms, which is not motion.
          parseFloat(s.transitionDuration) > 0.001 ||
          parseFloat(s.animationDuration) > 0.001 ||
          s.scrollBehavior === 'smooth'
        );
      })
      .map((el) => el.className),
  );
  expect(moving).toEqual([]);
});

test('two suppliers on a phone: each term is a band over the two values, still a table, and wide screens keep columns', async ({
  page,
}) => {
  await mount(page, 320, 2);
  const label = await rect(page, '.compare-grid-label');
  const cell = await rect(page, '.compare-grid-table tbody td');
  // The label band sits above the values and is as wide as the table.
  expect(cell.top).toBeGreaterThanOrEqual(label.top + label.height - 1);
  expect(label.width).toBeGreaterThan(250);
  await expect(page.getByRole('table')).toHaveCount(1);
  await expect(page.getByRole('rowheader', { name: 'Commissioning', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Terms', exact: true })).toHaveCount(1);
  if (shots) await page.screenshot({ path: `${shots}/compare-2-320-stacked-detail.png` });
  await mount(page, 768, 2);
  const wide = await rect(page, '.compare-grid-label');
  const wideCell = await rect(page, '.compare-grid-table tbody td');
  expect(Math.round(wideCell.top)).toBe(Math.round(wide.top));
});

test('the scroll cue follows the measured width: it speaks once measured and updates when the region widens', async ({
  page,
}) => {
  await mount(page, 390, 10);
  // Once measured the cue speaks; the region was watched with a ResizeObserver, so a width change updates it.
  await expect(page.locator('.compare-grid-cue')).toHaveText(
    '10 suppliers. Scroll sideways to see them all.',
  );
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    main.style.inlineSize = '200rem';
  });
  await expect(page.locator('.compare-grid-cue')).toHaveText('You have seen all 10 suppliers.');
});

test('a column header is named by the supplier alone and described by its verdict', async ({
  page,
}) => {
  await mount(page, 1440, 6);
  // Comparable, then not comparable (a Chinese name, language kept), and an Arabic name.
  await expect(
    page.getByRole('columnheader', { name: 'Lantern Cutting Works', exact: true }),
  ).toBeVisible();
  const zh = page.getByRole('columnheader', {
    name: '绿野机械有限公司（青岛）自动裁床事业部',
    exact: true,
  });
  await expect(zh).toBeVisible();
  await expect(zh).toHaveAccessibleDescription(/Not comparable yet/);
  await expect(zh.locator('b')).toHaveAttribute('lang', 'zh');
  const ar = page.getByRole('columnheader', { name: 'شركة الخليج للآلات الصناعية', exact: true });
  await expect(ar).toBeVisible();
  await expect(ar.locator('b')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('columnheader', { name: 'Terms', exact: true })).toHaveCount(1);
  const ids = await page.$$eval('.compare-grid-head [id]', (els) => els.map((el) => el.id));
  expect(new Set(ids).size).toBe(ids.length);
});

test('two suppliers on a phone: no divider between the two supplier columns, the outer border stays', async ({
  page,
}) => {
  await mount(page, 320, 2);
  const heads = page.locator('.compare-grid-head');
  await expect(heads).toHaveCount(2);
  const border = await heads.nth(1).evaluate((el) => getComputedStyle(el).borderInlineStartWidth);
  expect(border).toBe('0px');
  const table = await page
    .locator('.compare-grid-table')
    .evaluate((el) => getComputedStyle(el).borderInlineStartWidth);
  expect(table).toBe('1px');
  await mount(page, 320, 2, { locale: 'ar', dir: 'rtl' });
  expect(
    await page
      .locator('.compare-grid-head')
      .nth(1)
      .evaluate((el) => getComputedStyle(el).borderInlineStartWidth),
  ).toBe('0px');
});

for (const width of [320, 390])
  for (const count of [3, 10])
    test(`large text, ${count} suppliers at ${width}px: no page overflow, the label column stays within 40 percent or 128px, the head is not clipped`, async ({
      page,
    }) => {
      await mount(page, width, count);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const region = await rect(page, '.compare-grid-scroll');
      const label = await rect(page, '.compare-grid-label');
      expect(label.width).toBeLessThanOrEqual(Math.max(region.width * 0.4, 128) + 1);
      const clipped = await page.$$eval('.compare-grid-head', (els) =>
        els.filter((el) => el.scrollHeight > el.clientHeight + 1).map((el) => el.textContent),
      );
      expect(clipped).toEqual([]);
    });
