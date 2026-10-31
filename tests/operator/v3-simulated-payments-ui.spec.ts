import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. The restricted database authority has its own integration acceptance.
const issuer =
  'https://ep-simulated-payments-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-0000000000a1';
const invoiceId = '00000000-0000-4000-8000-0000000000c3';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {SimulatedPaymentsSection} from ${JSON.stringify(resolve('apps/web/app/account/billing/simulated-payments-section.tsx'))};
const subject='real-alice',issuer=${JSON.stringify(issuer)},workspaceId=${JSON.stringify(workspaceId)};
createRoot(document.getElementById('fixture')).render(<SimulatedPaymentsSection subject={subject} issuer={issuer} workspaceId={workspaceId}/>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    // The public real-use value that real answers need to be accepted at all (ADR-062).
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env': '{"NEXT_PUBLIC_CORRIDRA_REAL_USE_ENABLED":"true"}',
    },
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
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated payment fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Simulated payment fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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

const expiresAt = () => new Date(Date.now() + 60000).toISOString();
const attempt = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  invoiceId,
  invoiceNumber: 'INV-2026-000001',
  workspaceId,
  amountMinor: '4000',
  currency: 'SGD',
  state: 'started',
  providerRef: 'SIMPAY-0123456789AB (madeup)',
  providerName: 'Corridra Pay (madeup)',
  createdAt: '2026-10-24T10:00:00Z',
  expiresAt: '2026-10-24T10:30:00Z',
  decidedAt: null,
  refundedMinor: '0',
  refundableMinor: '0',
  refundOpenUntil: null,
  refunds: [],
  simulated: true,
  madeup: true,
  moneyMoves: false,
  moneyDomain: 'B',
  ...over,
});
type State = { canPay: boolean; payable: unknown[]; attempts: unknown[] };
const body = (st: State, over: Record<string, unknown> = {}) => ({
  workspaceId,
  canPay: st.canPay,
  provider: {
    name: 'Corridra Pay (madeup)',
    madeup: true,
    refundWindowDays: 14,
    refundPolicy: 'Refunds are possible within 14 days (madeup)',
  },
  payable: st.payable,
  attempts: st.attempts,
  simulated: true,
  moneyMoves: false,
  paymentTaken: false,
  synthetic: false,
  expiresAt: expiresAt(),
  ...over,
});
const payable = {
  invoiceId,
  number: 'INV-2026-000001',
  currency: 'SGD',
  outstandingMinor: '10900',
};
type Reply = { status?: number; json?: unknown };
type Seen = { method: string; body: Record<string, unknown> | null };
async function serve(
  page: Page,
  st: State,
  seen: Seen[],
  command: (body: Record<string, unknown>) => Reply = () => ({ json: { attempt: attempt() } }),
) {
  await page.route('**/api/customer-billing/simulated-payments**', (route) => {
    const request = route.request();
    expect(request.headers()['x-corridra-customer-subject']).toBe('real-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    const post =
      request.method() === 'POST' ? (request.postDataJSON() as Record<string, unknown>) : null;
    seen.push({ method: request.method(), body: post });
    if (post) {
      const reply = command(post);
      return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
    }
    expect(new URL(request.url()).searchParams.get('workspaceId')).toBe(workspaceId);
    return route.fulfill({ json: body(st) });
  });
}
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);

test('an owner reads the made-up notice, the provider and policy, and what could be paid, and nothing says pay now', async ({
  page,
}) => {
  const seen: Seen[] = [];
  await serve(page, { canPay: true, payable: [payable], attempts: [] }, seen);
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Try the payment flow (madeup)' })).toBeVisible();
  await expect(
    page.getByText(/This is a simulation with made-up details \(madeup\)/),
  ).toBeVisible();
  await expect(page.getByText(/no money moves and your invoices do not change/)).toBeVisible();
  await expect(
    page.getByText(
      /Provider: Corridra Pay \(madeup\)\. Refunds are possible within 14 days \(madeup\)/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/INV-2026-000001 · still to pay SGD\s109\.00/)).toBeVisible();
  await expect(page.getByText(/pay now/i)).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});

test('starting a simulated checkout sends one command for the invoice and amount, then the checkout can be approved', async ({
  page,
}) => {
  const seen: Seen[] = [];
  const st: State = { canPay: true, payable: [payable], attempts: [] };
  await serve(page, st, seen, (b) => {
    if (b.action === 'start') {
      st.attempts = [attempt({ amountMinor: b.amountMinor })];
      return { json: { attempt: st.attempts[0] } };
    }
    st.attempts = [
      attempt({
        ...(st.attempts[0] as object),
        state: 'succeeded',
        decidedAt: '2026-10-24T10:05:00Z',
        refundableMinor: '4000',
        refundOpenUntil: '2026-11-07T10:05:00Z',
      }),
    ];
    return { json: { attempt: st.attempts[0] } };
  });
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Try paying INV-2026-000001 (madeup)' }).click();
  await page.getByLabel(/Amount in SGD minor units/).fill('4000');
  await page.getByRole('button', { name: 'Open simulated checkout (madeup)' }).click();
  await expect(
    page.getByText('Checkout opened (madeup). Approve or decline it below.'),
  ).toBeVisible();
  const start = seen.find((s) => s.method === 'POST')!;
  expect(start.body).toMatchObject({
    action: 'start',
    workspaceId,
    invoiceId,
    amountMinor: '4000',
  });
  expect(typeof start.body!.commandId).toBe('string');
  const checkout = page.getByRole('region', { name: 'Simulated checkout' });
  await expect(
    checkout.getByRole('heading', { name: 'Checkout at Corridra Pay (madeup)' }),
  ).toBeVisible();
  await expect(checkout.getByText(/SIMPAY-0123456789AB \(madeup\)/)).toBeVisible();
  await checkout.getByRole('button', { name: 'Approve this payment (madeup)' }).click();
  await expect(
    page.getByText('Payment approved (madeup). No money moved and your invoice did not change.'),
  ).toBeVisible();
  const done = seen.filter((s) => s.method === 'POST')[1]!;
  expect(done.body).toMatchObject({ action: 'complete', workspaceId, outcome: 'succeeded' });
  const history = page.getByRole('region', { name: 'Simulated payments so far' });
  await expect(history.getByText('Approved (madeup)', { exact: true })).toBeVisible();
  await expect(history.getByText(/Refunds \(madeup\) are possible until/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('a checkout can be declined, and an uncertain save is retried as the same command', async ({
  page,
}) => {
  const seen: Seen[] = [];
  const live = attempt();
  let calls = 0;
  await serve(page, { canPay: true, payable: [payable], attempts: [live] }, seen, () =>
    ++calls === 1
      ? { status: 502, json: {} }
      : { json: { attempt: attempt({ ...live, state: 'declined' }) } },
  );
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Decline this payment (madeup)' }).click();
  await expect(page.getByText(/Could not confirm that this was saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Decline this payment (madeup)' }).click();
  await expect(page.getByText('Payment declined (madeup). Nothing was charged.')).toBeVisible();
  const posts = seen.filter((s) => s.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0]!.body).toEqual(posts[1]!.body);
  expect(posts[0]!.body).toMatchObject({
    action: 'complete',
    attemptId: live.id,
    outcome: 'declined',
  });
});

test('refunds and expired attempts are shown with their made-up labels; a member only sees who can use this', async ({
  page,
}) => {
  const seen: Seen[] = [];
  const st: State = {
    canPay: true,
    payable: [],
    attempts: [
      attempt({
        state: 'succeeded',
        decidedAt: '2026-10-24T10:05:00Z',
        refundedMinor: '1000',
        refundableMinor: '3000',
        refundOpenUntil: '2026-11-07T10:05:00Z',
        refunds: [
          {
            seq: 1,
            amountMinor: '1000',
            reason: 'Made-up refund for a rehearsal',
            recordedAt: '2026-10-25T09:00:00Z',
          },
        ],
      }),
      attempt({ id: randomUUID(), state: 'expired', providerRef: 'SIMPAY-FEDCBA987654 (madeup)' }),
    ],
  };
  await serve(page, st, seen);
  await page.goto(origin + '/');
  await expect(page.getByText(/Refunded SGD\s10\.00 \(madeup\)/)).toBeVisible();
  await expect(page.getByText('Expired (madeup)', { exact: true })).toBeVisible();
  await expect(page.getByText('Nothing to pay')).toBeVisible();
  st.canPay = false;
  st.attempts = [];
  await page.reload();
  await expect(
    page.getByText('Only a workspace owner or admin can try the payment flow.'),
  ).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
});

test('switched off shows nothing, access refused says so, and an answer without the made-up label is refused', async ({
  page,
}) => {
  const seen: Seen[] = [];
  await page.route('**/api/customer-billing/simulated-payments**', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Try the payment flow (madeup)' })).toHaveCount(0);
  await page.unroute('**/api/customer-billing/simulated-payments**');
  await page.route('**/api/customer-billing/simulated-payments**', (route) =>
    route.fulfill({ status: 403, json: {} }),
  );
  await page.reload();
  await expect(page.getByText('Access required')).toBeVisible();
  await page.unroute('**/api/customer-billing/simulated-payments**');
  // A reference that does not say (madeup), a claim that money moves, or a payment taken is not shown.
  for (const bad of [
    { attempts: [attempt({ providerRef: 'SIMPAY-0123456789AB' })] },
    { attempts: [attempt({ moneyMoves: true })] },
    { moneyMoves: true },
    { paymentTaken: true },
    { synthetic: true },
    {
      provider: {
        name: 'Corridra Pay',
        madeup: true,
        refundWindowDays: 14,
        refundPolicy: 'Refunds within 14 days (madeup)',
      },
    },
  ]) {
    await page.route('**/api/customer-billing/simulated-payments**', (route) =>
      route.fulfill({ json: body({ canPay: true, payable: [payable], attempts: [] }, bad) }),
    );
    await page.reload();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/Open simulated checkout/)).toHaveCount(0);
    await page.unroute('**/api/customer-billing/simulated-payments**');
  }
  expect(seen).toHaveLength(0);
  await page.route('**/api/customer-billing/simulated-payments**', (route) =>
    route.fulfill({
      json: body({ canPay: true, payable: [], attempts: [] }, { workspaceId: randomUUID() }),
    }),
  );
  await page.reload();
  await expect(page.getByText(/did not match the workspace you opened/)).toBeVisible();
});
