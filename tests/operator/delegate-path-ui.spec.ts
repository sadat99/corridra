import { test, expect, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// The delegate's objective path as real components in the customer frame: the registration card, the guided request
// and the objective tools, against small stand-ins for the routes they already use. Component protocol fixtures, not
// provider or database acceptance: the draft, request and sharing rules are proven in the integration suites
// (customer-mission-drafts, customer-mission-shares, customer-programme-publication).
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000001',
  programmeId = '00000000-0000-4000-8000-000000000002',
  registrationId = '00000000-0000-4000-8000-000000000003',
  draftId = '00000000-0000-4000-8000-000000000004',
  requestId = '00000000-0000-4000-8000-000000000005',
  linkId = '00000000-0000-4000-8000-000000000006',
  newWorkspaceId = '00000000-0000-4000-8000-000000000007';
const programmeName = 'Synthetic China machinery delegation';
const statement = 'Synthetic plan to compare two rice transplanters and visit three factories';
const fixtureSource = `import {createRoot} from 'react-dom/client';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {ParticipantAccount} from './app/account/delegations/participant-account.tsx';
import {GuidedRequest} from './app/account/drafts/guided-request.tsx';
const host=document.getElementById('fixture');
const query=new URLSearchParams(location.search);
const who={subject:'synthetic-alice',issuer:host.dataset.issuer};
const router={push:p=>location.assign(p),replace:p=>location.replace(p),back:()=>history.back(),forward:()=>history.forward(),refresh:()=>{},hmrRefresh:()=>{},prefetch:async()=>{}};
const drafts=location.pathname.match(/^\\/account\\/drafts\\/([0-9a-f-]{36})$/);
createRoot(host).render(<AppRouterContext.Provider value={router}>{drafts?<GuidedRequest {...who} workspaceId={drafts[1]} profilesEnabled={false}/>:<ParticipantAccount {...who} missionSharesEnabled objectivePathEnabled={query.get('path')!=='0'} draftsEnabled={query.get('drafts')!=='0'}/>}</AppRouterContext.Provider>);`;
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
    // The path's own stylesheet is plain token CSS; the home document does not load it.
    await readFile(resolve('apps/web/app/account/delegations/delegate-path.css')),
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
    } else if (
      file === '/' ||
      file === '/account/delegations' ||
      file.startsWith('/account/drafts/')
    ) {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic delegate path fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" class="operator-page ux-workspace ux-customer"><h1>Synthetic delegate path fixture</h1><div id="fixture" data-issuer="${issuer}" data-workspace="${workspaceId}" data-programme="${programmeId}"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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

// What the stand-in routes hold. Shapes follow the real routes; posts are kept so each test reads what was sent.
type World = {
  joinedByApplication: boolean;
  /** What the organisers shared of the programme dates and destination; null until they share it. */
  context: { marketCode: string; startsAt: string; endsAt: string; timezone: string } | null;
  workspaces: { id: string; name: string }[];
  requests: { id: string; label: string; available: boolean }[];
  shared: { summary: string; requestId: string } | null;
  draft: Record<string, unknown> | null;
  draftStatus: 'OPEN' | 'SUBMITTED';
  posts: { url: string; body: Record<string, unknown> }[];
};
const world = (over: Partial<World> = {}): World => ({
  joinedByApplication: true,
  context: null,
  workspaces: [{ id: workspaceId, name: 'Synthetic Rahman Agro' }],
  requests: [],
  shared: null,
  draft: null,
  draftStatus: 'OPEN',
  posts: [],
  ...over,
});
const later = () => new Date(Date.now() + 3600000).toISOString();
async function serve(page: Page, w: World) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const identified = (route: Route) => {
    expect(route.request().headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(route.request().headers()['x-corridra-customer-issuer']).toBe(issuer);
  };
  const posted = (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    w.posts.push({ url: new URL(route.request().url()).pathname, body });
    return body;
  };
  await page.route('**/api/customer-programme-participants**', (route) => {
    identified(route);
    return json(route, {
      registrations: [
        {
          id: registrationId,
          displayLabel: 'Synthetic Rahman Agro',
          consentedAt: '2026-11-10T00:00:00Z',
          status: 'REGISTERED',
          programmeId,
          name: programmeName,
          reportingPurpose: 'Synthetic buying delegation to compare rice transplanters',
          synthetic: true,
        },
      ],
      nextAfter: null,
      synthetic: true,
    });
  });
  await page.route('**/api/customer-programme-pages**', (route) => {
    identified(route);
    return json(route, {
      applications: w.joinedByApplication
        ? [
            {
              id: '00000000-0000-4000-8000-000000000011',
              status: 'JOINED',
              displayLabel: 'Synthetic Rahman Agro',
              statement,
              appliedAt: '2026-11-09T00:00:00Z',
              decisionVersion: 1,
              registrationId,
              title: programmeName,
            },
          ]
        : [],
      nextAfter: null,
    });
  });
  await page.route('**/api/customer-workspaces', (route) => {
    identified(route);
    if (route.request().method() === 'GET')
      return json(route, {
        workspaces: w.workspaces.map((x) => ({
          ...x,
          role: 'owner',
          synthetic: true,
          organisationId: null,
        })),
        synthetic: true,
      });
    const body = posted(route);
    w.workspaces.push({ id: newWorkspaceId, name: String(body.name) });
    return json(route, {
      id: newWorkspaceId,
      name: body.name,
      role: 'owner',
      synthetic: true,
      organisationId: null,
    });
  });
  await page.route('**/api/customer-programme-context**', (route) => {
    identified(route);
    return json(route, {
      registrationId,
      programmeId,
      expiresAt: later(),
      synthetic: true,
      context: w.context && {
        version: 1,
        organiser: 'Synthetic organiser',
        purpose: 'Synthetic purpose',
        updatedAt: '2026-11-10T00:00:00Z',
        ...w.context,
      },
    });
  });
  await page.route('**/api/customer-programme-objectives**', (route) => {
    identified(route);
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.searchParams.get('view') === 'choices')
        return json(route, {
          registrationId,
          synthetic: true,
          requests: w.requests,
          nextAfter: null,
          viewExpiresAt: later(),
        });
      return json(route, {
        registrationId,
        synthetic: true,
        active: true,
        objectives: w.shared
          ? [
              {
                id: linkId,
                version: 1,
                status: 'SHARED',
                ...w.shared,
                claimStatus: 'Self-declared',
                sharedAt: new Date().toISOString(),
              },
            ]
          : [],
        nextAfter: null,
        viewExpiresAt: later(),
      });
    }
    const body = posted(route);
    w.shared = { summary: String(body.summary), requestId: String(body.requestId) };
    return json(route, {
      id: linkId,
      registrationId,
      synthetic: true,
      version: 1,
      requestId: body.requestId,
      status: 'SHARED',
    });
  });
  await page.route('**/api/customer-mission-drafts**', (route) => {
    identified(route);
    const url = new URL(route.request().url());
    const target = url.searchParams.get('workspaceId') ?? '';
    const view = () => ({
      workspaceId: target || (w.draft?.workspaceId as string),
      expiresAt: later(),
      currentVersion: 1,
      superseded: false,
      draft: { id: draftId, version: 1, status: w.draftStatus, details: w.draft?.details },
    });
    if (route.request().method() === 'GET') {
      if (url.searchParams.has('draftId')) return json(route, view());
      return json(route, {
        workspaceId: target,
        expiresAt: later(),
        drafts: w.draft
          ? [
              {
                id: draftId,
                version: 1,
                title: (w.draft.details as { title: string }).title,
                family: (w.draft.details as { family: string }).family,
                status: w.draftStatus,
                requestId: w.draftStatus === 'SUBMITTED' ? requestId : null,
                updatedAt: new Date().toISOString(),
              },
            ]
          : [],
        nextAfter: null,
      });
    }
    const body = posted(route);
    const input = body.input as Record<string, unknown>;
    if (body.action === 'save') {
      w.draft = { workspaceId: input.workspaceId, details: input.details };
      return json(route, { ...view(), workspaceId: input.workspaceId, commandId: input.commandId });
    }
    w.draftStatus = 'SUBMITTED';
    return json(route, { ...view(), workspaceId: input.workspaceId });
  });
  await page.route('**/api/customer-requests', (route) => {
    identified(route);
    const body = posted(route);
    w.requests.push({ id: requestId, label: programmeName + ': my objective', available: true });
    return json(route, { id: requestId, workspaceId: body.workspaceId });
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
// Optional review captures: written only when DELEGATE_PATH_EVIDENCE_DIR names a directory.
const shot = async (page: Page, name: string) => {
  const directory = process.env.DELEGATE_PATH_EVIDENCE_DIR;
  if (directory) await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
};
const path = (page: Page) => page.locator('.delegate-path');
const step = (page: Page, n: number) =>
  path(page)
    .locator('ol > li')
    .nth(n - 1);

for (const width of [390, 1440])
  test(`a joined delegate turns their application words into a private request and shares one sentence, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const w = world();
    await serve(page, w);
    await page.goto(origin + '/');
    // The words written when applying are shown back, and exactly one step is the next one.
    await expect(path(page).getByRole('heading', { level: 4 })).toHaveText(
      'Your objective for this programme',
    );
    await expect(path(page).locator('blockquote')).toHaveText(statement);
    await expect(path(page).locator('[aria-current="step"]')).toHaveCount(1);
    await expect(step(page, 1)).toHaveAttribute('aria-current', 'step');
    await expect(step(page, 1).locator('.delegate-path-state')).toHaveText('Next');
    await expect(step(page, 2).locator('.delegate-path-state')).toHaveText('Later');
    await expect(step(page, 2)).toContainText('Available once you have sent a private request.');
    await expect(step(page, 2).getByRole('button')).toHaveCount(0);
    await clean(page);
    // The three choices are one aligned set: one row on a desktop, one column with a shared left edge on a phone.
    const boxes = await step(page, 1)
      .locator('.delegate-path-actions .button')
      .evaluateAll((all) => all.map((b) => b.getBoundingClientRect()).map((r) => [r.x, r.y]));
    expect(boxes).toHaveLength(3);
    expect(new Set(boxes.map((b) => Math.round(b[width === 1440 ? 1 : 0]!))).size).toBe(1);
    await shot(page, `path-start-${width}`);

    // One press prepares the request in the person's own workspace and opens it. Nothing is sent to the team yet.
    await step(page, 1).getByRole('button', { name: 'Find Suppliers or Products' }).click();
    await page.waitForURL(`**/account/drafts/${workspaceId}?draft=${draftId}`);
    const save = w.posts.find((p) => p.url === '/api/customer-mission-drafts')!;
    expect(save.body.action).toBe('save');
    expect(save.body.input).toMatchObject({
      workspaceId,
      draftId: null,
      expectedVersion: 0,
      acknowledged: true,
      details: {
        title: programmeName + ': my objective',
        family: 'SUPPLIERS_PRODUCTS',
        objective: 'Source suppliers',
        offer: statement,
        companyName: 'Synthetic Rahman Agro',
        market: '',
        outcomes: [],
        contactEmail: '',
      },
    });
    expect(w.posts.some((p) => p.url === '/api/customer-requests')).toBe(false);

    // The prepared draft is already open, on the first thing only the person knows: no list to search, the
    // kind of request already chosen, and the carried words in it.
    await expect(page.getByRole('heading', { level: 2, name: 'Where and when' })).toBeVisible();
    await expect(page.getByText('Request type: Find suppliers and source products')).toBeVisible();
    await page.getByRole('button', { name: '3. What you offer or need' }).click();
    await expect(page.locator('textarea').first()).toHaveValue(statement);
    await shot(page, `request-prepared-${width}`);

    // The person completes what only they know (stood in for here), reviews and sends.
    (w.draft!.details as Record<string, unknown>).market = 'Synthetic Guangzhou and Foshan';
    (w.draft!.details as Record<string, unknown>).outcomes = ['Supplier visits'];
    (w.draft!.details as Record<string, unknown>).contactName = 'Synthetic Alice Rahman';
    (w.draft!.details as Record<string, unknown>).contactEmail = 'alice@example.invalid';
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Where and when' })).toBeVisible();
    await page.getByRole('button', { name: '5. Review and send' }).click();
    await page.getByLabel('I confirm these are fictional test details.').check();
    await page.getByRole('button', { name: 'Send Request' }).click();
    await expect(page.getByRole('heading', { name: 'Your request was sent.' })).toBeVisible();
    const sentBrief = w.posts.find((p) => p.url === '/api/customer-requests')!.body.brief as Record<
      string,
      unknown
    >;
    expect(String(sentBrief.offer)).toContain(statement);

    // The confirmation leads straight back to the programme, to the one step that is now next.
    const back = page.locator('[data-programme-return]');
    await expect(back).toContainText(`This request started from ${programmeName}.`);
    await shot(page, `request-sent-${width}`);
    await back.getByRole('link', { name: 'Share Its Objective With the Organisers' }).click();
    await page.waitForURL(`**/account/delegations?objective=${registrationId}*`);
    await expect(step(page, 1).locator('.delegate-path-state')).toHaveText('Done');
    await expect(step(page, 2)).toHaveAttribute('aria-current', 'step');

    // The objective tools are open with the request chosen and the words ready. Consent is not ticked for them.
    const tools = page.getByRole('region', { name: 'Shared commercial objectives' });
    await expect(tools.getByLabel('Original private request')).toHaveValue(requestId);
    await expect(tools.locator('textarea')).toHaveValue(statement);
    const consent = tools.getByRole('checkbox');
    await expect(consent).not.toBeChecked();
    await expect(
      tools.getByRole('button', { name: 'Share Objective With Organisers' }),
    ).toBeDisabled();
    expect(w.posts.some((p) => p.url === '/api/customer-programme-objectives')).toBe(false);
    await shot(page, `share-ready-${width}`);
    await consent.check();
    await tools.getByRole('button', { name: 'Share Objective With Organisers' }).click();
    await expect.poll(() => w.shared).toEqual({ summary: statement, requestId });
    expect(w.posts.find((p) => p.url === '/api/customer-programme-objectives')!.body).toMatchObject(
      { action: 'share', registrationId, requestId, summary: statement, consented: true },
    );

    // The objective tools show what is now shared, with no error.
    await expect(tools.getByText('Objective access could not be checked.')).toHaveCount(0);
    await expect(tools.locator('ul').first()).toContainText(statement);
    // The path follows what was saved: shared is done, results are next.
    await expect(step(page, 2).locator('.delegate-path-state')).toHaveText('Done');
    await expect(step(page, 3)).toHaveAttribute('aria-current', 'step');
    await expect(step(page, 2)).toContainText('Shared with the organisers.');
    await clean(page);
    await shot(page, `path-shared-${width}`);
  });

test('a delegate with no workspace names one and starts in the same press; a refused name sends nothing', async ({
  page,
}) => {
  const w = world({ workspaces: [] });
  await serve(page, w);
  await page.goto(origin + '/');
  const name = step(page, 1).getByLabel('Name for your company workspace');
  // The display name they registered with is offered, and can be changed.
  await expect(name).toHaveValue('Synthetic Rahman Agro');
  await name.fill('Agro');
  await step(page, 1).getByRole('button', { name: 'Find Buyers or Partners' }).click();
  await expect(step(page, 1).getByRole('alert')).toHaveText(
    'Start the sample workspace name with Synthetic and use at least 11 characters.',
  );
  expect(w.posts).toEqual([]);
  await name.fill('Synthetic Rahman Agro Imports');
  await step(page, 1).getByRole('button', { name: 'Find Buyers or Partners' }).click();
  await page.waitForURL(`**/account/drafts/${newWorkspaceId}?draft=${draftId}`);
  expect(w.posts.map((p) => p.url)).toEqual([
    '/api/customer-workspaces',
    '/api/customer-mission-drafts',
  ]);
  expect(w.posts[0]!.body).toMatchObject({ name: 'Synthetic Rahman Agro Imports' });
  expect(w.posts[1]!.body.input).toMatchObject({
    workspaceId: newWorkspaceId,
    details: { family: 'BUYERS_PARTNERS', objective: 'Find customers or distributors' },
  });
});

test('several workspaces need a choice; a code-joined delegate has no words to carry and is told so', async ({
  page,
}) => {
  const w = world({
    joinedByApplication: false,
    workspaces: [
      { id: workspaceId, name: 'Synthetic Rahman Agro' },
      { id: newWorkspaceId, name: 'Synthetic Second Company' },
    ],
  });
  await serve(page, w);
  await page.goto(origin + '/');
  await expect(path(page)).toContainText(
    'You joined with an invitation code, so there are no application words to carry.',
  );
  await expect(path(page).locator('blockquote')).toHaveCount(0);
  const start = step(page, 1).getByRole('button', { name: 'Something Else' });
  await expect(start).toBeDisabled();
  await step(page, 1).getByLabel('Workspace for the request').selectOption(newWorkspaceId);
  await start.click();
  await page.waitForURL(`**/account/drafts/${newWorkspaceId}?draft=${draftId}`);
  expect(w.posts[0]!.body.input).toMatchObject({
    workspaceId: newWorkspaceId,
    details: {
      family: 'OTHER',
      objective: 'Make an upcoming business trip more productive',
      offer: '',
    },
  });
});

test('a refused or failed start says so, sends nothing further and can be retried as the same change', async ({
  page,
}) => {
  const w = world();
  await serve(page, w);
  let fail = true;
  const commandIds: unknown[] = [];
  await page.route('**/api/customer-mission-drafts', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    commandIds.push(
      (JSON.parse(route.request().postData() ?? '{}') as { input: { commandId: string } }).input
        .commandId,
    );
    if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    return route.fallback();
  });
  await page.goto(origin + '/');
  await step(page, 1).getByRole('button', { name: 'Find Suppliers or Products' }).click();
  await expect(step(page, 1).getByRole('alert')).toHaveText(
    'Your request could not be prepared. Nothing was sent. Try again.',
  );
  expect(page.url()).toBe(origin + '/');
  fail = false;
  await step(page, 1).getByRole('button', { name: 'Find Suppliers or Products' }).click();
  await page.waitForURL(`**/account/drafts/${workspaceId}?draft=${draftId}`);
  // The retry repeated the same command, so an answer lost the first time could not make a second draft.
  expect(commandIds).toHaveLength(2);
  expect(commandIds[0]).toBe(commandIds[1]);
});

test('with guided drafts off the step links to the workspaces; with the path off the card is as it was', async ({
  page,
}) => {
  const w = world();
  await serve(page, w);
  await page.goto(origin + '/?drafts=0');
  await expect(
    step(page, 1).getByRole('link', { name: 'Start a Request From Your Workspaces' }),
  ).toHaveAttribute('href', '/account?view=work#customer-workspaces');
  await expect(step(page, 1).getByRole('button')).toHaveCount(0);
  await page.goto(origin + '/?path=0');
  await expect(page.getByRole('heading', { name: programmeName })).toBeVisible();
  await expect(path(page)).toHaveCount(0);
  await shot(page, 'before-1440');
});

test('shared programme dates and destination are shown, added to the draft for editing, and nothing is sent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const w = world({
    context: {
      marketCode: 'CN',
      startsAt: '2027-03-09T08:00:00+08:00',
      endsAt: '2027-03-13T18:00:00+08:00',
      timezone: 'Asia/Shanghai',
    },
  });
  await serve(page, w);
  await page.goto(origin + '/');
  // Said before the press, in the step the person is on, with the exact values.
  await expect(step(page, 1)).toContainText(
    'The organisers shared the destination and dates: CN, 2027-03-09 to 2027-03-13 (Asia/Shanghai). They are added to your draft. You can change them before it is sent.',
  );
  await step(page, 1).getByRole('button', { name: 'Find Suppliers or Products' }).click();
  await page.waitForURL(`**/account/drafts/${workspaceId}?draft=${draftId}`);
  // Only the draft is saved. The request is not sent, and no sharing command is made.
  expect(w.posts.map((p) => p.url)).toEqual(['/api/customer-mission-drafts']);
  expect(w.posts[0]!.body.input).toMatchObject({
    details: {
      market: 'CN',
      startDate: '2027-03-09',
      endDate: '2027-03-13',
      timezone: 'Asia/Shanghai',
      attendance: 'Not decided',
    },
  });
});

test('with nothing shared the draft keeps its market and dates empty and no prefill line is shown', async ({
  page,
}) => {
  const w = world();
  await serve(page, w);
  await page.goto(origin + '/');
  await expect(step(page, 1)).toBeVisible();
  await expect(page.getByTestId('delegate-path-prefill')).toHaveCount(0);
  await step(page, 1).getByRole('button', { name: 'Find Suppliers or Products' }).click();
  await page.waitForURL(`**/account/drafts/${workspaceId}?draft=${draftId}`);
  expect(w.posts[0]!.body.input).toMatchObject({
    details: { market: '', startDate: '', endDate: '', timezone: 'UTC' },
  });
});
