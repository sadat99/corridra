import AxeBuilder from '@axe-core/playwright';
import { test, expect, evidence } from '../fixtures';
import { measuredPages, measurePage, targetsBroken } from '../../../../scripts/qa/ux-measure';

// V-52 to V-60 on the public pages after every stream is merged (program section 8, integration).
// Each page at 390, 768 and 1280 px: no sideways scroll, one H1, at most one open form, no forbidden
// words, no ISO or US dates and no raw id fields. Owner of the harness: WS-E; the pages belong to
// their streams, so a failure here names the page for that stream to fix.

for (const path of measuredPages)
  test(`V-52, V-56 to V-59: ${path} meets the UX targets`, async ({ page }, info) => {
    const response = await page.goto(path, { waitUntil: 'networkidle' });
    const measure = await measurePage(page, path, response?.status() ?? 0);
    test.info().annotations.push({ type: 'measure', description: JSON.stringify(measure) });
    expect(targetsBroken(measure), `${path} at ${info.project.name}`).toEqual([]);
  });

test('V-53: the home page has no automatic accessibility violations and works from the keyboard', async ({
  page,
}, info) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'none';
    const style = getComputedStyle(el);
    return style.outlineStyle === 'none' && style.boxShadow === 'none' ? 'none' : 'visible';
  });
  expect(outline).toBe('visible');
  await evidence(page, `V-53-${info.project.name}`);
});

test('V-55: the home page is ready in under 3 seconds', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  const ms = await page.evaluate(() => {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return entry ? entry.domContentLoadedEventEnd : 0;
  });
  expect(ms).toBeGreaterThan(0);
  expect(ms).toBeLessThan(3000);
});

test('CQ-01: on /plan, typing in a field with errors keeps the focus in that field', async ({
  page,
}, info) => {
  await page.goto('/plan');
  // Move forward without answering until the form shows its error summary (at most five steps).
  for (let step = 0; step < 5; step++) {
    if ((await page.locator('[role="alert"]').filter({ hasText: /\S/ }).count()) > 0) break;
    const next = page.getByRole('button', { name: /^(Continue|Next)/ }).first();
    if (!(await next.isVisible())) break;
    await next.click();
  }
  const field = page
    .locator(
      'main input[type="text"]:visible, main input[type="email"]:visible, main textarea:visible',
    )
    .first();
  await expect(field).toBeVisible();
  await field.click();
  for (const key of ['a', 'b', 'c', 'd']) {
    await page.keyboard.type(key);
    expect(await field.evaluate((el) => el === document.activeElement), `after "${key}"`).toBe(
      true,
    );
  }
  await evidence(page, `CQ-01-${info.project.name}`);
});
