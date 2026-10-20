import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
const workspaceId = '00000000-0000-4000-8000-000000000001',
  programmeId = '00000000-0000-4000-8000-000000000002',
  invitationId = '00000000-0000-4000-8000-000000000003',
  registrationId = '00000000-0000-4000-8000-000000000004';
const token = 'a'.repeat(43),
  expires = () => new Date(Date.now() + 3600000).toISOString();
const invitation = (id = invitationId) => ({
  id,
  label: 'Synthetic participant invitation',
  expiresAt: expires(),
  status: 'ISSUED',
});
const registration = () => ({
  id: registrationId,
  displayLabel: 'Synthetic participant label',
  consentedAt: '2026-10-18T00:00:00Z',
  status: 'REGISTERED',
});
const ownRegistration = () => ({
  ...registration(),
  programmeId,
  name: 'Synthetic international programme 工厂 বাংলা',
  reportingPurpose: 'Synthetic shared programme purpose,no private commercial details',
  synthetic: true,
});
const manage = (
  invitations: unknown[] = [],
  registrations: unknown[] = [],
  nextInvitationAfter: string | null = null,
  nextRegistrationAfter: string | null = null,
) => ({
  workspaceId,
  programmeId,
  invitations,
  registrations,
  nextInvitationAfter,
  nextRegistrationAfter,
  synthetic: true,
});
const own = (registrations: unknown[] = [], nextAfter: string | null = null) => ({
  registrations,
  nextAfter,
  synthetic: true,
});
const preview = () => ({
  programmeId,
  name: 'Synthetic international programme 工厂 বাংলা',
  reportingPurpose: 'Synthetic shared programme purpose,no private commercial details',
  expiresAt: expires(),
  synthetic: true,
});
test('owner issues a real scoped command,shows the secret once and follows a relative participant route without a token URL', async ({
  page,
}) => {
  let issued = false;
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-participants*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json:
          new URL(route.request().url()).searchParams.get('view') === 'own'
            ? own()
            : manage(issued ? [invitation()] : []),
      });
    const value = route.request().postDataJSON();
    requests.push(value);
    expect(route.request().headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    issued = true;
    return route.fulfill({
      json: {
        id: invitationId,
        programmeId,
        expiresAt: expires(),
        issued: true,
        token,
        synthetic: true,
      },
    });
  });
  await page.goto(origin + '?mode=owner');
  await expect(page.getByText('No sample invitations yet.', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /share this sample code/ }).check();
  await page.getByRole('button', { name: 'Create sample invitation code' }).click();
  await expect(page.getByLabel('Private sample invitation code', { exact: true })).toHaveValue(
    token,
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    action: 'invite',
    workspaceId,
    programmeId,
    acknowledged: true,
    label: 'Synthetic participant invitation',
  });
  expect(requests[0].commandId).toMatch(/^[0-9a-f-]{36}$/);
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
  expect(page.url()).not.toContain(token);
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('link', { name: 'Delegation registrations', exact: true }).click();
  await expect(page).toHaveURL(origin + '/account/delegations');
  await expect(page.getByRole('heading', { name: 'Inspect a sample invitation' })).toBeVisible();
  expect(page.url()).not.toContain(token);
});
test('participant inspects the actual programme and explicitly consents before registering;no profile or workspace grant is invented', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  let accepted = false;
  await page.route('**/api/customer-programme-participants*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: own(accepted ? [ownRegistration()] : []) });
    const v = route.request().postDataJSON();
    posts.push(v);
    if (v.action === 'preview') return route.fulfill({ json: preview() });
    accepted = true;
    return route.fulfill({
      json: { id: registrationId, programmeId, status: 'REGISTERED', synthetic: true },
    });
  });
  await page.goto(origin);
  await page.getByLabel('Private sample invitation code', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Preview sample invitation' }).click();
  await expect(page.getByRole('heading', { name: preview().name })).toBeVisible();
  await page
    .getByLabel('Fictional display name', { exact: true })
    .fill('Synthetic participant label');
  await page.getByRole('button', { name: 'Register for sample programme' }).click();
  expect(posts).toHaveLength(1);
  await page.getByRole('checkbox', { name: /consent to sharing/ }).check();
  await page.getByRole('button', { name: 'Register for sample programme' }).click();
  await expect(
    page.getByText('Synthetic participant label · Registered, self-declared', { exact: true }),
  ).toBeVisible();
  expect(posts[1]).toMatchObject({
    action: 'accept',
    token,
    programmeId,
    displayLabel: 'Synthetic participant label',
    consented: true,
  });
  expect(Object.keys(posts[1]).sort()).toEqual([
    'action',
    'commandId',
    'consented',
    'displayLabel',
    'programmeId',
    'token',
  ]);
  await expect(page.getByLabel('Private sample invitation code', { exact: true })).toHaveValue('');
});
test('uncertain registration retains exact text,code and command;wrong-scope acknowledgements cannot invent success', async ({
  page,
}) => {
  let attempts = 0,
    accepted = false;
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-participants*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: own(accepted ? [ownRegistration()] : []) });
    const v = route.request().postDataJSON();
    if (v.action === 'preview') return route.fulfill({ json: preview() });
    bodies.push(v);
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        json: {
          id: registrationId,
          programmeId: '00000000-0000-4000-8000-000000000099',
          status: 'REGISTERED',
          synthetic: true,
        },
      });
    accepted = true;
    return route.fulfill({
      json: { id: registrationId, programmeId, status: 'REGISTERED', synthetic: true },
    });
  });
  await page.goto(origin);
  await page.getByLabel('Private sample invitation code', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Preview sample invitation' }).click();
  await page
    .getByLabel('Fictional display name', { exact: true })
    .fill('Synthetic participant label');
  await page.getByRole('checkbox', { name: /consent to sharing/ }).check();
  await page.getByRole('button', { name: 'Register for sample programme' }).click();
  await expect(page.getByText(/Saving could not be confirmed/)).toBeVisible();
  await expect(page.getByText('No sample registrations yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register for sample programme' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry same programme request' }).click();
  await expect(
    page.getByText('Synthetic participant label · Registered, self-declared', { exact: true }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});
test('lost issuance never regenerates a secret or creates a second invitation during exact retry', async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  let issued = false;
  await page.route('**/api/customer-programme-participants*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: manage(issued ? [invitation()] : []) });
    bodies.push(route.request().postDataJSON());
    issued = true;
    if (bodies.length === 1)
      return route.fulfill({ status: 500, json: { error: 'Unconfirmed response' } });
    return route.fulfill({
      json: {
        id: invitationId,
        programmeId,
        expiresAt: expires(),
        issued: false,
        token: null,
        synthetic: true,
      },
    });
  });
  await page.goto(origin + '?mode=owner');
  await page.getByRole('checkbox', { name: /share this sample code/ }).check();
  await page.getByRole('button', { name: 'Create sample invitation code' }).click();
  await expect(page.getByText(/Saving could not be confirmed/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry same participant request' }).click();
  await expect(page.getByText(/secret cannot be recovered/)).toBeVisible();
  await expect(page.getByLabel('Private sample invitation code', { exact: true })).toHaveCount(0);
  expect(bodies[1]).toEqual(bodies[0]);
  await expect(page.getByRole('button', { name: 'Revoke invitation', exact: true })).toHaveCount(1);
});
test('organiser access changes require explicit reason and confirmation and update only the selected registration', async ({
  page,
}) => {
  let revoked = false;
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-participants*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: manage([], [{ ...registration(), status: revoked ? 'REVOKED' : 'REGISTERED' }]),
      });
    const v = route.request().postDataJSON();
    posts.push(v);
    revoked = true;
    return route.fulfill({
      json: { id: registrationId, programmeId, status: 'REVOKED', synthetic: true },
    });
  });
  await page.goto(origin + '?mode=owner');
  await expect(page.getByLabel('Reason for access change', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Revoke programme access', exact: true }).click();
  await expect(page.getByLabel('Reason for access change', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 1000 });
  await mkdir('.cache/v3-participants/after', { recursive: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: '.cache/v3-participants/after/owner-access-320.png',
    fullPage: true,
  });
  expect(posts).toHaveLength(0);
  await expect(page.getByRole('alert')).toHaveText(
    'Give a reason and confirm the programme access change.',
  );
  await page
    .getByLabel('Reason for access change', { exact: true })
    .fill('Synthetic programme access cancellation');
  await page.getByRole('checkbox', { name: /confirm this access change/ }).check();
  await page.getByRole('button', { name: 'Confirm access change', exact: true }).click();
  await expect(page.getByText('Programme access revoked', { exact: true })).toBeVisible();
  expect(posts[0]).toMatchObject({
    action: 'revoke',
    kind: 'registration',
    targetId: registrationId,
    workspaceId,
    programmeId,
    acknowledged: true,
  });
});
test('participant withdrawal is explicit,scoped and removes stale programme metadata from the refreshed own view', async ({
  page,
}) => {
  let withdrawn = false;
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-participants*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: own(
          withdrawn
            ? [{ id: registrationId, programmeId, status: 'WITHDRAWN', synthetic: true }]
            : [ownRegistration()],
        ),
      });
    posts.push(route.request().postDataJSON());
    withdrawn = true;
    return route.fulfill({
      json: { id: registrationId, programmeId, status: 'WITHDRAWN', synthetic: true },
    });
  });
  await page.goto(origin);
  await expect(page.getByLabel('Reason for withdrawal', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Withdraw from programme', exact: true }).click();
  await expect(page.getByLabel('Reason for withdrawal', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 1000 });
  await mkdir('.cache/v3-participants/after', { recursive: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: '.cache/v3-participants/after/account-withdraw-320.png',
    fullPage: true,
  });
  expect(posts).toHaveLength(0);
  await page
    .getByLabel('Reason for withdrawal', { exact: true })
    .fill('Synthetic participant requests withdrawal');
  await page.getByRole('checkbox', { name: /confirm withdrawal/ }).check();
  await page.getByRole('button', { name: 'Confirm withdrawal', exact: true }).click();
  await expect(
    page.getByText('You withdrew from this sample programme.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: preview().name })).toHaveCount(0);
  expect(posts[0]).toMatchObject({ action: 'withdraw', registrationId, acknowledged: true });
  expect(posts[0]).not.toHaveProperty('workspaceId');
});
test('account change and hide/restore clear secret and old participant labels before fresh scope denial', async ({
  page,
}) => {
  let denied = false;
  await page.route('**/api/customer-programme-participants*', (route) =>
    denied
      ? route.fulfill({ status: 403, json: { error: 'Access denied' } })
      : route.request().method() === 'GET'
        ? route.fulfill({ json: manage([], [registration()]) })
        : route.fulfill({
            json: {
              id: invitationId,
              programmeId,
              expiresAt: expires(),
              issued: true,
              token,
              synthetic: true,
            },
          }),
  );
  await page.goto(origin + '?mode=owner');
  await page.getByRole('checkbox', { name: /share this sample code/ }).check();
  await page.getByRole('button', { name: 'Create sample invitation code' }).click();
  await expect(page.getByLabel('Private sample invitation code', { exact: true })).toHaveValue(
    token,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.getByText(/Participant details are hidden/)).toBeVisible();
  await expect(page.getByLabel('Private sample invitation code', { exact: true })).toHaveCount(0);
  denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.getByRole('alert')).toContainText('Only current programme');
  await expect(page.getByText('Synthetic participant label', { exact: true })).toHaveCount(0);
  denied = false;
  await page.reload();
  await expect(page.getByText('Synthetic participant label', { exact: true })).toBeVisible();
  denied = true;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', { detail: { subject: 'synthetic-bob' } }),
    ),
  );
  await expect(page.getByRole('alert')).toContainText('Only current programme');
  await expect(page.getByText('Synthetic participant label', { exact: true })).toHaveCount(0);
});
test('participant paging never extends the initial private display window or leaks another programme response', async ({
  page,
}) => {
  await page.clock.install();
  const second = '00000000-0000-4000-8000-000000000008';
  const queries: string[] = [];
  await page.route('**/api/customer-programme-participants*', (route) => {
    const q = new URL(route.request().url()).searchParams;
    queries.push(q.toString());
    return route.fulfill({
      json: q.has('invitationAfter')
        ? manage([{ ...invitation(second), label: 'Synthetic second invitation' }])
        : manage([invitation()], [], invitationId),
    });
  });
  await page.goto(origin + '?mode=owner');
  await expect(page.getByText('Synthetic participant invitation', { exact: true })).toBeVisible();
  await page.clock.fastForward(45000);
  await page.getByRole('button', { name: 'Load more invitations' }).click();
  await expect(page.getByText('Synthetic second invitation', { exact: true })).toBeVisible();
  expect(queries.at(-1)).toContain('invitationAfter=' + invitationId);
  await page.clock.fastForward(16000);
  await expect(page.getByText(/This private view expired/)).toBeVisible();
  await expect(page.getByText('Synthetic participant invitation', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Synthetic second invitation', { exact: true })).toHaveCount(0);
});
test('malformed,wrong-scope,unavailable and expired previews never expose actionable records and recover explicitly', async ({
  page,
}) => {
  let stage = 0;
  await page.route('**/api/customer-programme-participants*', (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({ json: { ...preview(), expiresAt: '2000-01-01T00:00:00Z' } });
    if (stage === 0) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    if (stage === 1)
      return route.fulfill({ json: { ...own([ownRegistration()]), synthetic: false } });
    return route.fulfill({ json: own() });
  });
  await page.goto(origin);
  await expect(
    page.getByText('Sample delegation participation is unavailable.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview sample invitation' })).toHaveCount(0);
  stage = 1;
  await page.getByRole('button', { name: 'Reload my sample registrations' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be checked');
  await expect(page.getByText(ownRegistration().name, { exact: true })).toHaveCount(0);
  stage = 2;
  await page.getByRole('button', { name: 'Reload my sample registrations' }).click();
  await page.getByLabel('Private sample invitation code', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Preview sample invitation' }).click();
  await expect(
    page.getByText('The invitation could not be checked. Try again.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Fictional display name', { exact: true })).toHaveCount(0);
});
test('programme controls stay contextual,lazy and independently gated without dropping original planning actions', async ({
  page,
}) => {
  let reads = 0;
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: {
        workspaceId,
        programmes: [
          {
            id: programmeId,
            workspaceId,
            name: preview().name,
            reportingPurpose: preview().reportingPurpose,
            createdAt: '2026-10-18T00:00:00Z',
            synthetic: true,
          },
        ],
        nextAfter: null,
        synthetic: true,
      },
    }),
  );
  await page.route('**/api/customer-programme-participants*', (route) => {
    reads++;
    return route.fulfill({ status: 403, json: { error: 'Access denied' } });
  });
  await page.goto(origin + '?mode=context');
  await expect(page.getByRole('button', { name: 'Save sample programme' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage sample participants' })).toHaveCount(0);
  expect(reads).toBe(0);
  await page.goto(origin + '?mode=context&enabled=true');
  await expect(page.getByRole('button', { name: 'Manage sample participants' })).toBeVisible();
  expect(reads).toBe(0);
  await page.getByRole('button', { name: 'Manage sample participants' }).click();
  await expect(page.getByRole('alert')).toContainText('Only current programme');
  expect(reads).toBe(1);
  await expect(page.getByRole('button', { name: 'Save sample programme' })).toBeVisible();
});
test('both audiences support original-script text,keyboard,axe and four responsive widths without clipped records', async ({
  page,
}) => {
  await page.route('**/api/customer-programme-participants*', (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).searchParams.get('view') === 'manage'
          ? manage([invitation()], [registration()])
          : own([{ ...ownRegistration(), name: 'Original' + 'long'.repeat(35) }]),
    }),
  );
  await mkdir('.cache/v3-participants/after', { recursive: true });
  for (const audience of ['owner', 'account'])
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(origin + (audience === 'owner' ? '?mode=owner' : ''));
      await expect(
        page.getByRole('heading', {
          name: audience === 'owner' ? 'Sample participants' : 'Your sample registrations',
          exact: true,
        }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: '.cache/v3-participants/after/' + audience + '-' + width + '.png',
        fullPage: true,
      });
    }
  await page.getByLabel('Private sample invitation code', { exact: true }).focus();
  await page.keyboard.type(token);
  await expect(page.getByLabel('Private sample invitation code', { exact: true })).toHaveValue(
    token,
  );
});
test('unsent participant input has an actual interrupted-navigation warning rather than silent data loss', async ({
  page,
}) => {
  await page.route('**/api/customer-programme-participants*', (route) =>
    route.fulfill({ json: own() }),
  );
  await page.goto(origin);
  await page.getByLabel('Private sample invitation code', { exact: true }).fill(token);
  const warning = page.waitForEvent('dialog').then(async (prompt) => {
    expect(prompt.type()).toBe('beforeunload');
    await prompt.dismiss();
  });
  await Promise.all([
    warning,
    page.getByRole('link', { name: 'Back to my account', exact: true }).click(),
  ]);
  await expect(page.getByLabel('Private sample invitation code', { exact: true })).toHaveValue(
    token,
  );
});
