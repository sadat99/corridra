import { test, expect } from '@playwright/test';

// Owner, 9 November 2026: the public page hero must not repeat the header's Start a Request, and its lead belongs
// with the heading. Where the header keeps the action inside Menu (under 75rem), the hero keeps its button.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

const pages = ['/how-it-works', '/trust'] as const;

for (const path of pages) {
  test(`${path} hero shows no repeat of the header action from 1200 px, and keeps it below`, async ({
    page,
  }) => {
    for (const [width, headerShows] of [
      [1780, true],
      [1440, true],
      [1200, true],
      [1199, false],
      [1024, false],
      [390, false],
      [320, false],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const header = page.locator('.public-header .nav-cta');
      const hero = page.locator('.guide-page-hero .guide-page-actions .primary-link');
      await expect(hero, `hero action at ${width}`).toHaveAttribute('href', '/plan');
      if (headerShows) {
        await expect(header, `header action at ${width}`).toBeVisible();
        await expect(hero, `hero action at ${width}`).toBeHidden();
      } else {
        await expect(hero, `hero action at ${width}`).toBeVisible();
      }
    }
  });

  test(`${path} lead starts level with the heading on wide windows`, async ({ page }) => {
    for (const width of [1780, 1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const h1 = await page.locator('.guide-page-hero h1').boundingBox();
      const lead = await page.locator('.guide-page-hero .guide-lead').boundingBox();
      expect(Math.abs(lead!.y - h1!.y), `lead against heading at ${width}`).toBeLessThanOrEqual(2);
    }
  });
}

test('a page with its own hero action keeps it at every width', async ({ page }) => {
  for (const width of [1780, 1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/source');
    await expect(
      page.locator('.guide-page-hero .guide-page-actions .primary-link'),
      `at ${width}`,
    ).toBeVisible();
  }
});
