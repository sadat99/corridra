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
          await expect(row).toHaveCSS('border-bottom-width', '0px');
        }
      }
      const height = await page.evaluate(() =>
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      );
      expect(height / size.height, `${path} ${name} screens`).toBeLessThanOrEqual(size.limit);
    });
  }
}

test('Show More opens without a rule above its first section, at desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/how-it-works');
  const more = page.locator('details.guide-more');
  await more.locator('summary').click();
  await expect(more).toHaveAttribute('open', '');
  await expect(more).toHaveCSS('border-top-width', '0px');
  await expect(more.locator('summary')).toHaveCSS('border-top-width', '0px');
  await expect(more.locator('.guide-statements')).toHaveCSS('border-top-width', '0px');
});

test('on a phone each step connector reaches the next step number', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/how-it-works');
  const gaps = await page.evaluate(() => {
    const steps = [
      ...document.querySelectorAll('.guide-journey--tabs .guide-phase:not([hidden]) li'),
    ].filter((li) => li.getBoundingClientRect().height > 0);
    return steps.slice(0, -1).map((li, index) => {
      const bottom = li.getBoundingClientRect().bottom;
      const next =
        steps[index + 1]!.querySelector('.guide-step-number')!.getBoundingClientRect().top;
      return Math.round(next - bottom);
    });
  });
  expect(gaps.length).toBeGreaterThan(0);
  for (const gap of gaps) expect(gap).toBeLessThanOrEqual(1);
});

test('the Show More styles reach only the disclosure, never a /plan field that shares its class', async ({
  page,
}) => {
  // /plan renders <label class="field guide-more"> inside the same public main, and a client navigation keeps
  // this page's stylesheet loaded. A field with that class on this page must keep the global divider and spacing.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/how-it-works');
  const style = await page.evaluate(() => {
    const label = document.createElement('label');
    label.className = 'field guide-more';
    label.textContent = 'Probe';
    document.querySelector('main')!.append(label);
    const computed = getComputedStyle(label);
    const result = { border: computed.borderTopWidth, margin: computed.marginTop };
    label.remove();
    return result;
  });
  expect(style).toEqual({ border: '1px', margin: '8px' });
});
