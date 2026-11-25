import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startPagePatternFixture } from './d4-page-pattern-fixture';

// Team desk v4.1, unit D4: the one page pattern behind CORRIDRA_UX_TEAM_DESK_V41, measured with the real
// stylesheets. Off, the header is the one the desk has today (label above the title, second row of links, jump
// links). On: serif title, one purpose line, segments under the title as links to the same addresses, no label
// above the title, no jump links, and a page that opens at the top.
let fixture: Awaited<ReturnType<typeof startPagePatternFixture>>;
test.beforeAll(async () => {
  fixture = await startPagePatternFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

type Options = {
  v41: boolean;
  role?: string;
  real?: boolean;
  width?: number;
  height?: number;
  /** The server turned this person away from a section address (operator-entry.tsx adds `unavailable=1`). */
  turned?: boolean;
};
async function open(page: Page, path: string, options: Options) {
  const { v41, role = 'owner', real = false, width = 1440, height = 900, turned = false } = options;
  await page.setViewportSize({ width, height });
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: true } }),
  );
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      json: {
        purpose: real ? 'commercial_qualification' : 'synthetic_validation',
        uploadsConfigured: false,
        scanMode: 'bypass',
        role,
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.goto(
    `${fixture.origin}${path}?v41=${v41 ? 'on' : 'off'}&role=${role}${turned ? '&unavailable=1' : ''}`,
  );
  await expect(page.getByLabel('Workspace status')).toBeAttached();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
}
const heading = (page: Page) => page.locator('main#main > header.ux-page-heading');
const segments = (page: Page) => page.locator('main#main nav.ux-desk-segments');

test('switch off: the header is the one the desk has today', async ({ page }) => {
  await open(page, '/operator/research', { v41: false });
  await expect(heading(page).locator('p.label')).toHaveText('TEAM WORKSPACE');
  await expect(heading(page).locator('h1')).toHaveText('Companies');
  await expect(heading(page).locator('.ux-frame-helper')).toHaveCount(0);
  await expect(segments(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'In this section' })).toBeVisible();
  await expect(page.locator('main#main')).not.toHaveClass(/ux-desk-frame/);
  const family = await heading(page)
    .locator('h1')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  // The title is already set in the heading serif; the pattern keeps it.
  expect(family).toContain('newsreader');
  // The section still takes the focus on arrival, as before.
  await expect(page.locator('#workspace-research')).toBeFocused();
  await open(page, '/operator/sources', { v41: false });
  await expect(page.locator('.ux-panel-heading .eyebrow')).toHaveText('Workspace tools');
});

test('switch off: the label above a panel heading and the jump links stay', async ({ page }) => {
  await open(page, '/operator/missions', { v41: false });
  await expect(page.getByText('OPS HOME', { exact: true })).toBeVisible();
  await expect(page.locator('nav.ux-operator-workbench')).toHaveCount(1);
  await expect(page.getByText('JUMP TO', { exact: true })).toBeVisible();
  await open(page, '/operator/network', { v41: false });
  await expect(page.getByText('CORRIDRA NETWORK', { exact: true })).toBeVisible();
});

test('switch on: serif title, one purpose line, segments under the title, no label above it', async ({
  page,
}) => {
  await open(page, '/operator/research', { v41: true });
  const head = heading(page);
  await expect(head.locator('p.label')).toHaveCount(0);
  await expect(page.getByText('TEAM WORKSPACE', { exact: true })).toHaveCount(0);
  await expect(head.locator('h1')).toHaveText('Companies');
  await expect(page.locator('h1')).toHaveCount(1);
  const family = await head.locator('h1').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain('newsreader');
  await expect(head.locator('.ux-frame-helper')).toHaveCount(1);
  await expect(head.locator('.ux-frame-helper')).toHaveText(
    'The companies your team has researched for its missions.',
  );
  // The purpose line sits under the title, not beside it.
  const [titleBox, lineBox] = await Promise.all([
    head.locator('h1').boundingBox(),
    head.locator('.ux-frame-helper').boundingBox(),
  ]);
  expect(lineBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height - 1);
  expect(Math.abs(lineBox!.x - titleBox!.x)).toBeLessThanOrEqual(1);
  // At most one primary action in the header; D4 adds none.
  expect(await head.locator('.ux-frame-primary > *').count()).toBeLessThanOrEqual(1);
  // The segments sit right under the header. Hiding the old second row of links with the switch on is unit D3's
  // (inside team-second-level.tsx), so it is not asserted here.
  const nav = page.getByRole('navigation', { name: 'Companies pages' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveText([
    'Companies',
    'Sources and claims',
    'Evidence review',
  ]);
  await expect(nav.locator('a[aria-current="page"]')).toHaveText('Companies');
  expect(
    await nav.getByRole('link').evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
  ).toEqual([
    `/operator/research?workspace=00000000-0000-4000-8000-0000000000a1`,
    `/operator/sources?workspace=00000000-0000-4000-8000-0000000000a1`,
    `/operator/evidence?workspace=00000000-0000-4000-8000-0000000000a1`,
  ]);
  const order = await page.evaluate(() => {
    const header = document.querySelector('main#main > header.ux-page-heading')!;
    const row = document.querySelector('main#main nav.ux-desk-segments')!;
    const next = header.nextElementSibling!;
    return next === row || (next.matches('nav.ux-team-second') && next.nextElementSibling === row);
  });
  expect(order).toBe(true);
});

test('switch on: a segment opens the existing address and the page opens at the top', async ({
  page,
}) => {
  await open(page, '/operator/research', { v41: true, height: 500 });
  await segments(page).getByRole('link', { name: 'Sources and claims' }).click();
  await expect(page).toHaveURL(/\/operator\/sources\?workspace=/);
  await expect(heading(page).locator('h1')).toHaveText('Companies');
  await expect(segments(page).locator('a[aria-current="page"]')).toHaveText('Sources and claims');
  await expect(heading(page).locator('.ux-frame-helper')).toHaveText(
    'Where information came from, what it claims and which facts are verified.',
  );
  await expect(page.locator('#workspace-sources')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('#workspace-sources')).not.toBeFocused();
  // No label above the panel heading either.
  await expect(page.getByRole('heading', { name: 'Sources and claims' })).toBeVisible();
  await expect(page.locator('.ux-panel-heading .eyebrow')).toHaveCount(0);
});

test('switch on: an old # link still lands on its section', async ({ page }) => {
  await open(page, '/operator', { v41: true, height: 500 });
  await page.evaluate(() => {
    window.scrollTo({ top: 200, behavior: 'instant' });
    window.location.hash = 'workspace-evidence';
  });
  // The page it names opens at the top with nothing focused for the person, so no box is drawn round the page
  // body (audit staff-core-07). The same as opening the page by its own address.
  await expect(page.locator('#workspace-evidence')).toBeVisible();
  await expect(page.locator('#workspace-evidence')).not.toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
  await expect(segments(page).locator('a[aria-current="page"]')).toHaveText('Evidence review');
  // The title and the purpose line follow the same address as the segments.
  await expect(heading(page).locator('h1')).toHaveText('Companies');
  await expect(heading(page).locator('.ux-frame-helper')).toHaveText(
    'Files to review before they count as evidence.',
  );
  await open(page, '/operator/settings', { v41: true });
  await page.evaluate(() => {
    window.location.hash = 'workspace-audit';
  });
  await expect(heading(page).locator('h1')).toHaveText('Team and access');
  await expect(heading(page).locator('.ux-frame-helper')).toHaveText(
    'What changed in this workspace, who changed it and when.',
  );
  await expect(segments(page).locator('a[aria-current="page"]')).toHaveText('Audit');
  await page.evaluate(() => {
    window.location.hash = 'workspace-missions';
  });
  await expect(heading(page).locator('h1')).toHaveText('Missions');
  await expect(heading(page).locator('.ux-frame-helper')).toHaveText(
    'Every customer request with its owner and its next step.',
  );
  await expect(segments(page)).toHaveCount(0);
});

test('switch on: no label above a panel heading and no jump links', async ({ page }) => {
  await open(page, '/operator/missions', { v41: true });
  await expect(heading(page).locator('h1')).toHaveText('Missions');
  await expect(page.getByRole('heading', { name: 'Mission review queue' })).toBeVisible();
  await expect(page.getByText('OPS HOME', { exact: true })).toHaveCount(0);
  await expect(page.locator('nav.ux-operator-workbench')).toHaveCount(0);
  await expect(page.getByText('JUMP TO', { exact: true })).toHaveCount(0);
  await expect(segments(page)).toHaveCount(0);
  await open(page, '/operator/network', { v41: true });
  await expect(heading(page).locator('h1')).toHaveText('Helpers');
  await expect(page.getByRole('heading', { name: 'Assigned work' })).toBeVisible();
  await expect(page.getByText('CORRIDRA NETWORK', { exact: true })).toHaveCount(0);
});

test('switch on: the segments follow the role', async ({ page }) => {
  // Health and Readiness are for owner and admin only (owner ruling, 25 Nov 2026): an operator's Status has two pages.
  await open(page, '/operator/health', { v41: true, role: 'admin' });
  await expect(heading(page).locator('h1')).toHaveText('Status');
  await expect(page.getByRole('navigation', { name: 'Status pages' }).getByRole('link')).toHaveText(
    ['Operations', 'Dashboard', 'Health', 'Readiness'],
  );
  await open(page, '/operator/operations', { v41: true, role: 'operator' });
  await expect(heading(page).locator('h1')).toHaveText('Status');
  await expect(page.getByRole('navigation', { name: 'Status pages' }).getByRole('link')).toHaveText(
    ['Operations', 'Dashboard'],
  );
  await open(page, '/operator/settings', { v41: true, role: 'admin' });
  await expect(
    page.getByRole('navigation', { name: 'Settings pages' }).getByRole('link'),
  ).toHaveText(['Routes and settings', 'Assistance', 'Control Center', 'Owner page']);
  // The Settings page has no tab called "Settings" (audit staff-admin-08): the title already says it.
  await expect(
    page.getByRole('navigation', { name: 'Settings pages' }).getByRole('link', {
      name: 'Settings',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Settings pages' }).getByRole('link', {
      name: 'Owner page',
    }),
  ).toHaveAttribute('href', '/operator/owner');
  await open(page, '/operator/audit', { v41: true, role: 'owner' });
  await expect(heading(page).locator('h1')).toHaveText('Team and access');
  await expect(
    page.getByRole('navigation', { name: 'Team and access pages' }).getByRole('link'),
  ).toHaveText(['People and access', 'Audit']);
  // A reviewer may open Assistance but none of the other Settings pages: no row for one link.
  await open(page, '/operator/assistance', { v41: true, role: 'reviewer' });
  await expect(heading(page).locator('h1')).toHaveText('Settings');
  await expect(segments(page)).toHaveCount(0);
});

test('the scanning line: on every page with the switch off, on Status pages only with it on', async ({
  page,
}) => {
  const line = page.locator('p.operator-scope-note');
  await open(page, '/operator/research', { v41: false, real: true });
  await expect(line).toContainText('Evidence scanning is deferred');
  await open(page, '/operator/research', { v41: true, real: true });
  await expect(line).toHaveCount(0);
  await open(page, '/operator/health', { v41: true, real: true });
  await expect(line).toContainText('Evidence scanning is deferred');
});

for (const v41 of [false, true]) {
  test(`switch ${v41 ? 'on' : 'off'}: six widths without sideways scroll, 44 px targets, axe clean`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await open(page, '/operator/sources', { v41, width });
      await expect(heading(page).locator('h1')).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`d4-sources-${v41 ? 'on' : 'off'}-${width}.png`),
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `no sideways scroll at ${width}`).toBeLessThanOrEqual(0);
      if (v41) {
        for (const box of await segments(page)
          .getByRole('link')
          .evaluateAll((links) => links.map((a) => a.getBoundingClientRect().height)))
          expect(box, `44 px segment at ${width}`).toBeGreaterThanOrEqual(44);
        const inside = await segments(page).evaluate((nav) => {
          const row = nav.getBoundingClientRect();
          return row.left >= 0 && row.right <= document.documentElement.clientWidth;
        });
        expect(inside, `segments inside the page at ${width}`).toBe(true);
      }
      const results = await new AxeBuilder({ page })
        .include('main#main > header.ux-page-heading')
        .include(v41 ? 'main#main nav.ux-desk-segments' : 'main#main nav.ux-team-second')
        .analyze();
      expect(results.violations, `axe at ${width}`).toEqual([]);
    }
  });
}

test('switch on: the segments work from the keyboard and show their focus', async ({ page }) => {
  await open(page, '/operator/research', { v41: true });
  const link = segments(page).getByRole('link', { name: 'Evidence review' });
  await link.focus();
  const outline = await link.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/operator\/evidence\?workspace=/);
});

// Audit of 25 Nov 2026, staff-admin-01 and -02: a page the role may not open showed that page's title and purpose
// line over the Today content, said so only inside a closed row, and put the focus on the whole left menu.
test('switch on: a page the role may not open shows Today, says so in the open and focuses nothing', async ({
  page,
}) => {
  for (const [role, path] of [
    ['viewer', '/operator/controls'],
    ['viewer', '/operator/settings'],
    ['operator', '/operator/audit'],
    ['viewer', '/operator/health'],
    ['operator', '/operator/health'],
    ['operator', '/operator/readiness'],
  ] as const) {
    await open(page, path, { v41: true, role });
    await expect(heading(page).locator('h1'), path).toHaveText('Today');
    await expect(heading(page).locator('.ux-frame-helper')).toHaveText(
      'What needs your decision now and what is waiting on others.',
    );
    await expect(segments(page)).toHaveCount(0);
    const note = page.locator('main#main').getByRole('alert');
    await expect(note).toHaveCount(1);
    await expect(note).toBeVisible();
    await expect(note).toContainText('This section is unavailable for your current workspace role');
    // In the open: the desk's own access notice, not inside a closed row and not the preview banner.
    expect(await note.evaluate((el) => !!el.closest('details'))).toBe(false);
    expect(await note.evaluate((el) => !!el.closest('.ux-state[data-state="denied"]'))).toBe(true);
    await expect(page.locator('#workspace-navigation')).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  }
  // Health and Readiness are turned away by the server, which sends the person to Today with a flag: Today says so in the
  // same words, in the open, and the flag only lasts while the person is on Today.
  for (const role of ['viewer', 'operator'])
    for (const v41 of [true, false]) {
      await open(page, '/operator', { v41, role, turned: true });
      const note = page.locator('main#main').getByRole('alert');
      await expect(note, `${role} ${v41}`).toHaveCount(1);
      await expect(note).toContainText(
        'This section is unavailable for your current workspace role',
      );
      expect(await note.evaluate((el) => !!el.closest('details'))).toBe(false);
    }
  // A role that may open the page sees no such note.
  await open(page, '/operator/controls', { v41: true, role: 'owner' });
  await expect(heading(page).locator('h1')).toHaveText('Team and access');
  await expect(page.locator('main#main').getByRole('alert')).toHaveCount(0);
});

test('the turned-away note leaves the address and does not come back on a return to Today by a # address', async ({
  page,
}) => {
  // With section addresses off every move is a `#` address on the same page; `?unavailable=1` must not stay in the
  // address to bring the note back on Today, on a reload, or in a copied link.
  for (const v41 of [true, false]) {
    await open(page, '/operator', { v41, role: 'operator', turned: true });
    const note = page
      .locator('main#main')
      .getByText('This section is unavailable for your current workspace role');
    await expect(note, `${v41}`).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).searchParams.has('unavailable')).toBe(false);
    expect(new URL(page.url()).searchParams.get('v41')).toBe(v41 ? 'on' : 'off');
    await page.evaluate(() => (window.location.hash = '#workspace-missions'));
    await expect(page.locator('#workspace-missions')).toBeVisible();
    await page.evaluate(() => (window.location.hash = '#main'));
    await expect(page.locator('#workspace-missions')).toBeHidden();
    await expect(note, `${v41} back on Today`).toHaveCount(0);
  }
});

test('switch on: a page whose body is still loading does not put the focus on the left menu', async ({
  page,
}) => {
  // Status loads its own records after the workspace; until then there is no block to land on.
  for (const path of ['/operator/operations', '/operator/dashboard', '/operator/health']) {
    await open(page, path, { v41: true });
    await expect(heading(page).locator('h1')).toHaveText('Status');
    await expect(page.locator('#workspace-navigation')).not.toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  }
  // The menu's own address still opens and focuses it.
  await open(page, '/operator', { v41: true });
  await page.evaluate(() => {
    window.location.hash = 'workspace-navigation';
  });
  await expect(page.locator('#workspace-navigation')).toBeFocused();
});

// Switch OFF audit of 25 Nov 2026, F7: off, the only explanation was the last line of the lower card, far from
// the title. The same note now leads the page in both states.
test('switch off: a page the role may not open says so at the top of the page, once', async ({
  page,
}) => {
  await open(page, '/operator/controls', { v41: false, role: 'viewer' });
  const note = page.locator('main#main').getByRole('alert');
  await expect(note).toHaveCount(1);
  await expect(note).toBeVisible();
  await expect(note).toContainText('This section is unavailable for your current workspace role');
  // The desk's own access notice, first in the page body and outside every card.
  expect(
    await note.evaluate((el) => {
      const state = el.closest('.ux-state[data-state="denied"]');
      return (
        !!state && state.parentElement?.firstElementChild === state && !state.closest('section')
      );
    }),
  ).toBe(true);
  await expect(page.locator('main#main .ux-testmode[role="alert"]')).toHaveCount(0);
});

// Switch OFF audit of 25 Nov 2026, F9: on a phone a page opened by its own address scrolled itself to its body
// (258 px on Missions, 286 px on Companies), so the title sat under the top bar.
test('a page opened by its own address opens at the top on a phone, switch off and on', async ({
  page,
}) => {
  for (const v41 of [false, true])
    for (const path of ['/operator/missions', '/operator/research', '/operator/sources']) {
      await open(page, path, { v41, width: 390, height: 800 });
      await expect(heading(page).locator('h1')).toBeVisible();
      // Give a late scroll the time to happen before reading the position.
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.scrollY), `${path} v41 ${v41}`).toBe(0);
    }
  // Off, the body still takes the focus on arrival, as before; an old # link still scrolls to its page.
  await open(page, '/operator/research', { v41: false, width: 390, height: 800 });
  await expect(page.locator('#workspace-research')).toBeFocused();
  await open(page, '/operator', { v41: false, width: 390, height: 800 });
  await page.evaluate(() => {
    window.location.hash = 'workspace-research';
  });
  await expect(page.locator('#workspace-research')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

// Audit of 25 Nov 2026, staff-admin-10, staff-core-20, public-customer-01: a row of tabs or segments that scrolls
// sideways on a phone was cut with nothing to say more was there.
test('switch on: a segments row that scrolls sideways marks the edge that hides more, and only that edge', async ({
  page,
}) => {
  const cue = (row: ReturnType<Page['locator']>) =>
    row.evaluate((el) => ({
      scrolls: el.scrollWidth > el.clientWidth + 1,
      start: getComputedStyle(el, '::before').display !== 'none',
      end: getComputedStyle(el, '::after').display !== 'none',
    }));
  const to = (row: ReturnType<Page['locator']>, where: 'start' | 'middle' | 'end') =>
    row.evaluate((el, place) => {
      const far = el.scrollWidth - el.clientWidth;
      el.scrollTo({
        left: place === 'start' ? 0 : place === 'end' ? far : far / 2,
        behavior: 'instant',
      });
    }, where);
  for (const width of [320, 390]) {
    await open(page, '/operator/settings', { v41: true, width, height: 800 });
    const row = segments(page).locator('ul');
    await to(row, 'start');
    await expect
      .poll(() => cue(row), `rest at ${width}`)
      .toEqual({ scrolls: true, start: false, end: true });
    // The mark takes no room and no tap: the row is exactly as wide as its links.
    const before = await row.evaluate((el) => el.scrollWidth);
    await to(row, 'middle');
    await expect
      .poll(() => cue(row), `middle at ${width}`)
      .toEqual({ scrolls: true, start: true, end: true });
    expect(await row.evaluate((el) => el.scrollWidth)).toBe(before);
    expect(await row.evaluate((el) => getComputedStyle(el, '::after').pointerEvents)).toBe('none');
    await to(row, 'end');
    await expect
      .poll(() => cue(row), `end at ${width}`)
      .toEqual({ scrolls: true, start: true, end: false });
    expect(await row.evaluate((el) => el.scrollWidth)).toBe(before);
    // One row, and the page itself never scrolls sideways.
    expect(await row.evaluate((el) => getComputedStyle(el).flexWrap)).toBe('nowrap');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const results = await new AxeBuilder({ page }).include('nav.ux-desk-segments').analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  }
  // A row that fits shows no mark at either edge.
  await open(page, '/operator/settings', { v41: true, width: 1440 });
  expect(await cue(segments(page).locator('ul'))).toEqual({
    scrolls: false,
    start: false,
    end: false,
  });
});

// Audit of 25 Nov 2026, staff-admin-23 and public-customer-16: the two links of the quiet footer were 39 px tall.
test('the quiet footer links are full 44 px targets at every width', async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await open(page, '/operator', { v41: true, width });
    const links = page.locator('footer.site-footer a');
    await expect(links).toHaveCount(2);
    for (const box of await links.evaluateAll((all) =>
      all.map((link) => link.getBoundingClientRect().height),
    ))
      expect(box, `footer link at ${width}`).toBeGreaterThanOrEqual(44);
  }
});

// Audit of 25 Nov 2026, staff-core-02: the customer name on the Missions list is a row header, and the label style
// of a column head (mono capitals, wide tracking, 12 px) was drawn on it.
test('a name in a row header of the Missions list is drawn as a name, not as a column label', async ({
  page,
}) => {
  await open(page, '/operator/missions', { v41: true });
  const read = await page.evaluate(() => {
    const holder = document.createElement('div');
    holder.className = 'mission-queue';
    holder.innerHTML =
      '<table><thead><tr><th scope="col">Customer</th></tr></thead><tbody><tr><th scope="row"><a href="#x">Synthetic Beverage Co</a></th><td>Bangladesh to China</td></tr></tbody></table>';
    document.querySelector('main#main')!.append(holder);
    const style = (selector: string) => {
      const computed = getComputedStyle(holder.querySelector(selector)!);
      return {
        transform: computed.textTransform,
        tracking: computed.letterSpacing,
        family: computed.fontFamily,
        size: computed.fontSize,
      };
    };
    const result = { name: style('tbody th'), cell: style('tbody td'), head: style('thead th') };
    holder.remove();
    return result;
  });
  expect(read.name.transform).toBe('none');
  expect(read.name.tracking).toBe('normal');
  // The same face and size as the cells beside it; the column head keeps its label style.
  expect(read.name.family).toBe(read.cell.family);
  expect(read.name.size).toBe(read.cell.size);
  expect(read.head.transform).toBe('uppercase');
  expect(read.head.family).not.toBe(read.cell.family);
});
