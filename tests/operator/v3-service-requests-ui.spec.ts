import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. The restricted database authority has its own integration acceptance.
const issuer =
  'https://ep-service-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-0000000000a1';
const requestId = '00000000-0000-4000-8000-0000000000b2';
const programmeId = '00000000-0000-4000-8000-0000000000c3';
const digest = 'a'.repeat(64);
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {ServiceRequestList} from ${JSON.stringify(resolve('apps/web/app/account/service-requests/service-request-list.tsx'))};
import {ServiceRequestNew} from ${JSON.stringify(resolve('apps/web/app/account/service-requests/service-request-new.tsx'))};
import {ServiceRequestDetailView} from ${JSON.stringify(resolve('apps/web/app/account/service-requests/service-request-detail.tsx'))};
import {CustomerWorkspaces} from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
import {CustomerServiceRequests} from ${JSON.stringify(resolve('apps/web/app/operator/customer-service-requests.tsx'))};
const q=new URLSearchParams(location.search),subject='synthetic-alice',issuer=${JSON.stringify(issuer)},workspaceId=${JSON.stringify(workspaceId)};
const view=q.get('view');
const el=view==='new'?<ServiceRequestNew subject={subject} issuer={issuer} kind="programme" contextRef={${JSON.stringify(programmeId)}} workspaceId={q.get('anyworkspace')?null:workspaceId}/>
:view==='detail'?<ServiceRequestDetailView subject={subject} issuer={issuer} workspaceId={workspaceId} requestId={${JSON.stringify(requestId)}}/>
:view==='workspaces'?<CustomerWorkspaces subject={subject} issuer={issuer} serviceRequestsEnabled={q.get('help')!=='off'}/>
:view==='staff'?<CustomerServiceRequests tenant={${JSON.stringify('00000000-0000-4000-8000-0000000000d4')}}/>
:<ServiceRequestList subject={subject} issuer={issuer} workspaceId={workspaceId}/>;
createRoot(document.getElementById('fixture')).render(el);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    metafile: true,
  });
  // The browser bundle must carry no server authority code.
  expect(
    Object.keys(result.metafile!.inputs).some((path) => path.includes('packages/auth/src')),
  ).toBe(false);
  const javascript = result.outputFiles[0].text;
  const documentResponse = await fetch('http://127.0.0.1:3200/');
  expect(documentResponse.status).toBe(200);
  const document = await documentResponse.text();
  const fontClass = document.match(/<html[^>]*class="([\w -]+)"/)?.[1];
  expect(fontClass).toBeTruthy();
  const cssPaths = [
    ...new Set(
      [...document.matchAll(/href="(\/_next\/static\/[^"?]+\.css)(?:\?[^"\s]*)?"/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
  expect(cssPaths.length).toBeGreaterThan(0);
  const css = Buffer.concat(
    await Promise.all(
      cssPaths.map((path) =>
        readFile(resolve('apps/web/.next/static', path.slice('/_next/static/'.length))),
      ),
    ),
  );
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(css);
    } else if (/^\/_next\/static\/media\/[\w.-]+\.woff2$/.test(path)) {
      void readFile(resolve('apps/web/.next/static', path.slice('/_next/static/'.length)))
        .then((font) => {
          response.setHeader('Content-Type', 'font/woff2');
          response.end(font);
        })
        .catch(() => {
          response.statusCode = 404;
          response.end();
        });
    } else if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic paid-service fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic paid-service fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});

const service = {
  key: 'interpreter-day',
  version: 1,
  title: 'Interpreter day',
  summary: 'An interpreter works with you for one day of meetings in one city.',
  included: ['One interpreter for up to eight hours', 'A short briefing call before the day'],
  excluded: ['Written translation', 'Interpreter travel outside the city'],
  regions: ['Dhaka', 'Guangzhou'],
  quoteBasis: 'per_day',
  synthetic: true,
};
const second = {
  ...service,
  key: 'site-visit-coordination',
  title: 'Site visit coordination',
  quoteBasis: 'per_visit',
  regions: ['Dhaka'],
};
const catalogue = () => ({
  services: [service, second],
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
const summary = (over: Record<string, unknown> = {}) => ({
  id: requestId,
  workspaceId,
  contextKind: 'programme',
  contextRef: programmeId,
  contextLabel: 'Synthetic Dhaka buyer delegation',
  serviceKey: 'interpreter-day',
  serviceTitle: 'Interpreter day',
  status: 'quoted',
  needVersion: 1,
  region: 'Dhaka',
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T10:00:00.000Z',
  serviceVersion: 1,
  ...over,
});
const quote = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  version: 1,
  currency: 'USD',
  scope: 'Synthetic scope: one interpreter for one day of two meetings in Dhaka',
  components: [
    {
      position: 1,
      kind: 'service_fee',
      label: 'Synthetic interpreter day fee',
      treatment: 'included',
      amountMinor: '45000',
    },
    {
      position: 2,
      kind: 'local_cost',
      label: 'Synthetic local transport estimate',
      treatment: 'estimate',
      amountMinor: '6000',
    },
    {
      position: 3,
      kind: 'pass_through',
      label: 'Synthetic meeting room at cost',
      treatment: 'included',
      amountMinor: '12000',
    },
    {
      position: 4,
      kind: 'tax',
      label: 'Synthetic local sales tax',
      treatment: 'not_included',
      amountMinor: null,
    },
  ],
  fixedTotalMinor: '57000',
  estimatedTotalMinor: '6000',
  exclusions: [
    'Synthetic exclusion: interpreter travel outside Dhaka',
    'Synthetic exclusion: written translation',
  ],
  assumptions: ['Synthetic assumption: both meetings are in the same building'],
  deliveryTerms: 'Synthetic delivery terms: on the agreed day, eight hours',
  paymentTerms: 'Synthetic payment terms are settled later; nothing is charged now',
  validUntil: '2026-12-31T23:59:59.000000Z',
  preparedAt: '2026-10-19T10:00:00.000000Z',
  expired: false,
  digest,
  synthetic: true,
  billing: 'billing_not_enabled',
  paymentTaken: false,
  ...over,
});
const timeline = [
  {
    seq: 1,
    at: '2026-10-19T09:00:00.000Z',
    kind: 'requested',
    status: 'requested',
    by: 'You',
    note: null,
    quoteVersion: null,
  },
  {
    seq: 2,
    at: '2026-10-19T10:00:00.000Z',
    kind: 'quoted',
    status: 'quoted',
    by: 'Corridra team',
    note: null,
    quoteVersion: 1,
  },
];
const detail = (over: Record<string, unknown> = {}) => ({
  workspaceId,
  canAct: true,
  request: summary(),
  service: {
    title: service.title,
    summary: service.summary,
    included: service.included,
    excluded: service.excluded,
    regions: service.regions,
    quoteBasis: 'per_day',
  },
  need: {
    version: 1,
    text: 'Synthetic need: an interpreter for two supplier meetings',
    preferredFrom: '2026-12-01',
    preferredTo: '2026-12-03',
    region: 'Dhaka',
    updatedAt: '2026-10-19T09:00:00.000Z',
  },
  quote: quote(),
  orderIntent: null,
  timeline,
  actions: ['accept', 'decline', 'question'],
  synthetic: true,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  ...over,
});
type Reply = { status?: number; json?: unknown };
async function serve(
  page: Page,
  handler: (url: URL, method: string, body: Record<string, unknown> | null) => Reply,
) {
  await page.route('**/api/customer-service-requests**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    const reply = handler(
      url,
      request.method(),
      request.method() === 'POST' ? request.postDataJSON() : null,
    );
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
  });
}
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);

test('the list shows each request in plain words, the services on offer, and a calm empty state', async ({
  page,
}) => {
  await serve(page, (url) =>
    url.searchParams.get('scope') === 'catalogue'
      ? { json: catalogue() }
      : {
          json: {
            workspaceId,
            canRequest: true,
            requests: [
              summary(),
              summary({
                id: randomUUID(),
                serviceTitle: 'Site visit coordination',
                status: 'in_progress',
                contextKind: 'company',
                contextLabel: 'Synthetic Dhaka Garments Limited',
              }),
            ],
            nextAfter: null,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        },
  );
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Your help requests' })).toBeVisible();
  await expect(page.getByText('Quote ready for you')).toBeVisible();
  await expect(page.getByText('In progress')).toBeVisible();
  await expect(
    page.getByText('Delegation programme: Synthetic Dhaka buyer delegation'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Interpreter day' })).toHaveAttribute(
    'href',
    '/account/service-requests/' + workspaceId + '/' + requestId,
  );
  await page.getByText('What we can help with').click();
  await expect(page.getByText('Priced per day')).toBeVisible();
  // Help is started from the place it is about, so the list says where to go.
  const start = page.getByRole('region', { name: 'Ask for help' });
  await expect(start.getByRole('link', { name: 'A programme in this workspace' })).toHaveAttribute(
    'href',
    '/account/delegations/' + workspaceId,
  );
  await expect(start.getByRole('link', { name: 'An approved company' })).toHaveAttribute(
    'href',
    '/account/companies',
  );
  await expect(start.getByRole('link', { name: 'A private request' })).toHaveAttribute(
    'href',
    '/account?view=work#customer-requests',
  );
  expect(await axe(page)).toEqual([]);
  await page.unroute('**/api/customer-service-requests**');
  await serve(page, (url) =>
    url.searchParams.get('scope') === 'catalogue'
      ? { json: catalogue() }
      : {
          json: {
            workspaceId,
            canRequest: false,
            requests: [],
            nextAfter: null,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        },
  );
  await page.goto(origin + '/');
  await expect(page.getByText('Only an owner or admin can ask for help.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ask for help' })).toHaveCount(0);
  await page.unroute('**/api/customer-service-requests**');
  await serve(page, (url) =>
    url.searchParams.get('scope') === 'catalogue'
      ? { json: catalogue() }
      : {
          json: {
            workspaceId,
            canRequest: true,
            requests: [],
            nextAfter: null,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        },
  );
  await page.goto(origin + '/');
  await expect(page.getByText('Choose where you need help below.')).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Ask for help' })
      .getByRole('link', { name: 'A programme in this workspace' }),
  ).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('denied, unavailable and broken answers each show a plain message and never a request', async ({
  page,
}) => {
  for (const [status, text] of [
    [403, 'You no longer have access here'],
    [503, 'not switched on'],
    [500, 'Could not load your help requests'],
  ] as const) {
    await page.unroute('**/api/customer-service-requests**').catch(() => undefined);
    await serve(page, () => ({ status, json: { error: 'x' } }));
    await page.goto(origin + '/');
    await expect(page.getByRole('alert')).toContainText(text);
    await expect(page.getByRole('link', { name: 'Interpreter day' })).toHaveCount(0);
  }
  await page.unroute('**/api/customer-service-requests**');
  await serve(page, () => ({ json: { nonsense: true } }));
  await page.goto(origin + '/');
  await expect(page.getByRole('alert')).toContainText('Could not load');
});

test('a new request sends one exact message from the place the customer was working in', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  await serve(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      return { json: summary({ status: 'requested' }) };
    }
    return { json: catalogue() };
  });
  await page.goto(origin + '/?view=new');
  await expect(page.getByText(/linked to your delegation programme/)).toBeVisible();
  const send = page.getByRole('button', { name: 'Send help request' });
  await expect(send).toBeDisabled();
  await page.getByRole('radio', { name: /Interpreter day/ }).check();
  await expect(page.getByLabel('Where do you need it?').locator('option')).toHaveText([
    'Choose a place',
    'Dhaka',
    'Guangzhou',
  ]);
  await page.getByLabel('Where do you need it?').selectOption('Dhaka');
  await expect(page.getByLabel(/What do you need/)).toHaveValue('Synthetic ');
  await expect(send).toBeDisabled();
  await page
    .getByLabel(/What do you need/)
    .fill('Synthetic need: an interpreter for two supplier meetings');
  await page.getByLabel('Earliest date (optional)').fill('2026-12-01');
  await expect(send).toBeEnabled();
  expect(await axe(page)).toEqual([]);
  await send.click();
  await expect(page.getByRole('status')).toContainText('Nothing is charged');
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'commandId',
    'contextKind',
    'contextRef',
    'need',
    'preferredFrom',
    'preferredTo',
    'region',
    'serviceKey',
    'workspaceId',
  ]);
  expect(posts[0]).toMatchObject({
    action: 'create',
    workspaceId,
    contextKind: 'programme',
    contextRef: programmeId,
    serviceKey: 'interpreter-day',
    region: 'Dhaka',
    preferredFrom: '2026-12-01',
    preferredTo: null,
  });
  await expect(page.getByRole('link', { name: 'View your request' })).toHaveAttribute(
    'href',
    '/account/service-requests/' + workspaceId + '/' + requestId,
  );
});

test('a send that could not be confirmed is retried with the same command id, and a refusal is explained', async ({
  page,
}) => {
  const ids: string[] = [];
  let status = 500;
  await serve(page, (url, method, body) => {
    if (method !== 'POST') return { json: catalogue() };
    ids.push(String(body!.commandId));
    return status === 200
      ? { json: summary({ status: 'requested' }) }
      : { status, json: { error: 'x' } };
  });
  await page.goto(origin + '/?view=new');
  await page.getByRole('radio', { name: /Site visit coordination/ }).check();
  await page.getByLabel('Where do you need it?').selectOption('Dhaka');
  await page.getByLabel(/What do you need/).fill('Synthetic need: visit one workshop near Dhaka');
  await page.getByRole('button', { name: 'Send help request' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be sent twice');
  await page.getByRole('button', { name: 'Send the same request again' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be sent twice');
  status = 200;
  await page.getByRole('button', { name: 'Send the same request again' }).click();
  await expect(page.getByRole('status')).toContainText('was sent');
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(1);
  // A refusal clears the pending command so an edited request is a new one.
  await page.goto(origin + '/?view=new');
  await page.getByRole('radio', { name: /Site visit coordination/ }).check();
  await page.getByLabel('Where do you need it?').selectOption('Dhaka');
  await page.getByLabel(/What do you need/).fill('Synthetic need: visit one workshop near Dhaka');
  status = 409;
  await page.getByRole('button', { name: 'Send help request' }).click();
  await expect(page.getByRole('alert')).toContainText('already exists here');
  await expect(page.getByRole('button', { name: 'Send help request' })).toBeVisible();
});

test('without a workspace in the link the customer picks one they can act in, and an unavailable module says so', async ({
  page,
}) => {
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({
      json: {
        synthetic: true,
        workspaces: [
          { id: workspaceId, name: 'Synthetic owner workspace', role: 'owner' },
          { id: randomUUID(), name: 'Synthetic joined workspace', role: 'member' },
        ],
      },
    }),
  );
  await serve(page, () => ({ json: catalogue() }));
  await page.goto(origin + '/?view=new&anyworkspace=1');
  await page.getByRole('radio', { name: /Interpreter day/ }).check();
  // Only the workspace where the customer is owner or admin is offered, and it is chosen for them.
  await expect(page.getByLabel('Workspace')).toHaveCount(0);
  await page.unroute('**/api/customer-workspaces');
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({
      json: {
        synthetic: true,
        workspaces: [{ id: workspaceId, name: 'Synthetic joined workspace', role: 'member' }],
      },
    }),
  );
  await page.goto(origin + '/?view=new&anyworkspace=1');
  await expect(
    page.getByText('Only an owner or admin of a workspace can ask for paid help.'),
  ).toBeVisible();
  await page.unroute('**/api/customer-service-requests**');
  await serve(page, () => ({ status: 503, json: { error: 'x' } }));
  await page.goto(origin + '/?view=new');
  await expect(page.getByRole('alert')).toContainText('not switched on');
});

test('the quote shows every cost, everything left out and every assumption before acceptance, and acceptance records an order intent only', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  let accepted = false;
  await serve(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      accepted = true;
      return { json: summary({ status: 'accepted' }) };
    }
    return {
      json: accepted
        ? detail({
            request: summary({ status: 'accepted' }),
            actions: ['question'],
            orderIntent: {
              id: randomUUID(),
              quoteVersion: 1,
              currency: 'USD',
              fixedTotalMinor: '57000',
              estimatedTotalMinor: '6000',
              acceptedAt: '2026-10-19T11:00:00.000Z',
              orderStatus: 'accepted_by_customer',
              paymentTaken: false,
              billing: 'billing_not_enabled',
              statement: 'Accepted by customer. No payment taken. Billing not enabled.',
            },
            timeline: [
              ...timeline,
              {
                seq: 3,
                at: '2026-10-19T11:00:00.000Z',
                kind: 'accepted',
                status: 'accepted',
                by: 'You',
                note: null,
                quoteVersion: 1,
              },
            ],
          })
        : detail(),
    };
  });
  await page.goto(origin + '/?view=detail');
  const table = page.getByRole('table', { name: /Every cost in this quote, in USD/ });
  await expect(table).toBeVisible();
  for (const row of [
    'Synthetic interpreter day fee',
    'Synthetic local transport estimate',
    'Synthetic meeting room at cost',
    'Synthetic local sales tax',
  ])
    await expect(table.getByRole('rowheader', { name: row })).toBeVisible();
  await expect(table.getByRole('row', { name: /Synthetic local sales tax/ })).toContainText(
    'Not included',
  );
  await expect(
    table.getByRole('row', { name: /Fixed price for the included items/ }),
  ).toContainText('USD');
  await expect(
    page.getByText('Synthetic exclusion: interpreter travel outside Dhaka'),
  ).toBeVisible();
  await expect(page.getByText('Synthetic exclusion: written translation')).toBeVisible();
  await expect(
    page.getByText('Synthetic assumption: both meetings are in the same building'),
  ).toBeVisible();
  await expect(page.getByText(/This is a quote, not an order/)).toBeVisible();
  await expect(page.getByText(/Payment: Synthetic payment terms/)).toBeVisible();
  // Nothing is sent until the acknowledgement is ticked and the confirmation clicked.
  await page.getByRole('button', { name: 'Accept this quote' }).click();
  expect(posts).toHaveLength(0);
  const confirm = page.getByRole('button', { name: 'Confirm and accept' });
  await expect(confirm).toBeDisabled();
  expect(await axe(page)).toEqual([]);
  await page.getByLabel(/I have read every cost/).check();
  await confirm.click();
  await expect(page.getByRole('region', { name: 'Order intent' })).toContainText(
    'Accepted by customer. No payment taken. Billing not enabled.',
  );
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'acknowledged',
    'action',
    'commandId',
    'quoteDigest',
    'quoteVersion',
    'requestId',
    'workspaceId',
  ]);
  expect(posts[0]).toMatchObject({
    action: 'accept',
    workspaceId,
    requestId,
    quoteVersion: 1,
    quoteDigest: digest,
    acknowledged: true,
  });
  await expect(page.getByRole('button', { name: 'Accept this quote' })).toHaveCount(0);
  await expect(page.getByText('You accepted').first()).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Timeline' })).toContainText(
    'Quote accepted. No payment taken.',
  );
});

test('a member can read the request and the quote but is offered no action', async ({ page }) => {
  await serve(page, () => ({ json: detail({ canAct: false, actions: [] }) }));
  await page.goto(origin + '/?view=detail');
  await expect(page.getByRole('table', { name: /Every cost/ })).toBeVisible();
  await expect(
    page.getByText('Only an owner or admin of the workspace can act on it.'),
  ).toBeVisible();
  for (const name of [
    'Accept this quote',
    'Decline this quote',
    'Ask a question',
    'Withdraw this request',
    'Edit this request',
  ])
    await expect(page.getByRole('button', { name })).toHaveCount(0);
});

test('declining, asking a question and withdrawing each send one exact message after a deliberate step', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  let state = detail();
  await serve(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      return { json: summary() };
    }
    return { json: state };
  });
  await page.goto(origin + '/?view=detail');
  await page.getByRole('button', { name: 'Ask a question' }).click();
  const send = page.getByRole('button', { name: 'Send question' });
  await expect(send).toBeDisabled();
  await page
    .getByLabel(/Your question/)
    .fill('Synthetic question: is lunch for the interpreter included?');
  await send.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts[0]).toMatchObject({
    action: 'question',
    note: 'Synthetic question: is lunch for the interpreter included?',
  });
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'commandId',
    'note',
    'requestId',
    'workspaceId',
  ]);
  await page.getByRole('button', { name: 'Decline this quote' }).click();
  expect(posts).toHaveLength(1);
  await page.getByRole('button', { name: 'Confirm and decline' }).click();
  expect(posts).toHaveLength(2);
  expect(posts[1]).toMatchObject({ action: 'decline', note: null });
  state = detail({
    request: summary({ status: 'requested' }),
    quote: null,
    actions: ['revise', 'question', 'withdraw'],
  });
  await page.reload();
  await page.getByRole('button', { name: 'Withdraw this request' }).click();
  await page.getByLabel(/Why\?/).fill('Synthetic note: plans changed for this trip');
  await page.getByRole('button', { name: 'Confirm and withdraw' }).click();
  expect(posts[2]).toMatchObject({
    action: 'withdraw',
    note: 'Synthetic note: plans changed for this trip',
  });
});

test('the need can be edited before a quote, with the version the customer saw', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  await serve(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      return { json: summary({ status: 'requested' }) };
    }
    return {
      json: detail({
        request: summary({ status: 'requested' }),
        quote: null,
        actions: ['revise', 'question', 'withdraw'],
        timeline: [timeline[0]],
      }),
    };
  });
  await page.goto(origin + '/?view=detail');
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit this request' }).click();
  await page
    .getByLabel(/What do you need/)
    .fill('Synthetic need: an interpreter for three supplier meetings');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'commandId',
    'expectedNeedVersion',
    'need',
    'preferredFrom',
    'preferredTo',
    'region',
    'requestId',
    'workspaceId',
  ]);
  expect(posts[0]).toMatchObject({
    action: 'revise',
    expectedNeedVersion: 1,
    region: 'Dhaka',
    preferredFrom: '2026-12-01',
    preferredTo: '2026-12-03',
  });
});

test('a changed request turns the buttons off and asks for a reload, keeping what was typed', async ({
  page,
}) => {
  let reply = 409;
  await serve(page, (url, method) =>
    method === 'POST' ? { status: reply, json: { error: 'x' } } : { json: detail() },
  );
  await page.goto(origin + '/?view=detail');
  await page.getByRole('button', { name: 'Ask a question' }).click();
  await page.getByLabel(/Your question/).fill('Synthetic question that should survive');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'something has changed' })).toBeVisible();
  await expect(page.getByText('This page may be out of date')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask a question' })).toHaveCount(0);
  await expect(page.getByLabel(/Your question/)).toHaveValue(
    'Synthetic question that should survive',
  );
  await page.getByRole('button', { name: 'Reload this request' }).first().click();
  await expect(page.getByRole('button', { name: 'Ask a question' })).toBeVisible();
  reply = 500;
  await page.getByLabel(/Your question/).fill('Synthetic question to retry');
  const ids: string[] = [];
  await page.unroute('**/api/customer-service-requests**');
  await serve(page, (url, method, body) => {
    if (method === 'POST') {
      ids.push(String(body!.commandId));
      return ids.length < 3 ? { status: 500, json: { error: 'x' } } : { json: summary() };
    }
    return { json: detail() };
  });
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be done twice');
  await page.getByRole('button', { name: 'Send question' }).click();
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(new Set(ids).size).toBe(1);
});

test('an expired quote is shown as expired and offers no acceptance; a denied answer shows no request', async ({
  page,
}) => {
  await serve(page, () => ({
    json: detail({
      request: summary({ status: 'expired' }),
      quote: quote({ expired: true }),
      actions: ['decline', 'question'],
    }),
  }));
  await page.goto(origin + '/?view=detail');
  await expect(page.getByText('Quote expired').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Quote, version 1 \(expired\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept this quote' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Decline this quote' })).toBeVisible();
  await page.unroute('**/api/customer-service-requests**');
  await serve(page, () => ({ status: 403, json: { error: 'x' } }));
  await page.goto(origin + '/?view=detail');
  await expect(page.getByRole('alert')).toContainText('You no longer have access here');
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.unroute('**/api/customer-service-requests**');
  await serve(page, () => ({ json: detail({ request: summary({ id: randomUUID() }) }) }));
  await page.goto(origin + '/?view=detail');
  await expect(page.getByRole('alert')).toContainText('did not match');
});

test('the help link appears beside a workspace only when the module is on', async ({ page }) => {
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({
      json: {
        synthetic: true,
        workspaces: [
          {
            id: workspaceId,
            name: 'Synthetic owner workspace',
            role: 'owner',
            synthetic: true,
            organisationId: null,
          },
        ],
      },
    }),
  );
  await page.goto(origin + '/?view=workspaces');
  await expect(page.getByRole('link', { name: 'Paid-service requests' })).toHaveAttribute(
    'href',
    '/account/service-requests/' + workspaceId,
  );
  await page.goto(origin + '/?view=workspaces&help=off');
  await expect(page.getByText('Synthetic owner workspace')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Paid-service requests' })).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440])
  test('keyboard use, no sideways scrolling and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await serve(page, (url) =>
      url.searchParams.get('scope') === 'catalogue' ? { json: catalogue() } : { json: detail() },
    );
    await page.goto(origin + '/?view=detail');
    await expect(page.getByRole('table', { name: /Every cost/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Accept this quote' }).focus();
    await page.keyboard.press('Enter');
    await page.getByLabel(/I have read every cost/).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Confirm and accept' })).toBeEnabled();
    expect(await axe(page)).toEqual([]);
    await page.unroute('**/api/customer-service-requests**');
    await serve(page, (url) =>
      url.searchParams.get('scope') === 'catalogue'
        ? { json: catalogue() }
        : {
            json: {
              workspaceId,
              canRequest: true,
              requests: [summary()],
              nextAfter: null,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            },
          },
    );
    await page.goto(origin + '/');
    await expect(page.getByRole('link', { name: 'Interpreter day' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await axe(page)).toEqual([]);
    await page.goto(origin + '/?view=new');
    await expect(page.getByRole('radio', { name: /Interpreter day/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await axe(page)).toEqual([]);
  });

// Staff side.
const staffTenant = '00000000-0000-4000-8000-0000000000d4';
const staffDetail = (over: Record<string, unknown> = {}) => ({
  request: {
    ...summary({ status: 'requested' }),
    workspaceName: 'Synthetic paid-service workspace',
    claimedByThisTeam: false,
  },
  service: { title: 'Interpreter day' },
  need: {
    text: 'Synthetic need: an interpreter for two supplier meetings',
    preferredFrom: '2026-12-01',
    preferredTo: null,
    region: 'Dhaka',
  },
  quotes: [],
  orderIntent: null,
  events: [
    {
      seq: 1,
      at: '2026-10-19T09:00:00.000Z',
      kind: 'requested',
      status: 'requested',
      actorKind: 'customer',
      customerNote: null,
      internalNote: null,
      quoteVersion: null,
    },
  ],
  lastSeq: 1,
  ...over,
});
async function serveStaff(
  page: Page,
  handler: (url: URL, method: string, body: Record<string, unknown> | null) => Reply,
) {
  await page.route('**/api/workspace/customer-service-requests**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(url.searchParams.get('tenant')).toBe(staffTenant);
    const reply = handler(
      url,
      request.method(),
      request.method() === 'POST' ? request.postDataJSON() : null,
    );
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
  });
}
const staffEntry = {
  key: 'interpreter-day',
  version: 1,
  title: 'Interpreter day',
  summary: service.summary,
  included: service.included,
  excluded: service.excluded,
  regions: service.regions,
  quoteBasis: 'per_day',
  active: true,
};

test('staff open a request, prepare a quote with every part, and the form sends one exact message', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  await serveStaff(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      return { json: summary({ status: 'quoted' }) };
    }
    const scope = url.searchParams.get('scope');
    if (scope === 'catalogue') return { json: { services: [staffEntry] } };
    if (scope === 'detail') return { json: staffDetail() };
    return {
      json: {
        requests: [
          {
            ...summary({ status: 'requested' }),
            workspaceName: 'Synthetic paid-service workspace',
            claimed: false,
          },
        ],
      },
    };
  });
  await page.goto(origin + '/?view=staff');
  await page
    .getByRole('button', { name: 'Open Interpreter day for Synthetic paid-service workspace' })
    .click();
  await expect(
    page.getByRole('heading', { name: /Interpreter day for Synthetic paid-service workspace/ }),
  ).toBeVisible();
  const form = page.getByRole('form', { name: 'Prepare a quote' });
  await form
    .getByLabel('Label (start with Synthetic)')
    .first()
    .fill('Synthetic interpreter day fee');
  await form
    .getByLabel(/Amount in minor units/)
    .first()
    .fill('45000');
  await form.getByLabel('Label (start with Synthetic)').nth(1).fill('Synthetic local sales tax');
  await form.getByLabel(/Scope/).fill('Synthetic scope: one interpreter for one day');
  await form.getByLabel(/Left out/).fill('Synthetic exclusion: interpreter travel outside Dhaka');
  await form
    .getByLabel(/Assumptions/)
    .fill('Synthetic assumption: both meetings are in one building');
  await form.getByLabel(/Delivery terms/).fill('Synthetic delivery terms: one agreed day');
  await form.getByLabel(/Payment terms/).fill('Synthetic payment terms are settled later');
  const send = form.getByRole('button', { name: 'Send the quote to the customer' });
  await expect(send).toBeDisabled();
  await form.getByLabel(/Valid until/).fill('2026-12-31');
  expect(await axe(page)).toEqual([]);
  await send.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'assumptions',
    'commandId',
    'components',
    'currency',
    'deliveryTerms',
    'exclusions',
    'expectedSeq',
    'paymentTerms',
    'requestId',
    'scope',
    'validUntil',
  ]);
  expect(posts[0]).toMatchObject({
    action: 'quote',
    requestId,
    expectedSeq: 1,
    currency: 'USD',
    validUntil: '2026-12-31T23:59:59.000Z',
    components: [
      {
        kind: 'service_fee',
        label: 'Synthetic interpreter day fee',
        treatment: 'included',
        amountMinor: '45000',
      },
      {
        kind: 'tax',
        label: 'Synthetic local sales tax',
        treatment: 'not_included',
        amountMinor: null,
      },
    ],
    exclusions: ['Synthetic exclusion: interpreter travel outside Dhaka'],
  });
});

test('staff progress notes and internal notes are separate messages, and the catalogue is edited with its version', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  // Every saved command moves the request on, so the next action must use the refreshed sequence.
  let seq = 3;
  await serveStaff(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      if (body!.action === 'start' || body!.action === 'note') seq += 1;
      return { json: summary() };
    }
    const scope = url.searchParams.get('scope');
    if (scope === 'catalogue') return { json: { services: [staffEntry] } };
    if (scope === 'detail')
      return {
        json: staffDetail({
          request: {
            ...summary({ status: 'accepted' }),
            workspaceName: 'Synthetic paid-service workspace',
            claimedByThisTeam: true,
          },
          lastSeq: seq,
          events: [
            {
              seq: 1,
              at: '2026-10-19T09:00:00.000Z',
              kind: 'requested',
              status: 'requested',
              actorKind: 'customer',
              customerNote: null,
              internalNote: null,
              quoteVersion: null,
            },
            {
              seq: 3,
              at: '2026-10-19T09:30:00.000Z',
              kind: 'internal_note',
              status: 'accepted',
              actorKind: 'staff',
              customerNote: null,
              internalNote: 'Synthetic internal margin note',
              quoteVersion: null,
            },
          ],
        }),
      };
    return {
      json: {
        requests: [
          {
            ...summary({ status: 'accepted' }),
            workspaceName: 'Synthetic paid-service workspace',
            claimed: true,
          },
        ],
      },
    };
  });
  await page.goto(origin + '/?view=staff');
  await page.getByRole('button', { name: /Open Interpreter day/ }).click();
  await expect(page.getByText(/internal only: Synthetic internal margin note/)).toBeVisible();
  await expect(page.getByRole('form', { name: 'Prepare a quote' })).toHaveCount(0);
  const tell = page.getByRole('form', { name: 'Tell the customer' });
  await tell.getByLabel('What happened').selectOption('start');
  await tell
    .getByLabel(/Note the customer will read/)
    .fill('Synthetic update: the coordinator is briefed and the day is booked');
  await tell.getByRole('button', { name: 'Send to the customer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts[0]).toMatchObject({
    action: 'start',
    requestId,
    expectedSeq: 3,
    customerNote: 'Synthetic update: the coordinator is briefed and the day is booked',
  });
  const note = page.getByRole('form', { name: 'Internal note' });
  await note
    .getByLabel(/Note \(start with Synthetic\)/)
    .fill('Synthetic internal note: supplier gave a discount');
  await note.getByRole('button', { name: 'Save internal note' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts[1]).toMatchObject({
    action: 'note',
    expectedSeq: 4,
    internalNote: 'Synthetic internal note: supplier gave a discount',
  });
  expect(Object.keys(posts[1]!).sort()).toEqual([
    'action',
    'commandId',
    'expectedSeq',
    'internalNote',
    'requestId',
  ]);
  // Catalogue: a change names the version staff saw and has no customer-only wording.
  await page.getByRole('button', { name: 'Edit Interpreter day' }).click();
  await page.getByLabel('Plain title').fill('Interpreter day with briefing');
  await page.getByRole('button', { name: 'Save service' }).click();
  await expect(
    page.getByRole('region', { name: 'Paid-service catalogue' }).getByText('Saved.'),
  ).toBeVisible();
  expect(posts[2]).toMatchObject({
    action: 'catalogue',
    serviceKey: 'interpreter-day',
    expectedVersion: 1,
    title: 'Interpreter day with briefing',
    active: true,
    regions: ['Dhaka', 'Guangzhou'],
  });
});

test('the staff panel explains a missing right or an off module and shows no customer data', async ({
  page,
}) => {
  for (const [status, text] of [
    [403, 'Owner or admin access'],
    [503, 'unavailable'],
  ] as const) {
    await page.unroute('**/api/workspace/customer-service-requests**').catch(() => undefined);
    await serveStaff(page, () => ({ status, json: { error: 'x' } }));
    await page.goto(origin + '/?view=staff');
    await expect(page.getByRole('alert').first()).toContainText(text);
    await expect(page.getByText('Synthetic paid-service workspace')).toHaveCount(0);
  }
});
