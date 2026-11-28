import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startPagePatternFixture } from './d4-page-pattern-fixture';

// Team desk v4.1, units D14 (Helpers), D15 (Status) and D16 (Team and access): the bodies of these places on
// the page pattern, behind CORRIDRA_UX_TEAM_DESK_V41, measured with the real stylesheets. Off, each body is
// the one the desk has today. On: the page title and its purpose line name the page once (the old heading
// stays for screen readers), no small label above a heading, the dead link back to the section list is gone,
// Helpers with no task shows an example of how a task reads, and the Audit action sits on the left edge.
// Addresses, field names, payloads and the member and role forms are the same in both states.
let fixture: Awaited<ReturnType<typeof startPagePatternFixture>>;
test.beforeAll(async () => {
  fixture = await startPagePatternFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

const empty = (...keys: string[]) => Object.fromEntries(keys.map((key) => [key, []]));
const task = {
  id: '00000000-0000-4000-8000-0000000000b1',
  version: 1,
  status: 'ASSIGNED',
  reviewer_id: '00000000-0000-4000-8000-0000000000b2',
  late_submission: false,
  history: [],
  configuration: {
    kind: 'price_checks',
    instructions: 'Invented instructions for a sample task.',
    market: 'BD',
    workCountry: 'BD',
    deadline: '2026-12-15T10:00:00Z',
    evidenceRequired: 'Invented evidence line.',
    rewardRuleId: null,
  },
};

type Options = {
  v41: boolean;
  role?: string;
  width?: number;
  height?: number;
  tasks?: unknown[];
  enabled?: boolean;
  sources?: unknown[];
};
async function open(page: Page, path: string, options: Options) {
  const { v41, role = 'owner', width = 1440, height = 900, tasks = [], enabled = true } = options;
  const sources = options.sources ?? [];
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
        purpose: 'synthetic_validation',
        uploadsConfigured: false,
        scanMode: 'bypass',
        role,
        sources,
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/picker/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/helper-interest?*', (route) =>
    route.fulfill({ json: { installed: true } }),
  );
  await page.route('**/api/workspace/network?*', (route) =>
    route.fulfill({
      json: {
        enabled,
        profiles: [],
        profilesTotal: 0,
        profilesNext: null,
        tasks,
        tasksTotal: tasks.length,
        tasksNext: null,
        performance: [],
      },
    }),
  );
  await page.route('**/api/workspace/network-invitations?*', (route) =>
    route.fulfill({
      json: {
        installed: true,
        enabled: true,
        invitations: [],
        next: null,
        countries: [{ code: 'BD', name: 'Bangladesh' }],
      },
    }),
  );
  await page.route('**/api/workspace/mission-catalogue?*', (route) =>
    route.fulfill({
      json: {
        routes: [
          {
            id: '00000000-0000-4000-8000-0000000000d1',
            origin_market: 'BD',
            destination_market: 'DE',
          },
        ],
        packs: [],
      },
    }),
  );
  await page.route('**/api/workspace/operations-dashboard?*', (route) =>
    route.fulfill({
      json: {
        role,
        summary: { submitted: 2 },
        missions: [
          {
            id: '00000000-0000-4000-8000-0000000000c1',
            mission_name: 'Invented Machinery Co',
            // Market keys as the records hold them, never display names.
            origin_market: 'BD',
            destination_market: 'DE',
            owner_id: null,
            due_at: '2026-11-02T13:36:00Z',
            next_action: 'Call the invented buyer',
          },
        ],
        owners: [],
        corridraMoney: [
          {
            origin_market: 'BD',
            destination_market: 'EU',
            mission_type: 'sourcing',
            kind: 'CORRIDRA_INVOICE',
            currency: 'USD',
            observed_minor: '12500',
            recorded_mission_denominator: 1,
          },
        ],
        ...empty('economics', 'customerTrade', 'programmes', 'repeat', 'commercialActivityTotals'),
        financeAvailable: true,
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
  await page.route('**/api/workspace/members?*', (route) =>
    route.fulfill({
      json: [
        { user_id: 'member-1', name: 'Sample owner', role: 'owner', version: 1 },
        { user_id: 'member-2', name: 'Sample operator', role: 'operator', version: 1 },
      ],
    }),
  );
  await page.route('**/api/workspace/audit?*', (route) =>
    route.fulfill({
      json: [
        {
          id: 'event-1',
          type: 'membership.update',
          occurred_at: '2026-11-20T10:00:00Z',
          aggregate_type: 'membership',
          aggregate_id: 'aggregate-1',
          actor_id: 'member-1',
          correlation_id: 'correlation-1',
        },
      ],
    }),
  );
  await page.goto(`${fixture.origin}${path}?v41=${v41 ? 'on' : 'off'}&role=${role}`);
  await expect(page.getByLabel('Workspace status')).toBeAttached();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
}

const segments = (page: Page) => page.locator('main#main nav.ux-desk-segments');
/** A heading kept for screen readers only: in the outline, one pixel on the page. */
async function expectReadersOnly(page: Page, name: string) {
  const heading = page.getByRole('heading', { name, exact: true });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveClass(/sr-only/);
  const box = await heading.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1);
  expect(box!.height).toBeLessThanOrEqual(1);
}
/** Every field name and id inside a region, in order: what a form sends and what a link lands on. */
const namesAndIds = (page: Page, selector: string) =>
  page.locator(selector).evaluate((region) =>
    Array.from(region.querySelectorAll('[name], [id]'))
      // The helper interest list moves to the Inbox with the switch on; it has its own test here.
      .filter((node) => !node.closest('details.receipt-disclosure'))
      // Ids React makes for a tab or a label differ on every load and are not part of any payload.
      .map((node) => `${node.getAttribute('name') ?? ''}|${node.id}`)
      .filter((value) => !/[:«»]|\|_r_|^\|$/.test(value)),
  );
const widths = [320, 390, 768, 1024, 1440, 1920];

// D14 Helpers ---------------------------------------------------------------------------------------------

test('Helpers, switch off: the body is the one the desk has today', async ({ page }) => {
  await open(page, '/operator/network', { v41: false });
  const panel = page.locator('#workspace-network');
  await expect(panel.locator('header.ux-network-heading p.label')).toHaveText('CORRIDRA NETWORK');
  await expect(panel.locator('header.ux-network-heading h2')).toHaveText('Assigned work');
  await expect(panel.locator('header.ux-network-heading h2')).not.toHaveClass(/sr-only/);
  await expect(
    panel.getByText('Invite the right person. Define the work. Review the evidence.'),
  ).toBeVisible();
  await expect(panel.locator('header.ux-network-heading .ux-network-state')).toHaveText(
    'Network enabled',
  );
  await expect(panel.locator('.ux-helpers-state')).toHaveCount(0);
  // No task: the closed fold with its count, as today, and no example.
  await expect(panel.getByText('Disclosed tasks in this workspace (0)')).toBeVisible();
  await expect(panel.locator('.ux-helpers-empty')).toHaveCount(0);
  await expect(panel.locator('.ux-example-tag')).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Open assigned task access' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Back to workspace sections' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Open missions' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Open sources and claims' })).toBeVisible();
  await panel.getByRole('tab', { name: 'Invite a Helper' }).click();
  await expect(panel.getByText('01 · INVITE', { exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Network access and work overview' })).toBeVisible();
});

test('Helpers, switch on: one title, the state word on the left edge, no label above a heading', async ({
  page,
}) => {
  await open(page, '/operator/network', { v41: true });
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Helpers');
  const panel = page.locator('#workspace-network');
  await expect(panel.locator('header.ux-network-heading')).toHaveCount(0);
  await expect(page.getByText('CORRIDRA NETWORK', { exact: true })).toHaveCount(0);
  await expect(
    panel.getByText('Invite the right person. Define the work. Review the evidence.'),
  ).toHaveCount(0);
  await expectReadersOnly(page, 'Assigned work');
  // The state is a status badge (a capsule with its word), not a bordered box that reads as a button.
  const state = panel.locator('.ux-helpers-state .ux-status');
  await expect(state).toHaveText('Helpers on');
  await expect(state).toHaveAttribute('data-tone', 'positive');
  await expect(panel.locator('.ux-network-state')).toHaveCount(0);
  // The state word starts where the tabs under it start: the left edge of the content column.
  const stateBox = await state.boundingBox();
  const tabsBox = await panel.getByRole('tablist', { name: 'Network sections' }).boundingBox();
  expect(Math.abs(stateBox!.x - tabsBox!.x)).toBeLessThanOrEqual(1);
  // The button-styled link is written in Title Case; it opens the same address.
  const access = panel.getByRole('link', { name: 'Open Assigned Task Access' });
  await expect(access).toBeVisible();
  expect(await access.getAttribute('href')).toMatch(/^\/contributor\?workspace=/);
  // The link to a list that is not on the page with the team shell on is gone, and so are the links to
  // places the menu already has. The authenticator check has no menu entry and keeps its one link.
  await expect(panel.locator('a[href="#workspace-navigation"]')).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Open missions' })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Open sources and claims' })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Verify current access' })).toHaveAttribute(
    'href',
    '#workspace-authenticator',
  );
  await panel.getByRole('tab', { name: 'Invite a Helper' }).click();
  await expect(panel.getByText('01 · INVITE', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Invite a helper' })).toBeVisible();
  const overview = panel.getByRole('link', { name: 'Helper Access and Work Overview' });
  await expect(overview).toBeVisible();
  expect(await overview.getAttribute('href')).toBe('/network');
});

test('Helpers, switch on, no task: the empty state is in the open with one example and no control', async ({
  page,
}) => {
  await open(page, '/operator/network', { v41: true });
  const block = page.locator('#workspace-network .ux-helpers-empty');
  await expect(block).toBeVisible();
  await expect(block.getByRole('heading', { name: 'Current disclosed tasks' })).toBeVisible();
  // The sentence the desk already shows, word for word.
  await expect(block).toContainText(
    'No disclosed tasks are recorded in this workspace. Eligibility and exact assignment remain required before work can start.',
  );
  await expect(block.locator('.ux-example-tag')).toHaveText('Sample');
  await expect(block.locator('.ux-helpers-example')).toContainText(
    'A task could read: “Visit the supplier’s factory, photograph the production line and send the photographs within five working days.” This shows the wording only. It is not a record.',
  );
  // An example is words: nothing to press, type in or follow, and no fold that hides it.
  await expect(block.locator('a, button, input, select, textarea, summary')).toHaveCount(0);
  await expect(page.getByText('Disclosed tasks in this workspace (0)')).toHaveCount(0);
  // The example invents no record: no date, no amount, no named company or person.
  const words = await block.locator('.ux-helpers-example').innerText();
  expect(words).not.toMatch(/\d/);
});

test('Helpers, switch on, with a task: the list is the one the desk has today and no example shows', async ({
  page,
}) => {
  await open(page, '/operator/network', { v41: true, tasks: [task] });
  const panel = page.locator('#workspace-network');
  await expect(panel.locator('.ux-helpers-empty')).toHaveCount(0);
  await expect(panel.locator('.ux-example-tag')).toHaveCount(0);
  await panel.getByText('Disclosed tasks in this workspace (1)').click();
  await expect(panel.getByText('Invented instructions for a sample task.')).toBeVisible();
});

test('Helpers, switch on, paused: the state word and the paused note both show', async ({
  page,
}) => {
  await open(page, '/operator/network', { v41: true, enabled: false });
  const panel = page.locator('#workspace-network');
  const state = panel.locator('.ux-helpers-state .ux-status');
  await expect(state).toHaveText('Helpers paused');
  await expect(state).toHaveAttribute('data-tone', 'caution');
  const note = panel.getByRole('complementary', { name: 'Network readiness' });
  await expect(note).toBeVisible();
  await expect(note.getByRole('heading')).toHaveText(/^Helpers are paused in /);
  // The workspace picker is in the menu; the page has no second control for it.
  await expect(panel.getByRole('button', { name: 'Choose Workspace' })).toHaveCount(0);
  await expect(panel).not.toContainText(/Network (is )?(enabled|paused)/);
  // Off, the words and the control are the ones the desk has today.
  await open(page, '/operator/network', { v41: false, enabled: false });
  await expect(panel.getByRole('button', { name: 'Choose Workspace' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: /^Network is paused in / })).toBeVisible();
});

test('Helpers: the helper interest list is drawn here with the switch off and not with it on', async ({
  page,
}) => {
  // With the switch on the Inbox is its one home, so Helpers does not draw a second copy.
  await open(page, '/operator/network', { v41: false });
  const panel = page.locator('#workspace-network');
  await panel.getByRole('tab', { name: 'Invite a Helper' }).click();
  await expect(panel.locator('details.receipt-disclosure')).toHaveCount(1);
  await expect(panel.locator('details.receipt-disclosure')).toBeVisible();
  await open(page, '/operator/network', { v41: true });
  await panel.getByRole('tab', { name: 'Invite a Helper' }).click();
  await expect(panel.getByRole('heading', { name: 'Invite a helper' })).toBeVisible();
  await expect(panel.locator('details.receipt-disclosure')).toHaveCount(0);
});

test('Helpers: field names and ids are the same with the switch off and on', async ({ page }) => {
  await open(page, '/operator/network', { v41: false });
  const before = await namesAndIds(page, '#workspace-network');
  await open(page, '/operator/network', { v41: true });
  const after = await namesAndIds(page, '#workspace-network');
  expect(before.length).toBeGreaterThan(10);
  expect(after).toEqual(before);
});

// D15 Status ----------------------------------------------------------------------------------------------

const statusPages = [
  ['operations', 'Operations', 'Mission Operations dashboard'],
  ['dashboard', 'Dashboard', 'Mission Operations dashboard'],
  ['health', 'Health', 'Recovery and health'],
  ['readiness', 'Readiness', 'Production readiness and activation'],
] as const;

test('Status, switch off: the body is the one the desk has today', async ({ page }) => {
  await open(page, '/operator/readiness', { v41: false });
  const heading = page.locator('#workspace-operations .ops-heading h2');
  await expect(heading).toHaveText('Global operations');
  await expect(heading).not.toHaveClass(/sr-only/);
  await expect(heading).toBeVisible();
  await expect(page.locator('#workspace-operations .ops-heading button')).toHaveText(
    'Refresh Operations',
  );
  await expect(
    page.getByRole('heading', { name: 'Production readiness and activation' }),
  ).toBeVisible();
  const back = page.locator('#ops-gates').getByRole('link', {
    name: 'Return to workspace navigation',
  });
  await expect(back).toBeVisible();
  expect(await back.getAttribute('href')).toBe('#workspace-navigation');
});

for (const [slug, label, heading] of statusPages) {
  test(`Status, switch on: ${label} is a segment of Status with its own body`, async ({ page }) => {
    await open(page, `/operator/${slug}`, { v41: true });
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Status');
    const links = segments(page).getByRole('link');
    await expect(links).toHaveText(['Operations', 'Dashboard', 'Health', 'Readiness']);
    await expect(segments(page).locator('[aria-current="page"]')).toHaveText(label);
    // Every address stays.
    expect(
      await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href'))),
    ).toEqual(
      ['operations', 'dashboard', 'health', 'readiness'].map((word) =>
        expect.stringMatching(new RegExp(`^/operator/${word}(\\?|$)`)),
      ),
    );
    // Each Status page has its own name in the outline, the one its segment shows.
    await expectReadersOnly(page, label);
    await expect(page.getByRole('heading', { name: 'Global operations' })).toHaveCount(0);
    // The segment names the page; the old heading of the page stays for screen readers only.
    await expectReadersOnly(page, heading);
    await expect(
      page.locator('#workspace-operations :is(h2, h3):not(.sr-only):visible'),
    ).toHaveCount(0);
    // The link to a list that is not on the page with the team shell on is gone.
    await expect(page.getByRole('link', { name: 'Return to workspace navigation' })).toHaveCount(0);
    await expect(page.locator('a[href="#workspace-navigation"]:visible')).toHaveCount(
      // The shared panels of other places keep theirs until their own unit; none is in this body.
      0,
    );
    // The load control is the one the desk has, on the left edge of the body.
    const load = page.locator('#workspace-operations .ops-heading button');
    // The desk loads the records on arrival; the control then offers a refresh.
    await expect(load).toHaveText('Refresh Status');
    const loadBox = await load.boundingBox();
    const bodyBox = await page.locator('#workspace-operations > p').first().boundingBox();
    expect(Math.abs(loadBox!.x - bodyBox!.x)).toBeLessThanOrEqual(1);
  });
}

test('Status: a route in the next actions has each place mark before its name with the switch on', async ({
  page,
}) => {
  await open(page, '/operator/operations', { v41: false });
  await page.getByRole('tab', { name: 'Next actions' }).click();
  const row = page.locator('#ops-dashboard .ux-next-action li').first();
  await expect(row).toContainText('Bangladesh to Germany');
  await expect(row.locator('.ux-flag')).toHaveCount(0);
  await open(page, '/operator/operations', { v41: true });
  await page.locator('#ops-dashboard summary', { hasText: 'Next actions' }).click();
  // Bangladesh is one of the nine flags; Germany has none, so it shows its name only. Never a flag alone.
  await expect(row.locator('.ux-route-line')).toHaveText(/Bangladesh\s+to\s+Germany/);
  await expect(row.locator('.ux-flag')).toHaveCount(1);
  await expect(row.locator('.ux-flag')).toHaveAttribute('data-flag', 'bd');
  await expect(row.locator('.ux-flag')).toHaveAttribute('aria-hidden', 'true');
  // The mission link and the rest of the line are as they were.
  await expect(row.getByRole('link', { name: 'Invented Machinery Co' })).toBeVisible();
  await expect(row).toContainText('Owner:');
});

const dashboardTabs = ['Summary', 'Next actions', 'Money', 'Records and notes'];

test('Status, switch off: Operations and Dashboard both draw the four dashboard tabs, as today', async ({
  page,
}) => {
  for (const slug of ['operations', 'dashboard']) {
    await open(page, `/operator/${slug}`, { v41: false });
    await expect(
      page.getByRole('tablist', { name: 'Dashboard sections' }).getByRole('tab'),
    ).toHaveText(dashboardTabs);
  }
  await page.getByRole('tab', { name: 'Next actions' }).click();
  await expect(page.getByRole('link', { name: 'Open mission review queue' })).toHaveAttribute(
    'href',
    '#workspace-missions',
  );
  await open(page, '/operator/health', { v41: false });
  await expect(
    page.locator('#ops-health').getByRole('link', { name: 'Mission operations' }),
  ).toHaveAttribute('href', '#workspace-missions');
});

test('Status, switch on: Operations has the summary, next actions and records; Dashboard has the money', async ({
  page,
}) => {
  await open(page, '/operator/operations', { v41: true });
  // Status has segments under its title, so the three parts are sections of one page, not a second tab row:
  // the first in the open, each later one a closed fold that keeps its content in the page.
  await expect(page.locator('#workspace-operations [role="tablist"]')).toHaveCount(0);
  await expect(page.locator('#workspace-operations [role="tab"]')).toHaveCount(0);
  const sections = page.locator('#ops-dashboard [data-desk-section]');
  expect(
    await sections.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-desk-section')),
    ),
  ).toEqual(['dash-summary', 'dash-actions', 'dash-records']);
  const tabs = page.locator('#ops-dashboard details[data-desk-section] > summary');
  await expect(tabs).toHaveText(['Next actions', 'Records and notes']);
  await expect(page.locator('#ops-dashboard .operations-metrics').first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Recorded next actions on this page' }),
  ).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Corridra fee revenue and delivery economics' }),
  ).toHaveCount(0);
  // Each fold opens its own content.
  await tabs.nth(0).click();
  await expect(
    page.getByRole('heading', { name: 'Recorded next actions on this page' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open mission review queue' })).toHaveCount(0);

  await open(page, '/operator/dashboard', { v41: true });
  // One part alone is drawn as its content: no row of tabs with a single tab in it.
  await expect(page.getByRole('tablist', { name: 'Dashboard sections' })).toHaveCount(0);
  await expect(page.locator('#ops-dashboard [role="tab"]')).toHaveCount(0);
  await expect(page.locator('#ops-dashboard .ux-desk-lone-tab')).toBeVisible();
  await expect(page.locator('#ops-dashboard .ops-money').first()).toBeVisible();
  await expect(page.locator('#ops-dashboard .operations-metrics')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Recorded next actions on this page' }),
  ).toHaveCount(0);
  // The filters and the scope line are on both pages.
  await expect(page.getByText('Filter the records (10 filters)')).toBeVisible();
  // The scope is said in plain words; the stored sentence written for engineers is not drawn.
  await expect(
    page.getByText('These counts cover every mission in this workspace that matches the filters.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText('Invented scope line.')).toHaveCount(0);
});

test('Status, switch on: nothing is lost by the split, every dashboard part is on one of the two pages', async ({
  page,
}) => {
  const parts = (target: Page) =>
    target
      .locator('#ops-dashboard')
      .evaluate((node) =>
        Array.from(
          node.querySelectorAll('h4, summary, table caption, [aria-label]:not([role="tablist"])'),
        ).map((part) => part.getAttribute('aria-label') || part.textContent?.trim() || ''),
      );
  await open(page, '/operator/dashboard', { v41: false });
  const before = new Set(await parts(page));
  await open(page, '/operator/operations', { v41: true });
  const operations = await parts(page);
  await open(page, '/operator/dashboard', { v41: true });
  const dashboard = await parts(page);
  const after = new Set([...operations, ...dashboard]);
  expect(before.size).toBeGreaterThan(8);
  // The tab row itself is the only thing not drawn on Dashboard; every heading, fold and table is kept.
  // The fold of further counts is kept with plain words in its label.
  const plain = (part: string) =>
    part.replace(
      'more counts: denominators, unknown values and timing',
      'more counts, with totals, unknown values and timing',
    );
  for (const part of before) expect(after.has(plain(part)), `kept: ${part}`).toBe(true);
});

test('Status, switch on: Health names the other places in plain words, with no second link to a menu place', async ({
  page,
}) => {
  await open(page, '/operator/health', { v41: true });
  const health = page.locator('#ops-health');
  await expect(health).toContainText(
    'Continue manual missions in Missions, review failed drafts in Settings, Assistance, check helper disputes in Helpers and retry publication in Reports.',
  );
  await expect(health.locator('a[href^="#workspace-"]')).toHaveCount(0);
});

test('Status, switch on: an address that names a tab opens the page that holds it', async ({
  page,
}) => {
  // The fixture keeps the switch for the tab, so these are plain addresses, as an old link has them.
  await open(page, '/operator/health', { v41: true });
  await page.goto(`${fixture.origin}/operator/operations?tab=dash-money`);
  await expect(page).toHaveURL(/\/operator\/dashboard\?tab=dash-money$/);
  await expect(segments(page).locator('[aria-current="page"]')).toHaveText('Dashboard');
  await expect(page.locator('#ops-dashboard .ops-money').first()).toBeVisible();
  await page.goto(`${fixture.origin}/operator/dashboard?tab=dash-records`);
  await expect(page).toHaveURL(/\/operator\/operations\?tab=dash-records$/);
  await expect(segments(page).locator('[aria-current="page"]')).toHaveText('Operations');
  await expect(page.locator('#ops-dashboard [data-desk-section="dash-records"]')).toHaveAttribute(
    'open',
    '',
  );
  await expect(
    page.locator('#ops-dashboard [data-desk-section="dash-actions"]'),
  ).not.toHaveAttribute('open', '');
  // An address that already names its own page stays where it is.
  await page.goto(`${fixture.origin}/operator/operations?tab=dash-actions`);
  await expect(page.locator('#ops-dashboard [data-desk-section="dash-actions"]')).toHaveAttribute(
    'open',
    '',
  );
  await expect(page).toHaveURL(/\/operator\/operations\?tab=dash-actions$/);
});

test('Status, switch off: an address that names a tab opens that tab where it is, as today', async ({
  page,
}) => {
  await open(page, '/operator/health', { v41: false });
  await page.goto(`${fixture.origin}/operator/operations?tab=dash-money`);
  await expect(page.getByRole('tab', { name: 'Money' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/operator\/operations\?tab=dash-money$/);
});

/** Waits until the workspace has read the address and loaded, and no further page load is under way. */
async function settled(page: Page) {
  await expect(page.getByLabel('Workspace status')).toBeAttached();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
  await page.waitForLoadState('load');
}

test('Status, switch on: #dash-money on Operations opens Dashboard with Money', async ({
  page,
}) => {
  await open(page, '/operator/health', { v41: true });
  await page.goto(`${fixture.origin}/operator/operations#dash-money`);
  await expect(page).toHaveURL(/\/operator\/dashboard\?tab=dash-money$/);
  await expect(segments(page).locator('[aria-current="page"]')).toHaveText('Dashboard');
  await expect(page.locator('#ops-dashboard .ops-money').first()).toBeVisible();
  await expect(page.locator('#ops-dashboard [data-desk-section="dash-summary"]')).toHaveCount(0);
});

test('Status, switch on: #dash-money on Dashboard selects Money', async ({ page }) => {
  await open(page, '/operator/health', { v41: true });
  await page.goto(`${fixture.origin}/operator/dashboard#dash-money`);
  await expect(page).toHaveURL(/\/operator\/dashboard\?tab=dash-money$/);
  await expect(segments(page).locator('[aria-current="page"]')).toHaveText('Dashboard');
  await expect(page.locator('#ops-dashboard .ops-money').first()).toBeVisible();
});

test('Status, switch on: #dash-summary on Dashboard opens Operations with Summary', async ({
  page,
}) => {
  await open(page, '/operator/health', { v41: true });
  await page.goto(`${fixture.origin}/operator/dashboard#dash-summary`);
  await expect(page).toHaveURL(/\/operator\/operations\?tab=dash-summary$/);
  await expect(segments(page).locator('[aria-current="page"]')).toHaveText('Operations');
  await expect(page.locator('#ops-dashboard [data-desk-section="dash-summary"]')).toBeVisible();
  await expect(page.locator('#ops-dashboard .operations-metrics').first()).toBeVisible();
  await expect(page.locator('#ops-dashboard .ops-money')).toHaveCount(0);
});

test('Status, switch on: a # tab wins over ?tab= and the address is moved once', async ({
  page,
}) => {
  await open(page, '/operator/health', { v41: true });
  let loads = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) loads += 1;
  });
  await page.goto(`${fixture.origin}/operator/operations?tab=dash-records#dash-money`);
  await expect(page).toHaveURL(/\/operator\/dashboard\?tab=dash-money$/);
  await expect(page.locator('#ops-dashboard .ops-money').first()).toBeVisible();
  await settled(page);
  // The address as typed, then the page that holds the tab: no further move.
  expect(loads).toBe(2);
  // The workspace home names no page: the tab's page is named by its # part.
  loads = 0;
  await page.goto(`${fixture.origin}/operator#dash-records`);
  await expect(page).toHaveURL(/\/operator\?tab=dash-records#workspace-operations$/);
  await expect(page.locator('#ops-dashboard [data-desk-section="dash-records"]')).toHaveAttribute(
    'open',
    '',
  );
  await settled(page);
  expect(loads).toBe(2);
});

test('Status, switch off: #dash-money opens the Money tab where it is', async ({ page }) => {
  await open(page, '/operator/health', { v41: false });
  await page.goto(`${fixture.origin}/operator/operations#dash-money`);
  await expect(page).toHaveURL(/\/operator\/operations\?tab=dash-money$/);
  await expect(page.getByRole('tab', { name: 'Money' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ops-dashboard .ops-money').first()).toBeVisible();
});

test('Status: #dash-money shows no money to a role that cannot open Operations or Dashboard', async ({
  page,
}) => {
  // A reviewer has neither page today, so no address may show the money to one.
  for (const v41 of [true, false]) {
    await open(page, '/operator/health', { v41, role: 'reviewer' });
    const reads: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/workspace\/operations-/.test(request.url())) reads.push(request.url());
    });
    for (const path of ['/operator/operations#dash-money', '/operator/dashboard#dash-money']) {
      await page.goto(`${fixture.origin}${path}`);
      await settled(page);
      await expect(page).toHaveURL(`${fixture.origin}${path}`);
      await expect(page.locator('#ops-dashboard')).toHaveCount(0);
      await expect(page.locator('.ops-money')).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Money' })).toHaveCount(0);
      await expect(page.getByText('12500')).toHaveCount(0);
    }
    expect(reads).toEqual([]);
  }
});

test('Status: counts carry plain labels and place names carry their marks with the switch on', async ({
  page,
}) => {
  await open(page, '/operator/operations', { v41: false });
  await expect(page.locator('#ops-dashboard .operations-metrics dt').first()).toHaveText(
    'submitted',
  );
  await expect(page.locator('#ops-dashboard select[name="route"] option').nth(1)).toHaveText(
    'BD → DE',
  );
  await page.getByRole('tab', { name: 'Money' }).click();
  const feeRow = page.getByRole('region', { name: 'Corridra financial observations' });
  await expect(feeRow.locator('tbody td').first()).toHaveText('BD');
  await expect(feeRow.locator('.ux-flag')).toHaveCount(0);

  await open(page, '/operator/operations', { v41: true });
  await expect(page.locator('#ops-dashboard .operations-metrics dt').first()).toHaveText(
    'Submitted',
  );
  await expect(page.locator('#ops-dashboard .ux-desk-summary-note')).toHaveText(
    'Submitted is every mission that matches the filters. The other counts are parts of it.',
  );
  // An option holds words only: the place names, no picture.
  await expect(page.locator('#ops-dashboard select[name="route"] option').nth(1)).toHaveText(
    'Bangladesh → Germany',
  );
  expect(
    await page.locator('#ops-dashboard select[name="route"] option').nth(1).getAttribute('value'),
  ).toBe('00000000-0000-4000-8000-0000000000d1');
  await open(page, '/operator/dashboard', { v41: true });
  const cells = page
    .getByRole('region', { name: 'Corridra financial observations' })
    .locator('tbody td');
  await expect(cells.nth(0)).toHaveText('Bangladesh');
  await expect(cells.nth(0).locator('.ux-flag')).toHaveAttribute('data-flag', 'bd');
  await expect(cells.nth(1)).toHaveText('European Union');
  await expect(cells.nth(1).locator('.ux-flag')).toHaveAttribute('data-flag', 'eu');
  // The amount is the stored value, untouched.
  await expect(page.getByRole('region', { name: 'Corridra financial observations' })).toContainText(
    '12500',
  );
});

test('Status, switch on: on a phone the four segments stay in one row', async ({ page }) => {
  await open(page, '/operator/readiness', { v41: true, width: 375, height: 812 });
  const tops = await segments(page)
    .getByRole('link')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
  expect(tops).toHaveLength(4);
  expect(new Set(tops).size).toBe(1);
  const sizes = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    view: document.documentElement.clientWidth,
  }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.view);
  // The last segment can be brought into view inside the row.
  const last = segments(page).getByRole('link', { name: 'Readiness' });
  await last.scrollIntoViewIfNeeded();
  const box = await last.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
});

test('Status: field names and ids are the same with the switch off and on', async ({ page }) => {
  await open(page, '/operator/dashboard', { v41: false });
  const before = await namesAndIds(page, '#workspace-operations');
  await open(page, '/operator/dashboard', { v41: true });
  const after = await namesAndIds(page, '#workspace-operations');
  expect(before.length).toBeGreaterThan(10);
  expect(after).toEqual(before);
});

// D16 Team and access -------------------------------------------------------------------------------------

test('Team and access, switch off: the bodies are the ones the desk has today', async ({
  page,
}) => {
  await open(page, '/operator/audit', { v41: false });
  const audit = page.locator('#workspace-audit');
  await expect(audit.locator('.ux-panel-heading .eyebrow')).toHaveText('Settings and access');
  await expect(audit.locator('.ux-panel-heading h2')).toHaveText('Access and audit');
  await expect(
    audit.getByText('See who has access and what changed in this workspace.'),
  ).toBeVisible();
  // The action is on the right of its line, as today.
  const button = audit.getByRole('button', { name: 'Load Access and Recent Changes' });
  const line = audit.locator('.ux-audit-toolbar p');
  expect((await button.boundingBox())!.x).toBeGreaterThan((await line.boundingBox())!.x + 100);
  await button.click();
  await expect(audit.getByRole('heading', { name: 'Workspace members' })).toBeVisible();
  await expect(page.getByLabel('Workspace status')).toHaveText('Saved.');
  await open(page, '/operator/controls', { v41: false });
  const controls = page.locator('#workspace-controls');
  await expect(controls.locator('.ux-controls-heading .eyebrow')).toHaveText('Workspace settings');
  await expect(controls.locator('.ux-controls-heading h2')).toHaveText('Workspace controls');
  // The page title says Workspace controls here, so the panel's copy is for screen readers only (audit F10).
  await expect(page.locator('h1')).toHaveText('Workspace controls');
  // The server marks the page, so the copy is one pixel from the first paint (operator-overview.css).
  await expect(page.locator('main#main')).toHaveClass(/ux-titled-workspace-controls/);
  const kept = await controls.locator('.ux-controls-heading h2').boundingBox();
  expect(kept!.width).toBeLessThanOrEqual(1);
  expect(kept!.height).toBeLessThanOrEqual(1);
});

// A name is printed once (audit of 25 November 2026, F10 and F13) ---------------------------------------

/** The headings in <main> that can be seen (not the one-pixel ones kept for screen readers) and say `words`. */
const seenHeadings = (page: Page, words: string) =>
  page.locator('main#main').evaluate(
    (main, text) =>
      Array.from(main.querySelectorAll('h1, h2, h3, h4'))
        .filter((heading) => (heading.textContent ?? '').trim() === text)
        .filter((heading) => {
          const box = heading.getBoundingClientRect();
          return box.width > 1 && box.height > 1;
        })
        .map((heading) => heading.tagName),
    words,
  );
for (const [slug, title, panelHeading] of [
  ['operations', 'Global operations', '#workspace-operations .ops-heading h2'],
  ['health', 'Recovery and health', '#ops-health > h3'],
  ['audit', 'Access and audit', '#workspace-audit .ux-panel-heading h2'],
  ['controls', 'Workspace controls', '#workspace-controls .ux-controls-heading h2'],
  ['sources', 'Sources and claims', '#workspace-sources .ux-panel-heading h2'],
  ['delivery', 'Reports', '#workspace-delivery h2'],
] as const) {
  test(`switch off: /operator/${slug} prints "${title}" once, and the panel keeps its heading for screen readers`, async ({
    page,
  }) => {
    await open(page, `/operator/${slug}`, { v41: false });
    await expect(page.locator('h1')).toHaveText(title);
    await expect.poll(() => seenHeadings(page, title)).toEqual(['H1']);
    // The panel heading is still in the outline, with the same words, one pixel on the page.
    const kept = page.locator(panelHeading).first();
    await expect(kept).toHaveText(title);
    const box = await kept.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(1);
    expect(box!.height).toBeLessThanOrEqual(1);
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(2);
  });
}

test('switch off: a panel heading the page title does not say stays in view', async ({ page }) => {
  // On Health the title is Recovery and health, so the heading of the whole Status body is not a repeat.
  await open(page, '/operator/health', { v41: false });
  expect(await seenHeadings(page, 'Global operations')).toEqual(['H2']);
  // The label, the icon and the line of a panel heading stay when only its name is a repeat.
  await open(page, '/operator/audit', { v41: false });
  const audit = page.locator('#workspace-audit');
  await expect(audit.locator('.ux-panel-heading .eyebrow')).toBeVisible();
  await expect(
    audit.getByText('See who has access and what changed in this workspace.'),
  ).toBeVisible();
});

for (const v41 of [false, true]) {
  test(`Reports, switch ${v41 ? 'on' : 'off'}: the panel is named Reports, never by a third name`, async ({
    page,
  }) => {
    await open(page, '/operator/delivery', { v41 });
    await expect(page.locator('h1')).toHaveText('Reports');
    await expect(page.locator('#workspace-delivery h2').first()).toHaveText('Reports');
    await expect(page.locator('main#main').getByText('Client and programme delivery')).toHaveCount(
      0,
    );
  });
}

// Sources and claims (audit F15) ------------------------------------------------------------------------

const intakeId = '2db88616-465f-4935-8a51-0000000000e1';
const sourceRows = [
  {
    id: '00000000-0000-4000-8000-0000000000e1',
    kind: 'self_declaration',
    locator: `Mission intake ${intakeId}; notice synthetic-intake-2026-10-05-v1`,
    mission_name: 'Invented Machinery Co',
    organisation_name: null,
  },
  {
    id: '00000000-0000-4000-8000-0000000000e2',
    kind: 'public_record',
    locator: `${intakeId}`,
    mission_name: null,
    organisation_name: null,
  },
  {
    id: '00000000-0000-4000-8000-0000000000e3',
    kind: 'observation',
    locator: 'Invented trade fair catalogue, page 4',
    mission_name: null,
    organisation_name: 'Invented Foods Co',
  },
];
for (const v41 of [false, true]) {
  test(`Sources, switch ${v41 ? 'on' : 'off'}: a source is listed by a readable name; its full description and reference stay behind Source reference`, async ({
    page,
  }) => {
    await open(page, '/operator/sources', { v41, sources: sourceRows });
    const rows = page.locator('#workspace-sources > section').first().locator('ul > li');
    await expect(rows).toHaveCount(3);
    // No record id is in view until a person opens the reference.
    expect(
      await rows.evaluateAll((items) =>
        items.map((item) =>
          Array.from(item.childNodes)
            .filter((node) => !(node instanceof HTMLDetailsElement))
            .map((node) => node.textContent)
            .join('')
            .trim(),
        ),
      ),
    ).toEqual([
      'Mission intake · Mission: Invented Machinery Co',
      'Existing public record',
      'Invented trade fair catalogue, page 4 · Company: Invented Foods Co',
    ]);
    await expect(rows.first().getByText(intakeId)).toBeHidden();
    await rows.first().getByText('Source reference', { exact: true }).click();
    await expect(
      rows
        .first()
        .getByText(
          `Full description: Mission intake ${intakeId}; notice synthetic-intake-2026-10-05-v1`,
        ),
    ).toBeVisible();
    const reference = rows.first().locator('.ux-copy-reference code');
    await expect(reference).toHaveText(sourceRows[0]!.id);
    // The reference is text of the scale (14 px), not a fraction of the text around it (it was 12.9 px).
    expect(await reference.evaluate((node) => getComputedStyle(node).fontSize)).toBe('14px');
    // A description a person wrote is the name already, so it is not printed a second time.
    await rows.nth(2).getByText('Source reference', { exact: true }).click();
    await expect(rows.nth(2).getByText('Full description')).toHaveCount(0);
    // The source a claim is recorded against is chosen by the full description, as before.
    await expect(page.locator('#workspace-sources select[name="source"] option')).toHaveText([
      'Choose a source',
      ...sourceRows.map((row) => row.locator),
    ]);
  });
}

test('switch on: /operator/sources links each destination once', async ({ page }) => {
  await open(page, '/operator/sources', { v41: true, sources: sourceRows });
  await expect(page.locator('#workspace-sources ul > li')).toHaveCount(3);
  const destinations = await destinationsInView(page);
  expect(
    destinations.filter((value, index) => destinations.indexOf(value) !== index),
    `links in main are ${JSON.stringify(destinations)}`,
  ).toEqual([]);
});

test('Team and access, switch on: Audit has one title and its one action on the left edge', async ({
  page,
}) => {
  await open(page, '/operator/audit', { v41: true });
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Team and access');
  await expect(segments(page).getByRole('link')).toHaveText(['People and access', 'Audit']);
  await expect(segments(page).locator('[aria-current="page"]')).toHaveText('Audit');
  const audit = page.locator('#workspace-audit');
  await expect(audit.locator('.ux-panel-heading')).toHaveCount(0);
  await expect(
    audit.getByText('See who has access and what changed in this workspace.'),
  ).toHaveCount(0);
  await expectReadersOnly(page, 'Access and audit');
  const button = audit.getByRole('button', { name: 'Load Access and Recent Changes' });
  const line = audit.locator('.ux-audit-toolbar p');
  const buttonBox = await button.boundingBox();
  const lineBox = await line.boundingBox();
  expect(Math.abs(buttonBox!.x - lineBox!.x)).toBeLessThanOrEqual(1);
  expect(buttonBox!.y).toBeGreaterThan(lineBox!.y);
  // One primary action in the body.
  await expect(audit.locator('.primary-link')).toHaveCount(1);
  await button.click();
  await expect(audit.getByRole('heading', { name: 'Workspace members' })).toBeVisible();
  // A read changes nothing, so it does not say "Saved."
  await expect(page.getByLabel('Workspace status')).toHaveText('Loaded.');
  // The paging buttons start on the left edge, under the count.
  const previous = audit.getByRole('button', { name: 'Previous Changes' });
  const count = audit.locator('.ux-audit-pagination p');
  expect(
    Math.abs((await previous.boundingBox())!.x - (await count.boundingBox())!.x),
  ).toBeLessThanOrEqual(1);
  // A membership state is a status word: it does not wear the action fill.
  const active = audit.locator('.ux-record-state.is-active').first();
  await expect(active).toHaveText('Active membership');
  const colours = await active.evaluate((node) => {
    const probe = document.createElement('span');
    probe.className = 'primary-link';
    document.body.append(probe);
    const action = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { state: getComputedStyle(node).backgroundColor, action };
  });
  expect(colours.state).not.toBe(colours.action);
});

test('Team and access, switch on: People and access has one title; member and role editing is untouched', async ({
  page,
}) => {
  await open(page, '/operator/controls', { v41: false });
  const before = await namesAndIds(page, '#workspace-controls');
  const forms = (target: Page) =>
    target
      .locator('#workspace-controls')
      .evaluate((node) =>
        Array.from(node.querySelectorAll('form')).map((form) =>
          form.outerHTML.replace(/[:«][^"\s]*[:»]|_r_\w+?_/g, ''),
        ),
      );
  const formBefore = await forms(page);
  await expect(page.getByRole('tab', { name: 'Invite a team member' })).toBeVisible();
  await expect(page.locator('#workspace-members-heading')).not.toHaveClass(/sr-only/);
  await open(page, '/operator/controls', { v41: true });
  await expect(page.locator('h1')).toHaveText('Team and access');
  await expect(segments(page).locator('[aria-current="page"]')).toHaveText('People and access');
  await expectReadersOnly(page, 'Workspace controls');
  const controls = page.locator('#workspace-controls');
  await expect(controls.getByText('Workspace settings', { exact: true })).toHaveCount(0);
  await expect(controls.locator('.ux-controls-owner')).toHaveText('Owner access');
  await expect(controls.getByRole('link', { name: 'Verify your authenticator' })).toHaveAttribute(
    'href',
    '#workspace-authenticator',
  );
  expect(await namesAndIds(page, '#workspace-controls')).toEqual(before);
  // Every form of the page (member and role, authenticator reset, invitation) is the same markup,
  // element for element.
  const formAfter = await forms(page);
  expect(formBefore.length).toBeGreaterThanOrEqual(2);
  expect(formAfter).toEqual(formBefore);
  // The name of the page is in view once in the body (the tab); its heading is for screen readers and
  // still names the member section.
  await expect(page.locator('#workspace-members-heading')).toHaveClass(/sr-only/);
  await expect(controls.locator('.ux-controls-members')).toHaveAttribute(
    'aria-labelledby',
    'workspace-members-heading',
  );
  // One row under the title (the segments): the former tabs are parts of the page, the later ones folds.
  await expect(controls.locator('[role="tablist"], [role="tab"]')).toHaveCount(0);
  await expect(controls.locator('details[data-desk-section] > summary')).toHaveText([
    'Invite a Team Member',
    'Available tools',
  ]);
  // The tool list says Helpers, the word the menu uses; the setting it changes is the same.
  const helpers = controls.locator('[data-feature="network.enabled"]');
  await expect(helpers.locator('h5')).toHaveText('Helpers');
  await expect(controls).not.toContainText('Execution network');
  // The load control is on the left edge and a read does not say "Saved."
  const load = controls.getByRole('button', { name: 'Load Workspace Members' });
  const hint = controls.getByText('Change the role or access of an existing member.');
  expect(
    Math.abs((await load.boundingBox())!.x - (await hint.boundingBox())!.x),
  ).toBeLessThanOrEqual(1);
  await load.click();
  await expect(controls.getByRole('button', { name: 'Refresh Workspace Members' })).toBeVisible();
  await expect(page.getByLabel('Workspace status')).toHaveText('Loaded.');
});

test('Team and access, switch on: an admin sees Audit alone, with no segments and no People page', async ({
  page,
}) => {
  await open(page, '/operator/audit', { v41: true, role: 'admin' });
  await expect(page.locator('h1')).toHaveText('Team and access');
  await expect(segments(page)).toHaveCount(0);
  await expect(page.locator('#workspace-audit')).toBeVisible();
  await expect(page.locator('#workspace-controls')).toHaveCount(0);
});

// Every page, every width ---------------------------------------------------------------------------------

const places = [
  ['network', '#workspace-network'],
  ['operations', '#workspace-operations'],
  ['dashboard', '#workspace-operations'],
  ['health', '#workspace-operations'],
  ['readiness', '#workspace-operations'],
  ['audit', '#workspace-audit'],
  ['controls', '#workspace-controls'],
] as const;

for (const [slug, body] of places) {
  test(`switch on: /operator/${slug} fits every width, opens at the top and is axe clean`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    for (const width of widths) {
      await open(page, `/operator/${slug}`, { v41: true, width });
      await expect(page.locator(body)).toBeVisible();
      // No small label above a heading anywhere in the body.
      await expect(page.locator(`${body} :is(p.label, p.eyebrow):visible`)).toHaveCount(0);
      const sizes = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        view: document.documentElement.clientWidth,
        top: window.scrollY,
      }));
      expect(sizes.page, `no sideways scroll at ${width}`).toBeLessThanOrEqual(sizes.view);
      expect(sizes.top, `opens at the top at ${width}`).toBe(0);
      const results = await new AxeBuilder({ page }).include(body).analyze();
      expect(results.violations, `axe at ${width}`).toEqual([]);
    }
  });
}

test('switch on: touch targets in the Helpers empty state and the Audit action are at least 44 px on a phone', async ({
  page,
}) => {
  await open(page, '/operator/audit', { v41: true, width: 390, height: 844 });
  const button = page.getByRole('button', { name: 'Load Access and Recent Changes' });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await open(page, '/operator/network', { v41: true, width: 390, height: 844 });
  const access = page.getByRole('link', { name: 'Open Assigned Task Access' });
  expect((await access.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

// One link per destination (owner rule, 24 November 2026) ----------------------------------------------

// A `#section` link and the section's own address are one destination.
const sectionWords: Record<string, string> = {
  'workspace-missions': 'missions',
  'workspace-research': 'research',
  'workspace-meetings': 'meetings',
  'workspace-commercial': 'commercial',
  'workspace-delivery': 'delivery',
  'workspace-sources': 'sources',
  'workspace-evidence': 'evidence',
  'workspace-ai': 'assistance',
  'workspace-network': 'network',
  'workspace-operations': 'operations',
  'ops-dashboard': 'dashboard',
  'ops-center': 'control-center',
  'ops-health': 'health',
  'ops-gates': 'readiness',
  'workspace-settings': 'settings',
  'workspace-audit': 'audit',
  'workspace-authenticator': 'authenticator',
  'workspace-controls': 'controls',
};
/**
 * The destinations of the links in view inside <main>, one entry per link. No exception is named: with menu
 * v3 the workspace row and the second row of links are no longer in <main>.
 */
const destinationsInView = (page: Page) =>
  page.locator('main#main').evaluate((main, words) => {
    return Array.from(main.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .filter((link) => {
        const box = link.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(link).visibility !== 'hidden';
      })
      .map((link) => {
        const href = link.getAttribute('href') ?? '';
        if (href.startsWith('#')) {
          const word = words[href.slice(1)];
          return word ? `/operator/${word}` : href;
        }
        const url = new URL(href, location.origin);
        return url.pathname + url.hash;
      });
  }, sectionWords);
const menuPlaces = [
  '/operator',
  ...['missions', 'meetings', 'research', 'network', 'commercial', 'delivery'].map(
    (word) => `/operator/${word}`,
  ),
];

for (const [slug, body] of places) {
  test(`switch on: /operator/${slug} links each destination once and repeats no menu place`, async ({
    page,
  }) => {
    await open(page, `/operator/${slug}`, { v41: true, tasks: slug === 'network' ? [task] : [] });
    if (slug === 'audit')
      await page.getByRole('button', { name: 'Load Access and Recent Changes' }).click();
    if (slug === 'controls')
      await page.getByRole('button', { name: 'Load Workspace Members' }).click();
    // The screen as it opens, then each tab of the body in turn: every state is one screen.
    // A page with segments has no tab row: its later parts are folds, opened here one after the other.
    const tabs = page.locator(
      `${body} [role="tab"]:visible, ${body} details[data-desk-section] > summary:visible`,
    );
    const states = [null, ...(await tabs.evaluateAll((nodes) => nodes.map((_, index) => index)))];
    let seen = 0;
    for (const state of states) {
      if (state !== null) await tabs.nth(state).click();
      const destinations = await destinationsInView(page);
      seen += destinations.length;
      const twice = destinations.filter((value, index) => destinations.indexOf(value) !== index);
      expect(twice, `a destination linked twice (state ${state ?? 'open'})`).toEqual([]);
      // The menu is the one path to a menu place. The segments name sibling pages; nothing else does.
      const inBody = await page.locator(body).evaluate((node, words) => {
        return Array.from(node.querySelectorAll<HTMLAnchorElement>('a[href]'))
          .filter((link) => link.getBoundingClientRect().width > 0)
          .map((link) => {
            const href = link.getAttribute('href') ?? '';
            const word = href.startsWith('#') ? words[href.slice(1)] : undefined;
            return word ? `/operator/${word}` : href.split('?')[0];
          });
      }, sectionWords);
      for (const place of menuPlaces)
        expect(inBody, `no link to ${place} in the body`).not.toContain(place);
      expect(
        inBody.filter((href) =>
          /^\/operator\/(operations|dashboard|health|readiness|audit|controls)$/.test(href),
        ),
        'sibling pages are reached by the segments only',
      ).toEqual([]);
      await expect(
        page.locator(`${body} a`).filter({ hasText: /^Back to|^Return to/ }),
      ).toHaveCount(0);
    }
    // Links were found on every page, so the check is never empty.
    expect(seen).toBeGreaterThan(0);
  });
}

// The link back to the section list under every workspace panel: one owner for all seven (this unit).
const panelsWithBackLink = [
  'missions',
  'research',
  'meetings',
  'commercial',
  'delivery',
  'assistance',
  'network',
];
test('the link back to the section list: under each panel with the switch off, on no page with it on', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const slug of panelsWithBackLink) {
    await open(page, `/operator/${slug}`, { v41: false });
    const back = page.locator('main#main a[href="#workspace-navigation"]:visible');
    await expect(back, `off: /operator/${slug}`).toHaveCount(1);
    await expect(back).toHaveText('Back to workspace sections');
    await expect(back).toHaveClass('text-link');
    await open(page, `/operator/${slug}`, { v41: true });
    await expect(
      page.locator('main#main a[href="#workspace-navigation"]'),
      `on: /operator/${slug}`,
    ).toHaveCount(0);
    await expect(page.getByText('Back to workspace sections')).toHaveCount(0);
  }
});
