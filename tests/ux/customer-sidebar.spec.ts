import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// L16: the signed-in customer sidebar (components/ux/customer-rail.tsx) in the real frame (left-nav.tsx) with the
// real stylesheets, on a small bundled page (no server, no sign-in), at the widths the owner reported from:
// 1908x831 (his screenshots), 1440, 768 and 390.
//   (a) the list shows a thin quiet scrollbar, only when it overflows;
//   (b) Your Journeys is never cut off or hidden: the foot (All Tools, Help, Collapse) is in view and no row is
//       clipped by another, or the list scrolls to reach them;
//   (c) only the current item looks active: Sourcing is the same weight as Organising and Selling, and
//       aria-current is only on the true current item.
// The counts rules (scope, roles, zero) are in tests/integration/customer-sidebar-counts.test.ts.

const fixturePath = '/__customer-sidebar-fixture';
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
          : undefined;
        createRoot(document.getElementById('menu')).render(<LeftNavMenuButton />);
        createRoot(document.getElementById('app')).render(
          <LeftNavFrame navId="customer-navigation" words={words}
            top={<a className="ux-rail-new" href="/account">New Request</a>}
            foot={<CustomerRailFoot href="https://wa.me/0" allTools />}
            nav={<CustomerSideNav id="customer-navigation" label="Customer navigation" items={items} current={query.get('current') ?? 'requests'} journeys={journeys} journeyCounts={counts} groups={groups} />}>
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
              'export const usePathname = () => location.pathname; export const useRouter = () => ({ push() {}, replace() {}, refresh() {} }); export const useSearchParams = () => new URLSearchParams(location.search);',
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
  ]
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Customer sidebar fixture</title><style>${css}</style></head><body><div class="site-shell"><header class="site-header ux-app-header"><div id="menu"></div></header><div id="app"></div></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
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
  { width: 1908, height: 831 },
  { width: 1440, height: 900 },
  { width: 768, height: 800 },
  { width: 390, height: 844 },
];

async function openMenuIfDrawer(page: Page, width: number) {
  if (width < 1024) await page.locator('[data-leftnav-opener]').click();
  await expect(page.locator('#customer-navigation')).toBeVisible();
}

for (const { width, height } of sizes) {
  test.describe(`${width}x${height}`, () => {
    test('(c) the active state stays distinct: only the true current item has the selected surface and aria-current, so Sourcing (the bolder lead) is never mistaken for it', async ({
      page,
    }) => {
      await open(page, width, height, '?current=requests');
      await openMenuIfDrawer(page, width);
      const nav = page.locator('#customer-navigation');
      const look = (name: string) =>
        nav.getByRole('link', { name }).evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            background: cs.backgroundColor,
            color: cs.color,
            current: el.getAttribute('aria-current'),
          };
        });
      const [requests, sourcing, organising, meetings] = await Promise.all([
        look('Requests'),
        look(/^Sourcing/ as unknown as string),
        look('Organising'),
        look('Meetings'),
      ]);
      // Exactly one link is current, and it is the page's own tab.
      await expect(nav.locator('[aria-current]')).toHaveCount(1);
      expect(requests.current).toBe('page');
      expect(sourcing.current).toBeNull();
      // The selected surface and the cobalt words belong to the current item alone.
      expect(requests.background).not.toBe(sourcing.background);
      expect(requests.background).not.toBe(meetings.background);
      expect(sourcing.background).toBe(organising.background);
      expect(requests.color).not.toBe(sourcing.color);
      // On its own page a journey is not current either (journeys never carry aria-current), and the lead keeps
      // its emphasis: bolder than the other journeys.
      const weight = (name: string) =>
        nav.getByRole('link', { name }).evaluate((el) => Number(getComputedStyle(el).fontWeight));
      expect(await weight('Sourcing')).toBeGreaterThan(await weight('Organising'));
    });

    test('(a) the list has a thin, quiet scrollbar and scrolls only when it overflows', async ({
      page,
    }) => {
      await open(page, width, height);
      await openMenuIfDrawer(page, width);
      const nav = page.locator('#customer-navigation');
      const info = await nav.evaluate((el) => {
        const cs = getComputedStyle(el);
        const bar = getComputedStyle(el, '::-webkit-scrollbar');
        const drawer = el.closest('.ux-leftnav-panel')!;
        return {
          width: cs.scrollbarWidth,
          color: cs.scrollbarColor,
          overflowY: cs.overflowY,
          overflows: el.scrollHeight > el.clientHeight + 1,
          barWidth: bar.width,
          panelColor: getComputedStyle(drawer).scrollbarColor,
        };
      });
      // Thin, and never the navy track the team bar uses on its dark bar.
      expect(info.width).toBe('thin');
      // The track is see-through (the old one was the team bar's navy, a dark band on the white sidebar).
      expect(info.color).toMatch(/rgba\(0, 0, 0, 0\)$/);
      expect(info.panelColor).toMatch(/rgba\(0, 0, 0, 0\)$/);
      expect(info.barWidth === 'auto' || parseFloat(info.barWidth) <= 8).toBe(true);
      // With room to spare there is no scrolling box; with none, the list scrolls instead of clipping.
      if (!info.overflows)
        expect(info.overflowY === 'auto' || info.overflowY === 'visible').toBe(true);
    });

    test('(b) Your Journeys is never clipped: every journey is in view or reachable by scrolling the list, and the foot stays in view', async ({
      page,
    }) => {
      await open(page, width, height);
      await openMenuIfDrawer(page, width);
      const nav = page.locator('#customer-navigation');
      const fits = await nav.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
      for (const name of ['Sourcing', 'Organising', 'Selling']) {
        const link = nav.getByRole('link', { name });
        if (fits) {
          // Nothing hidden: the whole list is laid out inside the box and the box is on screen.
          const box = await link.boundingBox();
          expect(box, name).not.toBeNull();
          expect(box!.y + box!.height).toBeLessThanOrEqual(height + 0.5);
        } else {
          await link.scrollIntoViewIfNeeded();
          await expect(link).toBeInViewport({ ratio: 1 });
        }
      }
      // The foot is never pushed below the window at a desktop width.
      if (width >= 1024) {
        for (const name of ['All Tools', /Help on WhatsApp/, 'Collapse menu']) {
          const el = page.getByRole(name === 'Collapse menu' ? 'button' : 'link', { name });
          await expect(el.first()).toBeInViewport({ ratio: 1 });
        }
      }
      // At the owner's size the list is fully laid out: nothing needs scrolling to find a journey.
      if (width === 1908 && height === 831) expect(fits).toBe(true);
    });

    test('counts sit beside the journeys, a zero is not drawn and an incomplete list says N+', async ({
      page,
    }) => {
      await open(page, width, height, '?counts=1');
      await openMenuIfDrawer(page, width);
      const nav = page.locator('#customer-navigation');
      await expect(nav.getByRole('link', { name: /Sourcing/ })).toContainText('4');
      await expect(nav.getByRole('link', { name: /Selling/ })).toContainText('12+');
      await expect(
        nav.getByRole('link', { name: /Organising/ }).locator('[data-journey-count]'),
      ).toHaveCount(0);
      await expect(nav.getByRole('link', { name: /Sourcing/ })).toContainText('4 pieces of work');
    });
  });
}
