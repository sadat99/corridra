import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v4.1 audit, unit F2 (builder A): the signed-in customer frame and Home (Your Move), drawn from the real
// components and the real stylesheets on a small bundled page (no server, no sign-in). What it proves:
//   02  the "Waiting for you" head link stays inside its card at 320 and 390;
//   03  one bar on every account page: a form step (no Quick button) has the same one-row bar as Home at 390;
//   07  at 200% text neither the bar nor Home scrolls sideways;
//   08  the account menu button's accessible name contains the initials it shows;
//   14  Home has one link per destination inside <main>;
//   21  the journey cards stack on a phone and show their titles and dates whole;
//   26  the sidebar's New Request and All Tools sit inside a landmark.
// The data is synthetic. Fonts are the system's, so widths are checked as relations (inside, not past), not pixels.

const workspace = '00000000-0000-4000-8000-0000000000a1';
const draftHref = `/account/drafts/${workspace}?draft=d1`;
let html = '';

test.beforeAll(async () => {
  const source = (path: string) => JSON.stringify(resolve('apps/web', path));
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { LanguageProvider } from ${source('components/language-provider.tsx')};
        import { AppHeader } from ${source('components/ux/app-header.tsx')};
        import { BrandLockup } from ${source('components/site-header.tsx')};
        import { LeftNavFrame } from ${source('components/ux/left-nav.tsx')};
        import { CustomerSideNav, CustomerRailTop, CustomerRailFoot } from ${source('components/ux/customer-rail.tsx')};
        import { PocketButton } from ${source('components/ux/pocket-button.tsx')};
        import { WorkspaceShell } from ${source('components/workspace-shell.tsx')};
        import { MoveView } from ${source('app/account/move/move-view.tsx')};
        const query = new URLSearchParams(location.search);
        const words = { navLabel: 'Customer navigation', menuLabel: 'Menu', closeLabel: 'Close menu', collapseLabel: 'Collapse menu', expandLabel: 'Expand menu' };
        const items = [
          { key: 'home', label: 'Home', href: '/account/move', icon: 'home' },
          { key: 'requests', label: 'Requests', href: '/account?view=work', icon: 'mission' },
          { key: 'companies', label: 'Companies', href: '/account/companies', icon: 'people' },
        ];
        const model = {
          cards: [
            { id: 'draft:d1', kind: 'draft', verb: 'Send', holder: 'you', context: 'Synthetic open request draft', href: ${JSON.stringify(draftHref)} },
            { id: 'quote:q1', kind: 'quote', verb: 'Answer', holder: 'you', context: 'Local meeting arrangement', href: '/account/service-requests/${workspace}/q1' },
          ],
          waiting: [],
          replyCandidates: [],
          latest: null,
        };
        const journeys = [
          { journey: 'organise', id: 'o1', workspaceId: ${JSON.stringify(workspace)}, count: '9', title: 'Site visit coordination for the synthetic autumn delegation', kind: 'service', status: '', statusWords: 'Quote declined', dateWords: 'Updated', at: '2026-11-25T08:00:00Z', href: '/account/service-requests/${workspace}/s9', listHref: '/account?view=work&work=organise' },
          { journey: 'source', id: 'd1', workspaceId: ${JSON.stringify(workspace)}, count: '1', title: 'Synthetic open request draft', kind: 'draft', status: '', statusWords: 'Saved, not sent', dateWords: 'Updated', at: '2026-11-24T08:00:00Z', href: ${JSON.stringify(draftHref)}, listHref: '/account?view=work&work=source' },
          { journey: 'sell', id: 'r3', workspaceId: ${JSON.stringify(workspace)}, count: '2', title: 'Sell in Spain', kind: 'request', status: '', statusWords: 'With the Corridra team', dateWords: 'Sent', at: '2026-11-20T08:00:00Z', href: '/account/requests/r3', listHref: '/account?view=work&work=sell' },
        ];
        const home = !location.pathname.startsWith('/account/drafts');
        createRoot(document.getElementById('app')).render(
          <LanguageProvider offered={[{ code: 'en', draft: false }, { code: 'bn', draft: false }]}>
            <div className="site-shell">
              <AppHeader kind="customer" live={false} notifications brandMark={<BrandLockup />} pocket={query.get('pocket') !== 'off'} />
              <LeftNavFrame navId="customer-navigation" words={words}
                top={<CustomerRailTop />}
                foot={<CustomerRailFoot allTools />}
                nav={<CustomerSideNav id="customer-navigation" label="Customer navigation" items={items} current="home" journeys={[]} groups={[]} />}>
                {home ? (
                  <WorkspaceShell title="Good morning, Synthetic" quietTitle customer>
                    <MoveView model={model} startHref="/account?view=work#customer-workspaces" journeys={journeys} taskJourneys={{ 'draft:d1': 'source', 'quote:q1': 'organise' }} viewer="synthetic" />
                  </WorkspaceShell>
                ) : (
                  <WorkspaceShell title="Your request" customer><p>A form step. The Quick button is not drawn here.</p></WorkspaceShell>
                )}
                {query.get('pocket') !== 'off' ? <PocketButton signals={Promise.resolve(null)} /> : null}
              </LeftNavFrame>
            </div>
          </LanguageProvider>,
        );`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css', '.woff2': 'empty' },
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
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link({ prefetch, ...props }) { return <a {...props} />; }'
                : 'const router = { replace() {}, push() {}, refresh() {} }; export const useRouter = () => router; export const usePathname = () => location.pathname; export const useSearchParams = () => new URLSearchParams(location.search);',
          }));
        },
      },
    ],
  });
  const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = `${readFileSync(resolve('apps/web/app/globals.css'), 'utf8')}\n${componentCss}`;
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Account frame fixture</title><style>${css.replace(/<\/style>/g, '<\\/style>')}</style></head><body><div id="app"></div><script type="module">${script.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

const homePath = '/account/move';
const stepPath = `/account/drafts/${workspace}`;

async function open(page: Page, width: number, path = homePath, query = '', textPercent = 100) {
  await page.route('**/account/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { workspaces: [{ id: workspace, name: 'Synthetic Dhaka Knits' }] } }),
  );
  await page.route('**/api/customer-inbox*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({ json: { user: { name: 'Synthetic Alice', email: 'a@example.invalid' } } }),
  );
  await page.route('**/api/account/picture*', (route) => route.fulfill({ status: 404, body: '' }));
  await page.setViewportSize({ width, height: 844 });
  await page.goto(path + query);
  await expect(page.locator('header.ux-customer-header')).toBeVisible();
  // The session read draws the initials; every measurement is taken after it.
  await expect(page.locator('.ux-util-avatar .ux-avatar-face')).toHaveText('SA');
  if (textPercent !== 100) {
    await page.evaluate((percent) => {
      document.documentElement.style.fontSize = `${percent}%`;
    }, textPercent);
  }
}

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The tops of every control drawn in the header, so one row is one distinct line of controls. */
const headerRows = (page: Page) =>
  page.locator('header.ux-customer-header').evaluate((header) => {
    const drawn = [...header.querySelectorAll('a, button')].filter((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && !el.closest('[hidden]')
      );
    });
    const centres = drawn.map((el) => {
      const box = el.getBoundingClientRect();
      return Math.round(box.top + box.height / 2);
    });
    return {
      names: drawn.map(
        (el) => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24) ?? '',
      ),
      rows: new Set(centres.map((centre) => Math.round(centre / 12))).size,
      height: Math.round(header.getBoundingClientRect().height),
    };
  });

test.describe('02: the "Waiting for you" head link', () => {
  for (const width of [320, 390]) {
    test(`stays inside the card and is not cut at ${width}`, async ({ page }) => {
      await open(page, width);
      const card = page.locator('section.move-card[aria-labelledby="move-you"]');
      const link = card.locator('> a.move-card-link');
      await expect(link).toHaveText('Start a Request');
      const [cardBox, linkBox] = [(await card.boundingBox())!, (await link.boundingBox())!];
      expect(linkBox.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
      expect(linkBox.height).toBeGreaterThanOrEqual(44);
      // Nothing of its words is hidden: the link is as wide as its content needs.
      expect(await link.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      // It keeps its destination.
      await expect(link).toHaveAttribute('href', '/account?view=work#customer-workspaces');
    });
  }

  test('on a wide card the link is still on the head line, at its end', async ({ page }) => {
    await open(page, 1440);
    const card = page.locator('section.move-card[aria-labelledby="move-you"]');
    const [heading, link] = [
      (await card.locator('> h2').boundingBox())!,
      (await card.locator('> a.move-card-link').boundingBox())!,
    ];
    expect(Math.abs(link.y + link.height / 2 - (heading.y + heading.height / 2))).toBeLessThan(12);
    expect(link.x).toBeGreaterThan(heading.x + heading.width);
  });
});

test.describe('03: one bar on every account page', () => {
  test('at 390 a form step has the same one-row bar as Home', async ({ page }) => {
    await open(page, 390);
    await expect(page.locator('.ux-pocket')).toHaveCount(1);
    const home = await headerRows(page);
    await open(page, 390, stepPath);
    await expect(page.locator('.ux-pocket')).toHaveCount(0);
    const step = await headerRows(page);
    expect(step.names).toEqual(home.names);
    expect(home.rows).toBe(1);
    expect(step.rows).toBe(1);
    expect(step.height).toBe(home.height);
    // The short bar has no brand, Search or New Request; they are in the drawer and the account menu.
    for (const hidden of ['.brand', '.ux-csearch-trigger', '.ux-bar-new-narrow'])
      await expect(page.locator(`header.ux-customer-header ${hidden}`)).toBeHidden();
  });

  test('on a form step Search is in the account menu and New Request is in the drawer', async ({
    page,
  }) => {
    await open(page, 390, stepPath);
    await page.getByRole('button', { name: /Account menu$/ }).click();
    const search = page.getByRole('menuitem', { name: 'Search', exact: true });
    await expect(search).toBeVisible();
    await search.click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('[data-leftnav-opener]').click();
    await expect(
      page.locator('.ux-leftnav-panel').getByRole('link', { name: 'New Request' }),
    ).toBeVisible();
  });

  test('from 641 px, and with the Pocket switch off, the bar is what it was', async ({ page }) => {
    await open(page, 768, stepPath);
    await expect(page.locator('header.ux-customer-header .ux-csearch-trigger')).toBeVisible();
    await expect(page.locator('header.ux-customer-header .ux-bar-new-narrow')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Search', exact: true })).toHaveCount(0);
    await open(page, 390, stepPath, '?pocket=off');
    await expect(page.locator('header.ux-customer-header .ux-csearch-trigger')).toBeVisible();
    await expect(page.locator('header.ux-customer-header .ux-bar-new-narrow')).toBeVisible();
  });
});

test.describe('07: 200% text', () => {
  for (const width of [320, 390]) {
    for (const [name, path] of [
      ['Home', homePath],
      ['a form step', stepPath],
    ] as const) {
      test(`${name} does not scroll sideways at ${width}`, async ({ page }) => {
        await open(page, width, path, '', 200);
        expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
        // Every bar control is inside the window.
        const outside = await page.locator('header.ux-customer-header').evaluate((header) =>
          [...header.querySelectorAll('a, button')]
            .filter((el) => el.getBoundingClientRect().width > 1)
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.left < -0.5 || box.right > window.innerWidth + 0.5;
            })
            .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''),
        );
        expect(outside).toEqual([]);
        if (path !== homePath) return;
        // The card head's count, holder key and link are whole inside the card, not clipped at its edge.
        const clipped = await page
          .locator('section.move-card[aria-labelledby="move-you"]')
          .evaluate((card) => {
            const edge = card.getBoundingClientRect();
            return [...card.querySelectorAll(':scope > :is(h2, .move-count, .move-head-key, a)')]
              .filter((el) => {
                const box = el.getBoundingClientRect();
                return box.left < edge.left - 0.5 || box.right > edge.right + 0.5;
              })
              .map((el) => el.textContent);
          });
        expect(clipped).toEqual([]);
      });
    }
  }

  for (const width of [320, 390, 768, 1440]) {
    test(`Home does not scroll sideways at ${width} at the normal text size`, async ({ page }) => {
      await open(page, width);
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    });
  }
});

test('08: the account menu button is named by the initials it shows', async ({ page }) => {
  await open(page, 1440);
  const button = page.locator('.ux-util-avatar > .ux-menu-button');
  const shown = (await button.innerText()).trim();
  expect(shown).toBe('SA');
  await expect(button).toHaveAccessibleName(/^SA Account menu$/);
  await expect(
    page.getByRole('button', { name: `${shown} Account menu`, exact: true }),
  ).toHaveCount(1);
  const scan = await new AxeBuilder({ page })
    .include('header.ux-customer-header')
    .withRules(['label-content-name-mismatch'])
    .analyze();
  expect(scan.violations.map((violation) => violation.id)).toEqual([]);
});

test('14: Home has one link per destination inside main', async ({ page }) => {
  await open(page, 390);
  const hrefs = await page
    .locator('main a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(3);
  expect(hrefs.filter((href, index) => hrefs.indexOf(href) !== index)).toEqual([]);
  // The saved request is opened from Today; its journey card keeps its facts and has no second link.
  await expect(page.locator(`main a[href="${draftHref}"]`)).toHaveText('Finish and Send');
  const sourcing = page.locator('.move-journey[data-journey="source"]');
  await expect(sourcing).toContainText('Synthetic open request draft');
  await expect(sourcing.locator('a')).toHaveCount(0);
  // A journey no task above opens keeps its link.
  await expect(page.locator('.move-journey[data-journey="sell"] a')).toHaveAttribute(
    'href',
    '/account/requests/r3',
  );
});

test.describe('21: the journey cards on a phone', () => {
  for (const width of [320, 390]) {
    test(`stack, do not scroll sideways and show their words whole at ${width}`, async ({
      page,
    }) => {
      await open(page, width);
      const row = page.locator('section.move-journeys');
      const cards = row.locator('> .move-journey');
      await expect(cards).toHaveCount(3);
      expect(await row.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      const boxes = await cards.evaluateAll((list) =>
        list.map((el) => {
          const box = el.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        }),
      );
      for (const [index, box] of boxes.entries()) {
        expect(box.left).toBe(boxes[0]!.left);
        expect(box.right).toBeLessThanOrEqual(width);
        if (index > 0) expect(box.top).toBeGreaterThanOrEqual(boxes[index - 1]!.bottom);
      }
      // No title or date is cut with an ellipsis.
      const cut = await row
        .locator('.move-journey-head h3, .move-journey-foot > span')
        .evaluateAll((list) =>
          list.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
        );
      expect(cut).toEqual([]);
      await expect(row.locator('h3').first()).toHaveText(
        'Site visit coordination for the synthetic autumn delegation',
      );
    });
  }
});

test('26: the sidebar New Request and All Tools are inside a landmark', async ({ page }) => {
  await open(page, 1440);
  const landmarkOf = (selector: string) =>
    page
      .locator(selector)
      .evaluate(
        (el) =>
          el
            .closest('nav, main, header, footer, aside, [role="navigation"], [role="region"]')
            ?.getAttribute('aria-label') ?? null,
      );
  expect(await landmarkOf('.ux-leftnav-panel .ux-rail-new > span')).toBe('New request');
  expect(await landmarkOf('.ux-leftnav-panel .ux-rail-tools > span')).toBe('Tools and help');
  await expect(page.getByRole('navigation', { name: 'New request' })).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Tools and help' })).toHaveCount(1);
  const scan = await new AxeBuilder({ page })
    .include('.ux-leftnav-panel')
    .withRules(['region', 'landmark-unique'])
    .analyze();
  expect(scan.violations.map((violation) => violation.id)).toEqual([]);
});
