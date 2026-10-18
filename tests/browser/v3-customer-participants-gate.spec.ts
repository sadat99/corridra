import { test, expect } from '@playwright/test';
test('participant preview,registration and administration stay closed before optional schema or provider access', async ({
  page,
  request,
}) => {
  for (const path of [
    '/api/customer-programme-participants?view=own',
    '/api/customer-programme-participants?view=manage',
  ]) {
    const r = await request.get(path);
    expect(r.status()).toBe(503);
    expect(r.headers()['cache-control']).toBe('no-store');
    expect(r.headers()['referrer-policy']).toBe('no-referrer');
  }
  const post = await request.post('/api/customer-programme-participants', {
    data: { action: 'preview', token: 'a'.repeat(43) },
  });
  expect(post.status()).toBe(503);
  expect(post.headers()['cache-control']).toBe('no-store');
  expect(post.headers()['referrer-policy']).toBe('no-referrer');
  await page.goto('/account/delegations');
  await expect(page.getByRole('status')).toHaveText(
    'Sample delegation participation is unavailable.',
  );
  await expect(page.getByRole('button', { name: 'Preview sample invitation' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Return to your account' })).toHaveAttribute(
    'href',
    '/account',
  );
});
