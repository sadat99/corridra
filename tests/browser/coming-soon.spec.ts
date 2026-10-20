import { expect, test } from '@playwright/test';

test('the retired launch page sends old links to the home page', async ({ page, request }) => {
  const response = await request.get('/coming-soon', { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers()['location']).toBe('/');
  await page.goto('/coming-soon');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the footer no longer links to the retired launch page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'The original launch page' })).toHaveCount(0);
  await expect(page.locator('a[href="/coming-soon"]')).toHaveCount(0);
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
