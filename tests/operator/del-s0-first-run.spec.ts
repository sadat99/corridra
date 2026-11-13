import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isTitleCase } from '../../apps/web/lib/ux/title-case';

// ADR-084 slice S0, behind CORRIDRA_DELEGATION_FIRST_RUN: the guided first run and the decisions-first overview, as
// the real components in the customer frame against a small stateful stand-in for the routes that already exist.
// Component protocol fixtures, not database acceptance: the commands themselves are proven where they were built
// (customer-programme-publication.test.ts and the template and programme suites). Names are made up; the fixture
// runs in sample mode, where a programme and its organiser are marked in their names.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const existingId = '00000000-0000-4000-8000-000000000002';
const createdId = '00000000-0000-4000-8000-000000000003';
const templateId = '00000000-0000-4000-8000-000000000011';
const workspaceName = 'Synthetic Dhaka Agro Traders Association';
let server: Server, origin: string;
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{CustomerProgrammes}from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};
      import{ProgrammeRoomStyles}from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-room-styles.tsx'))};
      const q=new URLSearchParams(location.search);
      const on=(name)=>q.get(name)==='1';
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page ux-workspace ux-customer">
          <h1>Plan delegations</h1>
          {on('room')&&<ProgrammeRoomStyles/>}
          <CustomerProgrammes subject="synthetic-alice" issuer=${JSON.stringify(issuer)} workspaceId=${JSON.stringify(workspaceId)}
            participantsEnabled termsEnabled={on('terms')} templatesEnabled={on('tpl')} pagesEnabled={on('pages')}
            roomEnabled={on('room')} firstRunEnabled={on('first')}/>
        </main>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'next-fixture',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : 'const router={replace:()=>{},refresh:()=>{},push:()=>{}};export function useRouter(){return router}',
          }));
        },
      },
    ],
  });
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    res.setHeader('cache-control', 'no-store');
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>First run fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
});

type Write = { method: string; path: string; body: Record<string, unknown> };
type Programme = {
  id: string;
  workspaceId: string;
  name: string;
  reportingPurpose: string;
  createdAt: string;
  synthetic: boolean;
};
const existing: Programme = {
  id: existingId,
  workspaceId,
  name: 'Synthetic commercial delegation',
  reportingPurpose: 'Synthetic participant needs and commercial objectives',
  createdAt: '2026-10-18T00:00:00Z',
  synthetic: true,
};
const template = {
  id: templateId,
  seq: 1,
  version: 2,
  name: 'Synthetic spring fair delegation',
  description: 'Synthetic a repeatable plan for the spring fair',
  retired: false,
  content: {
    reportingPurpose: 'Synthetic repeatable planning purpose for the spring fair',
    capacity: 20,
    tasks: [
      {
        title: 'Synthetic book the hotel block',
        detail: 'Synthetic twenty rooms near the venue',
        dueOffsetDays: 0,
        assigneeLabel: null,
      },
    ],
    plannedCosts: [
      {
        kind: 'ORGANISER_EXPENSE',
        description: 'Synthetic venue hire for two days',
        currency: 'BDT',
        amountMinor: '5000050',
      },
    ],
  },
  taskCount: 1,
  costCount: 1,
  capacity: 20,
  updatedAt: '2026-10-19T00:00:00Z',
  provenance: 'ORGANISER_RECORDED',
};
const later = () => new Date(Date.now() + 3600000).toISOString();
const participants = (more = false) => ({
  workspaceId,
  programmeId: existingId,
  invitations: [
    {
      id: '00000000-0000-4000-8000-000000000101',
      label: 'Synthetic participant invitation',
      expiresAt: later(),
      status: 'USED',
    },
    {
      id: '00000000-0000-4000-8000-000000000102',
      label: 'Synthetic participant invitation',
      expiresAt: later(),
      status: 'ISSUED',
    },
  ],
  registrations: [
    {
      id: '00000000-0000-4000-8000-000000000201',
      displayLabel: 'Synthetic participant label',
      consentedAt: '2026-10-18T00:00:00Z',
      status: 'REGISTERED',
    },
  ],
  nextInvitationAfter: null,
  nextRegistrationAfter: more ? '00000000-0000-4000-8000-000000000201' : null,
  synthetic: true,
});

/** The routes the screens call, answered from a small state. Every write is recorded in order. */
async function standIn(
  page: Page,
  options: {
    programmes?: Programme[];
    applications?: { applications: number; awaiting: number };
    partialParticipants?: boolean;
    publishAnswers?: number[];
  } = {},
) {
  const state = {
    programmes: [...(options.programmes ?? [])],
    writes: [] as Write[],
    published: null as null | { copy: Record<string, unknown>; closesAt: string },
    publishAnswers: [...(options.publishAnswers ?? [])],
  };
  const record = (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const request = route.request();
    const write = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: (request.postDataJSON() ?? {}) as Record<string, unknown>,
    };
    state.writes.push(write);
    return write;
  };
  await page.route('**/api/customer-programme-*', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.route('**/api/customer-workspaces*', (route) =>
    route.fulfill({
      json: {
        workspaces: [{ id: workspaceId, name: workspaceName, role: 'owner', synthetic: true }],
        synthetic: true,
      },
    }),
  );
  await page.route('**/api/customer-programme-participants*', (route) =>
    route.fulfill({ json: participants(options.partialParticipants) }),
  );
  await page.route('**/api/customer-programme-templates*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: { workspaceId, expiresAt: later(), templates: [template], nextAfter: null },
      });
    const { body } = record(route);
    const input = body.input as Record<string, unknown>;
    return route.fulfill({
      json: {
        commandId: input.commandId,
        programmeId: input.programmeId,
        templateId: input.templateId,
        tasksCreated: 1,
        plannedCostsCreated: 1,
      },
    });
  });
  await page.route('**/api/customer-programme-pages*', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.searchParams.get('view') === 'applications')
        return route.fulfill({ json: { applications: [], nextAfter: null } });
      const counts = options.applications ?? { applications: 0, awaiting: 0 };
      return route.fulfill({
        json: state.published
          ? {
              version: 1,
              state: 'OPEN',
              address: 'synthetic-machinery-delegation-k3f9x2ab7q',
              copy: state.published.copy,
              closesAt: state.published.closesAt,
              ...counts,
              sample: true,
            }
          : { version: 0, state: 'NONE', ...counts, sample: true },
      });
    }
    const { body } = record(route);
    const status = state.publishAnswers.shift() ?? 200;
    if (status !== 200)
      return route.fulfill({
        status,
        json: {
          error: 'This could not be done as asked',
          code: 'PROGRAMME_PUBLICATION_RATE_LIMITED',
        },
      });
    state.published = {
      copy: body.copy as Record<string, unknown>,
      closesAt: body.closesAt as string,
    };
    return route.fulfill({ json: { version: 1, state: 'OPEN' } });
  });
  await page.route('**/api/customer-programmes*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: { workspaceId, programmes: state.programmes, nextAfter: null, synthetic: true },
      });
    const { body } = record(route);
    const made: Programme = {
      id: createdId,
      workspaceId,
      name: body.name as string,
      reportingPurpose: body.reportingPurpose as string,
      createdAt: new Date().toISOString(),
      synthetic: true,
    };
    if (!state.programmes.some((p) => p.id === made.id)) state.programmes.unshift(made);
    return route.fulfill({ status: 201, json: made });
  });
  return state;
}
const firstRun = (page: Page) => page.getByRole('region', { name: 'Set up your delegation' });
const preview = (page: Page) => page.getByRole('region', { name: 'Your public page so far' });
const draftKeys = (page: Page) =>
  page.evaluate(() => ({
    session: Object.keys(window.sessionStorage).filter((key) => key.includes('first-run')),
    local: Object.keys(window.localStorage).filter((key) => key.includes('first-run')),
    text: Object.entries(window.sessionStorage)
      .filter(([key]) => key.includes('first-run'))
      .map(([, value]) => value)
      .join(''),
  }));
const utcDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

async function fillToLastStep(page: Page) {
  const run = firstRun(page);
  await run.getByLabel('Programme name').fill('Synthetic machinery delegation');
  await run.getByLabel('Where').fill('Guangzhou, China');
  await run.getByRole('button', { name: 'Continue' }).click();
  await expect(run.getByRole('heading', { name: 'Step 2 of 3: Dates and people' })).toBeFocused();
  await run.getByLabel('When').fill('12 to 16 March 2027');
  await run
    .getByLabel('Who should apply')
    .fill('Synthetic importers and distributors of farm machinery.');
  await run
    .getByLabel('What it is for')
    .fill('Synthetic five day visit to machinery makers for importers.');
  await run.getByRole('button', { name: 'Continue' }).click();
  await expect(run.getByRole('heading', { name: 'Step 3 of 3: Fee and places' })).toBeFocused();
}

test('the first run goes from an empty workspace to a published page, and nothing reaches the server before Publish', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await standIn(page);
  await page.goto(`${origin}/?room=1&first=1&pages=1&tpl=1`);
  const run = firstRun(page);
  await expect(run).toBeVisible();
  // A workspace with no programme opens on the first run: it is the first tab and the one shown.
  await expect(page.getByRole('tab').first()).toHaveText('New Sample Programme');
  await expect(page.getByRole('tab', { name: 'New Sample Programme' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(run.getByRole('heading', { name: 'Step 1 of 3: Name and place' })).toBeVisible();
  const form = run.locator('form');
  // Step 1: name, destination and the template choice. One to three fields.
  await expect(form.locator('label.field')).toHaveCount(3);
  await run.getByLabel('Programme name').fill('Synthetic machinery delegation');
  await run.getByLabel('Where').fill('Guangzhou, China');
  await run
    .getByLabel('Start from a template (optional)')
    .selectOption({ label: 'Synthetic spring fair delegation' });
  // The preview is the public view, fed the words typed so far.
  await expect(preview(page)).toContainText('Synthetic machinery delegation');
  await expect(preview(page).locator('.programme-public-key')).toContainText('Guangzhou, China');
  await expect(preview(page).locator('.programme-public-key')).toContainText('Not written yet');
  await expect(preview(page)).toContainText('The Apply button appears here on the published page.');
  // The draft is in this browser's session storage and nowhere else.
  await expect.poll(async () => (await draftKeys(page)).text).toContain('Guangzhou, China');
  const kept = await draftKeys(page);
  expect(kept.session).toHaveLength(1);
  expect(kept.local).toEqual([]);
  expect(state.writes, 'nothing is written to the server before Publish').toEqual([]);

  // A reload loses nothing and still writes nothing.
  await page.reload();
  await expect(run.getByLabel('Programme name')).toHaveValue('Synthetic machinery delegation');
  await expect(run.getByLabel('Where')).toHaveValue('Guangzhou, China');
  await expect(run.getByLabel('Start from a template (optional)')).toHaveValue(templateId);
  expect(state.writes).toEqual([]);

  await run.getByRole('button', { name: 'Continue' }).click();
  await expect(run.getByRole('heading', { name: 'Step 2 of 3: Dates and people' })).toBeFocused();
  // Step 2: dates, who it is for and what it is for. Three fields and the "not sure" tick.
  await expect(form.locator('label.field')).toHaveCount(3);
  // A step does not move on until its lines are written.
  await run.getByRole('button', { name: 'Continue' }).click();
  await expect(run.getByRole('alert')).toBeVisible();
  await expect(run.getByRole('heading', { name: 'Step 2 of 3: Dates and people' })).toBeVisible();
  await run.getByLabel('I am not sure yet').check();
  await expect(run.getByLabel('When')).toBeDisabled();
  await expect(preview(page).locator('.programme-public-key')).toContainText(
    'Dates to be confirmed',
  );
  await run
    .getByLabel('Who should apply')
    .fill('Synthetic importers and distributors of farm machinery.');
  await run
    .getByLabel('What it is for')
    .fill('Synthetic five day visit to machinery makers for importers.');
  await expect(preview(page).locator('.programme-public-lead')).toHaveText(
    'Synthetic five day visit to machinery makers for importers.',
  );
  await run.getByRole('button', { name: 'Continue' }).click();
  await expect(run.getByRole('heading', { name: 'Step 3 of 3: Fee and places' })).toBeFocused();
  // Step 3: the fee line and places, with the other page lines folded away.
  await expect(form.locator('label.field:visible')).toHaveCount(2);
  await run.getByLabel('Fee (optional)').fill('USD 1,200 per company, paid to the organiser');
  await run.getByLabel('Places (optional)').fill('20');
  await expect(preview(page).locator('.programme-public-terms')).toContainText('USD 1,200');
  // The lines the organiser did not write are their workspace's name and the page's own "Not stated yet".
  await run.locator('summary', { hasText: 'More Page Lines' }).click();
  await expect(run.getByLabel('Organised by')).toHaveValue(workspaceName);
  await expect(run.getByLabel('Industry or business focus')).toHaveValue('Not stated yet');
  await expect(run.getByLabel('What a company needs to take part')).toHaveValue('Not stated yet');
  await expect(run.getByLabel('Applications close on')).toHaveValue(utcDay(30));
  await expect(preview(page).locator('.programme-public-facts')).toContainText(workspaceName);
  // Before Publish is pressed the preview itself shows "Not stated yet" for the two lines the organiser left:
  // the focus, and what a company needs to take part. Nothing is published that was not on screen first.
  const publicPage = preview(page).locator('.programme-public');
  const focus = publicPage.locator('.programme-public-facts > div', { hasText: 'Focus' });
  await expect(focus.locator('dd')).toHaveText('Not stated yet');
  const who = publicPage.locator('section[aria-labelledby="programme-who-title"]');
  await expect(who.locator('h3 + p')).toHaveText('Not stated yet');
  await expect(preview(page)).toBeVisible();
  // Once the organiser writes the line, the preview shows their words instead.
  await run.getByLabel('Industry or business focus').fill('Synthetic farm machinery');
  await expect(focus.locator('dd')).toHaveText('Synthetic farm machinery');
  await run.getByLabel('Industry or business focus').fill('Not stated yet');
  await expect(focus.locator('dd')).toHaveText('Not stated yet');

  // Publish needs both confirmations, and until then nothing is sent.
  await run.getByRole('button', { name: 'Publish the Page' }).click();
  await expect(run.getByRole('alert')).toHaveText('Tick both boxes before you publish.');
  expect(state.writes).toEqual([]);
  await run.getByLabel('I am using made-up information for sample planning only.').check();
  await run.getByLabel(/^I checked this page\./).check();
  await run.getByRole('button', { name: 'Publish the Page' }).click();
  await expect(
    page.getByText('Published. Your programme is saved and its page is public.'),
  ).toBeVisible();

  // The existing commands, in order: create, apply the template, publish.
  expect(state.writes.map((w) => `${w.method} ${w.path}`)).toEqual([
    'POST /api/customer-programmes',
    'POST /api/customer-programme-templates',
    'POST /api/customer-programme-pages',
  ]);
  const [create, apply, publish] = state.writes;
  expect(Object.keys(create!.body).sort()).toEqual([
    'acknowledged',
    'commandId',
    'name',
    'reportingPurpose',
    'workspaceId',
  ]);
  expect(create!.body).toMatchObject({
    workspaceId,
    name: 'Synthetic machinery delegation',
    reportingPurpose: 'Synthetic five day visit to machinery makers for importers.',
    acknowledged: true,
  });
  // A template adds tasks and planned costs only: the request names the template and the programme, nothing else.
  expect(apply!.body.action).toBe('apply');
  const applied = apply!.body.input as Record<string, unknown>;
  expect(Object.keys(applied).sort()).toEqual([
    'commandId',
    'expectedVersion',
    'programmeId',
    'startDate',
    'templateId',
    'workspaceId',
  ]);
  expect(applied).toMatchObject({
    workspaceId,
    programmeId: createdId,
    templateId,
    expectedVersion: 2,
    startDate: null,
  });
  expect(Object.keys(publish!.body).sort()).toEqual([
    'acknowledged',
    'action',
    'closesAt',
    'commandId',
    'copy',
    'expectedVersion',
    'kind',
    'programmeId',
    'workspaceId',
  ]);
  expect(publish!.body).toMatchObject({
    kind: 'page',
    action: 'publish',
    workspaceId,
    programmeId: createdId,
    expectedVersion: 0,
    acknowledged: true,
    // The existing closing rule: the end of a day at most 179 days out. The first run starts at 30.
    closesAt: `${utcDay(30)}T23:59:00.000Z`,
    copy: {
      title: 'Synthetic machinery delegation',
      organiser: workspaceName,
      summary: 'Synthetic five day visit to machinery makers for importers.',
      destination: 'Guangzhou, China',
      dates: 'Dates to be confirmed',
      focus: 'Not stated yet',
      audience: 'Synthetic importers and distributors of farm machinery.',
      eligibility: 'Not stated yet',
      activities: [],
      included: [],
      excluded: [],
      fee: 'USD 1,200 per company, paid to the organiser',
      capacity: 20,
    },
  });
  // No person, fee schedule or payment was created along the way.
  expect(
    state.writes.filter((w) => /participants|pricing|terms|economics|payment|fee/.test(w.path)),
  ).toEqual([]);
  // The draft is gone from the session, and the new programme is on screen at its public page section.
  expect((await draftKeys(page)).session).toEqual([]);
  await expect(page.getByRole('article', { name: 'Synthetic machinery delegation' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('programme')).toBe(createdId);
  await expect(page.locator(`[id="${createdId}-page"]`)).toBeVisible();
});

test('a failed publish keeps the draft, and a second press never creates the programme twice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await standIn(page, { publishAnswers: [429] });
  await page.goto(`${origin}/?room=1&first=1&pages=1`);
  const run = firstRun(page);
  await fillToLastStep(page);
  await run.getByLabel('I am using made-up information for sample planning only.').check();
  await run.getByLabel(/^I checked this page\./).check();
  await run.getByRole('button', { name: 'Publish the Page' }).click();
  await expect(run.getByRole('alert')).toBeVisible();
  // The programme was saved, the page was not published, and what was typed is still there, on screen and in the session.
  expect(state.writes.map((w) => w.path)).toEqual([
    '/api/customer-programmes',
    '/api/customer-programme-pages',
  ]);
  await expect(run.getByLabel('Fee (optional)')).toBeVisible();
  expect((await draftKeys(page)).text).toContain(createdId);
  // Even after a reload the next press continues from the saved programme.
  await page.reload();
  await expect(run.getByRole('heading', { name: 'Step 3 of 3: Fee and places' })).toBeVisible();
  await expect(
    run.getByText('Your programme is saved in this workspace. Its page is not public yet.'),
  ).toBeVisible();
  await run.getByLabel('I am using made-up information for sample planning only.').check();
  await run.getByLabel(/^I checked this page\./).check();
  await run.getByRole('button', { name: 'Publish the Page' }).click();
  await expect(
    page.getByText('Published. Your programme is saved and its page is public.'),
  ).toBeVisible();
  expect(state.writes.map((w) => w.path)).toEqual([
    '/api/customer-programmes',
    '/api/customer-programme-pages',
    '/api/customer-programme-pages',
  ]);
  // The same words are the same publish request.
  expect(state.writes[2]!.body.commandId).toBe(state.writes[1]!.body.commandId);
  expect(state.writes[2]!.body.programmeId).toBe(createdId);
});

test('with the switch off, or without public pages, the page is the one on main', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await standIn(page);
  // On: the first run is there, and the plain create form is kept, folded, under it.
  await page.goto(`${origin}/?room=1&first=1&pages=1`);
  await expect(firstRun(page)).toBeVisible();
  const plain = page.locator('details.first-run-plain');
  await expect(plain).toHaveCount(1);
  await expect(plain.getByRole('heading', { name: 'Create a sample programme' })).toBeHidden();
  await plain.locator('summary').click();
  await expect(plain.getByRole('heading', { name: 'Create a sample programme' })).toBeVisible();
  await expect(plain.getByRole('button', { name: 'Save Sample Programme' })).toBeVisible();
  // Off, and on without public pages: no first run, the Programmes tab first, the create form in its own tab.
  for (const query of ['room=1&first=0&pages=1', 'room=1&first=1&pages=0', 'room=1&pages=1']) {
    await page.goto(`${origin}/?${query}`);
    await expect(page.getByRole('tab').first()).toHaveText('Programmes');
    await expect(page.getByRole('tab', { name: 'Programmes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('No sample programmes yet.')).toBeVisible();
    await expect(page.locator('.first-run, .first-run-plain')).toHaveCount(0);
    await page.getByRole('tab', { name: 'New Sample Programme' }).click();
    await expect(page.getByRole('heading', { name: 'Create a sample programme' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Sample Programme' })).toBeVisible();
    await expect(page.getByLabel('Programme name')).toBeVisible();
    await expect(page.getByLabel('Purpose and intended outcomes')).toBeVisible();
  }
  // Without the room the first run takes the create form's place at the foot of the page, and off leaves the form.
  await page.goto(`${origin}/?first=1&pages=1`);
  await expect(firstRun(page)).toBeVisible();
  await page.goto(`${origin}/?first=0&pages=1`);
  await expect(page.locator('.first-run')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Create a sample programme' })).toBeVisible();
});

test('on a phone the first run fits, keeps its preview one tap away and is accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await standIn(page);
  await page.goto(`${origin}/?room=1&first=1&pages=1&tpl=1`);
  const run = firstRun(page);
  await expect(run.getByRole('heading', { name: 'Step 1 of 3: Name and place' })).toBeVisible();
  const fits = async (step: string) => {
    const size = await page.evaluate(() => ({
      wide: document.documentElement.scrollWidth,
      view: window.innerWidth,
      screens: document.documentElement.scrollHeight / window.innerHeight,
      forms: Array.from(document.querySelectorAll('main form')).filter(
        (form) => form.checkVisibility() && form.getBoundingClientRect().height > 0,
      ).length,
    }));
    expect(size.wide, `${step}: no sideways scroll`).toBeLessThanOrEqual(size.view);
    expect(size.screens, `${step}: at most two phone screens`).toBeLessThanOrEqual(2);
    expect(size.forms, `${step}: one form open`).toBe(1);
    const small = await run
      .locator('button:visible, summary:visible, input:visible, select:visible, textarea:visible')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => {
            // A tick box is as large as its label, which is the thing pressed.
            const target =
              node instanceof HTMLInputElement && node.type === 'checkbox'
                ? (node.closest('label') ?? node)
                : node;
            const box = target.getBoundingClientRect();
            return { name: (target.textContent ?? '').trim().slice(0, 40), height: box.height };
          })
          .filter((box) => box.height < 43.5),
      );
    expect(small, `${step}: touch targets of 44 px`).toEqual([]);
    const axe = await new AxeBuilder({ page }).include('.first-run').analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      `${step}: axe`,
    ).toEqual([]);
  };
  // The preview is closed on a phone and opens in place.
  const fold = page.locator('details.first-run-preview');
  await expect(fold).not.toHaveAttribute('open', '');
  await fits('step 1');
  await fold.locator('summary').click();
  await expect(preview(page)).toBeVisible();
  await fold.locator('summary').click();
  await fillToLastStep(page);
  await fits('step 3');
  // Every action label in the first run is written in Title Case.
  await page.goto(`${origin}/?room=1&first=1&pages=1&tpl=1`);
  const labels: string[] = [];
  const collect = async () =>
    labels.push(
      ...(await page
        .locator('.first-run button, .first-run summary, .first-run-plain > summary')
        .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').trim()))),
    );
  await collect();
  await run.getByRole('button', { name: 'Continue' }).click();
  await collect();
  expect(new Set(labels)).toEqual(
    new Set([
      'Continue',
      'Back',
      'Start Again',
      'Preview Your Page',
      'Create Without a Public Page',
    ]),
  );
  expect(labels.filter((label) => !isTitleCase(label))).toEqual([]);
});

test('the overview puts the next decision first, with counts out of a total', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await standIn(page, { programmes: [existing], applications: { applications: 12, awaiting: 3 } });
  await page.goto(`${origin}/?room=1&first=1&pages=1`);
  const room = page.getByRole('article', { name: existing.name });
  const decision = room.getByRole('region', { name: 'Your next decision' });
  await expect(decision.locator('b')).toHaveText(
    '3 of 12 applications are waiting for your answer',
  );
  const answer = decision.getByRole('button', { name: 'Answer 3 Applications' });
  await expect(answer).toBeVisible();
  // The decision card comes before the views and the facts.
  const order = await room.evaluate((node) =>
    Array.from(node.children).map((child) => child.className.split(' ')[0]),
  );
  expect(order.indexOf('room-next')).toBeGreaterThan(-1);
  expect(order.indexOf('room-next')).toBeLessThan(order.indexOf('room-lenses'));
  // The other decisions follow under it, each with its own count.
  await expect(decision.getByRole('list', { name: 'Then' }).getByRole('listitem')).toHaveText([
    /Get the remaining participants registered\. 1 of 2 invitations used\./,
  ]);
  // Facts: each a count out of its total, and no "Not measured yet" when every read was complete.
  const glance = room.getByRole('region', { name: 'At a glance' });
  const facts = async () =>
    glance
      .locator('dl > div')
      .evaluateAll((rows) =>
        rows.map((row) => [
          row.querySelector('dt')!.textContent,
          row.querySelector('dd')!.textContent!.replace(/\s+/g, ' ').trim(),
        ]),
      );
  await expect.poll(facts).toEqual([
    ['applications answered', '9 of 12'],
    ['invitations used', '1 of 2'],
    ['registered', '1'],
  ]);
  await expect(room.getByRole('region', { name: 'Overview' })).not.toContainText(
    'Not measured yet',
  );
  await expect(room.getByRole('region', { name: 'Needs your attention' })).toHaveCount(0);
  // The vertical stage timeline stays on desktop (owner lock, 12 Nov).
  const stage = room.locator('.room-stage--timeline ol.mr-stage');
  await expect(stage).toBeVisible();
  const tops = await stage
    .locator('li')
    .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
  expect(tops).toHaveLength(6);
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  expect(new Set(tops).size).toBe(6);
  // Every action in the card is Title Case.
  const labels = await decision
    .getByRole('button')
    .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').trim()));
  expect(labels).toEqual(['Answer 3 Applications', 'Refresh Counts', 'Open Participants']);
  expect(labels.filter((label) => !isTitleCase(label))).toEqual([]);
  // The action opens the group that holds the public page, at the applications.
  await answer.click();
  await expect(
    room.getByRole('button', { name: 'Participants and eligibility', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`[id="${existingId}-page"]`)).toBeInViewport();
});

test('"Not measured yet" stays only for a count that cannot be given, and off is the room on main', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await standIn(page, { programmes: [existing], partialParticipants: true });
  await page.goto(`${origin}/?room=1&first=1&pages=1`);
  const room = page.getByRole('article', { name: existing.name });
  // The participants list is longer than the page: the registered count is truly unknown, and says so once.
  const glance = room.getByRole('region', { name: 'At a glance' });
  await expect(glance.locator('dl > div')).toHaveText([/registered\s*Not measured yet/]);
  await expect(room.getByRole('region', { name: 'Your next decision' }).locator('b')).toContainText(
    'Review your participants',
  );
  // Off: the next-step card and the two boarding tiles, as on main.
  await page.goto(`${origin}/?room=1&first=0&pages=1`);
  await expect(room.getByRole('region', { name: 'Your next step' })).toBeVisible();
  await expect(room.getByRole('region', { name: 'Your next decision' })).toHaveCount(0);
  await expect(room.getByRole('region', { name: 'At a glance' }).locator('dl > div dt')).toHaveText(
    ['registered', 'invitations open'],
  );
  await expect(room.locator('.room-stage--timeline ol.mr-stage')).toBeVisible();
});
