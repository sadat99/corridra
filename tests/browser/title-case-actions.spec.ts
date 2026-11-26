import { expect, test } from '@playwright/test';
import { mountHomeV43 } from '../ux/home-v43-fixture';

// Owner rule (5 Nov): English button and button-styled link labels use Title Case.
// Small words stay lower case unless first. The text itself is Title Case (no CSS text-transform).
const small = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'by', 'at']);
const isTitleCase = (label: string) =>
  label
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .every((word, index) => {
      const letters = word.replace(/^[^A-Za-z]+/, '');
      if (!letters || !/^[A-Za-z]/.test(letters)) return true; // numbers, symbols, "2."
      if (index > 0 && small.has(letters.toLowerCase())) return true;
      return /^[A-Z]/.test(letters) || /^[a-z]*[A-Z]/.test(letters);
    });

const pages = [
  '/sell',
  '/source',
  '/trade-missions',
  '/enter-market',
  '/machinery',
  '/business-trips',
  '/institutions',
  '/network',
  '/trust',
  '/workspace',
];

for (const path of pages)
  test(`${path} buttons and button-styled links use Title Case`, async ({ page }) => {
    await page.goto(path);
    for (const summary of await page.locator('details > summary').all())
      if (await summary.isVisible()) await summary.click();
    const labels = await page
      .locator('main button, main a.primary-link, main a.button-secondary, main summary')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => (node as HTMLElement).offsetParent !== null)
          .map((node) => (node.textContent ?? '').trim())
          .filter(Boolean),
      );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((label) => !isTitleCase(label))).toEqual([]);
  });

// Home page v4.3, CORRIDRA_UX_HOME_V43 exactly "true": every button, button-styled link, text action and named
// disclosure of the real v4.3 components is Title Case in the text and none is styled by CSS. The pack's questions are
// headings (sentence case, as the Action labels row allows), so the scan names the actions and leaves the question
// summaries out. The switch-off pages above are unchanged.
test('switch on (v4.3) / actions use Title Case and no CSS text-transform', async ({ page }) => {
  await mountHomeV43(page, { width: 1280 });
  for (const summary of await page.locator('main details.hv43-more > summary').all())
    await summary.click();
  const actions = await page
    .locator(
      'main button, main a.primary-link, main a.button-secondary, main a.text-link, main details.hv43-more > summary, main details.hv43-correction > summary',
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node as HTMLElement).offsetParent !== null)
        .map((node) => ({
          label: (node.textContent ?? '').trim(),
          transform: getComputedStyle(node).textTransform,
        }))
        .filter((action) => action.label),
    );
  expect(actions.length).toBeGreaterThan(40);
  expect(actions.filter((a) => !isTitleCase(a.label)).map((a) => a.label)).toEqual([]);
  expect(actions.filter((a) => a.transform !== 'none').map((a) => a.label)).toEqual([]);
});
