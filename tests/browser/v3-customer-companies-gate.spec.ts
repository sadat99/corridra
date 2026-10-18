import { expect, test } from '@playwright/test';
test('approved company portfolios stay closed without provider or optional module access', async ({
  page,
  request,
}) => {
  const api = await request.get('/api/customer-companies');
  expect(api.status()).toBe(503);
  expect(api.headers()['cache-control']).toBe('no-store');
  expect(api.headers()['referrer-policy']).toBe('no-referrer');
  const post = await request.post('/api/customer-companies', { data: {} });
  expect(post.status()).toBe(405);
  await page.goto('/account/companies');
  await expect(page.getByRole('status')).toHaveText('Approved companies are unavailable.');
  await expect(page.getByRole('link', { name: 'Return to your account' })).toHaveAttribute(
    'href',
    '/account',
  );
});
