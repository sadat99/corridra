import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { fixtureTenant, startTodayFixture } from './team-today-fixture';

// Team desk v4.1, unit D5 (docs/revamp/specs/team-desk-v4-1.md section 5; switch CORRIDRA_UX_TEAM_DESK_V41). The real
// overview is bundled from the source as in team-today-layout.spec.ts, and every read is answered with sample rows.
// On: Today has two regions, "Needs your decision" and "Waiting on others", a late pill, one primary Review in each
// region's first row and quiet ones after it, and a headline that says what to do and never "at least". Off: Today
// is what it was. Screenshots go to the ignored cache at 320, 390, 768, 1024, 1440 and 1920, switch off and on.
const tenant = fixtureTenant;
const shots = '.cache/team-today-v41';
const widths = [320, 390, 768, 1024, 1440, 1920];
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
let origin = '';

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true });
  fixture = await startTodayFixture();
  origin = fixture.origin;
});
test.afterAll(async () => {
  await fixture.close();
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = {
  id: string;
  status: string;
  company: string;
  dueAt: string;
  reference?: string;
};
const mission = ({ id: missionId, status, company, dueAt, reference }: Row) => ({
  id: missionId,
  status,
  due_at: dueAt,
  brief: { company, objective: 'Source suppliers', market: 'China' },
  ...(reference ? { reference } : {}),
});

type Scenario = {
  fresh: Row[];
  overdue: Row[];
  open: Row[];
  totals: { fresh: number; overdue: number; open: number };
  team?: {
    acceptedQuotesNotStarted: number;
    serviceRequestsToQuote: number;
    repliesToReview: number;
  };
  teamStatus?: number;
  meetings?: unknown;
  erasure?: unknown[];
};
const fresh: Row = { id: id(1), status: 'DRAFT', company: 'Sample Towels Ltd', dueAt: inDays(4) };
const late36: Row = {
  id: id(2),
  status: 'OUTREACH',
  company: 'Sample Machinery Co',
  dueAt: daysAgo(36),
};
const late3: Row = {
  id: id(3),
  status: 'FOLLOW_UP',
  company: 'Sample Foods Co',
  dueAt: daysAgo(3),
};
const onTime: Row[] = [
  { id: id(11), status: 'OUTREACH', company: 'Sample Ceramics Co', dueAt: inDays(6) },
  { id: id(12), status: 'FOLLOW_UP', company: 'Sample Leather Co', dueAt: inDays(9) },
];
const meetings = {
  meetings: [
    {
      id: id(44),
      title: 'Sample buyer introduction',
      status: 'SCHEDULED',
      starts_at: inDays(2),
      due_at: inDays(2),
      location: 'Sample meeting room',
    },
    {
      id: id(55),
      title: 'Sample factory visit',
      status: 'RESCHEDULE_REQUIRED',
      starts_at: null,
      due_at: inDays(2),
      location: null,
    },
  ],
  followups: [
    { id: id(66), status: 'OPEN', due_at: daysAgo(7), next_action: 'Send sample swatches' },
  ],
};
const busy: Scenario = {
  fresh: [fresh],
  overdue: [late36, late3],
  open: [fresh, late36, late3, ...onTime],
  totals: { fresh: 1, overdue: 2, open: 5 },
  team: { acceptedQuotesNotStarted: 0, serviceRequestsToQuote: 1, repliesToReview: 2 },
};
const quiet: Scenario = {
  fresh: [],
  overdue: [],
  open: [],
  totals: { fresh: 0, overdue: 0, open: 0 },
  meetings: { meetings: [], followups: [] },
};

async function open(page: Page, scenario: Scenario, query = '/?v41=on') {
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
        role: 'owner',
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/workspace/missions?*view=today*', (route) => {
    const url = new URL(route.request().url());
    const draft = url.searchParams.get('stage') === 'DRAFT';
    const overdue = url.searchParams.get('filter') === 'overdue';
    const rows = draft ? scenario.fresh : overdue ? scenario.overdue : scenario.open;
    const total = draft
      ? scenario.totals.fresh
      : overdue
        ? scenario.totals.overdue
        : scenario.totals.open;
    return route.fulfill({ json: { missions: rows.map(mission), total } });
  });
  await page.route('**/api/workspace/meetings?*view=today*', (route) =>
    route.fulfill({ json: scenario.meetings ?? meetings }),
  );
  await page.route('**/api/team-control/today?*', (route) =>
    scenario.teamStatus
      ? route.fulfill({ status: scenario.teamStatus, json: { error: 'Sample' } })
      : route.fulfill({
          json: scenario.team ?? {
            acceptedQuotesNotStarted: 0,
            serviceRequestsToQuote: 0,
            repliesToReview: 0,
          },
        }),
  );
  await page.route('**/api/workspace/problem-reports?*', (route) =>
    route.fulfill({ status: 503, json: { error: 'Sample' } }),
  );
  await page.route('**/api/workspace/customer-erasure-queue?*', (route) => {
    const status = new URL(route.request().url()).searchParams.get('status');
    const items = (scenario.erasure ?? []).filter(
      (item) => (item as { status: string }).status === status,
    );
    return route.fulfill({ json: { items, nextAfter: null } });
  });
  await page.goto(origin + query);
  await expect(page.getByRole('heading', { name: 'Start with a mission.' })).toBeVisible();
}
const decide = (page: Page) => page.getByRole('region', { name: 'Needs your decision' });
const waiting = (page: Page) => page.getByRole('region', { name: 'Waiting on others' });
const headline = (page: Page) => page.locator('.ux-today41 .ux-desk-sentence');
async function axe(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  return (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target}`);
}
async function smallTargets(page: Page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('.ux-today :is(a[href], button, summary, select, .ux-segment)'),
    )
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => ({
        text: (element.textContent ?? '').trim().slice(0, 40),
        height: Math.round(element.getBoundingClientRect().height),
      }))
      .filter((target) => target.height < 44),
  );
}

test('switch on: Today has the two regions, the headline says what to do, and each region has one primary Review in its first row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, busy);
  await expect(headline(page)).toHaveText(
    '3 things need your decision. Start with the 2 that are late.',
  );
  await expect(page.getByRole('heading', { name: 'Needs you now' })).toHaveCount(0);

  // Needs your decision: most days late first, each with its pill; the new request has the plain New pill.
  const rows = decide(page).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Sample Machinery Co');
  await expect(rows.nth(0).locator('.ux-desk-chip[data-tone="late"]')).toHaveText('Late, 36 days');
  await expect(rows.nth(1).locator('.ux-desk-chip[data-tone="late"]')).toHaveText('Late, 3 days');
  await expect(rows.nth(2).locator('.ux-desk-chip[data-tone="new"]')).toHaveText('New');
  // One primary Review, in the first row; the rest are the quiet link. Same address as the row always opened.
  await expect(decide(page).locator('a.primary-link')).toHaveCount(1);
  await expect(rows.nth(0).locator('a.primary-link')).toHaveText('Review');
  await expect(rows.nth(0).getByRole('link', { name: /^Review / })).toHaveAttribute(
    'href',
    `/operator/missions/${id(2)}?workspace=${tenant}`,
  );
  await expect(rows.nth(1).locator('a.text-link')).toHaveText('Review');
  await expect(rows.nth(2).locator('a.text-link')).toHaveText('Review');
  // The other queues that need a decision keep their numbers and their addresses; a zero is not listed.
  const queues = decide(page).getByRole('list', { name: 'Also needs your decision' });
  await expect(queues.getByRole('link', { name: '2 replies to review' })).toHaveAttribute(
    'href',
    '#workspace-delivery',
  );
  await expect(
    queues.getByRole('link', { name: '1 paid-service request to quote' }),
  ).toHaveAttribute('href', '#billing-services');
  await expect(queues.getByRole('link', { name: '1 follow-up past its due date' })).toHaveAttribute(
    'href',
    '#workspace-meetings',
  );
  await expect(queues.getByRole('link', { name: '1 meeting needs a new time' })).toBeVisible();
  await expect(queues.getByText('accepted quote')).toHaveCount(0);

  // Waiting on others: open missions that are on time and the coming meeting, soonest first, none of the three above.
  const others = waiting(page).locator('tbody tr');
  await expect(others).toHaveCount(3);
  await expect(others.nth(0)).toContainText('Sample buyer introduction');
  await expect(others.nth(1)).toContainText('Sample Ceramics Co');
  await expect(others.nth(2)).toContainText('Sample Leather Co');
  await expect(waiting(page).locator('a.primary-link')).toHaveCount(1);
  await expect(others.nth(0).locator('a.primary-link')).toHaveText('Review');
  await expect(others.nth(1).locator('a.text-link')).toHaveAttribute(
    'href',
    `/operator/missions/${id(11)}?workspace=${tenant}`,
  );
  await expect(waiting(page).getByRole('link', { name: 'Open Missions' })).toHaveAttribute(
    'href',
    '#workspace-missions',
  );
  await expect(waiting(page).getByText('5 open')).toBeVisible();
  // No reference is invented: these reads carry none, so none is shown.
  await expect(page.locator('.ux-today41-reference')).toHaveCount(0);
  await expect(page.locator('.ux-today')).not.toContainText(/at least/i);
});

test('switch on: a short reference shows only on the row whose read carried one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, {
    ...busy,
    overdue: [
      { ...late36, reference: 'RQ-000012' },
      { ...late3, reference: id(3) },
    ],
  });
  const rows = decide(page).locator('tbody tr');
  await expect(rows.nth(0).locator('.ux-today41-reference')).toHaveText('RQ-000012');
  await expect(rows.nth(0).getByRole('link')).toHaveAccessibleName(
    'Review RQ-000012, Source suppliers · China, Sample Machinery Co',
  );
  await expect(page.locator('.ux-today41-reference')).toHaveCount(1);
});

test('switch on: a count that rests on an unfinished read is never said as "at least"; the filter keeps its address', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { ...busy, totals: { fresh: 1, overdue: 60, open: 80 } });
  await expect(headline(page)).toHaveText(
    'Start with the late ones at the top. This page did not load every one; the full list is in Missions.',
  );
  await expect(decide(page).getByText('Showing 3. More are in Missions.')).toBeVisible();
  await expect(page.locator('.ux-today')).not.toContainText(/at least/i);
  await decide(page).getByRole('radio', { name: 'New 1' }).check();
  await expect(page).toHaveURL(/[?&]needs=new/);
  await expect(decide(page).locator('tbody tr')).toHaveCount(1);
  await expect(decide(page).locator('tbody tr a.primary-link')).toHaveCount(1);
});

test('switch on: with nothing waiting the page says so, and a failed read is named with Try Again, never a zero', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, quiet);
  await expect(headline(page)).toHaveText('Nothing needs your decision now.');
  await expect(
    decide(page).getByText('No new requests and nothing past its due date.'),
  ).toBeVisible();
  await expect(waiting(page).getByText('Nothing is waiting on anyone else.')).toBeVisible();
  await expect(page.locator('.ux-today41 a.primary-link')).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
  await page.unrouteAll();

  await open(page, { ...quiet, teamStatus: 503 });
  await expect(headline(page)).toHaveText(
    'No new request and nothing late. Some queues could not be checked.',
  );
  await expect(decide(page).getByRole('button', { name: 'Try Again' })).toBeVisible();
  await expect(decide(page).getByText('replies to review')).toHaveCount(0);
});

test('switch off and on at 320, 390, 768, 1024, 1440 and 1920: off is unchanged, on has no sideways scroll, 44 px targets and is axe clean', async ({
  page,
}) => {
  test.setTimeout(180000);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    // Off: the Today that main serves, with its list, its counts and no v4.1 region.
    // The fixture keeps a flag for the tab, so off is named after the first pass (which opens with no flag at all).
    await open(page, busy, width === widths[0] ? '/' : '/?v41=off');
    await expect(page.getByRole('list', { name: 'Counts' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Needs you now' })).toContainText(
      'Sample Machinery Co',
    );
    await expect(page.locator('.ux-today41')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Needs your decision' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Waiting on others' })).toHaveCount(0);
    await expect(page.locator('.ux-today a.primary-link')).toHaveCount(0);
    await page.screenshot({ path: `${shots}/off-${width}.png`, fullPage: true });
    await page.unrouteAll();

    await open(page, busy);
    await expect(decide(page).locator('tbody tr')).toHaveCount(3);
    await expect(waiting(page).locator('tbody tr')).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      `sideways scroll at ${width}`,
    ).toBeLessThanOrEqual(0);
    expect(await smallTargets(page), `small targets at ${width}`).toEqual([]);
    expect(await axe(page), `axe at ${width}`).toEqual([]);
    await page.screenshot({ path: `${shots}/on-${width}.png`, fullPage: true });
    await page.unrouteAll();
  }
});

test('switch on with the team shell off changes nothing: the switch needs the team shell', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, busy, '/?shells=off&v41=on');
  await expect(page.getByRole('list', { name: 'Counts' })).toBeVisible();
  await expect(page.locator('.ux-today41')).toHaveCount(0);
});
