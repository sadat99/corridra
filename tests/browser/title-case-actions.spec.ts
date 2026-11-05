import { expect, test } from '@playwright/test';

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
