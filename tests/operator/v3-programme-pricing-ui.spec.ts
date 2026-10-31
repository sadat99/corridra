import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. Real restricted customer authority has separate database acceptance.
const issuer =
  'https://ep-pricing-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = randomUUID();
const programmeId = randomUUID();
const bobReg = randomUUID();
const carolReg = randomUUID();
const templateId = randomUUID();
const planId = randomUUID();
const seriesId = randomUUID();
const standard = 'Synthetic standard delegate fee';
const student = 'Synthetic student delegate fee';
const future = () => new Date(Date.now() + 600_000).toISOString();

const content = {
  currency: 'BDT',
  tiers: [
    { label: standard, amountMinor: '1000000' },
    { label: student, amountMinor: '600000' },
  ],
  earlyBird: [
    {
      label: 'Synthetic early booking discount',
      untilDate: '2026-11-30',
      reductionMinor: '100000',
    },
  ],
  groupDiscounts: [
    { label: 'Synthetic group of four discount', minParticipants: 4, reductionMinor: '50000' },
  ],
};
const template = (over: Record<string, unknown> = {}) => ({
  id: templateId,
  seq: 1,
  version: 2,
  name: 'Synthetic autumn delegation fees',
  description: null,
  retired: false,
  content,
  currency: 'BDT',
  exponent: 2,
  tierCount: 2,
  updatedAt: '2026-10-20T10:00:00.000Z',
  provenance: 'ORGANISER_RECORDED',
  ...over,
});
const planTemplate = {
  id: planId,
  seq: 1,
  version: 1,
  name: 'Synthetic recurring edition plan',
  description: null,
  retired: false,
  content: {
    reportingPurpose: 'Synthetic recurring buyer mission for every edition',
    capacity: null,
    tasks: [],
    plannedCosts: [],
  },
  taskCount: 0,
  costCount: 0,
  capacity: null,
  updatedAt: '2026-10-20T10:00:00.000Z',
  provenance: 'ORGANISER_RECORDED',
};
const series = (over: Record<string, unknown> = {}) => ({
  id: seriesId,
  seq: 1,
  version: 1,
  name: 'Synthetic quarterly buyer mission series',
  description: null,
  retired: false,
  templateId: planId,
  templateName: 'Synthetic recurring edition plan',
  templateVersion: 1,
  templateRetired: false,
  startDates: ['2027-01-15', '2027-04-15'],
  editions: [] as unknown[],
  nextEditionDate: '2027-01-15',
  updatedAt: '2026-10-20T10:00:00.000Z',
  provenance: 'ORGANISER_RECORDED',
  ...over,
});
const overview = (over: Record<string, unknown> = {}) => ({
  workspaceId,
  programmeId,
  expiresAt: future(),
  schedule: {
    version: 1,
    templateId,
    templateVersion: 2,
    currency: 'BDT',
    exponent: 2,
    content,
    appliedAt: '2026-10-20T10:00:00.000Z',
    provenance: 'ORGANISER_RECORDED',
  },
  history: [{ version: 1 }],
  participants: [
    {
      registrationId: bobReg,
      label: 'Synthetic participant Bob',
      state: 'ACTIVE',
      hasFee: false,
      fees: [],
    },
    {
      registrationId: carolReg,
      label: 'Synthetic participant Carol',
      state: 'ACTIVE',
      hasFee: false,
      fees: [],
    },
  ],
  counts: { registered: 2, active: 2 },
  ...over,
});
const previewBody = {
  workspaceId,
  programmeId,
  expiresAt: future(),
  preview: true,
  scheduleVersion: 1,
  currency: 'BDT',
  exponent: 2,
  feeDate: '2026-11-15',
  groupSize: 2,
  rowCount: 2,
  perCurrency: [{ currency: 'BDT', exponent: 2, totalMinor: '1450000' }],
  rows: [
    {
      registrationId: bobReg,
      tier: standard,
      baseMinor: '1000000',
      earlyBirdMinor: '100000',
      groupMinor: '0',
      amountMinor: '900000',
    },
    {
      registrationId: carolReg,
      tier: student,
      baseMinor: '600000',
      earlyBirdMinor: '100000',
      groupMinor: '0',
      amountMinor: '500000',
    },
  ],
};
const figures = (over: Record<string, unknown> = {}) => ({
  currency: 'BDT',
  exponent: 2,
  feesDue: '800000',
  paymentsRecorded: '300000',
  outstanding: '500000',
  plannedCosts: '5000000',
  actualCosts: '200000',
  marginOnActual: '600000',
  cashMargin: '100000',
  feesDueChange: null,
  ...over,
});
const revenue = {
  workspaceId,
  seriesId,
  expiresAt: future(),
  provenance: 'ORGANISER_RECORDED',
  verified: false,
  projection: false,
  editions: [
    {
      editionNo: 1,
      programmeId,
      programmeName: 'Synthetic buyer mission edition 1',
      startDate: '2027-01-15',
      registered: 1,
      active: 1,
      figures: [
        figures(),
        figures({
          currency: 'USD',
          feesDue: '0',
          paymentsRecorded: '0',
          outstanding: '0',
          plannedCosts: '0',
          actualCosts: '5000',
          marginOnActual: '-5000',
          cashMargin: '-5000',
        }),
      ],
    },
  ],
  totals: [
    { ...figures(), editions: 1 },
    {
      ...figures({
        currency: 'USD',
        feesDue: '0',
        paymentsRecorded: '0',
        outstanding: '0',
        plannedCosts: '0',
        actualCosts: '5000',
        marginOnActual: '-5000',
        cashMargin: '-5000',
      }),
      editions: 1,
    },
  ],
};

let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {CustomerProgrammes} from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};
const q=new URLSearchParams(location.search);
createRoot(document.getElementById('fixture')).render(<CustomerProgrammes subject={q.get('subject')||'synthetic-alice'} issuer={${JSON.stringify(issuer)}} workspaceId={${JSON.stringify(workspaceId)}} templatesEnabled={true} pricingEnabled={q.get('pricing')!=='off'}/>);`,
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
    splitting: false,
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    metafile: true,
  });
  // The browser bundle must carry no server authority code.
  expect(Object.keys(result.metafile!.inputs).some((p) => p.includes('packages/auth/src'))).toBe(
    false,
  );
  const javascript = result.outputFiles[0].text,
    css = await readFile('apps/web/app/globals.css');
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(css);
    } else if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic pricing fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace"><h1>Synthetic pricing fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>',
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Fixture address unavailable');
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

type Handlers = {
  templates?: () => { status?: number; json: unknown };
  overview?: () => { status?: number; json: unknown };
  series?: () => { status?: number; json: unknown };
  revenue?: () => { status?: number; json: unknown };
  post?: (body: { action: string; input: Record<string, unknown> }) => {
    status?: number;
    json: unknown;
  };
};
async function mock(page: Page, handlers: Handlers = {}) {
  const posts: {
    action: string;
    input: Record<string, unknown>;
    headers: Record<string, string>;
  }[] = [];
  await page.route('**/api/customer-programmes**', (route) =>
    route.fulfill({
      json: {
        synthetic: true,
        workspaceId,
        nextAfter: null,
        programmes: [
          {
            id: programmeId,
            workspaceId,
            name: 'Synthetic buyer mission edition 1',
            reportingPurpose: 'Synthetic recurring buyer mission for every edition',
            createdAt: '2026-10-20T10:00:00.000Z',
            synthetic: true,
          },
        ],
      },
    }),
  );
  await page.route('**/api/customer-programme-templates**', (route) =>
    route.fulfill({
      json: { workspaceId, expiresAt: future(), templates: [planTemplate], nextAfter: null },
    }),
  );
  await page.route('**/api/customer-programme-pricing**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      posts.push({ ...body, headers: request.headers() });
      const out = handlers.post?.(body) ?? { json: {} };
      return route.fulfill({ status: out.status ?? 200, json: out.json });
    }
    const view = new URL(request.url()).searchParams.get('view');
    const fallback = {
      templates: {
        json: { workspaceId, expiresAt: future(), templates: [template()], nextAfter: null },
      },
      overview: { json: overview() },
      series: { json: { workspaceId, expiresAt: future(), series: [series()], nextAfter: null } },
      revenue: { json: revenue },
    } as const;
    const key = view as keyof typeof fallback;
    const out = handlers[key]?.() ?? fallback[key];
    return route.fulfill({ status: (out as { status?: number }).status ?? 200, json: out.json });
  });
  return posts;
}
async function open(page: Page, query = '') {
  await page.goto(origin + '/' + query);
  return page.getByRole('region', { name: 'Pricing, series and exports', exact: true });
}

test('the section is absent without the flag and present with it, with three keyboard-reachable parts', async ({
  page,
}) => {
  await mock(page);
  await page.goto(origin + '/?pricing=off');
  await expect(page.getByText('Your planning programmes')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pricing, series and exports' })).toHaveCount(0);
  const area = await open(page);
  await expect(area.getByRole('tab', { name: 'Pricing' })).toHaveAttribute('aria-selected', 'true');
  await area.getByRole('tab', { name: 'Pricing' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(area.getByRole('tab', { name: 'Series' })).toHaveAttribute('aria-selected', 'true');
  await expect(area.getByRole('tab', { name: 'Series' })).toBeFocused();
  await expect(area.getByRole('heading', { name: 'Series', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(area.getByRole('heading', { name: 'Exports', exact: true })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(area.getByRole('heading', { name: 'Fee schedules' })).toBeVisible();
  await expect(area.getByText('Corridra collects, holds and moves no money.')).toBeVisible();
});

test('a fee schedule is validated before sending and saved with exact minor-unit text, never a float', async ({
  page,
}) => {
  const posts = await mock(page, {
    post: (body) => ({
      json: {
        workspaceId,
        commandId: body.input.commandId,
        replayed: false,
        expiresAt: future(),
        template: template({ version: 1 }),
      },
    }),
  });
  const area = await open(page);
  await area.getByRole('button', { name: 'New fee schedule' }).click();
  await area.getByLabel('Name (start with Synthetic)').fill('Autumn fees');
  await area.getByRole('button', { name: 'Create fee schedule' }).click();
  await expect(area.getByRole('alert')).toContainText(
    'Start the schedule name with the word Synthetic',
  );
  expect(posts).toHaveLength(0);
  await area.getByLabel('Name (start with Synthetic)').fill('Synthetic autumn delegation fees');
  await area.getByLabel('Tier 1 name').fill(standard);
  await area.getByLabel(/Tier 1 fee/).fill('10000.505');
  await area.getByRole('button', { name: 'Create fee schedule' }).click();
  // MoneyInput also explains the decimal places beside the field, so pick the form's own error.
  await expect(
    area.getByRole('alert').filter({ hasText: 'positive amount using the currency' }),
  ).toBeVisible();
  await area.getByLabel(/Tier 1 fee/).fill('10000.50');
  await area.getByRole('button', { name: 'Add an early booking reduction' }).click();
  await area.getByLabel('Early booking 1 name').fill('Synthetic early booking discount');
  await area.getByLabel('Early booking 1 last day it applies').fill('2026-11-30');
  await area.getByLabel('Early booking 1 amount taken off each fee').fill('10000.50');
  await area.getByRole('button', { name: 'Create fee schedule' }).click();
  await expect(area.getByRole('alert')).toContainText('stay below the cheapest tier');
  expect(posts).toHaveLength(0);
  await area.getByLabel('Early booking 1 amount taken off each fee').fill('1000');
  await area.getByRole('button', { name: 'Add a group reduction' }).click();
  await area.getByLabel('Group 1 name').fill('Synthetic group of four discount');
  await area.getByLabel('Group 1 applies from this many participants').fill('4');
  await area.getByLabel('Group 1 amount taken off each fee').fill('500');
  await area.getByRole('button', { name: 'Create fee schedule' }).click();
  await expect(area.getByRole('status').first()).toContainText('Fee schedule created');
  expect(posts).toHaveLength(1);
  expect(posts[0]!.headers['x-corridra-customer-subject']).toBe('synthetic-alice');
  expect(posts[0]!.action).toBe('saveTemplate');
  expect(Object.keys(posts[0]!.input).sort()).toEqual([
    'commandId',
    'content',
    'description',
    'expectedVersion',
    'name',
    'retired',
    'templateId',
    'workspaceId',
  ]);
  expect(posts[0]!.input).toMatchObject({
    expectedVersion: 0,
    templateId: null,
    retired: false,
    description: null,
  });
  expect(posts[0]!.input.content).toEqual({
    currency: 'BDT',
    tiers: [{ label: standard, amountMinor: '1000050' }],
    earlyBird: [
      {
        label: 'Synthetic early booking discount',
        untilDate: '2026-11-30',
        reductionMinor: '100000',
      },
    ],
    groupDiscounts: [
      { label: 'Synthetic group of four discount', minParticipants: 4, reductionMinor: '50000' },
    ],
  });
});

test('fees are previewed first, recorded only on confirmation with one exact request, and a retry reuses the command id', async ({
  page,
}) => {
  const ids: string[] = [];
  let record = 500;
  const posts = await mock(page, {
    post: (body) => {
      if (body.action === 'previewFees') return { json: previewBody };
      ids.push(String(body.input.commandId));
      return record === 200
        ? {
            json: {
              ...previewBody,
              preview: undefined,
              batchId: randomUUID(),
              commandId: body.input.commandId,
              replayed: false,
            },
          }
        : { status: record, json: { error: 'x' } };
    },
  });
  const area = await open(page);
  await area.getByLabel('Programme').selectOption(programmeId);
  await expect(area.getByText('Fee schedule version 1 is applied')).toBeVisible();
  await area.getByRole('button', { name: 'Preview fees' }).click();
  await expect(area.getByRole('alert')).toContainText('Choose at least one participant');
  await area.getByLabel('Charge Synthetic participant Bob').check();
  await area.getByLabel('Charge Synthetic participant Carol').check();
  await area.getByLabel('Tier for Synthetic participant Carol').selectOption(student);
  await area.getByLabel(/Fee date/).fill('2026-11-15');
  await area.getByRole('button', { name: 'Preview fees' }).click();
  await expect(area.getByRole('heading', { name: 'Check before recording' })).toBeVisible();
  await expect(area.getByText('Total in BDT: BDT 14500.00')).toBeVisible();
  await expect(area.getByRole('row', { name: /Synthetic participant Bob/ })).toContainText(
    'BDT 9000.00',
  );
  // Nothing is recorded by previewing.
  expect(posts.map((p) => p.action)).toEqual(['previewFees']);
  expect(posts[0]!.input).toMatchObject({ scheduleVersion: 1, feeDate: '2026-11-15', programmeId });
  expect(posts[0]!.input.rows).toEqual([
    { registrationId: bobReg, tier: standard },
    { registrationId: carolReg, tier: student },
  ]);
  expect(
    (await new AxeBuilder({ page }).include('main').analyze()).violations.map((v) => v.id),
  ).toEqual([]);
  await area.getByRole('button', { name: 'Record these fees' }).click();
  await expect(area.getByRole('alert')).toContainText('It could not be saved');
  record = 200;
  await area.getByRole('button', { name: 'Record these fees' }).click();
  await expect(area.getByRole('status')).toContainText(
    'Recorded 2 fees. Payments are not collected here.',
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  const recorded = posts.filter((p) => p.action === 'recordFees');
  expect(Object.keys(recorded[1]!.input).sort()).toEqual([
    'commandId',
    'feeDate',
    'programmeId',
    'rows',
    'scheduleVersion',
    'workspaceId',
  ]);
});

test('a stale batch saves nothing and closes the preview; a lost admin right clears the private details', async ({
  page,
}) => {
  let status = 409;
  await mock(page, {
    post: (body) =>
      body.action === 'previewFees' ? { json: previewBody } : { status, json: { error: 'x' } },
  });
  const area = await open(page);
  await area.getByLabel('Programme').selectOption(programmeId);
  await area.getByLabel('Charge Synthetic participant Bob').check();
  await area.getByLabel(/Fee date/).fill('2026-11-15');
  await area.getByRole('button', { name: 'Preview fees' }).click();
  await area.getByRole('button', { name: 'Record these fees' }).click();
  await expect(area.getByRole('alert')).toContainText('Nothing was saved');
  await expect(area.getByRole('heading', { name: 'Check before recording' })).toHaveCount(0);
  status = 403;
  await area.getByLabel('Charge Synthetic participant Bob').check();
  await area.getByRole('button', { name: 'Preview fees' }).click();
  await area.getByRole('button', { name: 'Record these fees' }).click();
  await expect(area.getByRole('alert')).toContainText('Account or workspace access changed');
});

test('a denied or failed load shows a calm message and never stale figures', async ({ page }) => {
  await mock(page, { templates: () => ({ status: 403, json: { error: 'x' } }) });
  const area = await open(page);
  await expect(area.getByRole('alert')).toContainText('Account or workspace access changed');
  await expect(area.getByText('Synthetic autumn delegation fees')).toHaveCount(0);
  await expect(area.getByRole('button', { name: 'New fee schedule' })).toHaveCount(0);
  const unavailable = await page.context().newPage();
  await mock(unavailable, { templates: () => ({ status: 503, json: { error: 'x' } }) });
  const second = await open(unavailable);
  await expect(second.getByText('Pricing is unavailable.')).toBeVisible();
});

test('the next edition is created after naming it, with one exact request and a plain result', async ({
  page,
}) => {
  const posts = await mock(page, {
    post: (body) => ({
      json: {
        workspaceId,
        seriesId,
        commandId: body.input.commandId,
        replayed: false,
        expiresAt: future(),
        edition: {
          id: randomUUID(),
          editionNo: 1,
          programmeId: randomUUID(),
          startDate: '2027-01-15',
          seriesVersion: 1,
          templateVersion: 1,
        },
        tasksCreated: 3,
        plannedCostsCreated: 2,
      },
    }),
  });
  const area = await open(page);
  await area.getByRole('tab', { name: 'Series' }).click();
  await expect(area.getByText('0 of 2 editions created; next starts 2027-01-15')).toBeVisible();
  await area
    .getByRole('button', {
      name: 'Create the next edition of Synthetic quarterly buyer mission series',
    })
    .click();
  await area.getByLabel('Edition name (start with Synthetic)').fill('Buyer mission');
  await area.getByRole('button', { name: 'Create edition 1' }).click();
  await expect(area.getByRole('alert')).toContainText(
    'Start the edition name with the word Synthetic',
  );
  expect(posts).toHaveLength(0);
  await area
    .getByLabel('Edition name (start with Synthetic)')
    .fill('Synthetic buyer mission edition one');
  await area.getByRole('button', { name: 'Create edition 1' }).click();
  await expect(area.getByRole('status').first()).toContainText(
    'Edition 1 created with 3 task(s) and 2 planned cost(s). No participants, fees or payments were copied.',
  );
  expect(posts).toHaveLength(1);
  expect(posts[0]!.action).toBe('createEdition');
  expect(posts[0]!.input).toMatchObject({
    seriesId,
    expectedVersion: 1,
    editionNo: 1,
    templateVersion: 1,
    name: 'Synthetic buyer mission edition one',
  });
  expect(Object.keys(posts[0]!.input).sort()).toEqual([
    'commandId',
    'editionNo',
    'expectedVersion',
    'name',
    'seriesId',
    'templateVersion',
    'workspaceId',
  ]);
});

test('a series is saved with an explicit increasing list of dates, filled from a pattern', async ({
  page,
}) => {
  const posts = await mock(page, {
    post: (body) => ({
      json: {
        workspaceId,
        commandId: body.input.commandId,
        replayed: false,
        expiresAt: future(),
        series: series({ version: 1 }),
      },
    }),
  });
  const area = await open(page);
  await area.getByRole('tab', { name: 'Series' }).click();
  await area.getByRole('button', { name: 'New series' }).click();
  await area
    .getByLabel('Series name (start with Synthetic)')
    .fill('Synthetic annual buyer mission series');
  await area.getByRole('button', { name: 'Create series' }).click();
  await expect(area.getByRole('alert')).toContainText('Choose the programme template');
  await area.getByLabel('Programme template each edition starts from').selectOption(planId);
  await area.getByLabel('First start date').fill('2027-01-31');
  await area.getByLabel('How many editions').fill('3');
  await area.getByLabel('How often').selectOption('1');
  await area.getByRole('button', { name: 'Fill in the dates' }).click();
  await expect(area.getByLabel('Edition 2 start date')).toHaveValue('2027-02-28');
  await area.getByLabel('Edition 3 start date').fill('2027-02-10');
  await area.getByRole('button', { name: 'Create series' }).click();
  await expect(area.getByRole('alert')).toContainText('Start dates must be in order');
  await area.getByLabel('Edition 3 start date').fill('2027-03-31');
  await area.getByRole('button', { name: 'Create series' }).click();
  await expect(area.getByRole('status').first()).toContainText('Series created');
  expect(posts).toHaveLength(1);
  expect(posts[0]!.input).toMatchObject({
    expectedVersion: 0,
    seriesId: null,
    templateId: planId,
    startDates: ['2027-01-31', '2027-02-28', '2027-03-31'],
    retired: false,
  });
});

test('repeat revenue is shown per currency, as recorded, with no forecast and no cross-currency total', async ({
  page,
}) => {
  await mock(page, {
    series: () => ({
      json: {
        workspaceId,
        expiresAt: future(),
        series: [
          series({
            editions: [
              {
                id: randomUUID(),
                editionNo: 1,
                programmeId,
                programmeName: 'Synthetic buyer mission edition 1',
                startDate: '2027-01-15',
              },
            ],
            nextEditionDate: '2027-04-15',
          }),
        ],
        nextAfter: null,
      },
    }),
  });
  const area = await open(page);
  await area.getByRole('tab', { name: 'Series' }).click();
  await area
    .getByRole('button', {
      name: 'Show repeat revenue for Synthetic quarterly buyer mission series',
    })
    .click();
  await expect(area.getByText(/not verified, not a forecast/)).toBeVisible();
  const totals = area.getByRole('table', { name: 'Totals across editions, by currency' });
  await expect(totals.getByRole('row', { name: /BDT/ })).toContainText('BDT 8000.00');
  await expect(totals.getByRole('row', { name: /USD/ })).toContainText('USD -50.00');
  await expect(totals.getByRole('row')).toHaveCount(3);
  expect(
    (await new AxeBuilder({ page }).include('main').analyze()).violations.map((v) => v.id),
  ).toEqual([]);
  await area
    .getByRole('button', {
      name: 'Hide repeat revenue for Synthetic quarterly buyer mission series',
    })
    .click();
  await expect(totals).toHaveCount(0);
});

test('an export downloads a csv with one request, shows the file name, and explains a denial or an oversize choice', async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  let mode: 'ok' | 'denied' | 'large' = 'ok';
  await mock(page);
  await page.route('**/api/customer-programme-exports', (route) => {
    requests.push(route.request().postDataJSON());
    if (mode === 'denied') return route.fulfill({ status: 403, json: { error: 'Access denied' } });
    if (mode === 'large')
      return route.fulfill({
        status: 409,
        json: { error: 'Too many rows for one export; choose one programme' },
      });
    return route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="corridra-ledger-2026-11-02.csv"',
        'cache-control': 'no-store',
      },
      body: '﻿programme_id,entry_number\r\nabc,1\r\n',
    });
  });
  const area = await open(page);
  await area.getByRole('tab', { name: 'Exports' }).click();
  await area.getByLabel('What to export').selectOption('ledger');
  await area.getByLabel('Programme (optional)').selectOption(programmeId);
  const download = page.waitForEvent('download');
  await area.getByRole('button', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toBe('corridra-ledger-2026-11-02.csv');
  await expect(area.getByRole('status')).toContainText(
    'Downloaded corridra-ledger-2026-11-02.csv with 1 row. The download was logged.',
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ workspaceId, dataset: 'ledger', programmeId });
  expect(Object.keys(requests[0]!).sort()).toEqual([
    'commandId',
    'dataset',
    'programmeId',
    'workspaceId',
  ]);
  mode = 'large';
  await area.getByLabel('Programme (optional)').selectOption('');
  await area.getByRole('button', { name: 'Download CSV' }).click();
  await expect(area.getByRole('alert')).toContainText('too large. Choose one programme');
  mode = 'denied';
  await area.getByRole('button', { name: 'Download CSV' }).click();
  await expect(area.getByRole('alert')).toContainText(
    'Only owners and admins of this workspace can export',
  );
});

for (const width of [320, 390, 768, 1440])
  test('keyboard and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mock(page);
    const area = await open(page);
    await area
      .getByRole('button', { name: 'Edit fee schedule Synthetic autumn delegation fees' })
      .click();
    await expect(area.getByLabel('Tier 1 name')).toBeVisible();
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
    await area.getByRole('tab', { name: 'Series' }).click();
    await area.getByRole('button', { name: 'New series' }).click();
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
    await area.getByRole('tab', { name: 'Exports' }).click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
