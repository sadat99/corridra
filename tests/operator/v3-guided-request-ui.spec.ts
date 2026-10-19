import { test, expect, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000006';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {GuidedRequest} from ${JSON.stringify(resolve('apps/web/app/account/drafts/guided-request.tsx'))};const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)},workspaceId:${JSON.stringify(workspaceId)},profilesEnabled:true};const render=p=>{const all={...initial,...p};root.render(<GuidedRequest {...all}/>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
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
    } else if (path === '/' || path === '/account/drafts') {
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

type Details = Record<string, unknown>;
type Draft = {
  id: string;
  version: number;
  status: string;
  requestId: string | null;
  details: Details;
};
// A small stateful stand-in for the three endpoints the screen uses.
function fake(
  initial: Draft[] = [],
  options: {
    saveStatus?: () => number | null;
    closeStatus?: () => number | null;
    requestStatus?: () => number | null;
    profile?: unknown;
  } = {},
) {
  const drafts = new Map(initial.map((d) => [d.id, d]));
  const log = {
    saves: [] as Details[],
    requests: [] as Details[],
    closes: [] as Details[],
    headers: [] as Record<string, string>[],
  };
  let counter = 0;
  const expires = () => new Date(Date.now() + 60000).toISOString();
  const view = (d: Draft, commandId?: string) => ({
    workspaceId,
    expiresAt: expires(),
    currentVersion: d.version,
    superseded: false,
    ...(commandId ? { commandId } : {}),
    draft: { ...d, updatedAt: '2026-10-19T00:00:00Z' },
  });
  return {
    drafts,
    log,
    install: async (page: Page) => {
      await page.route('**/api/customer-mission-drafts**', async (route: Route) => {
        const request = route.request();
        log.headers.push(request.headers());
        if (request.method() === 'GET') {
          const q = new URL(request.url()).searchParams;
          const id = q.get('draftId');
          if (id)
            return drafts.has(id)
              ? route.fulfill({ json: view(drafts.get(id)!) })
              : route.fulfill({ status: 403, json: { error: 'x' } });
          return route.fulfill({
            json: {
              workspaceId,
              expiresAt: expires(),
              nextAfter: null,
              drafts: [...drafts.values()].map((d) => ({
                id: d.id,
                version: d.version,
                title: d.details.title,
                family: d.details.family,
                status: d.status,
                requestId: d.requestId,
                updatedAt: '2026-10-19T00:00:00Z',
              })),
            },
          });
        }
        const body = request.postDataJSON() as { action: string; input: Details };
        if (body.action === 'save') {
          log.saves.push(body.input);
          const status = options.saveStatus?.();
          if (status) return route.fulfill({ status, json: { error: 'x' } });
          const input = body.input as {
            draftId: string | null;
            details: Details;
            commandId: string;
          };
          const id = input.draftId ?? `10000000-0000-4000-8000-00000000000${++counter}`;
          const d: Draft = {
            id,
            version: ((drafts.get(id)?.version ?? 0) as number) + 1,
            status: 'OPEN',
            requestId: null,
            details: input.details,
          };
          drafts.set(id, d);
          return route.fulfill({ json: view(d, input.commandId) });
        }
        log.closes.push(body.input);
        const status = options.closeStatus?.();
        if (status) return route.fulfill({ status, json: { error: 'x' } });
        const input = body.input as { draftId: string; outcome: string; requestId: string | null };
        const d = drafts.get(input.draftId)!;
        d.status = input.outcome;
        d.requestId = input.requestId;
        return route.fulfill({ json: view(d, body.input.commandId as string) });
      });
      await page.route('**/api/customer-requests', async (route) => {
        log.requests.push(route.request().postDataJSON());
        const status = options.requestStatus?.();
        if (status) return route.fulfill({ status, json: { error: 'x' } });
        return route.fulfill({
          json: { id: '20000000-0000-4000-8000-000000000001', workspaceId, synthetic: true },
        });
      });
      await page.route('**/api/customer-organisation-profiles**', (route) =>
        route.fulfill({
          json: options.profile ?? {
            workspaceId,
            verified: false,
            profile: {
              legalName: 'Synthetic Dhaka Towels Limited',
              website: 'https://towels.example',
              version: 4,
            },
          },
        }),
      );
    },
  };
}
const full = (over: Details = {}): Details => ({
  title: 'Synthetic towel buyer search',
  family: 'BUYERS_PARTNERS',
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'No',
  startDate: '',
  endDate: '',
  timezone: 'Europe/Madrid',
  offer: 'Synthetic hotel towels made in Bangladesh',
  website: '',
  outcomes: ['Relevant meetings'],
  notes: '',
  requirements: [{ label: 'Event or fair', value: 'Synthetic Home Textiles fair in Madrid' }],
  contactName: 'Test Person',
  contactEmail: 'mission@example.invalid',
  profileVersion: null,
  sourcingContext: null,
  companyName: 'Synthetic Dhaka Towels Limited',
  ...over,
});
const existing = (over: Partial<Draft> = {}): Draft => ({
  id: '10000000-0000-4000-8000-000000000099',
  version: 2,
  status: 'OPEN',
  requestId: null,
  details: full(),
  ...over,
});
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true }).click();

test('the start screen offers the three products and the other objective, and keeps the original form reachable', async ({
  page,
}) => {
  const server = fake();
  await server.install(page);
  await page.goto(origin);
  for (const name of [
    'Find buyers and business partners',
    'Find suppliers and source products',
    'Organise a delegation',
    'Another international business objective',
  ])
    await expect(page.getByRole('button', { name })).toBeVisible();
  await expect(page.getByText('self-declared and unverified')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Use the single-page request form instead' }),
  ).toHaveAttribute('href', '/account/request/' + workspaceId);
  await expect(page.getByRole('status')).toHaveText('You have no saved drafts yet.');
});

test('only the sourcing context chosen shows its questions, and buyers never see machinery controls (V3-04-076)', async ({
  page,
}) => {
  await fake().install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Find buyers and business partners' }).click();
  await next(page);
  await expect(page.getByRole('button', { name: 'Add Event or fair' })).toBeVisible();
  for (const word of ['Commissioning', 'Acceptance tests', 'Spares', 'Power'])
    await expect(page.getByRole('button', { name: 'Add ' + word, exact: true })).toHaveCount(0);
  await expect(page.getByLabel('What kind of purchase is this?')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Back to your drafts' }).click();
  await page.getByRole('button', { name: 'Find suppliers and source products' }).click();
  await next(page);
  await expect(page.getByRole('button', { name: 'Add Commissioning' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Technical requirements' })).toBeVisible();
  const kind = page.getByLabel('What kind of purchase is this?');
  await kind.selectOption('MACHINERY');
  for (const label of [
    'Application',
    'Capacity',
    'Power',
    'Installation',
    'Commissioning',
    'Acceptance tests',
    'Warranties',
    'Spares',
    'Maintenance',
    'After-sales support',
  ])
    await expect(page.getByRole('button', { name: 'Add ' + label, exact: true })).toBeVisible();
  await kind.selectOption('MATERIALS_COMPONENTS');
  await expect(page.getByRole('button', { name: 'Add Tolerances' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Commissioning' })).toHaveCount(0);
  await kind.selectOption('OTHER_PROCUREMENT');
  await expect(
    page.getByText('Suggested questions for other purchases are not available yet.'),
  ).toBeVisible();
});

test('a draft saves as a new version with the exact command, headers and typed details', async ({
  page,
}) => {
  const server = fake();
  await server.install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Find buyers and business partners' }).click();
  await page.getByLabel('Target country or market').fill('Spain');
  await next(page);
  await page
    .getByLabel('What do you offer or need? (start with Synthetic)')
    .fill('Synthetic hotel towels');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  expect(server.log.saves).toHaveLength(1);
  expect(server.log.saves[0]).toMatchObject({
    workspaceId,
    draftId: null,
    expectedVersion: 0,
    acknowledged: true,
    details: {
      family: 'BUYERS_PARTNERS',
      market: 'Spain',
      offer: 'Synthetic hotel towels',
      sourcingContext: null,
    },
  });
  expect(
    server.log.headers.every(
      (h) =>
        h['x-corridra-customer-subject'] === 'synthetic-alice' &&
        h['x-corridra-customer-issuer'] === issuer,
    ),
  ).toBe(true);
  await page.getByLabel('Target country or market');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByLabel('Target country or market').fill('Spain and Portugal');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect.poll(() => server.log.saves.length).toBe(2);
  expect(server.log.saves[1]).toMatchObject({ expectedVersion: 1, draftId: expect.any(String) });
});

test('an unconfirmed save keeps the text and retries with the same command id', async ({
  page,
}) => {
  let attempt = 0;
  const server = fake([], { saveStatus: () => (++attempt === 1 ? 500 : null) });
  await server.install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Find buyers and business partners' }).click();
  await page.getByLabel('Target country or market').fill('Spain');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toContainText('Saving could not be confirmed');
  await expect(page.getByLabel('Target country or market')).toHaveValue('Spain');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  expect(server.log.saves).toHaveLength(2);
  expect(server.log.saves[1].commandId).toBe(server.log.saves[0].commandId);
});

test('inline guidance explains test-mode text rules and blocks saving until fixed', async ({
  page,
}) => {
  const server = fake();
  await server.install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Find buyers and business partners' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByLabel('Name this request (start with Synthetic)').fill('Towel buyers');
  await expect(page.getByRole('alert')).toContainText('starts with Synthetic');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toContainText('Fix the highlighted details');
  expect(server.log.saves).toHaveLength(0);
});

test('review names what is missing in plain language, offers save-and-finish-later and blocks sending', async ({
  page,
}) => {
  await fake().install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Find buyers and business partners' }).click();
  await page.getByRole('button', { name: '5. Review and send' }).click();
  const alert = page.getByRole('alert');
  for (const gap of [
    'the target country or market',
    'what you offer or need',
    'at least one outcome you want',
    'your name',
    'your company name',
    'a test email address',
  ])
    await expect(alert).toContainText(gap);
  await expect(alert).toContainText('You can save the draft now and finish later.');
  await expect(page.getByRole('button', { name: 'Send request' })).toBeDisabled();
  await expect(page.getByText('A request is not an accepted engagement')).toBeVisible();
  await expect(page.getByText('self-declared and unverified')).toBeVisible();
});

test('sending uses the existing request with a stable command id, then closes the draft', async ({
  page,
}) => {
  const server = fake([existing()]);
  await server.install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: /Continue Synthetic towel buyer search/ }).click();
  await page.getByRole('button', { name: '5. Review and send' }).click();
  await expect(page.getByRole('button', { name: 'Send request' })).toBeDisabled();
  await page.getByLabel('I confirm these are fictional test details.').check();
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('heading', { name: 'Your request was sent.' })).toBeVisible();
  await expect(page.getByText('This is a request, not an accepted engagement.')).toBeVisible();
  expect(server.log.saves).toHaveLength(0);
  expect(server.log.requests).toHaveLength(1);
  const sent = server.log.requests[0] as {
    commandId: string;
    workspaceId: string;
    brief: Record<string, unknown>;
  };
  expect(sent.workspaceId).toBe(workspaceId);
  expect(sent.brief).toMatchObject({
    objective: 'Sell in a new market',
    market: 'Spain',
    company: 'Synthetic Dhaka Towels Limited',
    name: 'Test Person',
    email: 'mission@example.invalid',
    acknowledged: true,
  });
  expect(String(sent.brief.offer)).toContain('Synthetic hotel towels made in Bangladesh');
  expect(String(sent.brief.offer)).toContain(
    'Event or fair: Synthetic Home Textiles fair in Madrid',
  );
  expect(server.log.closes).toEqual([
    expect.objectContaining({
      draftId: existing().id,
      outcome: 'SUBMITTED',
      requestId: '20000000-0000-4000-8000-000000000001',
    }),
  ]);
  expect(sent.commandId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test('if closing fails after sending, pressing Send again reuses the same request command', async ({
  page,
}) => {
  let attempt = 0;
  const server = fake([existing()], { closeStatus: () => (++attempt === 1 ? 500 : null) });
  await server.install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: /Continue Synthetic towel buyer search/ }).click();
  await page.getByRole('button', { name: '5. Review and send' }).click();
  await page.getByLabel('I confirm these are fictional test details.').check();
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('status')).toContainText('Press Send again to finish');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('heading', { name: 'Your request was sent.' })).toBeVisible();
  expect(server.log.requests).toHaveLength(2);
  expect(server.log.requests[1].commandId).toBe(server.log.requests[0].commandId);
});

test('a request that cannot be confirmed keeps the draft and the limit message is clear', async ({
  page,
}) => {
  let status = 429;
  const server = fake([existing()], { requestStatus: () => status });
  await server.install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: /Continue Synthetic towel buyer search/ }).click();
  await page.getByRole('button', { name: '5. Review and send' }).click();
  await page.getByLabel('I confirm these are fictional test details.').check();
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('status')).toContainText('request limit was reached');
  status = 500;
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('status')).toContainText('Press Send again to retry safely');
  expect(server.log.closes).toHaveLength(0);
});

test("a conflicting save keeps the customer's text and offers a reload instead of clearing it", async ({
  page,
}) => {
  const server = fake([existing()], { saveStatus: () => 409 });
  await server.install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: /Continue Synthetic towel buyer search/ }).click();
  await page.getByLabel('Target country or market').fill('Italy');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toContainText('Your text below is kept');
  await expect(page.getByLabel('Target country or market')).toHaveValue('Italy');
  await expect(page.getByRole('button', { name: 'Reload the latest draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});

for (const status of [403, 503])
  test('save ' + status + ' clears local details and says why', async ({ page }) => {
    await fake([existing()], { saveStatus: () => status }).install(page);
    await page.goto(origin);
    await page.getByRole('button', { name: /Continue Synthetic towel buyer search/ }).click();
    await page.getByLabel('Target country or market').fill('Italy');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status')).toContainText(
      status === 403 ? 'Access to this workspace changed' : 'unavailable',
    );
    await expect(page.getByLabel('Target country or market')).toHaveCount(0);
    await expect(page.getByText('Synthetic towel buyer search')).toHaveCount(0);
  });

test('a sent draft opens read-only at the review and offers no way to edit or send again', async ({
  page,
}) => {
  await fake([
    existing({ status: 'SUBMITTED', requestId: '20000000-0000-4000-8000-000000000001' }),
  ]).install(page);
  await page.goto(origin);
  await expect(page.getByText('Sent as a request')).toBeVisible();
  await page.getByRole('button', { name: /View Synthetic towel buyer search/ }).click();
  await expect(page.getByText('now read-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send request' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  await page.getByRole('button', { name: '1. What you want' }).click();
  await expect(page.getByLabel('Name this request (start with Synthetic)')).toBeDisabled();
});

test('a saved company profile is optional: it fills the company and pins its version, and no profile still works', async ({
  page,
}) => {
  const server = fake();
  await server.install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Find buyers and business partners' }).click();
  await page.getByRole('button', { name: '4. About you' }).click();
  await expect(page.getByText('A saved company profile is optional.')).toBeVisible();
  await page.getByRole('button', { name: 'Use my saved company profile' }).click();
  await expect(page.getByLabel('Company name (start with Synthetic)')).toHaveValue(
    'Synthetic Dhaka Towels Limited',
  );
  await expect(page.getByLabel('Website (optional)')).toHaveValue('https://towels.example');
  await expect(page.getByRole('status')).toContainText('version 4');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect.poll(() => server.log.saves.length).toBe(1);
  expect(server.log.saves[0]).toMatchObject({
    details: { profileVersion: 4, companyName: 'Synthetic Dhaka Towels Limited' },
  });
  // Typing a company by hand needs no profile at all.
  await page
    .getByLabel('Company name (start with Synthetic)')
    .fill('Synthetic Typed Company Limited');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a missing profile or a failed profile load leaves the form usable', async ({ page }) => {
  await fake([], { profile: { workspaceId, verified: false, profile: null } }).install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Find buyers and business partners' }).click();
  await page.getByRole('button', { name: '4. About you' }).click();
  await page.getByRole('button', { name: 'Use my saved company profile' }).click();
  await expect(page.getByRole('status')).toContainText('You have not saved a company profile yet');
  await expect(page.getByLabel('Company name (start with Synthetic)')).toBeEnabled();
});

test('an unverified-claim profile response is refused', async ({ page }) => {
  await fake([], {
    profile: {
      workspaceId,
      verified: true,
      profile: { legalName: 'Synthetic Forged Company', website: null, version: 1 },
    },
  }).install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Find buyers and business partners' }).click();
  await page.getByRole('button', { name: '4. About you' }).click();
  await page.getByRole('button', { name: 'Use my saved company profile' }).click();
  await expect(page.getByRole('status')).toContainText('could not be loaded');
  await expect(page.getByLabel('Company name (start with Synthetic)')).toHaveValue('');
});

test('leaving with unsaved changes asks first, and changing the signed-in account discards the old screen', async ({
  page,
}) => {
  await fake([existing()]).install(page);
  await page.goto(origin);
  await page.getByRole('button', { name: /Continue Synthetic towel buyer search/ }).click();
  await page.getByLabel('Target country or market').fill('Italy');
  await expect(page.getByText('You have unsaved changes.')).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Back to your drafts' }).click();
  await expect(page.getByLabel('Target country or market')).toHaveValue('Italy');
  await page.evaluate((issuerValue) => {
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', {
        detail: { subject: 'synthetic-bob', issuer: issuerValue },
      }),
    );
  }, issuer);
  await expect(page.getByLabel('Target country or market')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'What do you want to do?' })).toBeVisible();
});

for (const width of [320, 390, 768, 1440])
  test('keyboard and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fake([existing()]).install(page);
    await page.goto(origin);
    const scan = async () => {
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
    };
    await scan();
    await page.getByRole('button', { name: /Continue Synthetic towel buyer search/ }).click();
    for (const name of [
      '1. What you want',
      '2. Where and when',
      '3. What you offer or need',
      '4. About you',
      '5. Review and send',
    ]) {
      await page.getByRole('button', { name }).click();
      await expect(page.getByRole('heading', { name: name.slice(3) })).toBeFocused();
      await scan();
    }
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBeTruthy();
    if (width === 320) {
      await mkdir('.cache/v3-guided-request/after', { recursive: true });
      await page.screenshot({
        path: '.cache/v3-guided-request/after/review-320.png',
        fullPage: true,
      });
    }
  });
