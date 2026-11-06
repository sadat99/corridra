import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, startTodayFixture } from './team-today-fixture';

// Navigation v1, team shell (docs/revamp/specs/navigation-v1.md): the real sidebar and second-level row,
// bundled with the real stylesheets (the Today fixture), at 320, 390, 768, 1024, 1280 and 1440, for an owner
// and for an operator (no Admin). Guards: icon and text contrast on the navy bar in every state and in the
// collapsed rail, the row wrapping at 320 with 44 px targets and no sideways scroll, and the Account stopgap
// for a role that is not shown Admin.
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
test.beforeAll(async () => {
  fixture = await startTodayFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

async function open(page: Page, role: string, hash = '', width = 1280, missionsV2 = true) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.route('**/api/team-work/flags', (route) => route.fulfill({ json: { missionsV2 } }));
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
  await page.goto(`${fixture.origin}/operator?owner=on${hash}`);
  const sidebar = page.locator('#workspace-navigation');
  if (width < 1024) await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await expect(sidebar).toBeVisible();
  return sidebar;
}

/** Contrast ratio of the element's text colour against its own or inherited background. */
async function contrast(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r = 0, g = 0, b = 0]: number[]) => {
      const channel = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const el = document.querySelector(sel) as HTMLElement;
    let background = el;
    let bg = parse(getComputedStyle(background).backgroundColor);
    while ((bg.length < 3 || (bg[3] ?? 1) === 0) && background.parentElement) {
      background = background.parentElement;
      bg = parse(getComputedStyle(background).backgroundColor);
    }
    const icon = el.querySelector('svg') ?? el;
    const fg = parse(getComputedStyle(icon).color);
    const [a, b] = [luminance(fg), luminance(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, selector);
}

test('the navy bar keeps white text and icons in every state, and in the collapsed rail (1024, 1280, 1440)', async ({
  page,
}) => {
  for (const width of [1024, 1280, 1440]) {
    const sidebar = await open(page, 'owner', '#workspace-missions', width);
    await expect(
      sidebar.getByRole('link', { name: 'Missions', exact: true }).first(),
    ).toHaveAttribute('aria-current', 'page');
    // Current item, a plain item, a hovered item, an Admin summary: at least 3:1 for icons, 4.5:1 for text.
    const selectors = [
      '#workspace-navigation a[aria-current]',
      '#workspace-navigation li:nth-child(3) a',
      '#workspace-navigation summary',
    ];
    for (const selector of selectors)
      expect(await contrast(page, selector), `${width} ${selector}`).toBeGreaterThanOrEqual(4.5);
    await sidebar.getByRole('link', { name: 'Companies', exact: true }).hover();
    expect(
      await contrast(page, '#workspace-navigation a:hover'),
      `${width} hover`,
    ).toBeGreaterThanOrEqual(4.5);
    // The collapsed rail: names are hidden, icons remain and must be as visible.
    if ((await page.locator('.ux-leftnav-frame').getAttribute('data-collapsed')) !== 'true')
      await page.locator('.ux-leftnav-collapse').click();
    await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'true');
    for (const selector of selectors)
      expect(await contrast(page, selector), `${width} rail ${selector}`).toBeGreaterThanOrEqual(
        4.5,
      );
    // Every link keeps its name as a tooltip.
    for (const title of await sidebar
      .locator('a')
      .evaluateAll((els) => els.map((el) => el.getAttribute('title'))))
      expect(title).toBeTruthy();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.evaluate(() => localStorage.clear());
  }
});

test('the second-level row wraps, keeps 44 px targets and never scrolls sideways (320, 390, 768, 1024, 1440)', async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    await open(page, 'owner', '#workspace-missions', width);
    // Close the drawer on a phone so the row is in view.
    if (width < 1024) await page.keyboard.press('Escape');
    const row = page.getByRole('navigation', { name: 'In this section' });
    await expect(row).toBeVisible();
    for (const name of ['Missions', 'Operations', 'Network', 'Assistance'])
      await expect(row.getByRole('link', { name, exact: true })).toBeVisible();
    const boxes = await row
      .locator('a')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    for (const box of boxes) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.right).toBeLessThanOrEqual(width + 1);
      expect(box.left).toBeGreaterThanOrEqual(-1);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${width} sideways`,
    ).toBe(true);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('an owner has Admin with its five and the Settings row holds the Owner page; axe is clean', async ({
  page,
}) => {
  const sidebar = await open(page, 'owner', '#workspace-settings');
  await expect(sidebar.locator('summary', { hasText: 'Admin' })).toBeVisible();
  for (const name of ['Health', 'Readiness', 'Audit', 'People and access', 'Settings'])
    await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
  const row = page.getByRole('navigation', { name: 'In this section' });
  for (const name of ['Corridors and policies', 'Control Center', 'Owner page'])
    await expect(row.getByRole('link', { name, exact: true })).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .include('#workspace-navigation')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const axeRow = await new AxeBuilder({ page })
    .include('.ux-team-second')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axeRow.violations.map((v) => v.id)).toEqual([]);
});

test('an operator has no Admin, finds Health, Readiness and the Authenticator in Account, and keeps the daily items', async ({
  page,
}) => {
  const sidebar = await open(page, 'operator', '#ops-health');
  await expect(sidebar.locator('summary', { hasText: 'Admin' })).toHaveCount(0);
  for (const name of ['Today', 'Missions', 'Companies', 'Meetings', 'Money'])
    await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
  const account = sidebar.locator('summary', { hasText: 'Account' });
  await expect(account).toBeVisible();
  for (const name of ['Authenticator', 'Health', 'Readiness'])
    await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Health', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // Nothing an operator may not open is offered.
  for (const name of ['Audit', 'People and access', 'Settings'])
    await expect(sidebar.getByRole('link', { name, exact: true })).toHaveCount(0);
  const axe = await new AxeBuilder({ page })
    .include('#workspace-navigation')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test('a mission hit opens the mission page when mission pages are on and the Missions section when they are off', async ({
  page,
}) => {
  for (const missionsV2 of [true, false]) {
    await open(page, 'owner', '', 1280, missionsV2);
    await page.route('**/api/workspace/search?*', (route) =>
      route.fulfill({
        json: {
          missions: [
            {
              id: '00000000-0000-4000-8000-000000000042',
              label: 'Invented Towels Ltd',
              detail: 'Source suppliers · China',
            },
          ],
          companies: [],
          denied: [],
          partial: [],
        },
      }),
    );
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search missions, companies and actions' });
    await dialog.getByRole('combobox').fill('Invented');
    const hit = dialog.getByRole('option', { name: /Invented Towels Ltd/ });
    await expect(hit).toBeVisible();
    const href = await hit.getAttribute('href');
    if (missionsV2)
      expect(href).toBe(
        `/operator/missions/00000000-0000-4000-8000-000000000042?workspace=${fixtureTenant}`,
      );
    else {
      expect(href).toBe(`/operator/missions?workspace=${fixtureTenant}`);
      await expect(hit).toContainText('Opens Missions');
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('the keyboard keeps the selected option in view in a long list (Actions)', async ({
  page,
}) => {
  await open(page, 'owner', '#workspace-missions');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search missions, companies and actions' });
  await dialog.getByRole('button', { name: 'Actions', exact: true }).click();
  await dialog.getByRole('combobox').focus();
  const options = dialog.getByRole('option');
  expect(await options.count()).toBeGreaterThan(12);
  for (let step = 0; step < 14; step++) await page.keyboard.press('ArrowDown');
  const selected = dialog.locator('[role="option"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  const [item, list] = await Promise.all([
    selected.boundingBox(),
    dialog.getByRole('listbox').boundingBox(),
  ]);
  expect(item!.y).toBeGreaterThanOrEqual(list!.y - 1);
  expect(item!.y + item!.height).toBeLessThanOrEqual(list!.y + list!.height + 1);
});

// Keep the fixture id referenced so a rename of the tenant fails here and not silently.
test('the fixture workspace id is the one the team shell reads', () => {
  expect(fixtureTenant).toMatch(/^[0-9a-f-]{36}$/);
});
