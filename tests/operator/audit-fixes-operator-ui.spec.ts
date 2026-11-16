import { test, expect, type Page } from '@playwright/test';
import { fixtureTenant, startTodayFixture } from './team-today-fixture';

// Audit fixes 1, staff screens (items 8, 9, 10, 13, 14, 15, 16 and 18). The real team workspace is bundled
// from the source with the real stylesheets (tests/operator/team-today-fixture.ts) and every read is answered
// here with invented rows, so no database is needed. AUDIT_FIXES_ROOT bundles another checkout (for example
// a worktree of the old commit) in the same frame, which is how each case was shown to fail before the fix.
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
test.beforeAll(async () => {
  fixture = await startTodayFixture(process.env.AUDIT_FIXES_ROOT);
});
test.afterAll(async () => {
  await fixture.close();
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const owner = { user_id: id(501), name: 'Invented Owner Ada' };
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-/;

/** Dashboard rows as the operations read returns them: one named mission with a route and owner, one bare. */
const dashboardMissions = [
  {
    id: id(11),
    mission_name: 'Invented Machinery Co',
    // Market keys as app.market_scope holds them (0020_versioned_corridors.sql), never display names.
    origin_market: 'BD',
    destination_market: 'DE',
    owner_id: owner.user_id,
    due_at: '2026-11-02T13:36:00Z',
    next_action: 'Call the invented buyer',
  },
  {
    id: id(12),
    mission_name: null,
    origin_market: null,
    destination_market: null,
    owner_id: null,
    due_at: null,
    next_action: 'Confirm the invented brief',
  },
];
const empty = (...names: string[]) => Object.fromEntries(names.map((name) => [name, []]));

let loads = 0;
async function open(page: Page, hash: string, role = 'owner', purpose = 'synthetic_validation') {
  // Any read not answered below gets a plain refusal, never the fixture page.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: true } }),
  );
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      json: {
        purpose,
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
  await page.route('**/api/workspace/mission-catalogue?*', (route) =>
    route.fulfill({ json: { routes: [], packs: [] } }),
  );
  await page.route('**/api/workspace/missions?*', (route) =>
    new URL(route.request().url()).searchParams.get('view') === 'today'
      ? route.fulfill({ json: { missions: [], total: 0 } })
      : route.fulfill({
          json: {
            total: 240,
            role,
            owners: [owner],
            history: [],
            replies: [],
            missions: [
              {
                id: id(21),
                status: 'OUTREACH',
                owner_id: owner.user_id,
                due_at: daysAgo(36),
                updated_at: daysAgo(37),
                next_action: 'Call the invented buyer',
                route_label: 'Bangladesh to Germany',
                source_kind: 'self_declaration',
                claim_status: 'SELF_DECLARED',
                acknowledged_at: daysAgo(40),
                notice_version: 'invented-notice-1',
                brief: {
                  company: 'Invented Machinery Co',
                  objective: 'Source suppliers',
                  offer: 'Invented machine parts',
                  outcomes: ['Find suppliers'],
                  attendance: 'No',
                },
              },
            ],
          },
        }),
  );
  await page.route('**/api/workspace/operations-dashboard?*', (route) =>
    route.fulfill({
      json: {
        role,
        summary: { submitted: 2 },
        missions: dashboardMissions,
        owners: [owner],
        ...empty(
          'corridraMoney',
          'economics',
          'customerTrade',
          'programmes',
          'repeat',
          'commercialActivityTotals',
        ),
        financeAvailable: ['owner', 'admin'].includes(role),
        offset: 0,
        limit: 50,
        warnings: [],
        definitions: { scope: 'Invented scope line.' },
      },
    }),
  );
  await page.route('**/api/workspace/operations-health?*', (route) =>
    route.fulfill({
      json: {
        ...empty('communications', 'tasks', 'ai', 'cases'),
        health: { database_reachable: true, unscanned: 0 },
        costWarning: 'Invented cost line.',
      },
    }),
  );
  await page.route('**/api/workspace/operations-controls?*', (route) =>
    route.fulfill({
      json: {
        checkedAt: '2026-11-02T13:36:00Z',
        ...empty(
          'owners',
          'readiness',
          'releases',
          'proposals',
          'cases',
          'documents',
          'ledger',
          'effort',
          'contexts',
          'privacy',
          'policies',
          'budgets',
          'markets',
        ),
      },
    }),
  );
  // A new query each time, so a second open with the same hash loads the page again rather than only scrolling.
  loads += 1;
  await page.goto(`${fixture.origin}/?load=${loads}${hash}`);
  await expect(page.locator('header.ux-app-header')).toBeVisible();
}

/** How many lines the words of an element take (text only; the icon is not a line). */
const textLines = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((node) => {
      const tops = new Set<number>();
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        for (const rect of Array.from(range.getClientRects())) tops.add(Math.round(rect.top));
      }
      return tops.size;
    });

test('Next actions name the mission and its owner and use the house date, never a raw id', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '#ops-dashboard');
  await page.getByRole('tab', { name: 'Next actions' }).click();
  const queue = page.getByRole('region', { name: 'Recorded mission action queue' });
  const items = queue.getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(queue).not.toContainText(uuid);
  await expect(items.nth(0)).toContainText(
    'Invented Machinery Co · Bangladesh to Germany · Owner: Invented Owner Ada · Due 2 Nov 2026',
  );
  await expect(items.nth(0)).not.toContainText('BD to DE');
  // The name is drawn in the link colour (cobalt), not in the navy of the page text.
  const colours = await items
    .nth(0)
    .getByRole('link')
    .evaluate((link) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--brand)';
      link.parentElement!.append(probe);
      const brand = getComputedStyle(probe).color;
      probe.remove();
      return { link: getComputedStyle(link).color, brand };
    });
  expect(colours.link).toBe(colours.brand);
  await expect(items.nth(0).getByRole('link', { name: 'Invented Machinery Co' })).toHaveAttribute(
    'href',
    `/operator/missions/${id(11)}?workspace=${fixtureTenant}`,
  );
  // A row with no name, route, owner or due date says so in words.
  await expect(items.nth(1)).toContainText(
    'Unnamed mission · No route yet · Owner: Not assigned · No due date',
  );
});

test('the Deferred controls table counts its rows in Title Case with a singular first row, and no control ID breaks', async ({
  page,
}) => {
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '#ops-gates');
    const table = page.getByRole('region', { name: 'Deferred controls' });
    const toggle = table.getByRole('button', { name: /^Show All \d+ Rows$/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const back = table.getByRole('button', { name: 'Show the First Row' });
    await expect(back).toHaveAttribute('aria-expanded', 'true');
    // Every control ID in the first column sits on one line (the audit saw "OUTREAC" and "H").
    const lines = await table.locator('tbody tr td:first-child').evaluateAll((cells) =>
      cells.map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return [cell.textContent, range.getClientRects().length] as const;
      }),
    );
    expect(lines.length).toBeGreaterThan(5);
    expect(
      lines.filter(([, count]) => count !== 1),
      `split IDs at ${width}`,
    ).toEqual([]);
  }
});

test('each empty money table says which record is missing, and money tables never claim zero', async ({
  page,
}) => {
  for (const [role, finance] of [
    ['owner', true],
    ['operator', false],
  ] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '#ops-dashboard', role);
    await page.getByRole('tab', { name: 'Money' }).click();
    const money = page.locator('#ops-dashboard .ops-money-grid');
    await expect(money).toBeVisible();
    await expect(money).not.toContainText('No matching recorded observations');
    const sentences = [
      ...(finance
        ? [
            'No Corridra fee records match these filters. A missing record means unknown, not zero.',
            'No mission has recorded fees, costs or effort for these filters. Missing amounts mean unknown, not zero.',
          ]
        : []),
      'No customer contract, invoice or cash record matches these filters.',
      'No commercial activity is recorded for these filters.',
      'No programme has participants that match these filters.',
      'No repeat missions are recorded for these filters.',
    ];
    for (const sentence of sentences)
      await expect(money.getByText(sentence, { exact: true })).toHaveCount(1);
    if (!finance)
      await expect(
        money.getByText(
          'Fee records are shown to owners and admins only. This does not mean zero.',
          { exact: true },
        ),
      ).toHaveCount(2);
  }
});

test('Previous Missions and Next Missions share one line on desktop and one 44 px row on a tablet or phone', async ({
  page,
}) => {
  const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
  for (const width of [360, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '#workspace-missions');
    // The compact queue is drawn once the mission pages switch is read; measure that settled view.
    await expect(page.locator('[data-mission-row]')).toBeVisible();
    const previous = page.getByRole('button', { name: 'Previous Missions' });
    const next = page.getByRole('button', { name: 'Next Missions' });
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    // One read of all three boxes, so a scroll between reads cannot move one of them.
    const [count, before, after] = await previous.evaluate((button) =>
      [button.parentElement!.querySelector(':scope > p')!, button, button.nextElementSibling!].map(
        (node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        },
      ),
    );
    expect(Math.abs(centre(before) - centre(after)), `one row at ${width}`).toBeLessThanOrEqual(1);
    expect(after.x, `Next after Previous at ${width}`).toBeGreaterThan(before.x + before.width - 1);
    // Controls are 16 px at every width; the phone row is made to fit by padding, never by smaller text.
    for (const button of [previous, next])
      await expect(button, `16 px text at ${width}`).toHaveCSS('font-size', '16px');
    if (width >= 1280) {
      // Desktop: the count text, then both buttons, all on one centre line.
      expect(Math.abs(centre(count) - centre(before)), `count at ${width}`).toBeLessThanOrEqual(1);
      expect(before.x).toBeGreaterThan(count.x + count.width - 1);
    } else {
      // Tablet and phone: the count on its own line, then both buttons from the left edge, 44 px tall.
      expect(before.y, `count above at ${width}`).toBeGreaterThanOrEqual(count.y + count.height);
      expect(Math.abs(before.x - count.x), `left edge at ${width}`).toBeLessThanOrEqual(1);
      expect(Math.min(before.height, after.height), `targets at ${width}`).toBeGreaterThanOrEqual(
        44,
      );
    }
  }
});

test('the network jump list wraps instead of clipping its last link at laptop widths', async ({
  page,
}) => {
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '#workspace-network');
    const list = page.locator('#workspace-network .ux-operator-workbench > div');
    await expect(list.getByRole('button').last()).toBeVisible();
    const fit = await list.evaluate((node) => {
      const edge = node.getBoundingClientRect().right;
      return {
        scroll: node.scrollWidth - node.clientWidth,
        outside: Array.from(node.querySelectorAll('button'))
          .filter((button) => button.getBoundingClientRect().right > edge + 0.5)
          .map((button) => button.textContent),
      };
    });
    expect(fit, `jump list at ${width}`).toEqual({ scroll: 0, outside: [] });
  }
});

test('the header strip keeps each link on one line, keeps the start page and its access link stays in staff space', async ({
  page,
}) => {
  // The words wrapped from 1024 to 1180 px (and at 1280 and 1600 in the audited workspace) with the scope note
  // of a real workspace beside the strip.
  for (const purpose of ['commercial_qualification', 'synthetic_validation'])
    for (const width of [360, 390, 768, 1024, 1180, 1280, 1440, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, '', 'owner', purpose);
      await expect(page.locator('.operator-toolbar a.text-link')).toHaveText([
        'All Workspaces',
        'Sign-In and Access Help',
      ]);
      for (const selector of [
        '.operator-toolbar a.text-link[href="/workspace"]',
        '.operator-toolbar a.text-link[href="#workspace-authenticator"]',
        '.operator-toolbar button.text-link',
      ])
        expect(await textLines(page, selector), `${selector} at ${width}, ${purpose}`).toBe(1);
      // Each link sits whole inside the screen, and on a phone each keeps a 44 px target.
      for (const link of await page.locator('.operator-toolbar > .text-link').all()) {
        const box = (await link.boundingBox())!;
        expect(box.x, `inside at ${width}`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `inside at ${width}`).toBeLessThanOrEqual(width);
        if (width <= 768) expect(box.height, `target at ${width}`).toBeGreaterThanOrEqual(44);
      }
    }
  // Nothing is removed: the start page is still one tap away, beside the staff access help.
  const start = page.locator('.operator-toolbar').getByRole('link', { name: 'All Workspaces' });
  await expect(start).toHaveAttribute('href', '/workspace');
  const help = page.locator('.operator-toolbar').getByRole('link', {
    name: 'Sign-In and Access Help',
  });
  await expect(help).toHaveAttribute('href', '#workspace-authenticator');
  await help.click();
  await expect(page.locator('#workspace-authenticator')).toBeVisible();
});
