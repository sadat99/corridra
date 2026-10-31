import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-tpl-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000006';
const programmeId = '00000000-0000-4000-8000-000000000007';
const secondProgramme = '00000000-0000-4000-8000-000000000008';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {ProgrammeTemplates} from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-templates.tsx'))};const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)},workspaceId:${JSON.stringify(workspaceId)},programmes:[{id:${JSON.stringify(programmeId)},name:'Synthetic first programme'},{id:${JSON.stringify(secondProgramme)},name:'Synthetic second programme'}],onChanged:()=>{window.__changed=(window.__changed||0)+1}};const render=p=>{const all={...initial,...p};root.render(<ProgrammeTemplates key={all.issuer+all.subject+all.workspaceId} {...all}/>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
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

declare global {
  interface Window {
    __changed?: number;
  }
}
const templateId = (n: number) => '00000000-0000-4000-8000-0000000003' + String(n).padStart(2, '0');
const content = (over: Record<string, unknown> = {}) => ({
  reportingPurpose: 'Synthetic buyer mission to the spring trade fair',
  capacity: 20,
  tasks: [
    {
      title: 'Synthetic book the hotel block',
      detail: 'Synthetic twenty rooms near the venue',
      dueOffsetDays: 0,
      assigneeLabel: null,
    },
    {
      title: 'Synthetic confirm the factory visits',
      detail: null,
      dueOffsetDays: 14,
      assigneeLabel: 'Synthetic local guide Rahim',
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
  ...over,
});
const tpl = (n: number, over: Record<string, unknown> = {}) => ({
  id: templateId(n),
  seq: n,
  version: 2,
  name: 'Synthetic spring fair delegation',
  description: 'Synthetic a repeatable plan for the spring fair',
  retired: false,
  content: content(),
  taskCount: 2,
  costCount: 1,
  capacity: 20,
  updatedAt: '2026-10-19T00:00:00Z',
  provenance: 'ORGANISER_RECORDED',
  ...over,
});
function listBody(rows: unknown[] = [tpl(1)], ttl = 60000) {
  return {
    workspaceId,
    expiresAt: new Date(Date.now() + ttl).toISOString(),
    templates: rows,
    nextAfter: null,
  };
}
type Handler = {
  list?: () => unknown;
  capture?: (url: URL) => { status?: number; json: unknown };
  post?: (body: Record<string, unknown>) => { status?: number; json: unknown };
  created?: (body: Record<string, unknown>) => { status?: number; json: unknown };
  seen?: { headers: Record<string, string>[]; urls: string[] };
};
async function mock(page: Page, handler: Handler = {}) {
  await page.route('**/api/customer-programme-templates**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    handler.seen?.headers.push(request.headers());
    handler.seen?.urls.push(request.url());
    if (request.method() === 'GET') {
      if (url.searchParams.get('view') === 'capture') {
        const out = handler.capture?.(url) ?? {
          json: {
            workspaceId,
            programmeId: url.searchParams.get('programmeId'),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            content: content({ capacity: null }),
          },
        };
        return route.fulfill({ status: out.status ?? 200, json: out.json });
      }
      return route.fulfill({ json: handler.list?.() ?? listBody() });
    }
    const out = handler.post!(request.postDataJSON());
    return route.fulfill({ status: out.status ?? 200, json: out.json });
  });
  await page.route('**/api/customer-programmes', (route) => {
    const body = route.request().postDataJSON();
    const out = handler.created?.(body) ?? {
      json: {
        id: '00000000-0000-4000-8000-0000000000c1',
        workspaceId,
        name: body.name,
        reportingPurpose: body.reportingPurpose,
        createdAt: '2026-10-19T00:00:00Z',
        synthetic: true,
      },
    };
    return route.fulfill({ status: out.status ?? 200, json: out.json });
  });
}
const saved = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const ok = (body: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  json: {
    workspaceId,
    commandId: (body.input as Record<string, unknown>).commandId,
    replayed: false,
    ...extra,
  },
});

test('templates are listed with their counts and offer use, edit and retire', async ({ page }) => {
  await mock(page, {
    list: () => listBody([tpl(1), tpl(2, { name: 'Synthetic retired older plan', retired: true })]),
  });
  await page.goto(origin);
  await expect(
    page.getByText('It holds no participants, fees, payments or results', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Synthetic spring fair delegation' }),
  ).toContainText('2 tasks · 1 planned cost · capacity 20');
  await expect(
    page.getByRole('button', { name: 'Use template Synthetic spring fair delegation' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Use template Synthetic retired older plan' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Restore template Synthetic retired older plan' }),
  ).toBeVisible();
});
test('an empty workspace invites the first template', async ({ page }) => {
  await mock(page, { list: () => listBody([]) });
  await page.goto(origin);
  await expect(page.getByText('No templates yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New template' })).toBeVisible();
});
test('a new template is validated, converts amounts exactly and sends only the four content parts', async ({
  page,
}) => {
  const seen = { headers: [] as Record<string, string>[], urls: [] as string[] };
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    seen,
    post: (b) => {
      commands.push(b);
      return ok(b, { template: tpl(3) });
    },
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByLabel('Template name (start with Synthetic)').fill('Synthetic autumn expo plan');
  await page.getByLabel('Default programme purpose (start with Synthetic)').fill('Buyer mission');
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'default programme purpose with the word Synthetic',
  );
  await page
    .getByLabel('Default programme purpose (start with Synthetic)')
    .fill('Synthetic buyer mission to the autumn expo');
  await page.getByLabel('Places available (optional)').fill('0');
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('alert')).toContainText('Capacity must be a whole number');
  await page.getByLabel('Places available (optional)').fill('15');
  await page.getByRole('button', { name: 'Add a task' }).click();
  await page.getByLabel('Task 1 title').fill('Synthetic print the badges');
  await page.getByLabel('Task 1 due days after the start (optional)').fill('-3');
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('alert')).toContainText('due offset is a whole number of days');
  await page.getByLabel('Task 1 due days after the start (optional)').fill('7');
  await page.getByRole('button', { name: 'Add a planned cost' }).click();
  await page.getByLabel('Cost 1 description').fill('Synthetic printing run');
  await page.getByLabel('Cost 1 amount (2 decimal places)').fill('1234.567');
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('alert')).toContainText('enter a positive amount');
  expect(commands).toHaveLength(0);
  await page.getByLabel('Cost 1 amount (2 decimal places)').fill('1234.50');
  await page.getByRole('button', { name: 'Add a planned cost' }).click();
  await page.getByLabel('Cost 2 description').fill('Synthetic hall hire in yen');
  await page.getByLabel('Cost 2 currency').selectOption('JPY');
  await page.getByLabel('Cost 2 type').selectOption('ORGANISER_OBLIGATION');
  await page.getByLabel('Cost 2 amount (0 decimal places)').fill('1500');
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(saved(page, 'Template created.')).toBeVisible();
  expect(commands[0]).toMatchObject({
    action: 'save',
    input: {
      workspaceId,
      expectedVersion: 0,
      templateId: null,
      name: 'Synthetic autumn expo plan',
      description: null,
      retired: false,
      content: {
        reportingPurpose: 'Synthetic buyer mission to the autumn expo',
        capacity: 15,
        tasks: [
          {
            title: 'Synthetic print the badges',
            detail: null,
            dueOffsetDays: 7,
            assigneeLabel: null,
          },
        ],
        plannedCosts: [
          {
            kind: 'ORGANISER_EXPENSE',
            description: 'Synthetic printing run',
            currency: 'BDT',
            amountMinor: '123450',
          },
          {
            kind: 'ORGANISER_OBLIGATION',
            description: 'Synthetic hall hire in yen',
            currency: 'JPY',
            amountMinor: '1500',
          },
        ],
      },
    },
  });
  expect(Object.keys((commands[0] as { input: { content: object } }).input.content).sort()).toEqual(
    ['capacity', 'plannedCosts', 'reportingPurpose', 'tasks'],
  );
  expect(
    seen.headers.every(
      (h) =>
        h['x-corridra-customer-subject'] === 'synthetic-alice' &&
        h['x-corridra-customer-issuer'] === issuer,
    ),
  ).toBe(true);
});
test('editing prefills exact amounts and sends the template id and version', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (b) => {
      commands.push(b);
      return ok(b, { template: tpl(1, { version: 3 }) });
    },
  });
  await page.goto(origin);
  await page
    .getByRole('button', { name: 'Edit template Synthetic spring fair delegation' })
    .click();
  await expect(page.getByLabel('Cost 1 amount (2 decimal places)')).toHaveValue('50000.50');
  await expect(page.getByLabel('Task 2 who is responsible (optional)')).toHaveValue(
    'Synthetic local guide Rahim',
  );
  await page.getByLabel('Places available (optional)').fill('25');
  await page.getByRole('button', { name: 'Remove task 1' }).click();
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(saved(page, 'Template saved.')).toBeVisible();
  expect(commands[0]).toMatchObject({
    input: {
      templateId: templateId(1),
      expectedVersion: 2,
      content: { capacity: 25, plannedCosts: [{ amountMinor: '5000050' }] },
    },
  });
  expect(
    (commands[0] as { input: { content: { tasks: unknown[] } } }).input.content.tasks,
  ).toHaveLength(1);
});
test('a template is retired and restored with its content unchanged', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (b) => {
      commands.push(b);
      return ok(b, { template: tpl(1) });
    },
  });
  await page.goto(origin);
  await page
    .getByRole('button', { name: 'Retire template Synthetic spring fair delegation' })
    .click();
  await expect(saved(page, 'Template retired.')).toBeVisible();
  expect(commands[0]).toMatchObject({
    input: { templateId: templateId(1), expectedVersion: 2, retired: true, content: content() },
  });
});
test('capturing a programme plan fills the form and changes nothing until the template is saved', async ({
  page,
}) => {
  const seen = { headers: [] as Record<string, string>[], urls: [] as string[] };
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    seen,
    post: (b) => {
      commands.push(b);
      return ok(b, { template: tpl(4) });
    },
  });
  await page.goto(origin);
  await page.getByLabel('Capture the plan of a programme').selectOption(programmeId);
  await page.getByRole('button', { name: 'Capture plan' }).click();
  await expect(saved(page, 'Plan captured')).toBeVisible();
  expect(commands).toHaveLength(0);
  expect(
    seen.urls.some((u) => u.includes('view=capture') && u.includes('programmeId=' + programmeId)),
  ).toBe(true);
  await expect(page.getByLabel('Task 1 title')).toHaveValue('Synthetic book the hotel block');
  await page
    .getByLabel('Template name (start with Synthetic)')
    .fill('Synthetic captured plan from a run');
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(saved(page, 'Template created.')).toBeVisible();
  expect(commands[0]).toMatchObject({ input: { templateId: null, content: { capacity: null } } });
  // Nothing chosen: refuse without a request.
  await page.getByLabel('Capture the plan of a programme').selectOption('');
  await page.getByRole('button', { name: 'Capture plan' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose a programme');
});
test('a capture for another programme is rejected instead of used', async ({ page }) => {
  await mock(page, {
    capture: () => ({
      json: {
        workspaceId,
        programmeId: secondProgramme,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        content: content(),
      },
    }),
  });
  await page.goto(origin);
  await page.getByLabel('Capture the plan of a programme').selectOption(programmeId);
  await page.getByRole('button', { name: 'Capture plan' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByLabel('Task 1 title')).toHaveCount(0);
});
test('using a template for a new programme creates it with the default purpose, then applies it', async ({
  page,
}) => {
  const created: Record<string, unknown>[] = [];
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    created: (b) => {
      created.push(b);
      return {
        json: {
          id: '00000000-0000-4000-8000-0000000000c1',
          workspaceId,
          name: b.name,
          reportingPurpose: b.reportingPurpose,
          createdAt: '2026-10-19T00:00:00Z',
          synthetic: true,
        },
      };
    },
    post: (b) => {
      commands.push(b);
      return ok(b, {
        programmeId: '00000000-0000-4000-8000-0000000000c1',
        templateId: templateId(1),
        templateVersion: 2,
        tasksCreated: 2,
        plannedCostsCreated: 1,
        capacity: 20,
        startDate: '2026-11-01',
      });
    },
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Use template Synthetic spring fair delegation' }).click();
  await page.getByLabel('New programme name (start with Synthetic)').fill('Programme');
  await page.getByRole('button', { name: 'Apply template' }).click();
  await expect(page.getByRole('alert')).toContainText('programme name with the word Synthetic');
  expect(created).toHaveLength(0);
  await page
    .getByLabel('New programme name (start with Synthetic)')
    .fill('Synthetic spring fair 2027');
  await page.getByLabel(/Programme start date/).fill('2026-11-01');
  await page.getByRole('button', { name: 'Apply template' }).click();
  await expect(
    saved(page, 'Template applied: 2 tasks and 1 planned costs were added.'),
  ).toBeVisible();
  expect(created[0]).toMatchObject({
    workspaceId,
    name: 'Synthetic spring fair 2027',
    reportingPurpose: 'Synthetic buyer mission to the spring trade fair',
    acknowledged: true,
  });
  expect(commands[0]).toMatchObject({
    action: 'apply',
    input: {
      programmeId: '00000000-0000-4000-8000-0000000000c1',
      templateId: templateId(1),
      expectedVersion: 2,
      startDate: '2026-11-01',
    },
  });
  expect(await page.evaluate(() => window.__changed)).toBeGreaterThan(0);
});
test('using a template for an existing programme does not create one', async ({ page }) => {
  const created: Record<string, unknown>[] = [];
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    created: (b) => {
      created.push(b);
      return { json: {} };
    },
    post: (b) => {
      commands.push(b);
      return ok(b, {
        programmeId: secondProgramme,
        templateId: templateId(1),
        templateVersion: 2,
        tasksCreated: 2,
        plannedCostsCreated: 1,
        capacity: 20,
        startDate: null,
      });
    },
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Use template Synthetic spring fair delegation' }).click();
  await page.getByLabel('Where should it go?').selectOption(secondProgramme);
  await page.getByRole('button', { name: 'Apply template' }).click();
  await expect(saved(page, 'Template applied')).toBeVisible();
  expect(created).toHaveLength(0);
  expect(commands[0]).toMatchObject({ input: { programmeId: secondProgramme, startDate: null } });
});
test('if applying fails after creating the programme, the retry reuses the same commands', async ({
  page,
}) => {
  const created: Record<string, unknown>[] = [];
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    created: (b) => {
      created.push(b);
      return {
        json: {
          id: '00000000-0000-4000-8000-0000000000c1',
          workspaceId,
          name: b.name,
          reportingPurpose: b.reportingPurpose,
          createdAt: '2026-10-19T00:00:00Z',
          synthetic: true,
        },
      };
    },
    post: (b) => {
      commands.push(b);
      return commands.length === 1
        ? { status: 500, json: { error: 'x' } }
        : ok(b, {
            programmeId: '00000000-0000-4000-8000-0000000000c1',
            templateId: templateId(1),
            templateVersion: 2,
            tasksCreated: 2,
            plannedCostsCreated: 1,
            capacity: 20,
            startDate: null,
          });
    },
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Use template Synthetic spring fair delegation' }).click();
  await page
    .getByLabel('New programme name (start with Synthetic)')
    .fill('Synthetic spring fair 2028');
  await page.getByRole('button', { name: 'Apply template' }).click();
  await expect(page.getByRole('alert')).toContainText('try again');
  expect(await page.evaluate(() => window.__changed)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Apply template' }).click();
  await expect(saved(page, 'Template applied')).toBeVisible();
  expect(created).toHaveLength(2);
  expect(created[1]).toEqual(created[0]);
  expect(commands[1]).toEqual(commands[0]);
});
test('a refused application keeps the form and explains it', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Use template Synthetic spring fair delegation' }).click();
  await page.getByLabel('Where should it go?').selectOption(programmeId);
  await page.getByRole('button', { name: 'Apply template' }).click();
  await expect(page.getByRole('alert')).toContainText('programme is not empty');
  await expect(page.getByLabel('Where should it go?')).toHaveValue(programmeId);
});
test('a failed save keeps what was typed and retries with the identical command', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (b) => {
      commands.push(b);
      return commands.length === 1
        ? { status: 500, json: { error: 'x' } }
        : ok(b, { template: tpl(5) });
    },
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'New template' }).click();
  await page
    .getByLabel('Template name (start with Synthetic)')
    .fill('Synthetic retry safe template');
  await page
    .getByLabel('Default programme purpose (start with Synthetic)')
    .fill('Synthetic a retry safe purpose');
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('alert')).toContainText('try again');
  await expect(page.getByLabel('Template name (start with Synthetic)')).toHaveValue(
    'Synthetic retry safe template',
  );
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(saved(page, 'Template created.')).toBeVisible();
  expect(commands[1]).toEqual(commands[0]);
});
test('a changed account on save clears every private detail', async ({ page }) => {
  await mock(page, {
    post: () => ({
      status: 409,
      json: { error: 'Your account changed. Reload before continuing.' },
    }),
  });
  await page.goto(origin);
  await page
    .getByRole('button', { name: 'Retire template Synthetic spring fair delegation' })
    .click();
  await expect(page.getByRole('alert')).toContainText('access changed');
  await expect(page.getByText('Synthetic spring fair delegation')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
for (const status of [401, 403])
  test('save ' + status + ' clears private details', async ({ page }) => {
    await mock(page, { post: () => ({ status, json: { error: 'Denied' } }) });
    await page.goto(origin);
    await page
      .getByRole('button', { name: 'Retire template Synthetic spring fair delegation' })
      .click();
    await expect(page.getByText('Synthetic spring fair delegation')).toHaveCount(0);
  });
test('read 403 shows a denial and read 503 says unavailable', async ({ page }) => {
  await page.route('**/api/customer-programme-templates**', (route) =>
    route.fulfill({ status: 403, json: { error: 'Denied' } }),
  );
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('access changed');
  await page.unroute('**/api/customer-programme-templates**');
  await page.route('**/api/customer-programme-templates**', (route) =>
    route.fulfill({ status: 503, json: { error: 'x' } }),
  );
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'unavailable' })).toBeVisible();
});
test('responses for another workspace or with invalid templates are rejected', async ({ page }) => {
  for (const body of [
    { ...listBody(), workspaceId: '00000000-0000-4000-8000-0000000000ff' },
    listBody([
      tpl(1, {
        content: content({
          plannedCosts: [
            {
              kind: 'PARTICIPANT_FEE',
              description: 'Synthetic fee',
              currency: 'BDT',
              amountMinor: '5',
            },
          ],
        }),
      }),
    ]),
    listBody([
      tpl(1, {
        content: content({
          plannedCosts: [
            {
              kind: 'ORGANISER_EXPENSE',
              description: 'Synthetic cost',
              currency: 'BDT',
              amountMinor: '5.5',
            },
          ],
        }),
      }),
    ]),
    listBody([tpl(1, { provenance: 'VERIFIED' })]),
  ]) {
    await page.unroute('**/api/customer-programme-templates**').catch(() => undefined);
    await mock(page, { list: () => body });
    await page.goto(origin);
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
    await expect(page.getByText('Synthetic spring fair delegation')).toHaveCount(0);
  }
});
test('access expiry clears the list without extending permission', async ({ page }) => {
  await mock(page, { list: () => listBody([tpl(1)], 700) });
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByText('Synthetic spring fair delegation')).toHaveCount(0);
});
test('changing the signed-in account discards the previous account data', async ({ page }) => {
  await mock(page);
  await page.goto(origin);
  await expect(page.getByText('Synthetic spring fair delegation').first()).toBeVisible();
  await page.unroute('**/api/customer-programme-templates**');
  await mock(page, { list: () => listBody([]) });
  await page.evaluate(
    (i) =>
      window.dispatchEvent(
        new CustomEvent('fixture-customer-change', {
          detail: { subject: 'synthetic-bob', issuer: i },
        }),
      ),
    issuer,
  );
  await expect(page.getByText('No templates yet.')).toBeVisible();
  await expect(page.getByText('Synthetic spring fair delegation')).toHaveCount(0);
});
for (const width of [320, 390, 768, 1440])
  test('keyboard and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mock(page);
    await page.goto(origin);
    await page
      .getByRole('button', { name: 'Edit template Synthetic spring fair delegation' })
      .click();
    await expect(page.getByLabel('Task 1 title')).toBeVisible();
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
      await mkdir('.cache/v3-programme-templates/after', { recursive: true });
      await page.screenshot({
        path: '.cache/v3-programme-templates/after/editor-320.png',
        fullPage: true,
      });
    }
  });
