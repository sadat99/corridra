import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startPagePatternFixture } from './d4-page-pattern-fixture';

// Team desk v4.1, unit D4: the one page pattern behind CORRIDRA_UX_TEAM_DESK_V41, measured with the real
// stylesheets. Off, the header is the one the desk has today (label above the title, second row of links, jump
// links). On: serif title, one purpose line, segments under the title as links to the same addresses, no label
// above the title, no jump links, and a page that opens at the top.
let fixture: Awaited<ReturnType<typeof startPagePatternFixture>>;
test.beforeAll(async () => {
  fixture = await startPagePatternFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

type Options = { v41: boolean; role?: string; real?: boolean; width?: number; height?: number };
async function open(page: Page, path: string, options: Options) {
  const { v41, role = 'owner', real = false, width = 1440, height = 900 } = options;
  await page.setViewportSize({ width, height });
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: true } }),
  );
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      json: {
        purpose: real ? 'commercial_qualification' : 'synthetic_validation',
        uploadsConfigured: false,
        scanMode: 'bypass',
        role,
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.goto(`${fixture.origin}${path}?v41=${v41 ? 'on' : 'off'}&role=${role}`);
  await expect(page.getByLabel('Workspace status')).toBeAttached();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
}
const heading = (page: Page) => page.locator('main#main > header.ux-page-heading');
const segments = (page: Page) => page.locator('main#main nav.ux-segments');

test('switch off: the header is the one the desk has today', async ({ page }) => {
  await open(page, '/operator/research', { v41: false });
  await expect(heading(page).locator('p.label')).toHaveText('TEAM WORKSPACE');
  await expect(heading(page).locator('h1')).toHaveText('Companies');
  await expect(heading(page).locator('.ux-frame-helper')).toHaveCount(0);
  await expect(segments(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'In this section' })).toBeVisible();
  await expect(page.locator('main#main')).not.toHaveClass(/ux-desk-frame/);
  const family = await heading(page)
    .locator('h1')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  // The title is already set in the heading serif; the pattern keeps it.
  expect(family).toContain('newsreader');
  // The section still takes the focus on arrival, as before.
  await expect(page.locator('#workspace-research')).toBeFocused();
  await open(page, '/operator/sources', { v41: false });
  await expect(page.locator('.ux-panel-heading .eyebrow')).toHaveText('Workspace tools');
});

test('switch off: the label above a panel heading and the jump links stay', async ({ page }) => {
  await open(page, '/operator/missions', { v41: false });
  await expect(page.getByText('OPS HOME', { exact: true })).toBeVisible();
  await expect(page.locator('nav.ux-operator-workbench')).toHaveCount(1);
  await expect(page.getByText('JUMP TO', { exact: true })).toBeVisible();
});

test('switch on: serif title, one purpose line, segments under the title, no label above it', async ({
  page,
}) => {
  await open(page, '/operator/research', { v41: true });
  const head = heading(page);
  await expect(head.locator('p.label')).toHaveCount(0);
  await expect(page.getByText('TEAM WORKSPACE', { exact: true })).toHaveCount(0);
  await expect(head.locator('h1')).toHaveText('Companies');
  await expect(page.locator('h1')).toHaveCount(1);
  const family = await head.locator('h1').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain('newsreader');
  await expect(head.locator('.ux-frame-helper')).toHaveCount(1);
  await expect(head.locator('.ux-frame-helper')).toHaveText(
    'The companies your team has researched for its missions.',
  );
  // The purpose line sits under the title, not beside it.
  const [titleBox, lineBox] = await Promise.all([
    head.locator('h1').boundingBox(),
    head.locator('.ux-frame-helper').boundingBox(),
  ]);
  expect(lineBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height - 1);
  expect(Math.abs(lineBox!.x - titleBox!.x)).toBeLessThanOrEqual(1);
  // At most one primary action in the header; D4 adds none.
  expect(await head.locator('.ux-frame-primary > *').count()).toBeLessThanOrEqual(1);
  // The second row of links is replaced by the segments, which sit right under the header.
  await expect(page.getByRole('navigation', { name: 'In this section' })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Companies pages' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveText([
    'Companies',
    'Sources and claims',
    'Evidence review',
  ]);
  await expect(nav.locator('a[aria-current="page"]')).toHaveText('Companies');
  expect(
    await nav.getByRole('link').evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
  ).toEqual([
    `/operator/research?workspace=00000000-0000-4000-8000-0000000000a1`,
    `/operator/sources?workspace=00000000-0000-4000-8000-0000000000a1`,
    `/operator/evidence?workspace=00000000-0000-4000-8000-0000000000a1`,
  ]);
  const order = await page.evaluate(() => {
    const header = document.querySelector('main#main > header.ux-page-heading')!;
    const row = document.querySelector('main#main nav.ux-segments')!;
    return header.nextElementSibling === row;
  });
  expect(order).toBe(true);
});

test('switch on: a segment opens the existing address and the page opens at the top', async ({
  page,
}) => {
  await open(page, '/operator/research', { v41: true, height: 500 });
  await segments(page).getByRole('link', { name: 'Sources and claims' }).click();
  await expect(page).toHaveURL(/\/operator\/sources\?workspace=/);
  await expect(heading(page).locator('h1')).toHaveText('Companies');
  await expect(segments(page).locator('a[aria-current="page"]')).toHaveText('Sources and claims');
  await expect(heading(page).locator('.ux-frame-helper')).toHaveText(
    'Where each piece of information came from and what it claims.',
  );
  await expect(page.locator('#workspace-sources')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('#workspace-sources')).not.toBeFocused();
  // No label above the panel heading either.
  await expect(page.getByRole('heading', { name: 'Sources and claims' })).toBeVisible();
  await expect(page.locator('.ux-panel-heading .eyebrow')).toHaveCount(0);
});

test('switch on: an old # link still lands on its section', async ({ page }) => {
  await open(page, '/operator', { v41: true, height: 500 });
  await page.evaluate(() => {
    window.location.hash = 'workspace-evidence';
  });
  await expect(page.locator('#workspace-evidence')).toBeFocused();
  await expect(segments(page).locator('a[aria-current="page"]')).toHaveText('Evidence review');
});

test('switch on: no label above a panel heading and no jump links', async ({ page }) => {
  await open(page, '/operator/missions', { v41: true });
  await expect(heading(page).locator('h1')).toHaveText('Missions');
  await expect(page.getByRole('heading', { name: 'Mission review queue' })).toBeVisible();
  await expect(page.getByText('OPS HOME', { exact: true })).toHaveCount(0);
  await expect(page.locator('nav.ux-operator-workbench')).toHaveCount(0);
  await expect(page.getByText('JUMP TO', { exact: true })).toHaveCount(0);
  await expect(segments(page)).toHaveCount(0);
  await open(page, '/operator/network', { v41: true });
  await expect(heading(page).locator('h1')).toHaveText('Helpers');
});

test('switch on: the segments follow the role', async ({ page }) => {
  await open(page, '/operator/health', { v41: true, role: 'operator' });
  await expect(heading(page).locator('h1')).toHaveText('Status');
  await expect(page.getByRole('navigation', { name: 'Status pages' }).getByRole('link')).toHaveText(
    ['Operations', 'Dashboard', 'Health', 'Readiness'],
  );
  await open(page, '/operator/settings', { v41: true, role: 'admin' });
  await expect(
    page.getByRole('navigation', { name: 'Settings pages' }).getByRole('link'),
  ).toHaveText(['Settings', 'Assistance', 'Control Center', 'Owner page']);
  await expect(
    page.getByRole('navigation', { name: 'Settings pages' }).getByRole('link', {
      name: 'Owner page',
    }),
  ).toHaveAttribute('href', '/operator/owner');
  await open(page, '/operator/audit', { v41: true, role: 'owner' });
  await expect(heading(page).locator('h1')).toHaveText('Team and access');
  await expect(
    page.getByRole('navigation', { name: 'Team and access pages' }).getByRole('link'),
  ).toHaveText(['Audit', 'People and access']);
  // A reviewer may open Assistance but none of the other Settings pages: no row for one link.
  await open(page, '/operator/assistance', { v41: true, role: 'reviewer' });
  await expect(heading(page).locator('h1')).toHaveText('Settings');
  await expect(segments(page)).toHaveCount(0);
});

test('the scanning line: on every page with the switch off, on Status pages only with it on', async ({
  page,
}) => {
  const line = page.locator('p.operator-scope-note');
  await open(page, '/operator/research', { v41: false, real: true });
  await expect(line).toContainText('Evidence scanning is deferred');
  await open(page, '/operator/research', { v41: true, real: true });
  await expect(line).toHaveCount(0);
  await open(page, '/operator/health', { v41: true, real: true });
  await expect(line).toContainText('Evidence scanning is deferred');
});

for (const v41 of [false, true]) {
  test(`switch ${v41 ? 'on' : 'off'}: six widths without sideways scroll, 44 px targets, axe clean`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await open(page, '/operator/sources', { v41, width });
      await expect(heading(page).locator('h1')).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`d4-sources-${v41 ? 'on' : 'off'}-${width}.png`),
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `no sideways scroll at ${width}`).toBeLessThanOrEqual(0);
      if (v41) {
        for (const box of await segments(page)
          .getByRole('link')
          .evaluateAll((links) => links.map((a) => a.getBoundingClientRect().height)))
          expect(box, `44 px segment at ${width}`).toBeGreaterThanOrEqual(44);
        const inside = await segments(page).evaluate((nav) => {
          const row = nav.getBoundingClientRect();
          return row.left >= 0 && row.right <= document.documentElement.clientWidth;
        });
        expect(inside, `segments inside the page at ${width}`).toBe(true);
      }
      const results = await new AxeBuilder({ page })
        .include('main#main > header.ux-page-heading')
        .include(v41 ? 'main#main nav.ux-segments' : 'main#main nav.ux-team-second')
        .analyze();
      expect(results.violations, `axe at ${width}`).toEqual([]);
    }
  });
}

test('switch on: the segments work from the keyboard and show their focus', async ({ page }) => {
  await open(page, '/operator/research', { v41: true });
  const link = segments(page).getByRole('link', { name: 'Evidence review' });
  await link.focus();
  const outline = await link.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/operator\/evidence\?workspace=/);
});
