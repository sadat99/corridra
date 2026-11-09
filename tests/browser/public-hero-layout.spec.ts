import { test, expect } from '@playwright/test';

// Owner, 9 November 2026: the public page hero must not repeat the header's Start a Request, and its lead belongs
// with the heading. Where the header keeps the action inside Menu (under 67rem), the hero keeps its button.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

const pages = ['/how-it-works', '/trust'] as const;

// Property: at every width, at normal and at 200% text, with and without a 15 px scrollbar, the action is in view in
// the header bar or in the hero, never in neither and never in both. The header decides by its own container width in
// rem, so the sweep includes the edges (1199, 1200, 1215, 1216) and the scrollbar and large-text cases.
const widths = [
  ...Array.from({ length: 26 }, (_, i) => 320 + i * 64),
  390,
  768,
  1000,
  1199,
  1200,
  1215,
  1216,
  1279,
  1280,
  1920,
  2271,
  2272,
  2400,
];
const scrollbar =
  'html { overflow-y: scroll; } ::-webkit-scrollbar { width: 15px; } body { min-height: 300vh; }';

for (const path of pages) {
  for (const [name, css] of [
    ['100% text', ''],
    ['200% text', 'html { font-size: 200% !important; }'],
    ['100% text with a 15 px scrollbar', scrollbar],
    ['200% text with a 15 px scrollbar', `${scrollbar} html { font-size: 200% !important; }`],
  ] as const) {
    test(`${path} shows the action in the header bar or the hero, never neither or both: ${name}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        if (css) await page.addStyleTag({ content: css });
        const header = page.locator('.public-header .nav-cta');
        const hero = page.locator('.guide-page-hero .guide-page-actions .primary-link');
        await expect(hero).toHaveAttribute('href', '/plan');
        // The bar link exists in the narrow layout too, inside the closed Menu, where it has no box.
        const inBar = await header.evaluate((el) => el.getBoundingClientRect().width > 0);
        const inHero = await hero.evaluate((el) => el.getBoundingClientRect().width > 0);
        expect([inBar, inHero], `${path} at ${width}, ${name}: header bar then hero`).not.toEqual([
          false,
          false,
        ]);
        expect([inBar, inHero], `${path} at ${width}, ${name}`).not.toEqual([true, true]);
      }
    });
  }

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
