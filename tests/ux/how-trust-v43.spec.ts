import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mountDeep } from './how-trust-v43-fixture';

// /how-it-works, /trust and the summarised home with CORRIDRA_UX_HOW_TRUST_V43 on (owner, 26 Nov 2026, first hand to
// Guardian G66: "yes to all three, build it"). The real compositions and the real pack footer on the live home's styles
// (tests/ux/how-trust-v43-fixture.ts), so CI keeps one build with the switch off. What the layout decides (server
// HTML, header and footer, the links from the home) is read on a real switch-on build in how-trust-v43-server.spec.ts,
// and "the switch off is what it was" in tests/integration/how-trust-v43.test.ts and home-v43-off.spec.ts. The deep
// pages show everything, so they are longer than the public page budget: the owner's exception is recorded in
// docs/revamp/specs/layout-budget.md and covers these two pages with the switch on only.
const widths = [320, 390, 768, 1440] as const;

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const headingLevels = (page: Page) =>
  page
    .locator('main :is(h1, h2, h3, h4)')
    .evaluateAll((all) => all.map((h) => Number(h.tagName[1])));
/** Every heading step goes down by one at most, and the page opens with its one h1. */
const orderly = (levels: number[]) =>
  levels[0] === 1 &&
  levels.filter((level) => level === 1).length === 1 &&
  levels.every((level, i) => i === 0 || level <= levels[i - 1]! + 1);
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

async function shared(page: Page, width: number) {
  expect(await overflow(page), `no sideways scroll at ${width}`).toBe(0);
  expect(await page.locator('main h1').count(), 'one h1').toBe(1);
  expect(orderly(await headingLevels(page)), 'headings in order').toBe(true);
  // One Start a Request on the page, and it is the closing band's (the header's is site chrome outside main).
  const starts = page.locator('main a', { hasText: 'Start a Request' });
  await expect(starts).toHaveCount(1);
  await expect(starts).toHaveAttribute('href', '/plan');
  await expect(page.locator('#start-request a')).toHaveCount(1);
  await expect(page.locator('main details.guide-more, main summary:text("Show More")')).toHaveCount(
    0,
  );
  await expect(page.locator('main [role="tablist"], main [role="tab"]')).toHaveCount(0);
  // Landmarks: one main, the page's own navigation is labelled.
  await expect(page.locator('nav[aria-label="On this page"]')).toHaveCount(1);
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveCount(1);
  // The actions of this page are Title Case, and the controls the page adds are at least 44 px tall.
  for (const action of await page
    .locator('main .primary-link, main .text-link, main .htv43-toc a')
    .all())
    expect(isTitleCase(await action.innerText()), await action.innerText()).toBe(true);
  for (const control of await page
    .locator('main .htv43-toc a, main .htv43-actions a, main .htv43-faq summary, #start-request a')
    .all()) {
    const box = (await control.boundingBox())!;
    expect(box.height, await control.innerText()).toBeGreaterThanOrEqual(43.5);
  }
  const found = (await new AxeBuilder({ page }).include('main').include('footer').analyze())
    .violations;
  expect(found.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

for (const width of widths) {
  test(`/how-it-works at ${width}px: the whole process, one Start a Request, no sideways scroll, axe clean`, async ({
    page,
  }) => {
    await mountDeep(page, 'how-it-works', { width });
    await shared(page, width);
    // Both phases are visible as two cards; there is no tab control.
    const phases = page.locator('#page-approach .htv43-phase');
    await expect(phases).toHaveCount(2);
    await expect(phases.nth(0).getByRole('heading', { level: 3 })).toHaveText('Before You Meet');
    await expect(phases.nth(1).getByRole('heading', { level: 3 })).toHaveText('Meet and Follow Up');
    for (const phase of await phases.all())
      await expect(phase.locator('.htv43-step')).toHaveCount(3);
    await expect(phases.nth(0).locator('.htv43-step-line').nth(0)).toHaveText(
      'Step 1 of 6: Define · Next: Find',
    );
    await expect(phases.nth(1).locator('.htv43-step-line').nth(2)).toHaveText(
      'Step 6 of 6: Follow through',
    );
    // The four stages by route, as four static cards of four stages.
    const routes = page.locator('#process .htv43-card');
    await expect(routes).toHaveCount(4);
    for (const card of await routes.all())
      await expect(card.locator('.htv43-stage')).toHaveCount(4);
    await expect(routes.nth(0).locator('h3 img[data-flag]')).toBeVisible();
    // The fourteen stages: six optional ones named, and the four rules.
    await expect(page.locator('#how .hv42-step-name')).toHaveCount(14);
    await expect(page.locator('#how li.is-optional')).toHaveCount(6);
    await expect(
      page.locator('#how ~ .hv42-rules > div, .htv43-how .hv42-rules > div'),
    ).toHaveCount(4);
    // Eight roles with what they give and get, and the place mark in the Bangladesh role.
    const roles = page.locator('#who .htv43-card');
    await expect(roles).toHaveCount(8);
    for (const role of await roles.all()) await expect(role.locator('.htv43-kv')).toHaveCount(2);
    await expect(roles.nth(3).locator('h3 img[data-flag]')).toBeVisible();
    // Four process questions, closed; the two the trust page holds are not here.
    const questions = page.locator('#faq details');
    await expect(questions).toHaveCount(4);
    await expect(page.locator('#faq details[open]')).toHaveCount(0);
    await expect(page.locator('#faq summary')).toHaveText([
      'What happens after I send a request?',
      'What does it cost?',
      'Will you replace my agent, my chamber or my fair?',
      'Do you work with chambers and trade bodies?',
    ]);
    // Nothing the home already shows: no start section, no goal links, no route statuses, no Plain Limits.
    for (const id of ['start', 'routes', 'limits', 'brief', 'home-start'])
      await expect(page.locator(`#${id}`)).toHaveCount(0);
  });

  test(`/trust at ${width}px: the whole proof, one Start a Request, no sideways scroll, axe clean`, async ({
    page,
  }) => {
    await mountDeep(page, 'trust', { width });
    await shared(page, width);
    await expect(page.locator('#page-approach .htv43-label-card')).toHaveCount(5);
    await expect(page.locator('#trust .hv43-labels li')).toHaveCount(5);
    // The ledger keeps the correction as a new entry, the original quote visible as revision 1.
    const ledger = page.locator('#trust .hv43-ledger');
    await expect(ledger.locator('.htv43-ledger-row')).toHaveCount(3);
    await expect(ledger).toContainText('USD 36,800');
    await expect(ledger).toContainText('Revision 2 records USD 37,400');
    await expect(ledger).toContainText('The original quote remains visible as revision 1.');
    await expect(ledger).toContainText('Sample data');
    await expect(ledger).toContainText('New entry');
    await expect(page.locator('#outcomes .htv43-outcomes li')).toHaveCount(11);
    await expect(page.locator('#routes .tr-routes > div')).toHaveCount(4);
    await expect(page.locator('#routes .tr-routes img[data-flag]').first()).toBeVisible();
    await expect(page.locator('#routes .tr-ready-chip')).toHaveCount(6);
    await expect(page.locator('#limits .hv42-nots li')).toHaveCount(8);
    await expect(page.locator('#faq summary')).toHaveText([
      'Is my data safe?',
      'Who is Corridra?',
      'Which markets do you work in?',
      'Do you arrange visas or hotels?',
    ]);
    await expect(page.locator('#faq details[open]')).toHaveCount(0);
    // The statements of the live page that the home shows are not here again.
    for (const id of ['start', 'who', 'how', 'process', 'brief'])
      await expect(page.locator(`#${id}`)).toHaveCount(0);
  });
}

test('/how-it-works and /trust at 320px with the text at 200% do not scroll sideways', async ({
  page,
}) => {
  for (const kind of ['how-it-works', 'trust'] as const) {
    await mountDeep(page, kind, { width: 320, textSize: 200 });
    expect(await overflow(page), kind).toBe(0);
  }
});

test('a link in "On this page" goes to its section, and every one of them has a target', async ({
  page,
}) => {
  for (const kind of ['how-it-works', 'trust'] as const) {
    await mountDeep(page, kind, { width: 1440 });
    const links = page.locator('.htv43-toc a');
    const hrefs = await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')!));
    expect(hrefs.length).toBeGreaterThanOrEqual(6);
    for (const href of hrefs) await expect(page.locator(href), `${kind} ${href}`).toHaveCount(1);
    // The hero's own action is one of them.
    await expect(page.locator('.htv43-actions a')).toHaveAttribute(
      'href',
      hrefs.includes('#how') ? '#how' : '#trust',
    );
  }
});

test('the deep pages link to each other once, and the footer pack follows them', async ({
  page,
}) => {
  await mountDeep(page, 'how-it-works', { width: 1440 });
  await expect(page.locator('#page-next a[href="/trust"]')).toHaveCount(1);
  await expect(page.locator('main a[href="/trust"]')).toHaveCount(1);
  await mountDeep(page, 'trust', { width: 1440 });
  await expect(page.locator('#page-next a[href="/how-it-works"]')).toHaveCount(1);
  await expect(page.locator('main a[href="/how-it-works"]')).toHaveCount(1);
  await expect(page.locator('main a[href="/corridors"]')).toHaveCount(1);
});

for (const width of [390, 1440] as const) {
  test(`the home at ${width}px keeps two summaries of three lines, each linking to its page`, async ({
    page,
  }) => {
    await mountDeep(page, 'home', { width });
    expect(await overflow(page), 'no sideways scroll').toBe(0);
    const process = page.locator('section#process');
    const trust = page.locator('section#trust');
    for (const [band, href, action] of [
      [process, '/how-it-works', 'See the Full Process'],
      [trust, '/trust', "Read Corridra's Trust Principles"],
    ] as const) {
      await expect(band.locator('.htv43-lines li')).toHaveCount(3);
      await expect(band.locator('a')).toHaveCount(1);
      await expect(band.locator('a')).toHaveAttribute('href', href);
      await expect(band.locator('a')).toHaveText(action);
      const box = (await band.locator('a').boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
    await expect(process.locator('.htv43-lines li').nth(0)).toHaveText(
      'Agree the scope with the team.',
    );
    await expect(process.locator('.htv43-lines li').nth(2)).toHaveText(
      'How a request moves from your first goal to a recorded result, in six steps.',
    );
    await expect(trust.locator('.htv43-lines li').nth(2)).toHaveText(
      'Corrections sit alongside the original record.',
    );
    // What the deep pages carry has left the home: stage explorer, role picker, ledger, long answers and Plain Limits.
    for (const gone of [
      '#people',
      '#who',
      '#limits',
      '.hv43-stages',
      '.hv43-ledger',
      '.hv43-labels',
      '.hv43-correction',
      '#questions details.hv43-more',
    ])
      await expect(page.locator(gone), gone).toHaveCount(0);
    // What stays: the eight short answers, the route choice, the markets and the request form.
    await expect(page.locator('#questions .hv43-faq-list > details')).toHaveCount(8);
    for (const id of ['start', 'markets', 'inbound', 'brief'])
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    const found = (await new AxeBuilder({ page }).include('main').analyze()).violations;
    expect(found.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
