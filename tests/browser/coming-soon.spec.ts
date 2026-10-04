import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('public page states the proposition and launch status without making up proof', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Corridra | Cross-border market access');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Going into a new market?Know who is worth meeting.',
  );
  await expect(page.getByText('Coming soon', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Bangladesh', { exact: true })).toBeVisible();
  await expect(page.getByText('Spain & Europe', { exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('\u2014');
  expect(await page.locator('body').innerText()).not.toMatch(
    /trusted by|guaranteed orders|global coverage/i,
  );
  await expect(page.locator('input')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('navigation leads to real content and supports keyboard access', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page.getByRole('link', { name: 'See what’s taking shape' }).click();
  await expect(page).toHaveURL(/#approach$/);
  await expect(
    page.getByRole('heading', { name: /A meeting is a start\.\s*What follows matters\./ }),
  ).toBeInViewport();
  await page.getByRole('link', { name: 'Back to top' }).click();
  await expect(page).toHaveURL(/#main$/);
});

test('layout fits the viewport and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const size = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
  }));
  expect(size.content).toBeLessThanOrEqual(size.viewport);
  expect(size.scroll).toBe('auto');
  await expect(page.getByRole('link', { name: 'See what’s taking shape' })).toBeVisible();
});

test('page passes relevant WCAG accessibility checks', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('security headers and local assets are served', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response.headers()['content-security-policy']).not.toContain("'unsafe-eval'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['x-powered-by']).toBeUndefined();
  const icon = await request.get('/icon.svg');
  expect(icon.ok()).toBe(true);
  expect(await icon.text()).toContain('<svg');
});

test('unavailable routes return a helpful 404', async ({ page }) => {
  const response = await page.goto('/not-a-real-route');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Corridra' }).click();
  await expect(page).toHaveURL('/');
});
