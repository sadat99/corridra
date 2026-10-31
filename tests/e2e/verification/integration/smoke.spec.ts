import { test, expect, qaSeed } from '../fixtures';

// Proves the verification server starts with the QA seed and serves the public home page.
test('verification server serves the home page and wrote the QA seed', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveCount(1);
  const seed = qaSeed();
  expect(seed.tenantId).toMatch(/^[0-9a-f-]{36}$/);
  expect(seed.owner.email.endsWith('@example.invalid')).toBe(true);
});
