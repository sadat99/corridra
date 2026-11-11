import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { clearSignInLimits } from './operator-signin';

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
const mission = (id: string, status: string, company: string, dueAt: string) => ({
  id,
  status,
  due_at: dueAt,
  brief: { company, objective: 'Source suppliers', market: 'China' },
});

test('Operator Today panel reads the real mission list, shows new and overdue work and never blocks the workspace', async ({
  page,
}) => {
  test.setTimeout(120000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8')),
    { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  // A code from an earlier test in the same 30 second step could be refused as a replay.
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and Open Workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  // Real server reads: the panel loads and shows eight counts (the owner can read meetings); the
  // commercial readiness Today adds accepted quotes not started and replies to review (CQ-34, CQ-73),
  // and W3 adds service requests to quote.
  const today = page.getByRole('region', { name: 'Today' });
  await expect(today.getByRole('list', { name: 'Counts' }).getByRole('listitem')).toHaveCount(8);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Synthetic answers prove the new-request and overdue lists.
  await page.route('**/api/workspace/missions?*view=today*', async (route) => {
    const url = new URL(route.request().url());
    const draft = url.searchParams.get('stage') === 'DRAFT';
    const overdue = url.searchParams.get('filter') === 'overdue';
    const rows = draft
      ? [
          mission(
            '11111111-1111-4111-8111-111111111111',
            'DRAFT',
            'Invented Towels Ltd',
            '2026-10-20T00:00:00Z',
          ),
        ]
      : overdue
        ? [
            mission(
              '22222222-2222-4222-8222-222222222222',
              'OUTREACH',
              'Invented Machinery Co',
              '2026-10-01T00:00:00Z',
            ),
            mission(
              '33333333-3333-4333-8333-333333333333',
              'FOLLOW_UP',
              'Invented Foods Co',
              '2026-10-02T00:00:00Z',
            ),
          ]
        : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ missions: rows, total: draft ? 1 : overdue ? 2 : 7 }),
    });
  });
  const inTwoDays = new Date(Date.now() + 2 * 86400000).toISOString();
  const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString();
  await page.route('**/api/workspace/meetings?*view=today*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        meetings: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            title: 'Invented buyer introduction',
            status: 'SCHEDULED',
            starts_at: inTwoDays,
            due_at: inTwoDays,
            location: 'Invented meeting room',
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            title: 'Invented factory visit',
            status: 'RESCHEDULE_REQUIRED',
            starts_at: null,
            due_at: inTwoDays,
            location: null,
          },
        ],
        followups: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            status: 'OPEN',
            due_at: lastWeek,
            next_action: 'Send invented samples',
          },
          {
            id: '77777777-7777-4777-8777-777777777777',
            status: 'COMPLETED',
            due_at: lastWeek,
            next_action: 'Completed invented task',
          },
        ],
      }),
    }),
  );
  await page.reload();
  await expect(today.getByText('new request to review', { exact: true })).toBeVisible();
  await expect(today.getByText('missions past their due date', { exact: true })).toBeVisible();
  await expect(today.getByText('open missions', { exact: true })).toBeVisible();
  // New requests and late missions share one "Needs you now" list (owner, 6 Nov 2026); its "Past due"
  // filter shows the late missions only.
  const needs = today.getByRole('region', { name: 'Needs you now' });
  await expect(needs.getByText('Invented Towels Ltd')).toBeVisible();
  await needs.getByRole('radio', { name: 'Past due 2' }).check();
  await expect(needs.getByText('Invented Machinery Co')).toBeVisible();
  await expect(needs.getByText('Invented Foods Co')).toBeVisible();
  await expect(needs.getByText('Invented Towels Ltd')).toHaveCount(0);
  await expect(today.getByText('follow-up past its due date', { exact: true })).toBeVisible();
  await expect(today.getByText('meeting in the next 7 days', { exact: true })).toBeVisible();
  await expect(
    today
      .getByRole('region', { name: 'Follow-ups past their due date' })
      .getByText('Send invented samples'),
  ).toBeVisible();
  await expect(today.getByText('Completed invented task')).toHaveCount(0);
  await expect(
    today
      .getByRole('region', { name: 'Meetings in the next 7 days' })
      .getByText('Invented buyer introduction'),
  ).toBeVisible();
  await expect(
    today
      .getByRole('region', { name: 'Meetings that need a new time' })
      .getByText('Invented factory visit'),
  ).toBeVisible();
  // Exact: the "7 open missions" count link also contains the words.
  await expect(today.getByRole('link', { name: 'Open Missions', exact: true })).toHaveAttribute(
    'href',
    '#workspace-missions',
  );
  await mkdir('.cache/today', { recursive: true });
  await today.screenshot({ path: '.cache/today/today-panel.png' });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // A failed meetings read only hides the meeting counts. Missions still show.
  await page.unroute('**/api/workspace/meetings?*view=today*');
  await page.route('**/api/workspace/meetings?*view=today*', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic interruption' }),
    }),
  );
  await page.reload();
  // Without the meetings read two counts drop (six of eight remain; CQ-34 and CQ-73 add two, W3 adds one).
  await expect(today.getByRole('list', { name: 'Counts' }).getByRole('listitem')).toHaveCount(6);
  await expect(today.getByText('Invented Towels Ltd')).toBeVisible();
  // A failed read says so and leaves the mission list working.
  await page.unroute('**/api/workspace/missions?*view=today*');
  await page.route('**/api/workspace/missions?*view=today*', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic interruption' }),
    }),
  );
  await page.reload();
  await expect(today.getByRole('status')).toContainText("Today's list could not be loaded.");
  await page
    .getByRole('navigation', { name: 'Mission workflow' })
    .getByRole('link', { name: 'Missions and requirements', exact: false })
    .click();
  await expect(page.locator('#workspace-missions')).toBeVisible();
});

// W3-6 and W3-7: the paid-service requests tile on the real server. The tile must open the Delivery section
// and its request list through the real section router (the billing blocks are in-section addresses of
// Delivery); an address the router does not know shows the "section is unavailable" alert on the overview
// instead. Only the Today count read is answered here (the real database holds no waiting
// request); the router, the Delivery section and its request list are the real ones.
const tileCount = (counts: Record<string, unknown>) => ({
  acceptedQuotesNotStarted: 0,
  serviceRequestsToQuote: 0,
  repliesToReview: 0,
  ...counts,
});
async function ownerOverview(page: Page, counts: Record<string, unknown>) {
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8')),
    seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8')),
    { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  await clearSignInLimits(local.ownerPassword);
  // A code from an earlier test in the same 30 second step could be refused as a replay.
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and Open Workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  await page.route('**/api/team-control/today?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tileCount(counts)),
    }),
  );
  // The workspace is loaded; a navigation sent during its own address update can be aborted, so retry it.
  await expect(page.getByText('Your access:')).toBeVisible();
  await expect(async () => {
    await page.goto('/operator?workspace=' + encodeURIComponent(seed.tenantId));
  }).toPass({ timeout: 30000 });
  await expect(page.getByText('Your access: owner', { exact: true })).toBeVisible();
  return page.getByRole('region', { name: 'Today' });
}
const unavailableAlert = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'This section is unavailable' });

test('W3-6 as an owner, the paid-service requests tile opens the Delivery section and its request list, with no unavailable-section alert', async ({
  page,
}) => {
  test.setTimeout(180000);
  const today = await ownerOverview(page, { serviceRequestsToQuote: 3 });
  const tile = today
    .getByRole('list', { name: 'Counts' })
    .getByRole('listitem')
    .filter({ hasText: 'paid-service requests to quote' });
  await expect(tile.locator('strong')).toHaveText('3');
  await tile.getByRole('link').click();
  const delivery = page.locator('#workspace-delivery');
  await expect(delivery).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Client and programme delivery' })).toBeVisible();
  await expect(unavailableAlert(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#billing-services$/);
  await expect(page.getByRole('heading', { name: 'Start with a mission.' })).toHaveCount(0);
  // The request list is mounted in the Delivery section for owners and admins, in the tab for mission and
  // delegation experience. The address names a block inside that tab, so the tab opens by itself and the
  // list is in view, with nothing to click first.
  await expect(
    delivery.getByRole('tab', { name: 'Mission and delegation experience', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  const heading = delivery.getByRole('heading', { name: 'Customer paid-service requests' });
  await expect(heading).toBeVisible();
  await expect(page.locator('#billing-services')).toBeInViewport();
  await expect(unavailableAlert(page)).toHaveCount(0);
});

test('W3-7 when the count is Not available, the tile still opens the Delivery section and shows no unavailable-section alert', async ({
  page,
}) => {
  test.setTimeout(180000);
  const today = await ownerOverview(page, {
    unavailable: ['acceptedQuotesNotStarted', 'serviceRequestsToQuote'],
  });
  const tile = today
    .getByRole('list', { name: 'Counts' })
    .getByRole('listitem')
    .filter({ hasText: 'paid-service requests to quote' });
  await expect(tile.locator('strong')).toHaveText('Not available');
  await tile.getByRole('link').click();
  await expect(page).toHaveURL(/#billing-services$/);
  await expect(page.locator('#workspace-delivery')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Client and programme delivery' })).toBeVisible();
  await expect(unavailableAlert(page)).toHaveCount(0);
  await expect(
    page
      .locator('#workspace-delivery')
      .getByRole('tab', { name: 'Mission and delegation experience', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    page
      .locator('#workspace-delivery')
      .getByRole('heading', { name: 'Customer paid-service requests' }),
  ).toBeVisible();
});

// Which billing blocks are empty (their feature is off). A block is drawn before its feature answers, so
// wait until the answer has stayed the same for two seconds.
async function emptyBillingBlocks(page: Page, ids: readonly string[]) {
  const read = () =>
    page.evaluate(
      (blockIds) =>
        blockIds.filter((id) => document.getElementById(id)?.childElementCount === 0).join(),
      ids,
    );
  let last = await read();
  let steady = 0;
  while (steady < 4) {
    await page.waitForTimeout(500);
    const now = await read();
    steady = now === last ? steady + 1 : 0;
    last = now;
  }
  return last.split(',');
}

// The page scrolls smoothly, so a block lands in view a moment after the address changes. Empty blocks have no
// height, so the check is on the top edge: inside the window.
async function expectAtTop(page: Page, id: string) {
  await expect
    .poll(() =>
      page.evaluate((blockId) => {
        const top = document.getElementById(blockId)?.getBoundingClientRect().top ?? -1;
        return top >= 0 && top < window.innerHeight;
      }, id),
    )
    .toBe(true);
}

test('W3-8 as an owner, each billing jump link and a full page load of a billing address keep Delivery open and land on their block', async ({
  page,
}) => {
  test.setTimeout(180000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const today = await ownerOverview(page, { serviceRequestsToQuote: 1 });
  await today.getByRole('link', { name: /paid-service request/ }).click();
  const delivery = page.locator('#workspace-delivery');
  const jump = delivery.getByRole('navigation', { name: 'Jump to a billing section' });
  const blocks = [
    ['Services', 'billing-services'],
    ['Plans', 'billing-plans'],
    ['Sample invoices', 'billing-sample-invoices'],
    ['Invoices', 'billing-invoices'],
    ['Payments', 'billing-payments'],
  ] as const;
  await expect(jump).toBeVisible();
  // A block whose feature is off renders nothing: its link and the block itself are hidden, so nothing
  // empty can take focus. Which blocks are off depends on the switches of this database, so read it.
  const empty = await emptyBillingBlocks(
    page,
    blocks.map(([, id]) => id),
  );
  for (const [name, id] of blocks) {
    const link = jump.getByRole('link', { name, exact: true });
    if (empty.includes(id)) {
      await expect(link).toBeHidden();
      await expect(page.locator('#' + id)).toBeHidden();
      continue;
    }
    await link.click();
    await expect(page).toHaveURL(new RegExp('#' + id + '$'));
    await expect(delivery).toBeVisible();
    await expect(unavailableAlert(page)).toHaveCount(0);
    await expect(
      delivery.getByRole('tab', { name: 'Mission and delegation experience', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#' + id)).toBeFocused();
    await expectAtTop(page, id);
  }
  // A shared address opened cold: the section and the tab show first and the block lands once its data
  // has loaded, without a click.
  for (const [, id] of blocks) {
    if (empty.includes(id)) continue;
    await page.goto(
      '/operator?workspace=' + encodeURIComponent(seed.tenantId) + '&open=' + id + '#' + id,
    );
    await expect(page.locator('#workspace-delivery')).toBeVisible({ timeout: 30000 });
    await expect(
      page
        .locator('#workspace-delivery')
        .getByRole('tab', { name: 'Mission and delegation experience', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#' + id)).toBeFocused();
    await expect(unavailableAlert(page)).toHaveCount(0);
    await expectAtTop(page, id);
  }
  // On a phone the billing hub sits in a closed fold. An address that names a block inside it opens the fold.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    '/operator?workspace=' + encodeURIComponent(seed.tenantId) + '&open=phone#billing-plans',
  );
  await expect(page.locator('#billing-plans > section.detail-card')).toBeVisible({
    timeout: 30000,
  });
  await expect(unavailableAlert(page)).toHaveCount(0);
});

test('W3-9 when invoicing and payments are off, their jump links and empty blocks are hidden and the others still land and take focus', async ({
  page,
}) => {
  test.setTimeout(180000);
  const today = await ownerOverview(page, { serviceRequestsToQuote: 1 });
  // The three optional blocks answer "switched off" (503), exactly as a deployment with them off does.
  await page.route('**/api/workspace/customer-billing?*scope=pending*', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"off"}' }),
  );
  await page.route('**/api/workspace/customer-simulated-payments?*', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"off"}' }),
  );
  await page.reload();
  await today.getByRole('link', { name: /paid-service request/ }).click();
  const delivery = page.locator('#workspace-delivery');
  const jump = delivery.getByRole('navigation', { name: 'Jump to a billing section' });
  await expect(jump).toBeVisible();
  for (const [name, id] of [
    ['Sample invoices', 'billing-sample-invoices'],
    ['Invoices', 'billing-invoices'],
    ['Payments', 'billing-payments'],
  ] as const) {
    await expect(jump.getByRole('link', { name, exact: true })).toBeHidden();
    await expect(page.locator('#' + id)).toBeHidden();
  }
  for (const [name, id] of [
    ['Services', 'billing-services'],
    ['Plans', 'billing-plans'],
  ] as const) {
    await jump.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp('#' + id + '$'));
    await expect(page.locator('#' + id)).toBeFocused();
    await expectAtTop(page, id);
  }
});

// W6-A: "Not available" read "Not availabl / e" in a narrow tile. A tile that cannot give its count now takes two
// tiles' width and the word is never split inside itself: at the phone widths, at the widest layout, and at
// Largest text. Each word is measured by its own range: a word split across two lines has two boxes.
test('W6-A when counts are Not available, no word in the tile is split across lines at 320, 390 and 1440, at Normal and Largest text', async ({
  page,
}) => {
  test.setTimeout(240000);
  const today = await ownerOverview(page, {
    unavailable: ['acceptedQuotesNotStarted', 'serviceRequestsToQuote', 'repliesToReview'],
  });
  const tiles = today.getByRole('list', { name: 'Counts' }).locator('li[data-tone="unavailable"]');
  await expect(tiles).toHaveCount(3);
  for (const step of ['normal', 'largest'] as const) {
    await page.evaluate((value) => {
      if (value === 'normal') document.documentElement.removeAttribute('data-text-size');
      else document.documentElement.setAttribute('data-text-size', value);
    }, step);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      const strong = tiles.locator('strong');
      await expect(strong).toHaveText(['Not available', 'Not available', 'Not available']);
      const split = await strong.evaluateAll((els) =>
        els.flatMap((el) => {
          const node = el.firstChild as Text;
          const text = node.textContent ?? '';
          const found: string[] = [];
          for (const match of text.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index ?? 0);
            range.setEnd(node, (match.index ?? 0) + match[0].length);
            if (range.getClientRects().length > 1) found.push(match[0]);
          }
          return found;
        }),
      );
      expect(split, `${step} text at ${width}: words split across lines`).toEqual([]);
      // The tile still opens the Services section (its address is #billing-services after W6-B).
      await expect(tiles.first().getByRole('link')).toHaveAttribute('href', '#billing-services');
    }
  }
});
