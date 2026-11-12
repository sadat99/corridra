import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The Room and the Compare lens (Lane 5 of the UX update), mounted the way the other operator specs
// mount their screens: the real component, the real provider and the real stylesheets in a small
// page, with the private request and report interfaces answered by the test. What is proved is what
// a person sees: the Road, the replies, the lenses, the cards and the table, the words in each
// language, and the layout on a phone. Every name, date and company is invented.
// Dates are asserted in the zone of the place, so the browser zone is set to one that differs from
// every zone used below. The page must never show the viewer's own zone.
test.use({ locale: 'en-US', timezoneId: 'America/New_York' });
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

const requestId = '11111111-1111-4111-8111-111111111111';
const resourceId = '33333333-3333-4333-8333-333333333333';
const subject = 'subject-1';
const issuer = 'https://example.invalid/corridra/auth';

const detail = (over: Record<string, unknown> = {}) => ({
  id: requestId,
  synthetic: true,
  available: true,
  original: { objective: 'Automatic fabric cutting machine', market: 'China' },
  progress: {
    status: 'MEETINGS',
    receivedAt: '2026-10-02T09:00:00Z',
    replies: [
      { body: 'We have shortlisted three suppliers.', createdAt: '2026-10-05T10:00:00Z' },
      { body: 'Meetings are being arranged for November.', createdAt: '2026-10-09T10:00:00Z' },
    ],
  },
  ...over,
});
const terms = {
  specification: 'Auto cutter 2.5 m bed',
  quantity: '2',
  unit: 'unit',
  unitPriceMinor: '1840000',
  totalPriceMinor: '3680000',
  leadTime: '45 days',
  validUntil: '2099-01-01T00:00:00.000Z',
  incoterm: 'FOB',
  shipping: 'EXCLUDED',
  paymentTerms: '30% deposit, 70% before shipping',
  toolingMinor: '0',
  setupMinor: '0',
  packagingMinor: '0',
};
const quote = (id: string, targetId: string, t: Record<string, unknown>) => ({
  id,
  targetId,
  currency: 'USD',
  terms: t,
  revision: 1,
  uncertainties: 'None stated',
  sourceKind: 'self_declaration',
  claimStatus: 'self_declared',
  superseded: false,
  assignmentCurrent: true,
});
const reportBody = (itinerary: unknown[] = []) => ({
  resourceId,
  report: {
    schemaVersion: 1,
    audience: 'CLIENT_PROGRESS',
    allowExport: false,
    expiresAt: '2099-01-01T00:00:00Z',
    purpose: 'Review of shortlisted suppliers',
    attribution: 'Prepared by the Corridra team',
    missions: [
      {
        publicationId: 'pub-1',
        title: 'Cutting machine mission',
        company: 'Atelier Rahman',
        objective: 'Find an automatic cutting machine',
        brief: 'Sample mission',
        nextAction: 'Review the offers',
        dueAt: '2026-11-05T00:00:00Z',
        reviewedAt: '2026-10-08T00:00:00Z',
        updatedAt: '2026-10-08T00:00:00Z',
        status: 'MEETINGS',
        itinerary,
        totals: [],
        outcomes: {
          opportunities: 0,
          qualified: 0,
          proposals: 0,
          contracts: 0,
          rfqs: 0,
          samples: 0,
          heldMeetings: 0,
        },
        requests: [
          {
            id: 'e1',
            title: 'Import licence number',
            instructions: 'Add your import licence number.',
            dueAt: '2026-11-05T00:00:00Z',
            status: 'OPEN',
          },
        ],
        experience: {
          schemaVersion: 1,
          requirements: {
            version: 1,
            fields: {
              objective: 'Find a cutting machine',
              role: 'BUYER',
              product: 'Cutting machine',
            },
            sourceKind: 'self_declaration',
            claimStatus: 'self_declared',
            current: true,
          },
          shortlist: [
            {
              id: 't1',
              company: 'Lantern Cutting Works',
              country: 'China',
              fit: 'HIGH',
              rationale: 'Fits',
              uncertainty: 'None',
              gaps: 'None',
              verification: 'Self-declared',
            },
            {
              id: 't2',
              company: '绿野机械有限公司',
              country: 'China',
              fit: 'MEDIUM',
              rationale: 'Fits',
              uncertainty: 'None',
              gaps: 'Installation',
              verification: 'Self-declared',
            },
          ],
          quotations: [
            quote('qa', 't1', terms),
            quote('qb', 't2', { ...terms, leadTime: undefined, paymentTerms: undefined }),
          ],
          agenda: [],
          documentAccess: 'None',
        },
      },
    ],
  },
});

type Options = {
  link?: { reportAvailable: boolean; savedResourceId: string | null };
  lenses?: boolean;
  trip?: boolean;
  service?: boolean;
  offered?: string;
  initialLens?: 'trip';
};
const props = (o: Options) => ({
  requestId,
  subject,
  issuer,
  link: o.link ?? { reportAvailable: true, savedResourceId: resourceId },
  serviceRequestsEnabled: o.service ?? true,
  decisionsEnabled: false,
  lenses: o.lenses ?? true,
  trip: o.trip ?? false,
  initialLens: o.initialLens,
});

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{WorkspaceShell}from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
      import{RoomView}from ${JSON.stringify(resolve('apps/web/app/account/rooms/[requestId]/room-view.tsx'))};
      import{SavedCommercialReport}from ${JSON.stringify(resolve('apps/web/app/account/missions/saved-commercial-report.tsx'))};
      const q=new URLSearchParams(location.search);
      const props=JSON.parse(q.get('props'));
      const offered=(q.get('offered')||'en').split(',').map(code=>({code,draft:code!=='en'}));
      createRoot(document.getElementById('fixture')).render(
        q.get('mode')==='report'
          ? <SavedCommercialReport subject={props.subject} issuer={props.issuer} resourceId={q.get('resourceId')}/>
          : <LanguageProvider offered={offered}>
              <WorkspaceShell eyebrow="ROOM" title="Your request, in one place.">
                <RoomView {...props}/>
              </WorkspaceShell>
            </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'next-fixture',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : 'const router={replace:()=>{},refresh:()=>{}};export function useRouter(){return router}',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Room fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Answer = { status?: number; body?: unknown };
async function open(page: Page, options: Options = {}, answer: Answer = {}, report: Answer = {}) {
  await page.route('**/api/customer-requests/**', (route) =>
    route.fulfill({
      status: answer.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(answer.body ?? detail()),
    }),
  );
  // REPORT_DELAY_MS slows the report answer, as a busy CI runner does, so a test that measures the page
  // before the report has rendered fails here and not only on a slow machine.
  const delay = Number(process.env.REPORT_DELAY_MS ?? 0);
  await page.route('**/api/customer-saved-missions', async (route) => {
    if (delay > 0) await new Promise((done) => setTimeout(done, delay));
    await route.fulfill({
      status: report.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(report.body ?? reportBody()),
    });
  });
  await page.goto(
    `${origin}/?props=${encodeURIComponent(JSON.stringify(props(options)))}&offered=${options.offered ?? 'en'}`,
  );
}
const lens = (page: Page, name: string) =>
  page.locator('.room-lenses').getByRole('button', { name });
// Approved work rooms (owner, 5 Nov 2026): the Compare view opens on the side-by-side comparison; the cards,
// the original table and every offer in full are one tap below it, unchanged.
async function openFull(page: Page) {
  await lens(page, 'Compare').click();
  await page
    .getByRole('button', { name: 'Show the Requirement, Shortlist and Every Offer' })
    .click();
}

test('shows who and what the request is, where it stands and what the team said', async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole('heading', { name: 'Automatic fabric cutting machine' }),
  ).toBeVisible();
  await expect(page.getByText('China · Received')).toBeVisible();
  // MEETINGS is Visit. A delivered report lights Compare; no decision is ever claimed, and a stage with no
  // record is a plain grey segment, never "Not tracked yet" (CX-06).
  const stage = page.locator('.room-stage .mr-stage');
  await expect(stage.locator('[aria-current="step"]')).toContainText('Visit');
  await expect(stage.locator('li')).toHaveCount(6);
  await expect(page.locator('.room-stage').getByText('Stage 4 of 6:')).toBeVisible();
  await expect(page.getByText('Not tracked yet')).toHaveCount(0);
  await expect(page.getByText('Meetings are being arranged for November.')).toBeVisible();
  await expect(page.getByText('We have shortlisted three suppliers.')).toHaveCount(0);
  await page.getByRole('button', { name: /Read Every Reply/ }).click();
  await expect(page.getByText('We have shortlisted three suppliers.')).toBeVisible();
});

// Approved work rooms (owner, 5 Nov 2026): a selling request names its views for selling, says the one next
// step from the report's own agenda, and shows where the buyers stand without tying a meeting to a buyer.
test('a selling request opens on its buyers and meetings, with the proposed meetings as the next step', async ({
  page,
}) => {
  const body = reportBody([
    { label: 'Meeting with Lantern Cutting Works', status: 'PROPOSED', scheduleChanged: false },
  ]);
  const e = body.report.missions[0].experience;
  // Two price requests, one sample, one proposal and no agreement: four separate facts.
  Object.assign(body.report.missions[0].outcomes, { rfqs: 2, samples: 1, proposals: 1 });
  e.quotations = [];
  e.agenda = [
    {
      id: 'a1',
      itemId: 'a1',
      version: 1,
      label: 'Buyer meeting',
      state: 'PROPOSED',
      nextAction: 'Confirm a time',
      dueAt: '2026-11-12T00:00:00Z',
      responsibility: 'Team',
      meetings: [],
    },
  ] as never;
  await open(
    page,
    { trip: true },
    {
      body: detail({
        // The shape the intake stores: the country and market inside the brief's experience.
        original: {
          objective: 'Find customers or distributors',
          experience: { schemaVersion: 1, companyCountry: 'BD', marketCode: 'ES' },
        },
      }),
    },
    { body },
  );
  await expect(page.locator('.room-tag')).toHaveText('Selling');
  await expect(page.locator('.room-route')).toHaveText('Bangladesh → Spain');
  await expect(page.locator('.room-lenses button')).toHaveText([
    'Overview',
    'Buyers',
    'Meetings',
    'Evidence',
  ]);
  const next = page.getByRole('region', { name: 'Your next step' });
  await expect(next).toContainText('Review the proposed meeting');
  await next.getByRole('button', { name: 'See Meetings' }).click();
  await expect(lens(page, 'Meetings')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Your meetings and visits' })).toBeVisible();
  await lens(page, 'Buyers').click();
  const funnel = page.locator('.sellb-funnel dd');
  // One tile per state: price requests, samples, proposals and agreements are never one number.
  await expect(page.locator('.sellb-funnel > div')).toHaveCount(8);
  await expect(page.locator('.sellb-funnel dt')).toHaveText([
    'buyers shortlisted',
    'meetings proposed',
    'confirmed',
    'held',
    'price requests',
    'samples',
    'proposals',
    'agreements',
  ]);
  await expect(funnel).toHaveText(['2', '1', '0', '0', '2', '1', '1', '0']);
  // Outreach is counted by staff when they approve the detail. This report carries none, so it is not shared, never zero.
  await expect(page.locator('.sellb-outreach dt')).toHaveText([
    'buyers approached',
    'buyers responded',
    'buyers interested',
  ]);
  await expect(page.locator('.sellb-outreach dd')).toHaveText([
    'Not shared',
    'Not shared',
    'Not shared',
  ]);
  const table = page.locator('.sellb-table');
  await expect(table.getByRole('rowheader')).toHaveCount(2);
  await expect(table.locator('thead th')).toHaveText(['Buyer', 'Fit', 'How it is backed']);
});

// Guardian review of PR 314: the next step asks only for what the room lets the person do.
test('without the question link the next step does not ask the person to tell the team', async ({
  page,
}) => {
  await open(page, { service: false });
  const next = page.getByRole('region', { name: 'Your next step' });
  await expect(next).toBeVisible();
  await expect(next).not.toContainText(/tell (us|the Corridra team)/i);
  await expect(next.getByRole('link', { name: 'Ask a Question' })).toHaveCount(0);
});

// Codex review of PR 314: before the first quote arrives, the requirement and shortlist stay one tap away.
test('with no quotes yet the comparison says so and still opens the requirement and shortlist', async ({
  page,
}) => {
  const body = reportBody();
  body.report.missions[0].experience.quotations = [];
  await open(
    page,
    {},
    { body: detail({ original: { objective: 'Source suppliers', market: 'CN' } }) },
    { body },
  );
  await lens(page, 'Compare Quotes').click();
  await expect(page.getByText('No quotes on the current request yet.')).toBeVisible();
  await page
    .getByRole('button', { name: 'Show the Requirement, Shortlist and Every Offer' })
    .click();
  await expect(page.getByText('Lantern Cutting Works').first()).toBeVisible();
});

// Guardian review of PR 314: with the Trip switch off there is no Meetings view, so the proposed meeting's step
// points to the saved report, where the times are.
test('a proposed meeting without the Meetings view points to the saved report', async ({
  page,
}) => {
  const body = reportBody();
  const e = body.report.missions[0].experience;
  e.quotations = [];
  e.agenda = [
    {
      id: 'a1',
      itemId: 'a1',
      version: 1,
      label: 'Buyer meeting',
      state: 'PROPOSED',
      nextAction: 'Confirm a time',
      dueAt: '2026-11-12T00:00:00Z',
      responsibility: 'Team',
      meetings: [],
    },
  ] as never;
  await open(
    page,
    { trip: false, service: false },
    { body: detail({ original: { objective: 'Find customers or distributors', market: 'ES' } }) },
    { body },
  );
  const next = page.getByRole('region', { name: 'Your next step' });
  await expect(next).toContainText('The proposed times are in your saved report.');
  await expect(next).not.toContainText('Meetings');
  await expect(next.getByRole('link', { name: 'Open the Saved Report' })).toHaveAttribute(
    'href',
    `/account/missions/${resourceId}`,
  );
});

test('keeps every original action one tap away', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('link', { name: 'Open the saved request' })).toHaveAttribute(
    'href',
    `/account/requests/${requestId}`,
  );
  await expect(page.getByRole('link', { name: 'Request help with this' })).toHaveAttribute(
    'href',
    `/account/service-requests/new?kind=request&ref=${requestId}`,
  );
  await expect(page.getByRole('link', { name: 'Open the saved report' })).toHaveAttribute(
    'href',
    `/account/missions/${resourceId}`,
  );
});

// W4: with nothing for the person to do the next step is a quiet link, not the one primary action, and it
// names who holds the request. Every state that does ask for something keeps its primary action.
const idle = (over: Record<string, unknown> = {}) => ({
  link: { reportAvailable: false, savedResourceId: null },
  lenses: false,
  service: false,
  ...over,
});
const idleDetail = (status: string) =>
  detail({ progress: { status, receivedAt: '2026-10-02T09:00:00Z', replies: [] } });

test('W4-room-idle: the idle next step opens the request as a quiet link, not a primary button', async ({
  page,
}) => {
  await open(page, idle());
  const next = page.getByRole('region', { name: 'Your next step' });
  const link = next.getByRole('link', { name: 'Open the Request' });
  await expect(link).toHaveAttribute('href', `/account/requests/${requestId}`);
  await expect(link).toHaveClass(/text-link/);
  await expect(next.locator('.button-primary')).toHaveCount(0);
  await expect(next.getByRole('button')).toHaveCount(0);
});

test('W4-room-idle: the states that ask for something keep their primary action', async ({
  page,
}) => {
  // Service requests on: the question link is the primary action.
  await open(page, idle({ service: true }));
  const next = page.getByRole('region', { name: 'Your next step' });
  await expect(next.getByRole('link', { name: 'Ask a Question' })).toHaveClass(/button-primary/);
  await expect(next.getByRole('link', { name: 'Open the Request' })).toHaveCount(0);
  // A delivered report that is not saved yet: the Library link is the primary action.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await open(page, idle({ link: { reportAvailable: true, savedResourceId: null } }));
  await expect(
    page
      .getByRole('region', { name: 'Your next step' })
      .getByRole('link', { name: 'Open Your Library' }),
  ).toHaveClass(/button-primary/);
  // A saved report to open: the report link is the primary action.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await open(
    page,
    idle({ link: { reportAvailable: true, savedResourceId: resourceId }, lenses: true }),
  );
  await expect(
    page.getByRole('region', { name: 'Your next step' }).locator('.button-primary'),
  ).toHaveCount(1);
});

test('W4-room-idle: with no subline the idle step says who holds the request', async ({ page }) => {
  await open(page, idle(), { body: idleDetail('ON_HOLD') });
  const next = page.getByRole('region', { name: 'Your next step' });
  await expect(next.locator('.room-next-words b')).toHaveText('Waiting on the Corridra team');
  await expect(next).not.toContainText('is working on your request');
  // A status that has its own subline keeps it first.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await open(page, idle(), { body: idleDetail('MEETINGS') });
  await expect(
    page.getByRole('region', { name: 'Your next step' }).locator('.room-next-words b'),
  ).toHaveText('Meetings are being arranged or held.');
});

test('a delivered report that is not saved yet points to the Library, not to a page that is not there', async ({
  page,
}) => {
  await open(page, { link: { reportAvailable: true, savedResourceId: null }, service: false });
  await expect(page.getByRole('link', { name: 'Open the saved report' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Request help with this' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Find the delivered report in your Library' }),
  ).toHaveAttribute('href', '/account?view=results');
});

test('without lenses there is no lens control, and without a report the Road does not claim Compare', async ({
  page,
}) => {
  await open(page, { lenses: false, link: { reportAvailable: false, savedResourceId: null } });
  await expect(
    page.getByRole('heading', { name: 'Automatic fabric cutting machine' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare' })).toHaveCount(0);
  // Without a report Compare is not lit: only Define and Find, the stages before Visit, are done.
  const stage = page.locator('.room-stage .mr-stage');
  await expect(stage.locator('li[data-state="done"]')).toHaveCount(2);
  await expect(page.getByText('Not tracked yet')).toHaveCount(0);
});

// Source follow-ups 1 and 3 (S63): a machinery mission says which offer leaves out commissioning, and each quote carries the date it
// was observed and the first eight characters of its source record. No other mission shows a machinery row.
for (const width of [1440, 390]) {
  test(`a machinery mission shows commissioning and the quote reference in the comparison at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const body = reportBody();
    const e = body.report.missions[0].experience as unknown as {
      requirements: Record<string, unknown>;
      quotations: Record<string, unknown>[];
    };
    e.requirements.assignmentType = 'machinery_procurement';
    const ref = {
      sourceId: '3f9a2c1d-1111-4222-8333-444455556666',
      observedAt: '2026-10-07T09:30:00Z',
    };
    e.quotations = [
      {
        ...quote('qa', 't1', {
          ...terms,
          installation: 'Included',
          warranty: 'One year',
          training: 'Two days',
          spares: 'Quoted separately',
          commissioning: 'Two engineers for five days',
        }),
        ...ref,
      },
      {
        ...quote('qb', 't2', {
          ...terms,
          installation: 'Included',
          warranty: 'One year',
          training: 'Two days',
          spares: 'Quoted separately',
        }),
        ...ref,
        sourceId: '9b8e7d6c-1111-4222-8333-444455556666',
      },
    ];
    await open(page, {}, {}, { body });
    await lens(page, 'Compare').click();
    if (width >= 768) {
      const ledger = page.locator('.ledger-table');
      await expect(ledger.getByRole('row', { name: /^Commissioning/ })).toContainText(
        'Two engineers for five days',
      );
      await expect(ledger.getByRole('row', { name: /^Commissioning/ })).toContainText('Not stated');
      await expect(ledger).toContainText('Quoted Oct 7, 2026 · Source ref 3f9a2c1d');
      await expect(ledger).toContainText('Source ref 9b8e7d6c');
      await expect(ledger.getByRole('row', { name: /^Can be compared/ })).toContainText(
        'Missing: Commissioning',
      );
    } else {
      const cards = page.locator('.ledger-card');
      await expect(cards.nth(0)).toContainText('Two engineers for five days');
      await expect(cards.nth(0)).toContainText('Quoted Oct 7, 2026 · Source ref 3f9a2c1d');
      await expect(cards.nth(1)).toContainText('Commissioning');
      await expect(cards.nth(1)).toContainText('Source ref 9b8e7d6c');
      await expect(cards.nth(1)).toContainText('Missing: Commissioning');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (process.env.UX_SHOTS_DIR)
      await page.screenshot({
        path: `${process.env.UX_SHOTS_DIR}/commissioning-compare-${width}.png`,
        fullPage: true,
      });
  });
}

test('the Compare lens puts the suppliers side by side with the verdict, the cards and table one tap away', async ({
  page,
}) => {
  await open(page);
  await lens(page, 'Compare').click();
  // The side-by-side comparison first: one column per supplier, original currency, missing terms said.
  const ledger = page.locator('.ledger-table');
  await expect(ledger.getByRole('columnheader')).toHaveCount(2);
  await expect(ledger.locator('thead b[lang="zh"]')).toHaveText('绿野机械有限公司');
  await expect(ledger.getByRole('row', { name: /^Can be compared/ })).toContainText(
    'Missing: Lead time, Payment terms.',
  );
  await expect(ledger.locator('.ledger-badge[data-ok="true"]')).toHaveCount(1);
  await expect(ledger.locator('.ledger-badge[data-ok="false"]')).toHaveCount(1);
  await expect(ledger).toContainText('USD');
  await expect(ledger).toContainText('Self-declared');
  await expect(ledger.getByText('Not stated').first()).toBeVisible();
  await expect(page.locator('.mr-quote')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Show the Requirement, Shortlist and Every Offer' })
    .click();
  const cards = page.locator('.mr-quote');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Comparable on supplied terms');
  await expect(cards.nth(1)).toContainText('Not comparable yet');
  await expect(cards.nth(1)).toContainText('Missing: Lead time, Payment terms.');
  await expect(cards.nth(1).getByText('Not stated').first()).toBeVisible();
  await expect(cards.nth(0)).toContainText('USD');
  await expect(cards.nth(0)).toContainText('Self-declared');
  await expect(page.locator('.mr-quote h3[lang="zh"]')).toHaveText('绿野机械有限公司');
  await expect(page.locator('table.ux-comparison-matrix')).toHaveCount(0);
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.locator('table.ux-comparison-matrix')).toBeVisible();
  await expect(page.locator('.mr-quote')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cards' }).click();
  await expect(page.locator('.mr-quote')).toHaveCount(2);
});

test('the table keeps every original commercial term and names missing obligations', async ({
  page,
}) => {
  await open(page);
  await openFull(page);
  await page.getByRole('button', { name: 'Table' }).click();
  const matrix = page.locator('table.ux-comparison-matrix');
  for (const label of [
    'Minimum order quantity',
    'Tooling',
    'Setup',
    'Packaging',
    'Offer valid until',
    'Delivery terms (Incoterm)',
    'Shipping scope',
    'Warranty',
    'Installation',
    'Training',
    'Spares',
  ])
    await expect(matrix.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
  await expect(
    matrix.getByRole('row', { name: 'Shipping scope EXCLUDED EXCLUDED', exact: true }),
  ).toBeVisible();
  await expect(
    matrix.getByRole('row', {
      name: 'Minimum order quantity NOT SUPPLIED NOT SUPPLIED',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    matrix.getByRole('row', { name: 'Tooling USD 0.00 USD 0.00', exact: true }),
  ).toBeVisible();
});

for (const [name, firstTerms, secondTerms] of [
  [
    'different tire specifications',
    { ...terms, specification: 'Truck tire 315/80 R22.5' },
    { ...terms, specification: 'Truck tire 385/65 R22.5' },
  ],
  [
    'different machinery installation obligations',
    { ...terms, installation: 'On-site installation included' },
    { ...terms, installation: 'Installation excluded' },
  ],
] as const) {
  test(`both offers require review for ${name}`, async ({ page }) => {
    await open(page);
    await page.unroute('**/api/customer-saved-missions');
    const report = reportBody();
    report.report.missions[0].experience.quotations = [
      quote('qa', 't1', firstTerms),
      quote('qb', 't2', secondTerms),
    ];
    await page.route('**/api/customer-saved-missions', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) }),
    );
    await page.reload();
    await lens(page, 'Compare').click();
    // The comparison says so first, for both suppliers, and the cards agree.
    await expect(page.locator('.ledger-table .ledger-badge[data-ok="false"]')).toHaveCount(2);
    await expect(page.locator('.ledger-table .ledger-badge[data-ok="true"]')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Show the Requirement, Shortlist and Every Offer' })
      .click();
    const cards = page.locator('.mr-quote');
    await expect(cards).toHaveCount(2);
    for (const card of await cards.all()) await expect(card).toContainText('Not comparable yet');
    await expect(cards.getByText('Comparable on supplied terms', { exact: true })).toHaveCount(0);
  });
}

test('the Evidence lens explains the five labels and keeps the evidence requests', async ({
  page,
}) => {
  await open(page);
  await lens(page, 'Evidence').click();
  await expect(page.getByRole('heading', { name: 'What the labels mean' })).toBeVisible();
  for (const label of [
    'Self-declared',
    'Evidence available',
    'Verified',
    'Derived',
    'Outcome observed',
  ])
    await expect(page.locator('.room-legend').getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Import licence number' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Reply to this evidence request' })).toBeVisible();
});

test('without a saved report the lenses say so plainly', async ({ page }) => {
  await open(page, { link: { reportAvailable: false, savedResourceId: null } });
  await lens(page, 'Compare').click();
  await expect(
    page.getByText('Offers and evidence appear here once the Corridra team delivers'),
  ).toBeVisible();
  await expect(page.locator('.mr-quote')).toHaveCount(0);
});

test('says plainly when the request is gone, and when access cannot be confirmed', async ({
  page,
}) => {
  await open(page, {}, { body: detail({ available: false, original: null, progress: null }) });
  await expect(page.getByText('The original request is no longer available.')).toBeVisible();
  await expect(page.locator('.mr-road')).toHaveCount(0);
  await page.unroute('**/api/customer-requests/**');
  await page.route('**/api/customer-requests/**', (route) =>
    route.fulfill({ status: 403, body: '{}' }),
  );
  await page.reload();
  await expect(page.getByText('Your private request access could not be confirmed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Automatic fabric cutting machine' })).toHaveCount(
    0,
  );
});

test('speaks Bangla and says which language the region is in', async ({ page }) => {
  await open(page, { offered: 'en,bn' } as Options);
  await page.evaluate(() => window.localStorage.setItem('corridra.language', 'bn'));
  await page.reload();
  await expect(page.locator('.room')).toHaveAttribute('lang', 'bn');
  await expect(page.getByRole('heading', { name: 'Corridra টিমের উত্তর' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'সংরক্ষিত অনুরোধ খুলুন' })).toBeVisible();
  await lens(page, 'তুলনা').click();
  await expect(page.locator('.ledger-table')).toBeVisible();
  // The report itself is English, so its region says so: the comparison and the cards below it.
  await expect(page.locator('div[lang="en"] .ledger-table')).toBeVisible();
  await page
    .getByRole('button', { name: 'Show the Requirement, Shortlist and Every Offer' })
    .click();
  await expect(page.locator('div[lang="en"] .mr-quote').first()).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide in every lens: no sideways scroll, 44 pixel targets, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    for (const [name, view] of [
      ['Overview', null],
      ['Compare', null],
      ['Compare', 'Cards'],
      ['Compare', 'Table'],
      ['Evidence', null],
    ] as const) {
      await lens(page, name).click();
      if (view) {
        const full = page.getByRole('button', {
          name: 'Show the Requirement, Shortlist and Every Offer',
        });
        if (await full.count()) await full.click();
        await page.getByRole('button', { name: view }).click();
      }
      await page.waitForTimeout(150);
      const wide = await page.evaluate((limit) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('main *'))) {
          const r = el.getBoundingClientRect();
          // The comparison table, and on a phone the supplier cards, scroll inside their own labelled, focusable
          // region by design; nothing else may be wider than the screen.
          if (
            r.width > 0 &&
            r.right > limit + 1 &&
            !el.closest('.ux-comparison-scroll, .ledger-scroll, .ledger-cards-scroll')
          )
            out.push(
              `${el.tagName.toLowerCase()}.${(el as HTMLElement).className} ${Math.round(r.right)}`,
            );
        }
        return out.slice(0, 6);
      }, width);
      expect(wide, `${name} ${view ?? ''} at ${width}`).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `${name} ${view ?? ''} at ${width}`,
      ).toBeLessThanOrEqual(width);
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll('main :is(a[href], button, summary)'))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.height < 43.5)
          .map(
            ({ el }) => `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 30)}`,
          ),
      );
      expect(small, `${name} ${view ?? ''} at ${width}`).toEqual([]);
      expect(
        (await new AxeBuilder({ page }).analyze()).violations,
        `axe ${name} ${view ?? ''} ${width}`,
      ).toEqual([]);
      if (process.env.UX_SHOTS_DIR)
        await page.screenshot({
          path: `${process.env.UX_SHOTS_DIR}/room-${name.toLowerCase()}${view ? '-' + view.toLowerCase() : ''}-${width}.png`,
          fullPage: true,
        });
    }
  });
}

// The whole saved report page (section "all") is pinned byte for byte, so the Trip lens cannot change
// what the saved mission page shows. The expected HTML was captured from the page before the Trip lens
// was added.
const everyKindOfMeeting = [
  {
    label: 'Visit to Lantern Cutting Works',
    status: 'SCHEDULED',
    scheduleChanged: false,
    startsAt: '2026-11-09T04:00:00Z',
    endsAt: '2026-11-09T06:30:00Z',
    timezone: 'Asia/Dhaka',
    location: 'Dhaka Chamber of Commerce',
  },
  {
    label: '绿野机械有限公司 meeting',
    status: 'PROPOSED',
    scheduleChanged: false,
    startsAt: '2026-11-10T01:00:00Z',
  },
  {
    label: 'Factory tour',
    status: 'RESCHEDULE_REQUIRED',
    scheduleChanged: true,
    startsAt: '2026-11-11T01:00:00Z',
    location: 'Old hall',
  },
  { label: 'Call to agree samples', status: 'ACCEPTED', scheduleChanged: false },
];

test('the whole saved report page is byte for byte what it was before the Trip lens', async ({
  page,
}) => {
  await page.route('**/api/customer-saved-missions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reportBody(everyKindOfMeeting)),
    }),
  );
  await page.goto(
    `${origin}/?mode=report&props=${encodeURIComponent(JSON.stringify(props({})))}&resourceId=${resourceId}`,
  );
  await page.getByRole('button', { name: 'Refresh Approved Commercial Report' }).waitFor();
  const html = await page.locator('#fixture').innerHTML();
  const path = resolve('tests/operator/golden/saved-report-all.golden');
  expect(html).toBe(readFileSync(path, 'utf8'));
  // The meetings are still the old list: label, status, then the sentence with its zone.
  await expect(page.getByRole('heading', { name: 'Meetings and visits' })).toBeVisible();
  await expect(
    page.getByText('The schedule changed. A new reviewed itinerary is required.'),
  ).toBeVisible();
});

// The Trip lens (Batch E part E1). Every name, place and time is invented.
type Meeting = Record<string, unknown>;
const meeting = (label: string, over: Meeting = {}): Meeting => ({
  label,
  status: 'SCHEDULED',
  scheduleChanged: false,
  ...over,
});
/** Long names and places, as real ones are: they wrap, they are never cut. */
const longLabel = (n: number) =>
  `Meeting with Bangladesh Garments Manufacturers and Exporters Association number ${n}`;
const longPlace = (n: number) =>
  `Hall ${n}, Dhaka Chamber of Commerce, Motijheel Commercial Area, Dhaka 1000`;
const dhakaVisit = meeting('Meeting with Dhaka Textile Association', {
  startsAt: '2026-11-09T04:00:00Z',
  endsAt: '2026-11-09T06:30:00Z',
  timezone: 'Asia/Dhaka',
  location: 'Dhaka Chamber of Commerce',
});
/** Seven meetings in a scrambled order: three dated, one undated, one with a changed time, one reschedule. */
const sevenMeetings = (): Meeting[] => [
  meeting('Late visit', {
    startsAt: '2026-11-13T04:00:00Z',
    timezone: 'Asia/Dhaka',
    location: 'Gazipur factory',
  }),
  meeting('Undated call', { status: 'ACCEPTED' }),
  meeting('Changed visit', {
    scheduleChanged: true,
    startsAt: '2026-11-08T04:00:00Z',
    timezone: 'Asia/Dhaka',
    location: 'Stale Hall Seven',
  }),
  meeting('First visit', {
    startsAt: '2026-11-09T04:00:00Z',
    timezone: 'Asia/Dhaka',
    location: 'Dhaka Chamber of Commerce',
    status: 'HELD',
  }),
  meeting('Reschedule needed', { status: 'RESCHEDULE_REQUIRED', startsAt: '2026-11-07T04:00:00Z' }),
  meeting('Middle visit', {
    startsAt: '2026-11-11T04:00:00Z',
    timezone: 'Asia/Dhaka',
    location: 'Narayanganj mill',
    status: 'PROPOSED',
  }),
  meeting('Second undated', { status: 'DECLINED' }),
];

async function openTrip(
  page: Page,
  itinerary: Meeting[],
  options: Options = {},
  report: Answer = { body: reportBody(itinerary) },
) {
  await open(page, { trip: true, ...options }, {}, report);
  await lens(page, 'Trip').click();
}
const tripRegion = (page: Page) => page.getByRole('region', { name: 'Your meetings and visits' });
const items = (page: Page) => page.locator('.room-trip-list > li');
/**
 * The real page puts the Room straight under main.ux-customer with the test-mode note and the tabs
 * above it (KI-16). The fixture is one level deeper, so rebuild that frame for a measurement. React's
 * events are tied to the old container, so do this last, after every click.
 */
async function toCustomerFrame(page: Page) {
  // Name the nodes the rebuild needs, so a page that is not ready fails here with a clear message.
  await expect(page.locator('#fixture > main > .ux-page-heading')).toHaveCount(1);
  await expect(page.locator('#fixture > main')).toHaveCount(1);
  await page.evaluate(() => {
    const main = document.querySelector('main')!;
    main.classList.add('ux-customer');
    const fixture = document.getElementById('fixture')!;
    main.style.cssText = '';
    const note = document.createElement('p');
    note.className = 'ux-testmode';
    note.textContent = 'Preview workspace: use made-up names and details here.';
    const nav = document.createElement('nav');
    nav.className = 'guide-tabs';
    nav.innerHTML = ['Home', 'My Work', 'Companies', 'Results', 'More']
      .map((name) => `<a href="#">${name}</a>`)
      .join('');
    main.querySelector('.ux-page-heading')!.after(note, nav);
    fixture.replaceWith(...Array.from(fixture.childNodes));
    for (const details of Array.from(document.querySelectorAll('details'))) details.open = false;
  });
}

test('without the switch the Room has exactly three lens buttons and no Trip words', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('.room-lenses button')).toHaveText(['Overview', 'Compare', 'Evidence']);
  await expect(page.getByRole('button', { name: 'Trip', exact: true })).toHaveCount(0);
  await expect(page.locator('.room-trip-list')).toHaveCount(0);
  // The switch cannot create a lens bar the lenses switch did not: no lenses, no bar.
  await open(page, { lenses: false, trip: true });
  await expect(page.locator('.room-lenses')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Trip', exact: true })).toHaveCount(0);
});

test('W8: the Room opens on Meetings when the address asked for it, and on Overview otherwise', async ({
  page,
}) => {
  await open(page, { trip: true, initialLens: 'trip' });
  await expect(lens(page, 'Trip')).toHaveAttribute('aria-pressed', 'true');
  await expect(lens(page, 'Overview')).toHaveAttribute('aria-pressed', 'false');
  await expect(tripRegion(page)).toBeVisible();
  // Without the asking, Overview is shown first as always, and the Trip lens is one tap away.
  await open(page, { trip: true });
  await expect(lens(page, 'Overview')).toHaveAttribute('aria-pressed', 'true');
  await expect(tripRegion(page)).toHaveCount(0);
});

test('with the switch Trip is the fourth lens, last, and Overview is still the one shown', async ({
  page,
}) => {
  await open(page, { trip: true });
  await expect(page.locator('.room-lenses button')).toHaveText([
    'Overview',
    'Compare',
    'Evidence',
    'Trip',
  ]);
  await expect(lens(page, 'Overview')).toHaveAttribute('aria-pressed', 'true');
  await expect(lens(page, 'Trip')).toHaveAttribute('aria-pressed', 'false');
  // In English the lens name needs no language mark.
  await expect(lens(page, 'Trip').locator('[lang]')).toHaveCount(0);
  await expect(page.locator('.room-trip-list')).toHaveCount(0);
  await lens(page, 'Trip').click();
  await expect(lens(page, 'Trip')).toHaveAttribute('aria-pressed', 'true');
  await expect(lens(page, 'Overview')).toHaveAttribute('aria-pressed', 'false');
});

test('shows the reviewed meeting with its status, its time in the time zone of the place, and its place', async ({
  page,
}) => {
  await openTrip(page, [dhakaVisit, meeting('Second call', { status: 'ACCEPTED' })]);
  const region = tripRegion(page);
  await expect(region.getByRole('heading', { name: 'Your meetings and visits' })).toBeVisible();
  await expect(
    region.getByText('These are the meetings and visits the Corridra team has reviewed'),
  ).toBeVisible();
  await expect(region.getByText('2 meetings or visits', { exact: true })).toBeVisible();
  const first = items(page).first();
  await expect(
    first.getByRole('heading', { name: 'Meeting with Dhaka Textile Association' }),
  ).toBeVisible();
  await expect(first.locator('.ux-status')).toHaveText('Time confirmed');
  // The browser is in New York; the time is Dhaka's (04:00 UTC is 10:00 in Dhaka).
  await expect(first.getByText('9 Nov 2026, 10:00 (Dhaka, UTC+6)')).toBeVisible();
  await expect(first.getByText('9 Nov 2026, 12:30 (Dhaka, UTC+6)')).toBeVisible();
  await expect(first.locator('dt')).toHaveText(['Starts', 'Ends', 'Place']);
  await expect(first.getByText('Dhaka Chamber of Commerce')).toBeVisible();
  const time = first.locator('time').first();
  await expect(time).toHaveAttribute('datetime', '2026-11-09T04:00:00Z');
  await expect(time).toHaveAttribute('dir', 'ltr');
  await expect(first.locator('h4')).toHaveAttribute('dir', 'auto');
  // The second call has no time: it says so, and shows no Starts or Ends.
  const second = items(page).nth(1);
  await expect(second.getByText('No confirmed time yet.')).toBeVisible();
  await expect(second.getByText('Not shared yet')).toBeVisible();
  await expect(second.locator('dt')).toHaveText(['Place']);
  await expect(second.locator('time')).toHaveCount(0);
});

test('shows one meeting in the singular and offers no show-all control', async ({ page }) => {
  await openTrip(page, [dhakaVisit]);
  await expect(tripRegion(page).getByText('1 meeting or visit', { exact: true })).toBeVisible();
  await expect(items(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Show All/ })).toHaveCount(0);
});

test('shows the first five of seven in time order, with undated and changed meetings last, and the rest on request', async ({
  page,
}) => {
  await openTrip(page, sevenMeetings());
  await expect(items(page)).toHaveCount(5);
  await expect(items(page).locator('h4')).toHaveText([
    'First visit',
    'Middle visit',
    'Late visit',
    'Undated call',
    'Second undated',
  ]);
  const toggle = page.getByRole('button', { name: 'Show All 7 Meetings and Visits' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(items(page)).toHaveCount(7);
  await expect(items(page).locator('h4')).toHaveText([
    'First visit',
    'Middle visit',
    'Late visit',
    'Undated call',
    'Second undated',
    'Changed visit',
    'Reschedule needed',
  ]);
  const fewer = page.getByRole('button', { name: 'Show Fewer' });
  await expect(fewer).toHaveAttribute('aria-expanded', 'true');
  await expect(fewer).toBeFocused();
  await fewer.click();
  await expect(items(page)).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Show All 7 Meetings and Visits' })).toBeFocused();
});

test('names each status in plain words and shows an unknown status as it was supplied', async ({
  page,
}) => {
  const statuses = [
    ['PROPOSED', 'Suggested', 'neutral'],
    ['ACCEPTED', 'Accepted', 'info'],
    ['SCHEDULED', 'Time confirmed', 'info'],
    ['HELD', 'Done', 'positive'],
    ['DECLINED', 'Declined', 'caution'],
    ['CANCELLED', 'Cancelled', 'caution'],
    ['NO_SHOW', 'Missed', 'caution'],
    ['SOMETHING_NEW', 'SOMETHING_NEW', 'neutral'],
  ] as const;
  await openTrip(
    page,
    statuses.map(([status], index) => meeting(`Meeting ${index}`, { status })),
  );
  await page.getByRole('button', { name: /Show All 8/ }).click();
  for (const [index, [, words, tone]] of statuses.entries()) {
    const badge = items(page).nth(index).locator('.ux-status');
    await expect(badge).toHaveText(words);
    await expect(badge).toHaveAttribute('data-tone', tone);
  }
});

for (const [name, changed] of [
  ['a changed schedule', { scheduleChanged: true, status: 'SCHEDULED' }],
  ['a required new time', { scheduleChanged: false, status: 'RESCHEDULE_REQUIRED' }],
] as const) {
  test(`${name} shows the label and the notice and none of the old time, place or status`, async ({
    page,
  }) => {
    await openTrip(page, [
      meeting('Hall visit', {
        ...changed,
        startsAt: '2026-11-20T09:00:00Z',
        endsAt: '2026-11-20T11:00:00Z',
        timezone: 'Asia/Dhaka',
        location: 'Stale Hall Nine',
      }),
    ]);
    const item = items(page).first();
    await expect(item.getByRole('heading', { name: 'Hall visit' })).toBeVisible();
    await expect(item.locator('.ux-status')).toHaveText('Date changed');
    await expect(item.locator('.ux-status')).toHaveAttribute('data-tone', 'caution');
    await expect(
      item.getByText(
        'The date or time has changed. We do not show the old time. Ask the Corridra team for the new one.',
      ),
    ).toBeVisible();
    // Nothing stale in the page, in any form a person or a screen reader could reach.
    for (const stale of [
      'Stale Hall Nine',
      '15:00',
      '17:00',
      '2026-11-20',
      'Time confirmed',
      'RESCHEDULE_REQUIRED',
      'SCHEDULED',
    ])
      await expect(page.getByText(stale), stale).toHaveCount(0);
    expect(await page.content()).not.toMatch(/Stale Hall Nine|2026-11-20/);
    await expect(items(page).locator('time')).toHaveCount(0);
    await expect(item.locator('dl, dt, dd')).toHaveCount(0);
  });
}

test('says what is missing without inventing it: no end, no place, no time zone', async ({
  page,
}) => {
  await openTrip(page, [
    meeting('No end given', { startsAt: '2026-11-09T04:00:00Z', location: 'Open air stage' }),
    meeting('No place given', {
      startsAt: '2026-11-10T04:00:00Z',
      endsAt: '2026-11-10T05:00:00Z',
      timezone: 'Asia/Dhaka',
    }),
    meeting('Nothing given'),
  ]);
  const noEnd = items(page).nth(0);
  await expect(noEnd.locator('dt')).toHaveText(['Starts', 'Place']);
  // No zone was supplied: the time says UTC and nothing else.
  await expect(noEnd.getByText('9 Nov 2026, 04:00 (UTC)')).toBeVisible();
  const noPlace = items(page).nth(1);
  await expect(noPlace.locator('dt')).toHaveText(['Starts', 'Ends', 'Place']);
  await expect(noPlace.getByText('Not shared yet')).toBeVisible();
  const nothing = items(page).nth(2);
  await expect(nothing.getByText('No confirmed time yet.')).toBeVisible();
  await expect(nothing.getByText('Not shared yet')).toBeVisible();
});

test('says plainly when the report has no meetings yet, and offers no list or count', async ({
  page,
}) => {
  await openTrip(page, []);
  const region = tripRegion(page);
  await expect(region.getByRole('heading', { name: 'Your meetings and visits' })).toBeVisible();
  await expect(region.locator('.ux-empty')).toHaveText(
    'No meetings or visits are ready to show yet. They appear here after the Corridra team reviews them.',
  );
  await expect(page.locator('.room-trip-list')).toHaveCount(0);
  await expect(region.getByText(/meetings? or visits?$/)).toHaveCount(0);
});

test('without a saved report the Trip lens says so and asks for nothing', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url());
  });
  await open(page, { trip: true, link: { reportAvailable: false, savedResourceId: null } });
  await lens(page, 'Trip').click();
  await expect(page.locator('p.ux-empty[role="status"]')).toHaveText(
    'Your meetings and visits appear here once the Corridra team delivers a report for this request and you save it.',
  );
  await expect(page.locator('.room-trip-list')).toHaveCount(0);
  expect(posts.filter((url) => url.includes('customer-saved-missions'))).toEqual([]);
});

for (const status of [401, 403, 409]) {
  test(`access refused with ${status} shows the existing notice, leaves no meeting in the page, and recovers`, async ({
    page,
  }) => {
    await openTrip(page, [dhakaVisit], {}, { status, body: {} });
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'This saved mission is unavailable or access could not be confirmed.' }),
    ).toBeVisible();
    await expect(page.getByText('Meeting with Dhaka Textile Association')).toHaveCount(0);
    expect(await page.content()).not.toContain('Dhaka Chamber of Commerce');
    // Access comes back: the existing refresh button brings the list back.
    await page.unroute('**/api/customer-saved-missions');
    await page.route('**/api/customer-saved-missions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(reportBody([dhakaVisit])),
      }),
    );
    await page.getByRole('button', { name: 'Refresh Approved Commercial Report' }).click();
    await expect(items(page)).toHaveCount(1);
  });
}

test('access that ends while the page is open removes the meetings on the next refresh', async ({
  page,
}) => {
  await openTrip(page, [dhakaVisit]);
  await expect(items(page)).toHaveCount(1);
  await page.unroute('**/api/customer-saved-missions');
  await page.route('**/api/customer-saved-missions', (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }),
  );
  // The person comes back to the tab: the report is read again and refused.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(
    page.getByRole('alert').filter({ hasText: 'No commercial report content is shown.' }),
  ).toBeVisible();
  await expect(page.getByText('Meeting with Dhaka Textile Association')).toHaveCount(0);
  await expect(page.locator('.room-trip-list')).toHaveCount(0);
});

for (const [status, message] of [
  [503, 'Saved commercial reports are temporarily unavailable.'],
  [500, 'Your approved report could not be loaded. Try again.'],
] as const) {
  test(`a ${status} answer shows the existing message and the refresh button brings the meetings back`, async ({
    page,
  }) => {
    await openTrip(page, [dhakaVisit], {}, { status, body: {} });
    await expect(page.getByText(message)).toBeVisible();
    await expect(items(page)).toHaveCount(0);
    await page.unroute('**/api/customer-saved-missions');
    await page.route('**/api/customer-saved-missions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(reportBody([dhakaVisit])),
      }),
    );
    await page.getByRole('button', { name: 'Refresh Approved Commercial Report' }).click();
    await expect(items(page)).toHaveCount(1);
    await expect(page.getByText(message)).toHaveCount(0);
  });
}

test('shows nothing but the meetings: no money, offers, contacts, outcomes, evidence forms or export', async ({
  page,
}) => {
  const body = reportBody([dhakaVisit]);
  Object.assign(body.report.missions[0]!, {
    totals: [
      {
        currency: 'USD',
        contractMinor: '123456700',
        invoiceMinor: '100',
        confirmedCashMinor: '200',
        repeatCashMinor: '0',
      },
    ],
    outcomes: {
      opportunities: 4,
      qualified: 3,
      proposals: 2,
      contracts: 1,
      rfqs: 0,
      samples: 0,
      heldMeetings: 5,
    },
  });
  await openTrip(page, [], {}, { body });
  // Wait for the list to be drawn, or every absence below would pass while the report is loading.
  await expect(items(page)).toHaveCount(1);
  const main = page.locator('main');
  for (const absent of [
    'Commercial objective',
    'Find an automatic cutting machine',
    'Lantern Cutting Works',
    'Auto cutter 2.5 m bed',
    'Recorded commercial progress',
    'Qualified opportunities',
    'Customer contracts',
    'USD',
    '1,234,567',
    'Import licence number',
    'Evidence requests and declarations',
    'Reply to this evidence request',
    'Back to my saved commercial missions',
  ])
    await expect(main.getByText(absent, { exact: false }), absent).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'Meetings and visits', level: 2 })).toHaveCount(0);
  await expect(main.locator('form, textarea, input, table, details')).toHaveCount(0);
  await expect(
    main.getByRole('button', { name: /export|download|print|share|calendar|ics/i }),
  ).toHaveCount(0);
  await expect(
    main.getByRole('link', { name: /export|download|print|share|calendar|ics/i }),
  ).toHaveCount(0);
  // The other parts of the report are still where they were in the other lenses.
  await lens(page, 'Compare').click();
  await expect(page.locator('.ledger-table')).toBeVisible();
  await lens(page, 'Evidence').click();
  await expect(page.getByRole('heading', { name: 'Import licence number' })).toBeVisible();
});

test('switching between lenses asks for the report once', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/customer-saved-missions'))
      posts.push(request.url());
  });
  await open(page, { trip: true });
  await lens(page, 'Compare').click();
  await expect(page.locator('.ledger-table')).toBeVisible();
  await lens(page, 'Trip').click();
  await expect(page.getByRole('heading', { name: 'Your meetings and visits' })).toBeVisible();
  await lens(page, 'Evidence').click();
  await expect(page.getByRole('heading', { name: 'Import licence number' })).toBeVisible();
  await lens(page, 'Trip').click();
  await expect(page.getByRole('heading', { name: 'Your meetings and visits' })).toBeVisible();
  expect(posts).toHaveLength(1);
});

test('keeps the Trip words in English and the data as written when the page is Arabic or Bangla', async ({
  page,
}) => {
  const arabic = 'زيارة مصنع النسيج';
  const bangla = 'ঢাকা বস্ত্র সমিতির সভা';
  await open(
    page,
    { trip: true, offered: 'en,bn,ar' },
    {},
    {
      body: reportBody([
        meeting(arabic, {
          startsAt: '2026-11-09T04:00:00Z',
          timezone: 'Asia/Dhaka',
          location: bangla,
        }),
      ]),
    },
  );
  for (const code of ['ar', 'bn']) {
    await page.evaluate((value) => window.localStorage.setItem('corridra.language', value), code);
    await page.reload();
    await expect(page.locator('.room')).toHaveAttribute('lang', code);
    await expect(page.locator('.room')).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
    // The lens name is an English placeholder inside a translated region, so it says so.
    await expect(page.locator('.room-lenses button').nth(3).locator('span[lang="en"]')).toHaveText(
      'Trip',
    );
    await page.locator('.room-lenses button').nth(3).click();
    const heading = page.locator('h3', { hasText: 'Your meetings and visits' });
    await expect(heading).toBeVisible();
    // The static words sit inside the English region, as the report words do.
    expect(await heading.evaluate((el) => el.closest('[lang]')?.getAttribute('lang'))).toBe('en');
    expect(await heading.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
    const item = items(page).first();
    await expect(item.locator('h4')).toHaveText(arabic);
    await expect(item.locator('dd', { hasText: bangla })).toHaveCount(1);
    await expect(item.locator('time').first()).toHaveAttribute('dir', 'ltr');
    await expect(item.locator('time').first()).toHaveAttribute('lang', code);
  }
});

for (const [width, framed] of [320, 390, 768, 1440].flatMap((w) => [
  [w, false] as const,
  [w, true] as const,
])) {
  test(`the Trip lens fits at ${width} wide${framed ? ' in the real customer frame' : ''}: no sideways scroll, 44 pixel targets, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const long = 'A'.repeat(60);
    const crowded = sevenMeetings();
    crowded[0] = meeting(`Very long name ${long}`, {
      startsAt: '2026-11-13T04:00:00Z',
      timezone: 'America/Argentina/Buenos_Aires',
      location: `Hall ${long}${long}`,
    });
    crowded[1] = meeting(longLabel(1), {
      startsAt: '2026-11-14T04:00:00Z',
      endsAt: '2026-11-14T06:00:00Z',
      timezone: 'Asia/Dhaka',
      location: longPlace(1),
    });
    for (const expanded of [false, true]) {
      await openTrip(page, crowded);
      // Measure the rendered list, not the page while the report is still loading.
      await expect(items(page)).toHaveCount(5);
      if (expanded) {
        await page.getByRole('button', { name: /Show All 7/ }).click();
        await expect(items(page)).toHaveCount(7);
      }
      if (framed) await toCustomerFrame(page);
      const label = `Trip ${expanded ? 'expanded' : 'first five'} at ${width}${framed ? ' framed' : ''}`;
      const wide = await page.evaluate((limit) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('main *'))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > limit + 1)
            out.push(
              `${el.tagName.toLowerCase()}.${(el as HTMLElement).className} ${Math.round(r.right)}`,
            );
        }
        return out.slice(0, 6);
      }, width);
      expect(wide, label).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        label,
      ).toBeLessThanOrEqual(width);
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll('main :is(a[href], button, summary)'))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.height < 43.5)
          .map(
            ({ el }) => `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 30)}`,
          ),
      );
      expect(small, label).toEqual([]);
      expect((await new AxeBuilder({ page }).analyze()).violations, `axe ${label}`).toEqual([]);
      if (process.env.UX_SHOTS_DIR)
        await page.screenshot({
          path: `${process.env.UX_SHOTS_DIR}/room-trip-${expanded ? 'all' : 'five'}-${width}${framed ? '-framed' : ''}.png`,
          fullPage: true,
        });
    }
  });
}

test('works from the keyboard: lens, show all, show fewer and refresh, with a visible focus ring', async ({
  page,
}) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/customer-saved-missions'))
      posts.push(request.url());
  });
  await openTrip(page, sevenMeetings());
  // The report is fetched after the lens opens. Tab stops depend on what is in the page, so wait
  // until the list and its toggle are really there before the first key.
  const toggle = page.getByRole('button', { name: 'Show All 7 Meetings and Visits' });
  await expect(items(page)).toHaveCount(5);
  await expect(toggle).toBeVisible();
  await lens(page, 'Trip').focus();
  await expect(lens(page, 'Trip')).toBeFocused();
  // In the page order the Trip button is followed by the toggle, then the refresh button.
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  const ring = await toggle.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
  });
  expect(ring).toBe(true);
  await page.keyboard.press('Enter');
  await expect(items(page)).toHaveCount(7);
  const fewer = page.getByRole('button', { name: 'Show Fewer' });
  await expect(fewer).toBeFocused();
  await page.keyboard.press('Space');
  await expect(items(page)).toHaveCount(5);
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Tab');
  const refresh = page.getByRole('button', { name: 'Refresh Approved Commercial Report' });
  await expect(refresh).toBeFocused();
  expect(posts).toHaveLength(1);
  await page.keyboard.press('Enter');
  // The refresh reads the report again and the list comes back.
  await expect.poll(() => posts.length).toBe(2);
  await expect(items(page)).toHaveCount(5);
  await expect(toggle).toBeVisible();
});

test('starts no animation when the person asks for less movement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTrip(page, sevenMeetings());
  await page.getByRole('button', { name: /Show All 7/ }).click();
  await expect(items(page)).toHaveCount(7);
  const moving = await page.evaluate(
    () => document.getAnimations().filter((a) => a.effect?.getTiming().duration !== 0).length,
  );
  expect(moving).toBe(0);
  const slow = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('.room-trip-list, .room-trip-list *')).filter((el) => {
        const style = getComputedStyle(el);
        return style.animationName !== 'none' || parseFloat(style.transitionDuration) > 0.01;
      }).length,
  );
  expect(slow).toBe(0);
});

const budgetSets: [string, (n: number) => string, (n: number) => string][] = [
  [
    'short text',
    (n) => `Meeting with company number ${n}`,
    (n) => `Hall ${n}, Dhaka Chamber of Commerce`,
  ],
  ['long text', longLabel, longPlace],
];
for (const [setName, labelFor, placeFor] of budgetSets) {
  test(`scroll budget: five full meetings with ${setName} stay within the report limit in the real customer frame`, async ({
    page,
  }, info) => {
    const five = [0, 1, 2, 3, 4].map((day) =>
      meeting(labelFor(day), {
        startsAt: `2026-11-${10 + day}T04:00:00Z`,
        endsAt: `2026-11-${10 + day}T06:00:00Z`,
        timezone: 'Asia/Dhaka',
        location: placeFor(day),
      }),
    );
    const figures: Record<string, number> = {};
    for (const [width, height, limit] of [
      [390, 844, 4],
      [1440, 900, 2.5],
    ] as const) {
      await page.setViewportSize({ width, height });
      await openTrip(page, five);
      await expect(items(page)).toHaveCount(5);
      await toCustomerFrame(page);
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const screens = total / height;
      figures[`${width}`] = Math.round(screens * 100) / 100;
      expect(screens, `${setName}, ${width} wide: ${total} px of ${height} px`).toBeLessThanOrEqual(
        limit,
      );
    }
    info.annotations.push({ type: 'scroll-budget', description: JSON.stringify(figures) });
    console.log(
      `scroll budget (${setName}, five full meetings, Trip lens): ${JSON.stringify(figures)}`,
    );
  });
}

test('in the real customer frame the cards sit one token gap apart and the first fact reads at normal size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTrip(page, [
    dhakaVisit,
    meeting('Second', {
      startsAt: '2026-11-10T04:00:00Z',
      timezone: 'Asia/Dhaka',
      location: 'Dhaka',
    }),
  ]);
  // Wait for the rendered list before anything is measured (the report arrives after the lens opens).
  await expect(items(page)).toHaveCount(2);
  await toCustomerFrame(page);
  const first = items(page).nth(0);
  const second = items(page).nth(1);
  const list = page.locator('.room-trip-list');
  const place = first.locator('dd').last();
  const time = first.locator('time').first();
  await expect(time).toBeVisible();
  const top = (el: Element) => el.getBoundingClientRect().top;
  const bottom = (el: Element) => el.getBoundingClientRect().bottom;
  const gap = (await second.evaluate(top)) - (await first.evaluate(bottom));
  const rowGap = await list.evaluate((el) => parseFloat(getComputedStyle(el).rowGap));
  // Spacing is the grid gap (the space-3 token, 12 px) and nothing stacked on top of it.
  expect(rowGap).toBe(12);
  expect(gap).toBe(rowGap);
  expect(await second.evaluate((el) => getComputedStyle(el).marginTop)).toBe('0px');
  expect(await first.evaluate((el) => getComputedStyle(el).marginBottom)).toBe('0px');
  // A time is the main fact, so it is not the small grey type of a reply date.
  const type = (el: Element) => {
    const style = getComputedStyle(el);
    return { size: style.fontSize, colour: style.color };
  };
  expect(await time.evaluate(type)).toEqual(await place.evaluate(type));
});

test('marks Chinese names and places as Chinese for a screen reader and leaves other text unmarked', async ({
  page,
}) => {
  await openTrip(page, [
    meeting('绿野机械有限公司 meeting', {
      startsAt: '2026-11-09T04:00:00Z',
      timezone: 'Asia/Shanghai',
      location: '上海市浦东新区',
    }),
    meeting('Visit to Lantern Cutting Works', {
      startsAt: '2026-11-10T04:00:00Z',
      location: 'Gazipur factory',
    }),
  ]);
  const han = items(page).nth(0);
  await expect(han.locator('h4')).toHaveAttribute('lang', 'zh');
  await expect(han.locator('h4')).toHaveAttribute('dir', 'auto');
  await expect(han.locator('dd[lang="zh"]')).toHaveText('上海市浦东新区');
  const latin = items(page).nth(1);
  await expect(latin.locator('h4')).not.toHaveAttribute('lang', /.*/);
  await expect(latin.locator('dd[lang]').filter({ hasText: 'Gazipur factory' })).toHaveCount(0);
});
