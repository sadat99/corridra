import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startTodayFixture } from './team-today-fixture';

// Staff shell, AC/1 Signal Desk (lane 7), measured with the real stylesheets on the Today fixture: computed
// colours and row heights, the six places and their order, no horizontal scroll, axe, keyboard.
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
test.beforeAll(async () => {
  fixture = await startTodayFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (css: string) => {
  const [r = 0, g = 0, b = 0] = (css.match(/\d+/g) ?? []).map(Number);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

async function open(page: Page, width: number, height = 900, extra: Record<string, string> = {}) {
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
        purpose: 'synthetic_validation',
        uploadsConfigured: false,
        scanMode: 'bypass',
        role: 'owner',
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.goto(`${fixture.origin}/operator?owner=on&urls=on&role=owner`);
  if (width < 1024) await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await expect(page.locator('#workspace-navigation')).toBeVisible();
  await page.mouse.move(Math.round(width * 0.7), Math.round(height * 0.5));
  void extra;
}

test('the current place is the lighter navy, white and bold, and reads 4.5:1', async ({ page }) => {
  await open(page, 1440);
  const current = page.locator('#workspace-navigation a[aria-current="page"]').first();
  const style = await current.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, weight: s.fontWeight, shadow: s.boxShadow };
  });
  expect(style.bg).toBe(rgb('#263c56'));
  expect(Number(style.weight)).toBeGreaterThanOrEqual(600);
  expect(style.shadow).toBe('none');
  expect(ratio(style.color, style.bg)).toBeGreaterThanOrEqual(4.5);
});

test('hover is the quieter navy and keeps 4.5:1', async ({ page }) => {
  await open(page, 1440);
  const other = page.locator('#workspace-navigation > ul > li:nth-child(2) a');
  await other.hover();
  const style = await other.evaluate((el) => ({
    bg: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el).color,
  }));
  expect(style.bg).toBe(rgb('#1c3048'));
  expect(ratio(style.color, style.bg)).toBeGreaterThanOrEqual(4.5);
});

test('rows keep the 44 px target at 1440 and 390', async ({ page }) => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await open(page, width, height);
    const row = page.locator('#workspace-navigation > ul > li:first-child a');
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('the six places keep their labels and order', async ({ page }) => {
  await open(page, 1440);
  const names = await page
    .locator(
      '#workspace-navigation > ul > li a, details.ux-team-group > summary > span:first-of-type',
    )
    .allTextContents();
  expect(names.map((n) => n.trim())).toEqual([
    'Today',
    'Missions',
    'Companies',
    'Meetings',
    'Money',
    'Admin',
  ]);
});

test('the second level is a segmented control with a raised current segment', async ({ page }) => {
  await open(page, 1440);
  const current = page.locator('.ux-team-second a[aria-current="page"]').first();
  if ((await current.count()) === 0) test.skip(true, 'Today has no second level in this fixture');
  expect(await current.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb('#ffffff'));
});

for (const width of [390, 768, 1440]) {
  test(`no horizontal scroll and no axe violations at ${width}`, async ({ page }) => {
    await open(page, width, width === 1440 ? 900 : 844);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
}

test('the sidebar and the palette work from the keyboard', async ({ page }) => {
  await open(page, 1440);
  await page.locator('#workspace-navigation a').first().focus();
  await page.keyboard.press('Tab');
  await expect(
    page.locator(
      '#workspace-navigation a:focus-visible, #workspace-navigation summary:focus-visible',
    ),
  ).toHaveCount(1);
  await page.keyboard.press('Control+k');
  await expect(page.locator('dialog.ux-palette[open]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.ux-palette[open]')).toHaveCount(0);
});

test('forced colours keep the current place outlined', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await open(page, 1440);
  const outline = await page
    .locator('#workspace-navigation a[aria-current="page"]')
    .first()
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe('solid');
});
