import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('Help is one tap away on every public page and Escape returns focus to it', async ({
  page,
}) => {
  for (const route of ['/', '/how-it-works', '/corridors', '/trust', '/sell']) {
    await page.goto(route);
    await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
  }
  await page.goto('/');
  const help = page.getByRole('button', { name: 'Help', exact: true });
  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  const sheet = page.getByRole('dialog', { name: 'Need a hand?' });
  await expect(sheet.getByRole('link', { name: 'See how it works' })).toHaveAttribute(
    'href',
    '/how-it-works',
  );
  await expect(sheet.getByRole('link', { name: 'Start a request' })).toHaveAttribute(
    'href',
    '/plan',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(help).toBeFocused();
  await help.click();
  await sheet.getByRole('link', { name: 'See how it works' }).click();
  await expect(page).toHaveURL('/how-it-works');
});

test('Listen is a small named icon button in the corner, not part of the header', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('header').getByText('Listen')).toHaveCount(0);
  const listen = page.getByRole('button', { name: 'Listen to this page', exact: true });
  // Where the browser has no voice for the page language the button is not shown at all.
  if ((await listen.count()) > 0) {
    await expect(listen).toHaveAttribute('aria-pressed', 'false');
    const box = await listen.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(43);
    expect(box!.width).toBeLessThanOrEqual(48);
    const viewport = page.viewportSize()!;
    expect(box!.x + box!.width).toBeGreaterThan(viewport.width - 40);
    expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
