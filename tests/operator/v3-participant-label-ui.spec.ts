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
      contents: `import {createRoot} from 'react-dom/client';import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';import {ParticipantAccount} from ${JSON.stringify(resolve('apps/web/app/account/delegations/participant-account.tsx'))};import {ProgrammeParticipants} from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-participants.tsx'))};import {CustomerProgrammes} from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};const root=createRoot(document.getElementById('fixture'));const query=new URLSearchParams(location.search);const initial={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)},workspaceId:'00000000-0000-4000-8000-000000000001',programmeId:'00000000-0000-4000-8000-000000000002'};const router={push:path=>location.assign(path),replace:path=>location.replace(path),back:()=>history.back(),forward:()=>history.forward(),refresh:()=>{},hmrRefresh:()=>{},prefetch:async()=>{}};const render=p=>{const all={...initial,...p};root.render(<AppRouterContext.Provider value={router}>{query.get('mode')==='owner'?<section><h2>Current programme controls</h2><ProgrammeParticipants {...all}/></section>:query.get('mode')==='context'?<CustomerProgrammes subject={all.subject} issuer={all.issuer} workspaceId={all.workspaceId} participantsEnabled={query.get('enabled')==='true'}/>:<ParticipantAccount subject={all.subject} issuer={all.issuer}/>}</AppRouterContext.Provider>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
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
    // Next replaces browser compile-time environment constants in its real build.
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

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => console.error('Component fixture runtime error:', error.message));
});

// CRUD gap G7 module 2: correcting a participant label, by the participant and by the organiser (API mocked, component protocol only).
const workspaceId = '00000000-0000-4000-8000-000000000001',
  programmeId = '00000000-0000-4000-8000-000000000002',
  registrationId = '00000000-0000-4000-8000-000000000004';
type State = { label: string; version: number | undefined };
const row = (state: State) => ({
  id: registrationId,
  displayLabel: state.label,
  consentedAt: '2026-10-18T00:00:00Z',
  status: 'REGISTERED',
  ...(state.version === undefined ? {} : { labelVersion: state.version }),
});
const ownRow = (state: State) => ({
  ...row(state),
  programmeId,
  name: 'Synthetic international programme',
  reportingPurpose: 'Synthetic shared programme purpose,no private commercial details',
  synthetic: true,
});
async function serve(
  page: import('@playwright/test').Page,
  state: State,
  onLabel?: (body: Record<string, unknown>) => unknown,
) {
  const posted: Array<Record<string, unknown>> = [];
  await page.route('**/api/customer-programme-participants*', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      const own = new URL(request.url()).searchParams.get('view') === 'own';
      return route.fulfill({
        json: own
          ? { registrations: [ownRow(state)], nextAfter: null, synthetic: true }
          : {
              workspaceId,
              programmeId,
              invitations: [],
              registrations: [row(state)],
              nextInvitationAfter: null,
              nextRegistrationAfter: null,
              synthetic: true,
            },
      });
    }
    const body = request.postDataJSON();
    posted.push(body);
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    const outcome = onLabel?.(body);
    if (outcome === 'abort') return route.abort('failed');
    if (outcome === 'stale')
      return route.fulfill({ status: 409, json: { error: 'Label changed; reload before saving' } });
    state.label = String(body.displayLabel);
    state.version = Number(body.expectedVersion) + 1;
    return route.fulfill({
      json: {
        registrationId,
        programmeId,
        displayLabel: state.label,
        labelVersion: state.version,
        changedBy: 'participant',
        synthetic: true,
      },
    });
  });
  return posted;
}
const form = (page: import('@playwright/test').Page) =>
  page.getByRole('form', { name: 'Change label' });

test('the controls stay hidden where label correction is not installed (no label version)', async ({
  page,
}) => {
  await serve(page, { label: 'Synthetic participant label', version: undefined });
  await page.goto(origin);
  await expect(page.getByText('Synthetic participant label')).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit My Label|Edit Label/ })).toHaveCount(0);
});

test('a participant corrects their own label: only the registration, the version they saw and the new label are sent', async ({
  page,
}) => {
  const state: State = { label: 'Synthetic participant label', version: 0 };
  const posted = await serve(page, state);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Edit My Label', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save Label', exact: true });
  await expect(save).toBeDisabled();
  await form(page).getByLabel('New display label').fill('Synthetic participant Bob Rahman');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByText('Synthetic participant Bob Rahman · Registered, self-declared'),
  ).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    action: 'label',
    registrationId,
    expectedVersion: 0,
    displayLabel: 'Synthetic participant Bob Rahman',
  });
  expect(Object.keys(posted[0]!).sort()).toEqual([
    'action',
    'commandId',
    'displayLabel',
    'expectedVersion',
    'registrationId',
  ]);
  await expect(page.getByRole('button', { name: 'Edit My Label', exact: true })).toBeVisible();
});

test('an organiser corrects a label from the registrations list', async ({ page }) => {
  const state: State = { label: 'Synthetic participant label', version: 2 };
  const posted = await serve(page, state);
  await page.goto(origin + '?mode=owner');
  await page.getByRole('button', { name: 'Edit Label', exact: true }).click();
  await form(page).getByLabel('New display label').fill('Synthetic participant Rahman');
  await page.getByRole('button', { name: 'Save Label', exact: true }).click();
  await expect(page.getByText('Synthetic participant Rahman', { exact: true })).toBeVisible();
  expect(posted[0]).toMatchObject({ registrationId, expectedVersion: 2 });
});

test('a lost answer repeats the very same command', async ({ page }) => {
  const state: State = { label: 'Synthetic participant label', version: 0 };
  let attempts = 0;
  const posted = await serve(page, state, () => (++attempts === 1 ? 'abort' : undefined));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Edit My Label', exact: true }).click();
  await form(page).getByLabel('New display label').fill('Synthetic participant Bob Rahman');
  await page.getByRole('button', { name: 'Save Label', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await page.getByRole('button', { name: 'Save Label', exact: true }).click();
  await expect(
    page.getByText('Synthetic participant Bob Rahman · Registered, self-declared'),
  ).toBeVisible();
  expect(posted).toHaveLength(2);
  expect(posted[1]).toEqual(posted[0]);
});

test('a stale version shows the plain message, closes the form and reloads the latest label', async ({
  page,
}) => {
  const state: State = { label: 'Synthetic participant label', version: 0 };
  await serve(page, state, () => {
    state.label = 'Synthetic label set by the organiser';
    state.version = 3;
    return 'stale';
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Edit My Label', exact: true }).click();
  await form(page).getByLabel('New display label').fill('Synthetic participant Bob Rahman');
  await page.getByRole('button', { name: 'Save Label', exact: true }).click();
  await expect(
    page.getByText('Synthetic label set by the organiser · Registered, self-declared'),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('changed by someone else');
});

test('Escape discards at once when nothing changed and asks first when something did; the form has no accessibility violations', async ({
  page,
}) => {
  await serve(page, { label: 'Synthetic participant label', version: 0 });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Edit My Label', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(form(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit My Label', exact: true }).click();
  await form(page).getByLabel('New display label').fill('Synthetic changed label here');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Discard your change?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep Editing', exact: true }).click();
  await expect(form(page).getByLabel('New display label')).toHaveValue(
    'Synthetic changed label here',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard Change', exact: true }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(
    page.getByText('Synthetic participant label · Registered, self-declared'),
  ).toBeVisible();
});

test('a stale save keeps the typed label, shows the newer one and lets the person choose', async ({
  page,
}) => {
  const state: State = { label: 'Synthetic participant label', version: 0 };
  let first = true;
  const posted = await serve(page, state, () => {
    if (!first) return undefined;
    first = false;
    state.label = 'Synthetic label set by the organiser';
    state.version = 3;
    return 'stale';
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Edit My Label', exact: true }).click();
  await form(page).getByLabel('New display label').fill('Synthetic participant Bob Rahman');
  await page.getByRole('button', { name: 'Save Label', exact: true }).click();
  await expect(
    page.getByText('This label was changed by someone else. It now reads:'),
  ).toBeVisible();
  await expect(
    page.getByText('Synthetic label set by the organiser', { exact: true }),
  ).toBeVisible();
  await expect(form(page).getByLabel('New display label')).toHaveValue(
    'Synthetic participant Bob Rahman',
  );
  await expect(page.getByRole('button', { name: 'Save Label', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep Mine', exact: true }).click();
  await expect(
    page.getByText('Synthetic participant Bob Rahman · Registered, self-declared'),
  ).toBeVisible();
  expect(posted).toHaveLength(2);
  expect(posted[1]).toMatchObject({
    expectedVersion: 3,
    displayLabel: 'Synthetic participant Bob Rahman',
  });
  expect(posted[1]!.commandId).not.toBe(posted[0]!.commandId);
});

test('Use Theirs drops the typed label and shows the newer one', async ({ page }) => {
  const state: State = { label: 'Synthetic participant label', version: 0 };
  await serve(page, state, () => {
    state.label = 'Synthetic label set by the organiser';
    state.version = 3;
    return 'stale';
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Edit My Label', exact: true }).click();
  await form(page).getByLabel('New display label').fill('Synthetic participant Bob Rahman');
  await page.getByRole('button', { name: 'Save Label', exact: true }).click();
  await page.getByRole('button', { name: 'Use Theirs', exact: true }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(
    page.getByText('Synthetic label set by the organiser · Registered, self-declared'),
  ).toBeVisible();
});

test('a reload while the editor is open never lets Save overwrite someone else: the choice comes first', async ({
  page,
}) => {
  const state: State = { label: 'Synthetic participant label', version: 0 };
  const posted = await serve(page, state);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Edit My Label', exact: true }).click();
  await form(page).getByLabel('New display label').fill('Synthetic participant Bob Rahman');
  // Someone else changes it (version 2), then the page reloads its list.
  state.label = 'Synthetic label set by the organiser';
  state.version = 2;
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(
    page.getByText('This label was changed by someone else. It now reads:'),
  ).toBeVisible();
  await expect(form(page).getByLabel('New display label')).toHaveValue(
    'Synthetic participant Bob Rahman',
  );
  await expect(page.getByRole('button', { name: 'Save Label', exact: true })).toBeDisabled();
  expect(posted).toHaveLength(0);
  await page.getByRole('button', { name: 'Keep Mine', exact: true }).click();
  await expect(
    page.getByText('Synthetic participant Bob Rahman · Registered, self-declared'),
  ).toBeVisible();
  expect(posted[0]).toMatchObject({ expectedVersion: 2 });
});

test('a rate limit uses the shared wording and the retry sends the same command', async ({
  page,
}) => {
  const state: State = { label: 'Synthetic participant label', version: 0 };
  let attempts = 0;
  const posted = await serve(page, state, () => (++attempts === 1 ? 'limited' : undefined));
  await page.unroute('**/api/customer-programme-participants*');
  const original = posted;
  await page.route('**/api/customer-programme-participants*', async (route) => {
    const request = route.request();
    if (request.method() === 'GET')
      return route.fulfill({
        json: { registrations: [ownRow(state)], nextAfter: null, synthetic: true },
      });
    const body = request.postDataJSON();
    original.push(body);
    if (original.length === 1)
      return route.fulfill({ status: 429, json: { error: 'Too many requests' } });
    state.label = String(body.displayLabel);
    state.version = Number(body.expectedVersion) + 1;
    return route.fulfill({
      json: {
        registrationId,
        programmeId,
        displayLabel: state.label,
        labelVersion: state.version,
        changedBy: 'participant',
        synthetic: true,
      },
    });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Edit My Label', exact: true }).click();
  await form(page).getByLabel('New display label').fill('Synthetic participant Bob Rahman');
  await page.getByRole('button', { name: 'Save Label', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Too many requests. Try again in an hour.');
  await page.getByRole('button', { name: 'Save Label', exact: true }).click();
  await expect(
    page.getByText('Synthetic participant Bob Rahman · Registered, self-declared'),
  ).toBeVisible();
  expect(original).toHaveLength(2);
  expect(original[1]).toEqual(original[0]);
});
