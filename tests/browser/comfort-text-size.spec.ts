import { test, expect } from '@playwright/test';
import { problems } from './fit';

// W7: a saved Text Size step is in force on load and the pages still fit it at the five widths measured. The
// public pages are measured here because a signed-in page cannot be opened without a session; the signed-in menus are
// measured at the largest step in tests/e2e/verification/revamp-s2/customer-shell.spec.ts.
const pages = ['/', '/plan', '/how-it-works'] as const;
const widths = [320, 390, 768, 1280, 1440] as const;
const steps = [
  ['large', '18px'],
  ['largest', '20px'],
] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

for (const [step, size] of steps) {
  test(`with the ${step} saved step (${size}) the home, request and how it works pages fit at 320, 390, 768, 1280 and 1440`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.addInitScript((value) => localStorage.setItem('corridra.text-size', value), step);
    for (const path of pages) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        const root = await page.evaluate(() => ({
          fontSize: getComputedStyle(document.documentElement).fontSize,
          step: document.documentElement.getAttribute('data-text-size'),
        }));
        expect(root, `${path} at ${width}`).toEqual({ fontSize: size, step });
        expect(await problems(page), `${path} at ${width}`).toEqual([]);
      }
    }
  });
}
