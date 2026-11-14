import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// UI/UX.v3 audit A3e: the All Tools finder with JavaScript switched off in a real browser (browser context
// javaScriptEnabled: false). A GET form is the only way a search or a group can reach the server then, so this drives
// the real form: the Find button that only shows when scripts are off, the group chips (real radio inputs) and the
// Clear Search button, and loads ?q= and ?group= addresses directly.
//
// What the fixture route is: the real AllToolsFinder, WorkspaceShell and stylesheets, rendered on the server per
// request (react-dom/server) from the address, answering the real path /account/all-tools. The two reads of the
// address copy app/account/all-tools/page.tsx (first value, q cut at 80 characters, group passed on as a word).
// What it proves: the markup the server sends for a q or group address filters correctly, and the form in that
// markup (field names, action, noscript Find button, radios, Clear Search) makes a plain GET in Chromium that lands
// on the filtered or the cleared page, with no script to help. What it does not prove: the Next page itself, its
// sign-in, or the CORRIDRA_UX_NAV switch (a signed-in route needs the database; tests/integration/audit-a3a-screens.test.ts
// reads page.tsx for searchParams and the finder, and the finder's own client filter is in audit-a3a-all-tools.spec.ts).
const path = '/account/all-tools';
let renderPage: (search: string) => string = () => '';
let css = '';

test.use({ javaScriptEnabled: false });

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { renderToString } from 'react-dom/server';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { pageFrameSlots } from ${JSON.stringify(resolve('apps/web/components/ux/page-frame.tsx'))};
        import { AllToolsFinder } from ${JSON.stringify(resolve('apps/web/app/account/all-tools/all-tools-finder.tsx'))};
        import { tools } from ${JSON.stringify(resolve('apps/web/lib/all-tools.ts'))};
        const word = (value) => value ?? '';
        export function renderPage(search) {
          const query = new URLSearchParams(search);
          const slots = pageFrameSlots({ helper: 'Search by name, or pick a group. Every page you can open is here.' });
          return renderToString(
            <WorkspaceShell title="Every tool you can open." customer above={slots.above} lead={slots.lead}>
              <AllToolsFinder
                tools={tools.map(({ href, label, line, group }) => ({ href, label, line, group }))}
                initialQuery={word(query.get('q')).slice(0, 80)}
                initialGroup={word(query.get('group'))}
              />
            </WorkspaceShell>);
        }`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const loaded = { exports: {} as { renderPage: (search: string) => string } };
  new Function('module', 'exports', 'require', bundle.outputFiles[0]!.text)(
    loaded,
    loaded.exports,
    createRequire(resolve('package.json')),
  );
  renderPage = loaded.exports.renderPage;
  css = [
    'app/globals.css',
    'components/ux/shells.css',
    'components/ux/page-frame.css',
    'components/ux/segmented-filter.css',
    'app/account/all-tools/all-tools.css',
  ]
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
});

async function open(page: Page, width: number, search = '') {
  await page.route('**' + path + '**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>All Tools no-script fixture</title><style>${css}</style></head><body><div class="site-shell">${renderPage(url.search)}</div></body></html>`,
    });
  });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.goto(`${path}${search}`);
  await expect(page.locator('h1')).toHaveText('Every tool you can open.');
}
const toolLinks = (page: Page) => page.locator('.ux-tools-grid a');
const status = (page: Page) => page.locator('.ux-tools-status');
const search = (page: Page) => page.getByRole('searchbox', { name: 'Find a tool' });

for (const width of [390, 768, 1440]) {
  test.describe(`${width} px, scripts off`, () => {
    test('scripts really are off: the Find button, which only shows then, is on the page', async ({
      page,
    }) => {
      await open(page, width);
      await expect(page.getByRole('button', { name: 'Find', exact: true })).toBeVisible();
    });

    test('with no search all sixteen tools are on the page and visible, every group open', async ({
      page,
    }) => {
      await open(page, width);
      await expect(toolLinks(page)).toHaveCount(16);
      for (const link of await toolLinks(page).all()) await expect(link).toBeVisible();
      await expect(status(page)).toHaveText('');
      await expect(page.getByRole('button', { name: 'Clear Search' })).toHaveCount(0);
    });

    test('an address with ?q= filters by name, and the search box shows the word', async ({
      page,
    }) => {
      await open(page, width, '?q=billing');
      await expect(toolLinks(page)).toHaveCount(1);
      await expect(page.getByRole('link', { name: /See your plan and billing/ })).toBeVisible();
      await expect(search(page)).toHaveValue('billing');
      await expect(status(page)).toHaveText('Showing 1 of 16 tools.');
    });

    test('an address with ?group= filters by group, and the chip for it is chosen', async ({
      page,
    }) => {
      await open(page, width, '?group=missions');
      await expect(page.getByRole('radio', { name: /^Requests/ })).toBeChecked();
      await expect(toolLinks(page)).toHaveCount(4);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Requests (4)']);
      await expect(status(page)).toHaveText('Showing 4 of 16 tools.');
    });

    test('a search and a group together, and an unknown group means all', async ({ page }) => {
      await open(page, width, '?group=missions&q=delegation');
      await expect(toolLinks(page)).toHaveCount(2);
      await open(page, width, '?group=nope');
      await expect(toolLinks(page)).toHaveCount(16);
    });

    test('typing a word and pressing Find loads ?q= and shows the matches', async ({ page }) => {
      await open(page, width);
      await search(page).fill('billing');
      await page.getByRole('button', { name: 'Find', exact: true }).click();
      await expect(page).toHaveURL(/\/account\/all-tools\?q=billing&group=all$/);
      await expect(toolLinks(page)).toHaveCount(1);
      await expect(search(page)).toHaveValue('billing');
    });

    test('choosing a group chip and pressing Find loads ?group= and shows that group', async ({
      page,
    }) => {
      await open(page, width);
      await page.getByRole('radio', { name: /^Requests/ }).check({ force: true });
      await page.getByRole('button', { name: 'Find', exact: true }).click();
      await expect(page).toHaveURL(/\/account\/all-tools\?q=&group=missions$/);
      await expect(page.getByRole('radio', { name: /^Requests/ })).toBeChecked();
      await expect(toolLinks(page)).toHaveCount(4);
    });

    test('a word that matches nothing says so, and Clear Search brings all sixteen back', async ({
      page,
    }) => {
      await open(page, width, '?q=zzzz');
      await expect(toolLinks(page)).toHaveCount(0);
      await expect(status(page)).toContainText('No tool matches');
      await expect(status(page)).toContainText('zzzz');
      const clear = page.getByRole('button', { name: 'Clear Search' });
      await expect(clear).toBeVisible();
      await clear.click();
      await expect(page).not.toHaveURL(/q=zzzz/);
      await expect(toolLinks(page)).toHaveCount(16);
      await expect(search(page)).toHaveValue('');
      await expect(status(page)).toHaveText('');
    });

    test('Clear Search also undoes a chosen group', async ({ page }) => {
      await open(page, width, '?group=library&q=a');
      await expect(page.getByRole('radio', { name: /^Library/ })).toBeChecked();
      await page.getByRole('button', { name: 'Clear Search' }).click();
      await expect(page.getByRole('radio', { name: /^All/ })).toBeChecked();
      await expect(toolLinks(page)).toHaveCount(16);
    });

    test('every tool opens by its own name: the search for each label finds that tool', async ({
      page,
    }) => {
      await open(page, width);
      const labels = await toolLinks(page).locator('strong').allTextContents();
      expect(labels).toHaveLength(16);
      for (const label of labels) {
        await open(page, width, `?q=${encodeURIComponent(label)}`);
        await expect(
          page.locator('.ux-tools-grid a', { has: page.locator('strong', { hasText: label }) }),
        ).not.toHaveCount(0);
      }
    });
  });
}
