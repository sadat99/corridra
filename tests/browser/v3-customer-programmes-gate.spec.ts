import { expect, test } from '@playwright/test';
test('sample delegation programmes stay closed without provider or optional module access', async ({
  page,
  request,
}) => {
  const api = await request.get('/api/customer-programmes');
  expect(api.status()).toBe(503);
  expect(api.headers()['cache-control']).toBe('no-store');
  expect(api.headers()['referrer-policy']).toBe('no-referrer');
  const post = await request.post('/api/customer-programmes', { data: {} });
  expect(post.status()).toBe(503);
  await page.goto('/account/delegations/00000000-0000-4000-8000-000000000001');
  await expect(page.getByRole('status')).toHaveText('Sample delegation planning is unavailable.');
  await expect(page.getByRole('link', { name: 'Return to your account' })).toHaveAttribute(
    'href',
    '/account',
  );
});
