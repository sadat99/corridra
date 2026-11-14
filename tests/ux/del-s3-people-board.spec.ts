import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ADR-084 slice S3 (CORRIDRA_DELEGATION_BOARD): the people board and the money view. The real CustomerProgrammes
// room and its real stylesheets are drawn on a small bundled page in the customer frame; every route that already
// exists is answered by the test, which also records every request and every write so it can show that no read was
// added and that a decision sends the payload it always sent. Sample records only. Component protocol fixture, not
// database acceptance.
const fixturePath = '/__del-s3-people-board-fixture';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const programmeId = '00000000-0000-4000-8000-000000000201';
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { pageFrameSlots } from ${JSON.stringify(resolve('apps/web/components/ux/page-frame.tsx'))};
        import { CustomerProgrammes } from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};
        import { ProgrammeRoomStyles } from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-room-styles.tsx'))};
        import ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-frame.css'))};
        const q = new URLSearchParams(location.search);
        const slots = pageFrameSlots({ back: { label: 'Back to my workspaces', href: '/account#customer-workspaces' } });
        createRoot(document.getElementById('app')).render(
          <WorkspaceShell title={<span className="sr-only">Plan delegations</span>} customer above={slots.above} lead={slots.lead}>
            <ProgrammeRoomStyles />
            <CustomerProgrammes subject="synthetic-alice" issuer=${JSON.stringify(issuer)}
              workspaceId=${JSON.stringify(workspaceId)} participantsEnabled economicsEnabled pagesEnabled roomEnabled framed
              boardEnabled={q.get('board') === '1'} firstRunEnabled={q.get('first') === '1'} />
          </WorkspaceShell>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    outdir: 'out',
    loader: { '.css': 'css' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const bundled = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = [
    readFileSync(resolve('apps/web/app/globals.css'), 'utf8'),
    readFileSync(resolve('apps/web/components/ux/shells.css'), 'utf8'),
    bundled,
  ].join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>People board fixture</title><style>${css}</style></head><body><div id="app"></div><script type="module">${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`;
});

const later = (ms = 3_600_000) => new Date(Date.now() + ms).toISOString();
const uuid = (kind: number, n: number) =>
  `00000000-0000-4000-8000-${String(kind).padStart(4, '0')}${String(n).padStart(8, '0')}`;
const programme = {
  id: programmeId,
  workspaceId,
  name: 'Sample Guangzhou delegation round',
  reportingPurpose: 'Sample shared programme purpose, no private commercial details',
  createdAt: '2026-10-18T00:00:00Z',
  synthetic: true,
  archived: false,
  version: 1,
};
const statuses = [
  'SUBMITTED',
  'INVITED',
  'WAITLISTED',
  'SUBMITTED',
  'DECLINED',
  'JOINED',
  'INVITATION_EXPIRED',
  'SUBMITTED',
];
const application = (n: number, over: Record<string, unknown> = {}) => ({
  id: uuid(3, n),
  status: statuses[(n - 1) % statuses.length],
  displayLabel: `Synthetic applicant ${n}`,
  statement: `Synthetic statement ${n}: a small sample company that wants to meet buyers in Guangzhou.`,
  appliedAt: `2026-11-${String(1 + n).padStart(2, '0')}T09:00:00Z`,
  decisionVersion: 1,
  ...(statuses[(n - 1) % statuses.length] === 'INVITED'
    ? { invitationExpiresAt: later(5 * 86_400_000) }
    : {}),
  ...over,
});
const invitation = (n: number) => ({
  id: uuid(4, n),
  label: `Synthetic invitation ${n}`,
  expiresAt: later(3 * 86_400_000 + n * 3_600_000),
  status: n % 4 === 0 ? 'USED' : 'ISSUED',
});
const registration = (n: number) => ({
  id: uuid(5, n),
  displayLabel: `Synthetic participant ${n}`,
  consentedAt: '2026-11-02T00:00:00Z',
  status: 'REGISTERED',
});
const copy = {
  title: 'Sample Guangzhou delegation round',
  organiser: 'Sample organiser',
  summary: 'A sample programme for the fixture.',
  destination: 'Guangzhou',
  dates: 'April 2027',
  focus: 'Sample focus',
  audience: 'Sample audience',
  eligibility: 'Sample eligibility',
  activities: [{ label: 'Sample meeting day', status: 'PLANNED' }],
  included: ['Sample inclusion'],
  excluded: [],
};
const BIG = '9007199254740993';
const summary = (rows: number) => ({
  workspaceId,
  programmeId,
  collectsPayments: false,
  verified: false,
  currencies: [
    {
      currency: 'USD',
      feesDue: '360000',
      paymentsRecorded: '120000',
      outstanding: '240000',
      plannedCosts: {
        expenses: '90000',
        obligations: '10000',
        corridraServiceFees: '5000',
        total: '105000',
      },
      actualCosts: {
        expenses: '40000',
        obligations: '0',
        corridraServiceFees: '5000',
        total: '45000',
      },
      marginIfPlanned: '255000',
      marginOnActual: '315000',
      cashMargin: '75000',
    },
    {
      currency: 'BDT',
      feesDue: BIG,
      paymentsRecorded: '9007199254740992',
      outstanding: '1',
      plannedCosts: { expenses: '0', obligations: '0', corridraServiceFees: '0', total: '0' },
      actualCosts: { expenses: '0', obligations: '0', corridraServiceFees: '0', total: '0' },
      marginIfPlanned: BIG,
      marginOnActual: BIG,
      cashMargin: '9007199254740992',
    },
  ],
  participants: Array.from({ length: rows }, (_, i) => ({
    registrationId: uuid(5, i + 1),
    label: `Synthetic participant ${i + 1}`,
    state: 'ACTIVE',
    amounts: [
      i % 2 === 0
        ? { currency: 'USD', due: '120000', recorded: '120000', status: 'PAID' }
        : { currency: 'BDT', due: BIG, recorded: '9007199254740992', status: 'PART_PAID' },
    ],
  })),
  counts: { registered: rows, active: rows, withdrawnOrRemoved: 0 },
});
const entry = (n: number) => ({
  id: uuid(6, n),
  seq: n,
  kind: n % 2 ? 'PARTICIPANT_PAYMENT' : 'ORGANISER_EXPENSE',
  costBasis: n % 2 ? null : 'ACTUAL',
  registrationId: null,
  registrationLabel: n % 2 ? 'Synthetic participant 1' : null,
  amountMinor: String(10000 * n),
  currency: n % 2 ? 'USD' : 'BDT',
  occurredOn: '2026-11-05',
  description: `Synthetic entry ${n}`,
  reverseOf: null,
  reversedBy: null,
});

type Options = {
  rows?: number;
  denyParticipants?: boolean;
  denyEconomics?: boolean;
  first?: boolean;
  board?: boolean;
};
type Seen = {
  gets: string[];
  api: string[];
  posts: { path: string; body: Record<string, unknown> }[];
};
async function open(page: Page, width: number, options: Options = {}) {
  const rows = options.rows ?? 3;
  const seen: Seen = { gets: [], api: [], posts: [] };
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/api/customer-programme-*', (route) =>
    route.fulfill({ status: 404, json: { error: 'not installed' } }),
  );
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
    }),
  );
  await page.route('**/api/customer-programme-participants*', (route) => {
    seen.gets.push('participants');
    if (options.denyParticipants) return route.fulfill({ status: 403, json: {} });
    return route.fulfill({
      json: {
        workspaceId,
        programmeId,
        invitations: Array.from({ length: rows }, (_, i) => invitation(i + 1)),
        registrations: Array.from({ length: rows }, (_, i) => registration(i + 1)),
        nextInvitationAfter: null,
        nextRegistrationAfter: null,
        synthetic: true,
      },
    });
  });
  await page.route('**/api/customer-programme-pages*', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      seen.posts.push({ path: '/api/customer-programme-pages', body });
      const row = application(Number(String(body.applicationId).slice(-8)));
      const decision = String(body.decision);
      return route.fulfill({
        json: { ...row, status: decision, decisionVersion: Number(row.decisionVersion) + 1 },
      });
    }
    const view = new URL(request.url()).searchParams.get('view');
    seen.gets.push('pages:' + view);
    if (view === 'applications')
      return route.fulfill({
        json: {
          applications: Array.from({ length: rows }, (_, i) => application(i + 1)),
          nextAfter: null,
        },
      });
    return route.fulfill({
      json: {
        version: 1,
        state: 'OPEN',
        address: 'synthetic-guangzhou-delegation-k3f9x2ab7q',
        copy,
        closesAt: '2027-03-01',
        applications: rows,
        awaiting: Array.from({ length: rows }, (_, i) => application(i + 1)).filter(
          (a) => a.status === 'SUBMITTED',
        ).length,
        sample: true,
      },
    });
  });
  await page.route('**/api/customer-programme-economics*', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      seen.posts.push({
        path: '/api/customer-programme-economics',
        body: request.postDataJSON() as Record<string, unknown>,
      });
      return route.fulfill({ status: 201, json: { entry: entry(9) } });
    }
    const view = new URL(request.url()).searchParams.get('view');
    seen.gets.push('economics:' + view);
    if (options.denyEconomics) return route.fulfill({ status: 403, json: {} });
    if (view === 'summary') return route.fulfill({ json: summary(rows) });
    return route.fulfill({
      json: {
        workspaceId,
        programmeId,
        entries: [5, 4, 3, 2, 1].map(entry),
        nextBefore: null,
        expiresAt: later(),
      },
    });
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/'))
      seen.api.push(
        request.method() +
          ' ' +
          url.pathname +
          (url.searchParams.get('view') ? '?view=' + url.searchParams.get('view') : ''),
      );
  });
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await page.goto(
    `${fixturePath}?board=${options.board === false ? '0' : '1'}&first=${options.first ? '1' : '0'}`,
  );
  await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
  return seen;
}
const closeDetails = (page: Page) =>
  page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = false)));
const mainHeight = (page: Page) =>
  page.evaluate(() => document.querySelector('main')!.getBoundingClientRect().height);
const group = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Programme views' }).getByRole('button', { name, exact: true });

// The owner's rule: no page longer than before at any width. The heights are the content (main) of the real room with
// the People group or the Terms and fees group open and every disclosure closed, measured on origin/main (0e16485
// fixture, same data) with this same fixture: 0, 1, 3 and 8 applications, invitations and registrations, two
// currencies and five entries. One pixel of room for rounding.
const before: Record<number, Record<number, { people: number; money: number }>> = {
  390: {
    0: { people: 2077.1, money: 3455 },
    1: { people: 2573.5, money: 3517.6 },
    3: { people: 3769.4, money: 3749.6 },
    8: { people: 6705.9, money: 4340.7 },
  },
  1440: {
    0: { people: 1628.6, money: 2531.8 },
    1: { people: 1998.4, money: 2578.2 },
    3: { people: 3035.9, money: 2787.7 },
    8: { people: 5524.5, money: 3311.6 },
  },
};
const boardHeading = (page: Page) => page.getByRole('heading', { name: 'Sample people board' });
const recordedWords = 'Recorded by you, not checked by Corridra.';
const openPeople = async (page: Page) => {
  await group(page, 'Participants and eligibility').click();
  await expect(boardHeading(page)).toBeVisible();
};
const openMoney = async (page: Page) => {
  await group(page, 'Terms and fees').click();
  await expect(page.getByText(recordedWords)).toBeVisible();
};

for (const width of [390, 1440])
  test.describe(`${width} px`, () => {
    for (const rows of [0, 1, 3, 8]) {
      test(`${rows} rows: the People group with the board is no longer than before`, async ({
        page,
      }) => {
        await open(page, width, { rows });
        await openPeople(page);
        await closeDetails(page);
        expect(await mainHeight(page)).toBeLessThanOrEqual(before[width]![rows]!.people + 1);
      });
      test(`${rows} rows: the money view is no longer than before`, async ({ page }) => {
        await open(page, width, { rows });
        await openMoney(page);
        await closeDetails(page);
        expect(await mainHeight(page)).toBeLessThanOrEqual(before[width]![rows]!.money + 1);
      });
    }

    test('the board comes first with the next decision, then invited, waiting list and who is in', async ({
      page,
    }) => {
      await open(page, width, { rows: 3 });
      await openPeople(page);
      const board = page.locator('.people-board');
      await expect(board.locator('.people-board-lead')).toHaveText(
        '1 application is waiting for your answer. Next: Synthetic applicant 1.',
      );
      const names = await board
        .locator('.people-board-list')
        .first()
        .locator('> li > p:first-child strong')
        .allTextContents();
      expect(names).toEqual([
        'Synthetic applicant 1',
        'Synthetic invitation 1',
        'Synthetic invitation 2',
        'Synthetic invitation 3',
        'Synthetic applicant 2',
      ]);
      // The board is the first thing in the group, ahead of the participants panel's own lists and the public page.
      const order = await page.evaluate(() => {
        const board = document.querySelector('.people-board')!;
        const page = [
          ...document.querySelectorAll('section[aria-label="Public page and applications"]'),
        ][0]!;
        return !!(board.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(order).toBe(true);
      await expect(board.getByText('Show 4 more')).toBeVisible();
    });

    test('the old queue is not repeated on the public page panel; the board holds it', async ({
      page,
    }) => {
      await open(page, width, { rows: 3 });
      await openPeople(page);
      await expect(page.getByRole('region', { name: 'Applications', exact: true })).toHaveCount(0);
      await expect(page.getByText('Applications: 1 waiting for your answer')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Invite to Join/ })).toHaveCount(1);
    });

    test('Invite, Waitlist and Decline from the board send the payload the public page panel always sent', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 3 });
      await openPeople(page);
      await page.getByRole('button', { name: 'Invite to Join Synthetic applicant 1' }).click();
      await expect(
        page.locator('.people-board-row', { hasText: 'Synthetic applicant 1' }),
      ).toContainText('Invited');
      expect(seen.posts).toHaveLength(1);
      expect(seen.posts[0]!.path).toBe('/api/customer-programme-pages');
      expect(seen.posts[0]!.body).toEqual({
        kind: 'application',
        action: 'decide',
        commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        workspaceId,
        programmeId,
        applicationId: uuid(3, 1),
        expectedVersion: 1,
        decision: 'INVITED',
        acknowledged: true,
      });
    });

    test('Decline asks for a reason of 10 to 500 characters and sends it as the note', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 3 });
      await openPeople(page);
      await page.getByRole('button', { name: 'Decline Synthetic applicant 1' }).click();
      await page.getByRole('button', { name: 'Confirm Decline' }).click();
      await expect(page.getByRole('alert')).toContainText('Write a short reason');
      expect(seen.posts).toHaveLength(0);
      await page
        .getByLabel('Reason the applicant will read')
        .fill('Synthetic reason: the places are full.');
      await page.getByRole('button', { name: 'Confirm Decline' }).click();
      await expect.poll(() => seen.posts.length).toBe(1);
      expect(seen.posts[0]!.body).toMatchObject({
        decision: 'DECLINED',
        note: 'Synthetic reason: the places are full.',
        expectedVersion: 1,
        applicationId: uuid(3, 1),
      });
    });

    test('every original participant control is still there, whole, one tap deeper', async ({
      page,
    }) => {
      await open(page, width, { rows: 3 });
      await openPeople(page);
      const fold = page.locator('details.people-board-manage');
      await expect(fold).not.toHaveAttribute('open', '');
      await expect(fold.locator('> summary')).toHaveText(
        'Create sample invitations, edit labels or remove access',
      );
      await expect(page.getByRole('button', { name: 'Revoke Invitation' })).toHaveCount(0);
      await fold.locator('> summary').click();
      await expect(fold.getByRole('heading', { name: 'Invitations', exact: true })).toBeVisible();
      await expect(fold.getByRole('button', { name: /^Create Replacement Code/ })).toHaveCount(3);
      await expect(fold.getByRole('button', { name: 'Revoke Invitation' })).toHaveCount(3);
      await expect(fold.getByRole('button', { name: 'Revoke Programme Access' })).toHaveCount(3);
      await expect(fold.getByLabel('Invitation label')).toBeVisible();
      await expect(fold.getByLabel('Participant email (optional)')).toBeVisible();
      await expect(
        fold.getByRole('button', { name: 'Create Sample Invitation Code' }),
      ).toBeVisible();
    });

    test('the money view keeps each currency in its own table: no combined figure, nothing converted, exact amounts', async ({
      page,
    }) => {
      await open(page, width, { rows: 3 });
      await openMoney(page);
      await expect(page.getByText(recordedWords)).toContainText(
        'Each currency is shown separately and nothing is converted.',
      );
      const tables = page.locator('.detail-card > table');
      await expect(tables).toHaveCount(2);
      await expect(tables.nth(0).locator('caption')).toHaveText('USD');
      await expect(tables.nth(1).locator('caption')).toHaveText('BDT');
      expect(await tables.nth(0).textContent()).not.toContain('BDT');
      expect(await tables.nth(1).textContent()).not.toContain('USD');
      // 9007199254740993 minor units is not a safe Number; the digits shown are the digits recorded.
      await expect(tables.nth(1)).toContainText('BDT 90071992547409.93');
      await expect(tables.nth(1)).toContainText('BDT 90071992547409.92');
      await expect(page.locator('.detail-card')).not.toContainText(
        /total across|all currencies|exchange rate|converted to/i,
      );
    });

    test('who still owes comes first, by an exact comparison inside one currency', async ({
      page,
    }) => {
      await open(page, width, { rows: 3 });
      await openMoney(page);
      const names = await page.locator('.detail-card ul > li > strong').allTextContents();
      // Participant 2 owes one unit past 2^53 in BDT; 1 and 3 are paid in full. Participant 2 is first.
      expect(names[0]).toBe('Synthetic participant 2');
    });

    test('Record an amount and the older entries are one tap deeper and send the same payload', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 3 });
      await openMoney(page);
      await expect(page.getByLabel('What are you recording?')).toBeHidden();
      await page.getByText('Record an amount', { exact: true }).click();
      await page.getByLabel('What are you recording?').selectOption('ORGANISER_EXPENSE');
      await page.getByLabel('Currency').selectOption('USD');
      await page.getByLabel(/^Amount/).fill('10.00');
      await page
        .getByLabel('Description (start with Synthetic)')
        .fill('Synthetic printing for the day');
      await page.getByLabel(/^I am entering this myself/).check();
      await page.getByRole('button', { name: 'Record Amount' }).click();
      await expect.poll(() => seen.posts.length).toBe(1);
      expect(seen.posts[0]!.path).toBe('/api/customer-programme-economics');
      expect(seen.posts[0]!.body).toMatchObject({
        workspaceId,
        programmeId,
        acknowledged: true,
        entry: {
          kind: 'ORGANISER_EXPENSE',
          costBasis: 'PLANNED',
          registrationId: null,
          amountMinor: '1000',
          currency: 'USD',
          description: 'Synthetic printing for the day',
        },
      });
    });

    test('a refused read shows the existing denial and no rows or amounts', async ({ page }) => {
      await open(page, width, { rows: 3, denyParticipants: true, denyEconomics: true });
      await group(page, 'Participants and eligibility').click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Only current programme workspace owners' }),
      ).toBeVisible();
      await expect(boardHeading(page)).toHaveCount(0);
      await expect(page.locator('.people-board-row')).toHaveCount(0);
      await group(page, 'Terms and fees').click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Account or programme access changed' }),
      ).toBeVisible();
      await expect(page.locator('.detail-card table')).toHaveCount(0);
    });

    test('it reads only records the organiser already reads, and nothing private', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 3 });
      await openPeople(page);
      await openMoney(page);
      const allowed = new Set([
        'GET /api/customer-programmes',
        'GET /api/customer-programme-participants?view=manage',
        'GET /api/customer-programme-pages?view=page',
        'GET /api/customer-programme-pages?view=applications',
        'GET /api/customer-programme-economics?view=summary',
        'GET /api/customer-programme-economics?view=entries',
        'GET /api/customer-programme-payment-declarations?view=pending',
        'GET /api/customer-programme-fee-disputes?view=open',
      ]);
      const outside = seen.api.filter((call) => !allowed.has(call));
      expect(outside).toEqual([]);
    });

    test('axe is clean on both groups', async ({ page }) => {
      await open(page, width, { rows: 3 });
      await openPeople(page);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await openMoney(page);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });

    test('with the switch off the room is as it was: no board, the old lists, the old queue and the old money tables', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, board: false });
      await group(page, 'Participants and eligibility').click();
      await expect(boardHeading(page)).toHaveCount(0);
      await expect(page.locator('details.people-board-manage')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Invitations', exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Create Sample Invitation Code' }),
      ).toBeVisible();
      await expect(
        page.getByText('Applications: 1 waiting for your answer, 3 in all'),
      ).toBeVisible();
      await group(page, 'Terms and fees').click();
      await expect(
        page.getByText(
          'This is your own bookkeeping, entered by you and not verified by Corridra.',
        ),
      ).toBeVisible();
      await expect(page.getByRole('row', { name: /Margin on actual costs/ })).toHaveCount(2);
      await expect(page.getByLabel('What are you recording?')).toBeVisible();
    });

    test('the Overview decision for applications opens the People group at the board', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, first: true });
      await page.getByRole('button', { name: /^Answer 1 Application/ }).click();
      await expect(boardHeading(page)).toBeInViewport();
    });
  });
