import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. The restricted database authority has its own integration acceptance.
const workspaceId = '00000000-0000-4000-8000-0000000000a1';
const subscriptionId = '00000000-0000-4000-8000-0000000000b2';
const invoiceId = '00000000-0000-4000-8000-0000000000c3';
const tenant = '00000000-0000-4000-8000-0000000000d4';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {CustomerRealInvoicing} from ${JSON.stringify(resolve('apps/web/app/operator/customer-real-invoicing.tsx'))};
createRoot(document.getElementById('fixture')).render(<CustomerRealInvoicing tenant={${JSON.stringify(tenant)}}/>);`,
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
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Real invoice fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Real invoice fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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

const supplier = (over: Record<string, unknown> = {}) => ({
  version: 1,
  legalName: 'Corridra Pte Ltd',
  address: '101 Robinson Road, Singapore 180239',
  country: 'SG',
  uen: '202600000A (madeup)',
  gstRegistered: true,
  gstRegistrationNo: 'M9-0000000-0 (madeup)',
  taxLabel: 'GST',
  gstRateBps: 900,
  paymentTermsDays: 30,
  financeLabel: 'Sadat FPA (madeup)',
  approverNamed: false,
  madeupFields: ['uen', 'gst_registration_no', 'gst_registered'],
  ...over,
});
const period = {
  subscriptionId,
  workspaceId,
  workspaceName: 'Acme Apparel',
  planTitle: 'Organiser monthly',
  periodStart: '2026-10-24',
  periodEnd: '2026-11-24',
  priceMinor: '10000',
  currency: 'SGD',
  taxTreatment: 'price_excludes_tax',
};
const proposal = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  kind: 'invoice',
  workspaceName: 'Acme Apparel',
  periodStart: '2026-10-24',
  periodEnd: '2026-11-24',
  dueDate: '2026-11-23',
  billToName: 'Acme Apparel Pte Ltd',
  billToAddress: '1 Raffles Place, Singapore 048616',
  invoiceNumber: null,
  amountMinor: null,
  reason: null,
  preparedByYou: false,
  preview: {
    currency: 'SGD',
    planTitle: 'Organiser monthly',
    feeMinor: '10000',
    taxMinor: '900',
    totalMinor: '10900',
  },
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  id: invoiceId,
  number: 'INV-2026-000001',
  title: 'Tax Invoice',
  workspaceName: 'Acme Apparel',
  planTitle: 'Organiser monthly',
  periodStart: '2026-10-24',
  periodEnd: '2026-11-24',
  issueDate: '2026-10-24',
  dueDate: '2026-11-23',
  currency: 'SGD',
  totalMinor: '10900',
  paidMinor: '0',
  creditedMinor: '0',
  outstandingMinor: '10900',
  status: 'unpaid',
  overdue: false,
  position: 0,
  madeupFields: ['uen'],
  payments: [],
  credits: [],
  ...over,
});
type State = {
  periods: unknown[];
  proposals: unknown[];
  rows: unknown[];
  second: boolean;
  supplier: unknown;
};
const pendingBody = (st: State) => ({
  periods: st.periods,
  proposals: st.proposals,
  secondApproverRequired: st.second,
  supplier: st.supplier,
  synthetic: false,
});
type Reply = { status?: number; json?: unknown };
type Seen = { method: string; query: URLSearchParams; body: Record<string, unknown> | null };
async function serve(
  page: Page,
  st: State,
  seen: Seen[],
  command: (body: Record<string, unknown>) => Reply = () => ({ json: { state: 'recorded' } }),
) {
  await page.route('**/api/workspace/customer-billing**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(url.searchParams.get('invoicing')).toBe('real');
    expect(url.searchParams.get('tenant')).toBe(tenant);
    const body =
      request.method() === 'POST' ? (request.postDataJSON() as Record<string, unknown>) : null;
    seen.push({ method: request.method(), query: url.searchParams, body });
    if (body) {
      const reply = command(body);
      return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
    }
    const scope = url.searchParams.get('scope');
    if (scope === 'pending') return route.fulfill({ json: pendingBody(st) });
    if (scope === 'invoices')
      return route.fulfill({ json: { invoices: st.rows, nextAfter: null, synthetic: false } });
    if (scope === 'invoice')
      return route.fulfill({
        json: {
          invoice: st.rows[0],
          actions:
            Number((st.rows[0] as { outstandingMinor: string }).outstandingMinor) > 0
              ? ['payment', 'credit']
              : [],
          synthetic: false,
        },
      });
    return route.fulfill({ status: 400, json: {} });
  });
}
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);
const fresh = (over: Partial<State> = {}): State => ({
  periods: [period],
  proposals: [],
  rows: [row()],
  second: true,
  supplier: supplier(),
  ...over,
});

test('staff see the supplier, the made-up notice, what to invoice and what is issued', async ({
  page,
}) => {
  const seen: Seen[] = [];
  await serve(page, fresh({ proposals: [proposal()] }), seen);
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Customer invoices', exact: true })).toBeVisible();
  const supplierBox = page.getByRole('region', { name: 'Supplier details' });
  await expect(
    supplierBox.getByText(/Corridra Pte Ltd, 101 Robinson Road, Singapore 180239/),
  ).toBeVisible();
  await expect(supplierBox.getByText(/Made-up organisation data \(madeup\)/)).toBeVisible();
  await expect(
    supplierBox.getByText(/company registration number \(UEN\), GST registration number/),
  ).toBeVisible();
  await expect(supplierBox.getByText(/A second owner or admin approves/)).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Periods to invoice' }).getByText(/Organiser monthly/),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Waiting for approval' })
      .getByText(/fee SGD\s100\.00, tax SGD\s9\.00, total SGD\s109\.00/),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Issued invoices' })
      .getByText('INV-2026-000001', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/contains made-up data \(madeup\)/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
  // The panel only ever reads the real namespace.
  expect(seen.every((s) => s.query.get('invoicing') === 'real')).toBe(true);
});

test('preparing an invoice sends one command and says a second person must approve', async ({
  page,
}) => {
  const seen: Seen[] = [];
  await serve(page, fresh(), seen);
  await page.goto(origin + '/');
  await page
    .getByRole('button', { name: /Prepare invoice for Acme Apparel, 24 October 2026/ })
    .click();
  await page.getByLabel('Bill to: company name').fill('Acme Apparel Pte Ltd');
  await page.getByLabel(/Bill to: address on one line/).fill('1 Raffles Place, Singapore 048616');
  await page.getByRole('button', { name: 'Prepare invoice for approval' }).click();
  await expect(page.getByText('Prepared. A second person now needs to approve it.')).toBeVisible();
  const post = seen.find((s) => s.method === 'POST')!;
  expect(post.body).toMatchObject({
    action: 'prepare_invoice',
    subscriptionId,
    periodStart: '2026-10-24',
    billToName: 'Acme Apparel Pte Ltd',
    billToAddress: '1 Raffles Place, Singapore 048616',
  });
  expect(typeof post.body!.commandId).toBe('string');
  expect(Object.keys(post.body!)).not.toContain('taxMinor');
});

test('the preparer cannot approve; another person can approve or reject with a reason', async ({
  page,
}) => {
  const seen: Seen[] = [];
  const mine = proposal({ preparedByYou: true, billToName: 'Mine Pte Ltd' });
  const theirs = proposal({ billToName: 'Theirs Pte Ltd', workspaceName: 'Theirs Studio' });
  await serve(page, fresh({ proposals: [mine, theirs] }), seen);
  await page.goto(origin + '/');
  await expect(
    page.getByText(/You prepared this. Another person needs to approve or reject it/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve invoice for Acme Apparel/ })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Approve invoice for Theirs Studio' }).click();
  await expect(page.getByText('Approved. The invoice now has its number.')).toBeVisible();
  expect(seen.find((s) => s.method === 'POST')!.body).toMatchObject({
    action: 'decide',
    proposalId: (theirs as { id: string }).id,
    decision: 'approve',
  });
  await page.getByRole('button', { name: 'Reject for Theirs Studio' }).click();
  await page.getByLabel(/Why are you rejecting this invoice/).fill('Wrong company name');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByText('Rejected. Nothing was issued.')).toBeVisible();
  const posts = seen.filter((s) => s.method === 'POST');
  expect(posts[1]!.body).toMatchObject({ decision: 'reject', reason: 'Wrong company name' });
  expect(posts[0]!.body!.commandId).not.toBe(posts[1]!.body!.commandId);
});

test('single approver mode lets the same person approve and says documents are self approved', async ({
  page,
}) => {
  const seen: Seen[] = [];
  await serve(page, fresh({ second: false, proposals: [proposal({ preparedByYou: true })] }), seen);
  await page.goto(origin + '/');
  await expect(
    page.getByText(/One person may prepare and approve. Each document says it was self approved/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Approve invoice for Acme Apparel/ }),
  ).toBeVisible();
});

test('recording a payment and preparing a credit note, and an uncertain save is retried with the same command', async ({
  page,
}) => {
  const seen: Seen[] = [];
  let calls = 0;
  await serve(page, fresh(), seen, () =>
    ++calls === 1 ? { status: 502, json: {} } : { json: { state: 'recorded' } },
  );
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Open INV-2026-000001' }).click();
  await page.getByLabel(/Amount received in SGD minor units/).fill('2000');
  await page.getByLabel('Bank reference (plain text)').fill('DBS transfer 8841');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText(/Could not confirm that this was saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Send the same payment again' }).click();
  await expect(page.getByText('Payment recorded.')).toBeVisible();
  const posts = seen.filter((s) => s.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0]!.body).toEqual(posts[1]!.body);
  expect(posts[0]!.body).toMatchObject({
    action: 'payment',
    invoiceId,
    expectedPosition: 0,
    amountMinor: '2000',
    method: 'bank_transfer',
    reference: 'DBS transfer 8841',
  });
  await page.getByRole('button', { name: 'Open INV-2026-000001' }).click();
  await page.getByLabel(/Credit amount in SGD minor units/).fill('500');
  await page.getByLabel('Reason the customer reads').fill('Goodwill credit for a late start');
  await page.getByRole('button', { name: 'Prepare credit note for approval' }).click();
  await expect(
    page.getByText('Prepared. A second person now needs to approve the credit note.'),
  ).toBeVisible();
  expect(seen.filter((s) => s.method === 'POST')[2]!.body).toMatchObject({
    action: 'prepare_credit',
    amountMinor: '500',
    reason: 'Goodwill credit for a late start',
  });
});

test('switched off shows nothing and an access refusal says what is needed', async ({ page }) => {
  await page.route('**/api/workspace/customer-billing**', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Customer invoices' })).toHaveCount(0);
  await page.unroute('**/api/workspace/customer-billing**');
  await page.route('**/api/workspace/customer-billing**', (route) =>
    route.fulfill({ status: 403, json: {} }),
  );
  await page.reload();
  await expect(
    page.getByText(/Owner or admin access with a fresh authenticator check is required/),
  ).toBeVisible();
});
