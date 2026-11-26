import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, secondTenant, startMenuFixture } from './team-menu-v3-fixture';

// Menu v3 (team desk v4.1 unit D3) in a browser, with the real stylesheets (the menu fixture): four labelled groups
// of plain links, no expander, no second list and no number; the bar is navy to the window's edge and scrolls with
// the page; each role sees only what it may open; the icon rail and the phone drawer keep working; and with the
// switch off the sidebar is the one it was.
let fixture: Awaited<ReturnType<typeof startMenuFixture>>;
test.beforeAll(async () => {
  fixture = await startMenuFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

const widths = [320, 390, 768, 1024, 1440, 1920] as const;
// Screenshots are written only when asked for (D3_SHOTS=1), into the untracked work/ folder.
const shots = process.env.D3_SHOTS ? 'work/d3/' : null;
if (shots) mkdirSync(shots, { recursive: true });

async function open(
  page: Page,
  query: string,
  size: { width: number; height?: number } = { width: 1440 },
  path = '/operator',
) {
  await page.setViewportSize({ width: size.width, height: size.height ?? 900 });
  const [address = '', hash] = path.split('#') as [string, string | undefined];
  await page.goto(
    `${fixture.origin}${address}${address.includes('?') ? '&' : '?'}${query}${hash === undefined ? '' : '#' + hash}`,
  );
  const sidebar = page.locator('#workspace-navigation');
  if (size.width < 1024) await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await expect(sidebar).toBeVisible();
  await page.mouse.move(Math.round(size.width * 0.7), 450);
  return sidebar;
}
const names = (page: Page, group: string) =>
  page.getByRole('group', { name: group, exact: true }).getByRole('link').allInnerTexts();

test('switch off: the sidebar is the one it was (no group headings, the Admin expander, no workspace row)', async ({
  page,
}) => {
  for (const query of ['role=owner', 'role=owner&desk=on&reports=on']) {
    const sidebar = await open(page, query);
    await expect(sidebar).not.toHaveAttribute('data-menu', /.*/);
    await expect(sidebar.locator('details.ux-team-group')).toHaveCount(1);
    await expect(sidebar.locator('.ux-team-menu-heading')).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'All Workspaces' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Inbox' })).toHaveCount(0);
  }
  await expect(page.locator('#workspace-navigation .ux-team-pins')).toHaveCount(1);
  // The bar keeps its own scroll and its fixed place, as before.
  expect(
    await page.locator('.ux-leftnav-rail').evaluate((el) => getComputedStyle(el).position),
  ).toBe('fixed');
});

test('switch on: four groups, every item one plain link, no expander and no number', async ({
  page,
}) => {
  const sidebar = await open(page, 'v41=on&supply=on&reports=on&desk=on');
  await expect(sidebar).toHaveAttribute('data-menu', 'v3');
  expect(await sidebar.locator('.ux-team-menu-heading').allInnerTexts()).toEqual([
    'Work',
    'People and companies',
    'Results',
    'Admin',
  ]);
  expect(await names(page, 'Work')).toEqual(['Today', 'Missions', 'Meetings', 'Inbox']);
  expect(await names(page, 'People and companies')).toEqual(['Companies', 'Helpers', 'Supply']);
  expect(await names(page, 'Results')).toEqual(['Money', 'Reports']);
  expect(await names(page, 'Admin')).toEqual(['Team and access', 'Settings', 'Status']);
  await expect(sidebar.locator('details, summary, .ux-team-pins, .ux-team-pin-count')).toHaveCount(
    0,
  );
  // No digit anywhere in the menu: Inbox carries no count (decision 5).
  expect(await sidebar.innerText()).not.toMatch(/\d/);
  const href = (name: string) =>
    sidebar.getByRole('link', { name, exact: true }).getAttribute('href');
  const w = `?workspace=${fixtureTenant}`;
  expect(await href('All Workspaces')).toBe('/workspace');
  expect(await href('Today')).toBe(`/operator${w}`);
  expect(await href('Missions')).toBe(`/operator/missions${w}`);
  expect(await href('Meetings')).toBe(`/operator/meetings${w}`);
  // Unit D18: Inbox is a page of its own; it opens on its first list.
  expect(await href('Inbox')).toBe(`/operator/inbox${w}`);
  expect(await href('Companies')).toBe(`/operator/research${w}`);
  expect(await href('Helpers')).toBe(`/operator/network${w}`);
  expect(await href('Supply')).toBe(`/operator/supply${w}`);
  expect(await href('Money')).toBe(`/operator/commercial${w}`);
  expect(await href('Reports')).toBe(`/operator/delivery${w}`);
  expect(await href('Team and access')).toBe(`/operator/controls${w}`);
  expect(await href('Settings')).toBe(`/operator/settings${w}`);
  expect(await href('Status')).toBe(`/operator/operations${w}`);
  await expect(sidebar.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sidebar.locator('[aria-current]')).toHaveCount(1);
});

test('switch on, section addresses off: the old # links, workspace kept', async ({ page }) => {
  const sidebar = await open(page, 'v41=on&urls=off');
  const href = (name: string) =>
    sidebar.getByRole('link', { name, exact: true }).getAttribute('href');
  expect(await href('Missions')).toBe(`/operator?workspace=${fixtureTenant}#workspace-missions`);
  expect(await href('Inbox')).toBe(`/operator/inbox?workspace=${fixtureTenant}`);
});

test('each role sees only what it may open; Supply only while its pages exist', async ({
  page,
}) => {
  const seen = async (query: string) =>
    (await open(page, `v41=on&${query}`)).locator('.ux-team-menu-group a').allInnerTexts();
  expect(await seen('role=operator&supply=on')).toEqual([
    'Today',
    'Missions',
    'Meetings',
    'Companies',
    'Helpers',
    'Supply',
    'Money',
    'Reports',
    'Settings',
    'Status',
  ]);
  // An operator's Settings is Assistance, the one place of Settings that role may open.
  expect(
    await page
      .locator('#workspace-navigation')
      .getByRole('link', { name: 'Settings', exact: true })
      .getAttribute('href'),
  ).toBe(`/operator/assistance?workspace=${fixtureTenant}`);
  expect(await seen('role=viewer')).toEqual([
    'Today',
    'Missions',
    'Meetings',
    'Companies',
    'Money',
    'Reports',
  ]);
  await expect(page.getByRole('group', { name: 'Admin', exact: true })).toHaveCount(0);
  expect(await seen('role=owner')).not.toContain('Supply');
  expect(await seen('role=none&supply=on')).toEqual([
    'Today',
    'Missions',
    'Meetings',
    'Companies',
    'Money',
    'Reports',
  ]);
});

test('the lit item follows the address: a segment lights its item, a queue tab lights Inbox', async ({
  page,
}) => {
  const lit = async (path: string) => {
    const sidebar = await open(page, 'v41=on&supply=on', { width: 1440 }, path);
    await expect(sidebar.locator('[aria-current]')).toHaveCount(1);
    const link = sidebar.locator('[aria-current]');
    return [await link.innerText(), await link.getAttribute('aria-current')];
  };
  expect(await lit('/operator/missions')).toEqual(['Missions', 'page']);
  expect(await lit('/operator/missions/abc')).toEqual(['Missions', 'true']);
  expect(await lit('/operator/sources')).toEqual(['Companies', 'true']);
  expect(await lit('/operator/evidence')).toEqual(['Companies', 'true']);
  expect(await lit('/operator/network')).toEqual(['Helpers', 'page']);
  expect(await lit('/operator/audit')).toEqual(['Team and access', 'true']);
  expect(await lit('/operator/assistance')).toEqual(['Settings', 'true']);
  expect(await lit('/operator/control-center')).toEqual(['Settings', 'true']);
  expect(await lit('/operator/owner')).toEqual(['Settings', 'true']);
  expect(await lit('/operator/health')).toEqual(['Status', 'true']);
  expect(await lit('/operator/readiness')).toEqual(['Status', 'true']);
  expect(await lit('/operator/dashboard')).toEqual(['Status', 'true']);
  expect(await lit('/operator/supply')).toEqual(['Supply', 'page']);
  expect(await lit('/operator/supply/missions/abc')).toEqual(['Supply', 'true']);
  expect(await lit('/operator/settings')).toEqual(['Settings', 'page']);
  expect(await lit('/operator/inbox')).toEqual(['Inbox', 'page']);
  expect(await lit('/operator/inbox?tab=erasure')).toEqual(['Inbox', 'page']);
  // An old address of a queue inside Settings still lights Inbox (the workspace sends it on to the Inbox page).
  expect(await lit('/operator/settings?tab=settings-erasure')).toEqual(['Inbox', 'true']);
  expect(await lit('/operator#workspace-commercial')).toEqual(['Money', 'page']);
  expect(await lit('/operator/settings?tab=settings-reports')).toEqual(['Inbox', 'true']);
  // A tab chosen on the page changes ?tab= without a page load; the menu follows it.
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'settings-policies');
    window.history.replaceState(window.history.state, '', url);
    document.body.click();
  });
  await expect(page.locator('#workspace-navigation [aria-current]')).toHaveText('Settings');
  // The Authenticator is reached from the avatar menu: nothing in the sidebar is lit.
  const sidebar = await open(page, 'v41=on', { width: 1440 }, '/operator/authenticator');
  await expect(sidebar.locator('[aria-current]')).toHaveCount(0);
});

test('the bar is navy to the edge and scrolls with the page', async ({ page }) => {
  const sidebar = await open(page, 'v41=on&supply=on&tall=on', { width: 1440, height: 700 });
  const facts = () =>
    page.evaluate(() => {
      const nav = document.querySelector('#workspace-navigation') as HTMLElement;
      const rail = document.querySelector('.ux-leftnav-rail') as HTMLElement;
      const first = nav.querySelector('a') as HTMLElement;
      return {
        railPosition: getComputedStyle(rail).position,
        navOverflow: getComputedStyle(nav).overflowY,
        navScrolls: nav.scrollHeight > nav.clientHeight + 1,
        top: first.getBoundingClientRect().top,
        railLeft: rail.getBoundingClientRect().left,
        column: getComputedStyle(document.querySelector('.site-shell')!, '::before')
          .backgroundColor,
        nav: getComputedStyle(nav).backgroundColor,
        brand: getComputedStyle(document.querySelector('.ux-app-header .brand')!).backgroundColor,
        pageLeft: (
          document.querySelector('.ux-leftnav-page') as HTMLElement
        ).getBoundingClientRect().left,
        railRight: rail.getBoundingClientRect().right,
      };
    });
  const before = await facts();
  expect(before.railPosition).toBe('static');
  expect(before.navOverflow).toBe('visible');
  expect(before.navScrolls).toBe(false);
  expect(before.railLeft).toBe(0);
  // One navy: the painted column, the menu and the brand corner are the same colour.
  expect(before.column).toBe(before.nav);
  expect(before.brand).toBe(before.nav);
  expect(before.pageLeft).toBeGreaterThanOrEqual(before.railRight);
  await page.evaluate(() => window.scrollTo(0, 300));
  const after = await facts();
  expect(Math.round(before.top - after.top)).toBe(300);
  // The last item is reachable by scrolling the page at a short window: nothing is cut off inside the bar.
  await sidebar.getByRole('link', { name: 'Status', exact: true }).scrollIntoViewIfNeeded();
  await expect(sidebar.getByRole('link', { name: 'Status', exact: true })).toBeInViewport();
});

for (const width of widths)
  test(`${width} px: no sideways scroll, 44 px targets, axe clean, switch on and off`, async ({
    page,
  }) => {
    for (const state of ['on', 'off'] as const) {
      const query = state === 'on' ? 'v41=on&supply=on&reports=on' : 'desk=on&reports=on';
      const sidebar = await open(page, query, { width });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      // The state under test is the one drawn: menu v3 with its thirteen links, or the sidebar before it.
      if (state === 'on') {
        await expect(sidebar).toHaveAttribute('data-menu', 'v3');
        await expect(sidebar.getByRole('link')).toHaveCount(13);
      } else await expect(sidebar).not.toHaveAttribute('data-menu', /.*/);
      if (state === 'on')
        for (const link of await sidebar.getByRole('link').all()) {
          const box = (await link.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
      if (shots) await page.screenshot({ path: `${shots}menu-${state}-${width}.png` });
      if (state === 'on') {
        const results = await new AxeBuilder({ page }).include('.ux-leftnav-rail').analyze();
        expect(results.violations.map((v) => v.id)).toEqual([]);
      }
    }
  });

test('icons only: every item keeps its name and a 44 px target; group names stay for screen readers', async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem('corridra.leftnav.collapsed', 'true'));
  const sidebar = await open(page, 'v41=on&supply=on');
  await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'true');
  for (const link of await sidebar.getByRole('link').all()) {
    const box = (await link.boundingBox())!;
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    expect(await link.getAttribute('title')).toBeTruthy();
  }
  await expect(page.getByRole('group', { name: 'People and companies', exact: true })).toHaveCount(
    1,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  if (shots) await page.screenshot({ path: `${shots}menu-on-1440-collapsed.png` });
  const results = await new AxeBuilder({ page }).include('.ux-leftnav-rail').analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test('phone drawer: opens as a dialog, Escape closes it and returns focus, keyboard reaches every item', async ({
  page,
}) => {
  const sidebar = await open(page, 'v41=on&supply=on', { width: 390, height: 844 });
  await expect(page.getByRole('dialog', { name: 'Team sections' })).toBeVisible();
  const count = await sidebar.getByRole('link').count();
  expect(count).toBe(13);
  // Close menu, the workspace switch, then the thirteen links, in order.
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sidebar.getByLabel('Workspace', { exact: true })).toBeFocused();
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Tab');
    await expect(sidebar.getByRole('link').nth(index)).toBeFocused();
    expect(
      await sidebar
        .getByRole('link')
        .nth(index)
        .evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe('none');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sections', exact: true })).toBeFocused();
});

/** The reads the mounted workspace makes, answered as an empty sample workspace. */
async function answerWorkspace(page: Page, role = 'owner') {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: true } }),
  );
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      json: {
        purpose: 'synthetic_validation',
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
}

test('switch off, workspace mounted: the toolbar and the second tab bar are where they were', async ({
  page,
}) => {
  await answerWorkspace(page);
  await open(page, 'mount=on&desk=on', { width: 1440 }, '/operator/missions');
  const toolbar = page.locator('.operator-toolbar');
  await expect(toolbar.locator('select#operator-workspace-select')).toHaveCount(1);
  await expect(toolbar.getByRole('link', { name: 'All Workspaces' })).toHaveCount(1);
  await expect(toolbar.getByRole('link', { name: 'Sign-In and Access Help' })).toHaveCount(1);
  await expect(toolbar.getByRole('button', { name: 'Sign Out' })).toHaveCount(1);
  await expect(page.locator('#workspace-navigation select')).toHaveCount(0);
  await expect(page.locator('nav.ux-team-second')).toHaveCount(1);
});

test('switch on, workspace mounted: no second tab bar, no toolbar; the switch is at the top of the menu and still asks before clearing entries', async ({
  page,
}) => {
  await answerWorkspace(page);
  const sidebar = await open(
    page,
    'v41=on&mount=on&desk=on',
    { width: 1440 },
    '/operator/missions',
  );
  await expect(page.locator('nav.ux-team-second')).toHaveCount(0);
  await expect(page.locator('.operator-toolbar')).toHaveCount(0);
  // One control with the id it always had, now the first thing in the menu.
  const select = page.locator('select#operator-workspace-select');
  await expect(select).toHaveCount(1);
  await expect(sidebar.getByLabel('Workspace', { exact: true })).toHaveValue(fixtureTenant);
  // One order always, by name: the list does not follow the order the server happened to read it in.
  expect(await select.locator('option').allInnerTexts()).toEqual([
    'Second workspace',
    'Synthetic request operations',
  ]);
  expect(
    await sidebar.evaluate(
      (nav) => nav.querySelector('select, a')?.id === 'operator-workspace-select',
    ),
  ).toBe(true);
  await expect(sidebar.getByRole('link', { name: 'All Workspaces' })).toHaveAttribute(
    'href',
    '/workspace',
  );
  // Sign Out and the Authenticator stay reachable from the header's account menu.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Sign Out' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Authenticator' })).toBeVisible();
  await page.keyboard.press('Escape');
  const box = (await select.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  if (shots) await page.screenshot({ path: `${shots}menu-on-1440-mounted.png` });
  const results = await new AxeBuilder({ page }).include('.ux-leftnav-rail').analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);

  // Nothing typed: the change happens without a question.
  let asked = 0;
  page.on('dialog', (dialog) => {
    asked += 1;
    void dialog.dismiss();
  });
  await select.selectOption(secondTenant);
  await expect(select).toHaveValue(secondTenant);
  expect(asked).toBe(0);
  // After an entry in a form of the workspace, the same question as before; staying keeps the workspace.
  await page.evaluate(() => {
    window.location.hash = '#workspace-research';
  });
  const field = page.locator('.ux-workspace-body form:visible').locator('input:visible').first();
  await field.fill('Invented entry');
  await select.selectOption(fixtureTenant);
  expect(asked).toBe(1);
  await expect(select).toHaveValue(secondTenant);
});

test('no menu jump on load: a workspace page keeps the room of the switch before the workspace has published it', async ({
  page,
}) => {
  const headingTop = () =>
    page
      .locator('#workspace-navigation .ux-team-menu-heading')
      .first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().top));
  // Nothing has said which workspace is open yet: the menu as the server render and the first paint draw it.
  const pending = await open(page, 'v41=on&role=none', { width: 1440 }, '/operator/missions');
  await expect(pending.locator('.ux-team-menu-switch[data-pending]')).toHaveCount(1);
  await expect(pending.locator('select')).toHaveCount(0);
  const before = await headingTop();
  await answerWorkspace(page);
  const loaded = await open(page, 'v41=on&mount=on', { width: 1440 }, '/operator/missions');
  await expect(loaded.locator('select#operator-workspace-select')).toHaveCount(1);
  await expect(loaded.locator('.ux-team-menu-switch[data-pending]')).toHaveCount(0);
  expect(await headingTop()).toBe(before);
  const select = loaded.locator('select#operator-workspace-select');
  // A form control at 16 px in the menu's own face, with its full name as a tooltip when it is cut short.
  expect(await select.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  expect(await select.evaluate((el) => getComputedStyle(el).fontFamily)).toBe(
    await loaded.evaluate((el) => getComputedStyle(el).fontFamily),
  );
  await expect(select).toHaveAttribute('title', 'Synthetic request operations');
  // A page with no workspace to offer ("Workspace access is unavailable") keeps no empty room, before or after.
  await page.unrouteAll();
  for (const query of ['v41=on&list=none&role=none', 'v41=on&list=none']) {
    const none = await open(page, query, { width: 1440 }, '/operator/missions');
    await expect(none.locator('.ux-team-menu-switch')).toHaveCount(0);
    await expect(none.getByRole('link', { name: 'All Workspaces' })).toHaveCount(1);
  }
});

// The audit of 25 Nov 2026 (staff-core-06, staff-admin-17): the switch was missing on the Inbox, the Supply pages
// and the mission page, which do not mount the workspace. It is on every team page now, in the same place, and a
// choice opens the same page for that workspace (the list a record came from, for a page about one record).
test('the workspace switch is on the team pages that do not mount the workspace, and a choice opens that page for the chosen workspace', async ({
  page,
}) => {
  const pages: [string, string][] = [
    ['/operator/inbox', '/operator/inbox'],
    ['/operator/supply', '/operator/supply'],
    ['/operator/supply/do-not-contact', '/operator/supply/do-not-contact'],
    ['/operator/supply/missions/123e4567-e89b-42d3-a456-426614174000', '/operator/supply'],
    ['/operator/missions/123e4567-e89b-42d3-a456-426614174000', '/operator/missions'],
    ['/operator/owner', '/operator/owner'],
  ];
  for (const [address, target] of pages) {
    const sidebar = await open(page, 'v41=on&supply=on', { width: 1440 }, address);
    const select = sidebar.getByLabel('Workspace', { exact: true });
    await expect(select, address).toHaveValue(fixtureTenant);
    await expect(select).toBeEnabled();
    expect(await select.locator('option').allInnerTexts()).toEqual([
      'Second workspace',
      'Synthetic request operations',
    ]);
    await expect(sidebar.locator('.ux-team-menu-switch[data-pending]')).toHaveCount(0);
    await select.selectOption(secondTenant);
    await page.waitForURL((url) => url.searchParams.get('workspace') === secondTenant);
    const landed = new URL(page.url());
    expect(landed.pathname, address).toBe(target);
    expect(landed.search).toBe(`?workspace=${secondTenant}`);
  }
  // On a phone the switch is in the drawer, the first control of the menu, at a full 44 px.
  const drawer = await open(page, 'v41=on', { width: 390 }, '/operator/inbox');
  const box = (await drawer.getByLabel('Workspace', { exact: true }).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

// Owner rule, 24 Nov 2026: "Avoid unnecessary repetition of navigation links on a single screen". The menu is the
// one global path, so each destination has one link in it, and what moved into it is not also drawn in the page.
test('one link per destination: no address twice in the menu, and the page does not repeat what moved into it', async ({
  page,
}) => {
  const hrefs = (scope: string) =>
    page
      .locator(`${scope} a[href]`)
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  for (const query of [
    'v41=on&supply=on&reports=on&role=owner',
    'v41=on&supply=on&role=owner',
    'v41=on&supply=on&role=admin',
    'v41=on&supply=on&role=operator',
    'v41=on&supply=on&role=reviewer',
    'v41=on&supply=on&role=viewer',
    'v41=on&supply=on&role=owner&urls=off',
  ]) {
    await open(page, query);
    const menu = await hrefs('#workspace-navigation');
    expect(menu.length).toBeGreaterThan(5);
    expect(new Set(menu).size, `no address twice in the menu (${query})`).toBe(menu.length);
  }
  // With the workspace mounted: the switch, All Workspaces, Help and Sign Out are no longer in the page, so the
  // page holds no second link to the list of workspaces, no second workspace select and no second tab row.
  await answerWorkspace(page);
  await open(page, 'v41=on&mount=on&supply=on', { width: 1440 }, '/operator/missions');
  await expect(page.locator('select#operator-workspace-select')).toHaveCount(1);
  expect((await hrefs('.ux-leftnav-page')).filter((href) => href === '/workspace')).toEqual([]);
  expect(
    (await hrefs('#workspace-navigation')).filter((href) => href === '/workspace'),
  ).toHaveLength(1);
  await expect(
    page.locator('.ux-leftnav-page').getByRole('button', { name: 'Sign Out' }),
  ).toHaveCount(0);
  await expect(page.locator('nav.ux-team-second')).toHaveCount(0);
});

// Audit of 25 Nov 2026, staff-admin-16: at 1440 x 900 the menu ended below the window, so Status was cut and
// "Collapse menu" was off screen.
test('at 1440 x 900 the whole menu, down to Status and Collapse menu, is on the first screen with 44 px rows', async ({
  page,
}) => {
  for (const query of ['v41=on&supply=on&reports=on&role=owner', 'v41=on&supply=on&role=admin']) {
    const sidebar = await open(page, query, { width: 1440, height: 900 });
    await expect(sidebar.getByLabel('Workspace', { exact: true })).toBeVisible();
    const status = (await sidebar.getByRole('link', { name: 'Status' }).boundingBox())!;
    expect(status.y + status.height).toBeLessThanOrEqual(900);
    const collapse = (await page.getByRole('button', { name: 'Collapse menu' }).boundingBox())!;
    expect(collapse.y + collapse.height).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    for (const height of await sidebar
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height)))
      expect(height).toBeGreaterThanOrEqual(44);
    // No row overlaps the next one.
    const tops = await sidebar
      .locator('a, select')
      .evaluateAll((rows) =>
        rows.map((row) => [row.getBoundingClientRect().top, row.getBoundingClientRect().bottom]),
      );
    for (let index = 1; index < tops.length; index += 1)
      expect(tops[index]![0]!).toBeGreaterThanOrEqual(tops[index - 1]![1]! - 0.5);
  }
  // A tall window keeps the roomier spacing.
  const tall = await open(page, 'v41=on&supply=on&role=owner', { width: 1440, height: 1200 });
  expect(await tall.evaluate((nav) => getComputedStyle(nav).rowGap)).toBe('16px');
});

// Audit of 25 Nov 2026, staff-admin-03: the search listed the old maps, so "helpers" found nothing and "network"
// found the page the menu calls Helpers.
test('search: with the switch on a page is found by the word the menu shows; off, the old words stay', async ({
  page,
}) => {
  const search = async (query: string, words: string) => {
    await open(page, query, { width: 1440 });
    await page.keyboard.press('Control+K');
    const dialog = page.locator('dialog.ux-palette[open]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill(words);
    return dialog.getByRole('option');
  };
  const on = 'v41=on&supply=on&reports=on&role=owner';
  await expect(await search(on, 'helpers')).toHaveText([/Open Helpers.*People and companies/s]);
  await expect((await search(on, 'helpers')).first()).toHaveAttribute(
    'href',
    `/operator/network?workspace=${fixtureTenant}`,
  );
  await expect(await search(on, 'network')).toHaveCount(0);
  await expect((await search(on, 'status')).filter({ hasText: 'Open ' })).toHaveText([
    /Open Operations.*Status/s,
    /Open Dashboard.*Status/s,
    /Open Health.*Status/s,
    /Open Readiness.*Status/s,
  ]);
  await expect((await search(on, 'team and access')).filter({ hasText: 'Open ' })).toHaveText([
    /Open People and access.*Team and access/s,
    /Open Audit.*Team and access/s,
  ]);
  await expect((await search(on, 'inbox')).filter({ hasText: 'Open Inbox' })).toHaveCount(1);
  await expect((await search(on, 'supply')).filter({ hasText: 'Open Supply' })).toHaveCount(1);
  // Switch off: the palette is the one it was.
  await expect((await search('role=owner', 'network')).filter({ hasText: 'Open ' })).toHaveText([
    /Open Network.*Missions/s,
  ]);
  await expect((await search('role=owner', 'helpers')).filter({ hasText: 'Open ' })).toHaveCount(0);
});

// Final walk W-3a (25 Nov 2026): below 480 px the team header gives back the shell's 24 px gutter. It took back a rem
// step instead, 48 px at 200% text, so at 390 px the page was 414 px wide and the account menu button ended at 406 px.
// Fails on the code before; at the normal size the row still reaches both edges of the screen.
// Final walk follow-up (26 Nov 2026): at 320 px (WCAG 1.4.10 reflow width) with 200% text the header was still 20 px
// wider than the screen. The same checks run at 320.
for (const width of [390, 320])
  for (const text of [100, 200])
    test(`the team header stays inside the window at ${width} px with ${text}% text`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${fixture.origin}/operator?v41=on&role=owner`);
      const header = page.locator('header.ux-team-header');
      await expect(header).toBeVisible();
      await expect(page.locator('#workspace-navigation')).toHaveAttribute('data-menu', 'v3');
      if (text !== 100)
        await page.evaluate((percent) => {
          document.documentElement.style.fontSize = `${percent}%`;
        }, text);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        'sideways scroll in px',
      ).toBeLessThanOrEqual(0);
      const box = (await header.boundingBox())!;
      expect(Math.round(box.x)).toBe(0);
      expect(Math.round(box.x + box.width)).toBe(width);
      const outside = await header.evaluate((element) =>
        Array.from(element.querySelectorAll('a, button'))
          .filter((control) => control.getBoundingClientRect().width > 1)
          .filter((control) => {
            const edge = control.getBoundingClientRect();
            return edge.left < -0.5 || edge.right > window.innerWidth + 0.5;
          })
          .map((control) => control.getAttribute('aria-label') ?? control.textContent?.trim()),
      );
      expect(outside).toEqual([]);
    });
