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
        const query=new URLSearchParams(location.search);const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)},workspaceId:'00000000-0000-4000-8000-000000000001'};const render=props=>query.get('mode')==='workspaces'?<CustomerWorkspaces {...props} programmesEnabled={query.get('enabled')==='true'}/>:<CustomerProgrammes {...props} roomEnabled={query.get('room')==='true'} participantsEnabled={query.get('people')==='true'}/>;root.render(render(initial));window.addEventListener('fixture-customer-change',event=>root.render(render({...initial,...event.detail})));`,
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

const rename = (page: import('@playwright/test').Page) =>
  page.getByLabel('New programme name', { exact: true });
const archivedRow = (id: string, name: string, version = 2): Row => ({
  ...base,
  id,
  name,
  archived: true,
  version,
});

test('typed text survives the Archived filter on the plain page, with archived programmes and with none', async ({
  page,
}) => {
  for (const initial of [
    [base],
    [base, archivedRow('00000000-0000-4000-8000-000000000003', 'Synthetic archived visit')],
  ]) {
    await serve(page, initial);
    await page.goto(origin);
    await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
    await rename(page).fill('Synthetic text typed before switching');
    await page.getByRole('button', { name: 'Show Archived Programmes', exact: true }).click();
    await expect(rename(page)).toBeHidden();
    await page.getByRole('button', { name: 'Show Active Programmes', exact: true }).click();
    await expect(rename(page)).toHaveValue('Synthetic text typed before switching');
    await page.unrouteAll();
  }
});

test('typed text survives the Archived filter in the room, with none archived', async ({
  page,
}) => {
  await serve(page, [base]);
  await page.goto(origin + '/?room=true');
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  await rename(page).fill('Synthetic text typed in the room');
  await page.getByRole('button', { name: 'Show Archived Programmes', exact: true }).click();
  await expect(page.getByText('No archived programmes.')).toBeVisible();
  await page.getByRole('button', { name: 'Show Active Programmes', exact: true }).click();
  await expect(rename(page)).toHaveValue('Synthetic text typed in the room');
});

test('a stale save keeps what was typed, shows the newer value, and lets the person choose', async ({
  page,
}) => {
  const { rows } = await serve(page, [base]);
  const sent: Array<Record<string, unknown>> = [];
  await page.route('**/api/customer-programme-lifecycle', (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    if (sent.length === 1) {
      rows[0] = { ...rows[0]!, name: 'Synthetic renamed by a colleague', version: 3 };
      return route.fulfill({
        status: 409,
        json: { error: 'Programme changed; reload before saving' },
      });
    }
    rows[0] = { ...rows[0]!, name: body.name, reportingPurpose: body.reportingPurpose, version: 4 };
    return route.fulfill({ json: answer(rows[0]!, 'rename') });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  await rename(page).fill('Synthetic my own new name');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(
    page.getByText('Someone else changed this programme first. It now reads:'),
  ).toBeVisible();
  await expect(
    page.getByText('Synthetic renamed by a colleague', { exact: true }).first(),
  ).toBeVisible();
  await expect(rename(page)).toHaveValue('Synthetic my own new name');
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep Mine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic my own new name' })).toBeVisible();
  expect(sent[1]).toMatchObject({ expectedVersion: 3, name: 'Synthetic my own new name' });
  expect(sent[1]!.commandId).not.toBe(sent[0]!.commandId);
});

test('Use Theirs drops the typed text and shows the newer value', async ({ page }) => {
  const { rows } = await serve(page, [base]);
  await page.route('**/api/customer-programme-lifecycle', (route) => {
    rows[0] = { ...rows[0]!, name: 'Synthetic renamed by a colleague', version: 3 };
    return route.fulfill({
      status: 409,
      json: { error: 'Programme changed; reload before saving' },
    });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  await rename(page).fill('Synthetic my own new name');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.getByRole('button', { name: 'Use Theirs', exact: true }).click();
  await expect(rename(page)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Synthetic renamed by a colleague' }),
  ).toBeVisible();
});

test('the Archived filter lives in the address and Back returns to the active list', async ({
  page,
}) => {
  await serve(page, [
    base,
    archivedRow('00000000-0000-4000-8000-000000000003', 'Synthetic archived visit'),
  ]);
  await page.goto(origin + '/?archived=1');
  await expect(page.getByRole('heading', { name: 'Synthetic archived visit' })).toBeVisible();
  await expect(page.getByRole('heading', { name: base.name })).toBeHidden();
  await page.getByRole('button', { name: 'Show Active Programmes', exact: true }).click();
  await expect(page).not.toHaveURL(/archived=1/);
  await expect(page.getByRole('heading', { name: base.name })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/archived=1/);
  await expect(page.getByRole('heading', { name: 'Synthetic archived visit' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Synthetic archived visit' })).toBeVisible();
});

test('an archived programme on page two is found by the Archived filter, never reported as missing', async ({
  page,
}) => {
  const second = archivedRow(
    '00000000-0000-4000-8000-000000000003',
    'Synthetic archived on page two',
  );
  await page.route('**/api/customer-programmes*', (route) => {
    const after = new URL(route.request().url()).searchParams.get('after');
    return route.fulfill({
      json: after ? list([second]) : { ...list([base]), nextAfter: base.id },
    });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Show Archived Programmes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic archived on page two' })).toBeVisible();
  await expect(page.getByText('No archived programmes.')).toHaveCount(0);
});

test('a link to an archived programme opens it, and a link to an unknown one says so', async ({
  page,
}) => {
  const id = '00000000-0000-4000-8000-000000000003';
  await serve(page, [base, archivedRow(id, 'Synthetic archived visit')]);
  await page.goto(origin + '/?room=true&programme=' + id);
  await expect(page.getByText('Synthetic archived visit').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore Programme', exact: true })).toBeVisible();
  await page.goto(origin + '/?programme=00000000-0000-4000-8000-0000000000ff');
  await expect(page.getByText('That programme is not in this workspace.')).toBeVisible();
});

test('Undo cannot be sent twice by a double click', async ({ page }) => {
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
    await new Promise((done) => setTimeout(done, 300));
    await route.fulfill({ json: answer(rows[0]!, body.operation) });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: base.name })).toBeVisible();
  expect(operations).toEqual(['archive', 'restore']);
});

test('a rate limit says so in the shared words and the retry sends the same command', async ({
  page,
}) => {
  const { rows } = await serve(page, [base]);
  const commands: string[] = [];
  await page.route('**/api/customer-programme-lifecycle', (route) => {
    const body = route.request().postDataJSON();
    commands.push(body.commandId);
    if (commands.length === 1)
      return route.fulfill({ status: 429, json: { error: 'Too many requests' } });
    rows[0] = { ...rows[0]!, archived: true, version: 1 };
    return route.fulfill({ json: answer(rows[0]!, 'archive') });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Too many requests. Try again in an hour.');
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await expect(page.getByText('Programme archived: Synthetic buyers visit.')).toBeVisible();
  expect(commands[1]).toBe(commands[0]);
});

test('an archived programme shows the owner message instead of the invitation form, and Restore brings the form back', async ({
  page,
}) => {
  const { rows } = await serve(page, [
    archivedRow('00000000-0000-4000-8000-000000000003', 'Synthetic archived visit'),
  ]);
  await page.route('**/api/customer-programme-participants*', (route) =>
    route.fulfill({
      json: {
        workspaceId,
        programmeId: rows[0]!.id,
        invitations: [],
        registrations: [],
        nextInvitationAfter: null,
        nextRegistrationAfter: null,
        synthetic: true,
      },
    }),
  );
  await page.route('**/api/customer-programme-lifecycle', async (route) => {
    rows[0] = { ...rows[0]!, archived: false, version: 3 };
    await route.fulfill({ json: answer(rows[0]!, 'restore') });
  });
  await page.goto(origin + '/?people=true&archived=1');
  await page.getByRole('button', { name: 'Manage Sample Participants', exact: true }).click();
  await expect(
    page.getByText(
      'This programme is archived. Restore it to accept new invitations and registrations.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Create Sample Invitation Code/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore Programme', exact: true }).click();
  await page.getByRole('button', { name: 'Show Active Programmes', exact: true }).click();
  // The panel stays open across the filter, and the invitation form is back now that the programme is restored.
  await expect(page.getByRole('button', { name: /Create Sample Invitation Code/ })).toBeVisible();
});

test('archiving keeps the programme mounted, so a typed invitation label survives Undo', async ({
  page,
}) => {
  const { rows } = await serve(page, [base]);
  await page.route('**/api/customer-programme-participants*', (route) =>
    route.fulfill({
      json: {
        workspaceId,
        programmeId: rows[0]!.id,
        invitations: [],
        registrations: [],
        nextInvitationAfter: null,
        nextRegistrationAfter: null,
        synthetic: true,
      },
    }),
  );
  await page.route('**/api/customer-programme-lifecycle', async (route) => {
    const body = route.request().postDataJSON();
    rows[0] = {
      ...rows[0]!,
      archived: body.operation === 'archive',
      version: rows[0]!.version! + 1,
    };
    await route.fulfill({ json: answer(rows[0]!, body.operation) });
  });
  await page.goto(origin + '/?people=true');
  await page.getByRole('button', { name: 'Manage Sample Participants', exact: true }).click();
  const label = page.getByLabel('Invitation label');
  await label.fill('Synthetic label typed before archiving');
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Invitation label')).toHaveValue(
    'Synthetic label typed before archiving',
  );
});

test('a stale rename on a programme from page two keeps the typed text and still shows the choice', async ({
  page,
}) => {
  const secondId = '00000000-0000-4000-8000-000000000003';
  let second: Row = { ...base, id: secondId, name: 'Synthetic page two programme', version: 0 };
  await page.route('**/api/customer-programmes*', (route) => {
    const after = new URL(route.request().url()).searchParams.get('after');
    return route.fulfill({
      json: after ? list([second]) : { ...list([base]), nextAfter: base.id },
    });
  });
  await page.route('**/api/customer-programme-lifecycle', (route) => {
    second = { ...second, name: 'Synthetic renamed by a colleague', version: 3 };
    return route.fulfill({
      status: 409,
      json: { error: 'Programme changed; reload before saving' },
    });
  });
  await page.goto(origin + '/?programme=' + secondId);
  await expect(page.getByRole('heading', { name: 'Synthetic page two programme' })).toBeVisible();
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).nth(1).click();
  await rename(page).fill('Synthetic my own new name');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(
    page.getByText('Someone else changed this programme first. It now reads:'),
  ).toBeVisible();
  await expect(rename(page)).toHaveValue('Synthetic my own new name');
  await expect(page.getByRole('button', { name: 'Keep Mine', exact: true })).toBeVisible();
});

test('Back restores the programme named in the address, not the first one', async ({ page }) => {
  const a = '00000000-0000-4000-8000-000000000003';
  const b = '00000000-0000-4000-8000-000000000004';
  await serve(page, [
    base,
    archivedRow(a, 'Synthetic archived A'),
    archivedRow(b, 'Synthetic archived B'),
  ]);
  await page.goto(origin + '/?room=true&archived=1&programme=' + b);
  const picker = page.getByRole('combobox', { name: 'Programme' });
  await expect(picker).toHaveValue(b);
  await page.getByRole('button', { name: 'Show Active Programmes', exact: true }).click();
  await expect(page).not.toHaveURL(/programme=/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp('programme=' + b));
  await expect(picker).toHaveValue(b);
});

test('a programme archived by someone else during a rename keeps the typed text and offers a way forward', async ({
  page,
}) => {
  const { rows } = await serve(page, [base]);
  const sent: string[] = [];
  await page.route('**/api/customer-programme-lifecycle', (route) => {
    const body = route.request().postDataJSON();
    sent.push(body.operation);
    if (body.operation === 'rename') {
      rows[0] = { ...rows[0]!, archived: true, version: 3 };
      return route.fulfill({
        status: 409,
        json: { error: 'Programme changed; reload before saving' },
      });
    }
    rows[0] = { ...rows[0]!, archived: false, version: 4 };
    return route.fulfill({ json: answer(rows[0]!, 'restore') });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  await rename(page).fill('Synthetic my own new name');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  const notice = page
    .getByRole('alert')
    .filter({ hasText: 'was archived by someone else while you were renaming it' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Show Archived Programmes', exact: true }).click();
  await expect(rename(page)).toHaveValue('Synthetic my own new name');
  await expect(page.getByText('This programme was archived while you were editing.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Restore Programme', exact: true }).click();
  await page.getByRole('button', { name: 'Show Active Programmes', exact: true }).click();
  await expect(rename(page)).toHaveValue('Synthetic my own new name');
  // The typed text is still there and the person is asked to choose, as for any other stale save.
  await expect(page.getByRole('button', { name: 'Keep Mine', exact: true })).toBeVisible();
  expect(sent).toEqual(['rename', 'restore']);
});

test('a stale rename on a programme far down a long list is still refreshed (no fixed page limit)', async ({
  page,
}) => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const pages = 8;
  let target: Row = { ...base, id: id(pages), name: 'Synthetic page 8 programme', version: 0 };
  const rowFor = (n: number): Row =>
    n === pages ? target : { ...base, id: id(n), name: `Synthetic page ${n} programme` };
  await page.route('**/api/customer-programmes*', (route) => {
    const after = new URL(route.request().url()).searchParams.get('after');
    const n = after ? Number(after.slice(-12)) + 1 : 1;
    return route.fulfill({ json: { ...list([rowFor(n)]), nextAfter: n < pages ? id(n) : null } });
  });
  await page.route('**/api/customer-programme-lifecycle', (route) => {
    target = { ...target, name: 'Synthetic renamed by a colleague', version: 3 };
    return route.fulfill({
      status: 409,
      json: { error: 'Programme changed; reload before saving' },
    });
  });
  await page.goto(origin + '/?programme=' + id(pages));
  await expect(page.getByRole('heading', { name: 'Synthetic page 8 programme' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Rename Programme', exact: true })
    .nth(pages - 1)
    .click();
  await rename(page).fill('Synthetic my own new name');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(
    page.getByText('Someone else changed this programme first. It now reads:'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep Mine', exact: true })).toBeVisible();
  await expect(rename(page)).toHaveValue('Synthetic my own new name');
});

const second = '00000000-0000-4000-8000-000000000005';
const third = '00000000-0000-4000-8000-000000000006';

test('a reload while Rename is open never lets Save overwrite a colleague: the choice comes first', async ({
  page,
}) => {
  const { rows } = await serve(page, [base]);
  // The page reloads its list after a new programme is saved, which is the reload a colleague's change rides in on.
  await page.route('**/api/customer-programmes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    rows.push({ ...base, id: second, name: body.name, reportingPurpose: body.reportingPurpose });
    return route.fulfill({ json: rows.at(-1) });
  });
  const sent: Array<Record<string, unknown>> = [];
  await page.route('**/api/customer-programme-lifecycle', (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    rows[0] = { ...rows[0]!, name: body.name, reportingPurpose: body.reportingPurpose, version: 3 };
    return route.fulfill({ json: answer(rows[0]!, 'rename') });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  await rename(page).fill('Synthetic my own new name');
  // A colleague renames it (version 2) while this person is typing, then something reloads the list.
  rows[0] = { ...rows[0]!, name: 'Synthetic renamed by a colleague', version: 2 };
  await page.getByLabel('Programme name', { exact: true }).fill('Synthetic another new programme');
  await page.getByLabel('Purpose and intended outcomes').fill('Fictional second programme purpose');
  await page.getByRole('checkbox', { name: /fictional information/ }).check();
  await page.getByRole('button', { name: 'Save Sample Programme' }).click();
  await expect(
    page.getByText('Someone else changed this programme first. It now reads:'),
  ).toBeVisible();
  await expect(rename(page)).toHaveValue('Synthetic my own new name');
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
  expect(sent).toHaveLength(0);
  // Only the person's own choice sends anything, and it is written on top of the version they have now seen.
  await page.getByRole('button', { name: 'Keep Mine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic my own new name' })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ expectedVersion: 2, name: 'Synthetic my own new name' });
});

test('an active list whose first page is all archived loads on by itself instead of waiting forever', async ({
  page,
}) => {
  await page.route('**/api/customer-programmes*', (route) => {
    const after = new URL(route.request().url()).searchParams.get('after');
    return route.fulfill({
      json: after
        ? list([base])
        : { ...list([archivedRow(second, 'Synthetic archived first')]), nextAfter: second },
    });
  });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: base.name })).toBeVisible();
  await expect(page.getByText('Loading more programmes…')).toHaveCount(0);
});

test('the Archived list stops loading by itself once it has rows, and Load More takes over', async ({
  page,
}) => {
  let afterRequests = 0;
  await page.route('**/api/customer-programmes*', (route) => {
    const after = new URL(route.request().url()).searchParams.get('after');
    if (after) afterRequests += 1;
    return route.fulfill({
      json: after
        ? list([archivedRow(third, 'Synthetic archived on page two')])
        : { ...list([base, archivedRow(second, 'Synthetic archived first')]), nextAfter: second },
    });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Show Archived Programmes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic archived first' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(afterRequests).toBe(0);
  await expect(page.getByRole('heading', { name: 'Synthetic archived on page two' })).toBeHidden();
  await page.getByRole('button', { name: 'Load More Planning Programmes' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic archived on page two' })).toBeVisible();
});

test('archiving the programme in the address keeps the active list and offers Undo', async ({
  page,
}) => {
  const { rows } = await serve(page, [
    base,
    { ...base, id: second, name: 'Synthetic second visit' },
  ]);
  await page.route('**/api/customer-programme-lifecycle', async (route) => {
    const body = route.request().postDataJSON();
    rows[0] = { ...rows[0]!, archived: body.operation === 'archive', version: 1 };
    await route.fulfill({ json: answer(rows[0]!, body.operation) });
  });
  await page.goto(origin + '/?room=true&programme=' + base.id);
  await page.getByRole('button', { name: 'Archive Programme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/archived=1/);
  await expect(
    page.getByRole('button', { name: 'Show Archived Programmes', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic second visit' })).toBeVisible();
});

test('a refresh that returns a malformed page is refused like a malformed list', async ({
  page,
}) => {
  const { rows } = await serve(page, [base]);
  let broken = false;
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({ json: broken ? list([rows[0]!, rows[0]!]) : list(rows) }),
  );
  await page.route('**/api/customer-programme-lifecycle', (route) => {
    broken = true;
    return route.fulfill({
      status: 409,
      json: { error: 'Programme changed; reload before saving' },
    });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  await rename(page).fill('Synthetic my own new name');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(
    page.getByText('The latest version could not be loaded. Reload the page.'),
  ).toBeVisible();
  // The typed text is kept, and Check Again is offered while the latest version is not known.
  await expect(rename(page)).toHaveValue('Synthetic my own new name');
  await expect(page.getByRole('button', { name: 'Check Again', exact: true })).toBeVisible();
  broken = false;
  rows[0] = { ...rows[0]!, name: 'Synthetic renamed by a colleague', version: 3 };
  await page.getByRole('button', { name: 'Check Again', exact: true }).click();
  await expect(
    page.getByText('Someone else changed this programme first. It now reads:'),
  ).toBeVisible();
});

test('a name with a tab or line break inside it is refused on the form, with the name named as the problem', async ({
  page,
}) => {
  await serve(page, [base]);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  await rename(page).evaluate((input: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, 'Synthetic name\twith a tab');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.getByText('The name cannot contain tabs or line breaks.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
});

test('saving a new programme keeps a rename typed on a programme from a later page', async ({
  page,
}) => {
  const later = { ...base, id: second, name: 'Synthetic later page visit' };
  const created = {
    ...base,
    id: third,
    name: 'Synthetic another new programme',
    reportingPurpose: 'Fictional second programme purpose',
  };
  let added = false;
  await page.route('**/api/customer-programmes*', (route) => {
    if (route.request().method() === 'POST') {
      added = true;
      return route.fulfill({ json: created });
    }
    const after = new URL(route.request().url()).searchParams.get('after');
    return route.fulfill({
      json: after
        ? list([later])
        : { ...list(added ? [created, base] : [base]), nextAfter: base.id },
    });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Load More Planning Programmes' }).click();
  const row = page.getByRole('listitem').filter({ hasText: later.name });
  await row.getByRole('button', { name: 'Rename Programme', exact: true }).click();
  await row
    .getByLabel('New programme name', { exact: true })
    .fill('Synthetic typed on a later page');
  await page.getByLabel('Programme name', { exact: true }).fill(created.name);
  await page.getByLabel('Purpose and intended outcomes').fill('Fictional second programme purpose');
  await page.getByRole('checkbox', { name: /fictional information/ }).check();
  await page.getByRole('button', { name: 'Save Sample Programme' }).click();
  await expect(page.getByRole('heading', { name: created.name })).toBeVisible();
  await expect(row.getByLabel('New programme name', { exact: true })).toHaveValue(
    'Synthetic typed on a later page',
  );
});

test('in a linked Archived list, picking another archived programme stays in the Archived list', async ({
  page,
}) => {
  const a = '00000000-0000-4000-8000-0000000000a1';
  const b = '00000000-0000-4000-8000-0000000000b2';
  await serve(page, [
    base,
    archivedRow(a, 'Synthetic archived alpha'),
    archivedRow(b, 'Synthetic archived bravo'),
  ]);
  await page.goto(origin + '/?room=true&programme=' + a);
  await expect(page.getByRole('heading', { name: 'Synthetic archived alpha' })).toBeVisible();
  await page.getByLabel('Programme', { exact: true }).selectOption(b);
  await expect(page.getByRole('heading', { name: 'Synthetic archived bravo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore Programme', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Show Active Programmes', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/archived=1/);
});

test('in a linked Archived list, restoring one keeps the remaining archived programmes', async ({
  page,
}) => {
  const a = '00000000-0000-4000-8000-0000000000a1';
  const b = '00000000-0000-4000-8000-0000000000b2';
  const c = '00000000-0000-4000-8000-0000000000c3';
  const { rows } = await serve(page, [
    base,
    archivedRow(a, 'Synthetic archived alpha'),
    archivedRow(b, 'Synthetic archived bravo'),
    archivedRow(c, 'Synthetic archived charlie'),
  ]);
  await page.route('**/api/customer-programme-lifecycle', async (route) => {
    const body = route.request().postDataJSON();
    const at = rows.findIndex((r) => r.id === body.programmeId);
    rows[at] = { ...rows[at]!, archived: false, version: 3 };
    await route.fulfill({ json: answer(rows[at]!, 'restore') });
  });
  await page.goto(origin + '/?programme=' + b);
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Synthetic archived bravo' })
    .getByRole('button', { name: 'Restore Programme', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Synthetic archived alpha' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic archived charlie' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Show Active Programmes', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/archived=1/);
});
