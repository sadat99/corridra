import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('Help is one tap away on every public page and Escape returns focus to it', async ({
  page,
  isMobile,
}) => {
  // On a phone Help is the last row of the menu (UI/UX.v4 screen 10), one tap deeper; elsewhere it is the corner button.
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  for (const route of ['/', '/how-it-works', '/corridors', '/trust', '/sell']) {
    await page.goto(route);
    if (isMobile) await menu.click();
    await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
  }
  await page.goto('/');
  if (isMobile) await menu.click();
  const help = page.getByRole('button', { name: 'Help', exact: true });
  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  const sheet = page.getByRole('dialog', { name: 'Need a hand?' });
  await expect(sheet.getByRole('link', { name: 'See How It Works' })).toHaveAttribute(
    'href',
    '/how-it-works',
  );
  await expect(sheet.getByRole('link', { name: 'Start a Request' })).toHaveAttribute(
    'href',
    '/plan',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(help).toBeFocused();
  await help.click();
  await sheet.getByRole('link', { name: 'See How It Works' }).click();
  await expect(page).toHaveURL('/how-it-works');
});

test('Listen is an icon plus the word Listen in the top bar, no longer a corner button (UI/UX.v4)', async ({
  page,
}) => {
  await page.goto('/');
  const listen = page.getByRole('button', { name: 'Listen to This Page', exact: true });
  // Where the browser has no voice for the page language the button is not shown at all.
  if ((await listen.count()) > 0) {
    await expect(
      page.locator('header').getByRole('button', { name: 'Listen to This Page' }),
    ).toBeVisible();
    await expect(listen).toHaveAttribute('aria-pressed', 'false');
    await expect(listen).toContainText('Listen');
    const box = await listen.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(43.5);
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
    await expect(page.locator('.corner-dock .dock-listen')).toBeHidden();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
