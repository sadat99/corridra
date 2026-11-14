import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v3 audit, screens batch A: the All Tools finder (search box and group chips), drawn with the real component and
// the real stylesheets on a small bundled page (no server data, no sign-in), at the owner's three widths. Every case
// fails on the code before this change: the finder does not exist there, so there is no search box and no chip.
// The same words reach the server as a plain GET when a script cannot run (tests/integration/audit-a3a-screens.test.ts).
const fixturePath = '/__audit-a3a-all-tools-fixture';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { pageFrameSlots } from ${JSON.stringify(resolve('apps/web/components/ux/page-frame.tsx'))};
        import { AllToolsFinder } from ${JSON.stringify(resolve('apps/web/app/account/all-tools/all-tools-finder.tsx'))};
        import { tools } from ${JSON.stringify(resolve('apps/web/lib/all-tools.ts'))};
        const query = new URLSearchParams(location.search);
        const slots = pageFrameSlots({ helper: 'Search by name, or pick a group. Every page you can open is here.' });
        createRoot(document.getElementById('app')).render(
          <WorkspaceShell title="Every tool you can open." customer above={slots.above} lead={slots.lead}>
            <AllToolsFinder
              tools={tools.map(({ href, label, line, group }) => ({ href, label, line, group }))}
              initialQuery={query.get('q') ?? ''}
              initialGroup={query.get('group') ?? 'all'}
            />
          </WorkspaceShell>);`,
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
  const css = [
    'app/globals.css',
    'components/ux/shells.css',
    'components/ux/page-frame.css',
    'components/ux/segmented-filter.css',
    'app/account/all-tools/all-tools.css',
  ]
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>All Tools fixture</title><style>${css}</style></head><body><div class="site-shell"><div id="app"></div></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, search = '') {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.goto(`${fixturePath}${search}`);
  await expect(page.locator('h1')).toHaveText('Every tool you can open.');
}
const toolLinks = (page: Page) => page.locator('.ux-tools-grid a');

for (const width of [390, 768, 1440]) {
  test.describe(`${width} px`, () => {
    test('all sixteen tools are reachable: on the page by default, and each by its own search', async ({
      page,
    }) => {
      await open(page, width);
      await expect(toolLinks(page)).toHaveCount(16);
      const search = page.getByRole('searchbox', { name: 'Find a tool' });
      const labels = await toolLinks(page).locator('strong').allTextContents();
      expect(labels).toHaveLength(16);
      for (const label of labels) {
        await search.fill(label);
        await expect(
          page.locator('.ux-tools-grid a', { has: page.locator('strong', { hasText: label }) }),
        ).not.toHaveCount(0);
      }
    });

    test('typing narrows the list at once, says how many of sixteen are shown, and Clear Search brings them all back', async ({
      page,
    }) => {
      await open(page, width);
      const search = page.getByRole('searchbox', { name: 'Find a tool' });
      await search.fill('billing');
      await expect(toolLinks(page)).toHaveCount(1);
      await expect(page.getByRole('link', { name: /See your plan and billing/ })).toBeVisible();
      await expect(page.locator('.ux-tools-status')).toHaveText('Showing 1 of 16 tools.');
      expect(page.url()).toContain('q=billing');
      await page.getByRole('button', { name: 'Clear Search' }).click();
      await expect(toolLinks(page)).toHaveCount(16);
      await expect(search).toHaveValue('');
      expect(page.url()).not.toContain('q=');
    });

    test('a search with no match says so and offers the way back; nothing is lost', async ({
      page,
    }) => {
      await open(page, width);
      await page.getByRole('searchbox', { name: 'Find a tool' }).fill('zzzz');
      await expect(toolLinks(page)).toHaveCount(0);
      await expect(page.locator('.ux-tools-status')).toContainText('No tool matches');
      await page.getByRole('button', { name: 'Clear Search' }).click();
      await expect(toolLinks(page)).toHaveCount(16);
    });

    test('the group chips work from the keyboard (arrow keys), one group at a time, with the customer word', async ({
      page,
    }) => {
      await open(page, width);
      const chips = page.getByRole('radio');
      await expect(chips).toHaveCount(7);
      await page.getByRole('radio', { name: /^All/ }).focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('radio', { name: /^Requests/ })).toBeChecked();
      await expect(toolLinks(page)).toHaveCount(4);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Requests (4)']);
      await expect(page.locator('.ux-tools-status')).toHaveText('Showing 4 of 16 tools.');
      expect(page.url()).toContain('group=missions');
      await page.getByRole('radio', { name: /^All/ }).check({ force: true });
      await expect(toolLinks(page)).toHaveCount(16);
    });

    test('a search and a group work together, and a group from the address opens ready', async ({
      page,
    }) => {
      await open(page, width, '?group=missions&q=delegation');
      await expect(page.getByRole('radio', { name: /^Requests/ })).toBeChecked();
      await expect(page.getByRole('searchbox', { name: 'Find a tool' })).toHaveValue('delegation');
      await expect(toolLinks(page)).toHaveCount(2);
      for (const link of await toolLinks(page).all()) await expect(link).toBeVisible();
    });

    test('nothing scrolls sideways, and the page has one h1', async ({ page }) => {
      await open(page, width);
      await page.getByRole('searchbox', { name: 'Find a tool' }).fill('a');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await expect(page.locator('h1')).toHaveCount(1);
    });

    test('axe finds nothing on the finder, with a result and with none', async ({ page }) => {
      await open(page, width);
      const run = () =>
        new AxeBuilder({ page })
          .include('.ux-tools-finder')
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .disableRules(['color-contrast'])
          .analyze();
      expect((await run()).violations).toEqual([]);
      await page.getByRole('searchbox', { name: 'Find a tool' }).fill('zzzz');
      expect((await run()).violations).toEqual([]);
    });
  });
}

test('on a phone the search box, every chip, each group name and Clear Search are 44 px targets', async ({
  page,
}) => {
  await open(page, 390, '?q=zzzz');
  const high = async (locator: ReturnType<Page['locator']>) =>
    (await locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))).every(
      (h) => h >= 43.5,
    );
  expect(await high(page.getByRole('searchbox', { name: 'Find a tool' }))).toBe(true);
  expect(await high(page.locator('.ux-segment'))).toBe(true);
  expect(await high(page.getByRole('button', { name: 'Clear Search' }))).toBe(true);
  await page.getByRole('button', { name: 'Clear Search' }).click();
  expect(await high(page.locator('.ux-tools-fold > summary'))).toBe(true);
});

test('on a phone the groups fold, each one tap away, and a search or group opens the result', async ({
  page,
}) => {
  await open(page, 390);
  await expect(page.locator('details.ux-tools-fold[open]')).toHaveCount(0);
  await page.locator('details.ux-tools-fold > summary', { hasText: 'Start (3)' }).click();
  await expect(page.getByRole('link', { name: /Plan a mission/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a tool' }).fill('plan');
  for (const link of await toolLinks(page).all()) await expect(link).toBeVisible();
});

test('on a wide screen every tool is on the first screen without a tap', async ({ page }) => {
  await open(page, 1440);
  for (const link of await toolLinks(page).all()) await expect(link).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
  ).toBe(true);
});
