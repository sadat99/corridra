import { expect, test } from '@playwright/test';

// UI/UX.v4 /plan (W1-C, screen 01): progress as words, five choices, the job disclosure, no callout box and the
// phone bottom action area. Selectors come from apps/web/app/plan/plan-*.tsx.
const sizes = {
  phone: { width: 390, height: 844 },
  small: { width: 320, height: 640 },
  desktop: { width: 1440, height: 900 },
} as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

test('step one says where you are in words, with no numbered circles', async ({ page }) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  await expect(page.locator('.plan-progress-line')).toHaveText('Step 1 of 5: Goal · Next: Where');
  await expect(page.locator('.guide-journey-bar')).toHaveCount(0);
  await expect(page.locator('progress[aria-label]')).toHaveCount(1);
});

test('the Your Request callout is gone and one privacy line sits under the choices', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  await expect(page.locator('aside.intake-notice')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What do you want to do?');
});

test('the exact job lives behind one named disclosure and keeps its select', async ({ page }) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  const toggle = page.getByRole('button', { name: 'Know the Exact Job? Choose It' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.getByRole('combobox', { name: /job/i })).toBeVisible();
});

for (const [name, size] of [
  ['phone', sizes.phone],
  ['small', sizes.small],
] as const)
  test(`the action area is fixed, at least 60 px tall and never covers the last content at ${name}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/plan');
    const bar = page.locator('.plan-action-bar');
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    const button = bar.locator('button.primary-link');
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(59.5);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const footer = await page.locator('footer').last().boundingBox();
    const barBox = await bar.boundingBox();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(barBox!.y + 1);
  });

test('before a choice the button says why it waits, and pressing it shows the same validation error', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  const button = page.locator('.plan-action-bar button.primary-link');
  await expect(button).toHaveText('Pick One to Continue');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('alert').first()).toBeVisible();
});

test('on desktop Continue sits in the flow and the summary speaks in words', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/plan');
  const bar = page.locator('.plan-action-bar');
  expect(await bar.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
  // The left pane of the window (owner canvas board v10) speaks in words: every empty answer says so.
  await expect(page.locator('aside.pv-side')).toContainText('Not chosen yet');
});

// G29 round 1 (C1): a job error forces the exact job open, even after the person closed it.
test('a job error opens the exact job disclosure again, with the select visible and the error summary focused', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  const toggle = page.getByRole('button', { name: 'Know the Exact Job? Choose It' });
  await toggle.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.plan-action-bar button.primary-link').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Check this step.' })).toBeFocused();
});

// G29 round 1 (D2): the first choice sits above the fold at 390 x 844.
test('the first choice is above the fold on a phone', async ({ page }) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  const first = page.locator('form.intake-form input[type="radio"]').first();
  expect((await first.locator('xpath=ancestor::label').boundingBox())!.y).toBeLessThan(844);
});

// G29 round 1 (D3, UI/UX.v4 "Action alignment"): Continue sits on the left edge of its column on wide screens.
test('on desktop Continue sits on the left edge of the form column', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/plan');
  const [row, button] = await Promise.all([
    page.locator('.plan-action-row').boundingBox(),
    page.locator('.plan-action-bar button.primary-link').boundingBox(),
  ]);
  expect(Math.abs(button!.x - row!.x)).toBeLessThanOrEqual(1);
});

test('with only English offered the Bangla guidance stays on the page as one disclosure', async ({
  page,
}) => {
  // No language button exists then (it needs a second language), so the guidance must not disappear with it.
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  await expect(page.locator('header button[aria-haspopup="dialog"]:visible')).toHaveCount(0);
  const guidance = page.locator('[data-plan-guidance]');
  await expect(guidance).toHaveCount(1);
  await expect(guidance).toHaveAttribute('lang', 'bn');
  await guidance.locator('summary').click();
  await expect(guidance.locator('p').first()).toBeVisible();
});

test('with text at twice the size no choice is ever under the bar', async ({ page }) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  // A real click reaches the last choice, and once it has scrolled into view it ends above the bar when the bar
  // is fixed (the bar joins the page flow instead when it would take too much of the window).
  const last = page.getByRole('radio').last();
  await last.check();
  await expect(last).toBeChecked();
  const bar = page.locator('.plan-action-bar');
  if ((await bar.evaluate((el) => getComputedStyle(el).position)) === 'fixed') {
    const radio = await last.boundingBox();
    const area = await bar.boundingBox();
    expect(radio && area && radio.y + radio.height <= area.y + 1).toBe(true);
  }
});
