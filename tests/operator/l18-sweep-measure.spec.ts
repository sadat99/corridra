import { test, expect } from '@playwright/test';
import { measurePage, targetsBroken } from '../../scripts/qa/ux-measure';

// L18: the signed-in sweep's measurements. They ran for every page but their result was thrown away (a failed measure
// was swallowed), so sideways scroll, words and length were never checked. These cases drive the real measure in a browser.
test.beforeEach(async ({ page }) => {
  await page.addInitScript('globalThis.__name = (fn) => fn;');
});

test('a sideways-scrolling page, a long page and a forbidden word are all reported', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(
    `<main id="main"><h1>Page</h1><p>This is test mode copy.</p>
     <div style="width:700px;height:2200px">wide and long</div></main>`,
  );
  const m = await measurePage(page, '/x', 200);
  expect(m.horizontalScroll).toBe(true);
  expect(m.screens).toBeGreaterThan(2);
  expect(m.forbidden).toEqual(['/test mode/i']);
  expect(m.forbiddenContext?.[0]).toContain('test mode copy');
  const broken = targetsBroken(m, { signedIn: true });
  expect(broken).toContain('horizontal scroll');
  expect(broken.some((b) => b.startsWith('page length'))).toBe(true);
  expect(broken.some((b) => b.startsWith('forbidden words'))).toBe(true);
});

test('text the run seeded is skipped and every other word is still judged', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(
    `<main id="main"><h1>Page</h1><p>Synthetic QA Test Importers workspace</p>
     <p>qa-test-staff@example.invalid</p><p>An invented example.</p></main>`,
  );
  const options = {
    ignoreText: [/Synthetic QA Test[^\n]*/i, /qa-test-[a-z0-9-]*@example\.invalid/i],
  };
  expect((await measurePage(page, '/x', 200, options)).forbidden).toEqual(['/invented/i']);
  expect((await measurePage(page, '/x', 200)).forbidden).toEqual([
    '/synthetic/i',
    '/invented/i',
    '/@example\\.invalid/i',
  ]);
});
