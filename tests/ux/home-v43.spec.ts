import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mountHomeV43 } from './home-v43-fixture';

// Home page v4.3 with CORRIDRA_UX_HOME_V43 exactly "true" (owner, 26 Nov 2026, via the Guardian: "update as per
// attachment 100% correctly"; docs/revamp/specs/ui-ux-v4-3.md). The real HomeV43 and the real trimmed SiteFooterView on
// the live home's styles (tests/ux/home-v43-fixture.ts), so CI keeps one build with the switch off. What the layout
// decides (server HTML, the stylesheet link, the header props, next/image) is read on a real switch-on build in
// tests/ux/home-v43-server.spec.ts.
const widths = [320, 390, 506, 768, 1024, 1440] as const;

const lead =
  'Source products or machinery from China, meet buyers abroad, or organise a business delegation. Corridra helps you check who fits, set up the right meetings and follow through.';

const choice = (page: Page) => page.locator('#home-route-group');
const door = (page: Page, route: 'china' | 'sell' | 'delegation' | 'other') =>
  choice(page).locator(`input[value="${route}"]`);
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** The visible units of a route sentence: each flag with its name, and the words between them. */
const units = (line: Locator) =>
  line.evaluate((el) =>
    [
      ...el.querySelectorAll(':scope .ux-flagged, :scope .hv42-line-head > span:not(.ux-flagged)'),
    ].map((u) => {
      const box = u.getBoundingClientRect();
      const flag = u.querySelector('img[data-flag]');
      return {
        text: (u as HTMLElement).innerText.trim(),
        flag: flag?.getAttribute('src') ?? null,
        flagWidth: flag ? Math.round(flag.getBoundingClientRect().width) : 0,
        top: Math.round(box.top),
      };
    }),
  );
/** Every live region of the page's main: a door choice must leave exactly one. */
const liveRegions = (page: Page) =>
  page.locator('main [aria-live], main [role="status"], main [role="alert"]');
const small = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'by', 'at']);
const isTitleCase = (label: string) =>
  label
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .every((word, index) => {
      const letters = word.replace(/^[^A-Za-z]+/, '');
      if (!letters || !/^[A-Za-z]/.test(letters)) return true;
      if (index > 0 && small.has(letters.toLowerCase())) return true;
      return /^[A-Z]/.test(letters) || /^[a-z]*[A-Z]/.test(letters);
    });

for (const width of widths) {
  test(`at ${width}px: hero, photo, the four doors, one Start a Request, no sideways scroll, axe clean`, async ({
    page,
  }) => {
    await mountHomeV43(page, { width });
    expect(await overflow(page), 'no sideways scroll').toBe(0);

    // Hero: the live brand line, the new headline and the pack lead; light, no gradient.
    const hero = page.locator('#hero');
    await expect(hero.locator('.ux-eyebrow')).toHaveText('Cross-border market access');
    await expect(hero.getByRole('heading', { level: 1 })).toHaveText(
      'Find the right business partners.',
    );
    await expect(hero.locator('.hv43-lead')).toHaveText(lead);
    expect(await hero.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
    expect(
      await hero
        .getByRole('heading', { level: 1 })
        .locator('em')
        .evaluate((em) => getComputedStyle(em).display),
    ).toBe('block');
    // The photo: decoration only, empty alt, hidden figure, explicit size, high priority, no people.
    const photo = hero.locator('figure.hv43-photo');
    await expect(photo).toHaveAttribute('aria-hidden', 'true');
    const image = photo.locator('img');
    await expect(image).toHaveAttribute('alt', '');
    await expect(image).toHaveAttribute('width', '1440');
    await expect(image).toHaveAttribute('height', '960');
    await expect(image).toHaveAttribute('fetchpriority', 'high');
    expect(await image.getAttribute('src')).toContain('corridra-industrial-hero.webp');
    // One column on a phone (the photo after the text), two from 48 rem (side by side).
    const [text, figure] = await Promise.all([
      hero.locator('.hv43-hero-text').boundingBox(),
      photo.boundingBox(),
    ]);
    if (width < 768) expect(figure!.y).toBeGreaterThanOrEqual(text!.y + text!.height - 1);
    else expect(figure!.x).toBeGreaterThan(text!.x + text!.width - 1);
    await expect(hero.getByRole('link')).toHaveText(['Start a Request', 'See a Worked Example']);
    for (const link of await hero.getByRole('link').all())
      expect(
        (await link.boundingBox())!.height,
        'targets are at least 44 px',
      ).toBeGreaterThanOrEqual(44);

    // The choice block: four doors in one group, China checked on load, the two big ones carry the sentences.
    await expect(choice(page).getByRole('radio')).toHaveCount(4);
    await expect(door(page, 'china')).toBeChecked();
    const lines = page.locator('.hv42-line');
    await expect(lines).toHaveCount(2);
    const buys = await units(lines.nth(0));
    const sells = await units(lines.nth(1));
    expect(buys.map((u) => [u.text, u.flag])).toEqual([
      ['Bangladesh', '/flags/bd.svg'],
      ['buys from', null],
      ['China', '/flags/cn.svg'],
    ]);
    expect(sells.map((u) => [u.text, u.flag])).toEqual([
      ['Bangladesh', '/flags/bd.svg'],
      ['sells to', null],
      ['EU', '/flags/eu.svg'],
      ['UK', '/flags/gb.svg'],
      ['US', '/flags/us.svg'],
      ['Australia', '/flags/au.svg'],
    ]);
    for (const u of [...buys, ...sells]) if (u.flag) expect(u.flagWidth).toBe(22);
    expect(new Set(buys.map((u) => u.top)).size, 'the supply sentence is one line').toBe(1);
    if (width >= 506) {
      expect(new Set(sells.map((u) => u.top)).size, 'the demand sentence is one line').toBe(1);
    } else {
      expect(new Set(sells.slice(0, 2).map((u) => u.top)).size).toBe(1);
      expect(new Set(sells.slice(2).map((u) => u.top)).size).toBe(1);
      expect(sells[2]!.top).toBeGreaterThan(sells[0]!.top);
    }
    for (const line of [lines.nth(0), lines.nth(1)])
      expect(await line.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    await expect(page.locator('#home-start')).toHaveCount(1);
    await expect(page.locator('#home-start')).toHaveAttribute('href', '/plan?job=sourcing');
    await expect(page.locator('#home-start')).toHaveText('Start a Request');
    // The long route block stays closed until an anchor or an action opens it.
    await expect(page.locator('#reveal, [id^="route-"]')).toHaveCount(0);
    for (const target of await page
      .locator('.hv43-choose label, #home-start, .hv43-choose .button-secondary')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height))))
      expect(target, 'targets are at least 44 px').toBeGreaterThanOrEqual(44);

    const found = (await new AxeBuilder({ page }).include('main').include('footer').analyze())
      .violations;
    expect(found.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

test('at 390px the route choice heading starts on the first screen, below the hero actions and the photo', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 390, height: 844 });
  const top = await page.locator('#hv42-question').evaluate((el) => el.getBoundingClientRect().top);
  // The sticky header is 60 px and the hero holds the text, both actions and the photo; the heading is next.
  expect(top).toBeLessThanOrEqual(844);
  const heroBottom = await page
    .locator('#hero')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  expect(heroBottom).toBeLessThanOrEqual(760);
});

test('at 1440px the hero is a light split of about 700 px and the doors sit below it', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1440, height: 900 });
  const box = (await page.locator('#hero').boundingBox())!;
  expect(box.height).toBeGreaterThan(450);
  expect(box.height).toBeLessThan(800);
  expect(
    await page.locator('#hero').evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe('rgb(0, 0, 0)');
});

test('the hero Start a Request moves focus to the route choice group; Worked Example goes to the example', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  await page.locator('#hero').getByRole('link', { name: 'Start a Request' }).click();
  await expect(choice(page)).toBeFocused();
  await page.locator('#hero').getByRole('link', { name: 'See a Worked Example' }).click();
  await expect(page).toHaveURL(/#example$/);
});

test('page order so far: hero, the choice, Solutions, the worked example, the closing band', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1440 });
  const heads = await page
    .locator('main h1, main h2, #hv42-question')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  expect(heads.slice(0, 3)).toEqual([
    'Find the right business partners.',
    'Which way is your business moving?',
    'What Corridra can do for you.',
  ]);
  expect(heads[3]).toBe('Find out what the quote really covers.');
  await expect(page.locator('#service-source, #service-sell, #service-delegation')).toHaveCount(3);
  await expect(page.locator('main [class*="tr-strip"], main canvas')).toHaveCount(0);
});

test('a door choice follows through the example and says one short thing, with no focus move', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const announce = page.locator('#hv43-announce');
  await expect(liveRegions(page)).toHaveCount(1);
  await expect(announce).toHaveAttribute('aria-live', 'polite');
  const titles = {
    sell: ['Find the buyers worth meeting.', 'Build a buyer shortlist', '/plan?job=buyers'],
    delegation: ['Give every meeting a job to do.', 'Follow a delegation', '/plan?job=delegations'],
    other: ['Start with the outcome you need.', 'Shape an initial request', '/plan'],
    china: [
      'Find out what the quote really covers.',
      'Compare machinery offers',
      '/plan?job=sourcing',
    ],
  } as const;
  for (const route of ['sell', 'delegation', 'other', 'china'] as const) {
    const [title, consoleName, href] = titles[route];
    await choice(page).locator(`.tr-door:has(input[value="${route}"]) label`).click();
    await expect(door(page, route)).toBeChecked();
    await expect(page.locator('#example-title')).toHaveText(title);
    await expect(page.locator('.hv43-console-head')).toContainText(consoleName);
    await expect(page.locator('#home-start')).toHaveAttribute('href', href);
    // No focus move out of the group, one live region, a short polite message, and no route opened.
    expect(await page.evaluate(() => !!document.activeElement?.closest('#home-route-group'))).toBe(
      true,
    );
    await expect(liveRegions(page)).toHaveCount(1);
    await expect(announce).toContainText('chosen. The example, steps and request now follow it.');
    expect(((await announce.textContent()) ?? '').split(' ').length).toBeLessThanOrEqual(14);
    await expect(page.locator('#reveal, [id^="route-"]')).toHaveCount(0);
  }
});

test('a press inside a console posts to the same announcer and no other region is live', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const announce = page.locator('#hv43-announce');
  const offers = page.locator('.hv43-offers');
  await expect(offers.getByRole('button')).toHaveText([
    'Supplier A USD 36,800',
    'Supplier B USD 34,200',
    'Supplier C USD 39,100',
  ]);
  await expect(page.locator('.hv43-result')).toContainText('Can you compare the total costs?');
  await expect(page.locator('.hv43-next')).toContainText(
    'Ask both suppliers for written quotes that cover the same costs.',
  );
  await offers.getByRole('button', { name: /Supplier B/ }).click();
  await expect(offers.getByRole('button', { name: /Supplier B/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.hv43-result')).toContainText('Supplier B · Comparison pending');
  await expect(page.locator('.hv43-result')).toContainText('lowest figure on the page');
  await expect(announce).toHaveText('Supplier B chosen.');
  await expect(liveRegions(page)).toHaveCount(1);
  // Nothing is added up, ranked or converted.
  await expect(page.locator('.hv43-console')).not.toContainText(
    /total of|cheapest|best price|BDT/i,
  );
  await expect(page.locator('.hv43-console .ux-example-tag')).toHaveText('Sample data');
  await expect(offers.getByRole('button', { name: /Supplier A/ })).toHaveAccessibleDescription(
    'FOB Ningbo · Installation included',
  );

  await page.locator('.tr-door:has(input[value=\"sell\"]) label').click();
  const views = page.getByRole('group', { name: 'List view' });
  await expect(page.locator('.hv43-buyers li')).toHaveCount(3);
  await views.getByRole('button', { name: 'Qualified Shortlist' }).click();
  await expect(page.locator('.hv43-buyers li')).toHaveCount(3);
  await expect(page.locator('.hv43-buyers')).not.toContainText('Fabric mill');
  await expect(page.locator('.hv43-result')).toContainText('The shortlist extends beyond the fair');
  await views.getByRole('button', { name: 'Fair List' }).click();
  await expect(page.locator('.hv43-buyers')).toContainText('Fabric mill');
  await expect(page.locator('.hv43-buyers')).not.toContainText(/Verified/);

  await page.locator('.tr-door:has(input[value=\"delegation\"]) label').click();
  const phases = page.getByRole('group', { name: 'Programme phase' });
  await expect(phases.getByRole('button')).toHaveText([
    'Before the Visit',
    'On the Ground',
    'After the Visit',
  ]);
  await phases.getByRole('button', { name: 'After the Visit' }).click();
  await expect(page.locator('.hv43-result')).toContainText(
    'Put a name and deadline on the follow-up',
  );
  await expect(announce).toHaveText('After the Visit shown.');

  await page.locator('.tr-door:has(input[value=\"other\"]) label').click();
  const questions = page.getByRole('group', { name: 'Request question' });
  await expect(questions.getByRole('button')).toHaveText(['Goal', 'Direction', 'Next Step']);
  await questions.getByRole('button', { name: 'Direction' }).click();
  await expect(page.locator('.hv43-result')).toContainText('Where is the work?');
  await expect(liveRegions(page)).toHaveCount(1);
});

test('Solutions cards choose a route and take focus to the example; the walk opens the delegation route', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1440 });
  await page.getByRole('link', { name: 'Explore a Selling Example' }).click();
  await expect(door(page, 'sell')).toBeChecked();
  await expect(page.locator('#example-title')).toBeFocused();
  await expect(page.locator('#example-title')).toHaveText('Find the buyers worth meeting.');
  await expect(page.locator('#reveal')).toHaveCount(0);

  await page.getByRole('button', { name: 'Walk Through a Sample Programme' }).click();
  await expect(page.locator('#reveal')).toBeVisible();
  await expect(page.locator('#route-delegation')).toBeFocused();
  await expect(door(page, 'delegation')).toBeChecked();
  // The block's own bar: no live region of its own, All Routes closes it and returns to Start a Request.
  await expect(page.locator('#reveal .tr-bar [aria-live]')).toHaveCount(0);
  await page.locator('#reveal').getByRole('button', { name: 'All Routes' }).click();
  await expect(page.locator('#reveal')).toHaveCount(0);
  await expect(page.locator('#home-start')).toBeFocused();

  // "See the Full Example" opens the route of the example that is shown.
  await page.getByRole('button', { name: 'See the Full Example' }).click();
  await expect(page.locator('#route-delegation')).toBeFocused();
});

test('every route anchor opens its route before it takes focus', async ({ page }) => {
  await mountHomeV43(page, { width: 1024 });
  for (const [id, route] of [
    ['quote-b', 'china'],
    ['faircost-title', 'sell'],
    ['route-other', 'other'],
    ['gaps', 'china'],
  ] as const) {
    await page.evaluate((target) => {
      window.location.hash = target;
    }, id);
    await expect(page.locator(`#${id}`)).toBeFocused();
    await expect(page.locator(`#route-${route}`)).toHaveCount(1);
    await expect(door(page, route)).toBeChecked();
  }
});

test('with reduced motion nothing on the page is animating, and 200 per cent text does not scroll sideways', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mountHomeV43(page, { width: 1280, textSize: 200 });
  expect(await overflow(page), 'no sideways scroll at 200% text').toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
  ).not.toBe('smooth');
  // A flag never leaves its name: the mark and the written name share one row, wherever the name wraps.
  for (const unit of await page.locator('.ux-flagged').all()) {
    const rows = await unit.evaluate((el) => {
      const mark = el.firstElementChild!.getBoundingClientRect();
      const name = el.lastElementChild!.getBoundingClientRect();
      return { markBottom: mark.bottom, nameTop: name.top };
    });
    expect(rows.markBottom).toBeGreaterThan(rows.nameTop);
  }
});

test('every action of the first half is Title Case and none is upper-cased by CSS', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const labels = await page
    .locator('main button, main a.primary-link, main a.button-secondary, main a.text-link')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node as HTMLElement).offsetParent !== null)
        .map((node) => ({
          text: (node.textContent ?? '').trim(),
          transform: getComputedStyle(node).textTransform,
        })),
    );
  expect(labels.length).toBeGreaterThan(8);
  expect(labels.filter((l) => !isTitleCase(l.text)).map((l) => l.text)).toEqual([]);
  expect(labels.filter((l) => l.transform !== 'none').map((l) => l.text)).toEqual([]);
});

// Second half: how it works, the markets explorer, the inbound band, trust, people, questions, the request form.
const headings = (page: Page) =>
  page
    .locator('main h1, main h2, #hv42-question')
    .evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter(Boolean),
    );

test('page order: hero, choice, Solutions, example, How it works, Markets, Inbound, Trust, People, Questions, limits, request, closing band', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1440 });
  const heads = await headings(page);
  expect(heads.slice(0, 13)).toEqual([
    'Find the right business partners.',
    'Which way is your business moving?',
    'What Corridra can do for you.',
    'Find out what the quote really covers.',
    'How an assignment moves forward.',
    "Explore the markets you're working in.",
    expect.stringMatching(/^Open routes now\./),
    expect.stringMatching(/^Looking for a partner in Bangladesh ?\?$/),
    "See what's been checked.",
    'Who uses Corridra?',
    'Common questions.',
    expect.any(String),
    expect.any(String),
  ]);
  const ids = await page
    .locator('main section[id], main article[id]')
    .evaluateAll((els) => els.map((e) => e.id));
  expect(ids.slice(0, 5)).toEqual(['hero', 'start', 'solutions', 'service-source', 'service-sell']);
  // Every anchor the header, the footer and the hero point at is on the page exactly once.
  for (const id of [
    'start',
    'solutions',
    'service-source',
    'service-sell',
    'service-delegation',
    'example',
    'process',
    'markets',
    'routes',
    'inbound',
    'trust',
    'people',
    'who',
    'who-panel',
    'questions',
    'limits',
    'brief',
    'brief-start',
    'final',
    'final-start',
    'how',
    'faq',
    'home-start',
    'pick',
    'hv42-question',
    'home-title',
  ])
    await expect(page.locator(`#${id}`), id).toHaveCount(1);
});

test('How it works: four stages per route, the whole process under a named disclosure, #how opens it', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const stages = page.getByRole('group', { name: 'Explore a mission stage' });
  await expect(stages.getByRole('button')).toHaveText([
    'Set the Request',
    'Check the Fit',
    'Make Contact',
    'Follow Through',
  ]);
  const record = page.locator('#process .hv43-record');
  await expect(record).toContainText('Agree the requirement');
  await stages.getByRole('button', { name: 'Make Contact' }).click();
  await expect(stages.getByRole('button', { name: 'Make Contact' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(record).toContainText('Arrange a focused visit');
  // A door starts the stage set of its route again from the first stage.
  await page.locator('.tr-door:has(input[value="sell"]) label').click();
  await expect(record).toContainText('Define your buyer');
  await expect(stages.getByRole('button', { name: 'Set the Request' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(liveRegions(page)).toHaveCount(1);
  // The whole process: fourteen steps, optional 8 to 13 named, the four rules; closed until opened.
  const more = page.locator('#process details.hv43-more');
  await expect(more).not.toHaveAttribute('open', '');
  await more.locator('summary').click();
  await expect(more.locator('.hv42-steps li')).toHaveCount(14);
  await expect(more.locator('.hv42-steps li.is-optional')).toHaveCount(6);
  await expect(more.locator('.hv42-rules > div')).toHaveCount(4);
  await more.locator('summary').click();
  await page.evaluate(() => {
    window.location.hash = 'how';
  });
  await expect(more).toHaveAttribute('open', '');
  await expect(page.locator('#how')).toBeFocused();
});

test('Markets: six rows with a mark, the compass for Key Asian Markets, direction, a static schematic and the request link', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mountHomeV43(page, { width: 1440 });
  const list = page.getByRole('group', { name: 'Market' });
  await expect(list.getByRole('button')).toHaveText([
    'China',
    'EU',
    'UK',
    'US',
    'Australia',
    'Key Asian Markets',
  ]);
  await expect(list.locator('.hv43-market-line')).toHaveText([
    'Buy and source',
    'Sell abroad',
    'Sell abroad',
    'Sell abroad',
    'Sell abroad',
    'Specify your market',
  ]);
  const asia = list.getByRole('button', { name: 'Key Asian Markets' });
  await expect(asia.locator('.ux-region-mark')).toHaveCount(1);
  await expect(page.locator('#markets img[src*="region"], #markets canvas')).toHaveCount(0);
  await expect(page.locator('#markets')).not.toContainText(/Bangladesh to Key Asian|Pause|Resume/);
  // China outbound is the default; the status, the detail and both endpoints are written.
  const record = page.locator('#markets .hv43-record');
  await expect(record).toContainText('Sourcing focus');
  await expect(record).toContainText('Source products, components or machinery.');
  await asia.click();
  await expect(asia).toHaveAttribute('aria-pressed', 'true');
  await expect(record).toContainText('Sales enquiries · Scope confirmed per request');
  await expect(record).toContainText('Describe the market you want to sell into');
  await expect(record.locator('.hv43-chips')).not.toContainText(' to ');
  // Into Bangladesh: every row says "Case by case", the rule turns dashed, the status says why.
  const direction = page.getByRole('group', { name: 'Direction' });
  await expect(direction.getByRole('button')).toHaveText(['From Bangladesh', 'Into Bangladesh']);
  await direction.getByRole('button', { name: 'Into Bangladesh' }).click();
  await expect(list.locator('.hv43-market-line')).toHaveText(Array(6).fill('Case by case'));
  await expect(record).toContainText('Selective · Assessed case by case');
  await expect(page.locator('.hv43-schematic')).toHaveAttribute('data-status', 'selective');
  expect(
    await page
      .locator('.hv43-schematic')
      .evaluate((el) => getComputedStyle(el, '::after').borderTopStyle),
  ).toBe('dashed');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(liveRegions(page)).toHaveCount(1);
  await expect(
    page.locator('#markets').getByRole('link', { name: 'View All Routes' }),
  ).toHaveAttribute('href', '/corridors');
  await expect(
    page.locator('#markets').getByRole('link', { name: 'Explore a Sample Counterparty Dossier' }),
  ).toHaveAttribute('href', '/corridors#mission-example');
  // Use This Route: an inbound market is the "another goal" route, set in the request, focus on its first field.
  await page.getByRole('button', { name: 'Use This Route in the Request' }).click();
  await expect(door(page, 'other')).toBeChecked();
  await expect(page.locator('#home-brief-job')).toBeFocused();
  await expect(page.locator('#home-brief-job')).toHaveValue('');
});

test('Markets: Use This Route picks the goal and the pair for China, and for a sell market', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  await page
    .getByRole('group', { name: 'Market' })
    .getByRole('button', { name: 'US', exact: true })
    .click();
  await page.getByRole('button', { name: 'Use This Route in the Request' }).click();
  await expect(door(page, 'sell')).toBeChecked();
  await expect(page.locator('#home-brief-job')).toHaveValue('buyers');
  await expect(page.locator('[name="companyCountry"]')).toHaveValue('BD');
  await expect(page.locator('[name="marketCode"]')).toHaveValue('US');
});

test('Trust: five English names, one ledger, the correction keeps revision 1 visible', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const names = page.locator('#trust .hv43-labels li');
  await expect(names).toHaveCount(5);
  await expect(names).toContainText([
    'Self-declared',
    'Evidence available',
    'Verified',
    'Derived',
    'Outcome observed',
  ]);
  await expect(page.locator('#trust .hv43-ledger')).toHaveCount(1);
  await expect(page.locator('#trust .hv43-ledger .ux-example-tag')).toHaveText('Sample data');
  const day6 = page.locator('#trust .hv43-ledger-row').nth(1);
  await expect(day6).toContainText('Supplier submits the original quote USD 36,800');
  const correction = page.locator('#trust details.hv43-correction');
  await correction.locator('summary').click();
  await expect(correction).toContainText(
    'Revision 2 records USD 37,400. The original quote remains visible as revision 1.',
  );
  await expect(correction).toContainText('New entry');
  await expect(day6).toContainText('USD 36,800');
  expect(await day6.locator('s, del').count()).toBe(0);
  await expect(
    page.getByRole('link', { name: "Read Corridra's Trust Principles" }),
  ).toHaveAttribute('href', '/trust');
});

test('Inbound: the band builds an inbound request and focuses its first field', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  await page.getByRole('button', { name: 'Build an Inbound Request' }).click();
  await expect(door(page, 'other')).toBeChecked();
  await expect(page.locator('#home-brief-job')).toBeFocused();
  await expect(page.locator('[name="companyCountry"]')).toHaveValue('OTHER');
  await expect(page.locator('[name="marketCode"]')).toHaveValue('BD');
});

test('People: Importer by default, a door preselects its role until one is picked, a picked role stays', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const roles = page.getByRole('group', { name: 'Select your role' });
  await expect(roles.getByRole('button')).toHaveText([
    'Exporter',
    'Importer',
    'Machinery Buyer',
    'Company Entering Bangladesh',
    'Overseas Buyer',
    'Supplier',
    'Delegation Leader',
    'Local Helper',
  ]);
  const pressed = () => roles.locator('[aria-pressed="true"]');
  await expect(pressed()).toHaveText('Importer');
  const panel = page.locator('#who-panel');
  await expect(panel).toContainText('The product or machine, quantity and delivery needs.');
  await expect(panel).toContainText(
    'Supplier checks, comparable offers and a plan for relevant visits.',
  );
  await page.locator('.tr-door:has(input[value="sell"]) label').click();
  await expect(pressed()).toHaveText('Exporter');
  await page.locator('.tr-door:has(input[value="delegation"]) label').click();
  await expect(pressed()).toHaveText('Delegation Leader');
  await page.locator('.tr-door:has(input[value="other"]) label').click();
  await expect(pressed()).toHaveText('Company Entering Bangladesh');
  await roles.getByRole('button', { name: 'Supplier' }).click();
  await expect(panel).toContainText('Respond to the requirement shared with you');
  await page.locator('.tr-door:has(input[value="china"]) label').click();
  await expect(pressed()).toHaveText('Supplier');
  await expect(liveRegions(page)).toHaveCount(1);
});

test('Questions: the pack eight are closed, the product answers are complete under More Answers', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const pack = page.locator('#questions .hv43-faq-list > details:not(.hv43-more)');
  await expect(pack).toHaveCount(8);
  for (const item of await pack.all()) await expect(item).not.toHaveAttribute('open', '');
  await pack.nth(2).locator('summary').click();
  await expect(pack.nth(2)).toContainText('Corridra quotes for the agreed work.');
  await expect(pack.nth(5).locator('a')).toHaveAttribute('href', '/privacy');
  const more = page.locator('#questions details.hv43-more');
  await expect(more.locator('#faq details')).toHaveCount(8);
  await expect(more).not.toHaveAttribute('open', '');
  await page.evaluate(() => {
    window.location.hash = 'faq';
  });
  await expect(more).toHaveAttribute('open', '');
  await expect(page.locator('#faq')).toBeFocused();
});

test('the request form is a real GET form to /plan with the request form parameters and a 600 character note', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const form = page.locator('#brief form');
  await expect(form).toHaveAttribute('method', 'get');
  await expect(form).toHaveAttribute('action', '/plan');
  await expect(form.locator('[name]')).toHaveCount(4);
  expect(
    await form.locator('[name]').evaluateAll((els) => els.map((e) => e.getAttribute('name'))),
  ).toEqual(['job', 'companyCountry', 'marketCode', 'note']);
  await expect(form.locator('textarea')).toHaveAttribute('maxlength', '600');
  const options = await page
    .locator('#home-brief-job option')
    .evaluateAll((els) => els.map((e) => e.textContent));
  expect(options).toEqual([
    'Source products from China',
    'Buy machinery',
    'Find buyers or distributors',
    'Get more from a trade fair',
    'Organise a delegation',
    'Describe another need',
  ]);
  // Every field has a visible label.
  for (const field of await form.locator('select, textarea').all()) {
    const id = await field.getAttribute('id');
    await expect(form.locator(`label[for="${id}"]`)).toHaveCount(1);
  }
  await expect(page.locator('#brief-start')).toHaveText('Review Request');
  await expect(page.locator('#brief .hv43-draft')).toContainText('Your request');
  await expect(page.locator('#brief .hv43-draft dd').nth(0)).toHaveText('To be discussed');
  await expect(page.locator('#brief .hv43-draft dd').nth(1)).toHaveText('Your notes appear here.');
});

test('a door sets the request unless the visitor changed it; typed words and timing survive every door', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const job = page.locator('#home-brief-job');
  const origin = page.locator('[name="companyCountry"]');
  const target = page.locator('[name="marketCode"]');
  await expect(job).toHaveValue('sourcing');
  await page.locator('.tr-door:has(input[value="sell"]) label').click();
  await expect(job).toHaveValue('buyers');
  await expect(target).toHaveValue('EU');
  await page.locator('.tr-door:has(input[value="other"]) label').click();
  await expect(job).toHaveValue('');
  await expect(target).toHaveValue('OTHER');
  await page.locator('#brief textarea').fill('Compare three machinery offers.');
  await page.locator('#brief select:not([name])').selectOption('2');
  await expect(page.locator('#brief .hv43-draft dd').nth(1)).toHaveText(
    'Compare three machinery offers.',
  );
  await expect(page.locator('#brief .hv43-draft dd').nth(0)).toHaveText('In 1 to 3 months');
  await job.selectOption('machinery_procurement');
  await page.locator('.tr-door:has(input[value="delegation"]) label').click();
  // The visitor's goal stays; the typed note and the timing stay.
  await expect(job).toHaveValue('machinery_procurement');
  await expect(page.locator('#brief textarea')).toHaveValue('Compare three machinery offers.');
  await expect(page.locator('#brief select:not([name])')).toHaveValue('2');
  // The target is never the company's own base; Bangladesh is offered only when the base is another place.
  await origin.selectOption('CN');
  const targets = await target
    .locator('option')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(targets).not.toContain('CN');
  expect(targets).toContain('BD');
  await origin.selectOption('BD');
  expect(
    await target
      .locator('option')
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value)),
  ).not.toContain('BD');
  // A note is cut at 600 characters.
  await page.locator('#brief textarea').fill('x'.repeat(700));
  expect((await page.locator('#brief textarea').inputValue()).length).toBe(600);
});

test('Review Request opens the preview with the exact request link, Escape returns focus, closed it adds no link', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const plan = () =>
    page.locator('main a[href^="/plan"]').evaluateAll((a) => a.map((l) => l.getAttribute('href')));
  await page.locator('.tr-door:has(input[value="sell"]) label').click();
  await page.locator('#brief textarea').fill('Knitwear to retail buyers');
  await page.locator('#brief select:not([name])').selectOption('1');
  const before = await plan();
  await page.locator('#brief-start').click();
  const dialog = page.getByRole('dialog', { name: 'Corridra request preview' });
  await expect(dialog).toBeVisible();
  const href = await dialog
    .getByRole('link', { name: 'Continue to Corridra' })
    .getAttribute('href');
  const url = new URL(href!, 'http://x');
  expect(url.pathname).toBe('/plan');
  expect(url.searchParams.get('job')).toBe('buyers');
  expect(url.searchParams.get('companyCountry')).toBe('BD');
  expect(url.searchParams.get('marketCode')).toBe('EU');
  expect(url.searchParams.get('note')).toContain('Knitwear to retail buyers');
  expect(url.searchParams.get('note')).toContain('Timing: Within a month');
  expect([...url.searchParams.keys()].sort()).toEqual([
    'companyCountry',
    'job',
    'marketCode',
    'note',
  ]);
  await expect(dialog).toContainText('Timing · Within a month');
  await expect(dialog).toContainText('Knitwear to retail buyers');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#brief-start')).toBeFocused();
  // The browser closes the dialog and returns focus at once, but its close event, which lets the page drop the
  // dialog's contents, arrives as a later task (KI-68). Wait for that settled state, then compare the exact list.
  await expect(page.locator('main a[href^="/plan"]')).toHaveCount(before.length);
  expect(await plan()).toEqual(before);
  // Help: no job and no pair, the visitor's own words only.
  await page.getByRole('button', { name: 'I Need Help Scoping This' }).click();
  const help = page.getByRole('dialog', { name: 'Corridra request preview' });
  await expect(help).toContainText('Have the team assess your request');
  const helpUrl = new URL(
    (await help.getByRole('link', { name: "Open Corridra's Request Form" }).getAttribute('href'))!,
    'http://x',
  );
  expect([...helpUrl.searchParams.keys()]).toEqual(['note']);
  await help.getByRole('button', { name: 'Close Preview' }).click();
  await expect(page.getByRole('button', { name: 'I Need Help Scoping This' })).toBeFocused();
});

test('copying works, and a refused clipboard says how to copy by hand', async ({ page }) => {
  await mountHomeV43(page, { width: 1024 });
  await page.locator('#brief textarea').fill('Specification A');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
  });
  await page.locator('#brief-start').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Copy Request Details' }).click();
  await expect(dialog).toContainText('Select the details above to copy them');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });
  await dialog.getByRole('button', { name: 'Copy Request Details' }).click();
  await expect(dialog).toContainText('Request details copied');
});

test('the dialog has no copy action when there is nothing to copy', async ({ page }) => {
  await mountHomeV43(page, { width: 1024 });
  await page.locator('#brief-start').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('You can add details in the live request.');
  await expect(dialog.getByRole('button', { name: 'Copy Request Details' })).toHaveCount(0);
});

test('no address is linked twice inside main beyond the request links, before and after each door', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1440 });
  const repeats = () =>
    page.locator('main a[href]').evaluateAll((links) => {
      const hrefs = links
        .map((link) => link.getAttribute('href') ?? '')
        .filter((href) => !/^(#|mailto:|tel:)/.test(href));
      return [...new Set(hrefs.filter((href, index) => hrefs.indexOf(href) !== index))];
    });
  const job = {
    china: '/plan?job=sourcing',
    sell: '/plan?job=buyers',
    delegation: '/plan?job=delegations',
    other: '/plan',
  };
  expect((await repeats()).filter((h) => h !== '/plan?job=sourcing')).toEqual([]);
  for (const [value, href] of Object.entries(job)) {
    await page.locator(`.tr-door:has(input[value="${value}"]) label`).click();
    expect(
      (await repeats()).filter((h) => h !== href && h !== '/plan'),
      value,
    ).toEqual([]);
  }
  const hrefs = await page
    .locator('main a[href]')
    .evaluateAll((l) => l.map((a) => a.getAttribute('href')));
  expect(hrefs.filter((h) => h === '/corridors')).toHaveLength(1);
  expect(hrefs.filter((h) => h === '/trust')).toHaveLength(1);
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
});

test('the named disclosures and the questions keep their words; actions in the second half are Title Case', async ({
  page,
}) => {
  await mountHomeV43(page, { width: 1024 });
  const summaries = await page
    .locator('main details.hv43-more > summary, main details.hv43-correction > summary')
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? '').trim()));
  expect(summaries).toEqual([
    'See the Full Process',
    "Day 11 · View the Supplier's Correction",
    'More Answers',
  ]);
  expect(summaries.filter((s) => !isTitleCase(s))).toEqual([]);
  const labels = await page
    .locator('main button, main a.primary-link, main a.button-secondary, main a.text-link')
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? '').trim()).filter(Boolean));
  expect(labels.length).toBeGreaterThan(40);
  expect(labels.filter((l) => !isTitleCase(l))).toEqual([]);
});

test('with 200 per cent text and reduced motion the whole page still has no sideways scroll or animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [390, 1280]) {
    await mountHomeV43(page, { width, textSize: 200 });
    expect(await overflow(page), `${width}px at 200% text`).toBe(0);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await expect(page.locator('main canvas')).toHaveCount(0);
  }
});

for (const width of [320, 1440] as const)
  test(`at ${width}px the second half has no sideways scroll, every target is 44 px and axe is clean`, async ({
    page,
  }) => {
    await mountHomeV43(page, { width });
    await page.locator('#process details.hv43-more > summary').click();
    await page.locator('#trust details.hv43-correction > summary').click();
    await page.locator('#questions details').first().locator('summary').click();
    expect(await overflow(page)).toBe(0);
    for (const control of await page
      .locator(
        'main button, main select, main textarea, main summary, main a.primary-link, main a.text-link, main a.button-secondary, main #hero a, main label:has(input)',
      )
      .all()) {
      if (!(await control.isVisible())) continue;
      const box = (await control.boundingBox())!;
      if (await control.evaluate((el) => el.closest('.sr-only'))) continue;
      expect(box.height, await control.innerText().catch(() => '')).toBeGreaterThanOrEqual(43.5);
    }
    const found = (await new AxeBuilder({ page }).include('main').analyze()).violations;
    expect(found.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
