import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';

// The home page, Two Routes (owner decision of 17 November 2026, design board "Corridra Two Routes", revision 3c;
// docs/revamp/specs/public-home.md). It replaces concept G of 6 November 2026 and its Mission Player. The visitor
// picks a door, that route opens below, and the first action everywhere is a real link to /plan. Every example is
// tagged Example and sends nothing, and nothing moves by itself, so there is no Pause to test.
const sizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
const widths = [320, 390, 768, 1440];

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

const bar = (page: Page) => page.getByRole('group', { name: 'Choose which route this page shows' });
// The doors are the hero's radio group (the brief below has its own "Something else" answer).
const door = (page: Page, name: string | RegExp) =>
  page
    .getByRole('group', { name: 'Which way is your business moving?' })
    .getByRole('radio', { name })
    .locator('xpath=following-sibling::label');
const choose = (radio: Locator) => radio.locator('xpath=following-sibling::label').click();
const start = (page: Page) => page.locator('#home-start');

test('the first screen says what Corridra is, offers the doors and the first action', async ({
  page,
}) => {
  for (const size of Object.values(sizes)) {
    await page.setViewportSize(size);
    await page.goto('/');
    const h1 = page.getByRole('heading', { level: 1, name: 'Make market entry deliberate.' });
    await expect(h1).toBeInViewport();
    await expect(
      page.getByRole('group', { name: 'Which way is your business moving?' }),
    ).toBeVisible();
    // The question that introduces the doors starts on the first screen everywhere; the cards themselves are on it from desktop.
    await expect(
      page.getByText('Which way is your business moving?', { exact: true }),
    ).toBeInViewport();
    if (size.width === 1440)
      for (const name of ['Buying from China', 'Sell Abroad'])
        await expect(door(page, name)).toBeInViewport();
    await expect(start(page)).toHaveAttribute('href', '/plan');
    if (size.width === 1440) await expect(start(page)).toBeInViewport();
  }
});

// The home page-length budget (3.0 screens at 1440 x 900, 4.25 at 390 x 844) no longer applies to the home. Owner,
// 18 November 2026, first hand to Guardian 29: "the page size limit is not applicable here". Every other page keeps
// its own budget; the page-length report (tests/ux/page-length.spec.ts) still measures the home.

// The worked examples are open under their own headings again, as on the board (owner, 18 November 2026); a test that
// used to open one now checks its heading is shown.
const openFold = (scope: Locator, name: string | RegExp) =>
  expect(scope.getByRole('heading', { level: 3, name })).toBeVisible();

for (const [label, route, cta, href, section] of [
  [
    'Buying from China',
    'china',
    'Plan My China Sourcing',
    '/plan?job=sourcing',
    'Too many suppliers. Too few you can compare.',
  ],
  [
    'Sell Abroad',
    'sell',
    'Plan My Buyer Meetings',
    '/plan?job=buyers',
    'A fair list is not a buyer list.',
  ],
  [
    'Leading a delegation',
    'delegation',
    'Plan My Programme',
    '/plan?job=delegations',
    'One programme. Many companies. Each one private.',
  ],
  [
    'Something else',
    'other',
    'Describe What I Need',
    '/plan',
    'Tell us what is coming up. We say plainly if we can help.',
  ],
] as const)
  test(`the ${route} door opens its route and points the first action at its request`, async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator(`#route-${route}`)).toHaveCount(0);
    await door(page, label).click();
    await expect(
      page
        .getByRole('group', { name: 'Which way is your business moving?' })
        .getByRole('radio', { name: label }),
    ).toBeChecked();
    await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
    await expect(start(page)).toHaveText(cta);
    await expect(start(page)).toHaveAttribute('href', href);
    await expect(page.getByText(`Opened below: ${label}.`)).toBeVisible();
    await expect(bar(page).getByRole('button', { pressed: true })).toHaveCount(1);
    // Every section ends in a real request link, never a dead control.
    await expect(
      page
        .locator(`#route-${route}`)
        .getByRole('link', { name: /Plan|Get My|Scope|Describe/ })
        .first(),
    ).toHaveAttribute('href', /\/plan/);
    await start(page).click();
    await expect(page).toHaveURL(href);
  });

test('the route bar switches routes and All Routes opens China, Sell Abroad and Delegation', async ({
  page,
}) => {
  await page.goto('/');
  await bar(page).getByRole('button', { name: 'All Routes' }).click();
  for (const id of ['china', 'sell', 'delegation'])
    await expect(page.locator(`#route-${id}`)).toBeVisible();
  await expect(page.locator('#route-other')).toHaveCount(0);
  await bar(page).getByRole('button', { name: 'Sell Abroad', exact: true }).click();
  await expect(page.locator('#route-china')).toHaveCount(0);
  await expect(page.locator('#route-sell')).toBeVisible();
});

test('the how-it-works strip opens a route, moves to it and focuses its heading', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Open the China Route/ }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Too many suppliers. Too few you can compare.' }),
  ).toBeFocused();
  await expect(page.locator('#pick')).toHaveCount(0);
});

test('the quote check names what each price leaves out, tags every quote Example and sends nothing', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/');
  await door(page, 'Buying from China').click();
  const china = page.locator('#route-china');
  await openFold(china, 'Three suppliers quote');
  await expect(china.locator('.ac1-example-tag', { hasText: 'Example' }).first()).toBeVisible();
  await expect(china.getByRole('article')).toHaveCount(3);
  await expect(china.getByText('Not stated', { exact: true }).first()).toBeVisible();
  await china.getByRole('button', { name: 'B Is Cheapest' }).click();
  await expect(china.getByText('You picked B, USD 38,500, the lowest number.')).toBeVisible();
  await expect(china.getByText('3 costs not stated')).toBeVisible();
  await expect(china.getByRole('button', { name: 'B Is Cheapest' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(china.getByRole('link', { name: 'Get My Offers Compared' })).toHaveAttribute(
    'href',
    '/plan?job=sourcing',
  );
  await china.getByRole('button', { name: 'I Cannot Tell Yet' }).click();
  await expect(china.getByText('Right answer. Nobody can tell yet.')).toBeVisible();
  await china.getByRole('button', { name: 'Start Over' }).click();
  await expect(china.getByText('Right answer. Nobody can tell yet.')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('the visit day shows both clocks, Dhaka two hours behind Guangzhou', async ({ page }) => {
  await page.goto('/');
  await door(page, 'Buying from China').click();
  await openFold(page.locator('#route-china'), 'A factory-visit day');
  const stops = page.getByRole('list', { name: 'Stops in the visit day' });
  await expect(stops.getByRole('button')).toHaveCount(6);
  for (const [stop, gz, dh] of [
    ['16:30', '16:30', '14:30'],
    ['08:00', '08:00', '06:00'],
    ['20:00', '20:00', '18:00'],
  ] as const) {
    await stops.getByRole('button', { name: new RegExp(stop) }).click();
    await expect(
      page.getByRole('img', { name: `Guangzhou, China clock showing ${gz}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('img', { name: `Dhaka, Bangladesh clock showing ${dh}` }),
    ).toBeVisible();
    await expect(page.getByText(`${gz} in Guangzhou, ${dh} in Dhaka:`)).toBeVisible();
  }
});

test('Sell Abroad follows the market, steps from 8 names to 5 worth meeting and keeps every company an example', async ({
  page,
}) => {
  await page.goto('/');
  await door(page, 'Sell Abroad').click();
  const sell = page.locator('#route-sell');
  await openFold(sell, 'Who is worth meeting?');
  const rows = sell
    .getByRole('region', { name: 'Example companies: fair list compared with a qualified list' })
    .locator('tbody tr');
  await expect(rows).toHaveCount(8);
  await expect(sell.getByText('Not checked yet')).toHaveCount(8);
  await choose(sell.getByRole('radio', { name: /Checked against your brief/ }));
  await expect(sell.getByText('Worth meeting', { exact: true })).toHaveCount(2);
  await expect(sell.getByText('Not a fit', { exact: true })).toHaveCount(6);
  await choose(sell.getByRole('radio', { name: /Show companies outside/ }));
  await expect(rows).toHaveCount(11);
  await expect(sell.getByText('Not on the fair list', { exact: true })).toHaveCount(3);
  await choose(sell.getByRole('radio', { name: 'UK' }));
  await expect(sell.getByText('Hallow and Finch Retail Ltd')).toBeVisible();
  await expect(sell.getByText('The UK is read as a market of its own.')).toBeVisible();
  await choose(sell.getByRole('radio', { name: 'Key Asian markets' }));
  await expect(sell.getByText('Larchmere Retail Pte Ltd')).toBeVisible();
  await expect(sell.getByText('All company names are invented', { exact: false })).toBeVisible();
});

test('the fair calculator adds the numbers on the page, never converts and keeps typed amounts in their currency', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/');
  await door(page, 'Sell Abroad').click();
  const sell = page.locator('#route-sell');
  await openFold(sell, 'Who is worth meeting?');
  await openFold(sell, 'What would one unproductive fair cost you?');
  await expect(sell.getByRole('radio', { name: 'EUR' })).toBeChecked();
  await sell.getByLabel('People going').fill('2');
  await sell.getByLabel('Days away, with travel').fill('5');
  await sell.getByLabel(/Stand and registration/).fill('6000');
  await sell.getByLabel(/Flights per person/).fill('800');
  await sell.getByLabel(/Hotel per person per night/).fill('120');
  await sell.getByLabel(/Samples and shipping/).fill('400');
  await sell.getByLabel('Useful buyer meetings you expect').fill('4');
  // 6000 + 2*800 + 2*5*120 + 400 = 9200; per meeting 2300; half of 4 is 2, so 4600.
  await expect(sell.locator('.tr-total')).toContainText('EUR 9,200');
  await expect(sell.getByText('EUR 2,300').first()).toBeVisible();
  await expect(sell.getByText('each costs EUR 4,600', { exact: false })).toBeVisible();
  // Changing the market does not change typed amounts' currency.
  await choose(sell.getByRole('radio', { name: 'UK' }));
  await expect(sell.locator('.tr-total')).toContainText('EUR 9,200');
  await expect(
    sell.getByText('Kept in EUR because you have typed amounts.', { exact: false }),
  ).toBeVisible();
  await sell.getByLabel('People going').fill('1.5');
  await expect(sell.getByText('Use a whole number.')).toBeVisible();
  await expect(sell.getByLabel('People going')).toHaveAttribute('aria-invalid', 'true');
  await expect(sell.getByRole('link', { name: 'Scope a Mission for This Fair' })).toHaveAttribute(
    'href',
    '/plan?job=buyers',
  );
  expect(writes).toEqual([]);
});

test('the delegation example shows private rows, a programme total and what the organiser does not see', async ({
  page,
}) => {
  await page.goto('/');
  await door(page, 'Leading a delegation').click();
  const del = page.locator('#route-delegation');
  await expect(
    del.getByRole('region', { name: 'Example programme view for an organiser' }),
  ).toBeVisible();
  await expect(del.getByRole('row')).toHaveCount(5);
  await expect(
    del.getByText('Programme total: 4 companies, 3 met at least one counterpart'),
  ).toBeVisible();
  await expect(del.getByText('The organiser does not see')).toBeVisible();
  await expect(del.locator('.ac1-example-tag')).toHaveText('Example');
});

test('the eight people (now on /how-it-works) work by keyboard as one tab group', async ({
  page,
}) => {
  await page.goto('/how-it-works');
  await page.locator('details.guide-more > summary').click();
  const tabs = page.getByRole('tablist', { name: 'Who are you?' });
  await expect(tabs.getByRole('tab')).toHaveCount(8);
  await tabs.getByRole('tab', { name: 'Exporter' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Importer' })).toBeFocused();
  await expect(tabs.getByRole('tab', { name: 'Importer' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab', { name: 'Local contributor' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#who-panel')).toContainText('Your skills. Your time. Your location.');
  await page.keyboard.press('Home');
  await expect(tabs.getByRole('tab', { name: 'Exporter' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

const openAll = (page: Page) =>
  page.evaluate(() => document.querySelectorAll('details').forEach((fold) => (fold.open = true)));

test('the long sections moved off the home keep their words, behind Show More on /how-it-works and /trust', async ({
  page,
}) => {
  await page.goto('/trust');
  await openAll(page);
  const trust = page.locator('#trust');
  for (const label of [
    'Self-declared',
    'Evidence available',
    'Verified',
    'Derived',
    'Outcome observed',
  ])
    await expect(trust.locator('.tr-five').getByText(label, { exact: true })).toBeVisible();
  await expect(trust.getByText('History: what happened stays what happened')).toBeVisible();
  await page.goto('/how-it-works');
  await openAll(page);
  await expect(page.locator('#faq details')).toHaveCount(8);
  await expect(page.getByRole('list', { name: 'Mission steps' }).locator('li')).toHaveCount(14);
  await expect(page.locator('#start').getByRole('link')).toHaveCount(6);
  await expect(page.locator('.tr-nevers > div')).toHaveCount(4);
  await expect(page.locator('.tr-nots > div')).toHaveCount(8);
  await expect(page.locator('#routes .tr-routes > div')).toHaveCount(4);
  for (const [href, name] of [
    ['/how-it-works', 'See the Full Process'],
    ['/trust', 'How We Label Facts'],
    ['/corridors', 'Explore Every Route'],
  ] as const) {
    await page.goto('/');
    await expect(page.locator('#final').getByRole('link', { name })).toHaveAttribute('href', href);
  }
});

test('the three job links keep their names and links (P-07) and Something else goes to /plan', async ({
  page,
}) => {
  await page.goto('/');
  const jobs = page.getByRole('navigation', { name: 'Choose your commercial objective' });
  await expect(jobs.getByRole('link')).toHaveCount(3);
  for (const [name, href] of [
    [
      'Buy products or machines Find suppliers. Compare price quotes. Bangladesh to China Find Suppliers & Products',
      '/plan?job=sourcing',
    ],
    [
      'Lead a group trip Plan the programme and the meetings. Delegations and trade missions Organise a Delegation',
      '/plan?job=delegations',
    ],
    [
      'Sell my products Find buyers and partners abroad. Bangladesh to the EU, the UK, the US, Australia and key Asian markets Find Buyers & Partners',
      '/plan?job=buyers',
    ],
  ] as const)
    await expect(jobs.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  await expect(
    page.getByRole('link', { name: 'Something else? Tell us your business goal' }),
  ).toHaveAttribute('href', '/plan');
});

test('the page names the open markets and never limits itself to Spain or the EU', async ({
  page,
}) => {
  await page.goto('/');
  const text = (await page.locator('main').innerText()).toLowerCase();
  for (const word of ['the eu', 'uk', 'us', 'australia', 'key asian markets'])
    expect(text).toContain(word);
  await bar(page).getByRole('button', { name: 'All Routes' }).click();
  expect(await page.locator('main').innerText()).not.toMatch(/—/);
});

for (const width of widths)
  test(`at ${width} px nothing scrolls sideways, every target is 44 px and axe is clean`, async ({
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
        const small = [
          ...document.querySelectorAll(
            'main :is(a[href], button, [role="tab"], input:not(.sr-only))',
          ),
        ]
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
    await check('first visit');
    await bar(page).getByRole('button', { name: 'All Routes' }).click();
    await page.evaluate(() =>
      document.querySelectorAll('details').forEach((fold) => (fold.open = true)),
    );
    await page.getByRole('button', { name: 'B Is Cheapest' }).click();
    await page.getByLabel('People going').fill('2');
    await page.getByLabel(/Stand and registration/).fill('6000');
    await choose(page.getByRole('radio', { name: /Show companies outside/ }));
    await check('every route open, every example open and used');
  });

// Owner goal: "get a visitor to start a request". The action is on the first screen of a phone, 320 and 390 wide.
for (const size of [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
])
  test(`Start a Request is on the first screen at ${size.width} px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(start(page)).toBeInViewport({ ratio: 1 });
    await expect(start(page)).toHaveAttribute('href', '/plan');
  });
