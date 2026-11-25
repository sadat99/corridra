import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI/UX.v4.1 ("No repeated links"): inside main, no address is linked twice. Anchors that only move within the page
// (an address starting with #) are the page's own contents and are left out. The public pages that were touched for
// the audit are read here in one place, with axe on the same load, so a repeat or a new violation shows up at once.
// Repeats that are kept on purpose, so the list is short and each has its reason:
//  - Home: one Start a Request per section is the owner's locked public-home spec (audit finding -10, final).
//  - How It Works: the three request links per person were not an audit finding; left for the final sweep.
const kept: Record<string, string[]> = {
  '/': ['/plan'],
  '/how-it-works': ['/plan', '/plan?job=sourcing', '/plan?job=buyers'],
};
const pages = ['/', '/corridors', '/privacy', '/signup', '/how-it-works', '/sell'];

for (const path of pages)
  test(`${path}: no address is linked twice inside main, and axe is clean`, async ({ page }) => {
    await page.goto(path);
    // Closing sections sit behind Show more on some pages; open them so their links are counted too.
    for (const summary of await page.locator('details.guide-more > summary').all())
      await summary.click();
    const hrefs = await page
      .locator('main a[href]')
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href') ?? '')
          .filter((href) => !/^(#|mailto:|tel:)/.test(href)),
      );
    expect(hrefs.length).toBeGreaterThan(0);
    const repeated = [...new Set(hrefs.filter((href, index) => hrefs.indexOf(href) !== index))];
    expect(repeated.filter((href) => !(kept[path] ?? []).includes(href))).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
