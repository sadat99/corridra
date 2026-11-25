import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mountHomeV42 } from './home-v42-fixture';

// Home page v4.2 with CORRIDRA_UX_HOME_V42 exactly "true" (owner, 25 Nov 2026: "lock this v4.2", "Add a switch, off
// by default", "must be always like in the option 1", "like option 2 for hero section", "Trim as shown";
// docs/revamp/specs/ui-ux-v4-2.md). The real HomeV42 and the real trimmed SiteFooterView on the live home's styles
// (tests/ux/home-v42-fixture.ts), so CI keeps one build with the switch off; tests/ux/home-v42-off.spec.ts holds the
// switch-off identity. Every case fails on a054c51c, where none of this exists.
const widths = [320, 390, 768, 1024, 1440, 1920] as const;

const lead =
  'Corridra turns your goal abroad into the right people, trusted talks and progress you can see. We run missions from Bangladesh to China, the EU, the UK, the US, Australia and key Asian markets. Choose yours.';

const choice = (page: Page) =>
  page.getByRole('group', { name: 'Which way is your business moving?' });
const radio = (page: Page, name: RegExp) => choice(page).getByRole('radio', { name });
const supply = /^Supply side Bangladesh buys from China/;
const demand = /^Demand side Bangladesh sells to EU/;
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
        height: Math.round(box.height),
      };
    }),
  );
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of widths) {
  test(`at ${width}px: hero, route map, the two route sentences, one Start a Request, no sideways scroll, axe clean`, async ({
    page,
  }) => {
    await mountHomeV42(page, { width });
    expect(await overflow(page), 'no sideways scroll').toBe(0);

    // Hero: the live brand line, headline and lead word for word, on the flat navy token, no gradient.
    const hero = page.locator('#hero');
    await expect(hero.locator('.tr-brandline')).toHaveText('Cross-border market access');
    await expect(hero.getByRole('heading', { level: 1 })).toHaveText(
      'Make market entry deliberate.',
    );
    await expect(hero.locator('.tr-lead')).toHaveText(lead);
    expect(
      await hero.locator('.hv42-hero').evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toBe('none');
    const map = hero.locator('figure.hv42-map');
    // One figure named from the live words; the names inside are not read a second time.
    // A named figure, not role=img over text (UI spec, accessibility).
    await expect(map).not.toHaveAttribute('role', /.+/);
    await expect(map).toHaveAttribute(
      'aria-label',
      'Bangladesh to China, the EU, the UK, the US, Australia',
    );
    await expect(map.locator('.hv42-map-body')).toHaveAttribute('aria-hidden', 'true');
    await expect(map.locator('.hv42-map-from')).toHaveText('Bangladesh');
    await expect(map.locator('.hv42-map-to > li')).toHaveText([
      'China',
      'EU',
      'UK',
      'US',
      'Australia',
    ]);
    const mapFlags = await map
      .locator('img[data-flag]')
      .evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src')));
    expect(mapFlags).toEqual([
      '/flags/bd.svg',
      '/flags/cn.svg',
      '/flags/eu.svg',
      '/flags/gb.svg',
      '/flags/us.svg',
      '/flags/au.svg',
    ]);
    await expect(map).not.toContainText(/Key Asian|Asia/);

    // The choice block: four doors, the two big ones carry the route sentences, a flag before every name.
    await expect(choice(page).getByRole('radio')).toHaveCount(4);
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
    for (const u of [...buys, ...sells]) {
      if (u.flag) expect(u.flagWidth, `${u.text} flag is 22 px`).toBe(22);
      expect(u.height, `${u.text} is never split`).toBeLessThan(28);
    }
    // One line: every unit on one row, nothing cut. Guardian decision B1: below 506 px the demand sentence breaks at
    // one fixed point, "Bangladesh sells to" on the first row and the four places together on the second.
    for (const line of [lines.nth(0), lines.nth(1)])
      expect(await line.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    expect(new Set(buys.map((u) => u.top)).size, 'the supply sentence is one line').toBe(1);
    if (width >= 506) {
      expect(new Set(sells.map((u) => u.top)).size, 'the demand sentence is one line').toBe(1);
    } else {
      expect(new Set(sells.slice(0, 2).map((u) => u.top)).size).toBe(1);
      expect(new Set(sells.slice(2).map((u) => u.top)).size).toBe(1);
      expect(sells[2]!.top).toBeGreaterThan(sells[0]!.top);
    }

    // The big doors sit side by side only where the choice grid is at least 70 rem; below they stack.
    const big = await page
      .locator('.hv42-doors-big > *')
      .evaluateAll((doors) => doors.map((d) => Math.round(d.getBoundingClientRect().left)));
    if (width >= 1440) expect(big[1]).toBeGreaterThan(big[0]!);
    else expect(big[1]).toBe(big[0]);

    // Exactly one Start a Request in the choice block, to /plan before a choice; the three ticks.
    await expect(page.locator('#home-start')).toHaveCount(1);
    await expect(page.locator('#home-start')).toHaveAttribute('href', '/plan');
    await expect(page.locator('.hv42-choose .ac1-calm li')).toHaveText([
      'No account needed',
      'Nothing is sent until you check your request',
      'Stop any time',
    ]);
    // Collapsed until a door is chosen, the request brief directly under the choice (G64: always render #brief, as
    // live); no link on the page points at a part that is not there.
    await expect(page.locator('#reveal, [id^="route-"]')).toHaveCount(0);
    await expect(page.locator('#brief')).toHaveCount(1);
    expect(
      await page.locator('.hv42-choose').evaluate((el) => el.nextElementSibling?.id ?? ''),
    ).toBe('brief');
    for (const href of await page
      .locator('main a[href^="#"]')
      .evaluateAll((a) => a.map((l) => l.getAttribute('href')!)))
      await expect(page.locator(href)).toHaveCount(1);

    if (width <= 768)
      for (const target of await page
        .locator('.hv42-choose label, #home-start')
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height))))
        expect(target, 'targets are at least 44 px').toBeGreaterThanOrEqual(44);

    const found = (await new AxeBuilder({ page }).include('main').include('footer').analyze())
      .violations;
    expect(found.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

test('page order: hero, the choice, the request brief, How it works, Trust, Who it is for, routes, answers, Plain limits, closing band', async ({
  page,
}) => {
  await mountHomeV42(page, { width: 1440 });
  const heads = await page
    .locator('main h1, main h2, #hv42-question')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.trim()));
  expect(heads.slice(0, 9)).toEqual([
    'Make market entry deliberate.',
    'Which way is your business moving?',
    'Your first request in 60 seconds.',
    'One mission, from first intent to repeat business.',
    'Every fact says how it is known.',
    'Eight people. One clear promise each.',
    expect.stringMatching(/^Open routes now\./),
    'Questions people ask before they start.',
    'What Corridra is not.',
  ]);
  expect(heads).toHaveLength(10);
  await expect(page.locator('main [class*="tr-strip"], main .ux-region-mark')).toHaveCount(0);
});

for (const width of [390, 1440] as const)
  test(`at ${width}px: the doors are one radio group by keyboard and by click; the chosen route opens under the choice`, async ({
    page,
  }) => {
    await mountHomeV42(page, { width });
    const china = radio(page, supply);
    const sell = radio(page, demand);
    await china.focus();
    await page.keyboard.press('Space');
    await expect(china).toBeChecked();
    // A radio choice does not move focus; the live note says where the route opened.
    await expect(china).toBeFocused();
    await expect(page.locator('.hv42-choose .tr-feedback')).toHaveText(
      'Opened below: Buying from China. Go to It',
    );
    await expect(page.locator('#home-start')).toHaveAttribute('href', '/plan?job=sourcing');
    await expect(page.locator('#home-start')).toHaveCount(1);
    await expect(page.locator('.hv42-door-wide:has(input:checked) .ux-door-picked')).toHaveText(
      'Selected',
    );
    await expect(page.locator('.hv42-choose .ux-door-picked')).toHaveCount(1);
    // The reveal is the next block after the choice and holds the route; the request brief follows it.
    expect(
      await page.locator('.hv42-choose').evaluate((el) => el.nextElementSibling?.id ?? ''),
    ).toBe('reveal');
    await expect(page.locator('#reveal #route-china')).toHaveCount(1);
    expect(await page.locator('#reveal').evaluate((el) => el.nextElementSibling?.id ?? '')).toBe(
      'brief',
    );
    await page.keyboard.press('ArrowDown');
    await expect(sell).toBeChecked();
    await expect(page.locator('#reveal #route-sell')).toHaveCount(1);
    await expect(page.locator('#reveal #route-china')).toHaveCount(0);
    await expect(page.locator('#home-start')).toHaveAttribute('href', '/plan?job=buyers');
    // By click, and All Routes closes it again.
    await page.locator('.hv42-choose .tr-door:has(input[value="delegation"]) label').click();
    await expect(radio(page, /^Leading a delegation/)).toBeChecked();
    await expect(page.locator('#reveal #route-delegation')).toHaveCount(1);
    await expect(page.locator('#home-start')).toHaveAttribute('href', '/plan?job=delegations');
    await page
      .getByRole('group', { name: 'Choose which route this page shows' })
      .getByRole('button', { name: 'All Routes', exact: true })
      .click();
    await expect(page.locator('#reveal')).toHaveCount(0);
    await expect(page.locator('#brief')).toHaveCount(1);
    await expect(page.locator('#home-start')).toHaveAttribute('href', '/plan');
    expect(await overflow(page)).toBe(0);
  });

test('the request brief is always on the page: before a choice, with each route, and after All Routes', async ({
  page,
}) => {
  await mountHomeV42(page, { width: 1440 });
  const brief = page.locator('main #brief');
  await expect(brief).toHaveCount(1);
  await expect(brief.locator('#brief-start')).toHaveAttribute('href', /^\/plan/);
  for (const value of ['china', 'sell', 'delegation', 'other']) {
    await page.locator(`.hv42-choose .tr-door:has(input[value="${value}"]) label`).click();
    await expect(brief, value).toHaveCount(1);
  }
  await page
    .getByRole('group', { name: 'Choose which route this page shows' })
    .getByRole('button', { name: 'All Routes', exact: true })
    .click();
  await expect(page.locator('#reveal')).toHaveCount(0);
  await expect(brief).toHaveCount(1);
});

for (const how of ['keyboard', 'pointer'] as const)
  test(`All Routes by ${how} closes the route and puts focus on Start a Request, never on the page (WCAG 2.4.3)`, async ({
    page,
  }) => {
    await mountHomeV42(page, { width: 390 });
    await page.locator('.hv42-choose .tr-door:has(input[value="sell"]) label').click();
    const all = page
      .getByRole('group', { name: 'Choose which route this page shows' })
      .getByRole('button', { name: 'All Routes', exact: true });
    if (how === 'keyboard') {
      await all.focus();
      await page.keyboard.press('Enter');
    } else await all.click();
    await expect(page.locator('#reveal')).toHaveCount(0);
    await expect(page.locator('#home-start')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  });

test('How it works, Trust and Who it is for: optional steps named, the navy Trust tile with five labels and the history', async ({
  page,
}) => {
  await mountHomeV42(page, { width: 1440 });
  const steps = page.locator('#how .hv42-steps li');
  await expect(steps).toHaveCount(14);
  const optional = await steps.evaluateAll((li) =>
    li.map((l, i) => [
      i + 1,
      l.classList.contains('is-optional'),
      !!l.querySelector('.hv42-step-tag'),
    ]),
  );
  for (const [n, isOptional, tag] of optional) {
    const expected = (n as number) >= 8 && (n as number) <= 13;
    expect(isOptional, `step ${n}`).toBe(expected);
    expect(tag, `step ${n} shows the word optional`).toBe(expected);
  }
  await expect(page.locator('#how .hv42-step-tag').first()).toBeVisible();
  await expect(page.locator('#how .hv42-step-tag').first()).toHaveText('optional');

  const trust = page.locator('.hv42-trust #trust');
  const colours = await trust.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--brand-deep)';
    document.body.append(probe);
    const navy = getComputedStyle(probe).color;
    probe.style.color = 'var(--on-brand)';
    const white = getComputedStyle(probe).color;
    probe.remove();
    return {
      navy,
      white,
      background: getComputedStyle(el).backgroundColor,
      text: [...el.querySelectorAll('h2, .tr-sub, .tr-five p')].map(
        (e) => getComputedStyle(e).color,
      ),
    };
  });
  expect(colours.background).toBe(colours.navy);
  for (const colour of colours.text) expect(colour).toBe(colours.white);
  await expect(trust.locator('.tr-five > li')).toHaveCount(5);
  await expect(trust.locator('.tr-ledger')).toContainText('Offer received, revision 1, USD 36,800');
  await expect(trust.locator('.tr-ledger')).toContainText('Correction: revision 2, USD 37,400.');
  await expect(trust.locator('.tr-ledger s')).toHaveText('Revision 1 is kept.');
  await expect(trust.locator('.tr-ledger')).toContainText('New entry');
  await expect(trust.locator('.tr-ledger .ac1-example-tag')).toHaveText('Example');

  await expect(page.locator('#who .hv42-people > li')).toHaveCount(8);
  await expect(page.locator('#who')).not.toContainText('You give');
  await expect(page.locator('.hv42-rules > div')).toHaveCount(4);
  // The four rules are not a second "How it works" group (one name per landmark).
  await expect(page.locator('.hv42-rules')).not.toHaveAttribute('role', /.+/);
  await expect(
    page.getByRole('group', { name: 'One mission, from first intent to repeat business.' }),
  ).toHaveCount(0);
});

test('route statuses keep their claims; the Sell card has no Key Asian Markets; four answers open, four closed; Plain limits on navy', async ({
  page,
}) => {
  await mountHomeV42(page, { width: 1440 });
  const cards = page.locator('#routes .tr-routes > div');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toContainText('Bangladesh');
  await expect(cards.nth(0)).toContainText('China');
  await expect(cards.nth(0).locator('.tr-status')).toHaveText('Open now');
  await expect(cards.nth(1).locator('.tr-status')).toHaveText('Open now');
  await expect(cards.nth(1).locator('.ux-flagged')).toHaveText([
    'Bangladesh',
    'EU',
    'UK',
    'US',
    'Australia',
  ]);
  await expect(cards.nth(1)).not.toContainText(/Key Asian|Asia/);
  await expect(cards.nth(1).locator('.ux-region-mark')).toHaveCount(0);
  await expect(cards.nth(2)).toContainText('Into Bangladesh');
  await expect(cards.nth(2).locator('.tr-status')).toHaveText('Selective');
  await expect(cards.nth(3)).toContainText('Any other route');
  await expect(cards.nth(3)).toContainText('No operating offer announced');
  await expect(cards.nth(3).locator('.tr-status')).toHaveText('Ask us');
  await expect(
    page.locator('#routes').getByRole('link', { name: 'Explore Every Route' }),
  ).toHaveAttribute('href', '/corridors');
  // What Corridra is not moved to its own navy section; it is not said twice.
  await expect(page.locator('#routes .tr-nots')).toHaveCount(0);

  const open = await page
    .locator('#faq details')
    .evaluateAll((d) => d.map((e) => (e as HTMLDetailsElement).open));
  expect(open).toEqual([false, false, true, true, false, true, false, true]);

  const limits = page.locator('#limits');
  await expect(limits.locator('.label')).toHaveText('Plain limits');
  await expect(limits.locator('.hv42-nots > li')).toHaveCount(8);
  expect(await limits.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
});

for (const width of [320, 1440] as const)
  test(`at ${width}px with text at 200 per cent: nothing scrolls sideways and no flag leaves its name`, async ({
    page,
  }) => {
    await mountHomeV42(page, { width, textSize: 200 });
    expect(await overflow(page)).toBe(0);
    for (const line of await page.locator('.hv42-line').all()) {
      expect(await line.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      for (const unit of await units(line)) {
        if (!unit.flag) continue;
        const one = await line
          .locator('.ux-flagged', { hasText: unit.text })
          .first()
          .evaluate((u) => {
            const [img, name] = [u.querySelector('img')!, u.lastElementChild!];
            const a = img.getBoundingClientRect();
            const b = name.getBoundingClientRect();
            return b.top < a.bottom && a.top < b.bottom;
          });
        expect(one, `${unit.text} stays beside its flag`).toBe(true);
      }
    }
  });

// The footer trim (owner, 25 Nov 2026: "current footer without redundancy", "Trim as shown").
const removed = async (footer: Locator) => {
  await expect(footer.locator('.guide-footer-promise')).toHaveCount(0);
  await expect(footer.getByRole('link', { name: 'Start a Request', exact: true })).toHaveCount(0);
  await expect(footer.locator('.guide-footer-trust, .ux-fact-label, .fact-label')).toHaveCount(0);
  await expect(footer.getByRole('link', { name: 'How We Label Facts', exact: true })).toHaveCount(
    0,
  );
  await expect(footer.locator('.guide-footer-routes')).toHaveCount(0);
  await expect(footer).not.toContainText('Every fact says where it comes from');
};
const kept = async (footer: Locator) => {
  await expect(footer.locator('.guide-footer-wordmark')).toHaveAttribute('href', '/');
  await expect(footer.locator('.guide-footer-copy')).toHaveText('© 2026 Corridra');
  await expect(footer.locator('.guide-footer-private')).toHaveText(
    'Your work stays private to the people given access',
  );
  // The link columns stay (folded on a phone in the compact footer, so found by address, not by visible name).
  await expect(footer.locator('a[href="/trust"]')).toHaveText('Trust and Evidence');
  await expect(footer.locator('a[href="/how-it-works"]')).toHaveCount(1);
};

test('footer trimmed, signed out: Sign In and "Already working with us?" stay; the repeats are gone', async ({
  page,
}) => {
  await mountHomeV42(page, { width: 1440 });
  const footer = page.locator('footer.guide-footer-trim');
  await removed(footer);
  await kept(footer);
  await expect(footer.getByRole('link', { name: 'Sign In', exact: true })).toHaveCount(1);
  await expect(footer).toContainText('Already working with us?');
});

test('footer trimmed, signed in: the workspace button and never Sign In', async ({ page }) => {
  await mountHomeV42(page, { width: 1440, signedIn: true });
  const footer = page.locator('footer.guide-footer-trim');
  await removed(footer);
  await kept(footer);
  await expect(footer.getByRole('link', { name: 'Sign In', exact: true })).toHaveCount(0);
});

test('footer trimmed with the access doors: the doors row stays and nothing else takes the actions place', async ({
  page,
}) => {
  await mountHomeV42(page, { width: 1440, doors: true });
  const footer = page.locator('footer.guide-footer-trim');
  await removed(footer);
  await kept(footer);
  await expect(footer.locator('section.guide-footer-access')).toHaveCount(1);
  await expect(footer.locator('.guide-footer-actions')).toHaveCount(0);
});

test('footer trimmed on /plan: the compact footer loses the folded trust legend too', async ({
  page,
}) => {
  await mountHomeV42(page, { width: 390, path: '/plan' });
  const footer = page.locator('footer.guide-footer-compact.guide-footer-trim');
  await expect(footer).toHaveCount(1);
  await expect(footer.locator('details.guide-footer-trust-fold')).toHaveCount(0);
  await removed(footer);
  await kept(footer);
});

test('footer trimmed at 390px fits the phone budget of the Option B footer (844 px)', async ({
  page,
}) => {
  await mountHomeV42(page, { width: 390 });
  const height = await page
    .locator('footer.guide-footer-trim')
    .evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(height).toBeLessThanOrEqual(844);
});
