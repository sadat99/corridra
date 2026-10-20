import { test, expect } from '@playwright/test';

test('the header offers Sign in and never asks for a session when customer accounts are not configured', async ({
  page,
}) => {
  const sessionRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/')) sessionRequests.push(request.url());
  });
  await page.goto('/how-it-works');
  const menu = page.getByRole('button', { name: /^Menu/ });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Your account', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  expect(sessionRequests).toEqual([]);
});
