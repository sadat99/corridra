import { expect, test, type Page } from '@playwright/test';

// Audit fixes 1 (owner-approved packet, 16 Nov 2026), on the real build.
//   33  /plan#receipt-check from 1001 px: the receipt heading is never drawn under the request summary;
//   35  the corner dock never covers a link of the quiet footer, at every width where the floating dock shows.
// The public footer's locked heights (844 at 390, 890 at 768, 575 at 1440) are asserted in footer-option-b.spec.ts;
// this file records them so a change here can be compared before and after.
// AUDIT_SHOTS_DIR=<folder> also writes screenshots.

const shots = process.env.AUDIT_SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

test.describe('33: the receipt check is never covered by the summary', () => {
  for (const width of [1024, 1280, 1440, 1600]) {
    test(`at ${width} a jump to #receipt-check shows its heading uncovered`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/plan#receipt-check');
      await page.evaluate(() => document.fonts.ready);
      const heading = page.locator('#receipt-check h2').first();
      await expect(heading).toBeVisible();
      await page.evaluate(() => document.getElementById('receipt-check')!.scrollIntoView());
      // Every point across the heading belongs to the receipt check, not to the summary drawn above it.
      const covered = await heading.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const y = box.top + box.height / 2;
        const misses: string[] = [];
        for (const x of [box.left + 2, box.left + box.width / 2, box.right - 2]) {
          const hit = document.elementFromPoint(x, y);
          if (!hit || !document.getElementById('receipt-check')!.contains(hit))
            misses.push(`${Math.round(x)}: ${hit?.className || hit?.tagName}`);
        }
        return { misses, top: box.top };
      });
      expect(covered.misses).toEqual([]);
      // The heading sits below the sticky site header, never under it.
      const headerBottom = await page
        .locator('.site-header')
        .first()
        .evaluate((element) => element.getBoundingClientRect().bottom);
      expect(covered.top).toBeGreaterThanOrEqual(headerBottom);
      // The request recap stays sticky beside the form: the receipt check is layered above it, not unstuck.
      expect(
        await page
          .locator('.ux-brief-summary')
          .first()
          .evaluate((element) => getComputedStyle(element).position),
      ).toBe('sticky');
      await shot(page, `33-plan-receipt-${width}`);
    });
  }
});

// The quiet footer is drawn behind the signed-in switch, which the default test server leaves off, so where the page
// shows the full footer it is swapped for the quiet one, as footer-option-b.spec.ts does.
async function quietFooter(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const full = document.querySelector('footer.guide-footer');
    if (!full) return;
    const quiet = document.createElement('footer');
    quiet.className = 'site-footer';
    quiet.innerHTML =
      '<span><a href="/trust">How We Label Facts</a></span><span>© 2026 Corridra</span><span><a href="/privacy">Privacy and request notice</a></span>';
    full.replaceWith(quiet);
  });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

test.describe('35: the corner dock keeps clear of the quiet footer', () => {
  for (const width of [768, 1280, 1440]) {
    test(`at ${width} no quiet footer link sits under the dock on /contributor`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/contributor');
      await quietFooter(page);
      const dock = page.locator('.corner-dock:not(.header-help)');
      await expect(dock).toBeVisible();
      const dockBox = (await dock.boundingBox())!;
      for (const link of await page.locator('footer.site-footer a').all()) {
        const box = (await link.boundingBox())!;
        const overlaps =
          box.x < dockBox.x + dockBox.width &&
          box.x + box.width > dockBox.x &&
          box.y < dockBox.y + dockBox.height &&
          box.y + box.height > dockBox.y;
        expect(overlaps, `${await link.textContent()} overlaps the dock`).toBe(false);
      }
      // The privacy notice is reachable: the point at its centre is the link itself.
      const privacy = page.locator('footer.site-footer a[href="/privacy"]');
      const hit = await privacy.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
        );
      });
      expect(hit).toBe(true);
      await shot(page, `35-contributor-footer-${width}`);
    });
  }

  test('the public footer heights at 390, 768 and 1440 stay within their locked caps', async ({
    page,
  }) => {
    const heights: Record<number, number> = {};
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/about');
      await page.evaluate(() => document.fonts.ready);
      heights[width] = (await page.locator('footer.guide-footer').boundingBox())!.height;
    }
    test.info().annotations.push({ type: 'footer-heights', description: JSON.stringify(heights) });
    expect(heights[390]).toBeLessThanOrEqual(844);
    expect(heights[768]).toBeLessThanOrEqual(890);
    expect(heights[1440]).toBeLessThanOrEqual(575);
  });
});
