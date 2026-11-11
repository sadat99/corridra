import { test, expect, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// The programme page panels (ADR-080) as real components in the customer frame, against a small stateful stand-in for
// the one signed-in route. Component protocol fixtures, not provider or database acceptance: the database rules are
// proven in tests/integration/customer-programme-publication.test.ts.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000001',
  programmeId = '00000000-0000-4000-8000-000000000002';
const address = 'synthetic-china-machinery-delegation-k3f9x2ab7q';
const fixtureSource = `import {createRoot} from 'react-dom/client';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {ProgrammePage} from './app/account/delegations/programme-page.tsx';
import {ProgrammeApplications} from './app/account/delegations/programme-applications.tsx';
const host=document.getElementById('fixture');
const query=new URLSearchParams(location.search);
const who={subject:'synthetic-alice',issuer:host.dataset.issuer};
const router={push:p=>location.assign(p),replace:p=>location.replace(p),back:()=>history.back(),forward:()=>history.forward(),refresh:()=>{},hmrRefresh:()=>{},prefetch:async()=>{}};
const target=query.get('apply')?{address:query.get('apply'),version:1,title:'Synthetic China machinery delegation',organiser:'Synthetic Dhaka Agro Traders Association',open:query.get('closed')!=='1'}:null;
createRoot(host).render(<AppRouterContext.Provider value={router}>{query.get('mode')==='organiser'?<ProgrammePage {...who} workspaceId={host.dataset.workspace} programmeId={host.dataset.programme} programmeName="Synthetic organiser programme"/>:<ProgrammeApplications {...who} target={target} asked={query.has('apply')||query.has('gone')}/>}</AppRouterContext.Provider>);`;
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      // A constant source: nothing is interpolated into the code. The paths are relative to resolveDir and the
      // fixture values are read from the page's own data attributes.
      contents: fixtureSource,
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
  // The browser bundle holds no server authority code.
  expect(
    Object.keys(result.metafile!.inputs).some((file) => file.includes('packages/auth/src')),
  ).toBe(false);
  const javascript = result.outputFiles[0].text;
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
  const css = Buffer.concat([
    ...(await Promise.all(
      cssPaths.map((file) =>
        readFile(resolve('apps/web/.next/static', file.slice('/_next/static/'.length))),
      ),
    )),
    // The panel's own stylesheet is plain token CSS; the home document does not load it.
    await readFile(resolve('apps/web/app/delegations/[address]/programme-page.css')),
  ]);
  server = createServer((request, response) => {
    const file = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (file === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (file === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(css);
    } else if (/^\/_next\/static\/media\/[\w.-]+\.woff2$/.test(file)) {
      void readFile(resolve('apps/web/.next/static', file.slice('/_next/static/'.length)))
        .then((font) => {
          response.setHeader('Content-Type', 'font/woff2');
          response.end(font);
        })
        .catch(() => {
          response.statusCode = 404;
          response.end();
        });
    } else if (file === '/' || file === '/account/delegations') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic programme page fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" class="operator-page ux-workspace ux-customer"><h1>Synthetic programme page fixture</h1><div id="fixture" data-issuer="${issuer}" data-workspace="${workspaceId}" data-programme="${programmeId}"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const listening = server.address();
  if (!listening || typeof listening === 'string') throw new Error('Fixture address unavailable');
  origin = `http://127.0.0.1:${listening.port}`;
});
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});

// A small stand-in for the route with the same shapes and the same refusal codes as the database functions.
type Row = {
  id: string;
  status: string;
  displayLabel: string;
  statement: string;
  appliedAt: string;
  decisionVersion: number;
  note?: string;
  invitationExpiresAt?: string;
  registrationId?: string;
  address?: string;
  title?: string;
};
type World = {
  version: number;
  state: string;
  copy: Record<string, unknown> | null;
  closesAt: string | null;
  rows: Row[];
  posts: Record<string, unknown>[];
  failNext: { status: number; body: Record<string, unknown> } | 'offline' | null;
};
const world = (over: Partial<World> = {}): World => ({
  version: 0,
  state: 'NONE',
  copy: null,
  closesAt: null,
  rows: [],
  posts: [],
  failNext: null,
  ...over,
});
const applicant = (id: string, status: string, over: Partial<Row> = {}): Row => ({
  id: `00000000-0000-4000-8000-0000000000${id}`,
  status,
  displayLabel: `Synthetic applicant ${id}`,
  statement: 'Synthetic buyer of two combine harvesters this year, wants factory visits.',
  appliedAt: '2026-11-10T09:00:00.000000Z',
  decisionVersion: 0,
  address,
  title: 'Synthetic China machinery delegation',
  ...over,
});
async function serve(page: Page, w: World) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/customer-programme-pages**', async (route) => {
    const request = route.request();
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      const view = url.searchParams.get('view');
      if (view === 'own') return json(route, { applications: w.rows, nextAfter: null });
      if (view === 'applications')
        return json(route, { applications: w.rows, nextAfter: null, programmeId, workspaceId });
      return json(route, {
        programmeId,
        workspaceId,
        version: w.version,
        state: w.state,
        ...(w.version > 0 ? { address, copy: w.copy, closesAt: w.closesAt } : {}),
        applications: w.rows.length,
        awaiting: w.rows.filter((row) => row.status === 'SUBMITTED').length,
        sample: true,
      });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    w.posts.push(body);
    if (w.failNext === 'offline') {
      w.failNext = null;
      return route.abort('internetdisconnected');
    }
    if (w.failNext) {
      const fail = w.failNext;
      w.failNext = null;
      return json(route, fail.body, fail.status);
    }
    expect(body.commandId).toMatch(/^[0-9a-f-]{36}$/);
    if (body.kind === 'page' && body.action === 'publish') {
      if (body.expectedVersion !== w.version)
        return json(route, { error: 'x', code: 'PROGRAMME_PUBLICATION_CHANGED' }, 409);
      w.version += 1;
      w.state = 'OPEN';
      w.copy = body.copy as Record<string, unknown>;
      w.closesAt = String(body.closesAt).replace('.000Z', '.000000Z');
      return json(route, { programmeId, version: w.version, state: 'OPEN', address });
    }
    if (body.kind === 'page' && body.action === 'withdraw') {
      w.state = 'WITHDRAWN';
      return json(route, { programmeId, version: w.version, state: 'WITHDRAWN' });
    }
    if (body.kind === 'application' && body.action === 'apply') {
      const row = applicant('31', 'SUBMITTED', {
        displayLabel: String(body.displayLabel),
        statement: String(body.statement),
      });
      w.rows.push(row);
      return json(route, row);
    }
    const row = w.rows.find((item) => item.id === body.applicationId)!;
    if (body.action === 'decide') {
      if (body.expectedVersion !== row.decisionVersion)
        return json(route, { error: 'x', code: 'PROGRAMME_APPLICATION_CHANGED' }, 409);
      row.decisionVersion += 1;
      row.status = String(body.decision);
      row.note = body.note as string | undefined;
      if (row.status === 'INVITED') row.invitationExpiresAt = '2026-11-18T09:00:00.000000Z';
    }
    if (body.action === 'withdraw') row.status = 'WITHDRAWN';
    if (body.action === 'join') {
      row.status = 'JOINED';
      row.registrationId = '00000000-0000-4000-8000-000000000099';
    }
    return json(route, row);
  });
}
async function clean(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}
// Optional review captures: written only when PROGRAMME_PAGES_EVIDENCE_DIR names a directory.
const shot = async (page: Page, name: string) => {
  const directory = process.env.PROGRAMME_PAGES_EVIDENCE_DIR;
  if (directory) await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
};
const fill = (page: Page, name: string, value: string) =>
  page.locator(`[name="page-${name}"]`).fill(value);

for (const width of [390, 1440])
  test(`organiser writes, previews, publishes, shares and takes down the page at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const w = world();
    await serve(page, w);
    await page.goto(`${origin}/?mode=organiser`);
    await expect(page.getByText('Public page: Not published')).toBeVisible();
    await expect(
      page.getByText('Participants, prices and private requests stay private.'),
    ).toBeVisible();
    await clean(page);
    await page.getByRole('button', { name: 'Write the Public Page' }).click();
    // Step 1 shows three fields and one main action; a mistake is said in words and nothing moves on.
    await expect(page.getByRole('heading', { name: 'Step 1 of 6: Basics' })).toBeFocused();
    await expect(page.locator('.programme-page-editor .field')).toHaveCount(3);
    await expect(page.locator('.programme-page-editor .primary-link')).toHaveCount(1);
    await fill(page, 'title', 'China machinery delegation');
    await fill(page, 'organiser', 'Synthetic Dhaka Agro Traders Association');
    await fill(page, 'summary', 'A ten company buying delegation to compare harvesters.');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toContainText('Start the title and the organiser name');
    await fill(page, 'title', 'Synthetic China machinery delegation');
    await clean(page);
    await shot(page, `organiser-step1-${width}`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Step 2 of 6: Where and when' })).toBeFocused();
    // What was typed is kept in this browser: a reload returns to the same words.
    await page.reload();
    await page.getByRole('button', { name: 'Write the Public Page' }).click();
    await expect(page.locator('[name="page-title"]')).toHaveValue(
      'Synthetic China machinery delegation',
    );
    await page.getByRole('button', { name: 'Continue' }).click();
    await fill(page, 'destination', 'Guangzhou and Foshan, China');
    await fill(page, 'dates', '12 to 18 April 2027, to be confirmed');
    await fill(page, 'focus', 'Agricultural machinery');
    await page.getByRole('button', { name: 'Continue' }).click();
    await fill(page, 'audience', 'Owners and buyers of importers and dealers.');
    await fill(page, 'eligibility', 'A registered business that imports farm machinery.');
    await fill(page, 'capacity', '0');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toContainText('whole number from 1 to 1000');
    await fill(page, 'capacity', '10');
    await page.getByRole('button', { name: 'Continue' }).click();
    await fill(page, 'activities', 'Factory visits in Foshan\nOpening briefing');
    // Nothing is confirmed unless the organiser says so.
    await expect(
      page.getByRole('checkbox', { name: 'Factory visits in Foshan' }),
    ).not.toBeChecked();
    await page.getByRole('checkbox', { name: 'Opening briefing' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await fill(page, 'fee', 'BDT 45,000 per company, paid to the organiser');
    await fill(page, 'included', 'Programme coordination');
    await fill(page, 'excluded', 'Flights\nVisa fees');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('heading', { name: 'Step 6 of 6: Check and publish' }),
    ).toBeFocused();
    // The preview is the public page's own component with the typed words.
    const preview = page.locator('.programme-page-preview');
    await expect(preview).toContainText('A ten company buying delegation to compare harvesters.');
    await expect(preview).toContainText('The Apply button appears here on the published page.');
    await expect(preview.locator('.primary-link')).toHaveCount(0);
    await clean(page);
    await shot(page, `organiser-step6-${width}`);
    await page.getByRole('button', { name: 'Publish the Page' }).click();
    await expect(page.getByRole('alert')).toContainText('Tick the box');
    expect(w.posts).toHaveLength(0);
    await page.getByRole('checkbox', { name: /I checked this page/ }).check();
    // A lost connection loses nothing and says so; the same request is sent again with the same command.
    w.failNext = 'offline';
    await page.getByRole('button', { name: 'Publish the Page' }).click();
    await expect(page.getByRole('alert')).toContainText('No connection. What you typed is kept.');
    await page.getByRole('button', { name: 'Publish the Page' }).click();
    await expect(page.getByRole('status').first()).toContainText('Published.');
    expect(w.posts).toHaveLength(2);
    expect(w.posts[0]!.commandId).toBe(w.posts[1]!.commandId);
    expect(w.posts[1]).toMatchObject({
      kind: 'page',
      action: 'publish',
      expectedVersion: 0,
      acknowledged: true,
      copy: {
        title: 'Synthetic China machinery delegation',
        capacity: 10,
        activities: [
          { label: 'Factory visits in Foshan', status: 'PLANNED' },
          { label: 'Opening briefing', status: 'CONFIRMED' },
        ],
        excluded: ['Flights', 'Visa fees'],
      },
    });
    await expect(page.getByText('Public page: Published and taking applications')).toBeVisible();
    const link = page.getByRole('link', { name: new RegExp(`/delegations/${address}$`) });
    await expect(link).toBeVisible();
    await expect(page.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute(
      'href',
      new RegExp(`^https://wa\\.me/\\?text=.*${address}`),
    );
    await expect(page.getByRole('link', { name: 'Share on Facebook' })).toHaveAttribute(
      'href',
      /^https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=/,
    );
    await expect(page.getByText('No applications yet.')).toBeVisible();
    await clean(page);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Take the Page Down' }).click();
    await expect(page.getByText('Public page: Taken down')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit and Publish Again' })).toBeVisible();
    await expect(link).toHaveCount(0);
  });

test('organiser answers applications; each state offers only its own actions; a stale answer is said plainly', async ({
  page,
}) => {
  const w = world({
    version: 1,
    state: 'OPEN',
    copy: { title: 'Synthetic China machinery delegation' },
    closesAt: '2027-01-01T23:59:00.000000Z',
    rows: [
      applicant('11', 'SUBMITTED'),
      applicant('12', 'INVITED', {
        decisionVersion: 1,
        invitationExpiresAt: '2026-11-18T09:00:00.000000Z',
      }),
      applicant('13', 'JOINED', { decisionVersion: 1 }),
      applicant('14', 'WITHDRAWN'),
    ],
  });
  await serve(page, w);
  await page.goto(`${origin}/?mode=organiser`);
  await expect(page.getByText('Applications: 1 waiting for your answer, 4 in all')).toBeVisible();
  const row = (id: string) => page.locator('li', { hasText: `Synthetic applicant ${id}` });
  await expect(row('11').getByRole('button')).toHaveText([
    'Invite to Join',
    'Put on Waiting List',
    'Decline',
  ]);
  await expect(row('12').getByRole('button')).toHaveText(['Decline']);
  await expect(row('13').getByRole('button')).toHaveCount(0);
  await expect(row('13')).toContainText('Registered. Terms, places and fees');
  await expect(row('14').getByRole('button')).toHaveCount(0);
  await expect(row('11')).toContainText('Stated by the applicant, not checked.');
  await clean(page);
  await shot(page, 'organiser-applications-1280');
  // A decline needs words for the applicant.
  await row('11').getByRole('button', { name: 'Decline' }).click();
  await row('11').getByRole('button', { name: 'Confirm Decline' }).click();
  await expect(row('11').getByRole('alert')).toContainText('Write a short reason');
  expect(w.posts).toHaveLength(0);
  await row('11').getByRole('button', { name: 'Cancel' }).click();
  // Another admin answered meanwhile: nothing is saved and the person is told to reload.
  w.failNext = { status: 409, body: { error: 'x', code: 'PROGRAMME_APPLICATION_CHANGED' } };
  await row('11').getByRole('button', { name: 'Invite to Join' }).click();
  await expect(row('11').getByRole('alert')).toContainText('changed since you opened it');
  await row('11').getByRole('button', { name: 'Invite to Join' }).click();
  await expect(row('11')).toContainText('Invited');
  await expect(row('11')).toContainText('Invitation can be used until 18 Nov 2026.');
  expect(w.posts.at(-1)).toMatchObject({
    kind: 'application',
    action: 'decide',
    decision: 'INVITED',
    expectedVersion: 0,
    workspaceId,
    programmeId,
  });
  await row('12').getByRole('button', { name: 'Decline' }).click();
  await row('12')
    .getByRole('textbox')
    .fill('Synthetic reason: the delegation is for importers only.');
  await row('12').getByRole('button', { name: 'Confirm Decline' }).click();
  await expect(row('12')).toContainText('Declined');
  expect(w.posts.at(-1)).toMatchObject({
    decision: 'DECLINED',
    note: 'Synthetic reason: the delegation is for importers only.',
  });
});

test('a member without authority and a switched-off module each get one plain line', async ({
  page,
}) => {
  await page.route('**/api/customer-programme-pages**', (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"x"}' }),
  );
  await page.goto(`${origin}/?mode=organiser`);
  await expect(page.getByRole('alert')).toHaveText(
    'Only owners and admins of this workspace can manage the public page.',
  );
  await page.unroute('**/api/customer-programme-pages**');
  await page.route('**/api/customer-programme-pages**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"x"}' }),
  );
  await page.reload();
  await expect(page.getByText('Public programme pages are not available yet.')).toBeVisible();
  // With the module off the applicant section is not shown at all.
  await page.goto(`${origin}/?apply=${address}`);
  await expect(page.getByRole('heading', { name: 'Your applications' })).toHaveCount(0);
});

for (const width of [390, 1440])
  test(`a person applies, reads the answer, joins with consent or withdraws at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const w = world({ version: 1, state: 'OPEN' });
    await serve(page, w);
    await page.goto(`${origin}/account/delegations?apply=${address}`);
    await expect(
      page.getByRole('heading', { name: 'Apply to Synthetic China machinery delegation' }),
    ).toBeVisible();
    await expect(page.locator('.programme-apply-form .field')).toHaveCount(2);
    // What is stored, who reads it and how to take it back is said before anything is sent.
    await expect(page.getByText('You can withdraw it at any time')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'How Corridra Handles Your Data' }),
    ).toHaveAttribute('href', '/privacy');
    await clean(page);
    await shot(page, `applicant-form-${width}`);
    await page.locator('[name="application-name"]').fill('Bob Traders');
    await page
      .locator('[name="application-statement"]')
      .fill('Synthetic buyer of two combine harvesters this year.');
    await page.getByRole('button', { name: 'Send Application' }).click();
    await expect(page.getByRole('alert')).toContainText('This is a sample programme.');
    await page.locator('[name="application-name"]').fill('Synthetic Bob Traders');
    await page.getByRole('button', { name: 'Send Application' }).click();
    await expect(page.getByRole('alert')).toContainText('Tick the box');
    expect(w.posts).toHaveLength(0);
    // The words survive a reload before anything is sent.
    await page.reload();
    await expect(page.locator('[name="application-name"]')).toHaveValue('Synthetic Bob Traders');
    await page.getByRole('checkbox', { name: /Send this name and statement/ }).check();
    await page.getByRole('button', { name: 'Send Application' }).click();
    await expect(page.getByText('Your application was sent to the organiser.')).toBeVisible();
    expect(w.posts[0]).toMatchObject({
      kind: 'application',
      action: 'apply',
      address,
      version: 1,
      displayLabel: 'Synthetic Bob Traders',
      consented: true,
    });
    // One live application: the form is gone, the status says who must act next.
    await expect(page.locator('.programme-apply-form')).toHaveCount(0);
    const item = page.locator('.programme-application-list li');
    await expect(item).toContainText('Waiting for the organiser');
    await expect(item).toContainText('The organiser has not answered yet.');
    await expect(item.getByRole('button')).toHaveText(['Withdraw Application']);
    await clean(page);
    // The organiser invites; the applicant joins only after an explicit tick.
    w.rows[0]!.status = 'INVITED';
    w.rows[0]!.decisionVersion = 1;
    w.rows[0]!.invitationExpiresAt = '2026-11-18T09:00:00.000000Z';
    await page.goto(`${origin}/account/delegations`);
    await expect(item).toContainText('You are invited. Join by 18 Nov 2026 (UTC).');
    await item.getByRole('button', { name: 'Join the Programme' }).click();
    await item.getByRole('button', { name: 'Confirm and Join' }).click();
    await expect(item.getByRole('alert')).toContainText('Tick the box to join');
    expect(w.posts).toHaveLength(1);
    await item.getByRole('checkbox').check();
    await clean(page);
    await shot(page, `applicant-join-${width}`);
    await item.getByRole('button', { name: 'Confirm and Join' }).click();
    await expect(item).toContainText('You are registered. See your registration below.');
    expect(w.posts[1]).toMatchObject({ action: 'join', consented: true });
    await expect(item.getByRole('button')).toHaveCount(0);
  });

test('withdrawing, a closed page and a page that is gone are each said plainly', async ({
  page,
}) => {
  const w = world({ version: 1, state: 'OPEN', rows: [applicant('21', 'WAITLISTED')] });
  await serve(page, w);
  await page.goto(`${origin}/account/delegations`);
  const item = page.locator('.programme-application-list li');
  await expect(item).toContainText('On the waiting list');
  await expect(item).toContainText('This is not a place.');
  page.once('dialog', (dialog) => void dialog.accept());
  await item.getByRole('button', { name: 'Withdraw Application' }).click();
  await expect(item).toContainText('Withdrawn');
  expect(w.posts[0]).toMatchObject({ action: 'withdraw', acknowledged: true });
  await page.goto(`${origin}/account/delegations?apply=${address}&closed=1`);
  await expect(
    page.getByText('This programme is not taking applications right now.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Application' })).toHaveCount(0);
  await page.goto(`${origin}/account/delegations?gone=1`);
  await expect(page.getByText('That programme page is not available.')).toBeVisible();
});
