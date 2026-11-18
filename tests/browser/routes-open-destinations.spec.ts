import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// W1-D, owner decisions of 17 and 18 November 2026 (routes and markets) and the step 2 board, screen 02: the Routes
// page shows six destinations as rows of one size in one order, and no tabs hide content on /corridors or on a route
// page. What the board moved out of view sits in named disclosures, closed by default and still in the page.
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

test('/corridors: the board heading, lead and line', async ({ page }) => {
  await page.goto('/corridors');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Routes from Bangladesh');
  await expect(page.getByText('Pick where you want to work.', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Every route follows the same steps.', { exact: true }),
  ).toBeVisible();
});

test('/corridors: six destinations in the owner order, each with its line', async ({ page }) => {
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
  await expect(rows(page).locator('p')).toHaveText([
    'Buy products and machinery',
    'Sell to buyers in EU countries',
    'Sell your products',
    'Sell your products',
    'Sell your products',
    'Name the market in your request',
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

test('/corridors: every row has the same action and every route link is kept', async ({ page }) => {
  await page.goto('/corridors');
  const want = [
    ['China', '/corridors/bangladesh-china'],
    ['EU', '/corridors/bangladesh-eu'],
    ['UK', '/plan?companyCountry=BD&marketCode=GB'],
    ['US', '/plan?companyCountry=BD&marketCode=US'],
    ['Australia', '/plan?companyCountry=BD&marketCode=AU'],
    ['Key Asian Markets', '/plan?companyCountry=BD'],
  ] as const;
  for (const [name, href] of want) {
    const link = page.getByRole('link', { name: `See This Route: ${name}`, exact: true });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toContainText('See This Route');
  }
  // Key Asian Markets is an open label: it names no country and has no form code.
  const asia = await rows(page).nth(5).innerText();
  expect(asia).not.toMatch(
    /China|India|Japan|Singapore|Korea|Vietnam|Indonesia|Thailand|Malaysia|marketCode/i,
  );
  // No flag mark exists yet, so every flag slot is empty (the shared flag component is wired later).
  expect(
    await page
      .locator('.guide-direction-flag')
      .evaluateAll((e) => e.map((x) => x.childElementCount)),
  ).toEqual([0, 0, 0, 0, 0, 0]);
});

test('/corridors: Another Route block has its three actions and one primary', async ({ page }) => {
  await page.goto('/corridors');
  await expect(page.getByRole('heading', { name: 'Another route?' })).toBeVisible();
  await expect(
    page.getByText('No operating offer announced. We tell you plainly if we can help.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Plan a Mission on Another Route' })).toHaveAttribute(
    'href',
    '/plan',
  );
  await expect(page.getByRole('link', { name: 'See a Sample Mission' })).toHaveAttribute(
    'href',
    '#mission-example',
  );
  await expect(page.locator('main a.primary-link')).toHaveCount(1);
  await expect(
    page.getByRole('link', { name: 'Start a Request', exact: true }).last(),
  ).toHaveAttribute('href', '/plan');
});

test('/corridors: what the board moved out of view is in three named disclosures, closed and still in the page', async ({
  page,
}) => {
  await page.goto('/corridors');
  const more = page.locator('details.guide-routes-more');
  await expect(more).toHaveCount(3);
  await expect(more.locator('> summary')).toHaveText([
    'About These Routes',
    'Pick Your Route',
    'Sample Mission',
  ]);
  for (let i = 0; i < 3; i++) await expect(more.nth(i)).not.toHaveAttribute('open', '');
  // The words stay in the server HTML.
  const served = await (await page.request.get('/corridors')).text();
  for (const text of [
    'The job comes first. The route gives it context.',
    'Selling in Spain?',
    'href="/corridors/bangladesh-spain"',
    'Pick your route',
    'A mission, before anyone commits.',
  ])
    expect(served, text).toContain(text);
});

test('/corridors: See a Sample Mission and the old addresses open the disclosure that holds them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/corridors');
  await page.getByRole('link', { name: 'See a Sample Mission' }).click();
  await expect(page.locator('#mission-example')).toBeVisible();
  await page.goto('/corridors#mission-example');
  await expect(page.locator('#mission-example')).toBeVisible();
  await page.goto('/corridors#commercial-objective');
  await expect(page.locator('#commercial-objective')).toBeVisible();
  await page.goto('/corridors');
  await page.getByText('Pick Your Route', { exact: true }).click();
  await expect(page.locator('#atlas-any-company')).toBeVisible();
  await expect(page.locator('#atlas-any-market')).toBeVisible();
});

test('/corridors/bangladesh-china: the board words, four jobs, two named disclosures', async ({
  page,
}) => {
  await page.goto('/corridors/bangladesh-china');
  await expect(page.locator('main .label').first()).toHaveText('Bangladesh China');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Start with the requirement.Then every supplier conversation counts.',
  );
  await expect(page.locator('.guide-detail-open li')).toHaveText([
    'Product and component sourcing',
    'Machinery and technical evaluation',
    'Factory visits and supplier talks',
    'Commercial delegations',
  ]);
  const more = page.locator('.guide-detail-open details.guide-more');
  await expect(more.locator('> summary')).toHaveText([
    'Current Availability',
    'Where the Work Happens',
  ]);
  for (let i = 0; i < 2; i++) await expect(more.nth(i)).not.toHaveAttribute('open', '');
  await more.nth(0).locator('summary').click();
  await expect(page.getByText('Available now', { exact: true })).toBeVisible();
  await expect(page.getByText('Not offered', { exact: true })).toBeVisible();
  await more.nth(1).locator('summary').click();
  await expect(page.getByText('A proposed visit is not a confirmed appointment.')).toBeVisible();
  await expect(
    page.getByText(
      'We check each company against the scope you agree. We do not claim a supplier network or certification. We do not guarantee buyers.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'How We Label Facts' })).toHaveAttribute(
    'href',
    '/trust',
  );
  await expect(page.getByRole('link', { name: 'Start a Request on This Route' })).toHaveAttribute(
    'href',
    '/plan?companyCountry=BD&marketCode=CN',
  );
});

for (const slug of ['bangladesh-eu', 'bangladesh-spain'])
  test(`/corridors/${slug}: the same two named disclosures and every statement in the page`, async ({
    page,
  }) => {
    await page.goto(`/corridors/${slug}`);
    const served = await (await page.request.get(`/corridors/${slug}`)).text();
    for (const text of [
      'What we help with',
      'Current availability',
      'Where the work happens',
      'Available now',
      'Not offered',
    ])
      expect(served, text).toContain(text);
    await expect(page.locator('.guide-detail-open details.guide-more > summary')).toHaveText([
      'Current Availability',
      'Where the Work Happens',
    ]);
  });

for (const path of ['/corridors', '/corridors/bangladesh-china'])
  for (const size of sizes)
    test(`${path}: no axe violations and 44 px targets at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(path);
      for (const summary of await page.locator('main details > summary').all())
        await summary.click();
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
