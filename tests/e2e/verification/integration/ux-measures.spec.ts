import AxeBuilder from '@axe-core/playwright';
import { test, expect, evidence } from '../fixtures';
import { measuredPages, measurePage, targetsBroken } from '../../../../scripts/qa/ux-measure';

// V-52 to V-60 on the public pages after every stream is merged (program section 8, integration).
// Each page at 390, 768 and 1280 px: no sideways scroll, one H1, at most one open form, no forbidden
// words, no ISO or US dates and no raw id fields. Owner of the harness: WS-E; the pages belong to
// their streams, so a failure here names the page for that stream to fix.

for (const path of measuredPages)
  test(`V-52, V-56 to V-59: ${path} meets the UX targets`, async ({ page }, info) => {
    // 'load', not 'networkidle': signed-out pages keep a session check polling, so the network
    // never idles. The measure reads the rendered page once the main heading is present.
    const response = await page.goto(path, { waitUntil: 'load' });
    await page.locator('h1').first().waitFor({ state: 'attached', timeout: 10000 });
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
  const textField = page
    .locator(
      'main input[type="text"]:visible, main input[type="email"]:visible, main textarea:visible',
    )
    .first();
  // The first steps are choices. Answer each choice step (first option) until a step with a text
  // field appears, then move on without filling it so that step shows its errors.
  for (let step = 0; step < 6 && !(await textField.isVisible()); step++) {
    for (const group of await page.locator('main [role="radiogroup"], main fieldset').all()) {
      const radio = group.locator('input[type="radio"]:visible').first();
      if ((await radio.count()) && !(await group.locator('input:checked').count()))
        await radio.check();
    }
    for (const select of await page.locator('main select:visible').all())
      if (!(await select.inputValue()))
        await select.selectOption({ index: 1 }).catch(() => undefined);
    await page
      .getByRole('button', { name: /^(Continue|Next)/ })
      .first()
      .click();
  }
  await page
    .getByRole('button', { name: /^(Continue|Next)/ })
    .first()
    .click();
  await expect(page.locator('[role="alert"]').filter({ hasText: /\S/ }).first()).toBeVisible();
  const field = textField;
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
