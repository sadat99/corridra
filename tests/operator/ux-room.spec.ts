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
const reportBody = () => ({
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
        itinerary: [],
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
  service?: boolean;
  offered?: string;
};
const props = (o: Options) => ({
  requestId,
  subject,
  issuer,
  link: o.link ?? { reportAvailable: true, savedResourceId: resourceId },
  serviceRequestsEnabled: o.service ?? true,
  decisionsEnabled: false,
  lenses: o.lenses ?? true,
});

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{WorkspaceShell}from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
      import{RoomView}from ${JSON.stringify(resolve('apps/web/app/account/rooms/[requestId]/room-view.tsx'))};
      const q=new URLSearchParams(location.search);
      const props=JSON.parse(q.get('props'));
      const offered=(q.get('offered')||'en').split(',').map(code=>({code,draft:code!=='en'}));
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={offered}>
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

async function open(
  page: Page,
  options: Options = {},
  answer: { status?: number; body?: unknown } = {},
) {
  await page.route('**/api/customer-requests/**', (route) =>
    route.fulfill({
      status: answer.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(answer.body ?? detail()),
    }),
  );
  await page.route('**/api/customer-saved-missions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reportBody()),
    }),
  );
  await page.goto(
    `${origin}/?props=${encodeURIComponent(JSON.stringify(props(options)))}&offered=${options.offered ?? 'en'}`,
  );
}
const lens = (page: Page, name: string) =>
  page.locator('.room-lenses').getByRole('button', { name });

test('shows who and what the request is, where it stands and what the team said', async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole('heading', { name: 'Automatic fabric cutting machine' }),
  ).toBeVisible();
  await expect(page.getByText('China · Received')).toBeVisible();
  await expect(page.locator('.room-emblem')).toHaveText('AF');
  // MEETINGS is Visit. A delivered report lights Compare; no decision is ever claimed.
  const road = page.locator('.mr-road');
  await expect(road.locator('[aria-current="step"]')).toContainText('Visit');
  await expect(road.getByText('Not tracked yet')).toHaveCount(1);
  await expect(page.getByText('Meetings are being arranged for November.')).toBeVisible();
  await expect(page.getByText('We have shortlisted three suppliers.')).toHaveCount(0);
  await page.getByRole('button', { name: /Read every reply/ }).click();
  await expect(page.getByText('We have shortlisted three suppliers.')).toBeVisible();
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
  await expect(page.locator('.mr-road').getByText('Not tracked yet')).toHaveCount(2);
});

test('the Compare lens puts the verdict first, in cards, with the table one tap away', async ({
  page,
}) => {
  await open(page);
  await lens(page, 'Compare').click();
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
  await lens(page, 'Compare').click();
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
  await expect(page.locator('.mr-quote').first()).toBeVisible();
  // The report itself is English, so its region says so.
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
      ['Compare', 'Cards'],
      ['Compare', 'Table'],
      ['Evidence', null],
    ] as const) {
      await lens(page, name).click();
      if (view) await page.getByRole('button', { name: view }).click();
      await page.waitForTimeout(150);
      const wide = await page.evaluate((limit) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('main *'))) {
          const r = el.getBoundingClientRect();
          // The comparison table scrolls inside its own region by design; nothing else may be wider than the screen.
          if (r.width > 0 && r.right > limit + 1 && !el.closest('.ux-comparison-scroll'))
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
