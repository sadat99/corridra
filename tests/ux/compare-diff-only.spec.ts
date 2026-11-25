import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// CMP1 (17 November 2026), V3-04-077: the Compare lens differences-only control, on the shared comparison table since
// UI/UX.v4 row "Compare" (20 November 2026). Own esbuild fixture, as mr-quote-terms.spec.ts, with the two sample
// offers (Lantern; 绿野 with lead time and payment not stated). The prices never fold, so 7 rows fold.
let script = '';
let styles = '';

const entry = `
import { createRoot } from 'react-dom/client';
import { CompareLens } from ${JSON.stringify(resolve('apps/web/components/compare-lens.tsx'))};

const same = [
  { label: 'Quoted specification', value: 'Auto cutter 2.5 m bed' },
  { label: 'Quantity', value: '2 unit' },
  { label: 'Offer valid until', value: '1 Jan 2099' },
  { label: 'Incoterm', value: 'FOB' },
  { label: 'Tooling', value: 'USD 0.00', money: true },
  { label: 'Setup', value: 'USD 0.00', money: true },
  { label: 'Packaging', value: 'USD 0.00', money: true },
];
const terms = (lead, pay) => [
  same[0], same[1],
  { label: 'Lead time', value: lead },
  same[2], same[3],
  { label: 'Shipping scope', value: null, state: 'excluded' },
  { label: 'Payment terms', value: pay },
  same[4], same[5], same[6],
  { label: 'Warranty', value: null },
];
const card = (id, supplier, revision, comparable, reason, lead, pay) => ({
  id, supplier, place: 'China', revision, currency: 'USD', unitPrice: 'USD 18,400.00', total: 'USD 36,800.00',
  comparable, reason, terms: terms(lead, pay), trust: 'Self-declared', provenance: 'x', historical: false,
});
const cards = [
  card('a', 'Lantern Cutting Works', 2, true, undefined, '45 days', '30% deposit, 70% before shipping'),
  card('b', '绿野机械有限公司', 3, false, 'Missing: Lead time, Payment terms.', null, null),
];
createRoot(document.getElementById('mount')).render(
  <main id="cmp-fixture" lang="en" className="ux-workspace ux-customer">
    <h1>Compare fixture</h1>
    <h2>Offers</h2>
    <h3>Original quotations and comparison</h3>
    <CompareLens cards={cards} matrix={<table><caption>Table</caption></table>} />
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

async function mount(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/plan');
  await expect(
    page.getByRole('button', { name: /^(Continue|Pick One to Continue)$/ }),
  ).toBeEnabled();
  await page.evaluate(
    ({ css }) => {
      document.body.innerHTML = '<div id="mount"></div>';
      document.body.className = '';
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    },
    { css: styles },
  );
  await page.addScriptTag({ content: 'window.process = { env: { NODE_ENV: "production" } };' });
  await page.addScriptTag({ content: script, type: 'module' });
  await page.waitForSelector('#cmp-fixture .compare-grid-table');
}

const height = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight);
const labels = (page: Page) => page.locator('.compare-grid-label').allTextContents();

for (const width of [320, 390]) {
  test(`differences-only is on, counted, 44 px and axe clean at ${width}px`, async ({ page }) => {
    await mount(page, width);
    const toggle = page.getByRole('button', { name: 'Differences Only', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.compare-grid-status')).toHaveText('7 terms are the same in both.');
    const box = (await toggle.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // The verdict, seal and engine reason stay visible, on top of each column.
    await expect(page.getByText('Comparable', { exact: true })).toBeVisible();
    await expect(page.getByText('Not comparable yet', { exact: true })).toBeVisible();
    await expect(page.getByText('Missing: Lead time, Payment terms.')).toBeVisible();
    const axe = await new AxeBuilder({ page }).include('#cmp-fixture').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

test('keyboard toggle folds and restores every row in the original order', async ({ page }) => {
  await mount(page, 390);
  const folded = await labels(page);
  expect(folded).not.toContain('Incoterm');
  expect(folded).toContain('Lead time');
  await page.getByRole('button', { name: 'Differences Only', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Differences Only' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('[role="status"].compare-grid-status')).toHaveText(
    'Showing every term',
  );
  await expect(page.getByRole('button', { name: 'Show Them' })).toHaveCount(0);
  const all = await labels(page);
  expect(all).toEqual([
    'Original unit price',
    'Original total',
    'Quoted specification',
    'Quantity',
    'Lead time',
    'Offer valid until',
    'Incoterm',
    'Shipping scope',
    'Payment terms',
    'Tooling',
    'Setup',
    'Packaging',
    'Warranty',
  ]);
  await page.keyboard.press('Space');
  await expect(page.locator('.compare-grid-status')).toContainText('7 terms');
  // The show control in the count line restores them too.
  await page.getByRole('button', { name: 'Show Them', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect(await labels(page)).toContain('Incoterm');
  // The button left with the fold: focus must land on the control that undoes it, never fall to the page.
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Differences Only');
  // One persistent live region: the same element carries both states.
  await expect(page.locator('[role="status"]')).toHaveCount(1);
});

test('no row leaves the content without the count line, and the page gets shorter', async ({
  page,
}) => {
  const lengths: Record<string, [number, number]> = {};
  for (const width of [390, 1440]) {
    await mount(page, width);
    const foldedHeight = await height(page);
    const foldedRows = (await labels(page)).length;
    await expect(page.locator('.compare-grid-status')).toContainText('7 terms');
    await page.getByRole('button', { name: 'Differences Only', exact: true }).click();
    const fullHeight = await height(page);
    const fullRows = (await labels(page)).length;
    expect(fullRows - foldedRows).toBe(7); // one table: the 7 rows the count names
    expect(foldedHeight).toBeLessThan(fullHeight);
    lengths[width] = [fullHeight, foldedHeight];
  }
  console.log(`page length (before, after): ${JSON.stringify(lengths)}`);
});
