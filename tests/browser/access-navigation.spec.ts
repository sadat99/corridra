import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('protected access entries explain unavailable configuration and offer a way back', async ({
  page,
}) => {
  for (const route of ['/operator', '/operator/signin', '/contributor']) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('main')).toContainText(/not configured/);
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Back to Corridra' }),
    ).toHaveAttribute('href', '/');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('invited network and private sharing help have connected recovery paths', async ({ page }) => {
  await page.goto('/network');
  await page.getByRole('link', { name: 'Already invited? Open assigned-task access' }).click();
  await expect(page).toHaveURL(/\/contributor$/);
  await expect(page.getByRole('heading', { name: 'Your assigned tasks.' })).toBeVisible();
  for (const route of ['/client', '/programme']) {
    await page.goto(route);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('private link');
    await expect(page.getByRole('link', { name: 'Customer account', exact: true })).toHaveAttribute(
      'href',
      '/account',
    );
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Back to Corridra' }),
    ).toBeVisible();
  }
});
