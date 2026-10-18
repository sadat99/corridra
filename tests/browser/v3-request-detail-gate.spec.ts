import { expect, test } from '@playwright/test';
const id = '00000000-0000-4000-8000-000000000001';
test('closed detail page and API never expose optional source data', async ({ page, request }) => {
  const response = await request.get('/api/customer-requests/' + id);
  expect(response.status()).toBe(503);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  const result = await request.get('/account/requests/' + id);
  expect(result.status()).toBe(200);
  expect(result.headers()['referrer-policy']).toBe('no-referrer');
  await page.goto('/account/requests/' + id);
  await expect(page.getByRole('status')).toHaveText(
    'Saved sample request details are unavailable.',
  );
  await expect(page.getByRole('link', { name: 'Return to your account' })).toHaveAttribute(
    'href',
    '/account',
  );
  await expect(page.locator('form')).toHaveCount(0);
});
