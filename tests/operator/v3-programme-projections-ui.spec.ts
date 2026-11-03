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
      contents: `import {createRoot} from 'react-dom/client';import {ProgrammeProjectionPanel,ParticipantProjectionSharing} from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-projections.tsx'))};const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-bob',issuer:${JSON.stringify(issuer)},workspaceId:'00000000-0000-4000-8000-000000000006',programmeId:'00000000-0000-4000-8000-000000000005',registrationId:'00000000-0000-4000-8000-000000000004',view:new URLSearchParams(location.search).get('view')??'companies'};const render=p=>{const all={...initial,...p};root.render(all.view==='own'?<ParticipantProjectionSharing {...all}/>:<ProgrammeProjectionPanel {...all}/>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
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

const programmeId = '00000000-0000-4000-8000-000000000005',
  workspaceId = '00000000-0000-4000-8000-000000000006',
  registrationId = '00000000-0000-4000-8000-000000000004',
  taskId = '00000000-0000-4000-8000-000000000007',
  linkId = '00000000-0000-4000-8000-000000000008';
const expiry = () => new Date(Date.now() + 60000).toISOString();
function owner() {
  return {
    workspaceId,
    programmeId,
    expiresAt: expiry(),
    sendsMessages: false,
    readiness: { activeParticipants: 28, readyParticipants: 1 },
    companies: [
      {
        registrationId,
        label: 'Synthetic participant',
        company: {
          name: 'Synthetic company',
          countryCode: 'BD',
          roles: ['SELLER'],
          sectors: ['Textiles'],
          objective: 'Synthetic shared objective',
          profileVersion: 1,
        },
        ready: true,
        missing: [],
      },
    ],
    nextAfter: null,
    context: {
      version: 1,
      startsAt: '2030-07-15T00:00:00Z',
      endsAt: '2030-07-16T00:00:00Z',
      timezone: 'Asia/Dhaka',
    },
    agenda: [
      {
        taskId,
        title: 'Synthetic activity',
        status: 'OPEN',
        version: 1,
        scheduled: true,
        startsAt: '2030-07-15T04:00:00Z',
        endsAt: '2030-07-15T05:00:00Z',
        timezone: 'Asia/Dhaka',
        audience: 'ALL',
        attendees: [],
        needsReview: false,
      },
    ],
    conflicts: [],
    meetings: {
      state: 'NOT_SHARED',
      sharedLinks: 0,
      unavailableLinks: 0,
      participantsSharing: 0,
      scheduled: null,
      qualifiedHeld: null,
    },
  };
}
function own() {
  return {
    registrationId,
    expiresAt: expiry(),
    sendsMessages: false,
    active: true,
    company: { version: 0, shared: false, objective: null },
    profile: {
      version: 2,
      name: 'Synthetic company',
      countryCode: 'BD',
      roles: ['SELLER'],
      sectors: ['Textiles'],
    },
    missionLinks: [
      {
        id: linkId,
        summary: 'Synthetic mission objective',
        version: 0,
        shared: false,
        available: true,
      },
    ],
    nextLinkAfter: null,
  };
}
function receipt(body: Record<string, unknown>) {
  return {
    commandId: body.commandId,
    resourceId: body.registrationId ?? body.linkId ?? body.taskId,
    version: Number(body.expectedVersion) + 1,
    expiresAt: expiry(),
  };
}
test('company checklist uses complete server totals and honest unshared meeting state', async ({
  page,
}) => {
  await page.route('**/api/customer-programme-projections**', (r) => r.fulfill({ json: owner() }));
  await page.goto(origin);
  await expect(page.getByText('1 of 28 active participants ready')).toBeVisible();
  await expect(page.getByText('Meeting counts are not shared.')).toBeVisible();
  await expect(page.getByText('Synthetic shared objective')).toBeVisible();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
test('company sharing needs explicit consent and retains exact retry after a wrong acknowledgement', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-projections**', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: own() });
    const body = r.request().postDataJSON();
    commands.push(body);
    return r.fulfill({
      json: { ...receipt(body), commandId: commands.length === 1 ? 'wrong' : body.commandId },
    });
  });
  await page.goto(origin + '/?view=own');
  const save = page.getByRole('button', { name: 'Share company profile', exact: true });
  await expect(save).toBeDisabled();
  await page
    .getByRole('textbox', { name: /Short objective/ })
    .fill('Synthetic consented objective');
  await page.getByRole('checkbox', { name: /I agree to share/ }).check();
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Save could not be confirmed');
  await page.getByRole('button', { name: 'Retry same change' }).click();
  await expect(save).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0]).toMatchObject({
    action: 'company',
    registrationId,
    profileVersion: 2,
    shared: true,
    objective: 'Synthetic consented objective',
    acknowledged: true,
  });
});
test('mission count permission sends only explicit separate consent', async ({ page }) => {
  let command: Record<string, unknown> | null = null;
  await page.route('**/api/customer-programme-projections**', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: own() });
    command = r.request().postDataJSON();
    return r.fulfill({ json: receipt(command!) });
  });
  await page.goto(origin + '/?view=own');
  await page
    .getByRole('checkbox', { name: 'Share aggregate meeting counts for this mission' })
    .click();
  await expect
    .poll(() => command)
    .toMatchObject({ action: 'meetings', linkId, shared: true, expectedVersion: 0 });
  expect(command).not.toHaveProperty('registrationId');
});
test('agenda preserves exact instants when displaying and saving programme-local time', async ({
  page,
}) => {
  let command: Record<string, unknown> | null = null;
  await page.route('**/api/customer-programme-projections**', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: owner() });
    command = r.request().postDataJSON();
    return r.fulfill({ json: receipt(command!) });
  });
  await page.goto(origin + '/?view=agenda');
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  await page.getByRole('button', { name: 'Save activity schedule' }).click();
  await expect
    .poll(() => command)
    .toMatchObject({
      taskId,
      workspaceId,
      programmeId,
      startsAt: '2030-07-15T04:00:00Z',
      endsAt: '2030-07-15T05:00:00Z',
      audience: 'ALL',
      attendees: [],
      expectedVersion: 1,
    });
});
for (const status of [403, 409, 503])
  test('save ' + status + ' clears private content with recovery', async ({ page }) => {
    await page.route('**/api/customer-programme-projections**', (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({ json: own() })
        : r.fulfill({ status, json: { error: 'Unavailable' } }),
    );
    await page.goto(origin + '/?view=own');
    await page
      .getByRole('checkbox', { name: 'Share aggregate meeting counts for this mission' })
      .click();
    await expect(page.getByRole('alert')).toContainText('Unavailable');
    await expect(page.getByText('Synthetic company', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh sharing' })).toBeVisible();
  });
test('expiry removes private details when renewal cannot complete', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/customer-programme-projections**', async (r) => {
    if (++reads > 1) return;
    return r.fulfill({
      json: { ...owner(), expiresAt: new Date(Date.now() + 1200).toISOString() },
    });
  });
  await page.goto(origin);
  await expect(page.getByText('Synthetic shared objective')).toBeVisible();
  await expect(page.getByText('Synthetic shared objective')).toHaveCount(0, { timeout: 5000 });
});
test('late old-context response cannot restore another account data', async ({ page }) => {
  await page.route('**/api/customer-programme-projections**', async (r) => {
    if (r.request().headers()['x-corridra-customer-subject'] === 'other')
      return r.fulfill({ status: 403, json: { error: 'Denied' } });
    await new Promise((done) => setTimeout(done, 300));
    return r.fulfill({ json: owner() });
  });
  await page.goto(origin);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', { detail: { subject: 'other' } }),
    ),
  );
  await expect(page.getByRole('alert')).toContainText('permitted programme account');
  await expect(page.getByText('Synthetic shared objective')).toHaveCount(0);
});
for (const width of [390, 1440])
  for (const view of ['companies', 'agenda', 'own'])
    test('accessible ' + view + ' at ' + width, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.route('**/api/customer-programme-projections**', (r) =>
        r.fulfill({ json: view === 'own' ? own() : owner() }),
      );
      await page.goto(origin + '/?view=' + view);
      if (view !== 'agenda')
        await expect(page.getByText('Synthetic company', { exact: false })).toBeVisible();
      if (view === 'agenda')
        await expect(
          page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }),
        ).toBeVisible();
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
    });

test('refreshed company profile requires consent to the newly displayed version', async ({
  page,
}) => {
  let version = 2;
  await page.route('**/api/customer-programme-projections**', (r) =>
    r.fulfill({ json: { ...own(), profile: { ...own().profile, version } } }),
  );
  await page.goto(origin + '/?view=own');
  await page.getByRole('checkbox', { name: /I agree to share/ }).check();
  await expect(
    page.getByRole('button', { name: 'Share company profile', exact: true }),
  ).toBeEnabled();
  version = 3;
  await page.getByRole('button', { name: 'Refresh sharing', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /I agree to share/ })).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Share company profile', exact: true }),
  ).toBeDisabled();
});
