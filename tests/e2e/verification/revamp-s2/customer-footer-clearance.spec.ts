import { test, expect, signInCustomer } from '../fixtures';

// Customer shell: the phone has no bottom tab bar (owner, 14 November 2026, "B": drawer only). At the end of a long page
// the site footer, with the privacy notice link, is fully on screen and nothing is drawn over it, and its padding is the
// plain one it has everywhere else. The verification server runs with CORRIDRA_UX_SHELLS_V2 on, which is what draws the
// customer frame, so this runs in default CI.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'w1280', 'Runs once; it switches viewports itself.');
});

const paddingBottom = (page: import('@playwright/test').Page) =>
  page.locator('footer.site-footer').evaluate((footer) => getComputedStyle(footer).paddingBottom);

const pages = ['/account', '/account?view=work', '/account?view=more'];

for (const [width, height] of [
  [390, 844],
  [320, 700],
] as const)
  for (const path of pages)
    test(`the footer link is on screen and uncovered at the bottom of ${path} at ${width}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height });
      await signInCustomer(context);
      await page.goto(path);
      await expect(page.locator('.ux-customer-tabs')).toHaveCount(0);
      await page.evaluate(() =>
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
      );
      const link = page.locator('footer.site-footer a').first();
      await expect(link).toBeVisible();
      // Nothing is fixed over the footer: its link is the top element at its own centre, and it ends inside the window.
      const clear = await link.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { inside: box.bottom <= window.innerHeight, covered: !top || !node.contains(top) };
      });
      expect(clear).toEqual({ inside: true, covered: false });
      // The footer keeps the padding it has on every other signed-in page: no room is held back for a bar.
      const customer = await paddingBottom(page);
      await page.goto('/contributor');
      await expect(page.locator('footer.site-footer')).toBeVisible();
      expect(customer).toBe(await paddingBottom(page));
    });

for (const [width, height] of [
  [1024, 768],
  [1440, 900],
] as const)
  test(`from 1024 px up there is no tab bar and the footer padding is the plain one at ${width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height });
    await signInCustomer(context);
    await page.goto('/account');
    await expect(page.locator('.ux-customer-tabs')).toHaveCount(0);
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
