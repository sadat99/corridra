import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// Layout budget, Phase 2a (docs/revamp/specs/layout-budget.md): the public pages that share one template. Each
// is at most 2.0 desktop screens (1440 x 900) and 3.0 phone screens (390 x 844), footer included (owner decision
// of 6 November 2026, with the Ledger footer), with the closing sections in a
// native "Show more" disclosure. Nothing is removed: all the text stays in the server HTML, the old #page-next
// and #page-approach links still open what they point at, and both states pass axe.
const pages = [
  '/sell',
  '/source',
  '/trade-missions',
  '/enter-market',
  '/machinery',
  '/business-trips',
  '/institutions',
  '/network',
];
const sizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
const screens = async (page: Page) =>
  (await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  )) / (await page.evaluate(() => innerHeight));

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

for (const path of pages) {
  for (const [name, size] of Object.entries(sizes))
    test(`${path} is within its page budget at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(path);
      expect(await screens(page), `${path} ${name} screens`).toBeLessThanOrEqual(
        name === 'phone' ? 3.0 : 2.0,
      );
    });

  test(`${path} keeps every word and opens its closing sections with Show more`, async ({
    page,
  }) => {
    await page.setViewportSize(sizes.desktop);
    const served = await (await page.request.get(path)).text();
    await page.goto(path);
    const more = page.locator('details.guide-more');
    await expect(more).toHaveCount(1);
    await expect(more).not.toHaveAttribute('open', '');
    // Every word the server sent for the page's main region is in the page, in the same order.
    const same = await page.evaluate((html) => {
      const text = (node: Element | null) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const sent = new DOMParser().parseFromString(html, 'text/html');
      return { page: text(document.querySelector('main')), sent: text(sent.querySelector('main')) };
    }, served);
    expect(same.page).toBe(same.sent);
    // The closing section is hidden until Show more, then it is there with its link.
    const closing = page.locator('#page-next');
    await expect(closing).toBeHidden();
    await more.locator('summary').click();
    await expect(closing).toBeVisible();
    await expect(closing.getByRole('link').first()).toBeVisible();
  });

  test(`${path}#page-next opens the closing section by its old link`, async ({ page }) => {
    await page.setViewportSize(sizes.desktop);
    await page.goto(`${path}#page-next`);
    await expect(page.locator('#page-next')).toBeVisible();
  });

  for (const [name, size] of Object.entries(sizes))
    test(`${path} has no axe violations at ${name}, collapsed and open`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(path);
      const check = async (label: string) => {
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(
          result.violations.map((v) => `${label} ${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`),
        ).toEqual([]);
      };
      await check('collapsed');
      await page.locator('details.guide-more > summary').click();
      await check('open');
    });
}

// /workspace: the sign-in routes are a native disclosure on a phone and three open columns on a wide screen.
const signInLinks = ['/account', '/operator', '/operator/setup', '/contributor'];
test.describe('/workspace (Phase 2a)', () => {
  for (const [name, size] of Object.entries(sizes))
    test(`/workspace is within its page budget at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/workspace');
      // A public page with the public footer: the public page budget (owner decision of 6 November 2026).
      expect(await screens(page), `/workspace ${name} screens`).toBeLessThanOrEqual(
        name === 'phone' ? 3.0 : 2.0,
      );
    });

  test('on a phone the sign-in routes are collapsed, all in the page, and open with one tap', async ({
    page,
  }) => {
    await page.setViewportSize(sizes.phone);
    await page.goto('/workspace');
    const details = page.locator('details.ux-start-signin-details');
    await expect(details).not.toHaveAttribute('open', '');
    for (const href of signInLinks)
      expect(await page.locator(`.ux-start-signin a[href="${href}"]`).count(), href).toBe(1);
    const summary = details.locator('summary');
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await summary.click();
    for (const href of signInLinks)
      await expect(page.locator(`.ux-start-signin a[href="${href}"]`), href).toBeVisible();
  });

  test('on a desktop the three sign-in routes are open in one row with no tap', async ({
    page,
  }) => {
    await page.setViewportSize(sizes.desktop);
    await page.goto('/workspace');
    for (const href of signInLinks)
      await expect(page.locator(`.ux-start-signin a[href="${href}"]`), href).toBeVisible();
    const tops = await page
      .locator('.ux-start-signin li')
      .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(new Set(tops).size, 'the routes share one row').toBe(1);
  });

  test('every word of the start page is kept', async ({ page }) => {
    await page.setViewportSize(sizes.desktop);
    const served = await (await page.request.get('/workspace')).text();
    await page.goto('/workspace');
    const same = await page.evaluate((html) => {
      const text = (node: Element | null) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const sent = new DOMParser().parseFromString(html, 'text/html');
      return { page: text(document.querySelector('main')), sent: text(sent.querySelector('main')) };
    }, served);
    expect(same.page).toBe(same.sent);
  });

  for (const [name, size] of Object.entries(sizes))
    test(`/workspace has no axe violations at ${name}, collapsed and open`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/workspace');
      const check = async (label: string) => {
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(
          result.violations.map((v) => `${label} ${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`),
        ).toEqual([]);
      };
      await check('start');
      const summary = page.locator('details.ux-start-signin-details > summary');
      if (await summary.isVisible()) await summary.click();
      await check('signin open');
    });
});

// /buyer and /client are private-link pages: with no link they show a public access page with the public footer,
// so the public page budget applies (owner decision of 6 November 2026).
for (const path of ['/buyer', '/client'])
  for (const [name, size] of Object.entries(sizes))
    test(`${path} is within its page budget at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(path);
      expect(await screens(page), `${path} ${name} screens`).toBeLessThanOrEqual(
        name === 'phone' ? 3.0 : 2.0,
      );
    });

// Condition of the Phase 2a approval: each page keeps its one primary action in view without scrolling, at 390
// x 844 and at 1440 x 900.
for (const path of [...pages, '/workspace'])
  for (const [name, size] of Object.entries(sizes))
    test(`${path} keeps its primary action above the fold at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(path);
      const action = page.locator('main a.primary-link').first();
      await expect(action).toBeVisible();
      const box = (await action.boundingBox())!;
      expect(
        box.y + box.height,
        `${path} ${name}: the action ends inside the screen`,
      ).toBeLessThanOrEqual(size.height);
      expect(box.y).toBeGreaterThanOrEqual(0);
    });
