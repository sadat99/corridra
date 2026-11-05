import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// L-01, the REFERENCE for the shared left navigation (layout budget, docs/revamp/specs/layout-budget.md
// section 1). It renders apps/web/components/ux/left-nav.tsx on a small bundled page (no server and no
// sign-in) and proves the behaviour every signed-in shell inherits: the bar beside the page at 1024 px
// and wider, icons-only collapse, and below 1024 px a left drawer with a menu button, a focus trap,
// Escape, a scrim, close on navigation, the page behind inert, and growing past 1024 closing it. The
// customer, team and contributor adoptions reuse this file's helpers and add their own destinations.

const fixturePath = '/__left-nav-fixture';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { LeftNavFrame, LeftNavList, LeftNavMenuButton } from ${JSON.stringify(resolve('apps/web/components/ux/left-nav.tsx'))};
        const query = new URLSearchParams(location.search);
        const dir = query.get('dir') === 'rtl' ? 'rtl' : 'ltr';
        const words = { navLabel: 'Fixture sections', menuLabel: 'Sections', closeLabel: 'Close sections', collapseLabel: 'Collapse sections', expandLabel: 'Expand sections' };
        const items = [
          { key: 'tasks', label: 'Your tasks', href: '/tasks', icon: 'mission' },
          { key: 'how', label: 'How assigned work works', href: '/how', icon: 'document' },
          { key: 'account', label: 'Account', href: '/account-page', icon: 'people' },
        ];
        createRoot(document.getElementById('menu')).render(<LeftNavMenuButton />);
        createRoot(document.getElementById('app')).render(
          <LeftNavFrame navId="fixture-nav" words={words} dir={dir}
            nav={<LeftNavList id="fixture-nav" label="Fixture sections" items={items} current="tasks" />}>
            <main id="main" tabIndex={-1}>
              <h1>Page</h1>
              <button type="button">A page action</button>
              <p>{'Some page text. '.repeat(60)}</p>
            </main>
          </LeftNavFrame>,
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
    plugins: [
      {
        name: 'next-link-stub',
        setup(b) {
          b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next-link', namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents:
              'export default function Link({ href, children, prefetch, ...rest }) { return <a href={href} {...rest}>{children}</a>; }',
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
          }));
        },
      },
    ],
  });
  const css = ['app/globals.css', 'components/ux/shells.css', 'components/ux/left-nav.css']
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Left navigation fixture</title><style>${css}</style></head><body><header class="site-header ux-app-header"><div id="menu"></div></header><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, query = '') {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: 800 });
  await page.goto(fixturePath + query);
  await expect(page.locator('h1')).toHaveText('Page');
}
const panel = (page: Page) => page.locator('.ux-leftnav-panel');
const opener = (page: Page) => page.locator('[data-leftnav-opener]');
const insidePanel = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest('.ux-leftnav-panel'));
// Focus moves into the drawer a moment after it opens (an effect), so the first check waits for it.
const focusInside = (page: Page) => expect.poll(() => insidePanel(page)).toBe(true);

for (const width of [1024, 1440]) {
  test(`L-01 at ${width} the bar sits beside the page, there is no menu button, the current item is marked and every target is 44 px`, async ({
    page,
  }) => {
    await open(page, width);
    await expect(page.locator('#fixture-nav')).toBeVisible();
    await expect(opener(page)).toBeHidden();
    await expect(page.getByRole('link', { name: 'Your tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('link', { name: 'How assigned work works' })).not.toHaveAttribute(
      'aria-current',
    );
    const beside = await page.evaluate(() => {
      const nav = document.querySelector('#fixture-nav')!.getBoundingClientRect();
      const main = document.querySelector('#main')!.getBoundingClientRect();
      return { navWidth: nav.width, navRight: nav.right, mainLeft: main.left };
    });
    expect(beside.navWidth).toBeGreaterThanOrEqual(240 - 1);
    expect(beside.navWidth).toBeLessThanOrEqual(280);
    expect(beside.mainLeft).toBeGreaterThanOrEqual(beside.navRight);
    const heights = await panel(page)
      .locator('a, button')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
  });
}

test('L-01 at 390 the drawer is closed and out of the tab order; the menu button opens it and focus stays inside', async ({
  page,
}) => {
  await open(page, 390);
  await expect(page.locator('#fixture-nav')).toBeHidden();
  await expect(opener(page)).toBeVisible();
  await expect(opener(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(opener(page)).toHaveAttribute('aria-controls', 'fixture-nav');
  // Closed: Tab from the menu button reaches the page, never a hidden link.
  await opener(page).focus();
  await page.keyboard.press('Tab');
  expect(await insidePanel(page)).toBe(false);
  await opener(page).click();
  await expect(opener(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page)).toHaveAttribute('role', 'dialog');
  await expect(page.locator('#fixture-nav')).toBeVisible();
  await focusInside(page);
  // A focus trap: five times around the three links, the close button and the collapse control.
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press('Tab');
    expect(await insidePanel(page), `Tab ${step + 1}`).toBe(true);
  }
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press('Shift+Tab');
    expect(await insidePanel(page), `Shift+Tab ${step + 1}`).toBe(true);
  }
  // The page behind the drawer cannot be reached.
  await expect(page.locator('.ux-leftnav-page')).toHaveAttribute('inert', '');
});

test('L-01 Escape closes the drawer and returns focus to the menu button', async ({ page }) => {
  await open(page, 390);
  await opener(page).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#fixture-nav')).toBeHidden();
  await expect(opener(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(opener(page)).toBeFocused();
  await expect(page.locator('.ux-leftnav-page')).not.toHaveAttribute('inert');
});

test('L-01 the scrim and the close button close the drawer and return focus; a link closes it without taking focus', async ({
  page,
}) => {
  await open(page, 390);
  await opener(page).click();
  await page.locator('.ux-leftnav-scrim').click({ position: { x: 380, y: 400 } });
  await expect(opener(page)).toBeFocused();
  await expect(page.locator('#fixture-nav')).toBeHidden();
  await opener(page).click();
  await page.getByRole('button', { name: 'Close sections' }).click();
  await expect(opener(page)).toBeFocused();
  // A navigation closes it: the click is stopped so the fixture stays, and focus is left to the page.
  await opener(page).click();
  await page.evaluate(() =>
    document.querySelector('#fixture-nav')!.addEventListener('click', (e) => e.preventDefault()),
  );
  await page.getByRole('link', { name: 'How assigned work works' }).click();
  await expect(opener(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await opener(page).evaluate((el) => document.activeElement === el)).toBe(false);
});

test('L-01 growing past 1024 px closes the drawer and shows the bar beside the page', async ({
  page,
}) => {
  await open(page, 390);
  await opener(page).click();
  await expect(panel(page)).toHaveAttribute('data-open', 'true');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(panel(page)).toHaveAttribute('data-open', 'false');
  await expect(page.locator('#fixture-nav')).toBeVisible();
  await expect(opener(page)).toBeHidden();
  await expect(page.locator('.ux-leftnav-page')).not.toHaveAttribute('inert');
});

test('L-01 the bar collapses to icons, keeps every name, and remembers the choice on this device', async ({
  page,
}) => {
  await open(page, 1440);
  const collapse = page.getByRole('button', { name: 'Collapse sections' });
  await collapse.click();
  await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'true');
  const width = await page
    .locator('.ux-leftnav-panel')
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(80);
  await expect(page.getByRole('link', { name: 'Your tasks' })).toBeVisible();
  const box = await page.getByRole('link', { name: 'Your tasks' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await page.reload();
  await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'true');
  await page.getByRole('button', { name: 'Expand sections' }).click();
  await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'false');
  expect(
    await page.locator('.ux-leftnav-panel').evaluate((el) => el.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(240 - 1);
});

test('L-01 right to left: the drawer opens from the right edge', async ({ page }) => {
  await open(page, 390, '?dir=rtl');
  await opener(page).click();
  await expect(page.locator('#fixture-nav')).toBeVisible();
  // The drawer slides in: wait for it to settle against the right edge.
  await expect
    .poll(() =>
      panel(page).evaluate((el) => Math.round(innerWidth - el.getBoundingClientRect().right)),
    )
    .toBe(0);
  const left = await panel(page).evaluate((el) => el.getBoundingClientRect().left);
  expect(left).toBeGreaterThan(0);
});

test('L-01 axe is clean with the drawer closed and open at 390, and with the bar open and collapsed at 1440', async ({
  page,
}) => {
  const scan = async (label: string) =>
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(
        (v) => v.id,
      ),
      label,
    ).toEqual([]);
  await open(page, 390);
  await scan('390 closed');
  await opener(page).click();
  await scan('390 open');
  await open(page, 1440);
  await scan('1440 open');
  await page.getByRole('button', { name: 'Collapse sections' }).click();
  await scan('1440 collapsed');
});
