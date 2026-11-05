import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// Layout budget, Phase 1 (docs/revamp/specs/layout-budget.md): the compact footer and the privacy notice in
// sections. Page length is the full document height over the viewport height: at most 2.0 phone screens (390 x
// 844) and 1.0 desktop screen (1440 x 900). Content is never removed: hidden content stays in the server HTML.
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

const footerLinks = [
  '/workspace',
  '/corridors#mission-example',
  '/trust',
  '/about',
  '/network',
  '/institutions',
  '/privacy',
];

test.describe('the compact footer (L-02)', () => {
  test('on a phone the link groups are collapsed, the footer is short and every link is still there', async ({
    page,
  }) => {
    await page.setViewportSize(sizes.phone);
    await page.goto('/about');
    const footer = page.locator('footer.guide-footer');
    const box = await footer.boundingBox();
    expect(box!.height / sizes.phone.height, 'footer height in phone screens').toBeLessThanOrEqual(
      0.4,
    );
    const groups = footer.locator('details.guide-footer-details');
    await expect(groups).toHaveCount(2);
    for (const group of await groups.all()) await expect(group).not.toHaveAttribute('open', '');
    for (const href of footerLinks)
      expect(await footer.locator(`a[href="${href}"]`).count(), href).toBeGreaterThan(0);
    // Opening a group shows its links; the summary is a 44 px target.
    const summary = groups.first().locator('summary');
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await summary.click();
    await expect(groups.first().locator('a').first()).toBeVisible();
  });

  test('on a desktop the footer is one short row, every link is in the page, and each group opens to its links', async ({
    page,
  }) => {
    await page.setViewportSize(sizes.desktop);
    await page.goto('/about');
    const footer = page.locator('footer.guide-footer');
    const box = await footer.boundingBox();
    expect(
      box!.height / sizes.desktop.height,
      'footer height in desktop screens',
    ).toBeLessThanOrEqual(0.1);
    for (const href of footerLinks)
      expect(await footer.locator(`a[href="${href}"]`).count(), href).toBeGreaterThan(0);
    // The notice line is always in view; each group opens to a full row of its links.
    await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
    for (const group of await footer.locator('details.guide-footer-details').all()) {
      await group.locator('summary').click();
      for (const link of await group.locator('a').all()) await expect(link).toBeVisible();
      expect((await group.boundingBox())!.width).toBeGreaterThan(900);
    }
  });

  for (const [name, size] of Object.entries(sizes))
    test(`the footer has no axe violations at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/about');
      const result = await new AxeBuilder({ page })
        .include('footer.guide-footer')
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual(
        [],
      );
    });
});

const visibleArticles = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('section.guide-doc > article'))
      .filter((a) => a.getBoundingClientRect().height > 0)
      .map((a) => a.id),
  );

test.describe('the privacy notice in sections (L-02, L-05)', () => {
  for (const [name, size] of Object.entries(sizes))
    test(`the notice is within its page budget at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/privacy');
      const limit = name === 'phone' ? 2.0 : 1.0;
      expect(await screens(page), `${name} screens`).toBeLessThanOrEqual(limit);
    });

  test('one section shows at first, every contents link opens its section, and an old #id link works', async ({
    page,
  }) => {
    await page.setViewportSize(sizes.desktop);
    await page.goto('/privacy');
    expect(await visibleArticles(page)).toEqual(['summary']);
    const hrefs = await page
      .locator('nav.guide-contents a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')!));
    expect(hrefs.length).toBeGreaterThan(10);
    for (const href of hrefs) {
      await page.locator(`nav.guide-contents a[href="${href}"]`).click();
      expect(await visibleArticles(page), href).toEqual([href.slice(1)]);
    }
    await page.goto('/privacy#storage');
    expect(await visibleArticles(page)).toEqual(['storage']);
  });

  test('"Show the Whole Notice" shows every section with every word, and hides again', async ({
    page,
  }) => {
    await page.setViewportSize(sizes.phone);
    const served = await (await page.request.get('/privacy')).text();
    await page.goto('/privacy');
    const toggle = page.getByRole('button', { name: 'Show the Whole Notice' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The page's sections, and the same sections as the server sent them. The server HTML is parsed by the
    // browser, so no entity is decoded by hand.
    const all = await page.evaluate((html) => {
      const text = (node: Element) => (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      const sent = new DOMParser().parseFromString(html, 'text/html');
      return Array.from(document.querySelectorAll<HTMLElement>('section.guide-doc > article')).map(
        (a) => ({
          id: a.id,
          visible: a.getBoundingClientRect().height > 0,
          text: text(a),
          sent: text(sent.getElementById(a.id)!),
        }),
      );
    }, served);
    expect(all.length).toBeGreaterThan(10);
    for (const article of all) {
      expect(article.visible, `${article.id} is shown`).toBe(true);
      // Every word the server sent for this section is in the page, in the same order.
      expect(article.text, `${article.id}: every word kept`).toBe(article.sent);
    }
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect((await visibleArticles(page)).length).toBe(1);
  });

  test('the whole notice prints in full', async ({ page }) => {
    await page.setViewportSize(sizes.desktop);
    await page.goto('/privacy');
    await page.emulateMedia({ media: 'print' });
    const total = await page.locator('section.guide-doc > article').count();
    expect((await visibleArticles(page)).length).toBe(total);
  });

  for (const [name, size] of Object.entries(sizes))
    test(`the notice has no axe violations at ${name}, in sections and in full`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.goto('/privacy');
      const check = async (label: string) => {
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(
          result.violations.map((v) => `${label} ${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`),
        ).toEqual([]);
      };
      await check('sections');
      await page.getByRole('button', { name: 'Show the Whole Notice' }).click();
      await check('whole');
    });
});
