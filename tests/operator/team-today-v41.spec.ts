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
  /** The problem report queue answer; missing, the read is refused (503). */
  problemReports?: unknown;
  /** The erasure queue read fails with this status. */
  erasureStatus?: number;
  /** Both queues answer as they do when the authenticator check is no longer fresh: 401 with the step-up code. */
  staleCode?: boolean;
  /** The erasure queue answers as a signed-out person: 401 with no code. */
  erasureSignedOut?: boolean;
  /** The signed-in person's role, as the workspace read gives it. Default owner. */
  role?: string;
  /** Counts the team read lists as not readable. */
  unavailable?: string[];
};
const stale = { status: 401, json: { error: 'Confirm your code', code: 'STEP_UP_REQUIRED' } };
/** The erasure queue's real answer to a stale check: 401 with the step-up code (deliveryError keeps it for this queue). */
const staleErasure = {
  status: 401,
  json: { error: 'Verify your authenticator again to continue', code: 'STEP_UP_REQUIRED' },
};
/** A signed-out person: 401 with no code. It is not the check, so it never draws the Confirm Code line. */
const signedOutErasure = { status: 401, json: { error: 'Sign in to continue' } };
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
        role: scenario.role ?? 'owner',
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
          json: {
            ...(scenario.team ?? {
              acceptedQuotesNotStarted: 0,
              serviceRequestsToQuote: 0,
              repliesToReview: 0,
            }),
            ...(scenario.unavailable ? { unavailable: scenario.unavailable } : {}),
          },
        }),
  );
  await page.route('**/api/workspace/problem-reports?*', (route) =>
    scenario.staleCode
      ? route.fulfill(stale)
      : scenario.problemReports
        ? route.fulfill({ json: scenario.problemReports })
        : route.fulfill({ status: 503, json: { error: 'Sample' } }),
  );
  await page.route('**/api/workspace/customer-erasure-queue?*', (route) => {
    if (scenario.erasureSignedOut) return route.fulfill(signedOutErasure);
    if (scenario.staleCode) return route.fulfill(staleErasure);
    if (scenario.erasureStatus)
      return route.fulfill({ status: scenario.erasureStatus, json: { error: 'Sample' } });
    const status = new URL(route.request().url()).searchParams.get('status');
    const items = (scenario.erasure ?? []).filter(
      (item) => (item as { status: string }).status === status,
    );
    return route.fulfill({ json: { items, nextAfter: null } });
  });
  await page.goto(origin + query);
  // Off, the Start card's heading ends in a full stop; on, the closed row is titled without one.
  await expect(page.getByRole('heading', { name: /^Start with a mission\.?$/ })).toBeVisible();
}
const decide = (page: Page) => page.getByRole('region', { name: 'Needs your decision' });
const waiting = (page: Page) => page.getByRole('region', { name: 'Waiting on others' });
/** "Waiting on others" is a closed row; this opens it. */
const showWaiting = (page: Page) =>
  waiting(page).getByRole('button', { name: 'Show Waiting on others' }).click();
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
  // UI/UX.v4.1 L1: the market keeps its mark before its name; the flag is decorative, the name is written.
  await expect(rows.nth(0).locator('.ux-flagged img[data-flag="cn"]')).toHaveCount(1);
  await expect(rows.nth(0).locator('.ux-flagged')).toHaveText('China');
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
  // Follow-ups and meetings to rebook are handled in one place: one tile, one link.
  await expect(
    queues.getByRole('link', {
      name: /1\s*follow-up past its due date\s*1\s*meeting needs a new time/,
    }),
  ).toHaveAttribute('href', '#workspace-meetings');
  await expect(queues.locator('a[href="#workspace-meetings"]')).toHaveCount(1);
  await expect(queues.getByText('accepted quote')).toHaveCount(0);

  // Waiting on others is a closed row that says how many are on time. Open: the coming meeting and the open missions
  // that are on time, soonest first, none of the three above, each with the quiet Open link.
  await expect(waiting(page)).toContainText('3 on time');
  await expect(waiting(page).locator('tbody tr').first()).toBeHidden();
  await showWaiting(page);
  const others = waiting(page).locator('tbody tr');
  await expect(others).toHaveCount(3);
  await expect(others.nth(0)).toContainText('Sample buyer introduction');
  await expect(others.nth(0)).toContainText('Sample meeting room');
  await expect(others.nth(0).locator('.ux-desk-chip')).toHaveCount(0);
  await expect(others.nth(1)).toContainText('Sample Ceramics Co');
  await expect(others.nth(2)).toContainText('Sample Leather Co');
  // A meeting has no address of its own, so its row carries no link (Meetings is in the menu).
  await expect(others.nth(0).getByRole('link')).toHaveCount(0);
  await expect(others.nth(1).getByRole('link')).toHaveAccessibleName(
    'Open Source suppliers · China, Sample Ceramics Co',
  );
  await expect(others.nth(1).locator('a.text-link')).toHaveText('Open');
  await expect(others.nth(1).locator('a.text-link')).toHaveAttribute(
    'href',
    `/operator/missions/${id(11)}?workspace=${tenant}`,
  );
  // The Missions menu place is not repeated in the page; the count stays as words.
  await expect(
    page.locator('.ux-today41').getByRole('link', { name: 'Open Missions' }),
  ).toHaveCount(0);
  await expect(waiting(page).getByText('5 open in total')).toBeVisible();
  // One cobalt button on the whole page: Review in the first row that needs a decision.
  await expect(page.locator('.ux-today41 a.primary-link')).toHaveCount(1);
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
    'Start with the late ones at the top. Not all of them loaded here. See Missions for the full list.',
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
  await expect(waiting(page)).toContainText('0 on time');
  await showWaiting(page);
  await expect(waiting(page).getByText('Nothing is waiting on anyone else.')).toBeVisible();
  await expect(page.locator('.ux-today41 a.primary-link')).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
  await page.unrouteAll();

  await open(page, { ...quiet, teamStatus: 503 });
  await expect(headline(page)).toHaveText(
    'No new requests and nothing late. Some lists could not be checked.',
  );
  await expect(decide(page).getByRole('button', { name: 'Try Again' })).toBeVisible();
  await expect(decide(page).getByText('replies to review')).toHaveCount(0);
});

test('switch on: a problem report queue that could not be read is never an all-clear', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Report a Problem is offered and the owner reads its queue; the read is refused.
  await open(page, quiet, '/?v41=on&reports=on');
  await expect(headline(page)).not.toHaveText('Nothing needs your decision now.');
  await expect(headline(page)).toHaveText(
    'No new requests and nothing late. Some lists could not be checked.',
  );
  await expect(decide(page).getByText(/Problem reports/)).toBeVisible();
  await expect(decide(page).getByRole('button', { name: 'Try Again' })).toBeVisible();
  await expect(decide(page).getByText('problem reports open')).toHaveCount(0);
});

// Team desk v4.1 fix run (staff-core-17, -18, -19 and the two preview findings on Today).
test('fix run: a stale authenticator check is one quiet line with Confirm Code, never a failed read', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { ...quiet, staleCode: true }, '/?v41=on&reports=on');
  const line = decide(page).locator('[data-code-check]');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(
    'Confirm your code to see erasure requests and problem reports.',
  );
  await expect(line.getByRole('button', { name: 'Confirm Code' })).toBeVisible();
  // Nothing failed, so nothing says it could not be read and nothing offers Try Again.
  await expect(decide(page).getByText(/could not be read|is not available/)).toHaveCount(0);
  await expect(decide(page).getByRole('button', { name: 'Try Again' })).toHaveCount(0);
  // Decision 5: no count before the fresh check, and the headline does not claim an all-clear.
  await expect(decide(page).getByText(/problem reports? open|erasure requests? open/)).toHaveCount(
    0,
  );
  await expect(headline(page)).toHaveText('Confirm your code to check erasure requests.');
  await expect(page.locator('.ux-today41')).not.toContainText('could not be checked');
  // Confirm Code opens the check in place.
  await line.getByRole('button', { name: 'Confirm Code' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm it is you' })).toBeVisible();
});

test('fix run: a signed-out 401 on the erasure queue is not the code, so no Confirm Code line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { ...quiet, erasureSignedOut: true }, '/?v41=on&reports=on');
  await expect(decide(page).locator('[data-code-check]')).toHaveCount(0);
  await expect(decide(page).getByRole('button', { name: 'Confirm Code' })).toHaveCount(0);
});

test('fix run: a signed-out 401 on the erasure queue is not a failed check either, so no failure line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The problem report queue answers, so the only read in question is the signed-out erasure queue.
  await open(
    page,
    {
      ...quiet,
      erasureSignedOut: true,
      problemReports: { counts: { received: 0, in_review: 0 }, oldestReceivedAt: null },
    },
    '/?v41=on&reports=on',
  );
  await expect(decide(page)).toBeVisible();
  await expect(page.getByText('Erasure requests could not be checked just now')).toHaveCount(0);
  await expect(page.locator('.ux-today41')).not.toContainText('could not be checked');
  await expect(decide(page).getByText(/erasure requests? open/)).toHaveCount(0);
});

test('fix run: an admin never reads the erasure queue and sees no erasure tile or failure line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const erasureReads: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/workspace/customer-erasure-queue'))
      erasureReads.push(request.url());
  });
  // Even a queue that would answer 403 (members.manage is owner only) is never asked.
  await open(
    page,
    {
      ...quiet,
      role: 'admin',
      erasureStatus: 403,
      problemReports: { counts: { received: 0, in_review: 0 }, oldestReceivedAt: null },
    },
    '/?v41=on&role=admin&reports=on',
  );
  await expect(page.locator('.ux-today41')).toBeVisible();
  await expect(page.locator('[data-code-check]')).toHaveCount(0);
  await expect(page.locator('.ux-today41')).not.toContainText(/erasure/i);
  await expect(decide(page).getByRole('button', { name: 'Try Again' })).toHaveCount(0);
  expect(erasureReads).toEqual([]);
});

test('fix run: two lists that failed for one reason are named in one message with one Try Again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { ...quiet, erasureStatus: 503 }, '/?v41=on&reports=on');
  await expect(
    decide(page).getByText(
      'Erasure requests and problem reports could not be read just now. Your work is safe.',
      { exact: true },
    ),
  ).toHaveCount(1);
  await expect(decide(page).getByRole('button', { name: 'Try Again' })).toHaveCount(1);
  // The grammar fault of the preview ("Erasure requests is not available") is gone.
  await expect(page.locator('.ux-today41')).not.toContainText(/requests is |reports is /);
});

test('fix run: a count this role can never read is left out; an owner still sees that it failed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const unavailable = ['acceptedQuotesNotStarted', 'serviceRequestsToQuote'];
  await open(page, { ...quiet, unavailable, role: 'operator' }, '/?v41=on&role=operator');
  await expect(page.locator('.ux-today41')).toBeVisible();
  await expect(page.locator('.ux-today41')).not.toContainText('Not available');
  await expect(decide(page).getByText(/paid-service|accepted quotes?/)).toHaveCount(0);
  await page.unrouteAll();
  await open(page, { ...quiet, unavailable }, '/?v41=on&role=owner');
  await expect(decide(page).getByText('paid-service requests to quote')).toBeVisible();
  await expect(decide(page).getByText('Not available').first()).toBeVisible();
});

test('fix run: the Today heading of the panel stays in the outline and only one Today is shown', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, quiet);
  await expect(page.locator('.ux-today41')).toBeVisible();
  // The panel keeps its own heading for the outline and for the region's name, as it does with the switch off.
  const panelHeading = page.locator('.ux-today41 h2#today-title');
  await expect(panelHeading).toBeAttached();
  await expect(panelHeading).toHaveText('Today');
  await expect(page.locator('.ux-today41')).toHaveAttribute('aria-labelledby', 'today-title');
  await expect(page.getByRole('region', { name: 'Today', exact: true })).toBeVisible();
  // Shown once: the page title. The panel heading is a 1 px box, so the word is not on screen twice.
  const boxes = await page
    .getByRole('heading', { name: 'Today', exact: true })
    .evaluateAll((headings) =>
      headings.map((heading) => {
        const { width, height } = heading.getBoundingClientRect();
        return { id: heading.id, width: Math.round(width), height: Math.round(height) };
      }),
    );
  expect(boxes).toHaveLength(2);
  expect(boxes.filter((box) => box.width > 1 || box.height > 1)).toHaveLength(1);
  expect(boxes.find((box) => box.id === 'today-title')).toEqual({
    id: 'today-title',
    width: 1,
    height: 1,
  });
  // Show and Hide are 44 px targets in both directions.
  const show = waiting(page).getByRole('button', { name: 'Show Waiting on others' });
  const box = (await show.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
});

test('switch on: a capped read is a lower bound: only its own tile carries the plus sign, and it is never an all-clear', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Both reads stopped at one page.
  await open(page, { ...quiet, meetings: { ...meetings, next: 'more', followupsNext: 'more' } });
  await expect(headline(page)).toHaveText(
    'No new requests and nothing late. Some lists could not be checked.',
  );
  const queues = decide(page).getByRole('list', { name: 'Also needs your decision' });
  await expect(
    queues.getByRole('link', {
      name: /1\+\s*follow-up past its due date\s*1\+\s*meeting needs a new time/,
    }),
  ).toBeVisible();
  await expect(
    decide(page).getByText(
      'Follow-ups and meetings that need a new time cover the 50 earliest of each.',
    ),
  ).toBeVisible();
  await page.unrouteAll();

  // Only the follow-ups read stopped: the meetings count is exact and keeps its plain number.
  await open(page, { ...quiet, meetings: { ...meetings, followupsNext: 'more' } });
  await expect(
    queues.getByRole('link', {
      name: /1\+\s*follow-up past its due date\s*1\s*meeting needs a new time/,
    }),
  ).toBeVisible();
  await expect(decide(page).getByText('Follow-ups cover the 50 earliest.')).toBeVisible();
  await expect(waiting(page)).toContainText('1 on time');
  await page.unrouteAll();

  // Only the meetings read stopped, and it returned no coming meeting: Waiting on others gives no number and
  // never says nothing is waiting.
  await open(page, {
    ...quiet,
    meetings: { meetings: [meetings.meetings[1]], followups: meetings.followups, next: 'more' },
  });
  await expect(
    queues.getByRole('link', {
      name: /1\s*follow-up past its due date\s*1\+\s*meeting needs a new time/,
    }),
  ).toBeVisible();
  await expect(
    decide(page).getByText('Meetings that need a new time cover the 50 earliest.'),
  ).toBeVisible();
  await expect(waiting(page)).not.toContainText('0 on time');
  await showWaiting(page);
  await expect(waiting(page).getByText('Nothing is waiting on anyone else.')).toHaveCount(0);
  await expect(
    waiting(page).getByText(
      'Meetings here cover the 50 earliest by date. The meetings section lists them all.',
    ),
  ).toBeVisible();
});

test('switch on: the problem report and erasure tiles keep their detail words', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const erasure = (n: number, daysLeft: number) => ({
    id: id(700 + n),
    reference: `ER-00000${n}`,
    requestedAt: daysAgo(30 - daysLeft),
    dueAt: inDays(daysLeft),
    daysLeft,
    status: 'received',
  });
  await open(
    page,
    {
      ...quiet,
      problemReports: {
        counts: { received: 2, in_review: 1, resolved: 4, closed: 0 },
        oldestReceivedAt: daysAgo(6),
        items: [],
      },
      erasure: [erasure(1, -3), erasure(2, 4)],
    },
    '/?v41=on&reports=on',
  );
  const queues = decide(page).getByRole('list', { name: 'Also needs your decision' });
  await expect(
    queues.getByRole('link', { name: /3 problem reports open, oldest waiting 6 days/ }),
  ).toHaveAttribute('href', '#problem-report-queue');
  await expect(
    queues.getByRole('link', { name: /2 erasure requests open, 1 overdue, nearest due/ }),
  ).toHaveAttribute('href', '#workspace-settings');
  // The overdue request is also a row of the table, with the words in sentence case.
  await expect(decide(page).locator('tbody tr')).toHaveCount(1);
  await expect(decide(page).locator('tbody tr')).toContainText('Erasure requests');
  // An erasure request has no address of its own: its row has no link, the tile is the one link to the queue.
  await expect(decide(page).locator('tbody tr').getByRole('link')).toHaveCount(0);
  await expect(page.locator('main a[href="#workspace-settings"]')).toHaveCount(1);
});

// Owner rule, 24 Nov 2026: "Avoid unnecessary repetition of navigation links on a single screen". With the switch on,
// every address in the page body appears once. The sidebar menu is the only global path; a count tile is a work queue
// (the "queue tile" rule): each links once and no two tiles share an address.
test('switch on: no address is linked twice in the page body, and no menu place is repeated there', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const erasure = (n: number, daysLeft: number) => ({
    id: id(800 + n),
    reference: `ER-00010${n}`,
    requestedAt: daysAgo(30 - daysLeft),
    dueAt: inDays(daysLeft),
    daysLeft,
    status: 'received',
  });
  await open(
    page,
    {
      ...busy,
      team: { acceptedQuotesNotStarted: 2, serviceRequestsToQuote: 1, repliesToReview: 2 },
      problemReports: {
        counts: { received: 2, in_review: 1, resolved: 4, closed: 0 },
        oldestReceivedAt: daysAgo(6),
        items: [],
      },
      erasure: [erasure(1, -3), erasure(2, -5), erasure(3, 4)],
    },
    '/?v41=on&reports=on',
  );
  await expect(decide(page).locator('tbody tr')).toHaveCount(5);
  await showWaiting(page);
  await page.getByRole('button', { name: 'Show Start with a mission' }).click();
  const addresses = await page.evaluate(() =>
    Array.from(document.querySelectorAll('main a[href]')).map((link) => link.getAttribute('href')!),
  );
  const twice = addresses.filter((address, index) => addresses.indexOf(address) !== index);
  expect(twice, `linked more than once: ${twice.join(', ')}`).toEqual([]);
  // The six queue tiles, each to its own place.
  const tiles = await page
    .getByRole('list', { name: 'Also needs your decision' })
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(tiles).toEqual([
    '#workspace-delivery',
    '#billing-services',
    '#workspace-commercial',
    '#workspace-meetings',
    '#problem-report-queue',
    '#workspace-settings',
  ]);
  // The one link to Missions in the body is the action that starts a mission, inside the closed Start row.
  await expect(page.locator('main a[href="#workspace-missions"]')).toHaveCount(1);
  await expect(
    page
      .getByRole('region', { name: 'Start with a mission' })
      .getByRole('link', { name: 'Start a Mission' }),
  ).toHaveAttribute('href', '#workspace-missions');
  // The shortcuts and administration links that repeat menu places are gone from the body.
  await expect(page.locator('main nav.workspace-navigation')).toHaveCount(0);
});

test('switch on with section addresses: the queue tiles open each section at its own address, with the workspace kept', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, busy, '/?v41=on&sections=on');
  const queues = decide(page).getByRole('list', { name: 'Also needs your decision' });
  await expect(queues.getByRole('link', { name: '2 replies to review' })).toHaveAttribute(
    'href',
    `/operator/delivery?workspace=${tenant}`,
  );
  await expect(
    queues.getByRole('link', { name: '1 paid-service request to quote' }),
  ).toHaveAttribute('href', `/operator/delivery?workspace=${tenant}#billing-services`);
  await expect(
    queues.getByRole('link', {
      name: /1\s*follow-up past its due date\s*1\s*meeting needs a new time/,
    }),
  ).toHaveAttribute('href', `/operator/meetings?workspace=${tenant}`);
  // Section addresses off (the default): the page keeps the addresses it has always used.
  await open(page, busy, '/?v41=on&sections=off');
  await expect(queues.getByRole('link', { name: '2 replies to review' })).toHaveAttribute(
    'href',
    '#workspace-delivery',
  );
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
    await page.evaluate(() => document.fonts.ready);
    const sideways = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    // As it opens: Waiting on others closed.
    expect(await sideways(), `sideways scroll at ${width}`).toBeLessThanOrEqual(0);
    expect(await smallTargets(page), `small targets at ${width}`).toEqual([]);
    expect(await axe(page), `axe at ${width}`).toEqual([]);
    await page.screenshot({ path: `${shots}/on-${width}.png`, fullPage: true });
    // And with Waiting on others open.
    await showWaiting(page);
    await expect(waiting(page).locator('tbody tr')).toHaveCount(3);
    expect(await sideways(), `sideways scroll at ${width}, open`).toBeLessThanOrEqual(0);
    expect(await smallTargets(page), `small targets at ${width}, open`).toEqual([]);
    expect(await axe(page), `axe at ${width}, open`).toEqual([]);
    await page.screenshot({ path: `${shots}/on-open-${width}.png`, fullPage: true });
    if (width === 320) {
      // 200% text at 320 px: nothing in the headline or the two regions is pushed off the side. (The team header and
      // the Start card already run wide at this size with the switch off; neither is part of this page body.)
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      const wide = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            '.ux-desk-sentence, :is(.ux-today41-region, .ux-today41 .ux-desk-fold) *',
          ),
        )
          // The column headings are hidden from view on a phone (kept for screen readers), so they take no room.
          .filter((element) => !element.closest('thead'))
          .filter((element) => (element as HTMLElement).offsetParent !== null)
          .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
          .map((element) => `${element.tagName}.${element.getAttribute('class') ?? ''}`),
      );
      expect(wide, 'Today wider than the window at 320 with 200% text').toEqual([]);
      await page.screenshot({ path: `${shots}/on-open-320-text-200.png`, fullPage: true });
    }
    await page.unrouteAll();
  }
});

test('switch on: page length as it opens, in screens (docs/agents/ui-direction.md, page length)', async ({
  page,
}) => {
  const lengths: Record<string, number> = {};
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await open(page, busy);
    await expect(decide(page).locator('tbody tr')).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    lengths[`${width}x${height}`] =
      Math.round(
        (await page.evaluate(
          () =>
            (document.querySelector('footer')!.getBoundingClientRect().bottom + window.scrollY) /
            window.innerHeight,
        )) * 100,
      ) / 100;
    await page.unrouteAll();
  }
  console.log(`Team Today v4.1 page length in screens: ${JSON.stringify(lengths)}`);
  // Desktop fits one screen; a phone may run to two.
  expect(lengths['1440x900']).toBeLessThanOrEqual(1);
  expect(lengths['390x844']).toBeLessThanOrEqual(2);
});

test('switch on with the team shell off changes nothing: the switch needs the team shell', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, busy, '/?shells=off&v41=on');
  await expect(page.getByRole('list', { name: 'Counts' })).toBeVisible();
  await expect(page.locator('.ux-today41')).toHaveCount(0);
});
