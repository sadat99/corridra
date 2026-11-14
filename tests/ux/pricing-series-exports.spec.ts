import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v3 consistency pass, unit A3c: the "Pricing, series and exports" card of the programme page. The real
// components and the real stylesheets are drawn on a small bundled page inside the customer shell, with the API answered
// by page.route (no server data, no sign-in), at the three widths of the owner's checklist. Every case fails on the code
// before this change: the series row menu, the one-primary rule and the 12 / 24 rhythm do not exist there.
const fixturePath = '/__pricing-series-exports-fixture';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const templateId = '22222222-2222-4222-8222-222222222222';
const future = () => new Date(Date.now() + 600_000).toISOString();
let html = '';

type Row = Record<string, unknown>;
const series = (n: number, over: Row = {}): Row => ({
  id: `33333333-3333-4333-8333-33333333333${n}`,
  seq: n,
  version: 1,
  name: `Sample series ${n}`,
  description: null,
  retired: false,
  templateId,
  templateName: 'Sample edition plan',
  templateVersion: 1,
  templateRetired: false,
  startDates: ['2027-01-15', '2027-04-15'],
  editions: [],
  nextEditionDate: '2027-01-15',
  updatedAt: '2026-10-20T10:00:00.000Z',
  provenance: 'ORGANISER_RECORDED',
  ...over,
});

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { ProgrammePricing } from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-pricing.tsx'))};
        createRoot(document.getElementById('app')).render(
          <WorkspaceShell title="Sample programme" customer>
            <ProgrammePricing subject="sample-subject" issuer="https://sample.example/auth"
              workspaceId=${JSON.stringify(workspaceId)} programmes={[{ id: '44444444-4444-4444-8444-444444444444', name: 'Sample programme' }]}
              onChanged={() => {}} />
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
    'components/ux/overflow-menu.css',
    'components/ux/money-input.css',
    'app/account/delegations/fee-schedule-actions.css',
    // The stylesheet of this change does not exist on the code before it; a missing file is an empty one.
    'app/account/delegations/programme-pricing.css',
  ]
    .map((file) =>
      existsSync(resolve('apps/web', file)) ? readFileSync(resolve('apps/web', file), 'utf8') : '',
    )
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pricing fixture</title><style>${css}</style></head><body><div class="site-shell"><div id="app"></div></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, list: Row[], tab: 'Series' | 'Exports' = 'Series') {
  const posts: { action: string; input: Row }[] = [];
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/api/customer-programme-templates**', (route) =>
    route.fulfill({ json: { workspaceId, expiresAt: future(), templates: [], nextAfter: null } }),
  );
  await page.route('**/api/customer-programme-pricing**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { action: string; input: Row };
      posts.push(body);
      return route.fulfill({
        json: {
          workspaceId,
          commandId: body.input.commandId,
          replayed: false,
          expiresAt: future(),
          series: list[0],
        },
      });
    }
    return route.fulfill({
      json: { workspaceId, expiresAt: future(), series: list, nextAfter: null, templates: [] },
    });
  });
  await page.setViewportSize({ width, height: 844 });
  await page.goto(fixturePath);
  const area = page.getByRole('region', { name: 'Pricing, series and exports', exact: true });
  await area.getByRole('tab', { name: tab }).click();
  return { area, posts };
}

for (const width of [390, 768, 1440]) {
  test.describe(`${width} px`, () => {
    test('Retire Series is one tap deeper in a menu named for the series and asks before it acts', async ({
      page,
    }) => {
      const { area, posts } = await open(page, width, [series(1)]);
      await expect(area.getByRole('button', { name: 'Edit Series Sample series 1' })).toBeVisible();
      // Not a visible button in the row any more: a menu item inside the closed menu.
      await expect(area.getByRole('button', { name: 'Retire Series Sample series 1' })).toHaveCount(
        0,
      );
      const trigger = area.getByRole('button', { name: 'More actions for Sample series 1' });
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(
        area.getByRole('menu', { name: 'More actions for Sample series 1' }),
      ).toBeVisible();
      await area.getByRole('menuitem', { name: 'Retire Series Sample series 1' }).click();
      const confirm = area.getByRole('group', { name: 'Confirm retiring Sample series 1' });
      await expect(confirm).toBeVisible();
      expect(posts).toHaveLength(0);
      await confirm.getByRole('button', { name: 'Keep Sample series 1' }).click();
      await expect(confirm).toHaveCount(0);
      expect(posts).toHaveLength(0);
      await trigger.click();
      await area.getByRole('menuitem', { name: 'Retire Series Sample series 1' }).click();
      await confirm.getByRole('button', { name: 'Retire Sample series 1' }).click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]!.action).toBe('saveSeries');
      expect(posts[0]!.input).toMatchObject({ retired: true, expectedVersion: 1 });
      await expect(area.getByRole('status')).toHaveCount(1);
    });

    test('Restore Series is one tap from the menu and needs no confirm', async ({ page }) => {
      const { area, posts } = await open(page, width, [
        series(1, { retired: true, nextEditionDate: null }),
      ]);
      await area.getByRole('button', { name: 'More actions for Sample series 1' }).click();
      await area.getByRole('menuitem', { name: 'Restore Series Sample series 1' }).click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]!.input).toMatchObject({ retired: false });
      await expect(area.getByRole('group', { name: /Confirm retiring/ })).toHaveCount(0);
    });

    test('one primary action per view: the first next edition, then New Series and the other rows step down', async ({
      page,
    }) => {
      const { area } = await open(page, width, [series(1), series(2)]);
      const next1 = area.getByRole('button', {
        name: 'Create the Next Edition of Sample series 1',
      });
      const next2 = area.getByRole('button', {
        name: 'Create the Next Edition of Sample series 2',
      });
      await expect(next1).toBeVisible();
      await expect(area.locator('.primary-link')).toHaveCount(1);
      await expect(next1).toHaveClass(/primary-link/);
      await expect(next2).toHaveClass(/secondary-link/);
      await expect(area.getByRole('button', { name: 'New Series' })).toHaveClass(/secondary-link/);
    });

    test('with no next edition left, New Series is the one primary action', async ({ page }) => {
      const { area } = await open(page, width, [
        series(1, { retired: true, nextEditionDate: null }),
      ]);
      await expect(area.getByRole('button', { name: 'New Series' })).toBeVisible();
      await expect(area.locator('.primary-link')).toHaveCount(1);
      await expect(area.getByRole('button', { name: 'New Series' })).toHaveClass(/primary-link/);
      await expect(area.locator('.ux-menu')).toHaveCount(1);
    });

    test('12 px inside a section, 24 px between sections and rows, no sideways scroll', async ({
      page,
    }) => {
      const { area } = await open(page, width, [series(1), series(2)]);
      await expect(area.getByRole('heading', { name: 'Series', level: 4 })).toBeVisible();
      const gaps = await area.evaluate((el) => {
        const box = (node: Element | null) => node!.getBoundingClientRect();
        const heading = el.querySelector('[role="tabpanel"] h4');
        const intro = heading!.nextElementSibling;
        const tabs = el.querySelector('.pricing-tabs');
        const rows = [...el.querySelectorAll('[role="tabpanel"] > div > ul > li')];
        return {
          inside: box(intro).top - box(heading).bottom,
          tabsToSection: box(heading).top - box(tabs).bottom,
          rowToRow: box(rows[1]!).top - box(rows[0]!).bottom,
          headingSize: getComputedStyle(heading!).fontSize,
        };
      });
      expect(Math.abs(gaps.inside - 12)).toBeLessThanOrEqual(1);
      expect(Math.abs(gaps.tabsToSection - 24)).toBeLessThanOrEqual(1);
      expect(Math.abs(gaps.rowToRow - 24)).toBeLessThanOrEqual(1);
      expect(gaps.headingSize).toBe('18px');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });

    test('Exports stays one form with one primary action, fields 12 px apart, the money line and words unchanged', async ({
      page,
    }) => {
      const { area } = await open(page, width, [], 'Exports');
      await expect(area.getByRole('button', { name: 'Download CSV' })).toBeVisible();
      await expect(area.locator('.primary-link')).toHaveCount(1);
      await area.getByLabel('What to export').selectOption('ledger');
      await expect(area.getByLabel('Programme (optional)')).toBeVisible();
      await expect(area.getByText('Nothing is converted.')).toBeVisible();
      const fieldGap = await area.evaluate((el) => {
        const labels = [...el.querySelectorAll('form label.field')].map((n) =>
          n.getBoundingClientRect(),
        );
        return labels[1]!.top - labels[0]!.bottom;
      });
      expect(Math.abs(fieldGap - 12)).toBeLessThanOrEqual(1);
      expect(
        await area
          .getByRole('heading', { name: 'Exports', level: 4 })
          .evaluate((n) => getComputedStyle(n).fontSize),
      ).toBe('18px');
    });
  });
}

test('on a phone the menu button, the actions and the tabs are 44 px targets', async ({ page }) => {
  const { area } = await open(page, 390, [series(1)]);
  for (const locator of [
    area.getByRole('button', { name: 'More actions for Sample series 1' }),
    area.getByRole('button', { name: 'Edit Series Sample series 1' }),
    area.getByRole('button', { name: 'Create the Next Edition of Sample series 1' }),
    area.getByRole('tab', { name: 'Series' }),
  ])
    expect((await locator.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const trigger = await area
    .getByRole('button', { name: 'More actions for Sample series 1' })
    .boundingBox();
  expect(trigger!.width).toBeGreaterThanOrEqual(44);
});

test('page length: three series rows fit one desktop screen, and Exports on a phone is no longer than before', async ({
  page,
}) => {
  const edition = {
    id: '55555555-5555-4555-8555-555555555551',
    programmeId: '44444444-4444-4444-8444-444444444444',
    editionNo: 1,
    startDate: '2027-01-15',
    programmeName: 'Sample edition 1',
  };
  const rows = [
    series(1, { editions: [edition], nextEditionDate: '2027-04-15' }),
    series(2),
    series(3, { retired: true, nextEditionDate: null }),
  ];
  const mainHeight = () =>
    page.evaluate(() => document.querySelector('main')!.getBoundingClientRect().height);
  const { area } = await open(page, 1440, rows);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(area.getByRole('button', { name: 'Edit Series Sample series 3' })).toBeVisible();
  // Desktop hard limit: one screen (the code before this change measured 904 px, a first version of it 965 px).
  expect(await mainHeight()).toBeLessThanOrEqual(900);
  await page.setViewportSize({ width: 390, height: 844 });
  await area.getByRole('tab', { name: 'Exports' }).click();
  await expect(area.getByRole('button', { name: 'Download CSV' })).toBeVisible();
  // Before this change the Exports tab measured 798 px on a phone (0.95 screens); a first version of it 855 px.
  expect(await mainHeight()).toBeLessThanOrEqual(801);
});
