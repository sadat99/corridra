import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The shared show-more list: the first few items show, the rest stay in the page behind "Show all N",
// and a rule that gives the item its own display cannot show a folded item. Fixture page, no server.
const fixturePath = '/__show-more-fixture';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { ShowMoreList } from ${JSON.stringify(resolve('apps/web/components/ux/show-more.tsx'))};
        const items = Array.from({ length: 11 }, (_, i) => <li key={i} className="card"><span>Gap {i + 1}</span><input aria-label={'Note ' + (i + 1)} /></li>);
        createRoot(document.getElementById('app')).render(
          <main className="ux-owner"><h1>Open gaps</h1><ShowMoreList limit={4} noun="open gaps" className="cards">{items}</ShowMoreList></main>,
        );`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const css = ['app/globals.css', 'components/ux/show-more.css']
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  // A rule as strong as the owner register's (.ux-owner .owner-gap-cards li): the item sets its own display with
  // more specificity than the folding rule, which must still not defeat "hidden".
  const own = '.ux-owner .cards li { display: grid; gap: 4px; padding: 8px; }';
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Show more fixture</title><style>${css}${own}</style></head><body><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width = 1280) {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: 800 });
  await page.goto(fixturePath);
  await expect(page.getByRole('heading', { name: 'Open gaps' })).toBeVisible();
}

test('the first four show, the rest stay in the page folded', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('listitem')).toHaveCount(4);
  await expect(page.getByText('Gap 4', { exact: true })).toBeVisible();
  await expect(page.getByText('Gap 5', { exact: true })).toBeHidden();
  // Folded items are still in the page, even though the item sets its own display.
  await expect(page.locator('li.card')).toHaveCount(11);
  await expect(page.getByRole('button', { name: 'Show all 11 open gaps' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('Show all opens every item and Show the first four folds them again', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Show all 11 open gaps' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(11);
  await expect(page.getByRole('button', { name: 'Show the first 4 open gaps' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: 'Show the first 4 open gaps' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(4);
});

test('an entry in a folded item survives a fold and the button has a 44 px target', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Show all 11 open gaps' }).click();
  await page.getByLabel('Note 9').fill('half written');
  await page.getByRole('button', { name: 'Show the first 4 open gaps' }).click();
  await page.getByRole('button', { name: 'Show all 11 open gaps' }).click();
  await expect(page.getByLabel('Note 9')).toHaveValue('half written');
  expect(
    (await page.getByRole('button', { name: /^Show / }).boundingBox())?.height ?? 0,
  ).toBeGreaterThanOrEqual(44);
});

test('axe finds nothing folded or open, and a phone does not scroll sideways', async ({ page }) => {
  await open(page, 390);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Show all 11 open gaps' }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
