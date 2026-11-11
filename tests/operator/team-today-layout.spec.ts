import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { fixtureTenant, startTodayFixture } from './team-today-fixture';

// Team Today redesign, Phase 1 (owner, 6 Nov 2026: "today page redesign"). The real overview (the team header,
// the team left bar, the workspace toolbar, Today with "Needs you now", "This week" and the Start card, and the
// quiet footer) is bundled from the source with the real stylesheets and the team shell switch on, and every
// read is answered by the same synthetic rows the operator Today test uses. Layout budget
// (docs/revamp/specs/layout-budget.md section 2): at most 1.0 screen at 1440 x 900 and 2.0 at 390 x 844, no
// sideways scroll at 320, 390, 768 and 1440, 44 px targets and axe clean.
const tenant = fixtureTenant;
// Screenshots go to the ignored cache, so a run never rewrites tracked evidence (KI-15).
const shots = '.cache/team-today';
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
let origin = '';

test.beforeAll(async () => {
  fixture = await startTodayFixture();
  origin = fixture.origin;
});
test.afterAll(async () => {
  await fixture.close();
});

type Row = { id: string; status: string; company: string; dueAt: string; market?: string };
const mission = ({ id, status, company, dueAt, market = 'China' }: Row) => ({
  id,
  status,
  due_at: dueAt,
  brief: { company, objective: 'Source suppliers', market },
});
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The rows of the operator Today test (tests/operator/zz-today.spec.ts): one new request, two late missions. */
const operatorRows = {
  fresh: [{ id: id(1), status: 'DRAFT', company: 'Invented Towels Ltd', dueAt: daysAgo(17) }],
  overdue: [
    { id: id(2), status: 'OUTREACH', company: 'Invented Machinery Co', dueAt: daysAgo(36) },
    { id: id(3), status: 'FOLLOW_UP', company: 'Invented Foods Co', dueAt: daysAgo(35) },
  ],
  totals: { fresh: 1, overdue: 2, open: 7 },
};
const meetings = {
  meetings: [
    {
      id: id(44),
      title: 'Invented buyer introduction',
      status: 'SCHEDULED',
      starts_at: inDays(2),
      due_at: inDays(2),
      location: 'Invented meeting room',
    },
    {
      id: id(55),
      title: 'Invented factory visit',
      status: 'RESCHEDULE_REQUIRED',
      starts_at: null,
      due_at: inDays(2),
      location: null,
    },
  ],
  followups: [
    { id: id(66), status: 'OPEN', due_at: daysAgo(7), next_action: 'Send invented samples' },
    { id: id(77), status: 'COMPLETED', due_at: daysAgo(7), next_action: 'Completed invented task' },
  ],
};

type Scenario = {
  fresh: Row[];
  overdue: Row[];
  totals: { fresh: number; overdue: number; open: number };
  meetings?: typeof meetings | { status: number };
  team?: {
    acceptedQuotesNotStarted: number;
    serviceRequestsToQuote: number;
    repliesToReview: number;
    unavailable?: string[];
  };
  teamStatus?: number;
  missionsStatus?: number;
};

async function open(page: Page, scenario: Scenario, query = '') {
  // Any other read (the hidden panels with the switch off) gets a plain refusal, never the fixture page.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  // The mission pages switch, read as the Missions panel reads it; `missions=off` turns it off.
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: !query.includes('missions=off') } }),
  );
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      json: {
        purpose: 'synthetic_validation',
        uploadsConfigured: false,
        scanMode: 'bypass',
        role: 'owner',
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) =>
    route.fulfill({
      json: [1, 2, 3].map((n) => ({
        id: id(900 + n),
        type: 'REQUEST_RECEIVED',
        payload: { title: 'Invented request' },
        readAt: null,
        createdAt: daysAgo(n),
      })),
    }),
  );
  // Only Today's own reads; the mission and meeting panels behind the switch get the plain refusal above.
  await page.route('**/api/workspace/missions?*view=today*', (route) => {
    if (scenario.missionsStatus)
      return route.fulfill({ status: scenario.missionsStatus, json: { error: 'Synthetic' } });
    const url = new URL(route.request().url());
    const draft = url.searchParams.get('stage') === 'DRAFT';
    const overdue = url.searchParams.get('filter') === 'overdue';
    const rows = draft ? scenario.fresh : overdue ? scenario.overdue : [];
    const total = draft
      ? scenario.totals.fresh
      : overdue
        ? scenario.totals.overdue
        : scenario.totals.open;
    return route.fulfill({ json: { missions: rows.map(mission), total } });
  });
  await page.route('**/api/workspace/meetings?*view=today*', (route) => {
    const answer = scenario.meetings ?? meetings;
    return 'status' in answer
      ? route.fulfill({ status: answer.status, json: { error: 'Synthetic' } })
      : route.fulfill({ json: answer });
  });
  await page.route('**/api/team-control/today?*', (route) =>
    scenario.teamStatus
      ? route.fulfill({ status: scenario.teamStatus, json: { error: 'Synthetic' } })
      : route.fulfill({
          json: scenario.team ?? {
            acceptedQuotesNotStarted: 0,
            serviceRequestsToQuote: 0,
            repliesToReview: 0,
          },
        }),
  );
  await page.goto(origin + query);
  await expect(page.getByRole('heading', { name: 'Start with a mission.' })).toBeVisible();
}
const today = (page: Page) => page.getByRole('region', { name: 'Today', exact: true });
const needs = (page: Page) => page.getByRole('region', { name: 'Needs you now' });
const loaded = async (page: Page) =>
  expect(today(page).getByRole('list', { name: 'Counts' })).toBeVisible();

/**
 * Every visible link, button, summary, select and segment of the team header and the page is at least 44 px
 * tall. The left bar has its own guard (tests/ux/left-nav.spec.ts) and the quiet footer is not part of this page.
 */
async function smallTargets(page: Page) {
  const targets = ':is(a[href], button, summary, select, .ux-segment)';
  return page.evaluate(
    (selector) =>
      Array.from(document.querySelectorAll(`header.ux-app-header ${selector}, main ${selector}`))
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .map((element) => ({
          text: (element.textContent ?? '').trim().slice(0, 40),
          height: Math.round(element.getBoundingClientRect().height),
        }))
        .filter((target) => target.height < 44),
    targets,
  );
}
async function axe(page: Page) {
  // From the top, so the sticky header does not cover the toolbar while axe measures target sizes.
  await page.evaluate(() => window.scrollTo(0, 0));
  return (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target}`);
}

test('with the operator fixtures Today fits one screen at 1440 x 900 and two at 390 x 844, without sideways scroll, with 44 px targets and axe clean', async ({
  page,
}) => {
  mkdirSync(shots, { recursive: true });
  const lengths: Record<string, number> = {};
  for (const [name, width, height, limit, scale] of [
    ['desktop', 1440, 900, 1.0, 1],
    ['phone', 390, 844, 2.0, 2],
  ] as const) {
    const context = await page
      .context()
      .browser()!
      .newContext({ viewport: { width, height }, deviceScaleFactor: scale });
    const view = await context.newPage();
    await open(view, operatorRows);
    await loaded(view);
    await expect(needs(view).getByText('Invented Towels Ltd')).toBeVisible();
    await view.evaluate(() => document.fonts.ready);
    // The document height can never be under one screen; the end of the footer shows the real length.
    const [screens, content] = await view.evaluate(() => [
      document.documentElement.scrollHeight / window.innerHeight,
      (document.querySelector('footer')!.getBoundingClientRect().bottom + window.scrollY) /
        window.innerHeight,
    ]);
    lengths[name] = Math.round(content * 1000) / 1000;
    expect(screens, `${name} page length in screens`).toBeLessThanOrEqual(limit);
    expect(content, `${name} content length in screens`).toBeLessThanOrEqual(limit);
    expect(await smallTargets(view)).toEqual([]);
    expect(await axe(view)).toEqual([]);
    await view.screenshot({ path: `${shots}/after-${width}.png`, fullPage: true });
    await context.close();
  }
  test.info().annotations.push({ type: 'page length', description: JSON.stringify(lengths) });
  console.log(`Team Today page length in screens: ${JSON.stringify(lengths)}`);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, operatorRows);
    await loaded(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      `sideways scroll at ${width}`,
    ).toBeLessThanOrEqual(0);
  }
});

test('Needs you now lists each new or late mission once, most overdue first, with its chips, filters and link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, {
    ...operatorRows,
    fresh: [
      ...operatorRows.fresh,
      // Both new and late: listed once, with both chips.
      { id: id(2), status: 'DRAFT', company: 'Invented Machinery Co', dueAt: daysAgo(36) },
    ],
    totals: { fresh: 2, overdue: 2, open: 7 },
  });
  await loaded(page);
  await expect(today(page)).toContainText('3 missions need you.');
  await expect(today(page)).toContainText('2 are new and 2 are past their due date.');
  const rows = needs(page).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Invented Machinery Co');
  await expect(rows.nth(0)).toContainText('New');
  await expect(rows.nth(0)).toContainText('36 days late');
  await expect(rows.nth(1)).toContainText('Invented Foods Co');
  await expect(rows.nth(1)).toContainText('35 days late');
  await expect(rows.nth(1)).toContainText('Follow-up');
  await expect(rows.nth(2)).toContainText('Invented Towels Ltd');
  await expect(rows.nth(2).locator('time')).toHaveAttribute('datetime', /.+/);
  await expect(rows.nth(2).getByRole('link')).toHaveAttribute(
    'href',
    `/operator/missions/${id(1)}?workspace=${tenant}`,
  );
  await expect(needs(page).getByRole('link', { name: 'Open Missions' })).toHaveAttribute(
    'href',
    '#workspace-missions',
  );
  const show = needs(page).getByRole('group', { name: 'Show' });
  await expect(show.getByRole('radio', { name: 'All 3' })).toBeChecked();
  await show.getByRole('radio', { name: 'New 2' }).check();
  await expect(rows).toHaveCount(2);
  await show.getByRole('radio', { name: 'Past due 2' }).check();
  await expect(rows).toHaveCount(2);
  await expect(needs(page).getByText('Invented Towels Ltd')).toHaveCount(0);
  // The counts strip keeps its seven links and words, plus the service requests tile (W3).
  const counts = today(page).getByRole('list', { name: 'Counts' }).getByRole('listitem');
  await expect(counts).toHaveCount(8);
  await expect(
    today(page).getByText('missions past their due date', { exact: true }),
  ).toBeVisible();
});

test('Needs you now shows five rows, then Show N More, and says when not every row was loaded', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const late = Array.from({ length: 7 }, (_, n) => ({
    id: id(100 + n),
    status: 'OUTREACH',
    company: `Invented Company ${n + 1}`,
    dueAt: daysAgo(10 + n),
  }));
  await open(page, { fresh: [], overdue: late, totals: { fresh: 0, overdue: 9, open: 12 } });
  await loaded(page);
  await expect(today(page)).toContainText('At least 9 missions need you.');
  const rows = needs(page).getByRole('listitem');
  await expect(rows.filter({ visible: true })).toHaveCount(5);
  await expect(rows.first()).toContainText('Invented Company 7');
  const more = needs(page).getByRole('button', { name: 'Show 2 More' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(rows.filter({ visible: true })).toHaveCount(7);
  await expect(needs(page).getByRole('button', { name: 'Show Fewer' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(needs(page)).toContainText('Showing 7 of at least 9.');
  await needs(page).getByRole('radio', { name: 'Past due 9' }).check();
  await expect(needs(page)).toContainText('Showing 7 of 9.');
  expect(await smallTargets(page)).toEqual([]);
  expect(await axe(page)).toEqual([]);
});

test('with nothing waiting Today says so, and This week shows each group as one quiet line with its link', async ({
  page,
}) => {
  await open(page, {
    fresh: [],
    overdue: [],
    totals: { fresh: 0, overdue: 0, open: 0 },
    meetings: { meetings: [], followups: [] },
  });
  await loaded(page);
  await expect(today(page)).toContainText('No missions need you now.');
  await expect(needs(page).getByText('Nothing is waiting.')).toBeVisible();
  const week = page.getByRole('region', { name: 'This week' });
  await expect(week.getByText('No meetings in the next 7 days')).toBeVisible();
  await expect(week.getByText('No follow-ups past their due date')).toBeVisible();
  await expect(week.getByText('No meetings need a new time')).toBeVisible();
  await expect(week.getByText('No replies to review')).toBeVisible();
  await expect(week.getByRole('link', { name: 'Open Replies' })).toHaveAttribute(
    'href',
    '#workspace-delivery',
  );
  await expect(week.getByRole('link', { name: 'Open Follow-ups' })).toHaveAttribute(
    'href',
    '#workspace-meetings',
  );
  expect(await axe(page)).toEqual([]);
});

const emptyRows = {
  fresh: [],
  overdue: [],
  totals: { fresh: 0, overdue: 0, open: 0 },
  meetings: { meetings: [], followups: [] },
};
const counts = (page: Page) =>
  today(page).getByRole('list', { name: 'Counts' }).getByRole('listitem');
const toQuote = (page: Page) => counts(page).filter({ hasText: /paid-service requests? to quote/ });

test('W3-1 a count of service requests waiting for a quote shows the number, the plural words and a link to the Delivery section', async ({
  page,
}) => {
  await open(page, {
    ...operatorRows,
    team: { acceptedQuotesNotStarted: 0, serviceRequestsToQuote: 3, repliesToReview: 0 },
  });
  await loaded(page);
  const tile = toQuote(page);
  await expect(tile).toHaveCount(1);
  await expect(tile.locator('strong')).toHaveText('3');
  await expect(tile.locator('span')).toHaveText('paid-service requests to quote');
  await expect(tile).not.toHaveAttribute('data-tone', /.+/);
  await expect(tile.getByRole('link')).toHaveAttribute('href', '#billing-services');
  // The tile sits directly after "accepted quotes not started" and the earlier tiles are unchanged.
  await expect(
    counts(page)
      .filter({ hasText: 'accepted quotes not started' })
      .locator('xpath=following-sibling::li[1]'),
  ).toContainText('paid-service requests to quote');
  await expect(counts(page)).toHaveCount(8);
  expect(await axe(page)).toEqual([]);
});

test('W3-2 exactly one service request uses the singular words', async ({ page }) => {
  await open(page, {
    ...operatorRows,
    team: { acceptedQuotesNotStarted: 0, serviceRequestsToQuote: 1, repliesToReview: 0 },
  });
  await loaded(page);
  await expect(toQuote(page).locator('strong')).toHaveText('1');
  await expect(toQuote(page).locator('span')).toHaveText('paid-service request to quote');
  await expect(
    today(page).getByText('paid-service requests to quote', { exact: true }),
  ).toHaveCount(0);
});

test('W3-3 zero service requests waiting shows 0 with the quiet zero tone, and the accepted quotes tile is unchanged', async ({
  page,
}) => {
  await open(page, {
    ...operatorRows,
    team: { acceptedQuotesNotStarted: 2, serviceRequestsToQuote: 0, repliesToReview: 0 },
  });
  await loaded(page);
  await expect(toQuote(page)).toHaveAttribute('data-tone', 'zero');
  await expect(toQuote(page).locator('strong')).toHaveText('0');
  await expect(toQuote(page).locator('span')).toHaveText('paid-service requests to quote');
  await expect(toQuote(page).getByRole('link')).toHaveAttribute('href', '#billing-services');
  const accepted = counts(page).filter({ hasText: 'accepted quotes not started' });
  await expect(accepted.locator('strong')).toHaveText('2');
  await expect(accepted).not.toHaveAttribute('data-tone', /.+/);
  await expect(accepted.getByRole('link')).toHaveAttribute('href', '#workspace-commercial');
});

test('W3-4 service requests that cannot be read say Not available and are never shown as zero', async ({
  page,
}) => {
  await open(page, {
    ...operatorRows,
    team: {
      acceptedQuotesNotStarted: 0,
      serviceRequestsToQuote: 0,
      repliesToReview: 0,
      unavailable: ['acceptedQuotesNotStarted', 'serviceRequestsToQuote'],
    },
  });
  await loaded(page);
  await expect(toQuote(page)).toHaveAttribute('data-tone', 'unavailable');
  await expect(toQuote(page).locator('strong')).toHaveText('Not available');
  await expect(toQuote(page).locator('span')).toHaveText('paid-service requests to quote');
  await expect(toQuote(page).getByRole('link')).toHaveAttribute('href', '#billing-services');
  const accepted = counts(page).filter({ hasText: 'accepted quotes not started' });
  await expect(accepted.locator('strong')).toHaveText('Not available');
  expect(await axe(page)).toEqual([]);
});

test('W3-5 Today never says nothing is waiting while a service request waits for a quote', async ({
  page,
}) => {
  await open(page, {
    ...emptyRows,
    team: { acceptedQuotesNotStarted: 0, serviceRequestsToQuote: 2, repliesToReview: 0 },
  });
  await loaded(page);
  await expect(needs(page).getByText('Nothing is waiting.')).toHaveCount(0);
  await page.unrouteAll();
  await open(page, {
    ...emptyRows,
    team: { acceptedQuotesNotStarted: 0, serviceRequestsToQuote: 0, repliesToReview: 0 },
  });
  await loaded(page);
  await expect(needs(page).getByText('Nothing is waiting.')).toBeVisible();
});

test('meetings and replies that cannot be read are named honestly, never shown as none', async ({
  page,
}) => {
  await open(page, { ...operatorRows, meetings: { status: 403 }, teamStatus: 403 });
  await loaded(page);
  const week = page.getByRole('region', { name: 'This week' });
  await expect(
    week.getByText('Meetings and follow-ups could not be read for your role.'),
  ).toBeVisible();
  await expect(week.getByText('Replies could not be read for your role.')).toBeVisible();
  await expect(week.getByText('No meetings in the next 7 days')).toHaveCount(0);
  await expect(today(page).getByRole('list', { name: 'Counts' }).getByRole('listitem')).toHaveCount(
    3,
  );
  await page.unrouteAll();
  await open(page, { ...operatorRows, meetings: { status: 500 } });
  await loaded(page);
  await expect(
    page
      .getByRole('region', { name: 'This week' })
      .getByText('Meetings and follow-ups could not be read right now.'),
  ).toBeVisible();
});

test('a failed Today read says so with a retry, and the Start card and its shortcuts still work', async ({
  page,
}) => {
  await open(page, { ...operatorRows, missionsStatus: 503 });
  await expect(today(page).getByRole('status')).toContainText("Today's list could not be loaded.");
  await expect(
    page.getByRole('navigation', { name: 'Mission workflow' }).getByRole('link'),
  ).toHaveCount(5);
  await expect(page.getByText('Manage this workspace', { exact: true })).toBeVisible();
  await expect(page.locator('.operator-management')).not.toHaveAttribute('open');
  await page.unroute('**/api/workspace/missions?*view=today*');
  await page.route('**/api/workspace/missions?*view=today*', (route) => {
    const url = new URL(route.request().url());
    const draft = url.searchParams.get('stage') === 'DRAFT';
    return route.fulfill({
      json: { missions: draft ? operatorRows.fresh.map(mission) : [], total: draft ? 1 : 0 },
    });
  });
  await today(page).getByRole('button', { name: "Retry Today's List" }).click();
  await expect(needs(page).getByText('Invented Towels Ltd')).toBeVisible();
  await expect(today(page)).toContainText('1 mission needs you. It is a new request.');
});

test('the team header shows the inbox as an icon with its unread count, the website in the help menu and the account menu with Authenticator and Sign Out', async ({
  page,
}) => {
  await open(page, operatorRows);
  const header = page.locator('header.ux-app-header');
  const inbox = header.getByRole('button', { name: 'Inbox', exact: true });
  await expect(inbox).toBeVisible();
  await expect(header.getByText('3 unread')).toBeAttached();
  await expect(header.getByRole('button', { name: /Search/ })).toBeVisible();
  const help = header.getByRole('button', { name: 'Help and accessibility' });
  await help.click();
  await expect(page.getByRole('menuitem', { name: 'Corridra Website' })).toHaveAttribute(
    'href',
    '/',
  );
  // W7: the team menu offers the same two reading controls as the customer menu.
  await expect(
    page.getByRole('group', { name: 'Text Size' }).getByRole('menuitemradio'),
  ).toHaveCount(3);
  await expect(page.getByRole('menuitemcheckbox', { name: /Less Movement/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  const menu = header.getByRole('button', { name: 'Account menu' });
  await menu.click();
  await expect(page.getByRole('menuitem', { name: 'Authenticator' })).toHaveAttribute(
    'href',
    /authenticator/,
  );
  await expect(page.getByRole('menuitem', { name: 'Sign Out' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
});

test('with the team shell switch off the overview keeps Today, the Start card, both disclosures and every shortcut, axe clean and without sideways scroll', async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, operatorRows, '/?shells=off');
    await loaded(page);
    await expect(needs(page).getByText('Invented Towels Ltd')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Mission workflow' }).getByRole('link'),
    ).toHaveCount(5);
    await expect(page.locator('.operator-management')).not.toHaveAttribute('open');
    await expect(page.locator('#workspace-navigation details')).not.toHaveAttribute('open');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    expect(await smallTargets(page)).toEqual([]);
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: `${shots}/switch-off-${width}.png`, fullPage: true });
    await page.unrouteAll();
  }
});

test('with mission pages switched off, a Needs you now row opens the mission list instead of a missing page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, operatorRows, '?missions=off');
  await loaded(page);
  const rows = needs(page).locator('.ux-needs-list > li');
  await expect(rows).toHaveCount(3);
  for (const index of [0, 1, 2])
    await expect(rows.nth(index).getByRole('link')).toHaveAttribute('href', '#workspace-missions');
});
