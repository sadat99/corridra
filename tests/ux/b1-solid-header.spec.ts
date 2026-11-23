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
    // The fill reaches both screen edges: the bar sits inside the page's side padding, and one copy of its own
    // fill each way (same colour, no blur, no vertical offset) is wide enough to cover the strip beside it.
    const box = (await header.boundingBox())!;
    const edges = await header.evaluate((node) => {
      const style = getComputedStyle(node);
      const shadows = style.boxShadow.split(/,(?![^(]*\))/).map((part) => {
        const colour = /rgba?\([^)]*\)/.exec(part)?.[0] ?? '';
        const [x, y, blur, spread] = part.replace(colour, '').trim().split(/\s+/).map(parseFloat);
        return { colour, x, y, blur, spread };
      });
      return { fill: style.backgroundColor, shadows };
    });
    expect(edges.shadows).toHaveLength(2);
    for (const shadow of edges.shadows) {
      expect(shadow.colour).toBe(edges.fill);
      expect([shadow.y, shadow.blur, shadow.spread]).toEqual([0, 0, 0]);
    }
    const reach = edges.shadows.map((shadow) => shadow.x).sort((one, two) => one - two);
    expect(reach[0]).toBeLessThanOrEqual(-box.x);
    expect(reach[1]).toBeGreaterThanOrEqual(width - (box.x + box.width));
    // Both side strips are painted alike, edge to edge of the bar's height.
    const strip = (x: number) =>
      page.screenshot({ clip: { x, y: 8, width: 3, height: Math.floor(box.height) - 16 } });
    if (box.x >= 4) expect((await strip(0)).equals(await strip(width - 3))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
