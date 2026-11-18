import { test, expect, type Page } from '@playwright/test';

// W1-D (owner, 18 November 2026): Routes shows every section open on one page, so its page length is measured here
// and not per tab. /corridors may be longer than the other public pages, only as far as the open content needs; the
// limits are the ones recorded in tests/ux/page-length-lib.ts (routesLimits) and in docs/revamp/specs/layout-budget.md.
// The three route pages stay inside the public limits (3.0 phone, 2.0 desktop). The primary action stays in view.
const sizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
const limit = {
  '/corridors': { phone: 6.5, desktop: 4.0 },
  '/corridors/bangladesh-china': { phone: 3.0, desktop: 2.0 },
  '/corridors/bangladesh-eu': { phone: 3.0, desktop: 2.0 },
  '/corridors/bangladesh-spain': { phone: 3.0, desktop: 2.0 },
} as const;
const screens = async (page: Page) =>
  (await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  )) / (await page.evaluate(() => innerHeight));

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

for (const [path, max] of Object.entries(limit))
  for (const [name, size] of Object.entries(sizes)) {
    test(`${path}: open page length is within its budget at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(path);
      expect(await screens(page), `${path} ${name}`).toBeLessThanOrEqual(
        max[name as keyof typeof max],
      );
    });
    test(`${path}: keeps its primary action above the fold at ${name}`, async ({ page }) => {
      test.skip(
        path === '/corridors' && name === 'phone',
        'the destination rows come first on a phone',
      );
      await page.setViewportSize(size);
      await page.goto(path);
      const action = page
        .locator(
          path === '/corridors'
            ? 'main a[href="/plan"]'
            : '.public-header .nav-cta:visible, main a.primary-link:visible',
        )
        .first();
      await expect(action).toBeVisible();
      const box = (await action.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    });
  }
