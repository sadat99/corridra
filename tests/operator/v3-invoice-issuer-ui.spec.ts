import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// ADR-092 (unit B8). Explicit UI protocol fixtures for the Owner-only Invoice issuer screen. The database authority has
// its own acceptance in tests/integration/customer-invoicing-real-issuer.test.ts.
const tenant = '00000000-0000-4000-8000-0000000000d4';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {InvoiceIssuerForm} from ${JSON.stringify(resolve('apps/web/app/operator/invoice-issuer/invoice-issuer-form.tsx'))};
createRoot(document.getElementById('fixture')).render(<InvoiceIssuerForm tenant={${JSON.stringify(tenant)}}/>);`,
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
  // The browser bundle carries the sign-in client only (it checks the authenticator code), never server authority code.
  expect(
    Object.keys(result.metafile!.inputs).filter(
      (path) => path.includes('packages/') && !path.includes('node_modules'),
    ),
  ).toEqual(['packages/auth/src/client.ts']);
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
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice issuer fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Invoice issuer</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const real = {
  legalName: 'Corridra Pte Ltd',
  address: '8 Marina View, Asia Square Tower 1, Singapore 018960',
  uen: '202612345K',
  gstRegistered: true,
  gstRegistrationNo: 'M2-1234567-8',
  paymentInstructions:
    'Pay by bank transfer to Corridra Pte Ltd, DBS Bank, account 072-123456-7, quoting the invoice number',
  financeLabel: 'Corridra finance desk',
};
const seeded = (over: Record<string, unknown> = {}) => ({
  version: 1,
  complete: false,
  enteredByOwner: false,
  savedAt: '2026-11-17T04:10:00.000Z',
  madeupFields: [
    'uen',
    'gst_registration_no',
    'gst_registered',
    'payment_instructions',
    'finance_label',
  ],
  details: {
    legalName: 'Corridra Pte Ltd',
    address: '101 Robinson Road, Singapore 180239',
    uen: null,
    gstRegistered: null,
    gstRegistrationNo: null,
    paymentInstructions: null,
    financeLabel: null,
  },
  fixed: {
    country: 'SG',
    taxLabel: 'GST',
    gstRateBps: 900,
    paymentTermsDays: 30,
    rateWhenRegisteredBps: 900,
    rateWhenNotRegisteredBps: 0,
  },
  realInvoicesOpen: false,
  synthetic: false,
  ...over,
});
const completed = (over: Record<string, unknown> = {}) =>
  seeded({
    version: 2,
    complete: true,
    enteredByOwner: true,
    savedAt: '2026-11-23T16:30:00.000Z',
    madeupFields: [],
    details: real,
    ...over,
  });
type Reply = { status?: number; json?: unknown };
type Seen = { method: string; query: URLSearchParams; body: Record<string, unknown> | null };
type Fixture = {
  seen: Seen[];
  verifies: Record<string, unknown>[];
  order: string[];
  view: unknown;
};
async function serve(
  page: Page,
  options: {
    view?: unknown;
    read?: () => Reply;
    save?: (body: Record<string, unknown>, fixture: Fixture) => Reply;
    verify?: () => Reply;
  } = {},
) {
  const fixture: Fixture = { seen: [], verifies: [], order: [], view: options.view ?? seeded() };
  await page.route('**/operator/invoice-issuer/details**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(url.searchParams.get('tenant')).toBe(tenant);
    const body =
      request.method() === 'POST' ? (request.postDataJSON() as Record<string, unknown>) : null;
    fixture.seen.push({ method: request.method(), query: url.searchParams, body });
    fixture.order.push(request.method() === 'POST' ? 'save' : 'read');
    if (body) {
      expect(request.headers()['content-type']).toContain('application/json');
      const reply = options.save
        ? options.save(body, fixture)
        : {
            json: {
              state: 'saved',
              version: 2,
              complete: true,
              changedFields: [],
              madeupFields: [],
            },
          };
      return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
    }
    const reply = options.read ? options.read() : { json: fixture.view };
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
  });
  await page.route('**/api/operator-auth/two-factor/verify-totp', (route) => {
    fixture.verifies.push(route.request().postDataJSON() as Record<string, unknown>);
    fixture.order.push('verify');
    const reply = options.verify
      ? options.verify()
      : { json: { token: 'fixture-session', user: { id: 'fixture-user' } } };
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
  });
  return fixture;
}
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);
const posts = (fixture: Fixture) => fixture.seen.filter((x) => x.method === 'POST');
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
const stepHeading = (page: Page, text: string) =>
  page.getByRole('heading', { level: 2, name: text, exact: true });
// Types every answer and stops on the last step, before the code.
async function fillAll(page: Page, registered = true) {
  await expect(stepHeading(page, 'Step 1 of 4: Company')).toBeVisible();
  await page.getByLabel('Legal name', { exact: true }).fill(real.legalName);
  await page.getByLabel('Company registration number (UEN)', { exact: true }).fill(real.uen);
  await page.getByLabel('Registered address', { exact: true }).fill(real.address);
  await next(page).click();
  await expect(stepHeading(page, 'Step 2 of 4: GST')).toBeVisible();
  if (registered) {
    await page.getByText('Yes, GST registered', { exact: true }).click();
    await page.getByLabel('GST registration number', { exact: true }).fill(real.gstRegistrationNo);
  } else await page.getByText('No, not GST registered', { exact: true }).click();
  await next(page).click();
  await expect(stepHeading(page, 'Step 3 of 4: Payment')).toBeVisible();
  await page.getByLabel('Payment instructions', { exact: true }).fill(real.paymentInstructions);
  await page.getByLabel('Finance contact label', { exact: true }).fill(real.financeLabel);
  await next(page).click();
  await expect(stepHeading(page, 'Step 4 of 4: Check And Save')).toBeVisible();
}
const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save Issuer Details', exact: true });
const codeField = (page: Page) => page.getByLabel('Authenticator code', { exact: true });

test('the owner sees what is still needed, real values are filled in and no made-up value is shown', async ({
  page,
}) => {
  const fixture = await serve(page);
  await page.goto(origin + '/');
  const status = page.locator('#issuer-status');
  await expect(status).toContainText(
    '5 details are still needed: company registration number (UEN), GST status, GST registration number, payment instructions, finance contact label.',
  );
  await expect(status).toContainText(
    'Saving here does not switch real invoices on. Real invoices are switched off.',
  );
  await expect(stepHeading(page, 'Step 1 of 4: Company')).toBeVisible();
  await expect(page.getByLabel('Legal name', { exact: true })).toHaveValue('Corridra Pte Ltd');
  await expect(page.getByLabel('Registered address', { exact: true })).toHaveValue(
    '101 Robinson Road, Singapore 180239',
  );
  await expect(page.getByLabel('Company registration number (UEN)', { exact: true })).toHaveValue(
    '',
  );
  await expect(page.locator('#fixture')).not.toContainText(/madeup|synthetic|draft/i);
  // One read, with the workspace named, and nothing written.
  expect(fixture.order).toEqual(['read']);
  expect(await axe(page)).toEqual([]);
});

test('each step checks its own answers before the next one opens', async ({ page }) => {
  const fixture = await serve(page);
  await page.goto(origin + '/');
  await next(page).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Enter the company registration number (UEN), 3 to 60 characters.',
  );
  const uen = page.getByLabel('Company registration number (UEN)', { exact: true });
  await expect(uen).toHaveAttribute('aria-invalid', 'true');
  await expect(uen).toBeFocused();
  await expect(stepHeading(page, 'Step 1 of 4: Company')).toBeVisible();
  await uen.fill('202600000A (madeup)');
  await next(page).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Remove the text "(madeup)" and enter the real value.',
  );
  await uen.fill(real.uen);
  await page.getByLabel('Registered address', { exact: true }).fill('See www.corridra.com');
  await next(page).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Use plain words only, with no links or email addresses.',
  );
  await page.getByLabel('Registered address', { exact: true }).fill(real.address);
  await next(page).click();
  await expect(stepHeading(page, 'Step 2 of 4: GST')).toBeVisible();
  await next(page).click();
  await expect(page.getByRole('alert')).toHaveText('Choose whether the company is GST registered.');
  await page.getByText('Yes, GST registered', { exact: true }).click();
  await expect(page.locator('#issuer-gstRegistrationNo-help')).toHaveText(
    'Invoices will show 9% GST, the Singapore standard rate. You do not type the rate.',
  );
  await next(page).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Enter the GST registration number, 3 to 60 characters.',
  );
  // Not registered asks for no number.
  await page.getByText('No, not GST registered', { exact: true }).click();
  await expect(page.getByLabel('GST registration number', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Invoices will show a tax rate of 0%, no GST is charged.'),
  ).toBeVisible();
  await next(page).click();
  await expect(stepHeading(page, 'Step 3 of 4: Payment')).toBeVisible();
  await next(page).click();
  await expect(page.getByRole('alert').first()).toHaveText(
    'Enter the payment instructions, 5 to 400 characters.',
  );
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(stepHeading(page, 'Step 2 of 4: GST')).toBeVisible();
  await expect(page.getByLabel('No, not GST registered', { exact: true })).toBeChecked();
  expect(fixture.order).toEqual(['read']);
});

test('saving checks the authenticator code first, then sends the details once and never the code', async ({
  page,
}) => {
  const fixture = await serve(page, {
    save: (_body, f) => {
      f.view = completed();
      return {
        json: {
          state: 'saved',
          version: 2,
          complete: true,
          changedFields: ['uen'],
          madeupFields: [],
          synthetic: false,
        },
      };
    },
  });
  await page.goto(origin + '/');
  await fillAll(page);
  // The last step shows every answer before the save.
  const summary = page.locator('#issuer-summary');
  for (const value of [
    real.legalName,
    real.uen,
    real.address,
    'GST registered',
    real.gstRegistrationNo,
    // The tax rate is derived from the GST answer and shown before the save; it is never typed.
    'Tax rate on invoices',
    '9% GST, the Singapore standard rate',
    real.paymentInstructions,
    real.financeLabel,
  ])
    await expect(summary).toContainText(value);
  expect(await axe(page)).toEqual([]);
  // No code: nothing is checked and nothing is sent.
  await saveButton(page).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Enter the six-digit code from your authenticator app.',
  );
  await expect(codeField(page)).toBeFocused();
  expect(fixture.order).toEqual(['read']);
  await codeField(page).fill('123456');
  await saveButton(page).click();
  await expect(page.locator('#issuer-result')).toHaveText(
    'Saved. Issuer details are complete. Real invoices stay off until they are switched on separately.',
  );
  expect(fixture.order).toEqual(['read', 'verify', 'save', 'read']);
  expect(fixture.verifies).toEqual([{ code: '123456', trustDevice: false }]);
  const sent = posts(fixture)[0]!.body!;
  // Exactly the typed details: the rate is written by the database, never sent.
  expect(sent).toEqual({ commandId: sent.commandId, expectedVersion: 1, ...real });
  expect(JSON.stringify(sent)).not.toMatch(/rate/i);
  expect(String(sent.commandId)).toMatch(uuid);
  await expect(page.locator('#issuer-status')).toContainText(
    'Issuer details are complete. Typed by the owner and saved on 23 Nov 2026.',
  );
  // The code is not kept on the page.
  await expect(page.locator('#fixture')).not.toContainText('123456');
});

test('where the screen does not set the tax rate, no rate is promised on the last step', async ({
  page,
}) => {
  // Before the rate install, or for an issuer outside Singapore GST, the view carries no rate for either answer.
  await serve(page, {
    view: seeded({
      fixed: { country: 'SG', taxLabel: 'GST', gstRateBps: 900, paymentTermsDays: 30 },
    }),
  });
  await page.goto(origin + '/');
  await fillAll(page);
  await expect(page.locator('#issuer-summary')).toContainText('GST registered');
  await expect(page.locator('#issuer-summary')).not.toContainText('Tax rate on invoices');
});

test('a wrong code sends nothing and keeps every answer; an unregistered company sends no GST number', async ({
  page,
}) => {
  let accept = false;
  const fixture = await serve(page, {
    verify: () =>
      accept
        ? { json: { token: 'fixture-session', user: { id: 'fixture-user' } } }
        : { status: 401, json: { code: 'INVALID_CODE', message: 'Invalid code' } },
  });
  await page.goto(origin + '/');
  await fillAll(page, false);
  await codeField(page).fill('000000');
  await saveButton(page).click();
  await expect(page.getByRole('alert')).toHaveText(
    'That code was not accepted. Enter the current code from your authenticator app.',
  );
  await expect(codeField(page)).toHaveAttribute('aria-invalid', 'true');
  expect(posts(fixture)).toHaveLength(0);
  await expect(page.locator('#issuer-summary')).toContainText('Not GST registered');
  await expect(page.locator('#issuer-summary')).toContainText(
    'Tax rate on invoices0%, no GST is charged',
  );
  accept = true;
  await codeField(page).fill('654321');
  await saveButton(page).click();
  await expect(page.locator('#issuer-result')).toContainText('Saved.');
  expect(posts(fixture)[0]!.body).toMatchObject({ gstRegistered: false, gstRegistrationNo: null });
});

test('a save that could not be confirmed is sent again under the same command; a refusal says what to do', async ({
  page,
}) => {
  const replies: Reply[] = [
    { status: 500, json: {} },
    { status: 401, json: { error: 'Verify again', code: 'STEP_UP_REQUIRED' } },
    { status: 409, json: { error: 'Changed', code: 'ISSUER_DETAILS_CHANGED' } },
  ];
  const fixture = await serve(page, { save: () => replies.shift() ?? { json: {} } });
  await page.goto(origin + '/');
  await fillAll(page);
  const result = page.locator('#issuer-result');
  const send = async () => {
    await codeField(page).fill('123456');
    await saveButton(page).click();
  };
  await send();
  await expect(result).toHaveText(
    'The save could not be confirmed. Enter a new code and save again. The same save is never applied twice.',
  );
  await send();
  await expect(result).toHaveText(
    'The authenticator check ran out before the save. Enter a new code and save again.',
  );
  await send();
  await expect(result).toContainText(
    'These details changed after you opened this page. Load the latest details and check them again.',
  );
  const [first, second, third] = posts(fixture).map((x) => x.body!.commandId);
  expect(second).toBe(first);
  expect(third).toBe(first);
  // Loading the latest reads again and starts from the first step with what is saved now.
  fixture.view = completed({ version: 3 });
  await page.getByRole('button', { name: 'Load Latest Details', exact: true }).click();
  await expect(stepHeading(page, 'Step 1 of 4: Company')).toBeVisible();
  await expect(page.getByLabel('Company registration number (UEN)', { exact: true })).toHaveValue(
    real.uen,
  );
  await expect(result).toHaveCount(0);
});

test('a person who is not the owner, a missing module and a switched-off screen each get one plain line', async ({
  page,
}) => {
  let status = 403;
  await serve(page, { read: () => ({ status, json: {} }) });
  await page.goto(origin + '/');
  await expect(page.locator('#fixture')).toHaveText(
    'This page is for the workspace owner. Ask the owner to enter the issuer details.',
  );
  status = 503;
  await page.reload();
  await expect(page.locator('#fixture')).toHaveText(
    'The invoice module is not installed here yet. Nothing can be saved.',
  );
  status = 404;
  await page.reload();
  await expect(page.locator('#fixture')).toHaveText('This screen is not switched on.');
  status = 500;
  await page.reload();
  await expect(page.locator('#fixture')).toContainText(
    'The issuer details could not be loaded. Nothing was changed.',
  );
  await expect(page.getByRole('button', { name: 'Try Again', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Issuer Details' })).toHaveCount(0);
});

test('the screen fits a phone without sideways scrolling and keeps 44 px targets', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serve(page);
  await page.goto(origin + '/');
  await fillAll(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  for (const control of [saveButton(page), page.getByRole('button', { name: 'Back', exact: true })])
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('with the screen switch off the page and its data route do not exist', async ({ request }) => {
  // The operator test server does not set CORRIDRA_INVOICE_ISSUER, which is the default everywhere.
  const page = await request.get('/operator/invoice-issuer', { maxRedirects: 0 });
  expect(page.status()).toBe(404);
  expect(await page.text()).not.toContain('Invoice issuer');
  const read = await request.get(`/operator/invoice-issuer/details?tenant=${tenant}`);
  expect(read.status()).toBe(404);
  expect(await read.json()).toEqual({ error: 'Not found' });
  const write = await request.post(`/operator/invoice-issuer/details?tenant=${tenant}`, {
    data: { commandId: tenant, expectedVersion: 1 },
  });
  expect(write.status()).toBe(404);
});
