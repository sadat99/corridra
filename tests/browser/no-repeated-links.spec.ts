import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mountHomeV42 } from '../ux/home-v42-fixture';

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

// Home page v4.2, CORRIDRA_UX_HOME_V42 exactly "true" (owner, 25 Nov 2026: "lock this v4.2", "Add a switch, off by
// default"; D9: Start a Request stays in the choice block and the closing band, no more). The cases above stay the
// switch-off truth and are unchanged; this case mounts the real v4.2 components on the live home's styles
// (tests/ux/home-v42-fixture.ts), so the suite keeps one build with the switch off.
test('switch on (v4.2) /: no address is linked twice inside main beyond the kept /plan, before and after each door', async ({
  page,
}) => {
  await mountHomeV42(page, { width: 1440 });
  const repeats = () =>
    page.locator('main a[href]').evaluateAll((links) => {
      const hrefs = links
        .map((link) => link.getAttribute('href') ?? '')
        .filter((href) => !/^(#|mailto:|tel:)/.test(href));
      return [...new Set(hrefs.filter((href, index) => hrefs.indexOf(href) !== index))];
    });
  expect((await repeats()).filter((href) => !kept['/']!.includes(href))).toEqual([]);
  // After a door, the first action points at that route's request, which the closing band also links: the live
  // home does exactly the same (checked on a054c51c), so the chosen route's link is the only extra repeat allowed.
  const job = {
    china: '/plan?job=sourcing',
    sell: '/plan?job=buyers',
    delegation: '/plan?job=delegations',
    other: '/plan',
  };
  for (const [value, href] of Object.entries(job)) {
    await page.locator(`.hv42-choose .tr-door:has(input[value="${value}"]) label`).click();
    expect(
      (await repeats()).filter((h) => !kept['/']!.includes(h) && h !== href),
      value,
    ).toEqual([]);
  }
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
});
