import { test, expect, signInCustomer } from '../fixtures';

// Customer shell: below 1024 px the site footer, with the privacy notice link, clears the fixed phone tab bar at the
// end of a long page, and nothing changes at 1024 px and up or on pages without the phone tabs. The verification
// server runs with CORRIDRA_UX_SHELLS_V2 on, which is what draws the phone tabs, so this runs in default CI.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'w1280', 'Runs once; it switches viewports itself.');
});

const pages = ['/account', '/account?view=work', '/account?view=more'];

for (const [width, height] of [
  [390, 844],
  [320, 700],
] as const)
  for (const path of pages)
    test(`the footer link clears the phone tab bar at the bottom of ${path} at ${width}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height });
      await signInCustomer(context);
      await page.goto(path);
      const tabs = page.locator('.ux-customer-tabs');
      await expect(tabs).toBeVisible();
      await page.evaluate(() =>
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
      );
      const link = page.locator('footer.site-footer a').first();
      await expect(link).toBeVisible();
      const tabTop = (await tabs.boundingBox())!.y;
      const linkBox = (await link.boundingBox())!;
      expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(tabTop);
    });

const paddingBottom = (page: import('@playwright/test').Page) =>
  page.locator('footer.site-footer').evaluate((footer) => getComputedStyle(footer).paddingBottom);

for (const [width, height] of [
  [1024, 768],
  [1440, 900],
] as const)
  test(`from 1024 px up the tab bar is hidden and the footer padding is the plain one at ${width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height });
    await signInCustomer(context);
    await page.goto('/account');
    await expect(page.locator('.ux-customer-tabs')).toBeHidden();
    const customer = await paddingBottom(page);
    // The helper page has the same footer and no customer frame, so its padding is what the base rule gives.
    await page.goto('/contributor');
    await expect(page.locator('footer.site-footer')).toBeVisible();
    expect(customer).toBe(await paddingBottom(page));
  });

test('without the phone tabs the footer keeps its base padding at 390', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInCustomer(context);
  await page.goto('/contributor');
  await expect(page.locator('.ux-customer-tabs')).toHaveCount(0);
  await expect(page.locator('footer.site-footer')).toBeVisible();
  expect(await paddingBottom(page)).toBe('22px');
  // A public page has the full footer, which no rule here touches.
  await page.goto('/privacy');
  await expect(page.locator('.ux-customer-tabs')).toHaveCount(0);
  await expect(page.locator('footer a').first()).toBeVisible();
  await expect(page.locator('footer.site-footer')).toHaveCount(0);
});
