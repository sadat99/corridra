import { expect, test } from '@playwright/test';

test('private submission page stays closed without reading optional customer authority', async ({
  page,
  request,
}) => {
  const path = '/account/request/00000000-0000-4000-8000-000000000010';
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  await page.goto(path);
  await expect(page.getByRole('status')).toHaveText('Private sample requests are unavailable.');
  await expect(
    page.getByRole('link', { name: 'Return to your account', exact: true }),
  ).toHaveAttribute('href', '/account');
  await expect(
    page.getByRole('button', { name: 'Submit mission request', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('form')).toHaveCount(0);
});
