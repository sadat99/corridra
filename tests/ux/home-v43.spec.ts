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
