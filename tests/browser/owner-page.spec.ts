import { expect, test } from '@playwright/test';

// The switch is not set in the public test server, so the page must not exist at all.
test('the Owner page does not exist while its switch is off', async ({ page, request }) => {
  const response = await request.get('/operator/owner', { maxRedirects: 0 });
  expect(response.status()).toBe(404);
  const body = await response.text();
  expect(body).not.toContain('What is on and off');
  expect(body).not.toContain('CORRIDRA_');
  await page.goto('/operator/owner');
  await expect(page.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();
  await expect(page.getByText('What is on and off')).toHaveCount(0);
});

test('the workspace shows no link to the Owner page while its switch is off', async ({
  request,
}) => {
  const response = await request.get('/operator', { maxRedirects: 0 });
  expect(await response.text()).not.toContain('/operator/owner');
});
