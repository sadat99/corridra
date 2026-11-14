import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isTitleCase } from '../../apps/web/lib/ux/title-case';
import { buyingTripStarterSave } from '../../apps/web/app/account/delegations/buying-trip-starter';

// ADR-084 slice S7, behind CORRIDRA_DELEGATION_BUYING_TRIP: the Buying Trip starter in the first run's template choice
// and in the programme templates list, as the real components in the customer frame against a small stateful stand-in
// for the routes that already exist. Component protocol fixtures, not database acceptance: the save and apply
// commands are proven where they were built. Names are made up; the fixture runs in sample mode.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const createdId = '00000000-0000-4000-8000-000000000003';
const savedId = '00000000-0000-4000-8000-000000000012';
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
            roomEnabled={on('room')} firstRunEnabled={on('first')} buyingTripEnabled={on('trip')}/>
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
type Stored = Record<string, unknown> & { id: string; name: string };
const sampleStarter = buyingTripStarterSave(true);
const existing: Stored = {
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
    plannedCosts: [],
  },
  taskCount: 1,
  costCount: 0,
  capacity: 20,
  updatedAt: '2026-10-19T00:00:00Z',
  provenance: 'ORGANISER_RECORDED',
};
const later = () => new Date(Date.now() + 3600000).toISOString();

/** The routes the screens call, answered from a small state. Every write is recorded in order. */
async function standIn(page: Page, options: { templates?: Stored[]; saveAnswers?: number[] } = {}) {
  const state = {
    templates: [...(options.templates ?? [])],
    saveAnswers: [...(options.saveAnswers ?? [])],
    writes: [] as Write[],
    published: null as null | { copy: Record<string, unknown>; closesAt: string },
    programmes: [] as Record<string, unknown>[],
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
  await page.route('**/api/customer-programme-templates*', (route) => {
    const request = route.request();
    if (request.method() === 'GET')
      return route.fulfill({
        json: { workspaceId, expiresAt: later(), templates: state.templates, nextAfter: null },
      });
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    state.writes.push({ method: 'POST', path: new URL(request.url()).pathname, body });
    const input = body.input as Record<string, unknown>;
    if (body.action === 'save') {
      const status = state.saveAnswers.shift() ?? 200;
      if (status !== 200)
        return route.fulfill({ status, json: { error: 'This could not be done as asked' } });
      const content = input.content as { tasks: unknown[] };
      const made: Stored = {
        id: savedId,
        seq: state.templates.length + 1,
        version: 1,
        name: input.name as string,
        description: input.description as string,
        retired: false,
        content,
        taskCount: content.tasks.length,
        costCount: 0,
        capacity: null,
        updatedAt: new Date().toISOString(),
        provenance: 'ORGANISER_RECORDED',
      };
      state.templates.push(made);
      return route.fulfill({
        json: {
          commandId: input.commandId,
          workspaceId,
          replayed: false,
          expiresAt: later(),
          template: made,
        },
      });
    }
    return route.fulfill({
      json: {
        commandId: input.commandId,
        programmeId: input.programmeId,
        templateId: input.templateId,
        tasksCreated: 6,
        plannedCostsCreated: 0,
      },
    });
  });
  await page.route('**/api/customer-programme-pages*', (route) => {
    const request = route.request();
    if (request.method() === 'GET')
      return route.fulfill({
        json: state.published
          ? {
              version: 1,
              state: 'OPEN',
              address: 'synthetic-buying-trip-k3f9x2ab7q',
              copy: state.published.copy,
              closesAt: state.published.closesAt,
              applications: 0,
              awaiting: 0,
              sample: true,
            }
          : { version: 0, state: 'NONE', applications: 0, awaiting: 0, sample: true },
      });
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    state.writes.push({ method: 'POST', path: new URL(request.url()).pathname, body });
    state.published = {
      copy: body.copy as Record<string, unknown>,
      closesAt: body.closesAt as string,
    };
    return route.fulfill({ json: { version: 1, state: 'OPEN' } });
  });
  await page.route('**/api/customer-programmes*', (route) => {
    const request = route.request();
    if (request.method() === 'GET')
      return route.fulfill({
        json: { workspaceId, programmes: state.programmes, nextAfter: null, synthetic: true },
      });
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    state.writes.push({ method: 'POST', path: new URL(request.url()).pathname, body });
    const made = {
      id: createdId,
      workspaceId,
      name: body.name,
      reportingPurpose: body.reportingPurpose,
      createdAt: new Date().toISOString(),
      synthetic: true,
    };
    if (!state.programmes.some((p) => p.id === made.id)) state.programmes.unshift(made);
    return route.fulfill({ status: 201, json: made });
  });
  return state;
}
const firstRunRegion = (page: Page) => page.getByRole('region', { name: 'Set up your delegation' });
const firstRun = (page: Page) => firstRunRegion(page).locator('.first-run-form');
const preview = (page: Page) => page.getByRole('region', { name: 'Your public page so far' });
const choice = (page: Page) => firstRun(page).getByLabel('Start from a template (optional)');
const picker = (page: Page) => page.getByRole('region', { name: 'Sample programme templates' });
const starterLabel = 'Buying trip (starter)';
const optionsOf = async (page: Page) => {
  await expect(choice(page)).toBeVisible();
  return choice(page).locator('option').allTextContents();
};
const openPicker = async (page: Page) => {
  await page.getByRole('tab', { name: 'Templates' }).click();
  await expect(
    picker(page).getByRole('heading', { name: 'Repeatable programme templates' }),
  ).toBeVisible();
  await expect(picker(page).getByText(/^Loading/)).toHaveCount(0);
};

async function fillToStep(page: Page, last: number, pick?: string) {
  const run = firstRun(page);
  await run.getByLabel('Programme name').fill('Synthetic machinery buying trip');
  await run.getByLabel('Where').fill('Guangzhou, China');
  if (pick) await choice(page).selectOption({ label: pick });
  if (last === 1) return;
  await run.getByRole('button', { name: 'Continue' }).click();
  await run.getByLabel('When').fill('12 to 16 March 2027');
  await run.getByLabel('Who should apply').fill('Synthetic importers of farm machinery.');
  await run.getByLabel('What it is for').fill('Synthetic visit to machinery makers for importers.');
  await run.getByRole('button', { name: 'Continue' }).click();
  await run.getByRole('button', { name: 'Continue' }).click();
  await expect(run.getByRole('heading', { name: 'Step 4 of 4: Review and publish' })).toBeFocused();
}
async function publish(page: Page) {
  const run = firstRun(page);
  await run.getByLabel('I am using made-up information for sample planning only.').check();
  await run.getByLabel(/^I checked this page\./).check();
  await run.getByRole('button', { name: 'Publish the Page' }).click();
}

test('with the switch off the template choice and the templates list are the ones on main', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // No template in the workspace: no template choice at all, exactly as before.
  await standIn(page);
  await page.goto(`${origin}/?room=1&first=1&pages=1&tpl=1`);
  await expect(firstRun(page).locator('form label.field')).toHaveCount(2);
  await expect(choice(page)).toHaveCount(0);
  await openPicker(page);
  await expect(picker(page).getByText('No templates yet.')).toBeVisible();
  await expect(picker(page).getByText(starterLabel)).toHaveCount(0);
  await expect(picker(page).getByRole('button', { name: 'Save Buying Trip Starter' })).toHaveCount(
    0,
  );
  // One template of the workspace's own: only that one is offered.
  const state = await standIn(page, { templates: [existing] });
  await page.goto(`${origin}/?room=1&first=1&pages=1&tpl=1`);
  await expect(choice(page)).toBeVisible();
  expect(await optionsOf(page)).toHaveLength(2);
  expect((await optionsOf(page)).join('|')).not.toContain('Buying trip');
  expect(state.writes).toEqual([]);
});

test('with the switch on the first run offers the starter, pre-fills three planned lines and saves it once before applying it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await standIn(page);
  await page.goto(`${origin}/?room=1&first=1&pages=1&tpl=1&trip=1`);
  const run = firstRun(page);
  // Step 1 still shows at most three fields.
  await expect(run.locator('form label.field')).toHaveCount(3);
  expect(await optionsOf(page)).toEqual(['No template', starterLabel]);
  // Nothing is planned on the page until the starter is chosen.
  await expect(preview(page)).not.toContainText('Factory visits');
  await fillToStep(page, 1, starterLabel);
  await expect(choice(page)).toHaveValue('starter:buying-trip');
  for (const line of ['Factory visits', 'Host meetings', 'Sample review'])
    await expect(preview(page)).toContainText(line);
  await expect(preview(page)).toContainText('0 confirmed, 3 planned');
  expect(state.writes, 'nothing is written before Publish').toEqual([]);
  expect(
    (await new AxeBuilder({ page }).include('.first-run-form').analyze()).violations,
    'axe on step 1 with the starter chosen',
  ).toEqual([]);
  // The draft survives a reload with the starter still chosen.
  await page.reload();
  await expect(choice(page)).toHaveValue('starter:buying-trip');
  await run.getByRole('button', { name: 'Continue' }).click();
  await run.getByLabel('When').fill('12 to 16 March 2027');
  await run.getByLabel('Who should apply').fill('Synthetic importers of farm machinery.');
  await run.getByLabel('What it is for').fill('Synthetic visit to machinery makers for importers.');
  await run.getByRole('button', { name: 'Continue' }).click();
  await run.getByRole('button', { name: 'Continue' }).click();
  await publish(page);
  await expect(
    page.getByText('Published. Your programme is saved and its page is public.'),
  ).toBeVisible();
  // The existing commands, in order: create, save the starter, apply it, publish.
  expect(
    state.writes.map((w) => `${w.method} ${w.path} ${String(w.body.action ?? '')}`.trim()),
  ).toEqual([
    'POST /api/customer-programmes',
    'POST /api/customer-programme-templates save',
    'POST /api/customer-programme-templates apply',
    'POST /api/customer-programme-pages publish',
  ]);
  const [, save, apply, publishWrite] = state.writes;
  const saved = save!.body.input as Record<string, unknown>;
  expect(Object.keys(saved).sort()).toEqual([
    'commandId',
    'content',
    'description',
    'expectedVersion',
    'name',
    'retired',
    'templateId',
    'workspaceId',
  ]);
  expect(saved).toMatchObject({
    workspaceId,
    templateId: null,
    expectedVersion: 0,
    retired: false,
    name: sampleStarter.name,
    description: sampleStarter.description,
    content: sampleStarter.content,
  });
  // The starter holds tasks only: six tasks, no planned cost.
  const content = saved.content as { tasks: unknown[]; plannedCosts: unknown[] };
  expect(content.tasks).toHaveLength(6);
  expect(content.plannedCosts).toEqual([]);
  expect(apply!.body.input).toMatchObject({
    workspaceId,
    programmeId: createdId,
    templateId: savedId,
    expectedVersion: 1,
    startDate: null,
  });
  // The page carries the three lines as PLANNED, never CONFIRMED, and nothing else changed in its words.
  const copy = publishWrite!.body.copy as Record<string, unknown>;
  expect(copy.activities).toEqual([
    { label: 'Factory visits', status: 'PLANNED' },
    { label: 'Host meetings', status: 'PLANNED' },
    { label: 'Sample review', status: 'PLANNED' },
  ]);
  expect(copy.fee).toBeUndefined();
  // No person, fee schedule, cost or payment was created along the way.
  expect(
    state.writes.filter((w) => /participants|pricing|terms|economics|payment|fee/.test(w.path)),
  ).toEqual([]);
});

test('a failed save keeps the draft, and a second press saves the starter once and creates the programme once', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await standIn(page, { saveAnswers: [500] });
  await page.goto(`${origin}/?room=1&first=1&pages=1&tpl=1&trip=1`);
  const run = firstRun(page);
  await fillToStep(page, 4, starterLabel);
  await publish(page);
  await expect(run.getByRole('alert')).toBeVisible();
  await expect(run.getByRole('heading', { name: 'Step 4 of 4: Review and publish' })).toBeVisible();
  expect(state.writes.map((w) => `${w.path} ${String(w.body.action ?? '')}`.trim())).toEqual([
    '/api/customer-programmes',
    '/api/customer-programme-templates save',
  ]);
  await run.getByRole('button', { name: 'Publish the Page' }).click();
  await expect(
    page.getByText('Published. Your programme is saved and its page is public.'),
  ).toBeVisible();
  expect(state.writes.map((w) => `${w.path} ${String(w.body.action ?? '')}`.trim())).toEqual([
    '/api/customer-programmes',
    '/api/customer-programme-templates save',
    '/api/customer-programme-templates save',
    '/api/customer-programme-templates apply',
    '/api/customer-programme-pages publish',
  ]);
  // The retry is the same save command, so the server can answer it once.
  const ids = state.writes
    .filter((w) => w.body.action === 'save')
    .map((w) => (w.body.input as Record<string, unknown>).commandId);
  expect(ids[0]).toBe(ids[1]);
  expect(state.templates).toHaveLength(1);
});

test('a template of the workspace that already has the starter name is chosen from the list and is never saved again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // A template with another name sits beside the starter; one with the starter's own name replaces it.
  await standIn(page, { templates: [existing] });
  await page.goto(`${origin}/?room=1&first=1&pages=1&tpl=1&trip=1`);
  expect(await optionsOf(page)).toEqual(['No template', existing.name, starterLabel]);
  const state = await standIn(page, {
    templates: [{ ...existing, id: savedId, name: sampleStarter.name, version: 3 }],
  });
  await page.goto(`${origin}/?room=1&first=1&pages=1&tpl=1&trip=1`);
  expect(await optionsOf(page)).toEqual(['No template', sampleStarter.name]);
  await fillToStep(page, 4, sampleStarter.name);
  await publish(page);
  await expect(
    page.getByText('Published. Your programme is saved and its page is public.'),
  ).toBeVisible();
  expect(state.writes.map((w) => `${w.path} ${String(w.body.action ?? '')}`.trim())).toEqual([
    '/api/customer-programmes',
    '/api/customer-programme-templates apply',
    '/api/customer-programme-pages publish',
  ]);
  expect((state.writes[1]!.body.input as Record<string, unknown>).expectedVersion).toBe(3);
  await openPicker(page);
  await expect(picker(page).getByRole('button', { name: 'Save Buying Trip Starter' })).toHaveCount(
    0,
  );
});

test('the templates list offers the starter as one row that saves once and then becomes an ordinary template', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await standIn(page);
  await page.goto(`${origin}/?room=1&first=1&pages=1&tpl=1&trip=1`);
  await openPicker(page);
  const row = picker(page).locator('p', { hasText: starterLabel });
  await expect(row).toContainText('6 tasks');
  await expect(row).toContainText('no costs');
  const save = row.getByRole('button', { name: 'Save Buying Trip Starter' });
  expect(isTitleCase('Save Buying Trip Starter')).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .include('[aria-label="Sample programme templates"]')
        .disableRules(['heading-order'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await save.click();
  await expect(picker(page).getByText('Template created.')).toBeVisible();
  await expect(picker(page).getByText(`${sampleStarter.name} · version 1`)).toBeVisible();
  await expect(picker(page).getByText('6 tasks · 0 planned costs')).toBeVisible();
  await expect(picker(page).getByRole('button', { name: 'Save Buying Trip Starter' })).toHaveCount(
    0,
  );
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]!.body).toMatchObject({
    action: 'save',
    input: {
      templateId: null,
      expectedVersion: 0,
      name: sampleStarter.name,
      content: sampleStarter.content,
    },
  });
  // It is a normal template now, usable and editable through the existing actions.
  await expect(
    picker(page).getByRole('button', { name: `Use Template ${sampleStarter.name}` }),
  ).toBeVisible();
});

// Heights of the first run form (step 1) and the templates list, at the three widths. With one template in the
// workspace the starter adds an option to a select that is already there, so nothing may grow.
for (const width of [390, 768, 1440]) {
  test(`the first run and the templates list are no taller than before at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const measure = async (query: string, templates: Stored[]) => {
      await standIn(page, { templates });
      await page.goto(`${origin}/?${query}`);
      await expect(firstRun(page)).toBeVisible();
      if (templates.length) await expect(choice(page)).toBeVisible();
      const form = (await firstRun(page).boundingBox())!.height;
      await openPicker(page);
      const list = (await picker(page).boundingBox())!.height;
      return { form: Math.round(form), list: Math.round(list) };
    };
    const base = 'room=1&first=1&pages=1&tpl=1';
    const withOne = [existing];
    const off = await measure(base, withOne);
    const on = await measure(`${base}&trip=1`, withOne);
    const offEmpty = await measure(base, []);
    const onEmpty = await measure(`${base}&trip=1`, []);
    info.annotations.push({
      type: 'heights',
      description: JSON.stringify({ width, off, on, offEmpty, onEmpty }),
    });
    console.log('HEIGHTS ' + JSON.stringify({ width, off, on, offEmpty, onEmpty }));
    // The first run's step 1 grows by nothing where the select already exists.
    expect(on.form).toBe(off.form);
    // Where the workspace has no template yet, the starter brings the one select that was not there.
    expect(onEmpty.form).toBeGreaterThan(offEmpty.form);
    // The list gains the one starter row, and nothing else.
    expect(on.list).toBeGreaterThan(off.list);
    expect(onEmpty.list).toBeGreaterThan(offEmpty.list);
  });
}
