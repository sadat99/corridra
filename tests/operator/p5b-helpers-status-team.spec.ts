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
};
async function open(page: Page, path: string, options: Options) {
  const { v41, role = 'owner', width = 1440, height = 900, tasks = [], enabled = true } = options;
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
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/picker/**', (route) => route.fulfill({ json: [] }));
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
    route.fulfill({ json: { routes: [], packs: [] } }),
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
        ...empty(
          'corridraMoney',
          'economics',
          'customerTrade',
          'programmes',
          'repeat',
          'commercialActivityTotals',
        ),
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
  const state = panel.locator('.ux-helpers-state .ux-network-state');
  await expect(state).toHaveText('Network enabled');
  // The state word starts where the tabs under it start: the left edge of the content column.
  const stateBox = await state.boundingBox();
  const tabsBox = await panel.getByRole('tablist', { name: 'Network sections' }).boundingBox();
  expect(Math.abs(stateBox!.x - tabsBox!.x)).toBeLessThanOrEqual(1);
  // The button-styled link is written in Title Case; it opens the same address.
  const access = panel.getByRole('link', { name: 'Open Assigned Task Access' });
  await expect(access).toBeVisible();
  expect(await access.getAttribute('href')).toMatch(/^\/contributor\?workspace=/);
  // The link to a list that is not on the page with the team shell on is gone.
  await expect(panel.locator('a[href="#workspace-navigation"]')).toHaveCount(0);
  await panel.getByRole('tab', { name: 'Invite a Helper' }).click();
  await expect(panel.getByText('01 · INVITE', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Invite a helper' })).toBeVisible();
  const overview = panel.getByRole('link', { name: 'Network Access and Work Overview' });
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
  await expect(block.locator('.ux-example-tag')).toHaveText('Example');
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
  await expect(panel.locator('.ux-helpers-state .ux-network-state')).toHaveText('Network paused');
  await expect(panel.getByRole('complementary', { name: 'Network readiness' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Choose Workspace' })).toBeVisible();
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
    await expectReadersOnly(page, 'Global operations');
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    // The link to a list that is not on the page with the team shell on is gone.
    await expect(page.getByRole('link', { name: 'Return to workspace navigation' })).toHaveCount(0);
    await expect(page.locator('a[href="#workspace-navigation"]:visible')).toHaveCount(
      // The shared panels of other places keep theirs until their own unit; none is in this body.
      0,
    );
    // The load control is the one the desk has, on the left edge of the body.
    const load = page.locator('#workspace-operations .ops-heading button');
    // The desk loads the records on arrival; the control then offers a refresh.
    await expect(load).toHaveText('Refresh Operations');
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
  await page.getByRole('tab', { name: 'Next actions' }).click();
  // Bangladesh is one of the nine flags; Germany has none, so it shows its name only. Never a flag alone.
  await expect(row.locator('.ux-route-line')).toHaveText(/Bangladesh\s+to\s+Germany/);
  await expect(row.locator('.ux-flag')).toHaveCount(1);
  await expect(row.locator('.ux-flag')).toHaveAttribute('data-flag', 'bd');
  await expect(row.locator('.ux-flag')).toHaveAttribute('aria-hidden', 'true');
  // The mission link and the rest of the line are as they were.
  await expect(row.getByRole('link', { name: 'Invented Machinery Co' })).toBeVisible();
  await expect(row).toContainText('Owner:');
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
  await open(page, '/operator/controls', { v41: false });
  const controls = page.locator('#workspace-controls');
  await expect(controls.locator('.ux-controls-heading .eyebrow')).toHaveText('Workspace settings');
  await expect(controls.locator('.ux-controls-heading h2')).toHaveText('Workspace controls');
  await expect(controls.locator('.ux-controls-heading h2')).not.toHaveClass(/sr-only/);
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
  const formBefore = await page
    .locator('#workspace-controls .ux-controls-members')
    .evaluate((node) => node.innerHTML.replace(/[:«][^"\s]*[:»]|_r_\w+?_/g, ''));
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
  // The member and role section is the same markup, element for element.
  const formAfter = await controls
    .locator('.ux-controls-members')
    .evaluate((node) => node.innerHTML.replace(/[:«][^"\s]*[:»]|_r_\w+?_/g, ''));
  expect(formAfter).toBe(formBefore);
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
