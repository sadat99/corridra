import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixtureTenant, startP5cFixture } from './p5c-desk-fixture';
import { answerReads, type FactsWorld, type World } from './p5c-desk-world';
import {
  coreKeysV1,
  routePackSections,
  standardFieldByKey,
  standardFieldsV1,
} from '../../packages/domain/src/route-pack-standard';

// ADR-093 Phase 3, PR 1: the route pack editor, read only (docs/revamp/specs/route-pack-editor.md), measured with the real
// stylesheets in the desk fixture. The reads are answered by the fixture world from the standard, so no count is typed here:
// every number below is taken from the schema or from what the world was built to hold. Switch off, the Routes list is the
// markup it was (tests/operator/golden/p5c-settings-routes-module-off.golden, recorded from main before this work).
let fixture: Awaited<ReturnType<typeof startP5cFixture>>;
test.beforeAll(async () => {
  fixture = await startP5cFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

const core = coreKeysV1.length;
// What the world holds for Bangladesh to China: three Core fields Pending, one Core fact stale, so four things to do.
const pendingCore = 3;
const staleCore = 1;
const todo = pendingCore + staleCore;
const sectionCount = routePackSections.length;
// The world marks section 3 Not applicable on Bangladesh to the European Union: the Core facts of that section count as done.
const coveredCore = standardFieldsV1.filter(
  (field) => field.section === 3 && field.part === 'Content' && field.core,
).length;

type Options = {
  role?: string;
  width?: number;
  height?: number;
  facts?: FactsWorld | null;
  v41?: boolean;
  query?: string;
  hash?: string;
  /** Wait for the answer of the route facts list read, and one render after it, before the caller looks at the page. */
  awaitOverview?: boolean;
};
async function open(page: Page, options: Options = {}) {
  const { role = 'owner', width = 1440, height = 900, v41 = true, query = '', hash = '' } = options;
  await page.setViewportSize({ width, height });
  const given: Partial<World> = { role };
  if (options.facts !== null) given.facts = options.facts ?? {};
  const world = await answerReads(page, given);
  const words = new URLSearchParams({
    workspace: fixtureTenant,
    v41: v41 ? 'on' : 'off',
    role,
    reports: 'on',
    applications: 'on',
  });
  for (const [name, value] of new URLSearchParams(query)) words.set(name, value);
  const answered = options.awaitOverview
    ? page.waitForResponse(
        (response) =>
          response.url().includes('/api/team-control/route-pack-overview') &&
          !response.url().includes('routeId='),
      )
    : null;
  await page.goto(`${fixture.origin}/operator/settings?${words}${hash ? '#' + hash : ''}`);
  await answered;
  // One render after the answer, so what is compared is the page the answer made.
  if (answered)
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  await expect(page.getByLabel('Workspace status')).toBeAttached();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
  return world;
}
const golden = (name: string) =>
  readFileSync(resolve(`tests/operator/golden/${name}`), 'utf8').trim();
const markup = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((elements) =>
    elements
      .map((element) => element.outerHTML)
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/_r_[0-9a-z]+_/g, '_r_')
      .trim(),
  );
const routes = (page: Page) => page.locator('#workspace-settings .settings-routes');
const editor = (page: Page) => page.locator('section.route-editor');
const factsAsked = (world: World) =>
  world.asked.filter((line) => line.includes('/api/team-control/route-pack-'));
async function noSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}
async function noRepeatedLinks(page: Page) {
  const hrefs = await page
    .locator('main#main a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  const twice = hrefs.filter((href, index) => hrefs.indexOf(href) !== index);
  expect(twice, `addresses linked more than once: ${twice.join(', ')}`).toEqual([]);
}
async function axeClean(page: Page) {
  const result = await new AxeBuilder({ page }).include('main#main').analyze();
  expect(result.violations.map((violation) => violation.id)).toEqual([]);
}
const names = (page: Page) =>
  page.locator('#workspace-settings .settings-routes-list .settings-route-name');
const searchOf = (page: Page) => new URL(page.url()).searchParams;
const ready = (page: Page) => expect(routes(page).locator('a.settings-route-name')).toHaveCount(3);

test.describe('switch off: the page is the one main draws', () => {
  test('desk switch off: no request to the route fact reads, and the panel is the markup it was', async ({
    page,
  }) => {
    const world = await open(page, { v41: false, query: 'reports=off&applications=off' });
    await expect(page.locator('#workspace-settings .ux-settings-counts')).toBeVisible();
    expect(await markup(page, '.ux-panel:has(> .ux-subtabs #workspace-settings)')).toBe(
      golden('p5c-settings-off.golden'),
    );
    expect(factsAsked(world)).toEqual([]);
  });

  test('module off (the reads answer 404): the Routes block is the markup it was, and a route in the address is ignored', async ({
    page,
  }) => {
    const world = await open(page, {
      facts: null,
      query: 'route=BD-CN&view=sections',
      awaitOverview: true,
    });
    await expect(routes(page).locator('li')).toHaveCount(3);
    await expect(routes(page).locator('li').first().locator('.settings-route-pack')).toHaveText(
      'Active Pack version 2',
    );
    expect(await markup(page, '#workspace-settings .settings-routes')).toBe(
      golden('p5c-settings-routes-module-off.golden'),
    );
    await expect(page.locator('section.route-editor')).toHaveCount(0);
    await expect(routes(page).locator('a')).toHaveCount(0);
    // The one question was asked, answered 404 and shown as nothing.
    expect(factsAsked(world)).toEqual([
      `GET /api/team-control/route-pack-overview?tenant=${fixtureTenant}`,
    ]);
    expect(searchOf(page).get('route')).toBe('BD-CN');
  });

  test('module off with no route in the address: the same markup, no error text', async ({
    page,
  }) => {
    await open(page, { facts: null, awaitOverview: true });
    await expect(routes(page).locator('li')).toHaveCount(3);
    expect(await markup(page, '#workspace-settings .settings-routes')).toBe(
      golden('p5c-settings-routes-module-off.golden'),
    );
    await expect(routes(page).getByRole('alert')).toHaveCount(0);
  });
});

test.describe('Routes list', () => {
  test('each route says how many Core fields are done, how many are stale and whether it is live with gaps', async ({
    page,
  }) => {
    await open(page);
    await ready(page);
    const rows = routes(page).locator('li');
    // Words unchanged beside the new ones (D17).
    await expect(rows.nth(0).locator('.settings-route-pack')).toHaveText('Active Pack version 2');
    await expect(rows.nth(0).locator('.settings-route-facts')).toContainText(
      `Core ${core - pendingCore} of ${core} done`,
    );
    await expect(rows.nth(0).locator('.settings-route-facts')).toContainText(`${staleCore} stale`);
    await expect(rows.nth(0).locator('.settings-route-facts')).toContainText('Live with gaps');
    // Nothing is filled, but the section marked Not applicable covers the Core facts it holds.
    await expect(rows.nth(1).locator('.settings-route-facts')).toHaveText(
      `Core ${coveredCore} of ${core} done`,
    );
    await expect(rows.nth(1).locator('.settings-route-facts')).not.toContainText('stale');
    await expect(rows.nth(1).locator('.settings-route-facts')).not.toContainText('Live with gaps');
    await expect(rows.nth(2).locator('.settings-route-pack')).toHaveText('No pack yet');
    await expect(routes(page).locator('p').first()).toHaveText(
      'Facts describe a route. The pack decides what the team may do on it. Choose a route to read its facts.',
    );
    // The name is the link, named with the pack and the Core words.
    await expect(rows.nth(0).getByRole('link')).toHaveAccessibleName(
      `Bangladesh to China, pack Active, Core ${core - pendingCore} of ${core} done, ${staleCore} stale, Live with gaps`,
    );
    await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', /route=BD-CN/);
    await expect(names(page)).toHaveCount(3);
    await noRepeatedLinks(page);
    await axeClean(page);
  });

  test('a route with every Core field done says so', async ({ page }) => {
    await open(page, { facts: { complete: true } });
    await ready(page);
    await expect(routes(page).locator('li').nth(1).locator('.settings-route-facts')).toHaveText(
      'Core complete',
    );
  });

  test('Refresh Reviewed Configuration reads the route facts again', async ({ page }) => {
    const world = await open(page);
    await ready(page);
    const before = factsAsked(world).length;
    await page.getByRole('button', { name: 'Refresh Reviewed Configuration' }).click();
    await expect.poll(() => factsAsked(world).length).toBeGreaterThan(before);
    await expect(page.getByText('Routes returned')).toBeVisible();
  });
});

test.describe('the route view', () => {
  test('opening a route shows its header, To Do first, and moves focus to the route name', async ({
    page,
  }) => {
    await open(page);
    await ready(page);
    await routes(page)
      .getByRole('link', { name: /^Bangladesh to China/ })
      .click();
    await expect(
      editor(page).getByRole('heading', { level: 2, name: 'Bangladesh to China' }),
    ).toBeFocused();
    expect(searchOf(page).get('route')).toBe('BD-CN');
    expect(searchOf(page).get('workspace')).toBe(fixtureTenant);
    const header = editor(page);
    await expect(header).toContainText('Active');
    await expect(header).toContainText('Pack version 2');
    await expect(header).toContainText('Route facts version 5');
    await expect(header).toContainText(
      `Core fields: ${core - pendingCore} of ${core} done. ${pendingCore} still Pending.`,
    );
    await expect(header.getByRole('progressbar', { name: 'Core fields done' })).toBeVisible();
    await expect(header).toContainText('1 fact is stale. Check it before relying on it.');
    await expect(header).toContainText(
      `This route is Active, and ${pendingCore} Core fields are still Pending. It keeps working. Fill them when you can. This does not mean the route is cleared.`,
    );
    await expect(header).toContainText(
      'Readiness: complete for Supplier discovery on pack version 2.',
    );
    // PR 4 (spec 8.1 as amended, Guardian G72 ruling 2): the last pack change is the newest pack row of History, not a header line.
    await expect(
      header.locator('p.route-editor-quiet', { hasText: 'Pack version 2, proposed' }),
    ).toHaveCount(0);
    await header.locator('details.route-history > summary').click();
    await expect(
      header
        .locator('details.route-history li')
        .filter({ hasText: /^Pack version/ })
        .first(),
    ).toContainText('Pack version 2, proposed and published by you, effective 20 Nov 2026');
    await header.locator('details.route-history > summary').click();
    // PR 2b: the owner has Edit buttons, so the read only note is gone.
    await expect(header).not.toContainText('Route facts are shown read only here.');
    await expect(header).not.toContainText('Only the owner can change route facts and packs.');
    // The View choice, with counts from the data.
    const view = header
      .getByRole('radiogroup', { name: 'View' })
      .or(header.getByRole('group', { name: 'View' }));
    await expect(view.getByRole('radio', { name: `To Do ${todo}` })).toBeChecked();
    await expect(
      view.getByRole('radio', { name: `All Sections ${sectionCount}` }),
    ).not.toBeChecked();
    // To Do: the Pending Core fields and the stale Core fact, under their sections.
    const headings = header.getByRole('heading', { level: 3 });
    await expect(headings).toHaveText([
      `1. ${routePackSections[0]!.name}`,
      `12. ${routePackSections[11]!.name}`,
      `16. ${routePackSections[15]!.name}`,
    ]);
    await expect(header.locator('li.ux-fact-row')).toHaveCount(todo);
    await expect(header.locator('li.ux-fact-row').first()).toContainText(
      standardFieldByKey.get('identity.display_name')!.label,
    );
    await expect(header.locator('li.ux-fact-row').first()).toContainText('Stale since 31 Dec 2025');
    await expect(header.locator('li.ux-fact-row').nth(1)).toContainText('Not filled yet');
    // Optional fields are one counted line, not a list.
    await expect(header).toContainText(
      /\d+ optional fields are still Pending\. Open All Sections to see them\./,
    );
    await noRepeatedLinks(page);
    await noSidewaysScroll(page);
    await axeClean(page);
  });

  test('the admin reads the note once and sees no control that writes; the owner reads no note', async ({
    page,
  }) => {
    await open(page, { role: 'admin', query: 'route=BD-CN' });
    await expect(editor(page)).toBeVisible();
    await expect(
      editor(page).getByText(/Only the owner can change route facts and packs/),
    ).toHaveCount(1);
    await expect(editor(page)).toContainText(
      'Only the owner can change route facts and packs. You can read everything here.',
    );
    await expect(editor(page)).not.toContainText('shown read only here');
    // The only buttons are the ones that read: no Edit, Change, Status, Save or Publish. PR 4 (spec 12.1, 12.2 and 8.1 as
    // amended, Guardian G72): the admin also has More, which holds exactly Export This Route (a read), and at the list head
    // Import Route Data (a check that saves nothing for the admin) and Export Route Data.
    const buttons = await editor(page).getByRole('button').allTextContents();
    for (const text of buttons)
      expect(text).toMatch(
        /^(Show Full Value|Show Less|Show all \d+ fields|Show the first \d+ fields|More)$/,
      );
    await expect(page.getByRole('button', { name: /Edit|Change|Status|Save|Publish/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: /Import|Export/ })).toHaveText([
      'Import Route Data',
      'Export Route Data',
    ]);
    await editor(page)
      .getByRole('button', { name: /^More actions for / })
      .click();
    expect(await editor(page).getByRole('menuitem').allTextContents()).toEqual([
      'Export This Route',
    ]);
    await page.keyboard.press('Escape');
    await axeClean(page);
    // PR 2b: the owner reads no note at all (Edit, not a note, says what the owner can do), and still sees the same header.
    await open(page, { role: 'owner', query: 'route=BD-CN' });
    await expect(editor(page).locator('li.ux-fact-row').first()).toBeVisible();
    await expect(editor(page)).not.toContainText('shown read only here');
    await expect(editor(page)).not.toContainText('Only the owner can change route facts');
    await expect(
      editor(page)
        .getByRole('button', { name: /^Edit / })
        .first(),
    ).toBeVisible();
  });

  test('deep links open the state they name; choosing a segment clears the section; Back and Forward move through them', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=1' });
    const heading = editor(page).getByRole('heading', { level: 3 });
    await expect(heading.first()).toHaveText(`1. ${routePackSections[0]!.name}`);
    // The groups of the section, Core first.
    await expect(editor(page).getByRole('heading', { level: 4 })).toHaveText([
      'Core fields',
      'Optional fields',
    ]);
    const view = editor(page).getByRole('group', { name: 'View' });
    await expect(view.getByRole('radio', { name: /^To Do/ })).not.toBeChecked();
    await expect(view.getByRole('radio', { name: /^All Sections/ })).not.toBeChecked();
    await view.getByRole('radio', { name: /^All Sections/ }).click();
    await expect(
      editor(page)
        .getByRole('list')
        .filter({ has: page.getByRole('link') })
        .first(),
    ).toBeVisible();
    expect(searchOf(page).get('view')).toBe('sections');
    expect(searchOf(page).has('section')).toBe(false);
    // All Sections: one link for each section of the standard, with its state in words.
    const links = editor(page).locator('.route-editor-sections a');
    await expect(links).toHaveCount(sectionCount);
    await expect(links.first()).toContainText(`1. ${routePackSections[0]!.name}`);
    await expect(links.first()).toContainText('Filled');
    await expect(links.nth(11)).toContainText('2 Core pending');
    await noRepeatedLinks(page);
    await axeClean(page);
    // A section link opens that section and moves focus to its heading.
    await links.nth(4).click();
    await expect(editor(page).getByRole('heading', { level: 3 })).toBeFocused();
    expect(searchOf(page).get('section')).toBe('5');
    // Back returns to All Sections, Forward to the section.
    await page.goBack();
    await expect(editor(page).locator('.route-editor-sections a')).toHaveCount(sectionCount);
    await page.goForward();
    await expect(editor(page).getByRole('heading', { level: 3 })).toHaveText(
      `5. ${routePackSections[4]!.name}`,
    );
    // The same state by address alone.
    await page.goto(page.url());
    await expect(editor(page).getByRole('heading', { level: 3 })).toHaveText(
      `5. ${routePackSections[4]!.name}`,
    );
  });

  test('a section shows its values as stored: money exact, a long list folded, a reason for Not applicable, mixed scripts', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=5' });
    const rows = editor(page).locator('li.ux-fact-row');
    const fairs = rows.filter({ hasText: standardFieldByKey.get('events.trade_fairs')!.label });
    await expect(fairs).toContainText('Fair one');
    await expect(fairs).not.toContainText('Fair five');
    await fairs.getByRole('button', { name: 'Show Full Value' }).click();
    await expect(fairs).toContainText('Fair five');
    await expect(fairs.getByRole('button', { name: 'Show Less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(fairs).toContainText('example.org');
    await expect(fairs).toContainText('Valid until 31 Dec 2027');
    // The host is words, not a link out.
    await expect(editor(page).locator('a[href^="http"]')).toHaveCount(0);
    await expect(
      rows.filter({ hasText: standardFieldByKey.get('events.other_events')!.label }),
    ).toContainText('Not applicable: No other events on this route');
    await expect(
      rows
        .filter({ hasText: standardFieldByKey.get('events.other_events')!.label })
        .locator('.ux-fact-quiet:visible'),
    ).toHaveCount(0);
    await expect(
      editor(page).getByRole('heading', { level: 4, name: 'Your own fields' }),
    ).toBeVisible();
    await expect(rows.filter({ hasText: 'Typical stand cost' })).toContainText('USD 45.00');
    await axeClean(page);
    await open(page, { query: 'route=BD-CN&section=1' });
    await expect(
      editor(page).getByText('孟加拉国到中国：样品供应商路线 مسار تجريبي'),
    ).toBeVisible();
    await open(page, { query: 'route=BD-CN&section=17' });
    const long = editor(page).locator('li.ux-fact-row').filter({ hasText: 'LongLong' });
    await expect(long.getByRole('button', { name: 'Show Full Value' })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test('All Sections and To Do on a route that is done: nothing to do is said in words', async ({
    page,
  }) => {
    await open(page, { facts: { complete: true }, query: 'route=BD-EU' });
    // Nothing Pending or stale, so All Sections opens first.
    const view = editor(page).getByRole('group', { name: 'View' });
    await expect(view.getByRole('radio', { name: /^All Sections/ })).toBeChecked();
    await expect(editor(page).locator('.route-editor-sections a')).toHaveCount(sectionCount);
    await expect(editor(page)).toContainText(`Core fields: ${core} of ${core} done.`);
    await view.getByRole('radio', { name: /^To Do/ }).click();
    await expect(editor(page)).toContainText('Every Core field is done and nothing is stale.');
    await expect(editor(page)).not.toContainText('Live with gaps');
    await axeClean(page);
  });

  test('a section marked Not applicable that still holds a Core pack setting says which', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-EU&section=3' });
    await expect(editor(page)).toContainText(
      /This section is marked Not applicable, but .+ Core and still Pending\./,
    );
    await expect(editor(page)).toContainText('Testing');
    await expect(editor(page).locator('li.ux-fact-row').first()).toContainText('Pack setting');
    await axeClean(page);
  });

  test('a route with no facts says so, and every Core field shows Pending', async ({ page }) => {
    await open(page, { query: 'route=TW-AU' });
    await expect(editor(page)).toContainText('No pack yet');
    await expect(editor(page)).toContainText('No facts saved yet');
    await expect(editor(page)).toContainText('Nothing is recorded for this route yet.');
    await expect(editor(page)).toContainText(
      `Core fields: 0 of ${core} done. ${core} still Pending.`,
    );
    await expect(editor(page).locator('li.ux-fact-row').first()).toBeVisible();
    // Eight rows, then the rest behind one button counted from the data.
    await expect(
      editor(page).getByRole('button', { name: `Show all ${core} fields` }),
    ).toBeVisible();
    await expect(editor(page).locator('li.ux-fact-row:visible')).toHaveCount(8);
    await expect(editor(page)).not.toContainText('Readiness:');
    await axeClean(page);
  });

  test('an address that names nothing real is handled in words and never by an error', async ({
    page,
  }) => {
    await open(page, { query: 'route=XX-YY' });
    await ready(page);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'That route was not found. Choose one from the list.' }),
    ).toBeVisible();
    expect(searchOf(page).has('route')).toBe(false);
    await expect(editor(page)).toHaveCount(0);
    await open(page, { query: 'route=BD-CN&section=99' });
    await expect(
      page.getByRole('status').filter({ hasText: 'That section was not found.' }),
    ).toBeVisible();
    await expect(editor(page).locator('.route-editor-sections a')).toHaveCount(sectionCount);
    await open(page, { query: 'route=BD-CN&view=everything' });
    await expect(
      editor(page)
        .getByRole('group', { name: 'View' })
        .getByRole('radio', { name: /^To Do/ }),
    ).toBeChecked();
    // The old link still lands on the Routes list.
    await open(page, { hash: 'workspace-settings' });
    await expect(routes(page).getByRole('heading', { level: 2, name: 'Routes' })).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
  });
});

test.describe('states', () => {
  test('loading: one status line while the route is read, and no layout of rows yet', async ({
    page,
  }) => {
    await open(page, { facts: { delayDetail: 600 }, query: 'route=BD-CN' });
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading route facts…' }),
    ).toBeVisible();
    await expect(
      editor(page).getByRole('heading', { level: 2, name: 'Bangladesh to China' }),
    ).toBeVisible();
    await expect(editor(page).locator('li.ux-fact-row')).toHaveCount(0);
    await axeClean(page);
    await expect(editor(page).locator('li.ux-fact-row').first()).toBeVisible();
    await expect(page.getByText('Loading route facts…')).toHaveCount(0);
  });

  test('error: the list read failing says so with Try Again, rows stay plain text, and Try Again recovers', async ({
    page,
  }) => {
    const world = await open(page, { facts: { overview: 500 } });
    await expect(routes(page).getByRole('alert')).toHaveText(
      'Route facts are unavailable. Try again.',
    );
    await expect(routes(page).locator('li')).toHaveCount(3);
    await expect(routes(page).locator('a')).toHaveCount(0);
    await axeClean(page);
    world.facts!.overview = 200;
    await routes(page).getByRole('button', { name: 'Try Again' }).click();
    await ready(page);
    await expect(routes(page).getByRole('alert')).toHaveCount(0);
  });

  test('error: a failed route read says so with Try Again and Try Again recovers; a failed pack history leaves one quiet line', async ({
    page,
  }) => {
    await open(page, { facts: { failDetail: 1, packHistory: 500 }, query: 'route=BD-CN' });
    await expect(editor(page).getByRole('alert')).toHaveText(
      'Route facts are unavailable. Try again.',
    );
    await axeClean(page);
    await editor(page).getByRole('button', { name: 'Try Again' }).click();
    await expect(editor(page).locator('li.ux-fact-row').first()).toBeVisible();
    // PR 4: a failed pack history is one quiet line inside History (it was the header's last pack change line).
    await editor(page).locator('details.route-history > summary').click();
    await expect(editor(page).locator('details.route-history')).toContainText(
      'Pack history is not available.',
    );
    await expect(editor(page)).toContainText('Readiness: complete for Supplier discovery');
    await expect(editor(page).getByRole('alert')).toHaveCount(0);
  });

  test('a 404 on the route read is never an error: the list is asked again and, answering 404 too, the page falls back to the plain list', async ({
    page,
  }) => {
    const world = await open(page, {
      facts: { delayDetail: 600, detail: 404 },
      query: 'route=BD-CN',
    });
    await expect(editor(page).getByRole('heading', { level: 2 })).toBeVisible();
    // The switch goes off between the list and the route read.
    world.facts!.overview = 404;
    await expect(editor(page)).toHaveCount(0);
    await expect(routes(page).locator('li')).toHaveCount(3);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Route facts are unavailable. Try again.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
    expect(await markup(page, '#workspace-settings .settings-routes')).toBe(
      golden('p5c-settings-routes-module-off.golden'),
    );
  });

  test('a 404 on the route read while the list still answers shows no error either', async ({
    page,
  }) => {
    await open(page, { facts: { detail: 404 }, query: 'route=BD-CN' });
    await expect(editor(page).getByRole('heading', { level: 2 })).toBeVisible();
    await expect(editor(page).locator('li.ux-fact-row')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
  });

  test('a pack that did not go through review says so, with its effective date', async ({
    page,
  }) => {
    await open(page, { facts: { unreviewedPack: true }, query: 'route=BD-CN' });
    // PR 4: the newest pack row of History carries what the header line said.
    await editor(page).locator('details.route-history > summary').click();
    await expect(editor(page).locator('details.route-history')).toContainText(
      'Pack version 2, effective 20 Nov 2026. This change did not go through review, so no proposer is recorded.',
    );
  });

  test('denied: a role without access to route facts is told so and sees no link or row', async ({
    page,
  }) => {
    await open(page, { facts: { overview: 403 } });
    await expect(routes(page)).toContainText('You do not have access to route facts.');
    await expect(routes(page).locator('a')).toHaveCount(0);
    await open(page, { facts: { detail: 403 }, query: 'route=BD-CN' });
    await expect(editor(page)).toContainText('You do not have access to route facts.');
    await expect(editor(page).locator('li.ux-fact-row')).toHaveCount(0);
    await axeClean(page);
  });
});

test.describe('widths', () => {
  const widths = [320, 390, 768, 1024, 1440, 1920];
  for (const width of widths) {
    test(`at ${width}: no sideways scroll, axe clean, the list folds or stands beside by the region width`, async ({
      page,
    }) => {
      await open(page, { width, query: 'route=BD-CN' });
      await expect(editor(page).locator('li.ux-fact-row').first()).toBeVisible();
      await noSidewaysScroll(page);
      await axeClean(page);
      const shell = page.locator('.settings-routes-shell');
      const regionWidth = await shell.evaluate((element) => element.getBoundingClientRect().width);
      const rem = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).fontSize),
      );
      test.info().annotations.push({
        type: 'region',
        description: `${width}: ${Math.round(regionWidth)} px`,
      });
      const wide = regionWidth >= 56 * rem;
      await expect(shell).toHaveAttribute('data-wide', wide ? 'true' : 'false');
      const fold = page.locator('.settings-routes-fold');
      if (wide) {
        await expect(fold.locator('> summary')).toBeHidden();
        await expect(routes(page).locator('li').first()).toBeVisible();
        const [list, body] = await Promise.all([
          routes(page).boundingBox(),
          editor(page).boundingBox(),
        ]);
        expect(body!.x).toBeGreaterThan(list!.x + list!.width - 1);
      } else {
        await expect(fold.locator('> summary')).toHaveText('Routes: Bangladesh to China');
        await expect(fold).not.toHaveAttribute('open', '');
        expect((await fold.locator('> summary').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await fold.locator('> summary').click();
        await expect(routes(page).locator('li').first()).toBeVisible();
      }
      await expect(routes(page).locator('a.settings-route-name[aria-current="true"]')).toHaveCount(
        wide || (await fold.getAttribute('open')) !== null ? 1 : 0,
      );
      // The route region (header, View and the first rows) stays inside its length.
      const height = (await editor(page).boundingBox())!.height;
      test.info().annotations.push({
        type: 'editor-height',
        description: `${width}: ${Math.round(height)} px`,
      });
      // Side by side (a region of 56 rem) 900 px, stacked 1688 px.
      expect(height).toBeLessThanOrEqual(wide ? 900 : 1688);
      await noRepeatedLinks(page);
    });
  }

  test('the facts add at most one line to a row of the list', async ({ page }) => {
    for (const width of widths) {
      const main = await open(page, { width, facts: null });
      await expect(routes(page).locator('li')).toHaveCount(3);
      const before = await routes(page)
        .locator('li')
        .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
      void main;
      await open(page, { width });
      await ready(page);
      const rows = routes(page).locator('li');
      const after = await rows.evaluateAll((items) =>
        items.map((row) => row.getBoundingClientRect().height),
      );
      test.info().annotations.push({
        type: 'row-height',
        description: `${width}: ${before.map(Math.round)} -> ${after.map(Math.round)}`,
      });
      // Measured on this fixture: from 640 px a row grows by 38 to 43 px (the facts line, its gap and the row padding); on a phone by
      // 21 to 69 px, the most for the live route with stale facts, whose three facts wrap onto two lines.
      const limit = width < 640 ? 70 : 44;
      after.forEach((height, index) => expect(height - before[index]!).toBeLessThanOrEqual(limit));
    }
  });
});
