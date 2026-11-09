import { test, expect, type Page } from '@playwright/test';

// Owner, 9 November 2026, on How it works, Routes and Trust: "contents are too compressed. even too many
// straightlines". Below the hero the sections are separated by space, not by rules: the hero keeps its one hairline
// and the tab list keeps its underline, while the intro, the evidence label rows, Show More and its first section
// carry no rule. The pages stay within the public page limits (3.0 phone and 2.0 desktop screens, footer included).
const sizes = {
  phone: { width: 390, height: 844, limit: 3.0 },
  desktop: { width: 1440, height: 900, limit: 2.0 },
} as const;
const pages = ['/how-it-works', '/corridors', '/trust'] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

/** Every element in the page body, outside the footer, that draws a horizontal rule at least 300 px wide. */
const rules = (page: Page) =>
  page.evaluate(() => {
    const found: string[] = [];
    for (const el of document.querySelectorAll('main *')) {
      if (el.closest('footer')) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 300) continue;
      const style = getComputedStyle(el);
      for (const side of ['top', 'bottom'] as const) {
        const width = parseFloat(style.getPropertyValue(`border-${side}-width`));
        if (width > 0 && style.getPropertyValue(`border-${side}-style`) !== 'none') {
          found.push(`${side} ${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
        }
      }
    }
    return found;
  });

for (const path of pages) {
  for (const [name, size] of Object.entries(sizes)) {
    test(`${path} separates its sections by space, not stacked rules, at ${name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(path);
      const found = await rules(page);
      // The hero's hairline and the tab list's underline are the only full-width rules; route cards keep their edges.
      const fullWidth = found.filter(
        (rule) =>
          !rule.includes('guide-page-hero') &&
          !rule.includes('ux-subtabs-list') &&
          !rule.startsWith('top li.') &&
          !rule.startsWith('bottom li.') &&
          !rule.includes('guide-other-route') &&
          !/\b(a|button)\./.test(rule),
      );
      expect(fullWidth, `${path} rules below the hero`).toEqual([]);
      if (path === '/trust') {
        const rows = page.locator('.guide-page-intro ul > li');
        await expect(rows).toHaveCount(5);
        for (const row of await rows.all()) {
          await expect(row).toHaveCSS('border-top-width', '0px');
        }
      }
      const height = await page.evaluate(() =>
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      );
      expect(height / size.height, `${path} ${name} screens`).toBeLessThanOrEqual(size.limit);
    });
  }
}
