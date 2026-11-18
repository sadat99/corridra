import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// W1-D, owner decisions of 17 and 18 November 2026 (routes and markets): the Routes page shows six destinations as
// equal rows in one order, and no tabs hide content on /corridors or on a route page. Every route address, link and
// statement is kept; only the presentation changed.
const pages = [
  '/corridors',
  '/corridors/bangladesh-china',
  '/corridors/bangladesh-eu',
  '/corridors/bangladesh-spain',
] as const;
const sizes = [
  { name: '320', width: 320, height: 700 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
] as const;

const rows = (page: Page) => page.locator('.guide-directions li.guide-direction-row');

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

for (const path of pages)
  test(`${path}: shows no tabs`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.locator('.ux-subtabs-panel, [role="tabpanel"]')).toHaveCount(0);
  });

test('/corridors: six destinations in the owner order', async ({ page }) => {
  await page.goto('/corridors');
  await expect(rows(page)).toHaveCount(6);
  await expect(rows(page).locator('h3')).toHaveText([
    'China',
    'EU',
    'UK',
    'US',
    'Australia',
    'Key Asian Markets',
  ]);
});

for (const size of sizes)
  test(`/corridors: the six destination rows are one size at ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/corridors');
    const boxes = await rows(page).evaluateAll((items) =>
      items.map((item) => {
        const { width, height } = item.getBoundingClientRect();
        return { width: Math.round(width), height: Math.round(height) };
      }),
    );
    expect(boxes).toHaveLength(6);
    expect(new Set(boxes.map((box) => box.width)).size, JSON.stringify(boxes)).toBe(1);
    expect(new Set(boxes.map((box) => box.height)).size, JSON.stringify(boxes)).toBe(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'horizontal scroll').toBeLessThanOrEqual(0);
  });

test('/corridors: every route link is kept, and no destination reads as more ready than its page', async ({
  page,
}) => {
  await page.goto('/corridors');
  const list = page.locator('.guide-directions');
  const want = [
    ['Explore this route', '/corridors/bangladesh-china'],
    ['Explore this route', '/corridors/bangladesh-eu'],
    ['Spain', '/corridors/bangladesh-spain'],
    ['Bangladesh to the UK', '/plan?companyCountry=BD&marketCode=GB'],
    ['Bangladesh to the US', '/plan?companyCountry=BD&marketCode=US'],
    ['Bangladesh to Australia', '/plan?companyCountry=BD&marketCode=AU'],
    ['Bangladesh to key Asian markets', '/plan?companyCountry=BD'],
    ['Plan a Mission on Another Route', '/plan'],
  ] as const;
  for (const [name, href] of want)
    await expect(list.locator(`a[href="${href}"]`).filter({ hasText: name })).toHaveCount(1);
  // The two routes with their own page keep their recorded description; the other four carry the one open sentence.
  const open = 'Open now from Bangladesh. Describe your mission and we will review it.';
  await expect(rows(page).nth(0)).toContainText('Source products and machinery.');
  await expect(rows(page).nth(1)).toContainText('Frame an export goal at EU level');
  for (const index of [2, 3, 4, 5]) await expect(rows(page).nth(index)).toContainText(open);
  // Key Asian Markets is an open label: it names no country and has no form code.
  const asia = await rows(page).nth(5).innerText();
  expect(asia).not.toMatch(
    /China|India|Japan|Singapore|Korea|Vietnam|Indonesia|Thailand|Malaysia|marketCode/i,
  );
  await expect(
    page.getByText('No operating offer announced. We tell you plainly if we can help.'),
  ).toBeVisible();
});

test('/corridors: the picker and the sample mission are open on the page, below the destinations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/corridors');
  await expect(page.locator('#directions-title')).toBeVisible();
  await expect(page.locator('#atlas-any-company')).toBeVisible();
  await expect(page.locator('#atlas-any-market')).toBeVisible();
  await expect(page.locator('#commercial-objective')).toBeVisible();
  await expect(page.locator('#mission-example')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open the Sample Mission' })).toBeVisible();
  const order = await page.evaluate(() => {
    const top = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect().top + window.scrollY;
    return [top('#directions-title'), top('#atlas-any-company'), top('#mission-example')];
  });
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

for (const [address, target] of [
  ['/corridors#mission-example', '#mission-example'],
  ['/corridors#commercial-objective', '#commercial-objective'],
  ['/corridors#directions-title', '#directions-title'],
] as const)
  test(`${address} still lands on its content`, async ({ page }) => {
    await page.goto(address);
    await expect(page.locator(target)).toBeVisible();
  });

for (const slug of ['bangladesh-china', 'bangladesh-eu', 'bangladesh-spain'])
  test(`/corridors/${slug}: all three cards are open without a click`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/corridors/${slug}`);
    for (const name of ['What we help with', 'Current availability', 'Where the work happens'])
      await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
    await expect(page.getByText('Available now', { exact: true })).toBeVisible();
    await expect(page.getByText('Not offered', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start a Request on This Route' })).toHaveAttribute(
      'href',
      /^\/plan\?companyCountry=BD&marketCode=/,
    );
  });

for (const path of ['/corridors', '/corridors/bangladesh-china'])
  for (const size of sizes)
    test(`${path}: no axe violations and 44 px targets at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(path);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual(
        [],
      );
      if (size.width <= 768) {
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('main a, main button, main summary')]
            .filter((el) => (el as HTMLElement).offsetParent !== null)
            .map((el) => ({
              text: (el.textContent ?? '').trim().slice(0, 40),
              h: el.getBoundingClientRect().height,
            }))
            .filter((item) => item.h > 0 && item.h < 43.5 && item.text !== ''),
        );
        expect(small).toEqual([]);
      }
    });
