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
// One route at a time: the route bar has no "All Routes" (board note: that view was for reviewers; Guardian 29).
const routeButtons = ['China Route', 'Sell Abroad', 'Delegation', 'Something Else'] as const;
const showRoute = (page: Page, name: (typeof routeButtons)[number]) =>
  bar(page).getByRole('button', { name, exact: true }).click();
const sectionIds = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('main section[id]')].map((s) => s.id));

test('every product section of the board is on the home, in board order', async ({ page }) => {
  await page.goto('/');
  const shared = ['how', 'brief', 'trust', 'who', 'faq', 'routes', 'final'];
  expect(await sectionIds(page)).toEqual(['hero', 'pick', ...shared]);
  for (const [name, id] of [
    ['China Route', 'route-china'],
    ['Sell Abroad', 'route-sell'],
    ['Delegation', 'route-delegation'],
    ['Something Else', 'route-other'],
  ] as const) {
    await showRoute(page, name);
    expect(await sectionIds(page)).toEqual(['hero', id, ...shared]);
  }
  await expect(bar(page).getByRole('button')).toHaveCount(4);
  await expect(page.getByRole('button', { name: /All Routes|Show Every Route/ })).toHaveCount(0);
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
  await expect(page.locator('#trust .ac1-example-tag', { hasText: 'Example' })).toBeVisible();
  for (const [name, id, headings] of [
    [
      'China Route',
      'route-china',
      [
        'Three suppliers quote for the same machine. Which one is cheapest?',
        'A factory-visit day, on two clocks.',
        'What "comparable" means here.',
      ],
    ],
    [
      'Sell Abroad',
      'route-sell',
      ['Who is worth meeting?', 'What would one unproductive fair cost you?'],
    ],
    ['Delegation', 'route-delegation', []],
  ] as const) {
    await showRoute(page, name);
    await expect(page.locator('main details.tr-fold')).toHaveCount(0);
    for (const heading of headings)
      await expect(page.getByRole('heading', { level: 3, name: heading })).toBeVisible();
    await expect(
      page.locator(`#${id} .ac1-example-tag`, { hasText: 'Example' }).first(),
    ).toBeVisible();
    if (id === 'route-china')
      await expect(page.locator('#route-china article .ac1-example-tag')).toHaveCount(3);
  }
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
    ['Key Asian Markets', 'Larchmere Retail Pte Ltd', 'USD', 'Key Asian Markets are several'],
  ] as const) {
    await market
      .getByRole('radio', { name, exact: true })
      .locator('xpath=following-sibling::label')
      .click();
    await expect(sell.getByText(company)).toBeVisible();
    await expect(sell.getByRole('radio', { name: currency, exact: true })).toBeChecked();
    await expect(sell.locator('.tr-market-line')).toContainText(line);
  }
  // Flags beside the names; the region has the neutral compass mark, never a flag.
  await expect(
    market
      .getByRole('radio', { name: 'Key Asian Markets' })
      .locator('xpath=following-sibling::label')
      .locator('.ux-region-mark'),
  ).toHaveCount(1);
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
  for (const name of routeButtons) {
    await showRoute(page, name);
    await expect(page.getByRole('link', { name: /Talk to/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /WhatsApp/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Talk to|WhatsApp|Send/ })).toHaveCount(0);
  }
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

test('the phone start bar holds one action and its reassurance line, after the hero, never over the page actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  // While it is off the bar is inert, so it is found by its class, not by its role.
  const quick = page.locator('.ux-start-bar');
  await expect(quick).not.toHaveAttribute('data-on', 'true');
  await page.locator('#how').scrollIntoViewIfNeeded();
  await expect(quick).toHaveAttribute('data-on', 'true');
  const group = page.getByRole('group', { name: 'Quick start' });
  await expect(group.getByRole('link')).toHaveCount(1);
  await expect(group.getByRole('link', { name: 'Start a Request' })).toHaveAttribute(
    'href',
    '/plan',
  );
  await expect(group).toContainText('No account needed. Stop any time.');
  // The page gains room at its foot while the bar shows, so the bar never covers content.
  await expect(page.locator('html')).toHaveAttribute('data-start-bar', 'on');
  await page.locator('#final').scrollIntoViewIfNeeded();
  await expect(quick).not.toHaveAttribute('data-on', 'true');
  // Hidden, the bar is inert: nothing in it can be reached.
  await expect(quick).toHaveAttribute('inert', '');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(quick).toBeHidden();
});

test('at 390 two primary actions are never on screen at once, whichever route is open', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  for (const name of routeButtons) {
    await showRoute(page, name);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 300) {
      await page.evaluate((top) => scrollTo(0, top), y);
      await page.waitForTimeout(60);
      const shown = await page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLElement>('.primary-link')].filter((el) => {
            if (el.closest('.ux-start-bar:not([data-on="true"])')) return false;
            const box = el.getBoundingClientRect();
            return box.bottom > 0 && box.top < innerHeight && box.height > 0;
          }).length,
      );
      const bar = await page.locator('.ux-start-bar').getAttribute('data-on');
      if (bar === 'true') expect(shown, `${name} at ${y}`).toBe(1);
    }
  }
});

test('the four doors are on the first screen: both big doors start at 390, all four whole at 1440', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (const name of ['Buying from China', 'Sell Abroad'])
    await expect(door(page, name)).toBeInViewport();
  await expect(page.locator('.tr-hint')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  for (const name of ['Buying from China', 'Sell Abroad', 'Leading a delegation', 'Something else'])
    await expect(door(page, name)).toBeInViewport({ ratio: 1 });
  // The hero reads brand line, headline, lead, doors, then the one action and its reassurances.
  const order = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '#hero .tr-brandline, #hero h1, #hero .tr-lead, #hero fieldset, #home-start',
      ),
    ].map((el) => el.tagName + (el.id ? '#' + el.id : '')),
  );
  expect(order).toEqual(['P', 'H1#home-title', 'P', 'FIELDSET', 'A#home-start']);
});

test('chosen states use the selected token and section titles use the section-title size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await showRoute(page, 'Sell Abroad');
  const selected = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--selected)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  const pressed = page.locator('.tr-bar-buttons button[aria-pressed="true"]');
  expect(await pressed.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(selected);
  const chip = page.getByRole('group', { name: 'Your market' }).locator('input:checked + label');
  expect(await chip.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(selected);
  const tab = page.getByRole('tab', { selected: true });
  expect(await tab.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(selected);
  expect(
    await h2(page, 'A fair list is not a buyer list.').evaluate(
      (el) => getComputedStyle(el).fontSize,
    ),
  ).toBe('24px');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await h2(page, 'A fair list is not a buyer list.').evaluate(
      (el) => getComputedStyle(el).fontSize,
    ),
  ).toBe('22px');
});

test('one action per view, and no repeated block, control text or wrong promise', async ({
  page,
}) => {
  await page.goto('/');
  const main = page.locator('main');
  const text = await main.innerText();
  // The full market list once in the hero lead and once in the routes block.
  expect(
    text.match(/the EU, the UK, the US, Australia and key Asian markets/g)?.length ?? 0,
  ).toBeLessThanOrEqual(2);
  expect(text).not.toContain('press Send');
  expect(text.match(/Nothing is sent until you check your request/g)?.length).toBe(2);
  await expect(page.locator('.tr-bar :not(.sr-only)', { hasText: 'Showing:' })).toHaveCount(0);
  await expect(page.locator('#pick').getByRole('button')).toHaveCount(0);
  await expect(
    page.locator('#final').getByRole('link', { name: /See the Full Process|Explore Every Route/ }),
  ).toHaveCount(0);
  // One link stays: Explore Every Route to /corridors (public-experience pins the routes page link on the home).
  await expect(page.locator('#routes').getByRole('link')).toHaveCount(1);
  await showRoute(page, 'China Route');
  await expect(page.locator('#route-china .primary-link')).toHaveCount(0);
  await showRoute(page, 'Sell Abroad');
  await expect(page.locator('#route-sell .primary-link')).toHaveCount(1);
  expect(await main.innerText()).not.toMatch(/↗/);
});

test('the calculator follows the market again once every amount is cleared', async ({ page }) => {
  await page.goto('/');
  await showRoute(page, 'Sell Abroad');
  const sell = page.locator('#route-sell');
  const market = (name: string) =>
    sell
      .getByRole('group', { name: 'Your market' })
      .getByRole('radio', { name, exact: true })
      .locator('xpath=following-sibling::label')
      .click();
  await sell.getByLabel(/Stand and registration/).fill('500');
  await market('UK');
  await expect(sell.getByRole('radio', { name: 'EUR', exact: true })).toBeChecked();
  await expect(sell.getByLabel(/Stand and registration/)).toHaveAccessibleName(/\(EUR\)/);
  await sell.getByLabel(/Stand and registration/).fill('');
  await expect(sell.getByRole('radio', { name: 'GBP', exact: true })).toBeChecked();
  await expect(sell.getByLabel(/Stand and registration/)).toHaveAccessibleName(/\(GBP\)/);
  await expect(sell.getByText('Set to GBP for the UK.', { exact: false })).toBeVisible();
  await market('Australia');
  await expect(sell.getByRole('radio', { name: 'AUD', exact: true })).toBeChecked();
});

test('the calculator says "Use digits only." for unreadable input and rounds lines and total the same way', async ({
  page,
}) => {
  await page.goto('/');
  await showRoute(page, 'Sell Abroad');
  const sell = page.locator('#route-sell');
  const field = sell.getByLabel('People going');
  await field.focus();
  await page.keyboard.type('2e');
  await expect(sell.getByText('Use digits only.')).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await field.press('Control+a');
  await field.press('Backspace');
  await field.press('Backspace');
  await expect(sell.getByText('Use digits only.')).toHaveCount(0);
  await sell.getByLabel(/Stand and registration/).fill('0.4');
  await expect(sell.locator('.tr-total')).toContainText('Add your numbers');
  await expect(sell.locator('.tr-breakdown')).toContainText('Not added');
  await sell.getByLabel(/Stand and registration/).fill('100.6');
  await sell.getByLabel(/Samples and shipping/).fill('100.6');
  // Each line rounds to 101, and the total is the sum of the lines shown.
  await expect(sell.locator('.tr-total')).toContainText('202');
  await sell.getByLabel('People going').fill('99999');
  await sell.getByLabel(/Flights per person/).fill('9999999');
  await sell.getByLabel('Days away, with travel').fill('99999');
  await sell.getByLabel(/Hotel per person per night/).fill('9999999');
  await expect(sell.getByText('That total looks too large. Check the numbers.')).toBeVisible();
});

test('a door preselects the brief goal and the person only until the visitor chose them', async ({
  page,
}) => {
  await page.goto('/');
  const brief = page.locator('#brief');
  await brief
    .getByRole('radio', { name: 'Buy machinery' })
    .locator('xpath=following-sibling::label')
    .click();
  const tabs = page.getByRole('tablist', { name: 'Who are you?' });
  await tabs.getByRole('tab', { name: 'Supplier' }).click();
  await door(page, 'Sell Abroad').click();
  await expect(brief.getByRole('radio', { name: 'Buy machinery' })).toBeChecked();
  await expect(tabs.getByRole('tab', { name: 'Supplier' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('a saved /plan draft is offered, continued with its notes, or started fresh with the note', async ({
  page,
}) => {
  await page.goto('/plan?job=sourcing');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect
    .poll(() => page.evaluate(() => Object.keys(sessionStorage).length))
    .toBeGreaterThan(0);
  await page.goto(`/plan?job=sourcing&note=${encodeURIComponent('From the home brief')}`);
  const choice = page.getByRole('group', { name: /You have a saved request/ });
  await expect(choice).toBeVisible();
  await choice.getByRole('button', { name: 'Continue saved request' }).click();
  const notes = () =>
    page.evaluate(() =>
      Object.values(sessionStorage)
        .map((value) => {
          try {
            return JSON.parse(value)?.draft?.notes as string | undefined;
          } catch {
            return undefined;
          }
        })
        .find((value) => value !== undefined),
    );
  expect(await notes()).toBe('');
  await page.goto(`/plan?job=sourcing&note=${encodeURIComponent('From the home brief')}`);
  await page
    .getByRole('group', { name: /You have a saved request/ })
    .getByRole('button', { name: 'Start a new request' })
    .click();
  await expect.poll(notes).toBe('From the home brief');
});

for (const width of [320, 390, 768, 1440])
  test(`at ${width} px nothing scrolls sideways and axe is clean with every route and the brief used, reduced motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page
      .locator('#brief')
      .getByRole('radio', { name: 'Find buyers abroad' })
      .locator('xpath=following-sibling::label')
      .click();
    await page.locator('#brief textarea').fill('A'.repeat(600));
    // Reduced motion: the bar does not slide.
    const transition = await page
      .locator('.ux-start-bar')
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transition.split(',').every((d) => parseFloat(d) < 0.01)).toBe(true);
    for (const name of routeButtons) {
      await showRoute(page, name);
      if (name === 'China Route') await page.getByRole('button', { name: 'B Is Cheapest' }).click();
      if (name === 'Sell Abroad') {
        await page.getByLabel(/Stand and registration/).fill('6000');
        await page
          .getByRole('radio', { name: /Show companies outside/ })
          .locator('xpath=following-sibling::label')
          .click();
      }
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(sideways, `${name} sideways`).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map((v) => `${name} ${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`),
      ).toEqual([]);
    }
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

test('the /plan note is capped at the notes field limit and kept as plain text, never markup', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  const markup = '<img src=x onerror="window.__noted=1"><b>bold</b>';
  const note = markup + 'x'.repeat(1200);
  await page.goto(`/plan?job=sourcing&note=${encodeURIComponent(note)}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  const saved = await page.evaluate(() =>
    Object.values(sessionStorage)
      .map((value) => {
        try {
          return JSON.parse(value)?.draft?.notes as string | undefined;
        } catch {
          return undefined;
        }
      })
      .find((value) => typeof value === 'string' && value.length > 0),
  );
  expect(saved).toBe(note.slice(0, 1000));
  expect(await page.evaluate(() => (window as { __noted?: number }).__noted)).toBeUndefined();
  await expect(page.locator('main b', { hasText: 'bold' })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('without a note the /plan draft is the same as before (no notes added)', async ({ page }) => {
  await page.goto('/plan?job=sourcing');
  await page.getByRole('button', { name: 'Continue' }).click();
  const notes = await page.evaluate(() =>
    Object.values(sessionStorage)
      .map((value) => {
        try {
          return JSON.parse(value)?.draft?.notes as string | undefined;
        } catch {
          return undefined;
        }
      })
      .filter((value) => value !== undefined),
  );
  expect(notes).toEqual(['']);
});
