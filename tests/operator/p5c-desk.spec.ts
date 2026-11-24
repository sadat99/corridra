import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fixtureCandidate,
  fixtureMission,
  fixtureTenant,
  startP5cFixture,
} from './p5c-desk-fixture';
import { answerReads, catalogue, type World } from './p5c-desk-world';

// Team desk v4.1, units D17 (Settings), D18 (Inbox) and D19 (Supply), behind CORRIDRA_UX_TEAM_DESK_V41, measured
// with the real stylesheets. Off, each page is the one the desk has today: the Settings panel and the Supply page
// are compared with markup recorded from the code before these units (tests/operator/golden/p5c-*.golden). On:
// Settings shows its routes first with the state of each newest pack and one row only under the title; the lists
// that sat inside Settings are on the Inbox page, where nothing is read and no count is shown before a person
// presses Load; the Supply pages carry the shared header. No form, payload, address or role check changes.
let fixture: Awaited<ReturnType<typeof startP5cFixture>>;
test.beforeAll(async () => {
  fixture = await startP5cFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

type Options = {
  v41: boolean;
  role?: string;
  width?: number;
  height?: number;
  world?: Partial<World>;
  /** Extra words for the address, for example `tab=settings-erasure` or `reports=off`. */
  query?: string;
  hash?: string;
};
async function open(page: Page, path: string, options: Options) {
  const { v41, role = 'owner', width = 1440, height = 900, query = '', hash = '' } = options;
  await page.setViewportSize({ width, height });
  const world = await answerReads(page, { role, ...options.world });
  // The fixture keeps its switches for the tab, so every one is named on every visit; the caller's words win.
  const words = new URLSearchParams({
    workspace: fixtureTenant,
    v41: v41 ? 'on' : 'off',
    role,
    reports: 'on',
    applications: 'on',
  });
  for (const [name, value] of new URLSearchParams(query)) words.set(name, value);
  await page.goto(`${fixture.origin}${path}?${words}${hash ? '#' + hash : ''}`);
  return world;
}
async function openWorkspace(page: Page, path: string, options: Options) {
  const world = await open(page, path, options);
  await expect(page.getByLabel('Workspace status')).toBeAttached();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
  return world;
}
const heading = (page: Page) => page.locator('main#main > header.ux-page-heading');
const settings = (page: Page) => page.locator('#workspace-settings');
const golden = (name: string) =>
  readFileSync(resolve(`tests/operator/golden/${name}`), 'utf8').trim();
/**
 * The markup of the elements a selector finds, as the page drew them. White space is folded, and the ids React
 * makes up for a tab and its panel are reduced to their fixed part: they count components, so they differ between
 * two pages that draw the same thing.
 */
const markup = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((elements) =>
    elements
      .map((element) => element.outerHTML)
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/_r_[0-9a-z]+_/g, '_r_')
      .trim(),
  );
const listReads = (world: World) =>
  world.asked.filter(
    (line) =>
      /^GET \/api\/workspace\/(problem-reports|customer-erasure-queue|programme-applications)/.test(
        line,
      ) ||
      (line.startsWith('GET /api/helper-interest') && !line.includes('view=installed')),
  );
async function noSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}
/**
 * Owner, 24 Nov 2026: "Avoid unnecessary repetition of navigation links on a single screen". Every address a
 * link in the page leads to, with the switch on: none may appear twice.
 */
async function noRepeatedLinks(page: Page, links = 'main#main a[href]') {
  const hrefs = await page
    .locator(links)
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  const twice = hrefs.filter((href, index) => hrefs.indexOf(href) !== index);
  expect(twice, `addresses linked more than once: ${twice.join(', ')}`).toEqual([]);
  return hrefs;
}
async function axeClean(page: Page) {
  const result = await new AxeBuilder({ page }).include('main#main').analyze();
  expect(result.violations.map((violation) => violation.id)).toEqual([]);
}

test.describe('Settings (D17)', () => {
  test('switch off: the Settings panel is the markup it was', async ({ page }) => {
    await openWorkspace(page, '/operator/settings', {
      v41: false,
      query: 'reports=off&applications=off',
    });
    await expect(settings(page).locator('.ux-settings-counts')).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible();
    await expect(settings(page).locator('.settings-routes')).toHaveCount(0);
    expect(await markup(page, '.ux-panel:has(> .ux-subtabs #workspace-settings)')).toBe(
      golden('p5c-settings-off.golden'),
    );
  });

  test('switch on: routes first, each with the state of its newest pack', async ({ page }) => {
    await openWorkspace(page, '/operator/settings', { v41: true });
    const list = settings(page).locator('.settings-routes');
    await expect(list.getByRole('heading', { level: 2, name: 'Routes' })).toBeVisible();
    // The routes are the first thing in the panel.
    expect(await settings(page).evaluate((panel) => panel.firstElementChild?.className ?? '')).toBe(
      'settings-routes',
    );
    const rows = list.locator('li');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('.settings-route-name')).toHaveText('Bangladesh to China');
    // The newest pack (version 2, active), not the older draft.
    await expect(rows.nth(0).locator('.settings-route-pack')).toHaveText('Active Pack version 2');
    await expect(rows.nth(1).locator('.settings-route-name')).toHaveText(
      'Bangladesh to European Union',
    );
    await expect(rows.nth(1).locator('.settings-route-pack')).toHaveText('Testing Pack version 1');
    await expect(rows.nth(2).locator('.settings-route-pack')).toHaveText('No pack yet');
    // UI/UX.v4.1 L1: a flag before a place that has one, never alone, 40 px in a route row; a contested place
    // shows its name only.
    await expect(rows.nth(0).locator('img.ux-flag')).toHaveCount(2);
    expect(
      await rows
        .nth(0)
        .locator('img.ux-flag')
        .evaluateAll((flags) =>
          flags.map((flag) => [flag.getAttribute('data-flag'), flag.clientWidth]),
        ),
    ).toEqual([
      ['bd', 40],
      ['cn', 40],
    ]);
    await expect(rows.nth(1).locator('img[data-flag="eu"]')).toHaveCount(1);
    await expect(rows.nth(2).locator('.settings-route-name')).toHaveText('Taiwan to Australia');
    await expect(rows.nth(2).locator('img.ux-flag')).toHaveCount(1);
    await expect(rows.nth(2).locator('img[data-flag="au"]')).toHaveCount(1);
    // The same places further down the page are named the same way (the reference list and the pack form).
    await settings(page).getByText('Current route packs and definition references').click();
    const references = settings(page).locator('.ux-settings-sections > details').last();
    await expect(references.locator('ul').first().locator('li').first()).toHaveText(
      'Bangladesh to China · 00000000-0000-4000-8000-000000000101',
    );
    await expect(references).not.toContainText('→');
    // Decision 3: route and qualification stay two steps. Nothing on this page ties one to the other.
    await expect(settings(page)).not.toContainText(/qualif/i);
    // No label above a heading, no jump links, one h1.
    await expect(settings(page).locator('.eyebrow')).toHaveCount(0);
    await expect(page.locator('nav.ux-operator-workbench')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(heading(page).locator('h1')).toHaveText('Settings');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('switch on: one row only under the title, and the other Settings pages stay', async ({
    page,
  }) => {
    await openWorkspace(page, '/operator/settings', { v41: true });
    const nav = page.getByRole('navigation', { name: 'Settings pages' });
    await expect(nav.getByRole('link')).toHaveText([
      'Settings',
      'Assistance',
      'Control Center',
      'Owner page',
    ]);
    expect(
      await nav.getByRole('link').evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
    ).toEqual([
      `/operator/settings?workspace=${fixtureTenant}`,
      `/operator/assistance?workspace=${fixtureTenant}`,
      `/operator/control-center?workspace=${fixtureTenant}`,
      `/operator/owner`,
    ]);
    // The second row (the tabs that held the lists) is gone: no tablist on the Settings page.
    await expect(page.locator('main#main [role="tablist"]')).toHaveCount(0);
    await expect(page.locator('main#main nav.ux-desk-segments')).toHaveCount(1);
    // The lists are not drawn here any more.
    await expect(page.locator('#erasure-queue-title')).toHaveCount(0);
    await expect(page.locator('#problem-report-queue')).toHaveCount(0);
  });

  test('switch on: every section and form of the page is still there, with the same fields', async ({
    page,
  }) => {
    const fields = async (v41: boolean) => {
      await openWorkspace(page, '/operator/settings', { v41 });
      await expect(settings(page).locator('.ux-settings-counts')).toBeVisible();
      return settings(page).evaluate((panel) => ({
        summaries: Array.from(
          panel.querySelectorAll(':scope .ux-settings-sections > details > summary'),
        ).map((summary) => `${summary.getAttribute('data-step')} ${summary.textContent?.trim()}`),
        controls: Array.from(
          // The jump links are the one thing the pattern takes away (unit D4); every other control stays.
          panel.querySelectorAll<HTMLInputElement>(
            ':scope :is(input, select, textarea, button):not(.ux-operator-workbench *)',
          ),
        ).map(
          (control) =>
            `${control.tagName} ${control.name} ${control.type} ${control.textContent?.trim().slice(0, 40)}`,
        ),
        links: Array.from(panel.querySelectorAll('.ux-settings-head a')).map(
          (link) => `${link.getAttribute('href')} ${link.textContent}`,
        ),
        words: panel.querySelector('.ux-settings-head > p')?.textContent,
        note: panel.querySelectorAll('.ux-settings-head').length,
        counts: panel.querySelector('.ux-settings-counts')?.textContent,
      }));
    };
    const off = await fields(false);
    const on = await fields(true);
    // The links to menu places are not repeated in the page with the switch on; everything else is the same.
    expect(off.links).toEqual([
      '#workspace-navigation Back to workspace sections',
      '#workspace-sources Find source references',
      '#workspace-authenticator Confirm your authenticator',
      '#workspace-controls Workspace switches',
    ]);
    expect(on.links).toEqual([]);
    expect({ ...on, links: off.links }).toEqual(off);
    expect(on.summaries).toEqual([
      '01 Prepare commercial mission templates',
      '02 Create a directional corridor route',
      '04 Advanced (developers): versioned policy review',
      '05 Current route packs and definition references',
    ]);
  });

  test('switch on: creating a route sends what it always sent', async ({ page }) => {
    const sent: Record<string, unknown>[] = [];
    const create = async (v41: boolean) => {
      await openWorkspace(page, '/operator/settings', { v41 });
      await page.route('**/api/workspace/corridor-route?*', (route) => {
        sent.push({
          url: new URL(route.request().url()).search,
          method: route.request().method(),
          ...(route.request().postDataJSON() as Record<string, unknown>),
        });
        return route.fulfill({ json: { id: '00000000-0000-4000-8000-000000000999' } });
      });
      await settings(page).getByText('Create a directional corridor route').click();
      await page.getByLabel('Demand-origin market').selectOption('BD');
      await page.getByLabel('Target market').selectOption('CN');
      await page.getByLabel('Route review reason').fill('Synthetic route for the fixture');
      await page.getByRole('button', { name: 'Create Reviewed Route' }).click();
      await expect(
        page.getByText('Saved reference: 00000000-0000-4000-8000-000000000999'),
      ).toBeVisible();
    };
    await create(false);
    await create(true);
    expect(sent).toHaveLength(2);
    const [off, on] = sent.map(({ id, ...rest }) => {
      expect(String(id)).toMatch(/^[0-9a-f-]{36}$/);
      return rest;
    });
    expect(on).toEqual(off);
    expect(on).toEqual({
      url: `?tenant=${fixtureTenant}`,
      method: 'POST',
      origin: 'BD',
      destination: 'CN',
      reason: 'Synthetic route for the fixture',
    });
  });

  test('switch on: no route yet, a failed read and more than five routes each say so', async ({
    page,
  }) => {
    await openWorkspace(page, '/operator/settings', {
      v41: true,
      world: { catalogue: { ...catalogue, routes: [], packs: [] } },
    });
    await expect(settings(page).locator('.settings-routes')).toContainText(
      'No route yet. Open Create a directional corridor route below to add the first one.',
    );
    await openWorkspace(page, '/operator/settings', {
      v41: true,
      world: { catalogue: { status: 503 } },
    });
    await expect(settings(page).locator('.settings-routes')).toContainText(
      'Routes are unavailable. Refresh reviewed configuration to try again.',
    );
    const many = ['CN', 'EU', 'GB', 'US', 'AU', 'ES', 'FR'].map((destination, index) => ({
      id: `00000000-0000-4000-8000-0000000009${String(index).padStart(2, '0')}`,
      origin_market: 'BD',
      destination_market: destination,
    }));
    await openWorkspace(page, '/operator/settings', {
      v41: true,
      world: { catalogue: { ...catalogue, routes: many, packs: [] } },
    });
    const rows = settings(page).locator('.settings-routes li');
    await expect(rows).toHaveCount(7);
    await expect(rows.locator('visible=true')).toHaveCount(5);
    await page.getByRole('button', { name: 'Show all 7 routes' }).click();
    await expect(rows.locator('visible=true')).toHaveCount(7);
  });

  test('switch on: an old address of a list inside Settings leads to the Inbox', async ({
    page,
  }) => {
    // The workspace leaves as soon as it has read the role, so each visit waits for the Inbox address itself.
    await open(page, '/operator/settings', { v41: true, query: 'tab=settings-erasure' });
    await expect(page).toHaveURL(
      new RegExp(`/operator/inbox\\?workspace=${fixtureTenant}&tab=erasure$`),
    );
    await expect(page.getByRole('tab', { name: 'Erasure requests' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await open(page, '/operator', { v41: true, hash: 'problem-report-queue' });
    await expect(page).toHaveURL(
      new RegExp(`/operator/inbox\\?workspace=${fixtureTenant}#problem-report-queue$`),
    );
    await expect(page.getByRole('tab', { name: 'Problem reports' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#problem-report-queue')).toHaveAttribute('open', '');
    await open(page, '/operator', { v41: true, hash: 'programme-application-queue' });
    await expect(page).toHaveURL(
      /\/operator\/inbox\?workspace=[0-9a-f-]+#programme-application-queue$/,
    );
    await expect(page.getByRole('tab', { name: 'Programme applications' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('switch off: the lists stay inside Settings and their addresses stay', async ({ page }) => {
    await openWorkspace(page, '/operator/settings', { v41: false, query: 'tab=settings-erasure' });
    await expect(page).toHaveURL(/\/operator\/settings\?/);
    await expect(page.getByRole('tab', { name: 'Erasure requests' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#erasure-queue-title')).toBeVisible();
    await openWorkspace(page, '/operator', { v41: false, hash: 'problem-report-queue' });
    await expect(page).toHaveURL(/\/operator\?[^#]*#problem-report-queue$/);
    await expect(page.locator('#problem-report-queue')).toBeVisible();
  });

  test('switch on: a role without Settings is not sent anywhere', async ({ page }) => {
    await openWorkspace(page, '/operator', {
      v41: true,
      role: 'operator',
      hash: 'problem-report-queue',
    });
    await expect(page.getByLabel('Workspace status')).toBeAttached();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/operator\?[^#]*#problem-report-queue$/);
  });

  test('switch on: no address is linked twice on the Settings page', async ({ page }) => {
    await openWorkspace(page, '/operator/settings', { v41: true });
    await expect(settings(page).locator('.settings-routes li')).toHaveCount(3);
    const hrefs = await noRepeatedLinks(page);
    await expect(page.locator('main#main nav.ux-team-second')).toHaveCount(0);
    // No "Back to" link and no link to a menu place inside the Settings panel.
    expect(
      await settings(page)
        .locator('a[href]')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual([]);
    expect(hrefs.filter((href) => href.includes('/operator/settings'))).toHaveLength(1);
  });

  for (const width of [320, 390, 768, 1024, 1440, 1920])
    test(`switch on: Settings fits ${width} px and is axe clean`, async ({ page }) => {
      await openWorkspace(page, '/operator/settings', { v41: true, width });
      await expect(settings(page).locator('.settings-routes li')).toHaveCount(3);
      // The standing note keeps a readable measure on every width (it was a narrow column at 1024 px).
      const note = await settings(page).locator('.ux-settings-head > p').boundingBox();
      expect(note!.width).toBeGreaterThanOrEqual(Math.min(width - 96, 400));
      await noSidewaysScroll(page);
      await axeClean(page);
    });
});

test.describe('Inbox (D18)', () => {
  test('switch off: the page does not exist', async ({ page }) => {
    await open(page, '/operator/inbox', { v41: false });
    await expect(
      page.getByRole('heading', { name: 'This page could not be found.' }),
    ).toBeVisible();
    await expect(page.locator('[role="tablist"]')).toHaveCount(0);
    // The server page answers the same way: it is not found unless both switches are on.
    const source = readFileSync(resolve('apps/web/app/operator/inbox/page.tsx'), 'utf8');
    expect(source).toContain(
      "if (!uxSwitchOn('CORRIDRA_UX_SHELLS_V2') || !uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41')) notFound();",
    );
  });

  test('switch on: one page, four lists in one row, the page pattern', async ({ page }) => {
    await open(page, '/operator/inbox', { v41: true });
    const head = heading(page);
    await expect(head.locator('h1')).toHaveText('Inbox');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(head.locator('p.label')).toHaveCount(0);
    await expect(head.locator('.ux-frame-helper')).toHaveText(
      'Problem reports, erasure requests, programme applications and helper interest.',
    );
    expect(await head.locator('.ux-frame-primary > *').count()).toBe(0);
    expect(await head.locator('h1').evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
      'newsreader',
    );
    await expect(page.locator('main#main')).toHaveClass(/ux-desk-frame/);
    const tabs = page.getByRole('tablist', { name: 'Inbox lists' }).getByRole('tab');
    await expect(tabs).toHaveText([
      'Problem reports',
      'Erasure requests',
      'Programme applications',
      'Helper interest',
    ]);
    // One row only: one tablist, no segments, no second level.
    await expect(page.locator('main#main [role="tablist"]')).toHaveCount(1);
    await expect(page.locator('main#main nav.ux-desk-segments')).toHaveCount(0);
    await expect(page.locator('main#main nav.ux-team-second')).toHaveCount(0);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    // The menu (unit D3) leads here and lights Inbox as the page in view, with no number beside it.
    const menu = page.locator('#workspace-navigation');
    const item = menu.getByRole('link', { name: 'Inbox', exact: true });
    await expect(item).toHaveAttribute('href', `/operator/inbox?workspace=${fixtureTenant}`);
    await expect(item).toHaveAttribute('aria-current', 'page');
    await expect(menu.locator('[aria-current]')).toHaveCount(1);
    expect(await menu.innerText()).not.toMatch(/\d/);
    // The list in view is open under its tab, and the page opens at the top.
    await expect(page.locator('#problem-report-queue')).toHaveAttribute('open', '');
    await expect(page.getByRole('button', { name: 'Load Problem Reports' })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('switch on: nothing is read and no count is shown before a person presses Load', async ({
    page,
  }) => {
    const world = await open(page, '/operator/inbox', { v41: true });
    await expect(page.getByRole('tab', { name: 'Helper interest' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(listReads(world)).toEqual([]);
    // No number in the title, the purpose line, a tab or the menu.
    for (const part of [
      heading(page),
      page.getByRole('tablist', { name: 'Inbox lists' }),
      page.locator('#workspace-navigation'),
    ])
      expect(await part.innerText()).not.toMatch(/\d/);
    // The lists work as they did: Load reads the list and its own figures follow.
    await page.getByRole('button', { name: 'Load Problem Reports' }).click();
    await expect(page.getByText('RP-000001')).toBeVisible();
    expect(listReads(world)).toHaveLength(1);
    expect(listReads(world)[0]).toContain('/api/workspace/problem-reports');
    // Still no number in the tab row or the title after the read.
    expect(await page.getByRole('tablist', { name: 'Inbox lists' }).innerText()).not.toMatch(/\d/);
    expect(await heading(page).innerText()).not.toMatch(/\d/);
  });

  test('switch on: each tab shows its list, opened, and the lists are the ones the desk had', async ({
    page,
  }) => {
    await open(page, '/operator/inbox', { v41: true });
    await page.getByRole('tab', { name: 'Erasure requests' }).click();
    await expect(page).toHaveURL(/[?&]tab=erasure/);
    await expect(page.getByRole('heading', { level: 2, name: 'Erasure Requests' })).toBeVisible();
    await page.getByRole('button', { name: 'Load Erasure Requests' }).click();
    await expect(page.getByText('ER-000001')).toBeVisible();
    await page.getByRole('tab', { name: 'Programme applications' }).click();
    await expect(page.locator('#programme-application-queue')).toHaveAttribute('open', '');
    await page.getByRole('button', { name: 'Load Applications' }).click();
    await expect(page.getByText('Synthetic applicant 1')).toBeVisible();
    await page.getByRole('tab', { name: 'Helper interest' }).click();
    await expect(page.locator('#helper-interest-list')).toHaveAttribute('open', '');
    await page.getByRole('button', { name: 'Load Entries' }).click();
    await expect(page.getByText('Synthetic Helper')).toBeVisible();
    // UI/UX.v4.1 L1: the country is its mark and its name, not a code alone.
    const country = page.locator('#helper-interest-list .pr-queue-row .ux-badge');
    await expect(country).toHaveText('Bangladesh');
    await expect(country.locator('img.ux-flag[data-flag="bd"]')).toHaveCount(1);
    // A list the person closes stays closed.
    await page.locator('#helper-interest-list > summary').click();
    await page.getByRole('tab', { name: 'Problem reports' }).click();
    await page.getByRole('tab', { name: 'Helper interest' }).click();
    await expect(page.locator('#helper-interest-list')).not.toHaveAttribute('open', '');
  });

  test('switch on: the tabs work from the keyboard and an old tab word still lands', async ({
    page,
  }) => {
    await open(page, '/operator/inbox', { v41: true });
    await page.getByRole('tab', { name: 'Problem reports' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Erasure requests' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Erasure requests' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Helper interest' })).toBeFocused();
    await open(page, '/operator/inbox', { v41: true, hash: 'settings-applications' });
    await expect(page.getByRole('tab', { name: 'Programme applications' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await open(page, '/operator/inbox', { v41: true, hash: 'erasure-queue-title' });
    await expect(page.getByRole('tab', { name: 'Erasure requests' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('switch on: a list that is not offered has no tab', async ({ page }) => {
    await open(page, '/operator/inbox', {
      v41: true,
      query: 'reports=off&applications=off',
      world: { helperInterest: false },
    });
    await expect(page.getByRole('heading', { level: 2, name: 'Erasure Requests' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('tablist', { name: 'Inbox lists' }).getByRole('tab')).toHaveText([
      'Erasure requests',
    ]);
  });

  test('switch on: a role that may not read the lists is told so and nothing is read', async ({
    page,
  }) => {
    const world = await open(page, '/operator/inbox', { v41: true, role: 'operator' });
    await expect(page.getByRole('alert')).toHaveText('Only owners and admins can open the Inbox.');
    // The menu is the way out: no link to a menu place is repeated in the page.
    await expect(page.locator('main#main a[href]')).toHaveCount(0);
    await expect(page.locator('[role="tablist"]')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(world.asked.filter((line) => !line.includes('/api/notifications'))).toEqual([]);
  });

  test('switch on: no address is linked twice on the Inbox page, with every list read', async ({
    page,
  }) => {
    await open(page, '/operator/inbox', { v41: true });
    await page.getByRole('button', { name: 'Load Problem Reports' }).click();
    await expect(page.getByText('RP-000001')).toBeVisible();
    await page.getByRole('tab', { name: 'Erasure requests' }).click();
    await page.getByRole('button', { name: 'Load Erasure Requests' }).click();
    await expect(page.getByText('ER-000001')).toBeVisible();
    await page.getByRole('tab', { name: 'Programme applications' }).click();
    await page.getByRole('button', { name: 'Load Applications' }).click();
    await expect(page.getByText('Synthetic applicant 1')).toBeVisible();
    await page.getByRole('tab', { name: 'Helper interest' }).click();
    await page.getByRole('button', { name: 'Load Entries' }).click();
    await expect(page.getByText('Synthetic Helper')).toBeVisible();
    const hrefs = await noRepeatedLinks(page);
    // No link to a menu place: the menu is the one way to another place.
    expect(hrefs.filter((href) => /^\/operator(\?|#|$)/.test(href))).toEqual([]);
  });

  for (const width of [320, 390, 768, 1024, 1440, 1920])
    test(`switch on: the Inbox fits ${width} px and is axe clean`, async ({ page }) => {
      await open(page, '/operator/inbox', { v41: true, width });
      await expect(page.getByRole('tab', { name: 'Helper interest' })).toBeVisible();
      await noSidewaysScroll(page);
      await axeClean(page);
      if (width <= 768)
        for (const box of await page
          .getByRole('tab')
          .evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().height)))
          expect(box).toBeGreaterThanOrEqual(44);
    });
});

test.describe('Supply (D19)', () => {
  const supplyWorld = { supply: 'empty' } as const;
  test('switch off: the Supply page is the markup it was', async ({ page }) => {
    await open(page, '/operator/supply', { v41: false, world: supplyWorld });
    await expect(page.getByRole('tablist', { name: 'Supply sections' })).toBeVisible();
    await expect(page.getByText('No sources yet.', { exact: false }).first()).toBeAttached();
    await expect(heading(page).locator('p.label')).toHaveText('TEAM WORKSPACE');
    await expect(heading(page).locator('.ux-frame-helper')).toHaveCount(0);
    expect(await markup(page, 'main#main')).toBe(golden('p5c-supply-off.golden'));
  });

  test('switch on: the shared header, the intro said once, everything else as it was', async ({
    page,
  }) => {
    await open(page, '/operator/supply', { v41: true });
    const head = heading(page);
    await expect(head.locator('p.label')).toHaveCount(0);
    await expect(head.locator('h1')).toHaveText('Supply Sources');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(head.locator('.ux-frame-helper')).toHaveText(
      'Where candidate companies come from, and the rules each source follows.',
    );
    await expect(
      page.getByText('Where candidate companies come from, and the rules each source follows.'),
    ).toHaveCount(1);
    expect(await head.locator('.ux-frame-primary > *').count()).toBe(0);
    await expect(page.locator('main#main')).toHaveClass(/ux-desk-frame/);
    // The purpose line sits under the title, on its left edge.
    const [titleBox, lineBox] = await Promise.all([
      head.locator('h1').boundingBox(),
      head.locator('.ux-frame-helper').boundingBox(),
    ]);
    expect(lineBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height - 1);
    expect(Math.abs(lineBox!.x - titleBox!.x)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('link', { name: 'Do Not Contact' })).toHaveAttribute(
      'href',
      `/operator/supply/do-not-contact?workspace=${fixtureTenant}`,
    );
    await expect(
      page.getByRole('tablist', { name: 'Supply sections' }).getByRole('tab'),
    ).toHaveText(['Sources', 'Missions', 'Route Kinds']);
    await expect(page.locator('main#main [role="tablist"]')).toHaveCount(1);
    await expect(page.getByText('Trade register of Spain')).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  const pages = [
    {
      path: '/operator/supply/do-not-contact',
      title: 'Do Not Contact',
      purpose: 'The companies Corridra must not contact.',
    },
    {
      path: `/operator/supply/missions/${fixtureMission}`,
      title: 'Supply Candidates',
      purpose: 'The candidate companies found for one mission, each with its source.',
    },
    {
      path: `/operator/supply/missions/${fixtureMission}/candidates/${fixtureCandidate}`,
      title: 'Candidate',
      purpose: 'One candidate company with its source, its review and its match.',
    },
  ];
  for (const entry of pages)
    test(`switch on: ${entry.title} keeps its title and gets its purpose line`, async ({
      page,
    }) => {
      await open(page, entry.path, { v41: false });
      await expect(heading(page).locator('h1')).toHaveText(entry.title);
      await expect(heading(page).locator('p.label')).toHaveText('TEAM WORKSPACE');
      await expect(heading(page).locator('.ux-frame-helper')).toHaveCount(0);
      const before = await markup(page, 'main#main > :not(header)');
      await open(page, entry.path, { v41: true });
      await expect(heading(page).locator('h1')).toHaveText(entry.title);
      await expect(heading(page).locator('p.label')).toHaveCount(0);
      await expect(heading(page).locator('.ux-frame-helper')).toHaveText(entry.purpose);
      await expect(page.locator('h1')).toHaveCount(1);
      // Under the header the page is the one it was. On the candidate page the country code alone becomes its
      // mark and name (UI/UX.v4.1 L1); nothing else differs.
      const after = await markup(page, 'main#main > :not(header)');
      if (entry.title === 'Candidate') {
        const country = page.locator('dt:text-is("Country") + dd');
        await expect(country).toHaveText('Spain');
        await expect(country.locator('img.ux-flag[data-flag="es"]')).toHaveCount(1);
        expect(before).toContain('<dt>Country</dt><dd>ES</dd>');
        expect(after.replace(/<dt>Country<\/dt><dd>.*?<\/dd>/, '<dt>Country</dt><dd>ES</dd>')).toBe(
          before,
        );
      } else if (entry.title === 'Do Not Contact') {
        // The sentence that is now the purpose line is said once; the rest of the intro stays.
        const first = 'Companies Corridra must not contact. A block stops';
        expect(before).toContain(first);
        expect(
          after.replace(
            '<p class="supply-quiet">A block stops',
            `<p class="supply-quiet">${first}`,
          ),
        ).toBe(before);
        await expect(page.getByText('Companies Corridra must not contact.')).toHaveCount(1);
      } else expect(after).toBe(before);
    });

  test('switch on: no address is linked twice on a Supply page', async ({ page }) => {
    await open(page, '/operator/supply', { v41: true });
    await expect(page.getByText('Trade register of Spain')).toBeVisible();
    await noRepeatedLinks(page);
    for (const entry of pages) {
      await open(page, entry.path, { v41: true });
      await expect(heading(page).locator('.ux-frame-helper')).toHaveText(entry.purpose);
      await page.waitForLoadState('networkidle');
      const hrefs = await noRepeatedLinks(page);
      // A breadcrumb only on a page deeper than one level under Supply.
      const crumbs = await page.getByRole('navigation', { name: 'Breadcrumb' }).count();
      expect(crumbs).toBe(entry.title === 'Do Not Contact' ? 0 : 1);
      expect(hrefs.length).toBeGreaterThanOrEqual(crumbs);
    }
  });

  for (const width of [320, 390, 768, 1024, 1440, 1920])
    test(`switch on: Supply fits ${width} px and is axe clean`, async ({ page }) => {
      await open(page, '/operator/supply', { v41: true, width });
      await expect(page.getByText('Trade register of Spain')).toBeVisible();
      await noSidewaysScroll(page);
      await axeClean(page);
    });
});
