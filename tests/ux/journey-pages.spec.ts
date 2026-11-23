import { expect, test, type Page } from '@playwright/test';
import { journeyBase, journeyServer, signInAs, type JourneySeed } from './journey-server';

// Journey modes on the real signed-in pages (docs/revamp/specs/journey-modes.md section 5): the production build
// with CORRIDRA_UX_SHELLS_V2, CORRIDRA_UX_MOVE and CORRIDRA_UX_JOURNEY_MODES on, a throwaway database and two made-up
// people (journey-server.ts). The switcher's own behaviour at each width, in the icons-only bar and in the drawer is
// in journey-switch.spec.ts; the model is in tests/integration/journey-mode.test.ts. These are the cases that need a
// real page: where a switch lands on each page, a deep link against the cookie, a brand-new account, what a chosen
// journey leaves on Requests, and the "Switch to" line on a request and a programme.
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const server = journeyServer();
let seed: JourneySeed;
test.beforeAll(async () => {
  test.setTimeout(600_000);
  seed = await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

const at = (path: string) => journeyBase + path;
const nav = (page: Page) => page.locator('#customer-navigation');
const summary = (page: Page) => nav(page).locator('.ux-journey-switch > summary');
const mismatch = (page: Page) => page.locator('[data-journey-mismatch]');
const journeyCookie = async (page: Page) =>
  (await page.context().cookies(at('/account'))).find((c) => c.name === 'corridra_journey')?.value;

async function choose(page: Page, journey: string) {
  await summary(page).click();
  await nav(page)
    .locator('.ux-journey-switch button')
    .filter({ hasText: new RegExp(`^${journey}`) })
    .click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test.describe('choosing a journey on each page', () => {
  // Home and Requests carry the journey in their address; every other page stays where it is and is drawn again.
  const pages: { name: string; path: string; lands: string; line?: string }[] = [
    { name: 'Home', path: '/account/move', lands: '/account/move?journey=source' },
    {
      name: 'Requests',
      path: '/account?view=work',
      lands: '/account?view=work&work=source',
      line: 'Showing Sourcing.',
    },
    {
      name: 'Meetings',
      path: '/account/meetings',
      lands: '/account/meetings',
      line: 'Showing Sourcing.',
    },
    {
      name: 'Reports',
      path: '/account?view=results',
      lands: '/account?view=results',
      line: 'Showing Sourcing.',
    },
    {
      name: 'Companies',
      path: '/account/companies',
      lands: '/account/companies',
      line: 'Companies are shared across all your journeys.',
    },
  ];
  for (const { name, path, lands, line } of pages)
    test(`${name}: Sourcing lands on ${lands} and the sidebar follows`, async ({
      page,
      context,
    }) => {
      await signInAs(context, seed.busy);
      await page.goto(at(path));
      await expect(summary(page)).toHaveAccessibleName(/^Journey, Everything/);
      await expect(page.locator('.ux-journey-note')).toHaveCount(0);
      await choose(page, 'Sourcing');
      await expect(summary(page)).toHaveAccessibleName(/^Journey, Sourcing/);
      await expect(page).toHaveURL(at(lands));
      expect(await journeyCookie(page)).toBe('source');
      // The sidebar's Home and Requests now open the chosen journey; Groups are not drawn in Sourcing.
      await expect(nav(page).getByRole('link', { name: 'Home', exact: true })).toHaveAttribute(
        'href',
        '/account/move?journey=source',
      );
      await expect(nav(page).getByRole('link', { name: /^Requests/ })).toHaveAttribute(
        'href',
        '/account?view=work&work=source',
      );
      await expect(nav(page).getByRole('link', { name: 'Programmes' })).toHaveCount(0);
      if (line) await expect(page.locator('.ux-journey-note').first()).toContainText(line);
    });
});

test('Requests: a journey shows only its own work, and Everything still shows the request no journey claims', async ({
  page,
  context,
}) => {
  await signInAs(context, seed.busy);
  await page.goto(at('/account?view=work'));
  const rows = page.locator('#my-work li.ux-row');
  const hrefs = () =>
    rows.evaluateAll((all) => all.map((row) => row.querySelector('a')?.getAttribute('href')));
  await expect(rows).toHaveCount(4);
  expect((await hrefs()).sort()).toEqual(
    [
      `/account/rooms/${seed.sourcing}`,
      `/account/rooms/${seed.selling}`,
      `/account/rooms/${seed.unsorted}`,
      `/account/delegations/${seed.programmeRoom}`,
    ].sort(),
  );
  await signInAs(context, seed.busy, 'source');
  await page.goto(at('/account?view=work'));
  await expect(rows).toHaveCount(1);
  expect(await hrefs()).toEqual([`/account/rooms/${seed.sourcing}`]);
  await expect(page.locator('.ux-journey-note').first()).toContainText('Showing Sourcing.');
  // The quiet count on the closed switcher: work waiting in the other journeys.
  await expect(summary(page).locator('[data-journey-count]')).toContainText('2');
  // One way back, which also clears the choice.
  await page.locator('.ux-journey-note').getByRole('button', { name: 'Show Everything' }).click();
  await expect(summary(page)).toHaveAccessibleName(/^Journey, Everything/);
  await expect(rows).toHaveCount(4);
  expect(await journeyCookie(page)).toBe('all');
});

test('a link to Home in Selling wins over a cookie that says Sourcing, on the page and in the sidebar', async ({
  page,
  context,
}) => {
  await signInAs(context, seed.busy, 'source');
  await page.goto(at('/account/move?journey=sell'));
  await expect(summary(page)).toHaveAccessibleName(/^Journey, Selling/);
  await expect(nav(page).getByRole('link', { name: 'Home', exact: true })).toHaveAttribute(
    'href',
    '/account/move?journey=sell',
  );
  await expect(nav(page).getByRole('link', { name: /^Requests/ })).toHaveAttribute(
    'href',
    '/account?view=work&work=sell',
  );
  await expect(page).toHaveURL(at('/account/move?journey=sell'));
  // The page remembers the journey it was opened in, so the next page agrees with it.
  await expect.poll(() => journeyCookie(page)).toBe('sell');
});

test('a brand-new account still has the switcher, with all three journeys and no counts', async ({
  page,
  context,
}) => {
  await signInAs(context, seed.fresh);
  await page.goto(at('/account/move'));
  await expect(summary(page)).toHaveAccessibleName(/^Journey, Everything/);
  await summary(page).click();
  const choices = nav(page).locator('.ux-journey-switch button');
  await expect(choices).toHaveText([/^Everything/, /^Sourcing/, /^Organising/, /^Selling/]);
  await expect(nav(page).locator('[data-journey-count]')).toHaveCount(0);
  await choices.filter({ hasText: /^Selling/ }).click();
  await expect(page).toHaveURL(at('/account/move?journey=sell'));
  await expect(summary(page)).toHaveAccessibleName(/^Journey, Selling/);
  await expect(nav(page).locator('[data-journey-count]')).toHaveCount(0);
  await expect(page.locator('main h1')).toBeVisible();
  // Requests in a journey with nothing in it: the page's own empty state, not an error.
  await page.goto(at('/account?view=work'));
  await expect(page.locator('#my-work li.ux-row')).toHaveCount(0);
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
});

test.describe('the "Switch to" line', () => {
  for (const width of [1280, 390])
    test(`${width}: a Sourcing request opened in Selling offers the switch, and pressing it keeps the page`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAs(context, seed.busy, 'sell');
      await page.goto(at(`/account/rooms/${seed.sourcing}`));
      const note = mismatch(page);
      await expect(note).toHaveText('This request is in Sourcing. Switch to Sourcing');
      await expect(note).toHaveAttribute('lang', 'en');
      expect(await note.evaluate((el) => el.tagName + (el.getAttribute('role') ?? ''))).toBe('P');
      const button = note.getByRole('button', { name: 'Switch to Sourcing', exact: true });
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      // The note is above the Room's heading area.
      const head = (await page.locator('.room-head').boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(head.y + 1);
      const title = await page.locator('.room-head h2').innerText();
      await page.evaluate(() => {
        (window as unknown as { kept?: boolean }).kept = true;
      });
      await button.click();
      await expect(note).toHaveCount(0);
      expect(await journeyCookie(page)).toBe('source');
      // No navigation and no reload: the same document, the same address, the same Room.
      expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
      await expect(page).toHaveURL(at(`/account/rooms/${seed.sourcing}`));
      await expect(page.locator('.room-head h2')).toHaveText(title);
      if (width < 1024) await page.locator('[data-leftnav-opener]').click();
      await expect(summary(page)).toHaveAccessibleName(/^Journey, Sourcing/);
    });

  test('nothing is offered in Everything, when the journeys match, or for a request no journey claims', async ({
    page,
    context,
  }) => {
    for (const [journey, request] of [
      [undefined, seed.sourcing],
      ['all', seed.sourcing],
      ['source', seed.sourcing],
      ['sell', seed.selling],
      ['sell', seed.unsorted],
      ['source', seed.unsorted],
    ] as const) {
      await signInAs(context, seed.busy, journey);
      await page.goto(at(`/account/rooms/${request}`));
      await expect(page.locator('.room-head h2')).toBeVisible();
      await expect(mismatch(page)).toHaveCount(0);
    }
  });

  test('the saved request page offers it too', async ({ page, context }) => {
    await signInAs(context, seed.busy, 'source');
    await page.goto(at(`/account/requests/${seed.selling}`));
    await expect(mismatch(page)).toHaveText('This request is in Selling. Switch to Selling');
    await mismatch(page).getByRole('button', { name: 'Switch to Selling', exact: true }).click();
    await expect(mismatch(page)).toHaveCount(0);
    await expect(summary(page)).toHaveAccessibleName(/^Journey, Selling/);
    await expect(page).toHaveURL(at(`/account/requests/${seed.selling}`));
  });

  test('a programme room says "This programme is in Organising."', async ({ page, context }) => {
    await signInAs(context, seed.busy, 'sell');
    await page.goto(at(`/account/delegations/${seed.programmeRoom}`));
    await expect(mismatch(page)).toHaveText(
      'This programme is in Organising. Switch to Organising',
    );
    await mismatch(page).getByRole('button', { name: 'Switch to Organising', exact: true }).click();
    await expect(mismatch(page)).toHaveCount(0);
    await expect(summary(page)).toHaveAccessibleName(/^Journey, Organising/);
    // Organising draws Groups again.
    await expect(nav(page).getByRole('link', { name: 'Programmes' })).toBeVisible();
    await signInAs(context, seed.busy, 'organise');
    await page.goto(at(`/account/delegations/${seed.programmeRoom}`));
    await expect(page.locator('main h1')).toBeAttached();
    await expect(mismatch(page)).toHaveCount(0);
  });
});

test('the short reference is beside the title on the Room and the saved request page', async ({
  page,
  context,
}) => {
  await signInAs(context, seed.busy);
  await page.goto(at(`/account/rooms/${seed.sourcing}`));
  const onRoom = page.locator('.room-tags [data-request-reference]');
  await expect(onRoom).toHaveText(/^RQ-\d{6}$/);
  const reference = await onRoom.innerText();
  await page.goto(at(`/account/requests/${seed.sourcing}`));
  await expect(page.locator('.detail-card [data-request-reference]')).toHaveText(reference);
  // Each request has its own.
  await page.goto(at(`/account/rooms/${seed.selling}`));
  await expect(onRoom).toHaveText(/^RQ-\d{6}$/);
  expect(await onRoom.innerText()).not.toBe(reference);
});
