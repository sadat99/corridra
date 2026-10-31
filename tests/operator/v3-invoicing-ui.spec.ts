import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. The restricted database authority has its own integration acceptance.
const issuer =
  'https://ep-invoicing-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-0000000000a1';
const subscriptionId = '00000000-0000-4000-8000-0000000000b2';
const invoiceId = '00000000-0000-4000-8000-0000000000c3';
const tenant = '00000000-0000-4000-8000-0000000000d4';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {InvoicesSection} from ${JSON.stringify(resolve('apps/web/app/account/billing/invoices-section.tsx'))};
import {CustomerInvoicing} from ${JSON.stringify(resolve('apps/web/app/operator/customer-invoicing.tsx'))};
const q=new URLSearchParams(location.search),subject='synthetic-alice',issuer=${JSON.stringify(issuer)},workspaceId=${JSON.stringify(workspaceId)};
const view=q.get('view');
const el=view==='staff'?<CustomerInvoicing tenant={${JSON.stringify(tenant)}}/>
:<InvoicesSection subject={subject} issuer={issuer} workspaceId={workspaceId}/>;
createRoot(document.getElementById('fixture')).render(el);`,
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
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sample invoice fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Sample invoice fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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
  number: 'SAMPLE-INV-000001',
  subscriptionId,
  workspaceId,
  planKey: 'example-organiser',
  planVersion: 1,
  planTitle: 'Organiser monthly (sample plan)',
  interval: 'month',
  periodStart: '2026-10-23',
  periodEnd: '2026-11-23',
  issueDate: '2026-10-23',
  dueDate: '2026-11-06',
  currency: 'USD',
  taxTreatment: 'price_excludes_tax',
  planFeeMinor: '4900',
  taxMinor: '490',
  totalMinor: '5390',
  paidMinor: '1000',
  creditedMinor: '0',
  outstandingMinor: '4390',
  status: 'partly_paid',
  overdue: false,
  payments: [{ seq: 1, amountMinor: '1000', receivedOn: '2026-10-24', method: 'bank_transfer' }],
  credits: [],
  moneyDomain: 'B',
  label: 'Sample record, not a tax invoice',
  synthetic: true,
  ...over,
});
const balance = (over: Record<string, unknown> = {}) => ({
  currency: 'USD',
  invoicedMinor: '5390',
  paidMinor: '1000',
  creditedMinor: '0',
  outstandingMinor: '4390',
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
  synthetic: true,
  expiresAt: expiresAt(),
  ...over,
});
type Reply = { status?: number; json?: unknown };
async function serve(page: Page, handler: (url: URL) => Reply) {
  await page.route('**/api/customer-billing**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.method()).toBe('GET');
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
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

test('an owner reads the totals per currency and each invoice with its payments and credit notes, and no staff field', async ({
  page,
}) => {
  await serve(page, () => ({
    json: invoicingBody({
      invoices: [
        invoice({
          id: randomUUID(),
          number: 'SAMPLE-INV-000002',
          currency: 'BDT',
          planFeeMinor: '480000',
          taxMinor: null,
          taxTreatment: 'tax_to_be_confirmed',
          totalMinor: '480000',
          paidMinor: '0',
          outstandingMinor: '480000',
          status: 'unpaid',
          payments: [],
        }),
        invoice({
          credits: [
            {
              seq: 1,
              number: 'SAMPLE-CN-000001',
              amountMinor: '300',
              issuedOn: '2026-10-25',
              reason: 'Synthetic credit for a rehearsal correction',
            },
          ],
          creditedMinor: '300',
          outstandingMinor: '4090',
        }),
      ],
      balances: [
        balance({
          currency: 'BDT',
          invoicedMinor: '480000',
          paidMinor: '0',
          outstandingMinor: '480000',
        }),
        balance({ creditedMinor: '300', outstandingMinor: '4090' }),
      ],
    }),
  }));
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible();
  await expect(page.getByText(/Invoices here are samples, not tax invoices/)).toBeVisible();
  const totals = page.getByRole('region', { name: 'What is still to pay' });
  await expect(totals.getByRole('row')).toHaveCount(3);
  await expect(totals.getByText('USD 40.90')).toBeVisible();
  await expect(totals.getByText(/Currencies are never added together or converted/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /SAMPLE-INV-000002/ })).toBeVisible();
  await expect(page.getByText(/Tax to be confirmed, so no tax is added yet/)).toBeVisible();
  await expect(page.getByText('Unpaid', { exact: true })).toBeVisible();
  await expect(page.getByText('Partly paid', { exact: true })).toBeVisible();
  await expect(page.getByText(/Tax added USD\s4\.90/)).toBeVisible();
  await expect(
    page
      .getByText(
        /For 23 October 2026 until 23 November 2026. Issued 23 October 2026, due 6 November 2026/,
      )
      .first(),
  ).toBeVisible();
  await page.getByText('Payments and credit notes for SAMPLE-INV-000001').click();
  await expect(page.getByText(/USD\s10\.00 on 24 October 2026 · Bank transfer/)).toBeVisible();
  await expect(page.getByText(/SAMPLE-CN-000001: USD\s3\.00 on 25 October 2026/)).toBeVisible();
  await expect(page.getByText(/Synthetic credit for a rehearsal correction/)).toBeVisible();
  // Customers never see a reference, who recorded a change, or any way to act on an invoice.
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});

test('a member only learns whether invoices exist, and an empty workspace says so plainly', async ({
  page,
}) => {
  let body: Record<string, unknown> = invoicingBody({
    canRead: false,
    invoices: [],
    balances: [],
  });
  await serve(page, () => ({ json: body }));
  await page.goto(origin + '/');
  await expect(
    page.getByText('This workspace has invoices. Only a workspace owner or admin can read them.'),
  ).toBeVisible();
  await expect(page.getByText('SAMPLE-INV-000001')).toHaveCount(0);
  body = invoicingBody({ canRead: false, invoicesExist: false, invoices: [], balances: [] });
  await page.reload();
  await expect(page.getByText(/There are none yet/)).toBeVisible();
  body = invoicingBody({ invoicesExist: false, invoices: [], balances: [] });
  await page.reload();
  await expect(page.getByText('No invoices yet')).toBeVisible();
  await expect(page.getByText(/once a paid plan period has started/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('overdue is shown beside the status and the section holds at four widths', async ({
  page,
}) => {
  await serve(page, () => ({
    json: invoicingBody({
      invoices: [invoice({ status: 'unpaid', overdue: true, paidMinor: '0', payments: [] })],
      balances: [balance({ paidMinor: '0', outstandingMinor: '5390', overdueMinor: '5390' })],
    }),
  }));
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + '/');
    await expect(page.getByText('Overdue', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Unpaid', { exact: true })).toBeVisible();
    const horizontal = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(horizontal).toBe(false);
    expect(await axe(page)).toEqual([]);
  }
});

test('off, denied, failed and mismatched answers are calm and safe', async ({ page }) => {
  let reply: Reply = { status: 503 };
  await serve(page, () => reply);
  await page.goto(origin + '/');
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toHaveCount(0);
  reply = { status: 403 };
  await page.reload();
  await expect(page.getByText('Access required')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('You no longer have access here');
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  reply = { status: 500 };
  await page.reload();
  await expect(page.getByText('Temporarily unavailable')).toBeVisible();
  reply = { json: invoicingBody() };
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: /SAMPLE-INV-000001/ })).toBeVisible();
  reply = { json: invoicingBody({ workspaceId: '00000000-0000-4000-8000-00000000ffff' }) };
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('did not match the workspace you opened');
  await expect(page.getByText('SAMPLE-INV-000001')).toHaveCount(0);
  // A body that claims a payment was taken, or is not a sample, is refused.
  reply = { json: invoicingBody({ paymentTaken: true }) };
  await page.reload();
  await expect(page.getByText('Temporarily unavailable')).toBeVisible();
  reply = { json: invoicingBody({ synthetic: false }) };
  await page.reload();
  await expect(page.getByText('Temporarily unavailable')).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

// Staff side. Routes are mocked per scope; the restricted database authority has its own integration acceptance.
const period = (over: Record<string, unknown> = {}) => ({
  subscriptionId,
  workspaceId,
  workspaceName: 'Synthetic invoicing workspace',
  planKey: 'example-organiser',
  planVersion: 1,
  planTitle: 'Organiser monthly (sample plan)',
  interval: 'month',
  periodStart: '2026-10-23',
  periodEnd: '2026-11-23',
  priceMinor: '4900',
  currency: 'USD',
  taxTreatment: 'price_excludes_tax',
  subscriptionStatus: 'active',
  ...over,
});
const staffInvoice = (over: Record<string, unknown> = {}) =>
  invoice({
    workspaceName: 'Synthetic invoicing workspace',
    position: 1,
    payments: [
      {
        seq: 1,
        amountMinor: '1000',
        receivedOn: '2026-10-24',
        method: 'bank_transfer',
        reference: 'Synthetic transfer reference 0001',
      },
    ],
    ...over,
  });
type Staff = {
  periods?: Record<string, unknown>[];
  invoices?: Record<string, unknown>[];
  detail?: Record<string, unknown>;
  post?: (body: Record<string, unknown>) => Reply;
  status?: number;
};
async function serveStaff(page: Page, staff: Staff) {
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/workspace/customer-billing**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(url.searchParams.get('tenant')).toBe(tenant);
    if (staff.status) return route.fulfill({ status: staff.status, json: {} });
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      posts.push(body);
      const reply = staff.post?.(body) ?? {};
      if (reply.status === 0) return route.abort();
      return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
    }
    const scope = url.searchParams.get('scope');
    if (scope === 'pending')
      return route.fulfill({ json: { periods: staff.periods ?? [], synthetic: true } });
    if (scope === 'invoices')
      return route.fulfill({
        json: { invoices: staff.invoices ?? [], nextAfter: null, synthetic: true },
      });
    if (scope === 'invoice') {
      expect(url.searchParams.get('invoiceId')).toBe(invoiceId);
      return route.fulfill({ json: staff.detail ?? {} });
    }
    return route.fulfill({ status: 400, json: {} });
  });
  return posts;
}

test('staff prepare an invoice for a period and send the exact amounts once, with tax stated for the plan', async ({
  page,
}) => {
  let issued = false;
  const posts = await serveStaff(page, {
    periods: [period()],
    post: () => {
      issued = true;
      return {
        json: staffInvoice({ paidMinor: '0', payments: [], status: 'unpaid', position: 0 }),
      };
    },
    get invoices() {
      return issued ? [staffInvoice()] : [];
    },
    detail: {
      invoice: staffInvoice(),
      actions: ['payment', 'credit'],
      workspaceBalances: [balance()],
    },
  } as Staff);
  await page.goto(origin + '/?view=staff');
  await expect(page.getByRole('heading', { name: 'Customer sample invoices' })).toBeVisible();
  await expect(page.getByText('No invoice has been issued.')).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Prepare invoice for Synthetic invoicing workspace, 23 October 2026',
    })
    .click();
  const form = page.getByRole('form', { name: 'Issue invoice' });
  await expect(form.getByText(/Plan fee USD\s49\.00 \(set by the plan\)/)).toBeVisible();
  await expect(
    form.getByText(/price excludes tax, so the tax you state is added to the total/),
  ).toBeVisible();
  await form.getByLabel(/Tax amount in USD minor units/).fill('490');
  await form.getByLabel(/Due on/).fill('2026-11-06');
  expect(await axe(page)).toEqual([]);
  await form.getByRole('button', { name: 'Issue sample invoice' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    action: 'issue',
    subscriptionId,
    periodStart: '2026-10-23',
    planFeeMinor: '4900',
    taxMinor: '490',
    dueOn: '2026-11-06',
  });
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'commandId',
    'dueOn',
    'periodStart',
    'planFeeMinor',
    'subscriptionId',
    'taxMinor',
  ]);
  await expect(page.getByRole('region', { name: 'Invoice detail' })).toBeVisible();
});

test('a plan whose tax is to be confirmed has no tax field and sends no tax amount', async ({
  page,
}) => {
  const posts = await serveStaff(page, {
    periods: [
      period({
        planKey: 'example-organiser-bdt',
        planTitle: 'Organiser monthly in taka (sample plan)',
        priceMinor: '480000',
        currency: 'BDT',
        taxTreatment: 'tax_to_be_confirmed',
      }),
    ],
    post: () => ({ json: staffInvoice({ currency: 'BDT', taxMinor: null }) }),
    detail: {
      invoice: staffInvoice({ currency: 'BDT', taxMinor: null }),
      actions: ['payment', 'credit'],
      workspaceBalances: [],
    },
  });
  await page.goto(origin + '/?view=staff');
  await page.getByRole('button', { name: /Prepare invoice for/ }).click();
  const form = page.getByRole('form', { name: 'Issue invoice' });
  await expect(form.getByLabel(/Tax amount/)).toHaveCount(0);
  await expect(form.getByText(/tax is to be confirmed, so no tax amount is stated/)).toBeVisible();
  await form.getByRole('button', { name: 'Issue sample invoice' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts[0]).toMatchObject({ planFeeMinor: '480000', taxMinor: null });
});

test('staff record a payment naming the position they saw, and a lost answer is retried with the same command id', async ({
  page,
}) => {
  let tries = 0;
  const posts = await serveStaff(page, {
    invoices: [staffInvoice()],
    detail: {
      invoice: staffInvoice(),
      actions: ['payment', 'credit'],
      workspaceBalances: [balance()],
    },
    post: () => {
      tries += 1;
      return tries === 1 ? { status: 0 } : { json: staffInvoice({ position: 2 }) };
    },
  });
  await page.goto(origin + '/?view=staff');
  await page.getByRole('button', { name: 'Open SAMPLE-INV-000001' }).click();
  const detail = page.getByRole('region', { name: 'Invoice detail' });
  await expect(detail.getByText(/Payment USD\s10\.00/)).toBeVisible();
  await expect(detail.getByText(/Synthetic transfer reference 0001/)).toBeVisible();
  const form = page.getByRole('form', { name: 'Record payment' });
  await form.getByLabel(/Amount received/).fill('2000');
  const received = new Date().toISOString().slice(0, 10);
  await form.getByLabel('Received on').fill(received);
  await form.getByLabel('How').selectOption('cash');
  await form.getByLabel(/Reference/).fill('Synthetic cash handover 0002');
  // The two forms keep their own fields.
  await expect(page.getByLabel(/Credit amount/)).toHaveValue('');
  await expect(page.getByLabel(/Reason the customer reads/)).toHaveValue('Synthetic ');
  expect(await axe(page)).toEqual([]);
  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not confirm that this was saved');
  await form.getByRole('button', { name: 'Send the same payment again' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts).toHaveLength(2);
  expect(posts[1]!.commandId).toBe(posts[0]!.commandId);
  expect(posts[0]).toMatchObject({
    action: 'payment',
    invoiceId,
    expectedPosition: 1,
    amountMinor: '2000',
    receivedOn: received,
    method: 'cash',
    reference: 'Synthetic cash handover 0002',
  });
});

test('a credit note asks for a reason, is marked destructive, and a settled invoice offers no more changes', async ({
  page,
}) => {
  const posts = await serveStaff(page, {
    invoices: [staffInvoice()],
    detail: {
      invoice: staffInvoice(),
      actions: ['payment', 'credit'],
      workspaceBalances: [balance()],
    },
    post: () => ({ json: staffInvoice({ creditedMinor: '300', outstandingMinor: '4090' }) }),
  });
  await page.goto(origin + '/?view=staff');
  await page.getByRole('button', { name: 'Open SAMPLE-INV-000001' }).click();
  const form = page.getByRole('form', { name: 'Issue credit note' });
  await form.getByLabel(/Credit amount/).fill('300');
  await form
    .getByLabel(/Reason the customer reads/)
    .fill('Synthetic credit for a rehearsal correction');
  const submit = form.getByRole('button', { name: 'Issue credit note' });
  await expect(submit).toHaveAttribute('data-intent', 'destructive');
  await submit.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(posts[0]).toMatchObject({
    action: 'credit',
    invoiceId,
    expectedPosition: 1,
    amountMinor: '300',
    reason: 'Synthetic credit for a rehearsal correction',
  });
  // Nothing outstanding: no forms.
  await page.unroute('**/api/workspace/customer-billing**');
  await serveStaff(page, {
    invoices: [staffInvoice({ status: 'paid', outstandingMinor: '0', paidMinor: '5390' })],
    detail: {
      invoice: staffInvoice({ status: 'paid', outstandingMinor: '0', paidMinor: '5390' }),
      actions: [],
      workspaceBalances: [],
    },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Open SAMPLE-INV-000001' }).click();
  await expect(
    page.getByText('Nothing is outstanding, so no payment or credit can be added.'),
  ).toBeVisible();
  await expect(page.getByRole('form', { name: 'Record payment' })).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'Issue credit note' })).toHaveCount(0);
});

test('staff denial is plain and an unavailable module leaves no panel', async ({ page }) => {
  await serveStaff(page, { status: 403 });
  await page.goto(origin + '/?view=staff');
  await expect(page.getByRole('alert')).toContainText('fresh authenticator check is required');
  await page.unroute('**/api/workspace/customer-billing**');
  await serveStaff(page, { status: 503 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Customer sample invoices' })).toHaveCount(0);
});
