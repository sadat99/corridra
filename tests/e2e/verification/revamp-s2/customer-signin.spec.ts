import { test, expect, signInCustomer } from '../fixtures';

// The test-only customer sign-in (scripts/qa/fake-neon-auth.mjs, started by scripts/qa/verification-server.ts).
// It lets browser tests open the signed-in customer area on a production build. These cases show it signs
// in the one synthetic customer and nobody else, and that signed-out visitors still go to sign-in.

test('S-01 a visitor with no session is sent to sign-in', async ({ page }) => {
  await page.goto('/account');
  await expect(page).toHaveURL(/\/signin/);
});

test('S-02 a visitor with a wrong session token is sent to sign-in', async ({ page, context }) => {
  await context.addCookies([
    {
      name: '__Secure-neon-auth.session_token',
      value: 'not-the-token-' + 'x'.repeat(40),
      domain: '127.0.0.1',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/signin/);
});

test('S-03 the synthetic customer opens the signed-in account area', async ({ page, context }) => {
  await signInCustomer(context);
  const response = await page.goto('/account');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/account(\?|$)/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main')).toBeVisible();
});

test('S-04 the same customer opens another customer page', async ({ page, context }) => {
  await signInCustomer(context);
  const response = await page.goto('/account/notifications');
  expect([200, 404]).toContain(response?.status());
  await expect(page).not.toHaveURL(/\/signin/);
});
