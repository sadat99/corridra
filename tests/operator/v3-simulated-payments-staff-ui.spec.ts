import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. The restricted database authority has its own integration acceptance.
const workspaceId = '00000000-0000-4000-8000-0000000000a1';
const invoiceId = '00000000-0000-4000-8000-0000000000c3';
const tenant = '00000000-0000-4000-8000-0000000000d4';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {CustomerSimulatedPayments} from ${JSON.stringify(resolve('apps/web/app/operator/customer-simulated-payments.tsx'))};
createRoot(document.getElementById('fixture')).render(<CustomerSimulatedPayments tenant={${JSON.stringify(tenant)}}/>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
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
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated payment staff fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Simulated payment staff fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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

const attempt = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  invoiceId,
  invoiceNumber: 'INV-2026-000001',
  workspaceId,
  workspaceName: 'Acme Apparel',
  amountMinor: '4000',
  currency: 'SGD',
  state: 'succeeded',
  providerRef: 'SIMPAY-0123456789AB (madeup)',
  providerName: 'Corridra Pay (madeup)',
  createdAt: '2026-10-24T10:00:00Z',
  expiresAt: '2026-10-24T10:30:00Z',
  decidedAt: '2026-10-24T10:05:00Z',
  refundedMinor: '0',
  refundableMinor: '4000',
  refundOpenUntil: '2026-11-07T10:05:00Z',
  refunds: [],
  simulated: true,
  madeup: true,
  moneyMoves: false,
  moneyDomain: 'B',
  ...over,
});
const listing = (attempts: unknown[]) => ({
  attempts,
  nextAfter: null,
  provider: { name: 'Corridra Pay (madeup)', madeup: true, refundWindowDays: 14 },
  simulated: true,
  moneyMoves: false,
  synthetic: false,
});
type Reply = { status?: number; json?: unknown };
type Seen = { method: string; body: Record<string, unknown> | null };
async function serve(
  page: Page,
  list: () => unknown,
  seen: Seen[],
  command: (b: Record<string, unknown>) => Reply = () => ({ json: { state: 'refunded' } }),
) {
  await page.route('**/api/workspace/customer-simulated-payments**', (route) => {
    const request = route.request();
    expect(new URL(request.url()).searchParams.get('tenant')).toBe(tenant);
    const post =
      request.method() === 'POST' ? (request.postDataJSON() as Record<string, unknown>) : null;
    seen.push({ method: request.method(), body: post });
    if (post) {
      const reply = command(post);
      return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
    }
    return route.fulfill({ json: list() });
  });
}
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);

test('staff see every simulated attempt with its made-up labels, and a refund only where one is possible', async ({
  page,
}) => {
  const seen: Seen[] = [];
  const open = attempt();
  const done = attempt({
    id: randomUUID(),
    refundedMinor: '4000',
    refundableMinor: '0',
    providerRef: 'SIMPAY-AAAAAAAAAAAA (madeup)',
  });
  const declined = attempt({
    id: randomUUID(),
    state: 'declined',
    refundableMinor: '0',
    providerRef: 'SIMPAY-BBBBBBBBBBBB (madeup)',
  });
  await serve(page, () => listing([open, done, declined]), seen);
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Simulated payments (madeup)' })).toBeVisible();
  await expect(page.getByText(/inside the made-up window of 14 days \(madeup\)/)).toBeVisible();
  const rows = page.getByRole('region', { name: 'Simulated attempts' });
  await expect(rows.getByRole('listitem')).toHaveCount(3);
  await expect(rows.getByText(/Acme Apparel/).first()).toBeVisible();
  await expect(rows.getByText(/SIMPAY-0123456789AB \(madeup\)/)).toBeVisible();
  await expect(rows.getByText(/refunded SGD\s40\.00 \(madeup\)/)).toBeVisible();
  await expect(rows.getByText(/declined \(madeup\)/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Refund INV-2026-000001 \(madeup\)$/ }),
  ).toHaveCount(1);
  expect(await axe(page)).toEqual([]);
});

test('a refund sends one command and an uncertain save is retried as the same command', async ({
  page,
}) => {
  const seen: Seen[] = [];
  const open = attempt();
  let calls = 0;
  await serve(
    page,
    () => listing([open]),
    seen,
    () => (++calls === 1 ? { status: 502, json: {} } : { json: { state: 'refunded' } }),
  );
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Refund INV-2026-000001 (madeup)' }).click();
  await page.getByLabel(/Amount in SGD minor units/).fill('1000');
  await page.getByLabel(/Reason \(plain text/).fill('Made-up refund for a rehearsal of the flow');
  await page.getByRole('button', { name: 'Record refund (madeup)' }).click();
  await expect(page.getByText(/Could not confirm that this was saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Send the same refund again' }).click();
  await expect(page.getByText('Refund recorded (madeup). No money moved.')).toBeVisible();
  const posts = seen.filter((s) => s.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0]!.body).toEqual(posts[1]!.body);
  expect(posts[0]!.body).toMatchObject({
    action: 'refund',
    attemptId: open.id,
    amountMinor: '1000',
    reason: 'Made-up refund for a rehearsal of the flow',
  });
});

test('a refused refund says why in plain words; switched off shows nothing; access refused says what is needed', async ({
  page,
}) => {
  const seen: Seen[] = [];
  await serve(
    page,
    () => listing([attempt()]),
    seen,
    () => ({ status: 409, json: {} }),
  );
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Refund INV-2026-000001 (madeup)' }).click();
  await page.getByLabel(/Reason \(plain text/).fill('Made-up refund for a rehearsal of the flow');
  await page.getByRole('button', { name: 'Record refund (madeup)' }).click();
  await expect(page.getByRole('alert')).toContainText(
    /above what is left, the made-up window has passed/,
  );
  await page.unroute('**/api/workspace/customer-simulated-payments**');
  await page.route('**/api/workspace/customer-simulated-payments**', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Simulated payments (madeup)' })).toHaveCount(0);
  await page.unroute('**/api/workspace/customer-simulated-payments**');
  await page.route('**/api/workspace/customer-simulated-payments**', (route) =>
    route.fulfill({ status: 403, json: {} }),
  );
  await page.reload();
  await expect(
    page.getByText(/Owner or admin access with a fresh authenticator check is required/),
  ).toBeVisible();
});
