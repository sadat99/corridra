import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. The restricted database authority has its own integration acceptance.
const issuer =
  'https://ep-billing-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-0000000000a1';
const subscriptionId = '00000000-0000-4000-8000-0000000000b2';
const tenant = '00000000-0000-4000-8000-0000000000d4';
const digest = 'a'.repeat(64);
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {BillingOverviewView} from ${JSON.stringify(resolve('apps/web/app/account/billing/billing-overview.tsx'))};
import {CustomerWorkspaces} from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
import {CustomerBilling} from ${JSON.stringify(resolve('apps/web/app/operator/customer-billing.tsx'))};
const q=new URLSearchParams(location.search),subject='synthetic-alice',issuer=${JSON.stringify(issuer)},workspaceId=${JSON.stringify(workspaceId)};
const view=q.get('view');
const el=view==='workspaces'?<CustomerWorkspaces subject={subject} issuer={issuer} billingEnabled={q.get('plans')!=='off'}/>
:view==='staff'?<CustomerBilling tenant={${JSON.stringify(tenant)}}/>
:<BillingOverviewView subject={subject} issuer={issuer} workspaceId={workspaceId}/>;
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
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sample plan fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Sample plan fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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

const entitlements = [
  ['workspace_members', 'People in the workspace', 'count', 'limit', 10],
  ['active_programmes', 'Active delegation programmes', 'count', 'limit', 6],
  ['programme_participants', 'Participants in each programme', 'count', 'unlimited', null],
  ['open_service_requests', 'Open help requests', 'count', 'unlimited', null],
  ['report_exports', 'Programme report exports', 'flag', 'included', null],
].map(([key, label, unit, mode, limit]) => ({
  key,
  label,
  description: 'Plain description of ' + String(label).toLowerCase() + '.',
  unit,
  mode,
  limit,
}));
const plan = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  key: 'example-organiser',
  version: 1,
  title: 'Organiser monthly (sample plan)',
  summary: 'An example monthly plan for a delegation organiser. The price is invented.',
  interval: 'month',
  priceMinor: '4900',
  currency: 'USD',
  taxTreatment: 'price_excludes_tax',
  included: ['A shared workspace for a larger team', 'Report exports for each programme'],
  excluded: ['The cost of any help request', 'Payment collection from participants'],
  entitlements,
  digest,
  active: true,
  synthetic: true,
  invoicing: 'not_enabled',
  paymentTaken: false,
  ...over,
});
const starter = plan({
  key: 'example-starter',
  title: 'Starter workspace (sample plan)',
  priceMinor: '0',
  taxTreatment: 'tax_to_be_confirmed',
  digest: 'b'.repeat(64),
});
const expiresAt = () => new Date(Date.now() + 60000).toISOString();
const plansBody = (over: Record<string, unknown> = {}) => ({
  workspaceId,
  canRequest: true,
  plans: [plan(), starter],
  entitlementsEnforced: false,
  invoicing: 'not_enabled',
  paymentTaken: false,
  synthetic: true,
  expiresAt: expiresAt(),
  ...over,
});
const sub = (over: Record<string, unknown> = {}) => ({
  id: subscriptionId,
  workspaceId,
  planKey: 'example-organiser',
  planVersion: 1,
  planTitle: 'Organiser monthly (sample plan)',
  interval: 'month',
  priceMinor: '4900',
  currency: 'USD',
  taxTreatment: 'price_excludes_tax',
  status: 'active',
  periodStart: '2026-10-23',
  periodEnd: '2026-11-23',
  periodElapsed: false,
  createdAt: '2026-10-22T09:00:00.000Z',
  updatedAt: '2026-10-23T09:00:00.000Z',
  ...over,
});
const timeline = [
  {
    seq: 1,
    at: '2026-10-22T09:00:00.000Z',
    kind: 'requested',
    status: 'requested',
    by: 'You',
    note: null,
    periodStart: null,
    periodEnd: null,
    endReason: null,
  },
  {
    seq: 2,
    at: '2026-10-23T09:00:00.000Z',
    kind: 'activated',
    status: 'active',
    by: 'Corridra team',
    note: 'Synthetic note: your plan starts today',
    periodStart: '2026-10-23',
    periodEnd: '2026-11-23',
    endReason: null,
  },
];
const overviewBody = (over: Record<string, unknown> = {}) => ({
  workspaceId,
  canAct: true,
  current: sub(),
  pending: null,
  entitlements,
  entitlementsEnforced: false,
  subscriptions: [{ ...sub(), timeline }],
  actions: ['request', 'cancel'],
  invoicing: 'not_enabled',
  paymentTaken: false,
  synthetic: true,
  expiresAt: expiresAt(),
  ...over,
});
type Reply = { status?: number; json?: unknown };
async function serve(
  page: Page,
  handler: (url: URL, method: string, body: Record<string, unknown> | null) => Reply,
) {
  await page.route('**/api/customer-billing**', (route) => {
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
const reads =
  (overview: Record<string, unknown> = {}, plans: Record<string, unknown> = {}) =>
  (url: URL) => ({
    json: url.searchParams.get('scope') === 'plans' ? plansBody(plans) : overviewBody(overview),
  });
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);

test('the page shows the held plan, what it includes, the plans on offer and says nothing is charged or applied', async ({
  page,
}) => {
  await serve(page, reads());
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Your plan', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Organiser monthly (sample plan)' }).first(),
  ).toBeVisible();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('Current period: 23 October 2026 until 23 November 2026.'),
  ).toBeVisible();
  await expect(
    page.getByText(/Nothing is charged, no invoice is made and no payment is taken/),
  ).toBeVisible();
  const includes = page.getByRole('region', { name: 'What your plan includes' });
  await expect(includes.getByText('People in the workspace', { exact: true })).toBeVisible();
  await expect(includes.getByText(/Up to 10/)).toBeVisible();
  await expect(includes.getByText(/No limit/).first()).toBeVisible();
  await expect(includes.getByText(/Corridra does not apply these limits yet/)).toBeVisible();
  const offer = page.getByRole('region', { name: 'Plans on offer' });
  await expect(offer.getByText('USD 49.00 per month')).toBeVisible();
  await expect(offer.getByText('Free', { exact: true })).toBeVisible();
  await expect(offer.getByText(/Price excludes tax/)).toBeVisible();
  await expect(offer.getByText(/Tax to be confirmed/)).toBeVisible();
  // The plan already held cannot be asked for again; the other one can.
  await expect(offer.getByText('Your workspace holds this plan.')).toBeVisible();
  await expect(offer.getByRole('button', { name: 'Ask for this plan' })).toHaveCount(1);
  await page.getByText('Everything in this plan').first().click();
  await expect(page.getByText('Payment collection from participants').first()).toBeVisible();
  // History shows what happened and the note the team wrote; the word synthetic is the team's own text only.
  await expect(page.getByText(/The plan started/)).toBeVisible();
  await expect(page.getByText(/Synthetic note: your plan starts today/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('asking for a plan needs the acknowledgement and sends the exact version and fingerprint once', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  let asked = false;
  await serve(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      asked = true;
      return {
        json: sub({ status: 'requested', periodStart: null, periodEnd: null, id: randomUUID() }),
      };
    }
    return url.searchParams.get('scope') === 'plans'
      ? { json: plansBody() }
      : {
          json: asked
            ? overviewBody({
                current: null,
                entitlements: [],
                pending: sub({ status: 'requested', periodStart: null, periodEnd: null }),
                actions: ['withdraw'],
              })
            : overviewBody({
                current: null,
                entitlements: [],
                subscriptions: [],
                actions: ['request'],
              }),
        };
  });
  await page.goto(origin + '/');
  await expect(page.getByText('Your workspace does not hold a plan.')).toBeVisible();
  await expect(page.getByText('No plan is active, so nothing is listed.')).toBeVisible();
  await page.getByRole('button', { name: 'Ask for this plan' }).first().click();
  const form = page.getByRole('form', { name: 'Ask for Organiser monthly (sample plan)' });
  const send = form.getByRole('button', { name: 'Send request' });
  await expect(send).toBeDisabled();
  expect(await axe(page)).toEqual([]);
  await form.getByLabel(/I have read the price/).check();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'acknowledged',
    'action',
    'commandId',
    'planDigest',
    'planKey',
    'planVersion',
    'workspaceId',
  ]);
  expect(posts[0]).toMatchObject({
    action: 'request',
    workspaceId,
    planKey: 'example-organiser',
    planVersion: 1,
    planDigest: digest,
    acknowledged: true,
  });
  await expect(page.getByText(/You asked for Organiser/)).toBeVisible();
  await expect(page.getByText('Waiting for the Corridra team').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw my request' })).toBeVisible();
});

test('cancel, keep and withdraw each ask first and send the exact change', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  await serve(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      return { json: sub() };
    }
    return reads()(url);
  });
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Cancel at the end of the period' }).click();
  const cancel = page.getByRole('form', { name: 'Cancel' });
  await expect(cancel.getByText(/The plan stays until 23 November 2026/)).toBeVisible();
  await cancel.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'commandId',
    'subscriptionId',
    'workspaceId',
  ]);
  expect(posts[0]).toMatchObject({ action: 'cancel', subscriptionId, workspaceId });
  await page.unroute('**/api/customer-billing**');
  await serve(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      return { json: sub() };
    }
    return reads({
      current: sub({ status: 'cancel_scheduled' }),
      actions: ['request', 'keep'],
    })(url);
  });
  await page.goto(origin + '/');
  await expect(page.getByText('Ends at the end of this period').first()).toBeVisible();
  await expect(page.getByText(/You asked to cancel/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep my plan' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts[1]).toMatchObject({ action: 'keep', subscriptionId, workspaceId });
  await page.unroute('**/api/customer-billing**');
  await serve(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      return { json: sub() };
    }
    return reads({
      current: null,
      entitlements: [],
      pending: sub({ status: 'requested', periodStart: null, periodEnd: null }),
      actions: ['withdraw'],
    })(url);
  });
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Withdraw my request' }).click();
  await page
    .getByRole('form', { name: 'Withdraw' })
    .getByRole('button', { name: 'Confirm withdrawal' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts[2]).toMatchObject({ action: 'withdraw', subscriptionId, workspaceId });
  expect(new Set(posts.map((p) => p.commandId)).size).toBe(3);
});

test('a member reads the plan and sees no controls; an ended period grants nothing', async ({
  page,
}) => {
  await serve(page, reads({ canAct: false, actions: [] }, { canRequest: false }));
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Your plan', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel at the end of the period' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Ask for this plan' })).toHaveCount(0);
  await expect(page.getByText('Only a workspace owner or admin can ask for a plan.')).toBeVisible();
  await page.unroute('**/api/customer-billing**');
  await serve(
    page,
    reads({
      current: sub({ periodElapsed: true }),
      entitlements: [],
      actions: ['request'],
    }),
  );
  await page.goto(origin + '/');
  await expect(page.getByText('Period ended, not renewed').first()).toBeVisible();
  await expect(page.getByText(/Nothing from this plan applies now/)).toBeVisible();
  await expect(page.getByText('The period has ended, so nothing is listed.')).toBeVisible();
});

test('a lost answer is retried with the same command id, and a changed plan turns the buttons off', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  let attempt = 0;
  await page.route('**/api/customer-billing**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      posts.push(request.postDataJSON());
      attempt += 1;
      if (attempt === 1) return route.abort('connectionreset');
      return route.fulfill({ status: attempt === 2 ? 200 : 409, json: attempt === 2 ? sub() : {} });
    }
    return route.fulfill({
      json:
        new URL(request.url()).searchParams.get('scope') === 'plans' ? plansBody() : overviewBody(),
    });
  });
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Cancel at the end of the period' }).click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByRole('alert')).toContainText('could not confirm');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts).toHaveLength(2);
  expect(posts[1]!.commandId).toBe(posts[0]!.commandId);
  // A later change is refused as out of date: the buttons go off and a reload is offered.
  await page.getByRole('button', { name: 'Cancel at the end of the period' }).click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByRole('alert')).toContainText('something has changed');
  await expect(page.getByText('Out of date', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel at the end of the period' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Reload this page' })).toBeVisible();
});

test('denied, unavailable, off and mismatched answers are calm and safe', async ({ page }) => {
  await serve(page, () => ({ status: 403, json: { error: 'x' } }));
  await page.goto(origin + '/');
  await expect(page.getByText('Access required')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('You no longer have access here');
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await page.unroute('**/api/customer-billing**');
  await serve(page, () => ({ status: 503, json: { error: 'x' } }));
  await page.goto(origin + '/');
  await expect(page.getByRole('alert')).toContainText('Plans are not switched on here.');
  await page.unroute('**/api/customer-billing**');
  await serve(page, () => ({ status: 500, json: { error: 'x' } }));
  await page.goto(origin + '/');
  await expect(page.getByRole('alert')).toContainText('Could not load your plan');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.unroute('**/api/customer-billing**');
  await serve(page, (url) => ({
    json:
      url.searchParams.get('scope') === 'plans'
        ? plansBody()
        : overviewBody({ workspaceId: randomUUID() }),
  }));
  await page.goto(origin + '/');
  await expect(page.getByRole('alert')).toContainText('did not match');
  await expect(page.getByRole('heading', { name: 'Your plan', exact: true })).toHaveCount(0);
  // An answer that claims to be real data, or that says a payment was taken, is refused.
  await page.unroute('**/api/customer-billing**');
  await serve(page, (url) => ({
    json:
      url.searchParams.get('scope') === 'plans'
        ? plansBody()
        : overviewBody({ paymentTaken: true }),
  }));
  await page.goto(origin + '/');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your plan', exact: true })).toHaveCount(0);
});

test('the plan link appears beside a workspace only when the module is on', async ({ page }) => {
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
  await expect(page.getByRole('link', { name: 'Plan and billing' })).toHaveAttribute(
    'href',
    '/account/billing/' + workspaceId,
  );
  await page.goto(origin + '/?view=workspaces&plans=off');
  await expect(page.getByText('Synthetic owner workspace')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Plan and billing' })).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440])
  test('keyboard use, no sideways scrolling and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await serve(page, reads());
    await page.goto(origin + '/');
    await expect(page.getByRole('heading', { name: 'Plans on offer' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Ask for this plan' }).focus();
    await page.keyboard.press('Enter');
    await page.getByLabel(/I have read the price/).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Send request' })).toBeEnabled();
    expect(await axe(page)).toEqual([]);
  });

type StaffPost = Record<string, unknown>;
const staffSummary = (over: Record<string, unknown> = {}) => ({
  ...sub({ status: 'requested', periodStart: null, periodEnd: null }),
  workspaceName: 'Synthetic billing workspace',
  lastSeq: 1,
  ...over,
});
const staffDetail = (over: Record<string, unknown> = {}) => ({
  subscription: staffSummary(),
  plan: plan(),
  planDigestAtRequest: digest,
  events: [
    {
      seq: 1,
      at: '2026-10-22T09:00:00.000Z',
      kind: 'requested',
      status: 'requested',
      actorKind: 'customer',
      customerNote: null,
      internalNote: null,
      periodStart: null,
      periodEnd: null,
      endReason: null,
    },
  ],
  lastSeq: 1,
  actions: ['activate', 'decline', 'note'],
  replacesHeldPlan: false,
  periodElapsed: false,
  synthetic: true,
  ...over,
});
async function serveStaff(
  page: Page,
  handler: (url: URL, method: string, body: StaffPost | null) => Reply,
) {
  await page.route('**/api/workspace/customer-billing**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(url.searchParams.get('tenant')).toBe(tenant);
    const reply = handler(
      url,
      request.method(),
      request.method() === 'POST' ? request.postDataJSON() : null,
    );
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
  });
}

test('staff open a request, see the plan and the note rules, and activate with an explicit period', async ({
  page,
}) => {
  const posts: StaffPost[] = [];
  await serveStaff(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      return { json: staffSummary({ status: 'active' }) };
    }
    const scope = url.searchParams.get('scope');
    if (scope === 'detail') return { json: staffDetail({ replacesHeldPlan: true }) };
    return { json: { subscriptions: [staffSummary()], nextAfter: null, synthetic: true } };
  });
  await page.goto(origin + '/?view=staff');
  await page
    .getByRole('button', {
      name: 'Open Organiser monthly (sample plan) for Synthetic billing workspace',
    })
    .click();
  await expect(
    page.getByText(/already holds a plan. Activating this request ends that plan/),
  ).toBeVisible();
  const form = page.getByRole('form', { name: 'Activate' });
  await form.getByLabel('Period starts on').fill('2026-10-23');
  await form.getByLabel(/Note the customer reads/).fill('Synthetic note: your plan starts today');
  expect(await axe(page)).toEqual([]);
  await form.getByRole('button', { name: 'Activate this plan' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'commandId',
    'customerNote',
    'expectedSeq',
    'periodStart',
    'subscriptionId',
  ]);
  expect(posts[0]).toMatchObject({
    action: 'activate',
    subscriptionId,
    expectedSeq: 1,
    periodStart: '2026-10-23',
    customerNote: 'Synthetic note: your plan starts today',
  });
});

test('staff decline with a reason, keep internal notes apart and retry a lost save with the same command id', async ({
  page,
}) => {
  const posts: StaffPost[] = [];
  let attempt = 0;
  await page.route('**/api/workspace/customer-billing**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      posts.push(request.postDataJSON());
      attempt += 1;
      return attempt === 1
        ? route.abort('connectionreset')
        : route.fulfill({ json: staffSummary({ status: 'declined' }) });
    }
    return route.fulfill({
      json:
        url.searchParams.get('scope') === 'detail'
          ? staffDetail()
          : { subscriptions: [staffSummary()], nextAfter: null, synthetic: true },
    });
  });
  await page.goto(origin + '/?view=staff');
  await page.getByRole('button', { name: /^Open Organiser monthly/ }).click();
  const decline = page.getByRole('form', { name: 'Decline or end' });
  await decline
    .getByLabel(/Reason the customer reads/)
    .fill('Synthetic reason: not available for this team yet');
  await decline.getByRole('button', { name: 'Decline this request' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not confirm');
  await decline.getByRole('button', { name: 'Decline this request' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts).toHaveLength(2);
  expect(posts[1]!.commandId).toBe(posts[0]!.commandId);
  expect(posts[0]).toMatchObject({
    action: 'decline',
    expectedSeq: 1,
    customerNote: 'Synthetic reason: not available for this team yet',
  });
  const internal = page.getByRole('form', { name: 'Internal note' });
  await expect(internal.getByLabel(/never shown to the customer/)).toBeVisible();
});

test('staff add a plan version with every limit stated once', async ({ page }) => {
  const posts: StaffPost[] = [];
  const keys = entitlements.map((e) => ({ key: e.key, unit: e.unit, label: e.label }));
  await serveStaff(page, (url, method, body) => {
    if (method === 'POST') {
      posts.push(body!);
      return { json: { planKey: 'example-yearly', version: 1, active: true } };
    }
    const scope = url.searchParams.get('scope');
    if (scope === 'plans')
      return {
        json: { plans: [{ ...plan(), source: 'SEED' }], entitlementKeys: keys, synthetic: true },
      };
    return { json: { subscriptions: [], nextAfter: null, synthetic: true } };
  });
  await page.goto(origin + '/?view=staff');
  await expect(page.getByText('No customer has asked for a plan.')).toBeVisible();
  await page.getByText('Plans on offer and plan versions').click();
  await page.getByRole('button', { name: 'Add a new plan' }).click();
  const form = page.getByRole('form', { name: 'Plan version' });
  await form.getByLabel(/Plan key/).fill('example-yearly');
  await form.getByLabel(/Title/).fill('Yearly team (sample plan)');
  await form.getByLabel('Summary').fill('An example yearly plan. The price is invented.');
  await form.getByLabel('Billed').selectOption('year');
  await form.getByLabel(/Price in whole minor units/).fill('99000');
  await form.getByLabel('Tax').selectOption('price_includes_tax');
  await form.getByLabel(/What is included/).fill('A shared workspace\nReport exports');
  await form.getByLabel(/What is left out/).fill('Any support commitment');
  await form.getByLabel('People in the workspace', { exact: true }).selectOption('limit');
  await form.getByLabel('People in the workspace limit').fill('8');
  for (const label of [
    'Active delegation programmes',
    'Participants in each programme',
    'Open help requests',
  ])
    await form.getByLabel(label, { exact: true }).selectOption('unlimited');
  expect(await axe(page)).toEqual([]);
  await form.getByRole('button', { name: 'Save as a new version' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    action: 'plan',
    planKey: 'example-yearly',
    expectedVersion: 0,
    title: 'Yearly team (sample plan)',
    interval: 'year',
    priceMinor: '99000',
    currency: 'USD',
    taxTreatment: 'price_includes_tax',
    included: ['A shared workspace', 'Report exports'],
    excluded: ['Any support commitment'],
    active: true,
  });
  const sent = posts[0]!.entitlements as { key: string; mode: string; limit: number | null }[];
  expect(sent.map((e) => e.key)).toEqual(keys.map((k) => k.key));
  expect(sent[0]).toEqual({ key: 'workspace_members', mode: 'limit', limit: 8 });
  expect(sent.find((e) => e.key === 'report_exports')).toEqual({
    key: 'report_exports',
    mode: 'included',
    limit: null,
  });
});

test('staff denial and unavailable states are plain', async ({ page }) => {
  await serveStaff(page, () => ({ status: 403, json: { error: 'x' } }));
  await page.goto(origin + '/?view=staff');
  await expect(page.getByRole('alert')).toContainText('fresh authenticator check is required');
  await page.unroute('**/api/workspace/customer-billing**');
  await serveStaff(page, () => ({ status: 503, json: { error: 'x' } }));
  await page.goto(origin + '/?view=staff');
  await expect(page.getByRole('alert')).toContainText('Plans are unavailable.');
});
