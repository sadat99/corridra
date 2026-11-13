import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// L20: the closed disclosure used by the customer pages to stay inside the page budget
// (apps/web/app/account/fold.tsx). It is closed by default, keeps what is typed in it, opens by itself when asked, and
// opens when the address hash names it or an element inside it, so every old #id link still lands.
let bundle = '';
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {Fold} from ${JSON.stringify(resolve('apps/web/app/account/fold.tsx'))};
        const view=(forced)=>(<main><Fold summary="Programme details (2)" anchor="registration-1" open={forced}><label>Note <input id="note"/></label><p id="inside">Inside text</p></Fold><p id="after">After</p></main>);
        const root=createRoot(document.getElementById('fixture'));root.render(view(false));
        window.addEventListener('fixture-force',e=>root.render(view(e.detail)));`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  bundle = result.outputFiles[0].text;
});
async function mount(page: Page, hash = '') {
  await page.goto('about:blank');
  await page.setContent('<div id="fixture"></div>');
  if (hash) await page.evaluate((h) => history.replaceState(null, '', h), hash);
  await page.addScriptTag({ content: bundle });
}
const details = (page: Page) => page.locator('details.account-fold');

test('it is closed with its count in the summary and its content is still in the page', async ({
  page,
}) => {
  await mount(page);
  await expect(details(page)).not.toHaveAttribute('open', '');
  await expect(page.getByText('Programme details (2)')).toBeVisible();
  await expect(page.locator('#inside')).toBeHidden();
  expect(await page.locator('#inside').count()).toBe(1);
});
test('a typed value survives closing and opening it again', async ({ page }) => {
  await mount(page);
  await page.getByText('Programme details (2)').click();
  await page.locator('#note').fill('kept');
  await page.getByText('Programme details (2)').click();
  await expect(page.locator('#note')).toBeHidden();
  await page.getByText('Programme details (2)').click();
  await expect(page.locator('#note')).toHaveValue('kept');
});
test('it opens by itself when asked to', async ({ page }) => {
  await mount(page);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('fixture-force', { detail: true })),
  );
  await expect(page.locator('#inside')).toBeVisible();
});
test('an old link to its anchor or to an element inside it opens it', async ({ page }) => {
  await mount(page, '/#registration-1');
  await expect(page.locator('#inside')).toBeVisible();
  await mount(page);
  await expect(page.locator('#inside')).toBeHidden();
  await page.evaluate(() => {
    location.hash = '#inside';
  });
  await expect(page.locator('#inside')).toBeVisible();
});
