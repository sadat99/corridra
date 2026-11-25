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
/** The page under its header, without the head line of a Supply page (the breadcrumb row), folded like `markup`. */
const bodyMarkup = (page: Page) =>
  page.locator('main#main').evaluate((main) => {
    const copy = main.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(':scope > header, .supply-head').forEach((part) => part.remove());
    return copy.innerHTML
      .replace(/\s+/g, ' ')
      .replace(/_r_[0-9a-z]+_/g, '_r_')
      .trim();
  });
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
      'Routes and settings',
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
    // The numbers count what is drawn with the switch on, so none is skipped; off they are what they were.
    expect(off.summaries).toEqual([
      '01 Prepare commercial mission templates',
      '02 Create a directional corridor route',
      '04 Advanced (developers): versioned policy review',
      '05 Current route packs and definition references',
    ]);
    expect(on.summaries).toEqual([
      '01 Prepare commercial mission templates',
      '02 Create a directional corridor route',
      '03 Advanced (developers): versioned policy review',
      '04 Current route packs and definition references',
    ]);
    expect({ ...on, links: off.links, summaries: off.summaries }).toEqual(off);
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
    // The helper interest register is asked once whether it is installed, not once by the page and once by the list.
    await page.getByRole('tab', { name: 'Helper interest' }).click();
    await expect(page.locator('#helper-interest-list')).toHaveAttribute('open', '');
    await page.waitForLoadState('networkidle');
    expect(world.asked.filter((line) => line.includes('view=installed'))).toHaveLength(1);
    await page.getByRole('tab', { name: 'Problem reports' }).click();
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

  test('switch on: after one list is read, the tab that opens loads its list without Load (staff-core-29)', async ({
    page,
  }) => {
    const world = await open(page, '/operator/inbox', { v41: true });
    // Before any read, opening a tab reads nothing.
    await page.getByRole('tab', { name: 'Erasure requests' }).click();
    await page.getByRole('tab', { name: 'Problem reports' }).click();
    await page.waitForLoadState('networkidle');
    expect(listReads(world)).toEqual([]);
    await page.getByRole('button', { name: 'Load Problem Reports' }).click();
    await expect(page.getByText('RP-000001')).toBeVisible();
    // The check has been passed once: each tab opened from now on reads its own list, once.
    await page.getByRole('tab', { name: 'Erasure requests' }).click();
    await expect(page.getByText('ER-000001')).toBeVisible();
    await page.getByRole('tab', { name: 'Programme applications' }).click();
    await expect(page.getByText('Synthetic applicant 1')).toBeVisible();
    await page.getByRole('tab', { name: 'Helper interest' }).click();
    await expect(page.getByText('Synthetic Helper')).toBeVisible();
    await page.getByRole('tab', { name: 'Erasure requests' }).click();
    await page.waitForLoadState('networkidle');
    const reads = listReads(world);
    expect(reads).toHaveLength(4);
    expect(reads.filter((line) => line.includes('customer-erasure-queue'))).toHaveLength(1);
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
      const before = await bodyMarkup(page);
      const headBefore = await page.locator('.supply-head').count();
      if (headBefore) {
        // Off: the way back as it was, and the link to Do Not Contact on every page under Supply Sources.
        await expect(
          page.locator('.supply-head nav[aria-label="Breadcrumb"] a.text-link').first(),
        ).toHaveText('Supply Sources');
        await expect(page.locator('.supply-head nav.ux-kit-crumbs')).toHaveCount(0);
        await expect(
          page.locator('.supply-head').getByRole('link', { name: 'Do Not Contact' }),
        ).toHaveCount(1);
      }
      await open(page, entry.path, { v41: true });
      await expect(heading(page).locator('h1')).toHaveText(entry.title);
      await expect(heading(page).locator('p.label')).toHaveCount(0);
      await expect(heading(page).locator('.ux-frame-helper')).toHaveText(entry.purpose);
      await expect(page.locator('h1')).toHaveCount(1);
      // Under the header and the head line the page is the one it was, but for three named things: the country
      // code alone becomes its mark and name (UI/UX.v4.1 L1), the source label line takes the column's width, and
      // the first sentence of the Do Not Contact intro is the purpose line.
      const after = await bodyMarkup(page);
      const first = 'Companies Corridra must not contact. A block stops';
      expect(
        after
          .replace(/<dt>Country<\/dt><dd>.*?<\/dd>/, '<dt>Country</dt><dd>ES</dd>')
          .replace(
            'class="supply-quiet supply-wide">Source-reported.',
            'class="supply-quiet">Source-reported.',
          )
          .replace('<p class="supply-quiet">A block stops', `<p class="supply-quiet">${first}`),
      ).toBe(before);
      if (entry.title === 'Candidate') {
        const country = page.locator('dt:text-is("Country") + dd');
        await expect(country).toHaveText('Spain');
        await expect(country.locator('img.ux-flag[data-flag="es"]')).toHaveCount(1);
        expect(before).toContain('<dt>Country</dt><dd>ES</dd>');
      }
      if (entry.title === 'Do Not Contact') {
        expect(before).toContain(first);
        await expect(page.getByText('Companies Corridra must not contact.')).toHaveCount(1);
        await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
      } else {
        // The shared breadcrumb pattern: an ordered list, each earlier level a link, the page in view last and
        // marked as the current page. Do Not Contact is linked from Supply Sources only.
        const crumbs = page.locator(
          '.supply-head > nav.ux-kit-crumbs[aria-label="Breadcrumb"] > ol > li',
        );
        const trail =
          entry.title === 'Candidate'
            ? ['Supply Sources', 'Supply Candidates', 'Candidate']
            : ['Supply Sources', 'Supply Candidates'];
        await expect(crumbs).toHaveText(trail);
        await expect(crumbs.locator('a')).toHaveText(trail.slice(0, -1));
        await expect(crumbs.first().locator('a')).toHaveAttribute(
          'href',
          `/operator/supply?workspace=${fixtureTenant}`,
        );
        await expect(crumbs.last().locator('[aria-current="page"]')).toHaveText(entry.title);
        await expect(crumbs.last().locator('a')).toHaveCount(0);
        await expect(
          page.locator('main#main').getByRole('link', { name: 'Do Not Contact' }),
        ).toHaveCount(0);
        for (const box of await crumbs
          .locator('a')
          .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height)))
          expect(box).toBeGreaterThanOrEqual(44);
      }
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

test.describe('Team header on a phone (owner review, 24 Nov 2026)', () => {
  const header = (page: Page) => page.locator('.site-shell > .ux-app-header');
  const parts = (page: Page) =>
    header(page).evaluate((bar) =>
      Array.from(bar.querySelectorAll<HTMLElement>(':scope > *, :scope > .ux-app-tools > *'))
        .filter((part) => part.getClientRects().length > 0 && !part.matches('.ux-app-tools'))
        .map((part) => {
          const box = part.getBoundingClientRect();
          return {
            name: part.className.toString().split(' ')[0]!,
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          };
        }),
    );
  for (const width of [320, 375])
    test(`switch on: one row inside 60 px at ${width} px, every control whole`, async ({
      page,
    }) => {
      await open(page, '/operator/inbox', { v41: true, width, height: 700 });
      await expect(page.getByRole('tab', { name: 'Problem reports' })).toBeVisible();
      const bar = (await header(page).boundingBox())!;
      expect(bar.height).toBeLessThanOrEqual(60);
      expect(bar.x).toBe(0);
      expect(bar.width).toBe(width);
      const boxes = await parts(page);
      // The menu button, the mark, the mode label, search, the inbox and the account menu.
      expect(boxes.map((box) => box.name)).toEqual([
        'ux-app-button',
        'brand',
        'ux-app-status',
        'ux-palette-trigger',
        'ux-app-inbox',
        'ux-menu',
      ]);
      for (const [index, box] of boxes.entries()) {
        // One row: every part sits inside the bar, after the part before it, and inside the screen.
        expect(box.top, box.name).toBeGreaterThanOrEqual(bar.y);
        expect(box.bottom, box.name).toBeLessThanOrEqual(bar.y + bar.height);
        expect(box.left, box.name).toBeGreaterThanOrEqual(0);
        expect(box.right, box.name).toBeLessThanOrEqual(width);
        if (index > 0) expect(box.left, box.name).toBeGreaterThanOrEqual(boxes[index - 1]!.right);
        // Every control keeps its 44 px target; the mode label is words, not a control.
        if (box.name !== 'ux-app-status') {
          expect(box.width, box.name).toBeGreaterThanOrEqual(44);
          expect(box.height, box.name).toBeGreaterThanOrEqual(44);
        }
      }
      // The mode label is whole: its words are not cut.
      const label = header(page).locator('.ux-app-status');
      expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await noSidewaysScroll(page);
      const result = await new AxeBuilder({ page }).include('.ux-app-header').analyze();
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
    });

  test('switch off: the header wraps as it did', async ({ page }) => {
    await openWorkspace(page, '/operator/settings', { v41: false, width: 320, height: 700 });
    const bar = (await header(page).boundingBox())!;
    expect(bar.height).toBeGreaterThan(100);
    expect(bar.x).toBe(24);
    // Its tools still take the rows they need.
    expect(
      await header(page)
        .locator('.ux-app-tools')
        .evaluate((el) => getComputedStyle(el).flexWrap),
    ).toBe('wrap');
  });
});

test.describe('Design audit of 24 Nov 2026 (switch on)', () => {
  const screens = (page: Page, height: number) =>
    page.evaluate((h) => document.documentElement.scrollHeight / h, height);
  /** Whether every box sits on one line: each starts after the one before it and none is lower than the first. */
  const oneRow = (boxes: { x: number; y: number; width: number; height: number }[]) =>
    boxes.every(
      (box, index) =>
        Math.abs(box.y + box.height / 2 - (boxes[0]!.y + boxes[0]!.height / 2)) <= box.height / 2 &&
        (index === 0 || box.x >= boxes[index - 1]!.x + boxes[index - 1]!.width - 1),
    );
  const boxes = (page: Page, selector: string) =>
    page.locator(selector).evaluateAll((parts) =>
      parts.map((part) => {
        const box = part.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );

  test('Settings: "to" stays with its destination, the counts are one line below 40 rem, two phone screens at most', async ({
    page,
  }) => {
    await openWorkspace(page, '/operator/settings', { v41: true, width: 320, height: 844 });
    await expect(settings(page).locator('.settings-routes li')).toHaveCount(3);
    // The word "to" and the destination are one unbreakable part of the row.
    for (const end of await boxes(page, '.settings-route-end')) expect(end.height).toBeLessThan(40);
    expect(
      await page
        .locator('.settings-route-end')
        .first()
        .evaluate((el) => getComputedStyle(el).whiteSpace),
    ).toBe('nowrap');
    // The three counts read as text on a line, not as three tiles.
    const counts = await boxes(page, '.ux-settings-counts > div');
    expect(counts).toHaveLength(3);
    for (const count of counts) expect(count.height).toBeLessThan(28);
    expect(
      await page
        .locator('.ux-settings-counts > div')
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.flexDirection, style.borderTopWidth, style.paddingTop];
        }),
    ).toEqual(['row', '0px', '0px']);
    expect(await screens(page, 844)).toBeLessThanOrEqual(2);
    await openWorkspace(page, '/operator/settings', { v41: true, width: 390, height: 844 });
    await expect(settings(page).locator('.settings-routes li')).toHaveCount(3);
    expect(await screens(page, 844)).toBeLessThanOrEqual(2);
    // From 40 rem the counts are the tiles they were.
    await openWorkspace(page, '/operator/settings', { v41: true, width: 768, height: 1024 });
    await expect(settings(page).locator('.ux-settings-counts')).toBeVisible();
    expect((await boxes(page, '.ux-settings-counts > div'))[0]!.height).toBeGreaterThan(40);
  });

  test('Inbox: the moves of a report sit on its line of facts from 48 rem, and a phone keeps two screens', async ({
    page,
  }) => {
    await open(page, '/operator/inbox', { v41: true, width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Load Problem Reports' }).click();
    await expect(page.getByText('RP-000002')).toBeVisible();
    const rows = page.locator('.pr-queue-row');
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) {
      const facts = (await row.locator('.pr-facts').boundingBox())!;
      const moves = (await row.locator('.pr-actions').boundingBox())!;
      // Same line: the moves start at the top of the facts and to their right.
      expect(Math.abs(moves.y - facts.y)).toBeLessThanOrEqual(2);
      expect(moves.x).toBeGreaterThanOrEqual(facts.x + facts.width - 1);
    }
    // Two reports with the filter fit the screen: the list ends above the bottom of a 900 px window.
    const last = (await rows.last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(900);
    // On a phone the facts stack at their own width (a badge is not stretched) and the page is two screens at most.
    for (const width of [320, 390]) {
      await open(page, '/operator/inbox', { v41: true, width, height: 844 });
      await page.getByRole('button', { name: 'Load Problem Reports' }).click();
      await expect(page.getByText('RP-000002')).toBeVisible();
      const row = page.locator('.pr-queue-row').first();
      const facts = (await row.locator('.pr-facts').boundingBox())!;
      const badge = (await row.locator('.pr-facts .ux-badge').boundingBox())!;
      expect(badge.width).toBeLessThan(facts.width / 2);
      expect(oneRow(await boxes(page, '.pr-queue-row:first-child > .pr-actions > button'))).toBe(
        true,
      );
      expect(await screens(page, 844), `${width} px`).toBeLessThanOrEqual(2);
      await noSidewaysScroll(page);
    }
  });

  test('Supply Sources: the one link out sits at the end of the tab row line, and a disclosure shows that it opens', async ({
    page,
  }) => {
    for (const width of [1440, 390, 320]) {
      await open(page, '/operator/supply', { v41: true, width, height: 844 });
      await expect(page.getByText('Trade register of Spain')).toBeVisible();
      const row = (await page.getByRole('tablist', { name: 'Supply sections' }).boundingBox())!;
      const link = (await page.getByRole('link', { name: 'Do Not Contact' }).boundingBox())!;
      // On the row's own line, after the row, at the end of the content column.
      const middle = link.y + link.height / 2;
      expect(middle, `${width} px`).toBeGreaterThan(row.y);
      expect(middle, `${width} px`).toBeLessThan(row.y + row.height);
      expect(link.x, `${width} px`).toBeGreaterThanOrEqual(row.x + row.width - 1);
      const column = (await page.locator('.supply-hub-desk').boundingBox())!;
      expect(Math.abs(link.x + link.width - (column.x + column.width))).toBeLessThanOrEqual(1);
      await noSidewaysScroll(page);
    }
    const summary = page.locator('.supply-disclosure > summary').first();
    const marker = () =>
      summary.evaluate((el) => getComputedStyle(el, '::after').content.replace(/"/g, ''));
    expect(await marker()).toBe('+');
    await summary.click();
    expect(await marker()).toBe('−');
  });

  test('below 30 rem: a filter is separate chips, and tabs and segments stay one row that scrolls inside itself', async ({
    page,
  }) => {
    await open(page, '/operator/inbox', { v41: true, width: 320, height: 844 });
    await expect(page.getByRole('tab', { name: 'Helper interest' })).toBeAttached();
    // The filter: chips with room between them and a border each.
    const chips = await boxes(page, '.ux-segments-row > .ux-segment');
    expect(chips.length).toBe(5);
    const firstLine = chips.filter((chip) => Math.abs(chip.y - chips[0]!.y) < 4);
    expect(firstLine.length).toBeGreaterThan(1);
    expect(firstLine[1]!.x - (firstLine[0]!.x + firstLine[0]!.width)).toBeGreaterThanOrEqual(8);
    expect(
      await page.locator('.ux-segments-row').evaluate((el) => getComputedStyle(el).borderTopWidth),
    ).toBe('0px');
    // The tabs: one row, wider than the screen, scrolling inside itself; the page does not scroll sideways.
    const list = page.getByRole('tablist', { name: 'Inbox lists' });
    expect(oneRow(await boxes(page, '[role="tablist"] > [role="tab"]'))).toBe(true);
    expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect((await list.boundingBox())!.height).toBeLessThanOrEqual(52);
    await noSidewaysScroll(page);
    // The chosen tab is brought into view inside the row, by the pointer, the keyboard or the address.
    const inView = (name: string) =>
      page.getByRole('tab', { name }).evaluate((tab) => {
        const row = tab.parentElement!.getBoundingClientRect();
        const box = tab.getBoundingClientRect();
        return box.left >= row.left - 1 && box.right <= row.right + 1;
      });
    expect(await inView('Problem reports')).toBe(true);
    await open(page, '/operator/inbox', {
      v41: true,
      width: 320,
      height: 844,
      query: 'tab=helpers',
    });
    await expect(page.getByRole('tab', { name: 'Helper interest' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect.poll(() => inView('Helper interest')).toBe(true);
    await page.getByRole('tab', { name: 'Helper interest' }).focus();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Problem reports' })).toBeFocused();
    await expect.poll(() => inView('Problem reports')).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await axeClean(page);
    // The segments of a grouped page: one row, the page in view inside it.
    await openWorkspace(page, '/operator/control-center', { v41: true, width: 320, height: 844 });
    const segments = page.getByRole('navigation', { name: 'Settings pages' });
    expect(oneRow(await boxes(page, 'nav.ux-desk-segments li'))).toBe(true);
    // One row of 44 px links with its frame, never two.
    expect((await segments.boundingBox())!.height).toBeLessThan(88);
    await expect
      .poll(() =>
        segments.locator('a[aria-current="page"]').evaluate((link) => {
          const row = link.closest('ul')!.getBoundingClientRect();
          const box = link.getBoundingClientRect();
          return box.left >= row.left - 1 && box.right <= row.right + 1;
        }),
      )
      .toBe(true);
    await noSidewaysScroll(page);
    // From 30 rem the tabs wrap as they did.
    await open(page, '/operator/inbox', { v41: true, width: 600, height: 844 });
    expect(
      await page
        .getByRole('tablist', { name: 'Inbox lists' })
        .evaluate((el) => getComputedStyle(el).flexWrap),
    ).toBe('wrap');
  });

  for (const width of [600, 768, 1000])
    test(`the team header is one row inside 60 px at ${width} px`, async ({ page }) => {
      await open(page, '/operator/inbox', { v41: true, width, height: 900 });
      await expect(page.getByRole('tab', { name: 'Problem reports' })).toBeVisible();
      const bar = (await page.locator('.site-shell > .ux-app-header').boundingBox())!;
      expect(bar.height).toBeLessThanOrEqual(60);
      for (const part of await boxes(
        page,
        '.site-shell > .ux-app-header > :is(a, button, .ux-app-status), .site-shell > .ux-app-header > .ux-app-tools > *',
      )) {
        if (!part.width) continue;
        expect(part.y).toBeGreaterThanOrEqual(bar.y);
        expect(part.y + part.height).toBeLessThanOrEqual(bar.y + bar.height);
        expect(part.x + part.width).toBeLessThanOrEqual(width);
      }
      await noSidewaysScroll(page);
    });
});
