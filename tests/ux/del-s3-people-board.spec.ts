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
              workspaceId=${JSON.stringify(workspaceId)} participantsEnabled={q.get('participants') !== '0'} economicsEnabled pagesEnabled roomEnabled={q.get('room') !== '0'} framed
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
const summary = (rows: number, withdrawn = false) => ({
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
  participants: [
    // A participant who withdrew still has more due than recorded; they are read first and must not sort first.
    ...(withdrawn
      ? [
          {
            registrationId: uuid(5, 99),
            label: 'Synthetic participant W',
            state: 'WITHDRAWN',
            amounts: [
              { currency: 'BDT', due: BIG, recorded: '9007199254740992', status: 'PART_PAID' },
            ],
          },
        ]
      : []),
    ...Array.from({ length: rows }, (_, i) => ({
      registrationId: uuid(5, i + 1),
      label: `Synthetic participant ${i + 1}`,
      state: 'ACTIVE',
      amounts: [
        i % 2 === 0
          ? { currency: 'USD', due: '120000', recorded: '120000', status: 'PAID' }
          : { currency: 'BDT', due: BIG, recorded: '9007199254740992', status: 'PART_PAID' },
      ],
    })),
  ],
  counts: { registered: rows, active: rows, withdrawnOrRemoved: withdrawn ? 1 : 0 },
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
  /** How the participants list answers: fine, an error, "unavailable", or a list whose invitation ends in a second. */
  participants?: 'ok' | 'fail' | '503' | 'expiring';
  /** Invitations and registrations come in two pages each. */
  peoplePages?: boolean;
  /** How the applications list answers: fine, always an error, "unavailable", an error once, or only page two fails. */
  applications?: 'ok' | 'fail' | '503' | 'failOnce' | 'moreFail' | 'slow';
  /** The applications list comes in two pages. */
  applicationPages?: boolean;
  /** How many entries the ledger holds; more than 25 gives the first page a cursor for older entries. */
  entryTotal?: number;
  /** Payment declarations and fee questions waiting for the organiser. */
  reviews?: boolean;
  /** A participant who withdrew, with more due than recorded, is read first. */
  withdrawn?: boolean;
  /** The programme room and the participants module, which the board needs (both on unless set to false). */
  room?: boolean;
  participantsOn?: boolean;
};
type Seen = {
  gets: string[];
  api: string[];
  /** Every GET with its query, for the reads that carry cursors. */
  urls: string[];
  /** Set by a test: every participants read from now on takes this long (a reload that can be acted on while it runs). */
  delayMs: number;
  posts: { path: string; body: Record<string, unknown> }[];
};
async function open(page: Page, width: number, options: Options = {}) {
  const rows = options.rows ?? 3;
  const seen: Seen = { gets: [], api: [], urls: [], delayMs: 0, posts: [] };
  let participantReads = 0;
  let applicationFailures = 0;
  let invitesMade = 0;
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
  await page.route('**/api/customer-programme-participants*', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      seen.posts.push({ path: '/api/customer-programme-participants', body });
      invitesMade += 1;
      return route.fulfill({
        status: 201,
        json: {
          id: uuid(7, invitesMade),
          programmeId,
          expiresAt: later(),
          issued: true,
          token: 'A'.repeat(42) + String(invitesMade % 10),
          canEmail: false,
          synthetic: true,
        },
      });
    }
    const url = new URL(request.url());
    seen.gets.push('participants');
    seen.urls.push(url.pathname + url.search);
    participantReads += 1;
    if (options.denyParticipants) return route.fulfill({ status: 403, json: {} });
    if (options.participants === 'fail') return route.fulfill({ status: 500, json: {} });
    if (options.participants === '503') return route.fulfill({ status: 503, json: {} });
    if (seen.delayMs) await new Promise((resolve) => setTimeout(resolve, seen.delayMs));
    const invitations = Array.from({ length: rows }, (_, i) => invitation(i + 1));
    const registrations = Array.from({ length: rows }, (_, i) => registration(i + 1));
    if (options.participants === 'expiring')
      invitations[0] = {
        ...invitations[0]!,
        status: 'ISSUED',
        expiresAt: new Date(Date.now() + 1500).toISOString(),
      };
    const paged = options.peoplePages && rows > 3;
    const inviteAfter = url.searchParams.get('invitationAfter');
    const registerAfter = url.searchParams.get('registrationAfter');
    const firstInvitations = paged ? invitations.slice(0, 3) : invitations;
    const firstRegistrations = paged ? registrations.slice(0, 3) : registrations;
    return route.fulfill({
      json: {
        workspaceId,
        programmeId,
        invitations: inviteAfter ? invitations.slice(3) : firstInvitations,
        registrations: registerAfter ? registrations.slice(3) : firstRegistrations,
        nextInvitationAfter: paged && !inviteAfter ? firstInvitations.at(-1)!.id : null,
        nextRegistrationAfter: paged && !registerAfter ? firstRegistrations.at(-1)!.id : null,
        synthetic: true,
      },
    });
  });
  await page.route('**/api/customer-programme-pages*', async (route) => {
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
    const url = new URL(request.url());
    const view = url.searchParams.get('view');
    seen.gets.push('pages:' + view);
    seen.urls.push(url.pathname + url.search);
    if (view === 'applications') {
      const after = url.searchParams.get('after');
      const mode = options.applications ?? 'ok';
      if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 2500));
      if (mode === 'fail') return route.fulfill({ status: 500, json: {} });
      if (mode === '503') return route.fulfill({ status: 503, json: {} });
      if (mode === 'failOnce' && applicationFailures++ === 0)
        return route.fulfill({ status: 500, json: {} });
      if (after && mode === 'moreFail') return route.fulfill({ status: 500, json: {} });
      const all = Array.from({ length: rows + (options.applicationPages ? 2 : 0) }, (_, i) =>
        application(i + 1),
      );
      return route.fulfill({
        json: {
          applications: after ? all.slice(rows) : all.slice(0, rows),
          nextAfter: options.applicationPages && !after ? 'cursor-two' : null,
        },
      });
    }
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
    const url = new URL(request.url());
    const view = url.searchParams.get('view');
    seen.gets.push('economics:' + view);
    if (options.denyEconomics) return route.fulfill({ status: 403, json: {} });
    if (view === 'summary')
      return route.fulfill({ json: summary(rows, options.withdrawn === true) });
    // The ledger is read 25 entries at a time, newest first; a cursor says where the older ones start.
    const total = options.entryTotal ?? 5;
    const before = Number(url.searchParams.get('beforeSeq') ?? total + 1);
    const seqs = Array.from({ length: Math.min(25, before - 1) }, (_, i) => before - 1 - i);
    return route.fulfill({
      json: {
        workspaceId,
        programmeId,
        entries: seqs.map(entry),
        nextBefore: seqs.length && seqs.at(-1)! > 1 ? seqs.at(-1)! : null,
        expiresAt: later(),
      },
    });
  });
  if (options.reviews) {
    let declarations = 1;
    let disputes = 1;
    await page.route('**/api/customer-programme-payment-declarations*', (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        seen.posts.push({
          path: '/api/customer-programme-payment-declarations',
          body: request.postDataJSON() as Record<string, unknown>,
        });
        declarations = 0;
        return route.fulfill({ json: {} });
      }
      return route.fulfill({
        json: {
          workspaceId,
          programmeId,
          provenance: 'PARTICIPANT_DECLARED',
          verified: false,
          declarations: declarations
            ? [
                {
                  id: uuid(8, 1),
                  registrationId: uuid(5, 1),
                  currency: 'USD',
                  exponent: 2,
                  amountMinor: '5000',
                  paidOn: '2026-11-01',
                  payerReference: null,
                  note: null,
                  declaredAt: '2026-11-02T00:00:00Z',
                  status: 'AWAITING_REVIEW',
                  reason: null,
                  verified: false,
                  acknowledgedAmountMinor: null,
                  acknowledgedOn: null,
                  outstandingMinor: '10000',
                },
              ]
            : [],
        },
      });
    });
    await page.route('**/api/customer-programme-fee-disputes*', (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        seen.posts.push({
          path: '/api/customer-programme-fee-disputes',
          body: request.postDataJSON() as Record<string, unknown>,
        });
        disputes = 0;
        return route.fulfill({ json: {} });
      }
      return route.fulfill({
        json: {
          workspaceId,
          programmeId,
          recordOnly: true,
          disputes: disputes
            ? [
                {
                  id: uuid(9, 1),
                  registrationId: uuid(5, 2),
                  reason: 'AMOUNT_WRONG',
                  filedAt: '2026-11-03T00:00:00Z',
                  status: 'OPEN',
                  decidedAt: null,
                },
              ]
            : [],
        },
      });
    });
  }
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
    `${fixturePath}?board=${options.board === false ? '0' : '1'}&first=${options.first ? '1' : '0'}` +
      `&room=${options.room === false ? '0' : '1'}&participants=${options.participantsOn === false ? '0' : '1'}`,
  );
  if (options.room === false) await expect(page.getByText(programme.name).first()).toBeVisible();
  else await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
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
// currencies and five entries. One pixel of room for rounding. The 768 px rows were measured with the switch off,
// whose screens are main's (the same measurement reproduces every 390 and 1440 row to the pixel).
const before: Record<number, Record<number, { people: number; money: number }>> = {
  390: {
    0: { people: 2077.1, money: 3455 },
    1: { people: 2573.5, money: 3517.6 },
    3: { people: 3769.4, money: 3749.6 },
    8: { people: 6705.9, money: 4340.7 },
  },
  768: {
    0: { people: 1886.9, money: 2869.2 },
    1: { people: 2256.7, money: 2915.6 },
    3: { people: 3294.2, money: 3125.2 },
    8: { people: 5782.8, money: 3649.1 },
  },
  1440: {
    0: { people: 1628.6, money: 2531.8 },
    1: { people: 1998.4, money: 2578.2 },
    3: { people: 3035.9, money: 2787.7 },
    8: { people: 5524.5, money: 3311.6 },
  },
};
// The board and the money view are far shorter than the old groups, so the "no longer than before" pin alone would let
// them grow a long way (an uncapped board still passes it). This second pin holds them near what was measured on the
// slice head (same fixture), with 60 px of room for font and rounding differences.
const measured: Record<number, Record<number, { people: number; money: number }>> = {
  390: {
    0: { people: 1332.1, money: 2322.2 },
    1: { people: 1858.8, money: 2384.8 },
    3: { people: 2324, money: 2616.8 },
    8: { people: 2566.3, money: 2953.5 },
  },
  768: {
    0: { people: 1235.5, money: 1852.6 },
    1: { people: 1634.8, money: 1899 },
    3: { people: 2077.5, money: 2108.5 },
    8: { people: 2169.5, money: 2378.1 },
  },
  1440: {
    0: { people: 1022, money: 1601.9 },
    1: { people: 1421.3, money: 1648.3 },
    3: { people: 1864, money: 1857.9 },
    8: { people: 1956, money: 2127.4 },
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

// Page height is pinned at the three widths the layout budget names; everything else is checked at a phone and a desktop.
for (const width of [390, 768, 1440])
  test.describe(`${width} px page height`, () => {
    for (const rows of [0, 1, 3, 8]) {
      test(`${rows} rows: the People group with the board is no longer than before`, async ({
        page,
      }) => {
        await open(page, width, { rows });
        await openPeople(page);
        await closeDetails(page);
        expect(await mainHeight(page)).toBeLessThanOrEqual(before[width]![rows]!.people + 1);
        expect(await mainHeight(page)).toBeLessThanOrEqual(measured[width]![rows]!.people + 60);
      });
      test(`${rows} rows: the money view is no longer than before`, async ({ page }) => {
        await open(page, width, { rows });
        await openMoney(page);
        await closeDetails(page);
        expect(await mainHeight(page)).toBeLessThanOrEqual(before[width]![rows]!.money + 1);
        expect(await mainHeight(page)).toBeLessThanOrEqual(measured[width]![rows]!.money + 60);
      });
    }
    test('with a failed participants read the People group is still no longer than before', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, participants: 'fail' });
      await openPeople(page);
      await closeDetails(page);
      expect(await mainHeight(page)).toBeLessThanOrEqual(before[width]![3]!.people + 1);
    });
    test('thirty entries and a cursor for older ones: the money view is no longer than the same view with the switch off', async ({
      page,
    }) => {
      const off = await page.context().newPage();
      await open(off, width, { rows: 3, board: false, entryTotal: 30 });
      await group(off, 'Terms and fees').click();
      await expect(off.getByLabel('What are you recording?')).toBeVisible();
      await closeDetails(off);
      const before = await mainHeight(off);
      await open(page, width, { rows: 3, entryTotal: 30 });
      await openMoney(page);
      await closeDetails(page);
      expect(await mainHeight(page)).toBeLessThanOrEqual(before + 1);
      // The older entries are still one press away, and nothing was dropped.
      await expect(page.getByRole('button', { name: 'Show Older Entries' })).toBeVisible();
    });
  });

for (const width of [390, 1440])
  test.describe(`${width} px`, () => {
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
      await expect(board.getByText('Show 4 More', { exact: true })).toBeVisible();
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
        'Create Sample Invitations, Edit Labels or Remove Access',
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

    test('who still owes comes first by the server status, and a participant who withdrew never does', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, withdrawn: true });
      await openMoney(page);
      const names = await page.locator('.detail-card ul > li > strong').allTextContents();
      // Participant 2 owes one unit past 2^53 in BDT (PART_PAID); 1 and 3 are paid in full. The participant who
      // withdrew is read first and has more due than recorded, yet comes after every active participant.
      expect(names).toEqual([
        'Synthetic participant 2',
        'Synthetic participant 1',
        'Synthetic participant 3',
        'Synthetic participant W',
      ]);
      await expect(
        page.locator('.detail-card ul > li', { hasText: 'participant W' }),
      ).toContainText('withdrawn');
    });

    test('Record an Amount and the older entries are one tap deeper and send the same payload', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 3 });
      await openMoney(page);
      await expect(page.getByLabel('What are you recording?')).toBeHidden();
      await page.getByText('Record an Amount', { exact: true }).click();
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

    test('a refused participants read shows the existing denial and no invitations, registrations or amounts', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, denyParticipants: true, denyEconomics: true });
      await group(page, 'Participants and eligibility').click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Only current programme workspace owners' }),
      ).toBeVisible();
      // The applications come from their own read, so they stay answerable; no participant detail is shown.
      await expect(page.locator('.people-board-row[data-kind="invitation"]')).toHaveCount(0);
      await expect(page.locator('.people-board-row[data-kind="registration"]')).toHaveCount(0);
      await expect(page.locator('details.people-board-manage')).toHaveCount(0);
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

    test('the Overview decision for applications opens People, scrolls to the board and focuses it', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, first: true });
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await page.getByRole('button', { name: /^Answer 1 Application/ }).click();
      await expect(boardHeading(page)).toBeVisible();
      const read = () =>
        page.evaluate((id) => {
          const board = document.getElementById(`${id}-board`)!;
          return {
            focused: document.activeElement === board,
            top: board.getBoundingClientRect().top,
            scrolled: window.scrollY,
            label: board.getAttribute('aria-labelledby'),
          };
        }, programmeId);
      // The board takes focus, and the page is scrolled so it sits at the top of the window (a few lines of the
      // heading above it are allowed); scrolling waits for the applications so the page is tall enough to land there.
      await expect.poll(async () => (await read()).focused).toBe(true);
      await expect.poll(async () => Math.abs((await read()).top)).toBeLessThan(160);
      const state = await read();
      expect(state.scrolled).toBeGreaterThan(0);
      expect(state.label).toBe(`${programmeId}-board-title`);
    });

    const bodyOf = (seen: Seen, n: number) =>
      seen.posts.filter((p) => p.path.endsWith('-pages'))[n]?.body;
    const decisions = (seen: Seen) => seen.posts.filter((p) => p.path.endsWith('-pages'));

    for (const [state, options] of [
      ['the participants read failed', { participants: 'fail' }],
      ['the participants read is unavailable', { participants: '503' }],
      ['the participants read was refused', { denyParticipants: true }],
    ] as const)
      test(`an application can still be invited, put on the waiting list and declined when ${state}`, async ({
        page,
      }) => {
        const seen = await open(page, width, { rows: 8, ...options });
        await openPeople(page);
        await expect(page.getByRole('region', { name: 'Applications', exact: true })).toHaveCount(
          0,
        );
        await page.getByRole('button', { name: 'Invite to Join Synthetic applicant 1' }).click();
        await expect.poll(() => decisions(seen).length).toBe(1);
        await page
          .getByRole('button', { name: 'Put on Waiting List Synthetic applicant 4' })
          .click();
        await expect.poll(() => decisions(seen).length).toBe(2);
        await page.getByRole('button', { name: 'Decline Synthetic applicant 8' }).click();
        await page
          .getByLabel('Reason the applicant will read')
          .fill('Synthetic reason: the places are full.');
        await page.getByRole('button', { name: 'Confirm Decline' }).click();
        await expect.poll(() => decisions(seen).length).toBe(3);
        expect(decisions(seen).map((d) => [d.body.decision, d.body.applicationId])).toEqual([
          ['INVITED', uuid(3, 1)],
          ['WAITLISTED', uuid(3, 4)],
          ['DECLINED', uuid(3, 8)],
        ]);
        expect(bodyOf(seen, 2)).toMatchObject({ note: 'Synthetic reason: the places are full.' });
      });

    test('an application can still be answered once the private participant view has expired', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 3, participants: 'expiring' });
      await openPeople(page);
      await expect(
        page.getByText('This private view expired. Reload to check access again.'),
      ).toBeVisible();
      await expect(page.locator('.people-board-row[data-kind="invitation"]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Invite to Join Synthetic applicant 1' }).click();
      await expect.poll(() => decisions(seen).length).toBe(1);
      expect(bodyOf(seen, 0)).toMatchObject({ decision: 'INVITED', applicationId: uuid(3, 1) });
    });

    test('an application can be answered while the participants list is read again after a saved command', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 3 });
      await openPeople(page);
      seen.delayMs = 2500;
      const fold = page.locator('details.people-board-manage');
      await fold.locator('> summary').click();
      await fold.getByLabel(/^I have permission to share this sample code/).check();
      await fold.getByRole('button', { name: 'Create Sample Invitation Code' }).click();
      await expect(page.getByText('Refreshing invitations and registrations')).toBeVisible();
      // The lists stay on screen while they refresh, and the decision goes out in the meantime.
      await expect(page.locator('.people-board-row[data-kind="invitation"]').first()).toBeVisible();
      await page.getByRole('button', { name: 'Invite to Join Synthetic applicant 1' }).click();
      await expect.poll(() => decisions(seen).length).toBe(1);
      expect(bodyOf(seen, 0)).toMatchObject({ decision: 'INVITED', applicationId: uuid(3, 1) });
    });

    test('creating one invitation after another keeps the disclosure open', async ({ page }) => {
      const seen = await open(page, width, { rows: 3 });
      await openPeople(page);
      seen.delayMs = 400;
      const fold = page.locator('details.people-board-manage');
      await fold.locator('> summary').click();
      const create = async (count: number) => {
        await fold.getByLabel(/^I have permission to share this sample code/).check();
        await fold.getByRole('button', { name: 'Create Sample Invitation Code' }).click();
        await expect
          .poll(() => seen.posts.filter((p) => p.path.endsWith('-participants')).length)
          .toBe(count);
        // Open while the list is read again, and still open after.
        await expect(fold).toHaveAttribute('open', '');
        await expect(page.getByText('Refreshing invitations and registrations')).toBeHidden();
        await expect(fold).toHaveAttribute('open', '');
      };
      await create(1);
      await create(2);
      expect(
        seen.posts.filter((p) => p.path.endsWith('-participants')).map((p) => p.body.action),
      ).toEqual(['invite', 'invite']);
    });

    test('a typed decline reason survives a participants reload, and the board stays in place', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 3 });
      await openPeople(page);
      seen.delayMs = 1200;
      await page.evaluate(() => {
        (window as unknown as { board: Element | null }).board =
          document.querySelector('.people-board');
      });
      await page.getByRole('button', { name: 'Decline Synthetic applicant 1' }).click();
      const reason = page.getByLabel('Reason the applicant will read');
      await reason.fill('Synthetic reason: the places are full.');
      await page.getByRole('button', { name: 'Reload Programme Participants' }).click();
      await expect(page.getByText('Refreshing invitations and registrations')).toBeVisible();
      await expect(reason).toHaveValue('Synthetic reason: the places are full.');
      await expect(page.getByText('Refreshing invitations and registrations')).toBeHidden();
      await expect(reason).toHaveValue('Synthetic reason: the places are full.');
      expect(
        await page.evaluate(() => (window as unknown as { board: Element }).board.isConnected),
      ).toBe(true);
    });

    for (const board of [true, false])
      test(`the applications are read once per programme, however often the participants are read again (switch ${board ? 'on' : 'off'})`, async ({
        page,
      }) => {
        const seen = await open(page, width, { rows: 3, board });
        await group(page, 'Participants and eligibility').click();
        if (board) await expect(boardHeading(page)).toBeVisible();
        const reads = () =>
          seen.api.filter((call) => call === 'GET /api/customer-programme-pages?view=applications');
        const participantReads = () => seen.gets.filter((g) => g === 'participants').length;
        await expect.poll(reads).toHaveLength(1);
        await page.getByRole('button', { name: 'Reload Programme Participants' }).click();
        await expect.poll(participantReads).toBeGreaterThanOrEqual(2);
        const before = participantReads();
        if (board) {
          const fold = page.locator('details.people-board-manage');
          await fold.locator('> summary').click();
          await fold.getByLabel(/^I have permission to share this sample code/).check();
          await fold.getByRole('button', { name: 'Create Sample Invitation Code' }).click();
          await expect.poll(participantReads).toBeGreaterThan(before);
        }
        await group(page, 'Terms and fees').click();
        await group(page, 'Participants and eligibility').click();
        await page.waitForTimeout(300);
        expect(reads()).toHaveLength(1);
      });

    test('the lead line says nothing about applications that were not read, and the failure has a way back', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, applications: 'failOnce' });
      await openPeople(page);
      const lead = page.locator('.people-board-lead');
      await expect(page.getByText(/^Applications could not be read\./)).toBeVisible();
      await expect(lead).toHaveText('3 people have been invited and have not joined yet.');
      await expect(page.locator('.people-board')).not.toContainText(
        /waiting for your answer|No applications/,
      );
      await page.getByRole('button', { name: 'Read Applications Again' }).click();
      await expect(lead).toHaveText(
        '1 application is waiting for your answer. Next: Synthetic applicant 1.',
      );
      await expect(page.getByText(/^Applications could not be read\./)).toHaveCount(0);
    });

    test('while the applications are being read the lead line makes no claim about them', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, applications: 'slow' });
      await openPeople(page);
      await expect(page.getByText('Reading applications…')).toBeVisible();
      await expect(page.locator('.people-board')).not.toContainText(
        /waiting for your answer|No applications/,
      );
      await expect(page.getByText('Reading applications…')).toBeHidden({ timeout: 8000 });
      await expect(page.locator('.people-board-lead')).toContainText('1 application is waiting');
    });

    test('applications that are unavailable are said so, with no claim about them and a way to try again', async ({
      page,
    }) => {
      await open(page, width, { rows: 0, applications: '503' });
      await openPeople(page);
      await expect(
        page.getByText('Applications are not available for this programme right now.'),
      ).toBeVisible();
      await expect(page.locator('.people-board-lead')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Read Applications Again' })).toBeVisible();
    });

    test('a failed Load More People does not label the rows already read as unreadable', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, applications: 'moreFail', applicationPages: true });
      await openPeople(page);
      await expect(page.locator('.people-board-lead')).toContainText('read so far');
      await page.getByRole('button', { name: 'Load More People' }).click();
      await expect(
        page.getByText('More applications could not be read. The ones already read are shown.'),
      ).toBeVisible();
      await expect(page.getByText(/^Applications could not be read\./)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Read Applications Again' })).toHaveCount(0);
      await expect(page.locator('.people-board-lead')).toContainText('1 application is waiting');
      await expect(
        page.getByRole('button', { name: 'Invite to Join Synthetic applicant 1' }),
      ).toBeVisible();
    });

    test('Waitlist sends the payload the public page panel always sent', async ({ page }) => {
      const seen = await open(page, width, { rows: 3 });
      await openPeople(page);
      await page.getByRole('button', { name: 'Put on Waiting List Synthetic applicant 1' }).click();
      await expect.poll(() => decisions(seen).length).toBe(1);
      expect(decisions(seen)[0]!.body).toEqual({
        kind: 'application',
        action: 'decide',
        commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        workspaceId,
        programmeId,
        applicationId: uuid(3, 1),
        expectedVersion: 1,
        decision: 'WAITLISTED',
        acknowledged: true,
      });
    });

    test('Show More opens the rest of the list, and an application in the rows that were hidden can be answered', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 8 });
      await openPeople(page);
      const summary = page.locator('details.people-board-more > summary');
      await expect(summary).toHaveText(/^Show \d+ More, Including Ended$/);
      await expect(
        page.getByRole('button', { name: 'Invite Again Synthetic applicant 7' }),
      ).toBeHidden();
      await summary.click();
      await page.getByRole('button', { name: 'Invite Again Synthetic applicant 7' }).click();
      await expect.poll(() => decisions(seen).length).toBe(1);
      expect(decisions(seen)[0]!.body).toMatchObject({
        decision: 'INVITED',
        applicationId: uuid(3, 7),
        expectedVersion: 1,
      });
    });

    test('after an answer focus stays on the board and the result is announced', async ({
      page,
    }) => {
      await open(page, width, { rows: 3 });
      await openPeople(page);
      const live = page.locator('.people-board p.sr-only[role="status"]');
      const focused = () => page.evaluate(() => document.activeElement?.id ?? '');
      await page.getByRole('button', { name: 'Invite to Join Synthetic applicant 1' }).click();
      await expect(live).toHaveText('Synthetic applicant 1: Invited.');
      expect(await focused()).toBe(`${programmeId}-board`);
      // A decline moves the row into the closed part; the pressed button is gone and focus is not lost.
      await page.getByRole('button', { name: 'Decline Synthetic applicant 1' }).click();
      await page
        .getByLabel('Reason the applicant will read')
        .fill('Synthetic reason: the places are full.');
      await page.getByRole('button', { name: 'Confirm Decline' }).click();
      await expect(live).toHaveText('Synthetic applicant 1: Declined.');
      expect(await focused()).toBe(`${programmeId}-board`);
    });

    test('Load More People reads the next page of each list, opens the rest, announces the count and keeps focus', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 8, peoplePages: true, applicationPages: true });
      await openPeople(page);
      const more = page.getByRole('button', { name: 'Load More People' });
      const live = page.locator('.people-board p.sr-only[role="status"]');
      const urls = (needle: string) => seen.urls.filter((u) => u.includes(needle));
      const focused = () => page.evaluate(() => document.activeElement?.textContent ?? '');
      await more.click();
      // One applications page and one participants page (invitations first) per press.
      await expect.poll(() => urls('after=cursor-two')).toHaveLength(1);
      await expect.poll(() => urls('invitationAfter=')).toHaveLength(1);
      expect(urls('registrationAfter=')).toHaveLength(0);
      await expect(live).toHaveText('7 more people shown.');
      await expect(page.locator('details.people-board-more')).toHaveAttribute('open', '');
      expect(await focused()).toBe('Load More People');
      await more.click();
      await expect.poll(() => urls('registrationAfter=')).toHaveLength(1);
      await expect(more).toHaveCount(0);
      await expect(live).toHaveText('5 more people shown.');
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(`${programmeId}-board`);
      // 10 applications, 8 invitations and 8 registrations (one of them an application's own) are all there.
      await expect(page.locator('.people-board-row[data-kind="application"]')).toHaveCount(10);
      await expect(page.locator('.people-board-row[data-kind="invitation"]')).toHaveCount(8);
      await expect(page.locator('.people-board-row[data-kind="registration"]')).toHaveCount(8);
    });

    test('every status offers the same answers on the board as on the public page panel', async ({
      page,
    }) => {
      const collect = (where: Page, selector: string) =>
        where.evaluate((rowSelector) => {
          const out: Record<string, string[]> = {};
          for (const row of document.querySelectorAll(rowSelector)) {
            const label = row.querySelector('strong')?.textContent ?? '';
            out[label] = [...row.querySelectorAll('button')].map((button) => {
              const clone = button.cloneNode(true) as HTMLElement;
              clone.querySelectorAll('.sr-only').forEach((node) => node.remove());
              return (clone.textContent ?? '').trim();
            });
          }
          return out;
        }, selector);
      await open(page, width, { rows: 8, board: false });
      await group(page, 'Participants and eligibility').click();
      await expect(page.getByText(/^Applications: \d+ waiting for your answer/)).toBeVisible();
      const off = await collect(page, '.programme-page-applications ul > li');
      const second = await page.context().newPage();
      await open(second, width, { rows: 8 });
      await group(second, 'Participants and eligibility').click();
      await expect(
        second.locator('.people-board-row[data-kind="application"]').first(),
      ).toBeVisible();
      const on = await collect(second, '.people-board-row[data-kind="application"]');
      expect(Object.keys(off)).toHaveLength(8);
      expect(on).toEqual(off);
      expect(on['Synthetic applicant 7']).toEqual([
        'Invite Again',
        'Put on Waiting List',
        'Decline',
      ]);
      expect(on['Synthetic applicant 6']).toEqual([]);
    });

    test('with the board on, a payment declaration and a fee question are rendered with data and answered', async ({
      page,
    }) => {
      const seen = await open(page, width, { rows: 3, reviews: true });
      await openMoney(page);
      await expect(page.getByText('Awaiting Your Check (1)')).toBeVisible();
      await expect(page.getByText(/Synthetic participant 1 says they paid/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Acknowledge', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Not Accepted' }).click();
      await page.getByLabel(/^Reason the participant will read/).fill('Synthetic reason: not seen');
      await page.getByRole('button', { name: 'Send Reason' }).click();
      await expect
        .poll(() => seen.posts.filter((p) => p.path.endsWith('-payment-declarations')).length)
        .toBe(1);
      expect(seen.posts.find((p) => p.path.endsWith('-payment-declarations'))!.body).toMatchObject({
        action: 'decide',
        workspaceId,
        programmeId,
        declarationId: uuid(8, 1),
        decision: 'REJECTED',
        reason: 'Synthetic reason: not seen',
      });
      await expect(page.getByText('1 question waiting for you')).toBeVisible();
      await expect(page.getByText(/Synthetic participant 2: The amount looks wrong/)).toBeVisible();
      await page.getByRole('button', { name: 'Mark as Sorted Out' }).click();
      await expect
        .poll(() => seen.posts.filter((p) => p.path.endsWith('-fee-disputes')).length)
        .toBe(1);
      expect(seen.posts.find((p) => p.path.endsWith('-fee-disputes'))!.body).toMatchObject({
        action: 'decide',
        workspaceId,
        programmeId,
        disputeId: uuid(9, 1),
        outcome: 'RESOLVED',
      });
    });

    test('with the switch off the same declaration and question are there as before', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, reviews: true, board: false });
      await group(page, 'Terms and fees').click();
      await expect(page.getByText('Awaiting Your Check (1)')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Acknowledge', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Mark as Sorted Out' })).toBeVisible();
    });

    test('Show Older Entries opens the entries it loaded and says how many came', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, entryTotal: 30 });
      await openMoney(page);
      const more = page.locator('details.money-compact-more', { hasText: 'More Entries' });
      await expect(more.locator('> summary')).toHaveText('Show 20 More Entries');
      await expect(more).not.toHaveAttribute('open', '');
      await expect(page.locator('li strong', { hasText: /^#30$/ })).toBeVisible();
      await expect(page.locator('li strong', { hasText: /^#1$/ })).toBeHidden();
      await page.getByRole('button', { name: 'Show Older Entries' }).click();
      // The five older entries are in the list the person can see, and the count is said in a status line.
      await expect(more.locator('> summary')).toHaveText('Show 25 More Entries');
      await expect(more).toHaveAttribute('open', '');
      await expect(page.locator('li strong', { hasText: /^#1$/ })).toBeVisible();
      await expect(page.getByText('5 older entries are shown.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Show Older Entries' })).toHaveCount(0);
    });

    test('with the switch off Show Older Entries appends to the one list, as before', async ({
      page,
    }) => {
      await open(page, width, { rows: 3, entryTotal: 30, board: false });
      await group(page, 'Terms and fees').click();
      await expect(page.locator('li strong', { hasText: /^#30$/ })).toBeVisible();
      await page.getByRole('button', { name: 'Show Older Entries' }).click();
      await expect(page.locator('li strong', { hasText: /^#1$/ })).toBeVisible();
      await expect(page.locator('details.money-compact-more')).toHaveCount(0);
    });

    for (const [what, options] of [
      ['the programme room is off', { room: false }],
      ['the participants module is off', { participantsOn: false }],
    ] as const)
      test(`the switch alone shows nothing new when ${what}`, async ({ page }) => {
        await open(page, width, { rows: 3, ...options });
        // The board and the compact money view are the room's own: without it, or without the participants, the
        // screens are the ones that were there before, whatever the switch says.
        await expect(page.locator('.people-board')).toHaveCount(0);
        await expect(page.locator('.money-compact-more')).toHaveCount(0);
        await expect(page.locator('details.people-board-manage')).toHaveCount(0);
      });

    test('axe is clean on the board when the participants read failed', async ({ page }) => {
      await open(page, width, { rows: 3, participants: 'fail', applications: 'failOnce' });
      await openPeople(page);
      await expect(page.getByText(/^Applications could not be read\./)).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  });
