import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mountHomeV42 } from '../ux/home-v42-fixture';

// UI/UX.v4.1 wave A, public pages (owner lock of 23 November 2026, docs/revamp/specs/ui-ux-v4-1.md): L4 home, L5
// routes, L6 plan and L7 start here, with L1 (a mark before every place name), L2 (one owned icon per choice) and L3
// (the chosen state) where those pages hold a choice. Presentation only: every route, id, link and word of the live
// pages is kept, and the older specs still check them.

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

/** A token's colour as the browser computes it, so a check names the token and never a raw colour. */
const token = (page: Page, name: string) =>
  page.evaluate((value) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${value})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const look = (target: Locator) =>
  target.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      fill: style.backgroundColor,
      edge: style.borderTopColor,
      edgeWidth: style.borderTopWidth,
      shadow: style.boxShadow,
      image: style.backgroundImage,
    };
  });

const door = (page: Page, name: string) =>
  page.locator('fieldset.tr-doors .ux-door label').filter({ hasText: name });

// ---- L4 Home ----

test('L4 home: a left aligned navy band holds the headline and the whole reversed mark, with no copper arc', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const band = page.locator('#hero .tr-hero');
  await expect(band).toHaveCount(1);
  expect((await look(band)).fill).toBe(await token(page, '--brand-deep'));
  // The live headline and copy, unchanged.
  await expect(band.locator('h1')).toHaveText('Make market entry deliberate.');
  await expect(band.locator('.tr-brandline')).toHaveText('Cross-border market access');
  const head = band.locator('.tr-hero-head');
  expect(await head.evaluate((el) => getComputedStyle(el).textAlign)).toMatch(/^(start|left)$/);
  const [bandBox, titleBox] = [await band.boundingBox(), await band.locator('h1').boundingBox()];
  expect(titleBox!.x - bandBox!.x, 'the headline starts at the left of the band').toBeLessThan(120);
  // No decorative copper arc: the band paints no layer over itself.
  for (const pseudo of ['::before', '::after'])
    expect(
      await band.evaluate((el, which) => getComputedStyle(el, which).backgroundImage, pseudo),
    ).toBe('none');
  // The reversed mark is whole: it is loaded, keeps its own proportions and lies inside the band.
  const mark = band.locator('img.tr-hero-mark');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('src', /corridra-mark-reversed\.svg/);
  await expect(mark).toHaveAttribute('alt', '');
  await expect
    .poll(() => mark.evaluate((img) => (img as HTMLImageElement).naturalWidth > 0))
    .toBe(true);
  const markBox = (await mark.boundingBox())!;
  expect(markBox.width).toBeGreaterThanOrEqual(64);
  expect(markBox.x).toBeGreaterThanOrEqual(bandBox!.x);
  expect(markBox.y).toBeGreaterThanOrEqual(bandBox!.y);
  expect(markBox.x + markBox.width).toBeLessThanOrEqual(bandBox!.x + bandBox!.width + 0.5);
  expect(markBox.y + markBox.height).toBeLessThanOrEqual(bandBox!.y + bandBox!.height + 0.5);
  expect(await mark.evaluate((img) => getComputedStyle(img).objectFit)).toBe('contain');
});

test('L4 home: the four choices sit below the band on the light surface, each with one owned icon', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  // The doors are in the hero section and outside the navy band.
  await expect(page.locator('#hero fieldset.tr-doors .ux-door')).toHaveCount(4);
  await expect(page.locator('#hero .tr-hero .ux-door')).toHaveCount(0);
  const bandBox = (await page.locator('#hero .tr-hero').boundingBox())!;
  const paper = await token(page, '--surface-1');
  const soft = await token(page, '--surface-subtle');
  for (const name of [
    'Buying from China',
    'Sell Abroad',
    'Leading a delegation',
    'Something else',
  ]) {
    const card = door(page, name);
    const box = (await card.boundingBox())!;
    expect(box.y, `${name} is below the band`).toBeGreaterThanOrEqual(bandBox.y + bandBox.height);
    expect((await look(card)).fill, name).toBe(paper);
    // L2: one owned icon in a 42 to 44 px soft square, beside the written label.
    const tile = card.locator('.ux-door-tile');
    await expect(tile).toHaveCount(1);
    await expect(tile.locator('svg.corridra-icon')).toHaveCount(1);
    await expect(tile).toHaveAttribute('aria-hidden', 'true');
    const tileBox = (await tile.boundingBox())!;
    for (const side of [tileBox.width, tileBox.height]) {
      expect(side).toBeGreaterThanOrEqual(42);
      expect(side).toBeLessThanOrEqual(44);
    }
    expect((await look(tile)).fill).toBe(soft);
    await expect(card.locator('svg.corridra-icon')).toHaveCount(1);
  }
  // L1: every place in a door's route line has its mark before its written name.
  const places = page.locator('#hero .ux-door-route .ux-flagged');
  expect(await places.count()).toBeGreaterThanOrEqual(8);
  for (const place of await places.all()) {
    await expect(place.locator('img.ux-flag, .ux-region-mark')).toHaveCount(1);
    expect((await place.innerText()).trim().length).toBeGreaterThan(1);
  }
});

test('L3 home: a chosen door has the cobalt edge, the selected fill and a filled radio; the others stay hollow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const selected = await token(page, '--selected');
  const surface = await token(page, '--selected-surface');
  const before = (await door(page, 'Sell Abroad').boundingBox())!;
  for (const dot of await page.locator('#hero .ux-door-dot').all())
    expect((await look(dot)).image, 'a door not chosen has a hollow radio').toBe('none');
  await door(page, 'Sell Abroad').click();
  // The fill eases in (under 300 ms), so wait for it to settle before reading the rest.
  await expect.poll(async () => (await look(door(page, 'Sell Abroad'))).fill).toBe(surface);
  await expect.poll(async () => (await look(door(page, 'Sell Abroad'))).edge).toBe(selected);
  const chosen = await look(door(page, 'Sell Abroad'));
  expect(chosen.edge).toBe(selected);
  // The edge is 2 px: one of border and one drawn inside, so the card keeps its size when chosen.
  expect(chosen.edgeWidth).toBe('1px');
  expect(chosen.shadow).toContain('inset');
  const after = (await door(page, 'Sell Abroad').boundingBox())!;
  expect(Math.round(after.width)).toBe(Math.round(before.width));
  const dots = page.locator('#hero .ux-door input:checked + label .ux-door-dot');
  await expect(dots).toHaveCount(1);
  expect((await look(dots)).image).not.toBe('none');
  expect((await look(dots)).edge).toBe(selected);
  expect((await look(door(page, 'Buying from China'))).fill).toBe(await token(page, '--surface-1'));
  expect(
    (await look(door(page, 'Sell Abroad').locator('.ux-door-tile'))).fill,
    'the chosen tile takes the selected fill',
  ).toBe(surface);
});

test('L4 home: one primary action below the choices, left aligned with them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const primary = page.locator('#hero .primary-link');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText('Start a Request');
  await expect(primary).toHaveAttribute('href', '/plan');
  const [doors, start] = [
    (await page.locator('#hero fieldset.tr-doors').boundingBox())!,
    (await primary.boundingBox())!,
  ];
  expect(start.y).toBeGreaterThanOrEqual(doors.y + doors.height);
  const firstDoor = (await door(page, 'Buying from China').boundingBox())!;
  expect(
    Math.abs(start.x - firstDoor.x),
    'the action starts where the doors start',
  ).toBeLessThanOrEqual(1);
  expect(
    await page.locator('#hero .tr-start').evaluate((el) => getComputedStyle(el).textAlign),
  ).toMatch(/^(start|left)$/);
});

for (const width of [320, 390, 768, 1024, 1440, 1920])
  test(`L4 home: no sideways scroll and the four doors keep their words at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    for (const name of [
      'Buying from China',
      'Sell Abroad',
      'Leading a delegation',
      'Something else',
    ])
      await expect(door(page, name)).toBeVisible();
    // Up to 768 px every door is a touch target of 44 px or more.
    if (width <= 768)
      for (const card of await page.locator('#hero .ux-door label').all())
        expect((await card.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

test('L4 home: axe finds nothing in the hero, before and after a choice', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const scan = async () => (await new AxeBuilder({ page }).include('#hero').analyze()).violations;
  expect(await scan()).toEqual([]);
  await door(page, 'Buying from China').click();
  expect(await scan()).toEqual([]);
});

// ---- L5 Routes ----

const rows = (page: Page) => page.locator('.guide-directions li.guide-direction-row');

test('L5 routes: a numbered list in the owner order, a 40 px mark, the word Open and one quiet link per row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/corridors');
  await expect(page.locator('.guide-directions ol > li.guide-direction-row')).toHaveCount(6);
  await expect(rows(page).locator('h3')).toHaveText([
    'China',
    'EU',
    'UK',
    'US',
    'Australia',
    'Key Asian Markets',
  ]);
  await expect(rows(page).locator('.guide-direction-n')).toHaveText([
    '01',
    '02',
    '03',
    '04',
    '05',
    '06',
  ]);
  // The number is for the eye; the ordered list already tells a screen reader the position.
  for (const n of await rows(page).locator('.guide-direction-n').all())
    await expect(n).toHaveAttribute('aria-hidden', 'true');
  for (const row of await rows(page).all()) {
    const mark = row.locator('img.ux-flag, .ux-region-mark');
    await expect(mark).toHaveCount(1);
    expect(Math.round((await mark.boundingBox())!.width), 'the mark is 40 px wide').toBe(40);
    await expect(row.locator('.guide-direction-open')).toHaveText('Open');
    await expect(row.locator('.guide-direction-open')).toBeVisible();
    const link = row.getByRole('link');
    await expect(link).toHaveCount(1);
    await expect(link).toContainText('See This Route');
    // Quiet: a text link, not a boxed button.
    const style = await link.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fill: s.backgroundColor, edge: s.borderTopWidth, line: s.textDecorationLine };
    });
    expect(style.fill).toBe('rgba(0, 0, 0, 0)');
    expect(style.edge).toBe('0px');
    expect(style.line).toContain('underline');
  }
  await expect(rows(page).nth(5).locator('img.ux-flag')).toHaveCount(0);
  // The six rows are one list, not six boxes: a row has no rounded box of its own.
  for (const row of await rows(page).all())
    expect(await row.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('0px');
});

for (const width of [320, 390, 768, 1024, 1440, 1920])
  test(`L5 routes: rows are one size, links are 44 px targets and nothing scrolls sideways at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/corridors');
    const boxes = await rows(page).evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().height)),
    );
    expect(new Set(boxes).size, JSON.stringify(boxes)).toBe(1);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    for (const link of await rows(page).getByRole('link').all())
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const row of await rows(page).all()) {
      await expect(row.locator('.guide-direction-open')).toBeVisible();
      // The mark stays before its written name, inside the row.
      const [mark, name, box] = [
        (await row.locator('img.ux-flag, .ux-region-mark').boundingBox())!,
        (await row.locator('h3 .ux-flagged > span').last().boundingBox())!,
        (await row.boundingBox())!,
      ];
      expect(mark.x + mark.width).toBeLessThanOrEqual(name.x + 1);
      expect(mark.y).toBeGreaterThanOrEqual(box.y);
      expect(mark.y + mark.height).toBeLessThanOrEqual(box.y + box.height);
    }
  });

// Carried from V41-0b (PR 618): the quick picks hold a mark before each name. At 390 and 1440 a quick pick keeps
// its words inside its own box and the page does not scroll sideways.
for (const width of [390, 1440])
  test(`/corridors quick picks wrap inside their boxes at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/corridors');
    const picks = page.getByRole('group', { name: 'Quick picks' }).getByRole('button');
    expect(await picks.count()).toBeGreaterThanOrEqual(2);
    for (const pick of await picks.all()) {
      await expect(pick.locator('img.ux-flag').first()).toBeVisible();
      const fits = await pick.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const inside = [...el.querySelectorAll('img, span')].every((child) => {
          const c = child.getBoundingClientRect();
          return c.left >= box.left - 0.5 && c.right <= box.right + 0.5;
        });
        return inside && el.scrollWidth <= el.clientWidth + 1;
      });
      expect(fits, await pick.innerText()).toBe(true);
    }
    const group = (await page.getByRole('group', { name: 'Quick picks' }).boundingBox())!;
    expect(group.x + group.width).toBeLessThanOrEqual(width);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

// ---- L6 Plan ----

/** Opens /plan with a company country and a market already chosen, as a route link does. */
async function openPlan(page: Page, companyCountry: string, marketCode: string) {
  await page.goto(`/plan?companyCountry=${companyCountry}&marketCode=${marketCode}`);
  await expect(page.locator('.plan-progress-line')).toContainText('of 5');
}

test('L6 plan: "Your request" is a flat navy panel with white words and no gradient', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/plan');
  const panel = page.locator('aside.ux-brief-summary');
  await expect(panel).toBeVisible();
  const style = await look(panel);
  expect(style.fill).toBe(await token(page, '--brand-deep'));
  expect(style.image).toBe('none');
  expect(await panel.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none');
  const white = await token(page, '--on-brand');
  for (const part of ['.ux-brief-heading', 'dt', 'dd', 'details > p'])
    for (const el of await panel.locator(part).all())
      if (await el.isVisible())
        expect(await el.evaluate((node) => getComputedStyle(node).color), part).toBe(white);
  await expect(panel.locator('dd').first()).toHaveText('Not chosen yet');
  expect(
    (await new AxeBuilder({ page }).include('aside.ux-brief-summary').analyze()).violations,
  ).toEqual([]);
});

test('L1 plan: the place names in "Your request" carry their flag, and a place with no flag shows its name only', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlan(page, 'BD', 'EU');
  const values = page.locator('aside.ux-brief-summary dd');
  const country = values.nth(1);
  await expect(country).toHaveText('Bangladesh');
  await expect(country.locator('.ux-flagged img.ux-flag')).toHaveAttribute('data-flag', 'bd');
  const market = values.nth(2);
  await expect(market.locator('.ux-flagged img.ux-flag')).toHaveAttribute('data-flag', 'eu');
  expect((await market.innerText()).trim().length).toBeGreaterThan(1);
  await expect(values.nth(0).locator('img.ux-flag')).toHaveCount(0);
  // A flag is decorative beside its written name: a screen reader hears the name once.
  for (const flag of await page.locator('aside.ux-brief-summary img.ux-flag').all())
    await expect(flag).toHaveAttribute('alt', '');
});

test('L1 plan: a market outside the nine flags shows its name with no flag', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlan(page, 'BD', 'JP');
  const market = page.locator('aside.ux-brief-summary dd').nth(2);
  await expect(market).toHaveText('Japan');
  await expect(market.locator('img')).toHaveCount(0);
});

for (const width of [320, 390, 1440])
  test(`L6 plan: the summary stays inside the page at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openPlan(page, 'BD', 'GB');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

// ---- L7 Start here ----

test('L7 start here: Plan a Mission is the only primary button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');
  const primary = page.locator('#main .primary-link');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText('Plan a Mission');
  await expect(primary).toHaveAttribute('href', '/plan');
  await expect(page.locator('#main h1')).toHaveText('What would you like to do?');
});

test('L7 start here: the three "Already working with us" doors are equal cards, each with an icon and its own route', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');
  const cards = page.locator('.ux-start-signin li');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('h3')).toHaveText([
    'Customer',
    'Corridra team',
    'Supplier, programme member or local helper',
  ]);
  const boxes = await cards.evaluateAll((items) =>
    items.map((item) => {
      const { width, height, top } = item.getBoundingClientRect();
      return { width: Math.round(width), height: Math.round(height), top: Math.round(top) };
    }),
  );
  for (const key of ['width', 'height', 'top'] as const)
    expect(new Set(boxes.map((box) => box[key])).size, `${key} ${JSON.stringify(boxes)}`).toBe(1);
  const soft = await token(page, '--surface-subtle');
  for (const card of await cards.all()) {
    const tile = card.locator('.ux-start-tile');
    await expect(tile).toHaveCount(1);
    await expect(tile.locator('svg.corridra-icon')).toHaveCount(1);
    const box = (await tile.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(42);
    expect(box.width).toBeLessThanOrEqual(44);
    expect((await look(tile)).fill).toBe(soft);
    // A card, with an edge of its own.
    expect(await card.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
  }
  // Each door keeps its own route, and the team's set-up link is kept.
  const want = [
    ['Open My Account', '/account'],
    ['Team Sign-In', '/operator'],
    ['Local Helper Sign-In', '/contributor'],
    ['Set up your team account', '/operator/setup'],
  ] as const;
  for (const [name, href] of want)
    await expect(
      page.locator('.ux-start-signin').getByRole('link', { name, exact: true }),
    ).toHaveAttribute('href', href);
  // The two ways to begin carry their icon too.
  await expect(page.locator('.ux-start-grid .ux-start-tile svg.corridra-icon')).toHaveCount(2);
  expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([]);
});

for (const width of [320, 390, 768, 1024, 1440, 1920])
  test(`L7 start here: every link is reachable, 44 px high up to 768 and nothing scrolls sideways at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/workspace');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const fold = page.locator('.ux-start-signin-details > summary');
    if (await fold.isVisible()) await fold.click();
    for (const name of ['Open My Account', 'Team Sign-In', 'Local Helper Sign-In']) {
      const link = page.locator('.ux-start-signin').getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      if (width <= 768) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

// ---- L1 on the service and route pages ----

const routeLabels = [
  ['/sell', 'Bangladesh to the EU', ['bd', 'eu']],
  ['/source', 'Bangladesh to China', ['bd', 'cn']],
  ['/enter-market', 'The EU to Bangladesh', ['eu', 'bd']],
  ['/trade-missions', 'Bangladesh to China', ['bd', 'cn']],
] as const;

for (const [path, words, flags] of routeLabels)
  test(`L1 ${path}: "The route this page is about" names each place with its flag, in the live words`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    const route = page.getByRole('complementary', { name: 'Route for this page' });
    await expect(route.locator('strong')).toHaveText(words);
    const marks = route.locator('strong .ux-flagged img.ux-flag');
    expect(await marks.evaluateAll((items) => items.map((item) => item.dataset.flag))).toEqual([
      ...flags,
    ]);
    for (const mark of await marks.all()) await expect(mark).toHaveAttribute('alt', '');
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await overflow(page), `${path} at ${width}`).toBeLessThanOrEqual(0);
    }
  });

const corridorLabels = [
  ['/corridors/bangladesh-china', 'Bangladesh China', ['bd', 'cn']],
  ['/corridors/bangladesh-eu', 'Bangladesh EU', ['bd', 'eu']],
  ['/corridors/bangladesh-spain', 'Bangladesh Spain', ['bd', 'es']],
] as const;

for (const [path, words, flags] of corridorLabels)
  test(`L1 ${path}: the route label above the headline has a flag before each place`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const label = page.locator('main .label').first();
    await expect(label).toHaveText(words);
    expect(
      await label
        .locator('.ux-flagged img.ux-flag')
        .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.flag)),
    ).toEqual([...flags]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

// Home page v4.2, CORRIDRA_UX_HOME_V42 exactly "true" (owner, 25 Nov 2026: "lock this v4.2", "Add a switch, off by
// default", "like option 2 for hero section", "Which way is your business moving?" "must be always like in the option
// 1"). The cases above stay the switch-off truth and are unchanged; this case mounts the real v4.2 components on the
// live home's styles (tests/ux/home-v42-fixture.ts), so the suite keeps one build with the switch off.
test('switch on (v4.2) L4 home: a left aligned flat navy band, then four choices each with one owned icon and one primary action', async ({
  page,
}) => {
  await mountHomeV42(page, { width: 1440 });
  const band = page.locator('#hero .tr-hero');
  expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    await token(page, '--brand-deep'),
  );
  expect(await band.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
  expect(await page.locator('#hero h1').evaluate((el) => getComputedStyle(el).textAlign)).toMatch(
    /^(start|left)$/,
  );
  const doors = page.locator('.hv42-choose .ux-door');
  await expect(doors).toHaveCount(4);
  for (const d of await doors.all()) await expect(d.locator('.ux-door-tile svg')).toHaveCount(1);
  await expect(page.locator('.hv42-choose .primary-link')).toHaveCount(1);
  expect(await overflow(page)).toBe(0);
});
