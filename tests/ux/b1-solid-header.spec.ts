import { expect, test } from '@playwright/test';

// Owner, 23 Nov 2026: solid sticky header (supersedes the translucent header of 18 Nov 2026).
for (const width of [1280, 390])
  test(`the public header is solid and stays at the top at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const header = page.locator('.site-header.public-header');
    await expect(header).toBeVisible();
    const before = await header.evaluate((node) => {
      const style = getComputedStyle(node);
      const probe = document.createElement('canvas').getContext('2d')!;
      probe.fillStyle = style.backgroundColor;
      probe.fillRect(0, 0, 1, 1);
      return {
        alpha: probe.getImageData(0, 0, 1, 1).data[3],
        blur: style.backdropFilter,
        webkitBlur: style.getPropertyValue('-webkit-backdrop-filter'),
        position: style.position,
        page: getComputedStyle(document.body).backgroundColor,
        fill: style.backgroundColor,
      };
    });
    expect(before.alpha).toBe(255);
    expect(before.blur).toBe('none');
    expect(['', 'none']).toContain(before.webkitBlur);
    expect(before.position).toBe('sticky');
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(async () => (await header.boundingBox())?.y).toBe(0);
  });
