import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. The restricted database authority has its own integration acceptance.
const issuer =
  'https://ep-real-invoicing-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-0000000000a1';
const subscriptionId = '00000000-0000-4000-8000-0000000000b2';
const invoiceId = '00000000-0000-4000-8000-0000000000c3';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {RealInvoicesSection} from ${JSON.stringify(resolve('apps/web/app/account/billing/real-invoices-section.tsx'))};
const subject='real-alice',issuer=${JSON.stringify(issuer)},workspaceId=${JSON.stringify(workspaceId)};
createRoot(document.getElementById('fixture')).render(<RealInvoicesSection subject={subject} issuer={issuer} workspaceId={workspaceId}/>);`,
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

const expiresAt = () => new Date(Date.now() + 60000).toISOString();
const invoice = (over: Record<string, unknown> = {}) => ({
  id: invoiceId,
  number: 'INV-2026-000001',
  title: 'Tax Invoice',
  subscriptionId,
  workspaceId,
  planKey: 'organiser',
  planVersion: 1,
  planTitle: 'Organiser monthly',
  interval: 'month',
  periodStart: '2026-10-24',
  periodEnd: '2026-11-24',
  issueDate: '2026-10-24',
  dueDate: '2026-11-23',
  currency: 'SGD',
  taxTreatment: 'price_excludes_tax',
  gstRegistered: true,
  taxLabel: 'GST',
  taxRateBps: 900,
  planFeeMinor: '10000',
  taxMinor: '900',
  amountExcludingTaxMinor: '10000',
  totalMinor: '10900',
  paidMinor: '2000',
  creditedMinor: '0',
  outstandingMinor: '8900',
  status: 'partly_paid',
  overdue: false,
  payments: [{ seq: 1, amountMinor: '2000', receivedOn: '2026-10-25', method: 'bank_transfer' }],
  credits: [],
  supplier: {
    legalName: 'Corridra Pte Ltd',
    address: '101 Robinson Road, Singapore 180239',
    country: 'SG',
    uen: '202600000A (madeup)',
    gstRegistrationNo: 'M9-0000000-0 (madeup)',
  },
  billTo: { name: 'Acme Apparel Pte Ltd', address: '1 Raffles Place, Singapore 048616' },
  paymentInstructions:
    'Pay by bank transfer to Corridra Pte Ltd, account 000-000000-0 (madeup), quoting the invoice number',
  madeupFields: ['uen', 'gst_registration_no', 'gst_registered', 'payment_instructions'],
  label: null,
  moneyDomain: 'B',
  synthetic: false,
  ...over,
});
const balance = (over: Record<string, unknown> = {}) => ({
  currency: 'SGD',
  invoicedMinor: '10900',
  paidMinor: '2000',
  creditedMinor: '0',
  outstandingMinor: '8900',
  overdueMinor: '0',
  ...over,
});
const invoicingBody = (over: Record<string, unknown> = {}) => ({
  workspaceId,
  canRead: true,
  invoicesExist: true,
  invoices: [invoice()],
  balances: [balance()],
  paymentTaken: false,
  synthetic: false,
  expiresAt: expiresAt(),
  ...over,
});
type Reply = { status?: number; json?: unknown };
async function serve(page: Page, handler: (url: URL) => Reply) {
  await page.route('**/api/customer-billing**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.method()).toBe('GET');
    expect(request.headers()['x-corridra-customer-subject']).toBe('real-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    expect(url.searchParams.get('scope')).toBe('invoices');
    expect(url.searchParams.get('workspaceId')).toBe(workspaceId);
    const reply = handler(url);
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
  });
}
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);

test('an owner reads a real tax invoice with both parties, the tax lines, payments and credit notes', async ({
  page,
}) => {
  await serve(page, () => ({
    json: invoicingBody({
      invoices: [
        invoice({
          credits: [
            {
              seq: 1,
              number: 'CN-2026-000001',
              amountMinor: '500',
              issuedOn: '2026-10-26',
              reason: 'Goodwill credit for a late start',
            },
          ],
          creditedMinor: '500',
          outstandingMinor: '8400',
          paidMinor: '2000',
        }),
        invoice({
          id: randomUUID(),
          number: 'INV-2026-000002',
          currency: 'BDT',
          planFeeMinor: '480000',
          amountExcludingTaxMinor: '480000',
          taxMinor: '0',
          taxRateBps: null,
          gstRegistered: false,
          title: 'Invoice',
          totalMinor: '480000',
          paidMinor: '0',
          outstandingMinor: '480000',
          status: 'unpaid',
          payments: [],
          madeupFields: [],
          supplier: {
            legalName: 'Corridra Pte Ltd',
            address: '101 Robinson Road, Singapore 180239',
            country: 'SG',
            uen: '202600001B',
            gstRegistrationNo: null,
          },
          paymentInstructions: 'Pay by bank transfer, quoting the invoice number',
        }),
      ],
      balances: [
        balance({ creditedMinor: '500', outstandingMinor: '8400' }),
        balance({
          currency: 'BDT',
          invoicedMinor: '480000',
          paidMinor: '0',
          outstandingMinor: '480000',
        }),
      ],
    }),
  }));
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible();
  const totals = page.getByRole('region', { name: 'What is still to pay' });
  await expect(totals.getByRole('row')).toHaveCount(3);
  await expect(totals.getByText(/Currencies are never added together or converted/)).toBeVisible();
  const taxInvoice = page.getByRole('listitem').filter({ hasText: 'Tax Invoice INV-2026-000001' });
  await expect(
    taxInvoice.getByRole('heading', { name: 'Tax Invoice INV-2026-000001' }),
  ).toBeVisible();
  await expect(taxInvoice.getByText('Corridra Pte Ltd', { exact: true })).toBeVisible();
  await expect(taxInvoice.getByText(/101 Robinson Road, Singapore 180239/)).toBeVisible();
  await expect(
    taxInvoice.getByText(/Company registration \(UEN\): 202600000A \(madeup\)/),
  ).toBeVisible();
  await expect(taxInvoice.getByText(/GST registration: M9-0000000-0 \(madeup\)/)).toBeVisible();
  await expect(taxInvoice.getByText('Acme Apparel Pte Ltd')).toBeVisible();
  await expect(taxInvoice.getByText(/Issued 24 October 2026 · Due 23 November 2026/)).toBeVisible();
  await expect(taxInvoice.getByText(/GST at 9%/)).toBeVisible();
  await expect(taxInvoice.getByRole('row', { name: /Total.*SGD\s109\.00/ })).toBeVisible();
  await expect(taxInvoice.getByText('Partly paid', { exact: true })).toBeVisible();
  await expect(taxInvoice.getByText(/Contains made-up organisation data \(madeup\)/)).toBeVisible();
  await expect(
    taxInvoice.getByText(/not a valid tax invoice until the supplier details are real/),
  ).toBeVisible();
  await taxInvoice.getByText('Payments and credit notes for INV-2026-000001').click();
  await expect(
    taxInvoice.getByText(/SGD\s20\.00 on 25 October 2026 · Bank transfer/),
  ).toBeVisible();
  await expect(taxInvoice.getByText(/CN-2026-000001: SGD\s5\.00 on 26 October 2026/)).toBeVisible();
  await expect(taxInvoice.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();
  // A supplier that is not GST registered issues a plain invoice with no registration line and no made-up notice.
  const plain = page.getByRole('listitem').filter({ hasText: 'Invoice INV-2026-000002' });
  await expect(plain.getByRole('heading', { name: 'Invoice INV-2026-000002' })).toBeVisible();
  await expect(plain.getByText(/GST registration/)).toHaveCount(0);
  await expect(plain.getByText(/made-up organisation data/)).toHaveCount(0);
  // Real invoices never carry sample wording, and a customer can only read and print them.
  await expect(page.getByText(/sample/i)).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});

test('a member only learns whether invoices exist, and an empty workspace says so plainly', async ({
  page,
}) => {
  let body: Record<string, unknown> = invoicingBody({ canRead: false, invoices: [], balances: [] });
  await serve(page, () => ({ json: body }));
  await page.goto(origin + '/');
  await expect(
    page.getByText('This workspace has invoices. Only a workspace owner or admin can read them.'),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'What is still to pay' })).toHaveCount(0);
  body = invoicingBody({ invoicesExist: false, invoices: [], balances: [] });
  await page.reload();
  await expect(page.getByText('No invoices yet')).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('switched off shows nothing, access refused says so, and a malformed answer is refused', async ({
  page,
}) => {
  await serve(page, () => ({ status: 503, json: { error: 'off' } }));
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toHaveCount(0);
  await page.unroute('**/api/customer-billing**');
  await serve(page, () => ({ status: 403, json: {} }));
  await page.reload();
  await expect(page.getByText('Access required')).toBeVisible();
  await page.unroute('**/api/customer-billing**');
  // An answer that says a payment was taken, or that it is sample data, or is for another workspace, is not shown.
  await serve(page, () => ({ json: invoicingBody({ paymentTaken: true }) }));
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('INV-2026-000001')).toHaveCount(0);
  await page.unroute('**/api/customer-billing**');
  await serve(page, () => ({ json: invoicingBody({ synthetic: true }) }));
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/customer-billing**');
  await serve(page, () => ({ json: invoicingBody({ workspaceId: randomUUID() }) }));
  await page.reload();
  await expect(page.getByText(/did not match the workspace you opened/)).toBeVisible();
});
