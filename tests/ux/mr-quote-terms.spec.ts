import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { translate } from '../../apps/web/lib/i18n/messages';

// Visual grammar PR 2 (17 November 2026): the quote card's term bars. A term the supplier left blank is
// the hatched fill and says "Not stated"; shipping the price leaves out is the striped fill and says
// "Excluded". Each keeps its visible word, opens its one sentence on keyboard focus, is at least 44 px,
// passes axe and does not animate under reduced motion. Own esbuild fixture, as mr-explain.spec.ts.

const say = (key: Parameters<typeof translate>[1]) => translate('en', key);
let script = '';
let styles = '';

const entry = `
import { createRoot } from 'react-dom/client';
import { QuoteCard } from ${JSON.stringify(resolve('apps/web/components/mr/index.ts'))};

const terms = [
  { label: 'Lead time', value: '45 days' },
  { label: 'Installation', value: null },
  { label: 'Shipping scope', value: null, state: 'excluded' },
];
function App() {
  return (
    <main id="mr-quote-fixture" lang="en" className="ux-workspace ux-customer">
      <h1>Quote terms fixture</h1>
      <div style={{ maxInlineSize: '20rem' }}>
        <QuoteCard supplier="Lantern Cutting Works" revision={2} currency="USD" comparable={false} reason="Missing: Installation" terms={terms} />
      </div>
    </main>
  );
}
createRoot(document.getElementById('mount')).render(<App />);
`;

test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: resolve('apps/web') },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
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
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
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
  await page.waitForSelector('#mr-quote-fixture .mr-explain');
  await expect(page.locator('.mr-explain').first()).toHaveAttribute('data-js', '');
}

const hint = (page: Page, word: string) =>
  page
    .locator('.mr-explain')
    .filter({ has: page.getByRole('button', { name: word, exact: true }) });

for (const width of [320, 1440]) {
  test(`term bars draw the grammar's fills with their words at ${width}px`, async ({ page }) => {
    await mount(page, width);
    // The visible words: never colour alone, never the raw stored word.
    await expect(page.getByRole('button', { name: 'Not stated', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Excluded', exact: true })).toBeVisible();
    await expect(page.locator('#mr-quote-fixture')).not.toContainText('EXCLUDED');
    await expect(hint(page, 'Not stated').locator('.mr-quote-fill')).toHaveAttribute(
      'data-fill',
      'hatched',
    );
    await expect(hint(page, 'Excluded').locator('.mr-quote-fill')).toHaveAttribute(
      'data-fill',
      'striped',
    );
    // The two fills are drawn differently (a different background image), not one fill twice.
    const images = await page.$$eval('.mr-quote-fill', (els) =>
      els.map((el) => getComputedStyle(el).backgroundImage),
    );
    expect(images).toHaveLength(2);
    for (const image of images) expect(image).toContain('gradient');
    expect(images[0]).not.toBe(images[1]);
    // 44 px targets.
    for (const word of ['Not stated', 'Excluded']) {
      const box = (await page.getByRole('button', { name: word, exact: true }).boundingBox())!;
      expect(box.height, word).toBeGreaterThanOrEqual(44);
      expect(box.width, word).toBeGreaterThanOrEqual(44);
    }
    // No sideways scroll on the card.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const axe = await new AxeBuilder({ page }).include('#mr-quote-fixture').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

test('keyboard focus opens each term sentence and Escape closes it', async ({ page }) => {
  await mount(page, 390);
  for (const [word, sentence] of [
    ['Not stated', say('mr.explain.fill.notStated')],
    ['Excluded', say('mr.explain.fill.excluded')],
  ] as const) {
    await page.getByRole('button', { name: word, exact: true }).focus();
    await expect(hint(page, word).getByRole('tooltip')).toBeVisible();
    await expect(hint(page, word).getByRole('tooltip')).toContainText(sentence);
    await page.keyboard.press('Escape');
    await expect(hint(page, word).getByRole('tooltip')).toBeHidden();
  }
});

test('reduced motion: the fills and the hint do not animate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page, 1440);
  const durations = await page.$$eval('.mr-quote-fill, .mr-explain-pop', (els) =>
    els.map((el) => getComputedStyle(el).transitionDuration),
  );
  for (const duration of durations) expect(duration).toMatch(/^0s(, 0s)*$/);
});
