import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = [
  ['/', 'Find the right market.'],
  ['/sell', 'Make the trip commercially useful.'],
  ['/source', 'Visit fewer suppliers.'],
  ['/enter-market', 'without entering it blind.'],
  ['/trade-missions', 'a reason to be in the room.'],
  ['/how-it-works', 'One commercial objective.'],
  ['/network', 'local knowledge'],
  ['/institutions', 'Stop measuring trade missions by attendance.'],
  ['/trust', 'Know what is claimed.'],
  ['/about', 'Make market entry deliberate.'],
  ['/plan', 'What do you want to do?'],
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
    // No site-wide availability banner on any page. The request page keeps its own notice at the
    // point where details are entered (asserted below).
    await expect(page.getByRole('complementary', { name: 'Service availability' })).toHaveCount(0);
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

test('the menu opens, closes with Escape and the footer takes visitors to a way to work', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const menu = page.getByRole('button', { name: /^(Menu|Close menu)$/ });
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  if (isMobile) {
    await expect(nav).not.toBeVisible();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.getByRole('link', { name: 'How it works' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  } else {
    await expect(nav.getByRole('link', { name: 'Routes', exact: true })).toBeVisible();
  }
  // Every way to work stays one tap away in the footer of every page.
  const ways = page.getByRole('navigation', { name: 'Footer solutions' });
  for (const [name, href] of [
    ['Source products/suppliers', '/source'],
    ['Procure machinery', '/machinery'],
    ['Run a trade mission', '/trade-missions'],
    ['Plan a business trip', '/business-trips'],
    ['Sell in a new market', '/sell'],
    ['Enter a new market', '/enter-market'],
  ])
    await expect(ways.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  await ways.getByRole('link', { name: 'Source products/suppliers' }).click();
  await expect(page).toHaveURL('/source');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Visit fewer suppliers.');
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
    .getByRole('link', { name: 'Start a request' })
    .click();
  await expect(page).toHaveURL('/plan');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What do you want to do?');
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

test('/sell shows the Spain and EU route, the reverse direction and what is recorded', async ({
  page,
}) => {
  await page.goto('/sell');
  await expect(page.getByText('Bangladesh to Spain and the EU', { exact: true })).toBeVisible();
  const reverse = page.getByRole('region', { name: 'It also works the other way.' });
  await expect(reverse).toContainText(
    'Spanish or EU seller can reach suitable buyers in Bangladesh',
  );
  await expect(
    reverse.getByRole('link', { name: /Plan a mission from Spain or the EU/ }),
  ).toHaveAttribute('href', '/plan?companyCountry=ES&marketCode=BD&job=buyers');
  await expect(
    reverse.getByRole('link', { name: 'Read the Spain to Bangladesh scope' }),
  ).toHaveAttribute('href', '/corridors/bangladesh-spain');
  await expect(
    page.getByRole('region', { name: 'What we record for every introduction' }),
  ).toContainText('Who the buyer is and why they fit your offer.');
  await reverse.getByRole('link', { name: /Plan a mission from Spain or the EU/ }).click();
  await expect(page).toHaveURL('/plan?companyCountry=ES&marketCode=BD&job=buyers');
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
    'buyers',
  );
});

test('/enter-market and /trade-missions name their route and what is recorded', async ({
  page,
}) => {
  await page.goto('/enter-market');
  await expect(page.getByText('Spain and the EU to Bangladesh', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Read the Spain to Bangladesh scope' }),
  ).toHaveAttribute('href', '/corridors/bangladesh-spain');
  await expect(
    page.getByRole('region', { name: 'What we record for every market visit' }),
  ).toBeVisible();
  await page.goto('/trade-missions');
  await expect(page.getByText('Starting with Bangladesh to China', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read the China scope' })).toHaveAttribute(
    'href',
    '/corridors/bangladesh-china',
  );
  await expect(
    page.getByRole('region', { name: 'What we record for every delegation' }),
  ).toContainText('Contracts, invoices and collected cash, kept as separate outcomes.');
});
