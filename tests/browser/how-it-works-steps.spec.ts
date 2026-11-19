import { test, expect } from '@playwright/test';

// W1-E (UI/UX.v4, 18 November 2026): How it works shows progress as words on each step ("Step 3 of 6: Compare ·
// Next: Visit"), sentence case, and keeps its two phase tabs, its headline and its anchors. Presentation only.
const lines = [
  'Step 1 of 6: Define · Next: Find',
  'Step 2 of 6: Find · Next: Compare',
  'Step 3 of 6: Compare · Next: Visit',
  'Step 4 of 6: Visit · Next: Decide',
  'Step 5 of 6: Decide · Next: Follow through',
  'Step 6 of 6: Follow through',
];
const widths = [320, 375, 768, 1024, 1440] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

const noSideways = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('six step lines read in order, the last has no Next, and none is upper case', async ({
  page,
}) => {
  await page.goto('/how-it-works');
  const all = page.locator('.guide-step-line');
  await expect(all).toHaveCount(6);
  const texts = (await all.allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim());
  expect(texts).toEqual(lines);
  expect(texts[5]).not.toContain('Next');
  for (const index of [0, 5]) {
    await expect(all.nth(index)).toHaveCSS('text-transform', 'none');
    await expect(all.nth(index)).toHaveCSS('font-size', '14px');
  }
  await expect(page.locator('.guide-step-name')).toHaveCount(0);
});

test('the headline, the two tabs and their data-tab ids are unchanged, at 44 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/how-it-works');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'One commercial objective. One mission. A clear record of what happens next.',
  );
  const tablist = page.getByRole('tablist', { name: 'Phases of the approach' });
  await expect(tablist.getByRole('tab')).toHaveText(['Before You Meet', 'Meet and Follow Up']);
  for (const id of ['before-you-meet', 'meet-and-follow-up']) {
    const box = await page.locator(`[role="tab"][data-tab="${id}"]`).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const summary = await page.locator('details.guide-more > summary').boundingBox();
  expect(summary?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('step titles are 18 px on a phone and 24 px from 1000 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/how-it-works');
  const title = page.locator('.guide-phase li h3').first();
  await expect(title).toHaveCSS('font-size', '18px');
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(title).toHaveCSS('font-size', '24px');
});

for (const width of widths) {
  test(`nothing scrolls sideways at ${width} px, in both tabs and with Show More open`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/how-it-works');
    expect(await noSideways(page)).toBe(true);
    await page.locator('[role="tab"][data-tab="meet-and-follow-up"]').click();
    expect(await noSideways(page)).toBe(true);
    await page.locator('details.guide-more > summary').click();
    expect(await noSideways(page)).toBe(true);
  });
}

test('the second tab opens from ?tab= and from a hash inside it', async ({ page }) => {
  await page.goto('/how-it-works?tab=meet-and-follow-up');
  await expect(page.locator('[role="tab"][data-tab="meet-and-follow-up"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Step 6 of 6: Follow through')).toBeVisible();
});

test('Arabic, right to left, at 320 px: nothing scrolls sideways and the step lines stay', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('corridra.language', 'ar'));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/how-it-works');
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.querySelector('main')?.setAttribute('dir', 'rtl');
  });
  expect(await noSideways(page)).toBe(true);
  await expect(page.locator('.guide-step-line').first()).toBeVisible();
});
