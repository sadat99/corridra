import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// LP3: the home page as the owner's design board "Corridra Two Routes", revision 3c, in full. Owner, 18 November
// 2026, first hand to Guardian 29: "why didnt we implement https://claude.ai/artifact/END7KDT2Y3KhZZoYb8pExX with all
// the provided feedbacks and updates here? the page size limit is not applicable here. what is already done doesnt
// reflect this 100% corrcetly, only footer was said to remain as it is." Board: docs/revamp/evidence/owner-2026-11-18/
// two-routes-board-3c.html. Every case here fails on 97e1118, where the shared sections were off the home, the worked
// examples were closed, the headline never changed and the brief did not exist.

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

// The doors are the hero's radio group (the brief below has its own "Something else" answer).
const door = (page: Page, name: string | RegExp) =>
  page
    .getByRole('group', { name: 'Which way is your business moving?' })
    .getByRole('radio', { name })
    .locator('xpath=following-sibling::label');
const bar = (page: Page) => page.getByRole('group', { name: 'Choose which route this page shows' });
const h2 = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });

test('every product section of the board is on the home, in board order', async ({ page }) => {
  await page.goto('/');
  await bar(page).getByRole('button', { name: 'All Routes' }).click();
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('main section[id]')].map((s) => s.id),
  );
  expect(order).toEqual([
    'hero',
    'route-china',
    'route-sell',
    'route-delegation',
    'how',
    'brief',
    'trust',
    'who',
    'faq',
    'routes',
    'final',
  ]);
  await page.goto('/');
  await expect(page.locator('#pick')).toBeVisible();
  for (const title of [
    'Choose a door. This page opens that route.',
    'One mission, from first intent to repeat business.',
    'Your first mission brief in 60 seconds.',
    'Every fact says how it is known.',
    'Eight people. One clear promise each.',
    'Questions people ask before they start.',
    'Open routes now. Plain answers on the rest.',
  ])
    await expect(h2(page, title)).toBeVisible();
  // The FAQ keeps the board's questions, including markets and chambers.
  const faq = page.locator('#faq');
  await expect(faq.locator('details')).toHaveCount(8);
  for (const q of ['Which markets do you work in?', 'Do you work with chambers and trade bodies?'])
    await expect(faq.getByText(q, { exact: true })).toBeVisible();
  // Routes: three tiers and the readiness principles.
  const routes = page.locator('#routes');
  for (const tier of ['Open now', 'Selective', 'Ask us'])
    await expect(routes.getByText(tier, { exact: true }).first()).toBeVisible();
  await expect(routes.locator('.tr-ready-chip')).toHaveCount(6);
});

test('a door changes the headline to its proposition, preselects the person, the brief goal and the close', async ({
  page,
}) => {
  await page.goto('/');
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toHaveText('Make market entry deliberate.');
  await expect(page.locator('.tr-brandline')).toHaveText('Cross-border market access');
  for (const [label, headline, person, goal, close] of [
    [
      'Buying from China',
      'Go to China knowing which suppliers deserve your time.',
      'Importer',
      'Buy from China',
      'The sourcing trip is coming either way. Arrive knowing which suppliers matter.',
    ],
    [
      'Sell Abroad',
      'Know who is worth meeting before you travel.',
      'Exporter',
      'Find buyers abroad',
      'The fair is coming either way. Arrive knowing who is worth meeting.',
    ],
    [
      'Leading a delegation',
      'Give every company in your delegation its own plan.',
      'Delegation leader',
      'Run a delegation',
      'The programme is coming either way. Give each company its own plan.',
    ],
  ] as const) {
    await door(page, label).click();
    await expect(title).toHaveText(headline);
    // The brand line stays visible once the headline becomes the route's proposition.
    await expect(page.locator('.tr-brandline')).toHaveText('Make market entry deliberate.');
    await expect(
      page.getByRole('tablist', { name: 'Who are you?' }).getByRole('tab', { name: person }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#brief').getByRole('radio', { name: goal })).toBeChecked();
    await expect(h2(page, close)).toBeVisible();
  }
  await door(page, 'Something else').click();
  await expect(title).toHaveText('Tell us what is coming up. We say plainly if we can help.');
  await expect(page.locator('#routes .is-mine')).toContainText('Any other route');
});

test('the route state is told to screen readers, not as "Showing:" text on screen (LP2)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.tr-bar-label')).toHaveCount(0);
  const live = page.locator('.tr-bar .sr-only');
  await expect(live).toHaveText(/Showing: shared sections/);
  await bar(page).getByRole('button', { name: 'Sell Abroad', exact: true }).click();
  await expect(live).toHaveText('Showing: Sell Abroad');
  await expect(bar(page).getByRole('button', { name: 'Sell Abroad', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('the worked examples are open on the page, and every example is tagged Example', async ({
  page,
}) => {
  await page.goto('/');
  await bar(page).getByRole('button', { name: 'All Routes' }).click();
  await expect(page.locator('main details.tr-fold')).toHaveCount(0);
  for (const name of [
    'Three suppliers quote for the same machine. Which one is cheapest?',
    'A factory-visit day, on two clocks.',
    'What "comparable" means here.',
    'Who is worth meeting?',
    'What would one unproductive fair cost you?',
  ])
    await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
  for (const id of ['route-china', 'route-sell', 'route-delegation', 'trust'])
    await expect(
      page.locator(`#${id} .ac1-example-tag`, { hasText: 'Example' }).first(),
    ).toBeVisible();
  await expect(page.locator('#route-china article .ac1-example-tag')).toHaveCount(3);
});

test('the quote check reveals what each price leaves out, and I Cannot Tell Yet is the right answer', async ({
  page,
}) => {
  await page.goto('/');
  await door(page, 'Buying from China').click();
  const china = page.locator('#route-china');
  await expect(china.locator('.tr-reveal')).toHaveCount(0);
  await china.getByRole('button', { name: 'A Is Cheapest' }).click();
  await expect(china.locator('.tr-reveal')).toHaveCount(3);
  await expect(china.getByText('You picked A, USD 42,000.')).toBeVisible();
  await china.getByRole('button', { name: 'I Cannot Tell Yet' }).click();
  await expect(china.getByRole('button', { name: 'I Cannot Tell Yet' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(china.getByText('Right answer. Nobody can tell yet.')).toBeVisible();
});

test('the market selector switches the shortlist, the calculator currency and one sentence', async ({
  page,
}) => {
  await page.goto('/');
  await door(page, 'Sell Abroad').click();
  const sell = page.locator('#route-sell');
  const market = sell.getByRole('group', { name: 'Your market' });
  for (const [name, company, currency, line] of [
    ['EU', 'Moda Brezo SA', 'EUR', 'The EU is a bloc, not a country.'],
    ['UK', 'Hallow and Finch Retail Ltd', 'GBP', 'The UK is read as a market of its own.'],
    ['US', 'Westbrine Apparel Inc', 'USD', 'The US is a big country to cover in one trip.'],
    ['Australia', 'Kestrel Bay Retail Pty Ltd', 'AUD', 'From Dhaka, Australia is a long trip.'],
    ['Key Asian Markets', 'Larchmere Retail Pte Ltd', 'USD', 'Key Asian markets are several'],
  ] as const) {
    await market
      .getByRole('radio', { name, exact: true })
      .locator('xpath=following-sibling::label')
      .click();
    await expect(sell.getByText(company)).toBeVisible();
    await expect(sell.getByRole('radio', { name: currency, exact: true })).toBeChecked();
    await expect(sell.locator('.tr-market-line')).toContainText(line);
  }
  // Flags beside the names, never for the region.
  await expect(market.locator('img[data-flag]')).toHaveCount(4);
  await expect(
    market
      .getByRole('radio', { name: 'Key Asian Markets' })
      .locator('xpath=following-sibling::label')
      .locator('img'),
  ).toHaveCount(0);
});

test('the calculator uses one currency, converts nothing and says what is wrong with an input', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/');
  await door(page, 'Sell Abroad').click();
  const sell = page.locator('#route-sell');
  await sell
    .getByRole('radio', { name: 'BDT', exact: true })
    .locator('xpath=following-sibling::label')
    .click();
  await sell.getByLabel(/Stand and registration/).fill('100000');
  await expect(sell.locator('.tr-total')).toContainText('BDT 100,000');
  await expect(sell.getByText('Every amount is read as BDT. Nothing is converted.')).toBeVisible();
  for (const [value, message] of [
    ['-3', 'Use 0 or more.'],
    ['2.5', 'Use a whole number.'],
    ['100000000000', 'That looks too large. Check the number.'],
  ] as const) {
    await sell.getByLabel('Useful buyer meetings you expect').fill(value);
    await expect(sell.getByText(message)).toBeVisible();
    await expect(sell.getByLabel('Useful buyer meetings you expect')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(
      sell.getByText('Left out until fixed: Useful buyer meetings you expect.'),
    ).toBeVisible();
  }
  expect(writes).toEqual([]);
});

test('the brief builds a draft the visitor owns and opens /plan with the job and their words', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/');
  const brief = page.locator('#brief');
  await expect(brief.getByText('Draft, not sent')).toBeVisible();
  await expect(brief.getByText('0 of 3 answered')).toBeVisible();
  await expect(brief.getByRole('button', { name: /Send/ })).toHaveCount(0);
  await brief
    .getByRole('radio', { name: 'Buy machinery' })
    .locator('xpath=following-sibling::label')
    .click();
  await brief
    .getByRole('textbox', { name: 'What do you need?' })
    .fill('Two dyeing machines, installed.');
  await brief
    .getByRole('radio', { name: 'In 1 to 3 months' })
    .locator('xpath=following-sibling::label')
    .click();
  await expect(brief.getByText('3 of 3 answered')).toBeVisible();
  const card = brief.getByRole('group', { name: 'Mission brief' });
  await expect(card).toContainText('Buy machinery and compare offers like for like');
  await expect(card).toContainText('Bangladesh to China');
  await expect(card).toContainText('Two dyeing machines, installed.');
  await expect(card).toContainText('In 1 to 3 months');
  const start = brief.getByRole('link', { name: 'Start a Request' });
  const href = (await start.getAttribute('href')) ?? '';
  const url = new URL(href, 'http://x');
  expect(url.pathname).toBe('/plan');
  expect(url.searchParams.get('job')).toBe('machinery_procurement');
  expect(url.searchParams.get('note')).toBe(
    'Route: Bangladesh to China\nWhat I need: Two dyeing machines, installed.\nTiming: In 1 to 3 months',
  );
  expect(writes).toEqual([]);
  await start.click();
  await expect(page).toHaveURL(/\/plan\?job=machinery_procurement&note=/);
  // The words are in the request form's draft (its notes field, on a later step); Continue saves the draft, sends nothing.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect
    .poll(() => page.evaluate(() => Object.values(sessionStorage).join('\n')))
    .toContain('What I need: Two dyeing machines, installed.');
  expect(writes).toEqual([]);
});

test('with no support number set, no Talk or WhatsApp control is drawn (never a dead button)', async ({
  page,
}) => {
  await page.goto('/');
  await bar(page).getByRole('button', { name: 'All Routes' }).click();
  await expect(page.getByRole('link', { name: /Talk to/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /WhatsApp/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Talk to|WhatsApp|Send/ })).toHaveCount(0);
});

test('trust shows five labels and a correction as a new entry; the people work by arrow keys', async ({
  page,
}) => {
  await page.goto('/');
  const trust = page.locator('#trust');
  await expect(trust.locator('.tr-five li')).toHaveCount(5);
  await expect(trust.getByText('New entry', { exact: true })).toBeVisible();
  await expect(trust.getByRole('link', { name: 'How We Label Facts' })).toHaveAttribute(
    'href',
    '/trust',
  );
  const tabs = page.getByRole('tablist', { name: 'Who are you?' });
  await expect(tabs.getByRole('tab')).toHaveCount(8);
  await tabs.getByRole('tab', { name: 'Exporter' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Importer' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab', { name: 'Local contributor' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('flags sit beside country names with no accessible name of their own', async ({ page }) => {
  await page.goto('/');
  const flags = page.locator('main img[data-flag]');
  expect(await flags.count()).toBeGreaterThan(5);
  for (const flag of await flags.all()) {
    await expect(flag).toHaveAttribute('alt', '');
    await expect(flag).toHaveAttribute('aria-hidden', 'true');
  }
  await expect(door(page, 'Sell Abroad')).toContainText('Key Asian Markets');
  // LP2: the Sell Abroad door names its markets once.
  const words = (await door(page, 'Sell Abroad').innerText()).match(/Australia/g) ?? [];
  expect(words).toHaveLength(1);
});

test('the phone quick-start bar appears after the hero and hides at the page actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  // While it is off the bar is inert, so it is found by its class, not by its role.
  const quick = page.locator('.tr-mbar');
  await expect(quick).not.toHaveAttribute('data-on', 'true');
  await page.locator('#how').scrollIntoViewIfNeeded();
  await expect(quick).toHaveAttribute('data-on', 'true');
  await expect(
    page.getByRole('group', { name: 'Quick start' }).getByRole('link', { name: 'Start a Request' }),
  ).toHaveAttribute('href', '/plan');
  await page.locator('#final').scrollIntoViewIfNeeded();
  await expect(quick).not.toHaveAttribute('data-on', 'true');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(quick).toBeHidden();
});

test('the header is the navy bar with every destination and the language control', async ({
  page,
}) => {
  await page.goto('/');
  const header = page.locator('header.public-header');
  const bg = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
  // Navy (--brand-deep, 20 36 56) at 96 percent, written in whichever colour syntax the browser reports.
  expect(bg).toMatch(/^rgba?\(20, 36, 56|^color\(srgb 0\.078\d* 0\.141\d* 0\.219/);
  expect(await header.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const [name, href] of [
    ['How It Works', '/how-it-works'],
    ['Markets', '/corridors'],
    ['Trust', '/trust'],
    ['Sign In', '/signin'],
  ] as const)
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  await expect(nav.getByRole('link', { name: /^Start a Request/ })).toHaveAttribute(
    'href',
    '/plan',
  );
});

for (const width of [320, 390, 768, 1440])
  test(`at ${width} px nothing scrolls sideways and axe is clean with every route and the brief used, reduced motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await bar(page).getByRole('button', { name: 'All Routes' }).click();
    await page
      .locator('#brief')
      .getByRole('radio', { name: 'Find buyers abroad' })
      .locator('xpath=following-sibling::label')
      .click();
    await page.locator('#brief textarea').fill('A'.repeat(600));
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(sideways).toBeLessThanOrEqual(0);
    // Reduced motion: the bar does not slide.
    const transition = await page
      .locator('.tr-mbar')
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transition.split(',').every((d) => parseFloat(d) < 0.01)).toBe(true);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });

test('Arabic, right to left, at 320 px: nothing scrolls sideways and the doors still work', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('corridra.language', 'ar'));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.querySelector('main')?.setAttribute('dir', 'rtl');
  });
  await door(page, 'Sell Abroad').click();
  await expect(page.locator('#route-sell')).toBeVisible();
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(sideways).toBeLessThanOrEqual(0);
});
