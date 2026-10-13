import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = [
  ['/', 'Going into a new market?'],
  ['/sell', 'Make the trip commercially useful.'],
  ['/source', 'Visit fewer suppliers.'],
  ['/enter-market', 'without entering it blind.'],
  ['/trade-missions', 'a reason to be in the room.'],
  ['/how-it-works', 'One commercial objective.'],
  ['/network', 'local knowledge'],
  ['/institutions', 'Stop measuring trade missions by attendance.'],
  ['/trust', 'Know what is claimed.'],
  ['/about', 'Make market entry deliberate.'],
  ['/plan', 'What needs to happen?'],
  ['/signin', 'Sign-in is coming soon.'],
  ['/privacy', 'Use test details for now.'],
];

for (const [route, heading] of routes) {
  test(`${route} has honest copy, accessible content and a responsive layout`, async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    await expect(page).toHaveTitle(/Corridra/);
    await expect(
      page.getByText('Mission intake is open for test briefs. Customer missions are not open yet.'),
    ).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain('\u2014');
    if (route !== '/plan') await expect(page.locator('input, textarea, form')).toHaveCount(0);
    else
      await expect(
        page.getByText('Test intake is open. Real customer mission admission is unavailable.', {
          exact: true,
        }),
      ).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations).toEqual([]);
    expect(failures).toEqual([]);
  });
}

test('navigation opens, closes with Escape and takes visitors to a solution', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const menu = page.getByRole('button', { name: /^(Menu|Close menu)$/ });
  if (isMobile) {
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).not.toBeVisible();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
  }
  const solutions = page.locator('summary');
  await solutions.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('link', { name: 'Sell in a new market', exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('details')).not.toHaveAttribute('open', '');
  if (isMobile) {
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
  } else await expect(solutions).toBeFocused();
  await solutions.click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Source products/suppliers' })
    .click();
  await expect(page).toHaveURL('/source');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Visit fewer suppliers.');
  if (isMobile) await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('open navigation passes accessibility checks and remains usable at narrow widths', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
  }
  await page.locator('summary').click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Plan a mission' })
    .click();
  await expect(page).toHaveURL('/plan');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What needs to happen?');
});

test('every public link resolves and assets stay on the site', async ({
  page,
  request,
  baseURL,
}) => {
  const links = new Set<string>();
  const external: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).origin !== new URL(baseURL!).origin) external.push(req.url());
  });
  for (const [route] of routes) {
    await page.goto(route);
    for (const href of await page
      .locator('a')
      .evaluateAll((elements) => elements.map((el) => el.getAttribute('href') ?? ''))) {
      if (href.startsWith('/')) links.add(href);
      else if (href.startsWith('mailto:')) expect(href).toBe('mailto:sadat@obsidianglobal.studio');
      else expect(href.startsWith('#')).toBe(true);
    }
  }
  for (const href of links) expect((await request.get(href)).status(), href).toBe(200);
  expect(external).toEqual([]);
});

test('trust distinguishes declarations, evidence, verification and observed outcomes', async ({
  page,
}) => {
  await page.goto('/trust');
  for (const label of [
    'Self-declared',
    'Evidence available',
    'Verified',
    'Derived',
    'Outcome observed',
  ]) {
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  }
  await expect(
    page.getByText('A repeated claim does not become a verified fact.', { exact: false }),
  ).toBeVisible();
});
