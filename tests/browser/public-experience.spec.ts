import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = [
  ['/', 'Make market entry deliberate.'],
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
    // The home's radios only choose a route and send nothing (Two Routes, 17 Nov 2026). The board 3c brief (owner,
    // 18 Nov 2026) adds its three answers, which only build a link to /plan: still no form, and no field elsewhere.
    if (route === '/') {
      const doorRadios = 'fieldset.tr-doors input[type="radio"]';
      await expect(page.locator(doorRadios)).toHaveCount(4);
      await expect(page.locator('form')).toHaveCount(0);
      await expect(
        page.locator(`input:not(${doorRadios}):not(#brief input), textarea:not(#brief textarea)`),
      ).toHaveCount(0);
      await expect(page.locator('#brief input[type="radio"]')).toHaveCount(10);
      await expect(page.locator('#brief textarea')).toHaveCount(1);
    } else if (route !== '/plan')
      await expect(page.locator('input, textarea, form')).toHaveCount(0);
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

test('the home doors choose a route by pointer and keyboard, and the routes page stays linked', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const doors = page.getByRole('group', { name: 'Which way is your business moving?' });
  const china = doors.getByRole('radio', { name: /Buying from China/ });
  const sell = doors.getByRole('radio', { name: /Sell Abroad/ });
  await china.focus();
  await page.keyboard.press('Space');
  await expect(china).toBeChecked();
  await expect(page.locator('#home-start')).toHaveAttribute('href', '/plan?job=sourcing');
  await page.keyboard.press('ArrowRight');
  await expect(sell).toBeChecked();
  await expect(page.locator('#home-start')).toHaveAttribute('href', '/plan?job=buyers');
  await expect(
    page.getByRole('heading', { level: 2, name: 'A fair list is not a buyer list.' }),
  ).toBeVisible();
  // The home links to the routes page; the China and EU route links moved there with the route statuses (17 Nov 2026).
  await expect(page.locator('main a[href="/corridors"]').first()).toBeVisible();
  await page.goto('/corridors');
  // owner decision 17 Nov 2026, routes and markets: the EU destination opens the EU page, not the Spain page
  for (const href of ['/corridors/bangladesh-china', '/corridors/bangladesh-eu'])
    await expect(page.locator(`main a[href="${href}"]`).first()).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(writes).toEqual([]);
});

// On a phone the footer's link groups are disclosures (opening one is one tap); from 701 px every group is open.
const openFooterGroups = async (page: import('@playwright/test').Page) => {
  for (const summary of await page.locator('footer details.guide-footer-details > summary').all())
    if (
      (await summary.isVisible()) &&
      !(await summary.evaluate((node) => (node.parentElement as HTMLDetailsElement).open))
    )
      await summary.click();
};

test('the menu opens, closes with Escape and the footer takes visitors to a way to work', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const menu = page.getByRole('button', { name: /^(Menu|Close)$/ });
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
    // Navigation v1: the routes page is the header's Markets link.
    await expect(nav.getByRole('link', { name: 'Markets', exact: true })).toHaveAttribute(
      'href',
      '/corridors',
    );
    await expect(nav.getByRole('link', { name: 'Markets', exact: true })).toBeVisible();
  }
  // Every way to work stays in the footer of every page: open the group, then one tap.
  await openFooterGroups(page);
  const ways = page.getByRole('navigation', { name: 'Footer', exact: true });
  for (const [name, href] of [
    ['Source Products and Suppliers', '/source'],
    ['Procure Machinery', '/machinery'],
    ['Run a Trade Mission', '/trade-missions'],
    ['Plan a Business Trip', '/business-trips'],
    ['Sell in a New Market', '/sell'],
    ['Enter a New Market', '/enter-market'],
  ])
    await expect(ways.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  await ways.getByRole('link', { name: 'Source Products and Suppliers' }).click();
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
    .getByRole('link', { name: 'Start a Request' })
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

// owner decision 17 Nov 2026, routes and markets: the sell and enter pages name the EU, not Spain
test('/sell shows the EU route, the reverse direction and what is recorded', async ({ page }) => {
  await page.goto('/sell');
  await page.locator('details.guide-more > summary').click(); // the closing sections sit behind Show more
  await expect(
    page.locator('main').getByText('Bangladesh to the EU', { exact: true }),
  ).toBeVisible();
  const reverse = page.getByRole('region', { name: 'It also works the other way.' });
  await expect(reverse).toContainText('seller from the EU can reach suitable buyers in Bangladesh');
  await expect(reverse.getByRole('link', { name: /Plan a Mission From the EU/ })).toHaveAttribute(
    'href',
    '/plan?marketCode=BD&job=buyers',
  );
  await expect(
    reverse.getByRole('link', { name: 'Read the EU to Bangladesh scope' }),
  ).toHaveAttribute('href', '/corridors/bangladesh-eu');
  await expect(
    page.getByRole('region', { name: 'What we record for every introduction' }),
  ).toContainText('Who the buyer is and why they fit your offer.');
  await reverse.getByRole('link', { name: /Plan a Mission From the EU/ }).click();
  await expect(page).toHaveURL('/plan?marketCode=BD&job=buyers');
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
    'buyers',
  );
});

test('/enter-market and /trade-missions name their route and what is recorded', async ({
  page,
}) => {
  await page.goto('/enter-market');
  await page.locator('details.guide-more > summary').click(); // the closing sections sit behind Show more
  await expect(page.getByText('The EU to Bangladesh', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read the EU to Bangladesh scope' })).toHaveAttribute(
    'href',
    '/corridors/bangladesh-eu',
  );
  await expect(
    page.getByRole('region', { name: 'What we record for every market visit' }),
  ).toBeVisible();
  await page.goto('/trade-missions');
  await page.locator('details.guide-more > summary').click(); // the closing sections sit behind Show more
  // owner decision 17 Nov 2026, routes and markets (review F6): the route label no longer says "Starting with"
  await expect(
    page
      .getByRole('complementary', { name: 'Route for this page' })
      .getByText('Bangladesh to China', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read the China scope' })).toHaveAttribute(
    'href',
    '/corridors/bangladesh-china',
  );
  await expect(
    page.getByRole('region', { name: 'What we record for every delegation' }),
  ).toContainText('Contracts, invoices and collected cash, kept as separate outcomes.');
});
