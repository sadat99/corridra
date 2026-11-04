import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// Wave 6 (Q-01, Q-02, Q-03) on the public pages, against a production build. One case per page and check:
// keyboard (no positive tabindex, every stop shows focus, no trap), reflow (no sideways scroll at 320 and at
// 640 CSS px, which is 1280 at 200 percent zoom) and axe (wcag2a and wcag2aa at 390 and 1440). Existing
// tokens only; nothing is skipped. The sign-in, sign-up, password and verify-email pages are out of scope.
const pages = [
  '/',
  '/plan',
  '/about',
  '/how-it-works',
  '/network',
  '/trust',
  '/workspace',
  '/sell',
  '/machinery',
  '/enter-market',
  '/trade-missions',
  '/business-trips',
  '/corridors',
  '/corridors/bangladesh-china',
  '/programme',
  '/institutions',
  '/privacy',
  '/source',
];

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

async function open(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  const response = await page.goto(path);
  expect(response?.status(), path).toBeLessThan(400);
  await expect(page.locator('main h1').first()).toBeVisible();
}

for (const path of pages) {
  for (const width of [390, 1440])
    test(`Q-03 ${path} has no axe violations at ${width}`, async ({ page }) => {
      await open(page, path, width);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 160)}`)).toEqual(
        [],
      );
    });

  for (const width of [320, 640])
    test(`Q-02 ${path} reflows at ${width} with no sideways scroll`, async ({ page }) => {
      await open(page, path, width);
      const over = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - innerWidth,
        // Anything a person can act on that sits wholly or partly off the right edge.
        cut: Array.from(
          document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea'),
        )
          .filter((el) => {
            const box = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return (
              box.width > 0 &&
              style.visibility !== 'hidden' &&
              !el.closest('[hidden],[inert],.sr-only') &&
              box.right > innerWidth + 1
            );
          })
          .map((el) => `${el.tagName} ${el.textContent?.trim().slice(0, 40)}`),
      }));
      expect(over.page, 'sideways scroll').toBeLessThanOrEqual(0);
      expect(over.cut, 'actions cut off').toEqual([]);
    });

  test(`Q-01 ${path} is operable by keyboard with focus always visible and no trap`, async ({
    page,
  }) => {
    await open(page, path, 1440);
    const positive = await page.evaluate(
      () => document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex^="-"])').length,
    );
    expect(positive, 'positive tabindex').toBe(0);
    const stops = await page.evaluate(() => {
      const seen = new Set<string>();
      return Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]',
        ),
      ).filter((el) => {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height || getComputedStyle(el).visibility === 'hidden') return false;
        if (el.closest('[hidden],[inert],details:not([open]) > :not(summary)')) return false;
        if (el instanceof HTMLInputElement && el.type === 'radio') {
          if (seen.has(el.name)) return false;
          seen.add(el.name);
        }
        return true;
      }).length;
    });
    expect(stops).toBeGreaterThan(0);
    const without: string[] = [];
    let repeats = 0;
    let previous: string | null = null;
    let left = false;
    for (let press = 0; press < stops + 12 && !left; press++) {
      await page.keyboard.press('Tab');
      const now = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const ring =
          (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none';
        return {
          id: `${el.tagName}#${el.id}.${el.className}|${el.textContent?.trim().slice(0, 30)}`,
          ring,
        };
      });
      if (!now) {
        left = true;
        break;
      }
      if (!now.ring) without.push(now.id);
      repeats = now.id === previous ? repeats + 1 : 0;
      expect(repeats, `focus stuck on ${now.id}`).toBeLessThan(3);
      previous = now.id;
    }
    expect(without, 'stops without a visible focus indicator').toEqual([]);
  });
}
