import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {CustomerProgrammes} from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};import {CustomerWorkspaces} from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
        const query=new URLSearchParams(location.search);const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)},workspaceId:'00000000-0000-4000-8000-000000000001'};const render=props=>query.get('mode')==='workspaces'?<CustomerWorkspaces {...props} programmesEnabled={query.get('enabled')==='true'}/>:<CustomerProgrammes {...props} roomEnabled={query.get('room')==='true'}/>;root.render(render(initial));window.addEventListener('fixture-customer-change',event=>root.render(render({...initial,...event.detail})));`,
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
    define: { 'process.env.NODE_ENV': '"production"' },
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
    } else if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic component protocol fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic component protocol fixture</h1><div id="fixture"></div><section id="customer-missions"><h2>Existing shared mission section</h2></section></main><script type="module" src="/fixture.js"></script></body></html>`,
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

// CRUD gap G7: rename, archive and restore on the organiser screen, with the API mocked (component protocol only).
const workspaceId = '00000000-0000-4000-8000-000000000001';
type Row = {
  id: string;
  workspaceId: string;
  name: string;
  reportingPurpose: string;
  createdAt: string;
  synthetic: boolean;
  archived?: boolean;
  version?: number;
};
const base: Row = {
  id: '00000000-0000-4000-8000-000000000002',
  workspaceId,
  name: 'Synthetic buyers visit',
  reportingPurpose: 'Fictional buyer visit planning only',
  createdAt: '2026-10-18T00:00:00Z',
  synthetic: true,
  archived: false,
  version: 0,
};
const list = (programmes: Row[]) => ({ workspaceId, programmes, nextAfter: null, synthetic: true });
const answer = (row: Row, operation: string) => ({
  ...row,
  operation,
  commandId: 'x',
  replayed: false,
});
async function serve(page: import('@playwright/test').Page, initial: Row[]) {
  const rows = initial.map((r) => ({ ...r }));
  const sent: Array<Record<string, unknown>> = [];
  await page.route('**/api/customer-programmes*', (route) => route.fulfill({ json: list(rows) }));
  return { rows, sent };
}

test('the controls stay hidden where the module is not installed (no version in the list)', async ({
  page,
}) => {
  const { version, archived, ...old } = base;
  void version;
  void archived;
  await serve(page, [old as Row]);
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: base.name })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Rename Programme|Archive Programme/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Archived Programmes/ })).toHaveCount(0);
});

test('rename saves only a real change, sends the version it saw, and shows the answer in place', async ({
  page,
}) => {
  const { rows, sent } = await serve(page, [base]);
  await page.route('**/api/customer-programme-lifecycle', async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    expect(route.request().headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    rows[0] = { ...rows[0]!, name: body.name, reportingPurpose: body.reportingPurpose, version: 1 };
    await route.fulfill({ json: answer(rows[0]!, 'rename') });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save Changes', exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel('New programme name', { exact: true }).fill('Synthetic buyers visit 2027');
  await expect(save).toBeEnabled();
  await page.getByLabel('New programme name', { exact: true }).fill('ab');
  await expect(save).toBeDisabled();
  await page.getByLabel('New programme name', { exact: true }).fill('Synthetic buyers visit 2027');
  await save.click();
  await expect(page.getByRole('heading', { name: 'Synthetic buyers visit 2027' })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    operation: 'rename',
    workspaceId,
    programmeId: base.id,
    expectedVersion: 0,
    name: 'Synthetic buyers visit 2027',
    reportingPurpose: base.reportingPurpose,
  });
  expect(sent[0]!.commandId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole('button', { name: 'Rename Programme', exact: true })).toBeVisible();
});

test('a lost answer repeats the very same command, so nothing is changed twice', async ({
  page,
}) => {
  const { rows } = await serve(page, [base]);
  const commands: Array<Record<string, unknown>> = [];
  await page.route('**/api/customer-programme-lifecycle', async (route) => {
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) return route.abort('failed');
    rows[0] = { ...rows[0]!, archived: true, version: 1 };
    return route.fulfill({ json: answer(rows[0]!, 'archive') });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await expect(page.getByText('Programme archived: Synthetic buyers visit.')).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});

test('archive removes it from the list with an Undo, and the Archived filter lists it with Restore Programme', async ({
  page,
}) => {
  const { rows } = await serve(page, [base]);
  const operations: string[] = [];
  await page.route('**/api/customer-programme-lifecycle', async (route) => {
    const body = route.request().postDataJSON();
    operations.push(body.operation);
    rows[0] = {
      ...rows[0]!,
      archived: body.operation === 'archive',
      version: rows[0]!.version! + 1,
    };
    await route.fulfill({ json: answer(rows[0]!, body.operation) });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await expect(page.getByRole('heading', { name: base.name })).toHaveCount(0);
  await expect(page.getByText('No sample programmes yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('heading', { name: base.name })).toBeVisible();
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await page.getByRole('button', { name: 'Show Archived Programmes', exact: true }).click();
  await expect(page.getByRole('heading', { name: base.name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename Programme', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore Programme', exact: true }).click();
  await expect(page.getByText('No archived programmes.')).toBeVisible();
  expect(operations).toEqual(['archive', 'restore', 'archive', 'restore']);
});

test('the Undo goes away by itself after ten seconds', async ({ page }) => {
  const { rows } = await serve(page, [base]);
  await page.route('**/api/customer-programme-lifecycle', async (route) => {
    rows[0] = { ...rows[0]!, archived: true, version: 1 };
    await route.fulfill({ json: answer(rows[0]!, 'archive') });
  });
  await page.clock.install();
  await page.goto(origin);
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await page.clock.fastForward(10500);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
});

test('a stale version shows the plain message and reloads the latest', async ({ page }) => {
  let loads = 0;
  const { rows } = await serve(page, [base]);
  await page.route('**/api/customer-programmes*', (route) => {
    loads += 1;
    return route.fulfill({ json: list(rows) });
  });
  await page.route('**/api/customer-programme-lifecycle', (route) => {
    rows[0] = { ...rows[0]!, name: 'Synthetic renamed by a colleague', version: 4 };
    return route.fulfill({
      status: 409,
      json: { error: 'Programme changed; reload before saving' },
    });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed by someone else');
  await expect(
    page.getByRole('heading', { name: 'Synthetic renamed by a colleague' }),
  ).toBeVisible();
  // The reload remounts the controls at the new version; the words must survive it.
  await expect(page.getByRole('alert')).toContainText('changed by someone else');
  expect(loads).toBeGreaterThan(1);
});

test('a restore that the cap refuses says why in plain words', async ({ page }) => {
  await serve(page, [{ ...base, archived: true, version: 3 }]);
  await page.route('**/api/customer-programme-lifecycle', (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: 'Archive another programme first: this workspace already has 100 active programmes',
      },
    }),
  );
  await page.goto(origin);
  await page.getByRole('button', { name: 'Show Archived Programmes', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Programme', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already has 100 active programmes');
});

test('Escape discards at once when nothing changed and asks first when something did', async ({
  page,
}) => {
  await serve(page, [base]);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('New programme name', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  await page.getByLabel('New programme name', { exact: true }).fill('Synthetic changed name here');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Discard your changes?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep Editing', exact: true }).click();
  await expect(page.getByLabel('New programme name', { exact: true })).toHaveValue(
    'Synthetic changed name here',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  await expect(page.getByLabel('New programme name', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: base.name })).toBeVisible();
});

test('the rename form and the archived list have no accessibility violations', async ({ page }) => {
  await serve(page, [
    base,
    {
      ...base,
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Synthetic archived visit',
      archived: true,
      version: 2,
    },
  ]);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Archived Programmes', exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('in the room, switching the Archived filter keeps the opened room mounted so typed text survives', async ({
  page,
}) => {
  const archived: Row = {
    ...base,
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Synthetic archived visit',
    archived: true,
    version: 2,
  };
  await serve(page, [base, archived]);
  await page.goto(origin + '/?room=true');
  const active = page
    .locator('li', { has: page.getByRole('button', { name: 'Archive Programme', exact: true }) })
    .first();
  await expect(active).toBeVisible();
  await active.evaluate((node) => node.setAttribute('data-mark', 'kept'));
  await page.getByRole('button', { name: 'Show Archived Programmes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore Programme', exact: true })).toBeVisible();
  await expect(page.locator('li[data-mark="kept"]')).toBeHidden();
  await page.getByRole('button', { name: 'Show Active Programmes', exact: true }).click();
  await expect(page.locator('li[data-mark="kept"]')).toBeVisible();
});
