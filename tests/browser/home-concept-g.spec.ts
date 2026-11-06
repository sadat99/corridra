import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// The home page, concept G (owner decision of 6 November 2026, docs/revamp/specs/public-home.md). Page length is
// the full document height over the viewport height: 2.0 to 2.5 screens at 1440 x 900 and at most 3.5 at 390 x
// 844 (owner). The Mission Player moves on every 4 seconds with a visible Pause, holds on hover and on keyboard
// focus, never moves on by itself under reduced motion, and announces only the steps a visitor chooses. The
// browser clock is installed where time matters, so no case waits in real time.
const sizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
const widths = [320, 390, 768, 1440];

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

const screens = async (page: Page) =>
  (await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  )) / (await page.evaluate(() => innerHeight));
const player = (page: Page) =>
  page.getByRole('article', { name: 'Example missions, not real companies' });
const currentStep = (page: Page) =>
  player(page)
    .getByRole('list', { name: 'How a mission works' })
    .locator('li[aria-current="step"]');
const announced = (page: Page) => player(page).locator('[aria-live="polite"]');

test('the home is 2.0 to 2.5 screens at 1440 x 900 and at most 3.5 at 390 x 844, for both examples', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const measured: string[] = [];
  for (const [name, size] of Object.entries(sizes)) {
    await page.setViewportSize(size);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    for (const example of ['Selling', 'Sourcing']) {
      await player(page).getByRole('tab', { name: example, exact: true }).click();
      const length = await screens(page);
      measured.push(`${name} ${example} ${length.toFixed(2)}`);
      if (name === 'desktop') {
        expect(length, `${name} ${example}`).toBeGreaterThanOrEqual(2.0);
        expect(length, `${name} ${example}`).toBeLessThanOrEqual(2.5);
      } else expect(length, `${name} ${example}`).toBeLessThanOrEqual(3.5);
    }
  }
  test.info().annotations.push({ type: 'page-length', description: measured.join(', ') });
});

test('the three job links are on the first screen at 390 and 1440', async ({ page }) => {
  for (const size of Object.values(sizes)) {
    await page.setViewportSize(size);
    await page.goto('/');
    const jobs = page.getByRole('navigation', { name: 'Choose your commercial objective' });
    for (const link of await jobs.getByRole('link').all()) {
      const box = (await link.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `${size.width}px`).toBeLessThanOrEqual(size.height);
    }
  }
});

for (const width of widths)
  test(`at ${width} px nothing scrolls sideways, every target in the page is 44 px and axe is clean`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const check = async (state: string) => {
      const found = await page.evaluate(() => {
        // Inline links inside running text are exempt from target size (WCAG 2.5.8), as in the UX gate.
        const inline = (el: Element) =>
          el.tagName === 'A' &&
          !!el.parentElement &&
          ['P', 'LI', 'DD', 'SPAN', 'SMALL'].includes(el.parentElement.tagName) &&
          (el.parentElement.textContent ?? '').trim().length >
            (el.textContent ?? '').trim().length + 1;
        const small = [...document.querySelectorAll('main :is(a[href], button, [role="tab"])')]
          .filter((el) => {
            const box = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && !inline(el);
          })
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width < 43.5 || box.height < 43.5;
          })
          .map((el) => `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 40)}`);
        return { sideways: document.documentElement.scrollWidth - innerWidth, small };
      });
      expect(found.sideways, `${state} sideways scroll`).toBeLessThanOrEqual(0);
      expect(found.small, `${state} small targets`).toEqual([]);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map((v) => `${state} ${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`),
      ).toEqual([]);
    };
    await check('Selling, Define');
    // The widest screen: the price quotes with their trust labels.
    await player(page).getByRole('tab', { name: 'Sourcing', exact: true }).click();
    await player(page).getByRole('button', { name: 'Next Step' }).click();
    await player(page).getByRole('button', { name: 'Next Step' }).click();
    await check('Sourcing, Compare');
  });

test('every job link opens its request with the contract name in its accessible name', async ({
  page,
}) => {
  await page.goto('/');
  const jobs = page.getByRole('navigation', { name: 'Choose your commercial objective' });
  await expect(jobs.getByRole('link')).toHaveCount(3);
  for (const [name, href] of [
    [
      'Sell my products Find buyers and partners abroad. Find Buyers & Partners',
      '/plan?job=buyers',
    ],
    [
      'Buy products or machines Find suppliers. Compare price quotes. Find Suppliers & Products',
      '/plan?job=sourcing',
    ],
    [
      'Lead a group trip Plan the programme and the meetings. Organise a Delegation',
      '/plan?job=delegations',
    ],
  ])
    await expect(jobs.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  await expect(
    page.getByRole('link', { name: 'Something else? Tell us your business goal' }),
  ).toHaveAttribute('href', '/plan');
  await expect(
    page.locator('main').getByRole('link', { name: 'Start a Request', exact: true }),
  ).toHaveAttribute('href', '/plan');
});

test('the route passes open both routes and every route', async ({ page }) => {
  await page.goto('/');
  const routes = page.getByRole('region', { name: 'Two routes to start.' });
  for (const [name, href] of [
    [/^Route 01 Bangladesh to China\..*Open Route$/, '/corridors/bangladesh-china'],
    [/^Route 02 Bangladesh to Spain\..*Open Route$/, '/corridors/bangladesh-spain'],
    [/^Another route\? .*Explore Every Route$/, '/corridors'],
  ] as const)
    await expect(routes.getByRole('link', { name })).toHaveAttribute('href', href);
  await routes.getByRole('link', { name: /Bangladesh to Spain/ }).click();
  await expect(page).toHaveURL('/corridors/bangladesh-spain');
});

test('the example switch changes the shortlist and the quote table, and every sample says it is an example', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const record = player(page);
  const next = record.getByRole('button', { name: 'Next Step' });
  await expect(record.locator('.ac1-example-tag')).toHaveText('Example');
  await expect(record.getByRole('tabpanel')).toContainText('Example mission. Not real companies.');
  await next.click();
  const buyers = record.getByRole('list', { name: 'Example buyer shortlist' });
  await expect(buyers.locator('li')).toHaveCount(4);
  await expect(buyers).toContainText('Distributor A, Madrid');
  await expect(record).toContainText('Not real companies');
  await next.click();
  const buyerTerms = record.getByRole('table', { name: 'Example buyer terms comparison' });
  await expect(buyerTerms.getByRole('row')).toHaveCount(5);
  await expect(buyerTerms.getByRole('columnheader')).toHaveText([
    'Term',
    'Distributor A',
    'Retail buyer B',
    'Importer C',
  ]);
  // The same step for sourcing: suppliers and their price quotes.
  await record.getByRole('tab', { name: 'Sourcing', exact: true }).click();
  await expect(record.getByRole('tabpanel')).toContainText('Example mission. Not real suppliers.');
  const quotes = record.getByRole('table', { name: 'Example price quote comparison' });
  await expect(quotes.getByRole('row')).toHaveCount(5);
  await expect(quotes.getByRole('columnheader')).toHaveText([
    'Term',
    'Supplier A',
    'Supplier B',
    'Supplier C',
  ]);
  await expect(quotes.getByRole('row').nth(1)).toContainText('USD 42,000');
  await expect(quotes.getByRole('cell').first()).toContainText('Evidence available');
  await expect(record.getByRole('table', { name: 'Example buyer terms comparison' })).toHaveCount(
    0,
  );
  await record.getByRole('button', { name: 'Previous Step' }).click();
  const suppliers = record.getByRole('list', { name: 'Example supplier shortlist' });
  await expect(suppliers.locator('li')).toHaveCount(4);
  await expect(suppliers).toContainText('Supplier A, Ningbo');
  await expect(record.getByRole('list', { name: 'Example buyer shortlist' })).toHaveCount(0);
});

test('the player works by keyboard: the example tabs, Previous and Next, and only chosen steps are announced', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const record = player(page);
  const selling = record.getByRole('tab', { name: 'Selling', exact: true });
  const sourcing = record.getByRole('tab', { name: 'Sourcing', exact: true });
  await selling.focus();
  await page.keyboard.press('ArrowRight');
  await expect(sourcing).toBeFocused();
  await expect(sourcing).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(selling).toBeFocused();
  await page.keyboard.press('End');
  await expect(sourcing).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(selling).toHaveAttribute('aria-selected', 'true');
  await expect(currentStep(page)).toContainText('Define');
  await expect(announced(page)).toHaveText('');
  const next = record.getByRole('button', { name: 'Next Step' });
  const previous = record.getByRole('button', { name: 'Previous Step' });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(currentStep(page)).toContainText('Find');
  await expect(announced(page)).toHaveText('Step 2 of 6, Find.');
  await expect(record).toContainText('Step 2 of 6, Find.');
  await page.keyboard.press('Space');
  await expect(currentStep(page)).toContainText('Compare');
  await previous.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // From the first step Previous goes round to the last.
  await expect(currentStep(page)).toContainText('Follow through');
  await expect(announced(page)).toHaveText('Step 6 of 6, Follow through.');
  // Every step keeps its description for assistive technology, not only the current one.
  const steps = record.getByRole('list', { name: 'How a mission works' }).locator('li');
  await expect(steps).toHaveCount(6);
  await expect(steps.nth(3)).toContainText(
    'We plan the introductions and meetings worth your time.',
  );
  await expect(
    record.getByRole('link', { name: 'See the Full Process', exact: true }),
  ).toHaveAttribute('href', '/how-it-works');
});

test('the player moves on every 4 seconds until it is paused, and does not announce its own moves', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  const record = player(page);
  await expect(currentStep(page)).toContainText('Define');
  await page.clock.runFor(4100);
  await expect(currentStep(page)).toContainText('Find');
  await expect(announced(page)).toHaveText('');
  await record.getByRole('button', { name: 'Pause Example' }).click();
  await expect(record.getByRole('button', { name: 'Play Example' })).toBeVisible();
  // Away from the player, so only Pause holds it.
  await page.mouse.move(0, 0);
  await page.clock.runFor(12_000);
  await expect(currentStep(page)).toContainText('Find');
  await record.getByRole('button', { name: 'Play Example' }).click();
  await page.mouse.move(0, 0);
  await page.clock.runFor(4100);
  await expect(currentStep(page)).toContainText('Compare');
});

test('the player holds while the pointer is over it and stops for good when keyboard focus enters it', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  const record = player(page);
  await record.getByRole('heading', { level: 2 }).hover();
  await page.clock.runFor(9000);
  await expect(currentStep(page)).toContainText('Define');
  await page.mouse.move(0, 0);
  await page.clock.runFor(4100);
  await expect(currentStep(page)).toContainText('Find');
  // Keyboard focus on the first control in the player stops it until the visitor presses Play.
  await page.getByRole('link', { name: 'Something else? Tell us your business goal' }).focus();
  for (let tab = 0; tab < 10; tab++) {
    await page.keyboard.press('Tab');
    if (await record.evaluate((node) => node.contains(document.activeElement))) break;
  }
  await expect(record.getByRole('button', { name: 'Play Example' })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.clock.runFor(12_000);
  await expect(currentStep(page)).toContainText('Find');
});

test('under reduced motion the player never moves on by itself and offers no Play control', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/');
  const record = player(page);
  await expect(currentStep(page)).toContainText('Define');
  await page.mouse.move(0, 0);
  await page.clock.runFor(20_000);
  await expect(currentStep(page)).toContainText('Define');
  await expect(record.getByRole('button', { name: /^(Pause|Play) Example$/ })).toHaveCount(0);
  // The steps are still all reachable by hand.
  await record.getByRole('button', { name: 'Next Step' }).click();
  await expect(currentStep(page)).toContainText('Find');
});
