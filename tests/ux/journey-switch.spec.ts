import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Journey modes (docs/revamp/specs/journey-modes.md 3.4, 3.5, 3.8): the Journey switcher in the real signed-in
// sidebar (customer-rail.tsx inside left-nav.tsx) with the real stylesheets, on a small bundled page (no server, no
// sign-in), at 1280, 1024 and 390, in the icons-only bar and in the phone drawer. The router is a stub that records
// where a choice goes; the cookie is the real one (the fixture address is under /account, the cookie's path).
// The model (addresses, precedence, composition) is in tests/integration/journey-mode.test.ts.

const fixturePath = '/account/__journey-switch-fixture';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { LeftNavFrame, LeftNavMenuButton } from ${JSON.stringify(resolve('apps/web/components/ux/left-nav.tsx'))};
        import { CustomerSideNav, CustomerRailFoot } from ${JSON.stringify(resolve('apps/web/components/ux/customer-rail.tsx'))};
        const query = new URLSearchParams(location.search);
        const words = { navLabel: 'Customer navigation', menuLabel: 'Menu', closeLabel: 'Close menu', collapseLabel: 'Collapse menu', expandLabel: 'Expand menu' };
        const items = [
          { key: 'home', label: 'Home', href: '/account/move', icon: 'home' },
          { key: 'requests', label: 'Requests', href: '/account?view=work', icon: 'mission' },
          { key: 'companies', label: 'Companies', href: '/account/companies', icon: 'people' },
          { key: 'meetings', label: 'Meetings', href: '/account/meetings', icon: 'calendar' },
          { key: 'reports', label: 'Reports', href: '/account?view=results', icon: 'document' },
        ];
        const journeys = [
          { key: 'journey-source', label: 'Sourcing', href: '/account/move?journey=source', tone: 'action', lead: true },
          { key: 'journey-organise', label: 'Organising', href: '/account/move?journey=organise', tone: 'positive' },
          { key: 'journey-sell', label: 'Selling', href: '/account/move?journey=sell', tone: 'ornament' },
        ];
        const groups = [
          { key: 'programmes', label: 'Programmes', href: '/account/delegations/organise', tone: 'action' },
          { key: 'registrations', label: 'Registrations', href: '/account/delegations', tone: 'positive' },
        ];
        const counts = query.get('counts') === '1'
          ? Promise.resolve({ source: { n: 4, partial: false }, organise: { n: 0, partial: false }, sell: { n: 12, partial: true } })
          : query.get('counts') === 'none' ? Promise.resolve(null) : undefined;
        const mode = query.get('mode') ?? 'all';
        createRoot(document.getElementById('menu')).render(<LeftNavMenuButton />);
        createRoot(document.getElementById('app')).render(
          <LeftNavFrame navId="customer-navigation" words={words}
            top={<a className="ux-rail-new" href="/account">New Request</a>}
            foot={<CustomerRailFoot href="https://wa.me/0" allTools />}
            nav={<CustomerSideNav id="customer-navigation" label="Customer navigation" items={items} current={query.get('current') ?? 'requests'} journeys={journeys} journeyCounts={counts} journeyMode={mode} groups={groups} />}>
            <main id="main" tabIndex={-1}><h1>Page</h1><p>{'Some page text. '.repeat(60)}</p></main>
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
        name: 'next-stubs',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'stub',
          }));
          b.onLoad({ filter: /^next\/link$/, namespace: 'stub' }, () => ({
            contents:
              'export default function Link({ href, children, prefetch, ...rest }) { return <a href={href} {...rest}>{children}</a>; }',
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
          }));
          b.onLoad({ filter: /^next\/navigation$/, namespace: 'stub' }, () => ({
            contents:
              'export const usePathname = () => location.pathname; export const useRouter = () => ({ push(href) { (window.__nav ??= []).push("push " + href); }, replace() {}, refresh() { (window.__nav ??= []).push("refresh"); } }); export const useSearchParams = () => new URLSearchParams(location.search);',
            loader: 'ts',
          }));
        },
      },
    ],
  });
  const css = [
    'app/globals.css',
    'components/ux/shells.css',
    'components/ux/team-nav.css',
    'components/ux/left-nav.css',
    'components/ux/customer-bar.css',
    'components/ux/customer-rail.css',
    'components/ux/journey-switch.css',
  ]
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Journey switch fixture</title><style>${css}</style></head><body><div class="site-shell"><header class="site-header ux-app-header"><div id="menu"></div></header><div id="app"></div></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, height: number, query = '') {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height });
  await page.goto(fixturePath + query);
  await expect(page.locator('h1')).toHaveText('Page');
}

const sizes = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
const nav = (page: Page) => page.locator('#customer-navigation');
const summary = (page: Page) => nav(page).locator('.ux-journey-switch > summary');
const went = (page: Page) =>
  page.evaluate(() => (window as unknown as { __nav?: string[] }).__nav ?? []);

async function openMenuIfDrawer(page: Page, width: number) {
  if (width < 1024) await page.locator('[data-leftnav-opener]').click();
  await expect(nav(page)).toBeVisible();
}

for (const { width, height } of sizes) {
  test.describe(`${width}x${height}`, () => {
    test('the switcher is the first thing in the list, replaces Your Journeys, and every target is at least 44 px', async ({
      page,
    }) => {
      await open(page, width, height, '?mode=source&counts=1');
      await openMenuIfDrawer(page, width);
      await expect(summary(page)).toHaveAccessibleName(/^Journey, Sourcing/);
      expect(await nav(page).evaluate((el) => el.firstElementChild?.tagName)).toBe('DETAILS');
      await expect(nav(page).getByText('Your Journeys')).toHaveCount(0);
      // In Sourcing the Groups (Programmes, Registrations) are not drawn.
      await expect(nav(page).getByRole('link', { name: 'Programmes' })).toHaveCount(0);
      await summary(page).click();
      const choices = nav(page).locator('.ux-journey-switch button');
      await expect(choices).toHaveText([/^Everything/, /^Sourcing/, /^Organising/, /^Selling/]);
      await expect(nav(page).locator('.ux-journey-switch [aria-current="true"]')).toHaveText(
        /^Sourcing/,
      );
      for (const target of [summary(page), ...(await choices.all())]) {
        const box = (await target.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      }
      // The choices open in the flow of the list: the first destination sits below the last choice.
      const last = (await choices.last().boundingBox())!;
      const home = (await nav(page).getByRole('link', { name: 'Home' }).boundingBox())!;
      expect(home.y).toBeGreaterThanOrEqual(last.y + last.height - 0.5);
    });

    test('counts are quiet badges: a zero is not drawn, an incomplete list says N+, and the closed switcher counts the other journeys', async ({
      page,
    }) => {
      await open(page, width, height, '?mode=source&counts=1');
      await openMenuIfDrawer(page, width);
      // Organising 0 and Selling 12 or more are elsewhere while in Sourcing.
      await expect(summary(page).locator('[data-journey-count]')).toContainText('12+');
      await expect(summary(page).locator('.sr-only')).toContainText('in other journeys');
      await summary(page).click();
      const choice = (name: RegExp) =>
        nav(page).locator('.ux-journey-switch button', { hasText: name });
      await expect(choice(/^Sourcing/)).toContainText('4 pieces of work');
      await expect(choice(/^Organising/).locator('[data-journey-count]')).toHaveCount(0);
      await expect(choice(/^Everything/).locator('[data-journey-count]')).toHaveCount(0);
      // Quiet, never a coloured alert: the badge on another journey has the same plain surface as the one on the
      // closed switcher (the current row's badge sits on the selected surface, as the sidebar's own does).
      const surface = (el: Element) => getComputedStyle(el).backgroundColor;
      expect(
        await choice(/^Selling/)
          .locator('[data-journey-count]')
          .evaluate(surface),
      ).toBe(await summary(page).locator('[data-journey-count]').evaluate(surface));
    });

    test('with no counts read, and in Everything, the switcher is drawn with all four choices and no count', async ({
      page,
    }) => {
      await open(page, width, height, '?mode=all&counts=none');
      await openMenuIfDrawer(page, width);
      await expect(summary(page)).toHaveAccessibleName(/^Journey, Everything/);
      await expect(nav(page).locator('[data-journey-count]')).toHaveCount(0);
      await expect(nav(page).getByRole('link', { name: 'Programmes' })).toBeVisible();
      await summary(page).click();
      await expect(nav(page).locator('.ux-journey-switch button')).toHaveCount(4);
    });

    test('keyboard only: Enter and Space open the disclosure, Tab reaches the choices, and a choice writes the cookie and re-reads the page', async ({
      page,
    }) => {
      await open(page, width, height, '?mode=source');
      await openMenuIfDrawer(page, width);
      await summary(page).focus();
      await page.keyboard.press('Enter');
      await expect(nav(page).locator('.ux-journey-switch')).toHaveAttribute('open', '');
      await page.keyboard.press('Space');
      await expect(nav(page).locator('.ux-journey-switch')).not.toHaveAttribute('open', '');
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab');
      await expect(nav(page).locator('.ux-journey-switch button').first()).toBeFocused();
      const ring = await nav(page)
        .locator('.ux-journey-switch button')
        .first()
        .evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(ring).not.toBe('none');
      for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab');
      await expect(nav(page).locator('.ux-journey-switch button').last()).toBeFocused();
      await page.keyboard.press('Enter');
      // Not Home or Requests, so the page stays and reads the cookie again.
      expect(await went(page)).toEqual(['refresh']);
      expect(await page.evaluate(() => document.cookie)).toContain('corridra_journey=sell');
      await expect(nav(page).locator('.ux-journey-switch')).not.toHaveAttribute('open', '');
    });
  });
}

test('phone drawer: the switcher is inside the focus trap and Escape closes the drawer, open disclosure or not', async ({
  page,
}) => {
  await open(page, 390, 844, '?mode=organise&counts=1');
  await page.locator('[data-leftnav-opener]').click();
  await expect(nav(page)).toBeVisible();
  // Organising keeps Groups.
  await expect(nav(page).getByRole('link', { name: 'Programmes' })).toBeVisible();
  await summary(page).click();
  await nav(page).locator('.ux-journey-switch button').nth(1).focus();
  await page.keyboard.press('Escape');
  await expect(nav(page)).not.toBeInViewport();
});

test('icons-only bar at 1280: the dot alone, the name kept for assistive technology, and opening widens the bar first', async ({
  page,
}) => {
  await open(page, 1280, 800, '?mode=sell&counts=1');
  await page.getByRole('button', { name: 'Collapse menu' }).click();
  const frame = page.locator('.ux-leftnav-frame');
  await expect(frame).toHaveAttribute('data-collapsed', 'true');
  await expect(summary(page)).toHaveAccessibleName(/^Journey, Selling/);
  const box = (await summary(page).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(summary(page).locator('.ux-journey-switch-chevron')).toBeHidden();
  await expect(summary(page).locator('[data-journey-count]')).toBeHidden();
  await summary(page).click();
  await expect(frame).not.toHaveAttribute('data-collapsed', 'true');
  await expect(nav(page).locator('.ux-journey-switch button').first()).toBeVisible();
});
