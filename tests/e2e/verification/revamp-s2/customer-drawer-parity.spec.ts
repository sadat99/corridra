import { test, expect, signInCustomer } from '../fixtures';
import type { Page } from '@playwright/test';
import { customerTabs } from '../../../../apps/web/lib/ux/customer-navigation';
import { isTitleCase } from '../../../../apps/web/lib/ux/title-case';

// Phone navigation, drawer only (owner, 14 November 2026, "B", answering "bottom bar or drawer"): the bottom tab bar is
// gone, so every destination it reached must still be reached from the hamburger drawer, by the same name and the same
// address, at 390 and at 320, and the desktop sidebar (the same list) must be unchanged. The five destinations are read
// from the navigation model that fed the old tab bar (`customerTabs`), not copied here, so a destination dropped from the
// drawer fails this test. This server has the approved-companies module and Your Move off, so the model is asked
// with those two off, exactly as the shell asks it.
test.beforeEach(async ({ context }, info) => {
  test.skip(info.project.name !== 'w1280', 'Runs once; it switches viewports itself.');
  await signInCustomer(context);
});

const model = customerTabs({ companies: false, move: false });
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Customer navigation' });
const everyLink = (page: Page) =>
  sidebar(page)
    .getByRole('link')
    .evaluateAll((all) =>
      all.map((a) => ({
        name: (a.textContent ?? '').replace(/\s+/g, ' ').trim(),
        href: a.getAttribute('href'),
      })),
    );
const destinations = (page: Page) =>
  sidebar(page)
    .locator(':scope > ul')
    .getByRole('link')
    .evaluateAll((all) =>
      all.map((a) => ({
        name: (a.textContent ?? '').replace(/\s+/g, ' ').trim(),
        href: a.getAttribute('href'),
      })),
    );

for (const width of [390, 320]) {
  test(`at ${width} every destination the tab bar reached is in the drawer, by name and address, and no tab bar is drawn`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/account');
    await expect(page.getByRole('navigation', { name: 'Customer tabs' })).toHaveCount(0);
    await expect(page.locator('.ux-customer-tabs')).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Customer navigation' })).toBeVisible();
    const inDrawer = await destinations(page);
    for (const tab of model) {
      const found = inDrawer.filter((link) => link.href === tab.href);
      expect(found, `${tab.label} (${tab.href}) is in the drawer`).toHaveLength(1);
      expect(found[0]!.name).toContain(tab.label);
      // The labels keep Title Case, as they had on the tab bar.
      expect(isTitleCase(tab.label), tab.label).toBe(true);
    }
    expect(inDrawer.map((link) => link.href)).toEqual(model.map((tab) => tab.href));
    // Each destination opens (a page the person can use, not an error).
    for (const tab of model) {
      const response = await page.request.get(tab.href);
      expect(response.status(), `${tab.href} answered ${response.status()}`).toBeLessThan(400);
    }
    // Home keeps its place in the drawer: it is the way back to the start now that the Home tab is gone.
    await expect(
      sidebar(page).locator(':scope > ul').getByRole('link', { name: 'Home' }),
    ).toHaveAttribute('href', model[0]!.href);
  });
}

test('the desktop sidebar lists the same links, in the same order, as the phone drawer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  await expect(sidebar(page)).toBeVisible();
  const desktop = await everyLink(page);
  expect((await destinations(page)).map((link) => link.href)).toEqual(model.map((tab) => tab.href));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Customer navigation' })).toBeVisible();
  expect(await everyLink(page)).toEqual(desktop);
});
