import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { publicPageLimits } from '../ux/page-length-lib';

// About, Editorial layout (owner decision of 6 November 2026, docs/revamp/specs/layout-budget.md section 2). One
// page with no tabs: the old section addresses land on their section and open the disclosures that hold it, Show
// Details is a native disclosure that works by mouse, keyboard and without JavaScript, nothing of the earlier page
// is lost, and the page stays within the public page budget with no sideways scroll.
const sizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
const sectionIds = [
  'why',
  'what',
  'for-whom',
  'how',
  'where',
  'standards',
  'working-together',
] as const;
const screens = async (page: Page) =>
  (await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  )) / (await page.evaluate(() => innerHeight));
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

test('keeps every fact, caveat and link of the About page, with no em dash', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const main = page.locator('main');
  const network =
    process.env.CORRIDRA_NETWORK_ENABLED === 'true'
      ? 'Reviewed contributors can receive specific execution tasks through Corridra Network. Invitations, eligibility review, task assignment and evidence review remain separate steps. Contributor access does not include the full mission or team workspace.'
      : 'Independent contributor participation remains a controlled expansion plan.';
  for (const words of [
    'Corridra helps companies turn a cross-border commercial objective into planned work, relevant relationships and accountable follow-through.',
    'Neither tells you which company fits, what is known or who will take the next step.',
    'A mission is a planned piece of work to meet the right companies and advance a commercial objective.',
    'Exporters, importers, machinery buyers, companies exploring a new market and organisations running business delegations.',
    'First priority: Bangladesh to China sourcing and business delegations.',
    'A listed route does not mean every service is available there. We confirm fit for each request.',
    'Bangladesh, Spain and wider European market relationships form part of the product direction. Each route needs its own reviewed scope and delivery capacity.',
    'A scheduled meeting is not a meeting held. A proposal is not an order, and an order is not cash collected.',
    'Corridra supports decisions and execution. It does not guarantee introductions, company quality, regulatory approval or commercial results.',
    'We publish no unverified client list, network size or success rate.',
    'A submission does not by itself confirm a service commitment. Online payment is not available.',
    'Accepting a quote records an intention to proceed.',
    `${network} Broader market coverage remains a controlled expansion plan.`,
    'Corridra Pte Ltd, 101 Robinson Road, Singapore 180239, with operations in Gulshan, Dhaka, Bangladesh',
  ])
    await expect(main, words).toContainText(words);
  // The trust words are the governed labels.
  for (const label of ['Self-declared', 'Verified'])
    await expect(main.locator('.guide-tag', { hasText: label }).first()).toBeAttached();
  for (const href of ['/plan', '/how-it-works', '/corridors', '/trust', '/network', '/privacy'])
    expect(await main.locator(`a[href="${href}"]`).count(), href).toBeGreaterThan(0);
  // The six road steps carry the shared customer road names (D5), in order.
  await expect(page.locator('#how .about-road h3')).toHaveText([
    'Define',
    'Find',
    'Compare',
    'Visit',
    'Decide',
    'Follow through',
  ]);
  expect(await main.textContent()).not.toContain('—');
  await expect(page).toHaveTitle('About Corridra | Commercial progress across borders');
});

for (const [name, size] of Object.entries(sizes)) {
  test(`every old section address lands on its section and opens what holds it at ${name}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    for (const id of sectionIds) {
      // Each address is opened fresh, as from a link elsewhere.
      await page.goto('about:blank');
      await page.goto(`/about#${id}`);
      await expect(page.locator(`#${id}`), id).toHaveCount(1);
      await expect(page.locator(`#${id} h2`), id).toBeInViewport();
      for (const details of await page.locator(`#${id} details`).all())
        await expect(details, id).toHaveAttribute('open', '');
    }
    // On a phone why is folded; its address opens it.
    await page.goto('/about#why');
    await expect(
      page.getByText('Corridra brings that work together', { exact: false }),
    ).toBeVisible();
    // A section address opens its Show Details.
    await page.goto('/about#standards');
    await expect(page.getByText('What needs a decision stays in view.')).toBeVisible();
  });

  test(`Show Details opens and closes by mouse and keyboard at ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/about');
    const section = page.locator('#where');
    const summary = section.locator('details > summary');
    const detail = section.getByText('Bangladesh, Spain and wider European market relationships');
    await expect(summary).toHaveAccessibleName(/^Show Details/);
    await expect(detail).toBeHidden();
    const box = (await summary.boundingBox())!;
    expect(box.height, 'summary target').toBeGreaterThanOrEqual(43.5);
    await summary.click();
    await expect(detail).toBeVisible();
    await expect(summary).toHaveAccessibleName(/^Hide Details/);
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(detail).toBeHidden();
    await page.keyboard.press('Space');
    await expect(detail).toBeVisible();
    // The section link is reachable: beside Show Details on a wide screen, inside it on a phone.
    await expect(section.getByRole('link', { name: 'Explore the Routes' })).toBeVisible();
  });

  test(`stays within the public page budget, keeps its primary action in view and passes axe at ${name}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/about');
    expect(await screens(page), `${name} screens`).toBeLessThanOrEqual(
      publicPageLimits[name as keyof typeof publicPageLimits].hard,
    );
    const action = page.locator('main a.primary-link').first();
    await expect(action).toHaveAttribute('href', '/plan');
    const box = (await action.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    const closed = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(closed.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
    for (const summary of await page.locator('main details > summary:visible').all())
      await summary.click();
    const open = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(open.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });
}

test('the page never scrolls sideways at 320, 390, 768 and 1440, at 100 and 200 percent text', async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about');
    expect(await sideways(page), `${width} at 100%`).toBeLessThanOrEqual(0);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const summary of await page.locator('main details > summary:visible').all())
      await summary.click();
    expect(await sideways(page), `${width} at 200%`).toBeLessThanOrEqual(0);
  }
});

test('on a phone the four kinds of work scroll sideways inside their row, by keyboard too', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/about');
  const row = page.getByRole('list', { name: 'Four kinds of work' });
  const sizesOf = await row.evaluate((list) => ({
    scroll: list.scrollWidth,
    client: list.clientWidth,
    overflow: getComputedStyle(list).overflowX,
  }));
  expect(sizesOf.overflow).toBe('auto');
  expect(sizesOf.scroll, 'the row holds more than it shows').toBeGreaterThan(sizesOf.client);
  // The next card shows at the edge, so the row reads as one that scrolls.
  const second = (await row.locator('li').nth(1).boundingBox())!;
  expect(second.x).toBeLessThan(sizes.phone.width);
  await row.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => row.evaluate((list) => list.scrollLeft)).toBeGreaterThan(0);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test('See the Six Steps lands on the road on a wide screen', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  await page.getByRole('link', { name: 'See the Six Steps' }).click();
  await expect(page).toHaveURL(/#how$/);
  await expect(page.locator('#how h2')).toBeInViewport();
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  for (const [name, size] of Object.entries(sizes))
    test(`the disclosures still work at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/about');
      const why = page.getByText('Corridra brings that work together', { exact: false });
      // Why is open on a wide screen and folded on a phone; its round control opens it.
      if (name === 'phone') {
        await expect(why).toBeHidden();
        await page.locator('#why summary').click();
      }
      await expect(why).toBeVisible();
      const detail = page.getByText('What needs a decision stays in view.');
      await expect(detail).toBeHidden();
      await page.locator('#standards summary').click();
      await expect(detail).toBeVisible();
    });
});
