import { expect, test } from '@playwright/test';
test('saved commercial reports stay closed without provider or optional module access', async ({
  page,
  request,
}) => {
  const api = await request.get('/api/customer-saved-missions');
  expect(api.status()).toBe(503);
  expect(api.headers()['cache-control']).toBe('no-store');
  expect(api.headers()['referrer-policy']).toBe('no-referrer');
  const post = await request.post('/api/customer-saved-missions', { data: {} });
  expect(post.status()).toBe(503);
  await page.goto('/account/missions/00000000-0000-4000-8000-000000000001');
  await expect(page.getByRole('status')).toHaveText('Saved commercial missions are unavailable.');
  await expect(page.getByRole('link', { name: 'Return to your account' })).toHaveAttribute(
    'href',
    '/account',
  );
});
