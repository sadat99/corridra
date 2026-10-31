import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-econ-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000006';
const programmeId = '00000000-0000-4000-8000-000000000007';
const regA = '00000000-0000-4000-8000-0000000000a1';
const regB = '00000000-0000-4000-8000-0000000000a2';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {ProgrammeEconomics} from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-economics.tsx'))};const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)},workspaceId:${JSON.stringify(workspaceId)},programmeId:${JSON.stringify(programmeId)}};const render=p=>{const all={...initial,...p};root.render(<ProgrammeEconomics key={all.issuer+all.subject+all.workspaceId} {...all}/>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
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
  expect(
    Object.keys(result.metafile!.inputs).some((path) => path.includes('packages/auth/src')),
  ).toBe(false);
  const javascript = result.outputFiles[0].text;
  // Use the real compiled global CSS/font class, not unprocessed Tailwind source.
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
  for (const path of cssPaths) expect(path).toMatch(/^\/_next\/static\/chunks\/[\w.-]+\.css$/);
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
    } else if (path === '/' || path === '/account/delegations') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic component protocol fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic component protocol fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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

const costs = (e: string, o: string, c: string, t: string) => ({
  expenses: e,
  obligations: o,
  corridraServiceFees: c,
  total: t,
});
function summary(options: { ttl?: number; empty?: boolean } = {}) {
  return {
    workspaceId,
    programmeId,
    expiresAt: new Date(Date.now() + (options.ttl ?? 60000)).toISOString(),
    provenance: 'ORGANISER_RECORDED',
    verified: false,
    collectsPayments: false,
    currencies: options.empty
      ? []
      : [
          {
            currency: 'BDT',
            exponent: 2,
            feesDue: '9007199254740993',
            paymentsRecorded: '5000000',
            outstanding: '9002199254740993',
            plannedCosts: costs('100000', '50000', '10000', '160000'),
            actualCosts: costs('90000', '0', '10000', '100000'),
            marginIfPlanned: '9007199254580993',
            marginOnActual: '9007199254640993',
            cashMargin: '4900000',
          },
          {
            currency: 'USD',
            exponent: 2,
            feesDue: '250000',
            paymentsRecorded: '250000',
            outstanding: '0',
            plannedCosts: costs('0', '0', '0', '0'),
            actualCosts: costs('300000', '0', '0', '300000'),
            marginIfPlanned: '250000',
            marginOnActual: '-50000',
            cashMargin: '-50000',
          },
        ],
    participants: [
      {
        registrationId: regA,
        label: 'Synthetic Buyer Alpha',
        state: 'ACTIVE',
        amounts: [
          {
            currency: 'BDT',
            exponent: 2,
            due: '9007199254740993',
            recorded: '5000000',
            status: 'PART_PAID',
          },
        ],
      },
      { registrationId: regB, label: 'Synthetic Buyer Beta', state: 'WITHDRAWN', amounts: [] },
    ],
    counts: { registered: 2, active: 1, withdrawnOrRemoved: 1 },
  };
}
const entry = (seq: number, extra: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000001' + String(seq).padStart(2, '0'),
  seq,
  kind: 'PARTICIPANT_FEE',
  costBasis: null,
  registrationId: regA,
  registrationLabel: 'Synthetic Buyer Alpha',
  amountMinor: '9007199254740993',
  currency: 'BDT',
  exponent: 2,
  occurredOn: '2026-10-01',
  description: 'Synthetic participation fee',
  reverseOf: null,
  reversedBy: null,
  provenance: 'ORGANISER_RECORDED',
  recordedAt: '2026-10-01T00:00:00Z',
  ...extra,
});
function list(options: { nextBefore?: number | null; rows?: unknown[]; ttl?: number } = {}) {
  return {
    workspaceId,
    programmeId,
    expiresAt: new Date(Date.now() + (options.ttl ?? 60000)).toISOString(),
    entries: options.rows ?? [
      entry(2),
      entry(1, {
        kind: 'PARTICIPANT_PAYMENT',
        amountMinor: '5000000',
        description: 'Synthetic first receipt',
      }),
    ],
    nextBefore: options.nextBefore ?? null,
  };
}
type Handler = {
  summary?: () => unknown;
  entries?: (url: URL) => unknown;
  post?: (body: Record<string, unknown>) => { status?: number; json: unknown };
  seen?: { headers: Record<string, string>[]; urls: string[] };
};
async function mock(page: Page, handler: Handler = {}) {
  await page.route('**/api/customer-programme-economics**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    handler.seen?.headers.push(request.headers());
    handler.seen?.urls.push(request.url());
    if (request.method() === 'GET')
      return route.fulfill({
        json:
          url.searchParams.get('view') === 'summary'
            ? (handler.summary?.() ?? summary())
            : (handler.entries?.(url) ?? list()),
      });
    const out = handler.post!(request.postDataJSON());
    return route.fulfill({ status: out.status ?? 200, json: out.json });
  });
}
const participantSelect = (page: Page) => page.getByRole('combobox', { name: /^Participant/ });
const recordButton = (page: Page) =>
  page.getByRole('button', { name: 'Record amount', exact: true });
async function fill(page: Page, amount: string, description = 'Synthetic fee for the sample') {
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByLabel('Description (start with Synthetic)').fill(description);
  await page.getByLabel(/I am entering this myself/).check();
}
const ok = (body: Record<string, unknown>) => ({
  json: { workspaceId, programmeId, commandId: body.commandId, replayed: false, entry: entry(3) },
});

test('totals are exact, separate per currency and labelled as organiser bookkeeping', async ({
  page,
}) => {
  await mock(page);
  await page.goto(origin);
  await expect(page.getByText('not verified by Corridra', { exact: false })).toBeVisible();
  await expect(
    page.getByText('does not collect, hold or send any money', { exact: false }),
  ).toBeVisible();
  const bdt = page.getByRole('table', { name: 'BDT' });
  const usd = page.getByRole('table', { name: 'USD' });
  await expect(bdt).toContainText('BDT 90071992547409.93');
  await expect(bdt).toContainText('BDT 50000.00');
  await expect(usd).toContainText('USD -500.00');
  await expect(page.getByRole('table')).toHaveCount(2);
  await expect(
    page.getByText('Part paid: due BDT 90071992547409.93, recorded BDT 50000.00'),
  ).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Synthetic Buyer Beta' }),
  ).toContainText('withdrawn');
  await expect(page.getByText('1 active', { exact: false })).toBeVisible();
});
test('an empty programme explains there is nothing recorded yet', async ({ page }) => {
  await mock(page, { summary: () => summary({ empty: true }), entries: () => list({ rows: [] }) });
  await page.goto(origin);
  await expect(page.getByText('No sample amounts recorded yet.')).toBeVisible();
  await expect(page.getByText('No entries yet.')).toBeVisible();
});
test('a fee is sent as exact minor units with account headers and nothing derived', async ({
  page,
}) => {
  const seen = { headers: [] as Record<string, string>[], urls: [] as string[] };
  let command: Record<string, unknown> | null = null;
  await mock(page, {
    seen,
    post: (body) => {
      command = body;
      return ok(body);
    },
  });
  await page.goto(origin);
  await participantSelect(page).selectOption(regA);
  await fill(page, '1234.50');
  await recordButton(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'No payment was collected' }),
  ).toBeVisible();
  expect(command).toMatchObject({
    workspaceId,
    programmeId,
    acknowledged: true,
    entry: {
      kind: 'PARTICIPANT_FEE',
      costBasis: null,
      registrationId: regA,
      amountMinor: '123450',
      currency: 'BDT',
      description: 'Synthetic fee for the sample',
    },
  });
  expect((command as unknown as { entry: { occurredOn: string } }).entry.occurredOn).toMatch(
    /^\d{4}-\d{2}-\d{2}$/,
  );
  for (const key of ['verified', 'provenance', 'converted', 'total'])
    expect((command as unknown as { entry: object }).entry).not.toHaveProperty(key);
  expect(
    seen.headers.every(
      (h) =>
        h['x-corridra-customer-subject'] === 'synthetic-alice' &&
        h['x-corridra-customer-issuer'] === issuer,
    ),
  ).toBe(true);
  await expect(page.getByLabel(/^Amount/)).toHaveValue('');
});
test('a cost asks planned or actual and never a participant', async ({ page }) => {
  let command: Record<string, unknown> | null = null;
  await mock(page, {
    post: (body) => {
      command = body;
      return ok(body);
    },
  });
  await page.goto(origin);
  await page.getByLabel('What are you recording?').selectOption('ORGANISER_EXPENSE');
  await expect(participantSelect(page)).toHaveCount(0);
  await expect(page.getByRole('group', { name: /planned or has it happened/ })).toBeVisible();
  await page.getByLabel('Actual (incurred)').check();
  await page.getByLabel('Currency').selectOption('JPY');
  await fill(page, '1500', 'Synthetic venue hire');
  await recordButton(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'No payment was collected' }),
  ).toBeVisible();
  expect(command).toMatchObject({
    entry: {
      kind: 'ORGANISER_EXPENSE',
      costBasis: 'ACTUAL',
      registrationId: null,
      amountMinor: '1500',
      currency: 'JPY',
    },
  });
});
test('invalid amounts, wording and missing confirmation are stopped before any request', async ({
  page,
}) => {
  const commands: unknown[] = [];
  await mock(page, {
    post: (body) => {
      commands.push(body);
      return ok(body);
    },
  });
  await page.goto(origin);
  await participantSelect(page).selectOption(regA);
  await page.getByLabel(/^Amount/).fill('12.345');
  await page.getByLabel('Description (start with Synthetic)').fill('Synthetic fee for the sample');
  await page.getByLabel(/I am entering this myself/).check();
  await recordButton(page).click();
  await expect(page.getByRole('alert')).toContainText('decimal places');
  await page.getByLabel(/^Amount/).fill('12.34');
  await page.getByLabel('Description (start with Synthetic)').fill('Real fee');
  await recordButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic');
  await page.getByLabel('Description (start with Synthetic)').fill('Synthetic fee for the sample');
  await page.getByLabel(/I am entering this myself/).uncheck();
  await recordButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Confirm');
  await page.getByLabel(/I am entering this myself/).check();
  await participantSelect(page).selectOption('');
  await recordButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Choose a participant');
  expect(commands).toHaveLength(0);
});
test('a failed save keeps the form and retries with the identical command', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (body) => {
      commands.push(body);
      return commands.length === 1 ? { status: 500, json: { error: 'x' } } : ok(body);
    },
  });
  await page.goto(origin);
  await participantSelect(page).selectOption(regA);
  await fill(page, '10');
  await recordButton(page).click();
  await expect(page.getByRole('alert')).toContainText('try again');
  await expect(page.getByLabel(/^Amount/)).toHaveValue('10');
  await recordButton(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'No payment was collected' }),
  ).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});
test('a changed amount after a failure gets a new command id', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (body) => {
      commands.push(body);
      return commands.length === 1 ? { status: 500, json: { error: 'x' } } : ok(body);
    },
  });
  await page.goto(origin);
  await participantSelect(page).selectOption(regA);
  await fill(page, '10');
  await recordButton(page).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel(/^Amount/).fill('11');
  await recordButton(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'No payment was collected' }),
  ).toBeVisible();
  expect(commands[1].commandId).not.toBe(commands[0].commandId);
});
test('a conflict keeps the draft and explains it', async ({ page }) => {
  await mock(page, {
    post: () => ({
      status: 409,
      json: {
        error:
          'The request conflicts with the current scope or state. Refresh and review it again.',
      },
    }),
  });
  await page.goto(origin);
  await participantSelect(page).selectOption(regA);
  await fill(page, '10');
  await recordButton(page).click();
  await expect(page.getByRole('alert')).toContainText('conflicts');
  await expect(page.getByLabel(/^Amount/)).toHaveValue('10');
});
test('a changed account on save clears every private detail', async ({ page }) => {
  await mock(page, {
    post: () => ({
      status: 409,
      json: { error: 'Your account changed. Reload before continuing.' },
    }),
  });
  await page.goto(origin);
  await participantSelect(page).selectOption(regA);
  await fill(page, '10');
  await recordButton(page).click();
  await expect(page.getByRole('alert')).toContainText('access changed');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('BDT 90071992547409.93')).toHaveCount(0);
  await expect(page.getByText('Synthetic Buyer Alpha')).toHaveCount(0);
});
for (const status of [401, 403])
  test('save ' + status + ' clears private details', async ({ page }) => {
    await mock(page, { post: () => ({ status, json: { error: 'Denied' } }) });
    await page.goto(origin);
    await participantSelect(page).selectOption(regA);
    await fill(page, '10');
    await recordButton(page).click();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByText('Synthetic Buyer Alpha')).toHaveCount(0);
  });
test('read 403 shows a denial with no finances', async ({ page }) => {
  await page.route('**/api/customer-programme-economics**', (route) =>
    route.fulfill({ status: 403, json: { error: 'Access denied or link unavailable' } }),
  );
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('access changed');
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
test('read 503 says the feature is unavailable', async ({ page }) => {
  await page.route('**/api/customer-programme-economics**', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.goto(origin);
  await expect(page.getByRole('status').filter({ hasText: 'unavailable' })).toBeVisible();
});
test('a response for another programme is rejected instead of rendered', async ({ page }) => {
  await mock(page, {
    summary: () => ({ ...summary(), programmeId: '00000000-0000-4000-8000-0000000000ff' }),
  });
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.getByRole('table')).toHaveCount(0);
});
test('a response claiming verification or payment collection is rejected', async ({ page }) => {
  for (const patch of [{ verified: true }, { collectsPayments: true }]) {
    await page.unroute('**/api/customer-programme-economics**').catch(() => undefined);
    await mock(page, { summary: () => ({ ...summary(), ...patch }) });
    await page.goto(origin);
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
    await expect(page.getByRole('table')).toHaveCount(0);
  }
});
test('a malformed amount in a response is rejected rather than shown', async ({ page }) => {
  const bad = summary();
  bad.currencies[0].feesDue = '12.5e3';
  await mock(page, { summary: () => bad });
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
});
test('older entries load on request without duplicating rows', async ({ page }) => {
  await mock(page, {
    entries: (url) =>
      url.searchParams.get('beforeSeq') === '1'
        ? list({
            rows: [
              entry(1, {
                kind: 'PARTICIPANT_PAYMENT',
                amountMinor: '5000000',
                description: 'Synthetic first receipt',
              }),
              entry(0 + 5, { description: 'Synthetic older fee' }),
            ],
          })
        : list({ nextBefore: 1 }),
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Show older entries' }).click();
  await expect(page.getByText('Synthetic older fee')).toBeVisible();
  await expect(page.getByText('Synthetic first receipt')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Show older entries' })).toHaveCount(0);
});
test('a correction names only the original, a date and a reason', async ({ page }) => {
  let command: Record<string, unknown> | null = null;
  await mock(page, {
    post: (body) => {
      command = body;
      return ok(body);
    },
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Correct this entry' }).first().click();
  await page.getByLabel('Reason (start with Synthetic)').fill('Synthetic wrong amount entered');
  await page.getByLabel('I confirm this correction.').check();
  await page.getByRole('button', { name: 'Add correction' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'No payment was collected' }),
  ).toBeVisible();
  const sent = (command as unknown as { entry: Record<string, unknown> }).entry;
  expect(Object.keys(sent).sort()).toEqual(['description', 'occurredOn', 'reverseOf']);
  expect(sent.reverseOf).toBe(entry(2).id);
});
test('already corrected entries offer no second correction', async ({ page }) => {
  await mock(page, {
    entries: () =>
      list({
        rows: [
          entry(3, {
            reverseOf: entry(2).id,
            amountMinor: '-9007199254740993',
            description: 'Synthetic undo',
          }),
          entry(2, { reversedBy: entry(3).id }),
        ],
      }),
  });
  await page.goto(origin);
  await expect(page.getByRole('button', { name: 'Correct this entry' })).toHaveCount(0);
  await expect(page.getByText('Correction of an earlier entry')).toBeVisible();
  await expect(page.getByText('BDT -90071992547409.93')).toBeVisible();
});
test('access expiry clears the finances without extending permission', async ({ page }) => {
  await mock(page, { entries: () => list({ ttl: 700 }) });
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
test('changing the signed-in account discards the previous account data', async ({ page }) => {
  await mock(page);
  await page.goto(origin);
  await expect(page.getByText('Synthetic Buyer Alpha').first()).toBeVisible();
  await page.unroute('**/api/customer-programme-economics**');
  await mock(page, { summary: () => summary({ empty: true }), entries: () => list({ rows: [] }) });
  await page.evaluate((issuerValue) => {
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', {
        detail: { subject: 'synthetic-bob', issuer: issuerValue },
      }),
    );
  }, issuer);
  await expect(page.getByText('No sample amounts recorded yet.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('No entries yet.')).toBeVisible();
});
for (const width of [320, 390, 768, 1440])
  test('keyboard and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mock(page);
    await page.goto(origin);
    await expect(page.getByRole('table', { name: 'BDT' })).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    if (width === 320) {
      await mkdir('.cache/v3-programme-economics/after', { recursive: true });
      await page.screenshot({
        path: '.cache/v3-programme-economics/after/organiser-320.png',
        fullPage: true,
      });
    }
  });
