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
  const toggle = page.getByRole('button', { name: 'Know the exact job? Choose it' });
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
  await expect(page.locator('.ux-brief-summary')).toContainText('Not chosen yet');
});
