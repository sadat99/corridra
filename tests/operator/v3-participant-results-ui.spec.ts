import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-results-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const programmeId = '00000000-0000-4000-8000-000000000007';
const regA = '00000000-0000-4000-8000-0000000000a1';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {ParticipantResults} from ${JSON.stringify(resolve('apps/web/app/account/delegations/participant-results.tsx'))};const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-bob',issuer:${JSON.stringify(issuer)},registrationId:${JSON.stringify(regA)}};const render=p=>{const all={...initial,...p};root.render(<ParticipantResults key={all.issuer+all.subject+all.workspaceId} {...all}/>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
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

const recordId = (n: number) => '00000000-0000-4000-8000-0000000002' + String(n).padStart(2, '0');
const fb = (over: Record<string, unknown> = {}) => ({
  recordId: recordId(1),
  kind: 'FEEDBACK',
  version: 1,
  shared: false,
  retracted: false,
  rating: 4,
  outcomeKind: null,
  occurredOn: null,
  note: 'Synthetic the programme was well organised',
  updatedAt: '2026-10-02T00:00:00Z',
  provenance: 'PARTICIPANT_REPORTED',
  ...over,
});
const oc = (n: number, over: Record<string, unknown> = {}) => ({
  recordId: recordId(10 + n),
  kind: 'OUTCOME',
  version: 1,
  shared: true,
  retracted: false,
  rating: null,
  outcomeKind: 'MEETING_HELD',
  occurredOn: '2026-10-02',
  note: 'Synthetic met a buyer on day two',
  updatedAt: '2026-10-02T00:00:00Z',
  provenance: 'PARTICIPANT_REPORTED',
  ...over,
});
function view(over: Record<string, unknown> = {}, ttl = 60000) {
  return {
    registrationId: regA,
    programmeId,
    expiresAt: new Date(Date.now() + ttl).toISOString(),
    feedback: null,
    outcomes: [],
    ...over,
  };
}
type Handler = {
  get?: () => unknown;
  post?: (body: Record<string, unknown>) => { status?: number; json: unknown };
  seen?: { headers: Record<string, string>[]; urls: string[] };
};
async function mock(page: Page, handler: Handler = {}) {
  await page.route('**/api/customer-programme-coordination**', (route) => {
    const request = route.request();
    handler.seen?.headers.push(request.headers());
    handler.seen?.urls.push(request.url());
    if (request.method() === 'GET') return route.fulfill({ json: handler.get?.() ?? view() });
    const out = handler.post!(request.postDataJSON());
    return route.fulfill({ status: out.status ?? 200, json: out.json });
  });
}
const okRecord = (body: Record<string, unknown>, record: Record<string, unknown>) => ({
  json: {
    registrationId: regA,
    record,
    commandId: (body.input as Record<string, unknown>).commandId,
    replayed: false,
  },
});
async function open(page: Page) {
  await page.goto(origin);
  await page.getByRole('button', { name: 'Share feedback and results' }).click();
  await expect(page.getByRole('heading', { name: 'My feedback and results' })).toBeVisible();
}
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('it starts collapsed, loads on request and explains who sees what', async ({ page }) => {
  const seen = { headers: [] as Record<string, string>[], urls: [] as string[] };
  await mock(page, { seen });
  await page.goto(origin);
  expect(seen.urls).toHaveLength(0);
  await open(page);
  await expect(
    page.getByText('The organiser sees an item only if you choose to share it', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Do not enter prices, contract values or contact details', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('No results added yet.')).toBeVisible();
  expect(
    seen.headers.every(
      (h) =>
        h['x-corridra-customer-subject'] === 'synthetic-bob' &&
        h['x-corridra-customer-issuer'] === issuer,
    ),
  ).toBe(true);
  expect(seen.urls[0]).toContain('view=records&registrationId=' + regA);
});
test('feedback is validated, then sent exactly with the share choice', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (b) => {
      commands.push(b);
      return okRecord(b, fb({ shared: true, rating: 5 }));
    },
  });
  await open(page);
  await page.getByRole('button', { name: 'Save feedback' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose a rating');
  await page.getByLabel('5 · Excellent').check();
  await page.getByLabel('Comment (optional, start with Synthetic)').fill('A good programme');
  await page.getByRole('button', { name: 'Save feedback' }).click();
  await expect(page.getByRole('alert')).toContainText('Start the comment with the word Synthetic');
  await page
    .getByLabel('Comment (optional, start with Synthetic)')
    .fill('Synthetic a very good programme');
  await page.getByRole('button', { name: 'Save feedback' }).click();
  await expect(page.getByRole('alert')).toContainText('Confirm that this is fictional');
  expect(commands).toHaveLength(0);
  await page.getByLabel(/Share this feedback with the organiser/).check();
  await page.getByLabel('This is fictional sample feedback.').check();
  await page.getByRole('button', { name: 'Save feedback' }).click();
  await expect(status(page, 'Feedback saved and shared with the organiser.')).toBeVisible();
  expect(commands[0]).toMatchObject({
    action: 'record',
    input: {
      registrationId: regA,
      kind: 'FEEDBACK',
      recordId: null,
      expectedVersion: 0,
      rating: 5,
      outcomeKind: null,
      occurredOn: null,
      note: 'Synthetic a very good programme',
      shared: true,
      retracted: false,
      acknowledged: true,
    },
  });
  expect(Object.keys((commands[0] as { input: object }).input).sort()).toEqual([
    'acknowledged',
    'commandId',
    'expectedVersion',
    'kind',
    'note',
    'occurredOn',
    'outcomeKind',
    'rating',
    'recordId',
    'registrationId',
    'retracted',
    'shared',
  ]);
});
test('existing private feedback is updated with its version and can be withdrawn', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    get: () => view({ feedback: fb({ version: 2 }) }),
    post: (b) => {
      commands.push(b);
      return okRecord(b, fb({ version: 3 }));
    },
  });
  await open(page);
  await expect(page.getByLabel('4 · Good')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Update feedback' })).toBeVisible();
  await page.getByLabel(/Share this feedback with the organiser/).check();
  await page.getByLabel('This is fictional sample feedback.').check();
  await page.getByRole('button', { name: 'Update feedback' }).click();
  await expect(status(page, 'Feedback saved and shared')).toBeVisible();
  expect(commands[0]).toMatchObject({
    input: { recordId: recordId(1), expectedVersion: 2, shared: true },
  });
  await page.getByRole('button', { name: 'Withdraw my feedback' }).click();
  await expect(status(page, 'Withdrawn. The organiser can no longer see it.')).toBeVisible();
  expect(commands[1]).toMatchObject({
    input: { recordId: recordId(1), expectedVersion: 2, rating: 4, shared: false, retracted: true },
  });
});
test('withdrawn feedback is shown as withdrawn and cannot be edited', async ({ page }) => {
  await mock(page, { get: () => view({ feedback: fb({ retracted: true, version: 3 }) }) });
  await open(page);
  await expect(page.getByText('You withdrew your feedback')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update feedback' })).toHaveCount(0);
  await expect(page.getByLabel('4 · Good')).toBeDisabled();
});
test('a result is validated, can be dated no later than today, and is sent with the share choice', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (b) => {
      commands.push(b);
      return okRecord(b, oc(1));
    },
  });
  await open(page);
  const max = await page.getByLabel('Date', { exact: true }).getAttribute('max');
  expect(max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByLabel('What happened?').selectOption('SAMPLE_OR_QUOTE_REQUESTED');
  await page.getByLabel('Date', { exact: true }).fill('2026-10-03');
  await page.getByRole('button', { name: 'Add result' }).click();
  await expect(page.getByRole('alert')).toContainText('Start the note with the word Synthetic');
  await page.getByLabel('Note (start with Synthetic)').fill('Synthetic a buyer asked for a sample');
  await page.getByRole('button', { name: 'Add result' }).click();
  await expect(page.getByRole('alert')).toContainText('Confirm that this is a fictional');
  expect(commands).toHaveLength(0);
  await page.getByLabel('This is a fictional sample result.').check();
  await page.getByRole('button', { name: 'Add result' }).click();
  await expect(status(page, 'Result saved. The organiser cannot see it.')).toBeVisible();
  expect(commands[0]).toMatchObject({
    input: {
      kind: 'OUTCOME',
      recordId: null,
      expectedVersion: 0,
      rating: null,
      outcomeKind: 'SAMPLE_OR_QUOTE_REQUESTED',
      occurredOn: '2026-10-03',
      note: 'Synthetic a buyer asked for a sample',
      shared: false,
      retracted: false,
    },
  });
});
test('a result can stop being shared or be withdrawn, keeping its content in the command', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    get: () => view({ outcomes: [oc(1, { version: 2 })] }),
    post: (b) => {
      commands.push(b);
      return okRecord(b, oc(1));
    },
  });
  await open(page);
  await expect(page.getByText('Shared with the organiser')).toBeVisible();
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(status(page, 'No longer shared with the organiser.')).toBeVisible();
  expect(commands[0]).toMatchObject({
    input: {
      recordId: recordId(11),
      expectedVersion: 2,
      outcomeKind: 'MEETING_HELD',
      occurredOn: '2026-10-02',
      note: 'Synthetic met a buyer on day two',
      shared: false,
      retracted: false,
    },
  });
  await page.getByRole('button', { name: 'Withdraw this result' }).click();
  await expect(status(page, 'Withdrawn. The organiser can no longer see it.')).toBeVisible();
  expect(commands[1]).toMatchObject({
    input: { recordId: recordId(11), shared: false, retracted: true },
  });
});
test('a withdrawn result offers no further actions', async ({ page }) => {
  await mock(page, { get: () => view({ outcomes: [oc(1, { shared: false, retracted: true })] }) });
  await open(page);
  await expect(page.getByText('Withdrawn · not shared')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop sharing' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Share with the organiser' })).toHaveCount(0);
});
test('a failed save keeps what was typed and retries with the identical command', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (b) => {
      commands.push(b);
      return commands.length === 1 ? { status: 500, json: { error: 'x' } } : okRecord(b, oc(1));
    },
  });
  await open(page);
  await page
    .getByLabel('Note (start with Synthetic)')
    .fill('Synthetic a follow up call was agreed');
  await page.getByLabel('This is a fictional sample result.').check();
  await page.getByRole('button', { name: 'Add result' }).click();
  await expect(page.getByRole('alert')).toContainText('try again');
  await expect(page.getByLabel('Note (start with Synthetic)')).toHaveValue(
    'Synthetic a follow up call was agreed',
  );
  await page.getByRole('button', { name: 'Add result' }).click();
  await expect(status(page, 'Result saved')).toBeVisible();
  expect(commands[1]).toEqual(commands[0]);
});
test('a stale record keeps the draft and explains it', async ({ page }) => {
  await mock(page, {
    get: () => view({ feedback: fb() }),
    post: () => ({ status: 409, json: { error: 'conflict' } }),
  });
  await open(page);
  await page.getByLabel('This is fictional sample feedback.').check();
  await page.getByRole('button', { name: 'Update feedback' }).click();
  await expect(page.getByRole('alert')).toContainText('changed since you opened it');
});
test('a changed account on save clears every private detail', async ({ page }) => {
  await mock(page, {
    get: () => view({ feedback: fb() }),
    post: () => ({
      status: 409,
      json: { error: 'Your account changed. Reload before continuing.' },
    }),
  });
  await open(page);
  await page.getByLabel('This is fictional sample feedback.').check();
  await page.getByRole('button', { name: 'Update feedback' }).click();
  await expect(page.getByRole('alert')).toContainText('access changed');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByLabel('4 · Good')).toHaveCount(0);
});
for (const code of [401, 403])
  test('save ' + code + ' clears private details', async ({ page }) => {
    await mock(page, {
      get: () => view({ feedback: fb() }),
      post: () => ({ status: code, json: { error: 'Denied' } }),
    });
    await open(page);
    await page.getByLabel('This is fictional sample feedback.').check();
    await page.getByRole('button', { name: 'Update feedback' }).click();
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });
test('read 403 shows a denial and read 503 says unavailable', async ({ page }) => {
  await page.route('**/api/customer-programme-coordination**', (route) =>
    route.fulfill({ status: 403, json: { error: 'Denied' } }),
  );
  await open(page);
  await expect(page.getByRole('alert')).toContainText('access changed');
  await page.unroute('**/api/customer-programme-coordination**');
  await page.route('**/api/customer-programme-coordination**', (route) =>
    route.fulfill({ status: 503, json: { error: 'x' } }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Share feedback and results' }).click();
  await expect(status(page, 'unavailable')).toBeVisible();
});
test('a response for another registration or with an invalid record is rejected', async ({
  page,
}) => {
  for (const patch of [
    { registrationId: '00000000-0000-4000-8000-0000000000ff' },
    { feedback: fb({ rating: 9 }) },
    { outcomes: [oc(1, { outcomeKind: 'ORDER_VALUE' })] },
    { feedback: fb({ kind: 'OUTCOME' }) },
  ]) {
    await page.unroute('**/api/customer-programme-coordination**').catch(() => undefined);
    await mock(page, { get: () => view(patch) });
    await open(page);
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
    await expect(page.getByRole('textbox')).toHaveCount(0);
  }
});
test('access expiry clears the form without extending permission', async ({ page }) => {
  await mock(page, { get: () => view({ feedback: fb() }, 700) });
  await open(page);
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
test('changing the signed-in account discards the previous account data', async ({ page }) => {
  await mock(page, { get: () => view({ feedback: fb() }) });
  await open(page);
  await expect(page.getByLabel('4 · Good')).toBeChecked();
  await page.unroute('**/api/customer-programme-coordination**');
  await mock(page, { get: () => view() });
  await page.evaluate(
    (i) =>
      window.dispatchEvent(
        new CustomEvent('fixture-customer-change', {
          detail: { subject: 'synthetic-carol', issuer: i },
        }),
      ),
    issuer,
  );
  await expect(page.getByRole('button', { name: 'Share feedback and results' })).toBeVisible();
  await expect(page.getByLabel('4 · Good')).toHaveCount(0);
});
for (const width of [320, 390, 768, 1440])
  test('keyboard and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mock(page, { get: () => view({ feedback: fb(), outcomes: [oc(1)] }) });
    await open(page);
    await expect(page.getByText('My results')).toBeVisible();
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
      await mkdir('.cache/v3-programme-coordination/after', { recursive: true });
      await page.screenshot({
        path: '.cache/v3-programme-coordination/after/participant-320.png',
        fullPage: true,
      });
    }
  });
