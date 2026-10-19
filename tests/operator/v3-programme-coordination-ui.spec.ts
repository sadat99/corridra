import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-coord-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000006';
const programmeId = '00000000-0000-4000-8000-000000000007';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {ProgrammeCoordination} from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-coordination.tsx'))};const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)},workspaceId:${JSON.stringify(workspaceId)},programmeId:${JSON.stringify(programmeId)}};const render=p=>{const all={...initial,...p};root.render(<ProgrammeCoordination key={all.issuer+all.subject+all.workspaceId} {...all}/>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
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

const reg = (n: number) => '00000000-0000-4000-8000-0000000000b' + n;
const taskId = (n: number) => '00000000-0000-4000-8000-0000000001' + String(n).padStart(2, '0');
const task = (n: number, over: Record<string, unknown> = {}) => ({
  id: taskId(n),
  seq: n,
  version: 1,
  title: 'Synthetic book the venue for day one',
  detail: null,
  status: 'OPEN',
  dueOn: null,
  assigneeLabel: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  provenance: 'ORGANISER_RECORDED',
  ...over,
});
function report(over: Record<string, unknown> = {}, ttl = 60000) {
  return {
    workspaceId,
    programmeId,
    expiresAt: new Date(Date.now() + ttl).toISOString(),
    asOf: '2026-10-19',
    verified: false,
    sendsMessages: false,
    activeParticipants: 3,
    capacity: { capacity: 2, version: 1, reason: 'Synthetic the venue seats two groups' },
    attendance: {
      attended: 1,
      absent: 1,
      notRecorded: 1,
      withdrawnOrRemoved: 1,
      provenance: 'ORGANISER_RECORDED',
    },
    tasks: {
      open: 2,
      inProgress: 1,
      done: 3,
      cancelled: 0,
      overdue: 1,
      provenance: 'ORGANISER_RECORDED',
    },
    feedback: {
      responses: 3,
      shared: 2,
      notShared: 1,
      ratingCount: 2,
      ratingSum: 9,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 },
      comments: ['Synthetic the schedule was well paced'],
      provenance: 'PARTICIPANT_REPORTED',
    },
    outcomes: {
      total: 3,
      shared: 2,
      notShared: 1,
      byKind: { MEETING_HELD: 2 },
      items: [
        {
          label: 'Synthetic participant Bob',
          outcomeKind: 'MEETING_HELD',
          occurredOn: '2026-10-02',
          note: 'Synthetic met a buyer on day two',
        },
      ],
      provenance: 'PARTICIPANT_REPORTED',
    },
    repeat: { returningParticipants: 1, basis: 'x' },
    participants: [
      {
        registrationId: reg(1),
        label: 'Synthetic participant Bob',
        state: 'ACTIVE',
        attendance: 'ATTENDED',
        attendanceVersion: 1,
      },
      {
        registrationId: reg(2),
        label: 'Synthetic participant Carol',
        state: 'ACTIVE',
        attendance: null,
        attendanceVersion: 0,
      },
      {
        registrationId: reg(3),
        label: 'Synthetic participant Dina',
        state: 'WITHDRAWN',
        attendance: null,
        attendanceVersion: 0,
      },
    ],
    ...over,
  };
}
function tasks(
  rows: unknown[] = [
    task(1),
    task(2, {
      title: 'Synthetic arrange airport pickups',
      status: 'IN_PROGRESS',
      dueOn: '2026-10-05',
      assigneeLabel: 'Synthetic local guide Rahim',
      detail: 'Synthetic two vans from the airport',
      version: 3,
    }),
  ],
  nextAfter: number | null = null,
  ttl = 60000,
) {
  return {
    workspaceId,
    programmeId,
    expiresAt: new Date(Date.now() + ttl).toISOString(),
    tasks: rows,
    nextAfter,
  };
}
type Handler = {
  report?: () => unknown;
  tasks?: (url: URL) => unknown;
  post?: (body: Record<string, unknown>) => { status?: number; json: unknown };
  seen?: { headers: Record<string, string>[]; urls: string[] };
};
async function mock(page: Page, handler: Handler = {}) {
  await page.route('**/api/customer-programme-coordination**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    handler.seen?.headers.push(request.headers());
    handler.seen?.urls.push(request.url());
    if (request.method() === 'GET')
      return route.fulfill({
        json:
          url.searchParams.get('view') === 'report'
            ? (handler.report?.() ?? report())
            : (handler.tasks?.(url) ?? tasks()),
      });
    const out = handler.post!(request.postDataJSON());
    return route.fulfill({ status: out.status ?? 200, json: out.json });
  });
}
const ok = (body: Record<string, unknown>) => ({
  json: {
    workspaceId,
    programmeId,
    commandId: body.input && (body.input as Record<string, unknown>).commandId,
    replayed: false,
  },
});
const saved = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('the report is labelled by who reported each figure and shows the exact average', async ({
  page,
}) => {
  await mock(page);
  await page.goto(origin);
  await expect(page.getByText('no message is sent to anyone', { exact: false })).toBeVisible();
  const table = page.getByRole('table', { name: 'Plan and results' });
  await expect(table).toContainText('3 of 2 places');
  await expect(table).toContainText('over capacity');
  await expect(table).toContainText(
    '1 attended · 1 absent · 1 not recorded · 1 withdrawn or removed',
  );
  await expect(table).toContainText('2 open · 1 in progress · 3 done · 0 cancelled · 1 overdue');
  await expect(table).toContainText('4.5 out of 5 from 2 shared ratings');
  await expect(table).toContainText('1 not shared with you');
  await expect(table).toContainText('Satisfaction (reported by participants)');
  await expect(table).toContainText('A meeting was held: 2');
  await expect(table).toContainText('1 also registered in another programme');
  await expect(page.getByText('Synthetic the schedule was well paced')).toBeVisible();
  await expect(page.getByRole('list').filter({ hasText: 'met a buyer on day two' })).toContainText(
    'Synthetic participant Bob',
  );
  const feedbackBlock = page
    .getByRole('heading', { name: /Shared comments/ })
    .locator('xpath=following-sibling::ul[1]');
  await expect(feedbackBlock).not.toContainText('Bob');
});
test('an empty programme shows nothing invented', async ({ page }) => {
  await mock(page, {
    report: () =>
      report({
        activeParticipants: 0,
        capacity: { capacity: null, version: 0, reason: null },
        attendance: { attended: 0, absent: 0, notRecorded: 0, withdrawnOrRemoved: 0 },
        tasks: { open: 0, inProgress: 0, done: 0, cancelled: 0, overdue: 0 },
        feedback: {
          responses: 0,
          shared: 0,
          notShared: 0,
          ratingCount: 0,
          ratingSum: 0,
          distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
          comments: [],
        },
        outcomes: { total: 0, shared: 0, notShared: 0, byKind: {}, items: [] },
        repeat: { returningParticipants: 0 },
        participants: [],
      }),
    tasks: () => tasks([]),
  });
  await page.goto(origin);
  await expect(page.getByText('No shared ratings yet')).toBeVisible();
  await expect(page.getByText('no capacity set')).toBeVisible();
  await expect(page.getByText('No tasks yet.')).toBeVisible();
  await expect(page.getByText('No registered participants yet.')).toBeVisible();
});
test('capacity is sent with the expected version and checked first', async ({ page }) => {
  const seen = { headers: [] as Record<string, string>[], urls: [] as string[] };
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    seen,
    post: (b) => {
      commands.push(b);
      return ok(b);
    },
  });
  await page.goto(origin);
  await page.getByLabel('Places available').fill('0');
  await page.getByRole('button', { name: 'Save capacity' }).click();
  await expect(page.getByRole('alert')).toContainText('whole number from 1 to 10000');
  await page.getByLabel('Places available').fill('40');
  await page.getByLabel('Reason (start with Synthetic)').fill('A bigger hall');
  await page.getByRole('button', { name: 'Save capacity' }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic');
  expect(commands).toHaveLength(0);
  await page
    .getByLabel('Reason (start with Synthetic)')
    .fill('Synthetic a bigger hall is confirmed');
  await page.getByRole('button', { name: 'Save capacity' }).click();
  await expect(saved(page, 'Capacity saved.')).toBeVisible();
  expect(commands[0]).toMatchObject({
    action: 'capacity',
    input: {
      workspaceId,
      programmeId,
      expectedVersion: 1,
      capacity: 40,
      reason: 'Synthetic a bigger hall is confirmed',
    },
  });
  expect(
    seen.headers.every(
      (h) =>
        h['x-corridra-customer-subject'] === 'synthetic-alice' &&
        h['x-corridra-customer-issuer'] === issuer,
    ),
  ).toBe(true);
});
test('attendance is marked per active participant and not offered for withdrawn ones', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (b) => {
      commands.push(b);
      return ok(b);
    },
  });
  await page.goto(origin);
  await expect(page.getByRole('button', { name: /for Synthetic participant Dina/ })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Mark attended for Synthetic participant Bob' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Mark absent for Synthetic participant Carol' }).click();
  await expect(saved(page, 'Attendance saved.')).toBeVisible();
  expect(commands[0]).toMatchObject({
    action: 'attendance',
    input: { registrationId: reg(2), state: 'ABSENT', workspaceId, programmeId },
  });
  expect(Object.keys((commands[0] as { input: object }).input).sort()).toEqual([
    'commandId',
    'programmeId',
    'registrationId',
    'state',
    'workspaceId',
  ]);
});
test('a new task is validated and sent as open with version zero', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (b) => {
      commands.push(b);
      return ok(b);
    },
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Add a task' }).click();
  await page.getByLabel('Title (start with Synthetic)').fill('Book the hall');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Start the task title with the word Synthetic',
  );
  expect(commands).toHaveLength(0);
  await page.getByLabel('Title (start with Synthetic)').fill('Synthetic confirm the interpreter');
  await page.getByLabel('Due date (optional)').fill('2026-11-01');
  await page
    .getByLabel('Who is responsible (optional, start with Synthetic)')
    .fill('Synthetic local helper Mina');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(saved(page, 'Task added.')).toBeVisible();
  expect(commands[0]).toMatchObject({
    action: 'task',
    input: {
      expectedVersion: 0,
      task: {
        taskId: null,
        title: 'Synthetic confirm the interpreter',
        detail: null,
        status: 'OPEN',
        dueOn: '2026-11-01',
        assigneeLabel: 'Synthetic local helper Mina',
      },
    },
  });
});
test('editing a task sends its id and version and can change its status', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (b) => {
      commands.push(b);
      return ok(b);
    },
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Edit task 2' }).click();
  await page.getByLabel('Status').selectOption('DONE');
  await page.getByRole('button', { name: 'Save task' }).click();
  await expect(saved(page, 'Task updated.')).toBeVisible();
  expect(commands[0]).toMatchObject({
    action: 'task',
    input: {
      expectedVersion: 3,
      task: {
        taskId: taskId(2),
        status: 'DONE',
        dueOn: '2026-10-05',
        assigneeLabel: 'Synthetic local guide Rahim',
      },
    },
  });
});
test('a failed save keeps the form and retries with the identical command; a changed input gets a new one', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (b) => {
      commands.push(b);
      return commands.length === 1 ? { status: 500, json: { error: 'x' } } : ok(b);
    },
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Add a task' }).click();
  await page.getByLabel('Title (start with Synthetic)').fill('Synthetic print the name badges');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('alert')).toContainText('try again');
  await expect(page.getByLabel('Title (start with Synthetic)')).toHaveValue(
    'Synthetic print the name badges',
  );
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(saved(page, 'Task added.')).toBeVisible();
  expect((commands[1].input as { commandId: string }).commandId).toBe(
    (commands[0].input as { commandId: string }).commandId,
  );
  expect(commands[1]).toEqual(commands[0]);
});
test('a stale version keeps the draft and explains it', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Edit task 1' }).click();
  await page.getByLabel('Title (start with Synthetic)').fill('Synthetic a different title');
  await page.getByRole('button', { name: 'Save task' }).click();
  await expect(page.getByRole('alert')).toContainText('changed since you opened it');
  await expect(page.getByLabel('Title (start with Synthetic)')).toHaveValue(
    'Synthetic a different title',
  );
});
test('a changed account on save clears every private detail', async ({ page }) => {
  await mock(page, {
    post: () => ({
      status: 409,
      json: { error: 'Your account changed. Reload before continuing.' },
    }),
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Mark absent for Synthetic participant Carol' }).click();
  await expect(page.getByRole('alert')).toContainText('access changed');
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('Synthetic participant Bob')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
for (const status of [401, 403])
  test('save ' + status + ' clears private details', async ({ page }) => {
    await mock(page, { post: () => ({ status, json: { error: 'Denied' } }) });
    await page.goto(origin);
    await page.getByRole('button', { name: 'Mark absent for Synthetic participant Carol' }).click();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText('Synthetic participant Bob')).toHaveCount(0);
  });
test('read 403 shows a denial and read 503 says unavailable', async ({ page }) => {
  await page.route('**/api/customer-programme-coordination**', (route) =>
    route.fulfill({ status: 403, json: { error: 'Denied' } }),
  );
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('access changed');
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.unroute('**/api/customer-programme-coordination**');
  await page.route('**/api/customer-programme-coordination**', (route) =>
    route.fulfill({ status: 503, json: { error: 'x' } }),
  );
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'unavailable' })).toBeVisible();
});
test('responses for another programme or claiming verification or sent messages are rejected', async ({
  page,
}) => {
  for (const patch of [
    { programmeId: '00000000-0000-4000-8000-0000000000ff' },
    { verified: true },
    { sendsMessages: true },
    { activeParticipants: -1 },
    { feedback: { ...report().feedback, ratingSum: '9' } },
  ]) {
    await page.unroute('**/api/customer-programme-coordination**').catch(() => undefined);
    await mock(page, { report: () => report(patch) });
    await page.goto(origin);
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
    await expect(page.getByRole('table')).toHaveCount(0);
  }
});
test('more tasks load on request without duplicating rows', async ({ page }) => {
  await mock(page, {
    tasks: (url) =>
      url.searchParams.get('afterSeq') === '2'
        ? tasks(
            [
              task(2, { title: 'Synthetic arrange airport pickups' }),
              task(3, { title: 'Synthetic send the final schedule' }),
            ],
            null,
          )
        : tasks([task(1), task(2, { title: 'Synthetic arrange airport pickups' })], 2),
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Show more tasks' }).click();
  await expect(page.getByText('Synthetic send the final schedule')).toBeVisible();
  await expect(page.getByText('Synthetic arrange airport pickups')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Show more tasks' })).toHaveCount(0);
});
test('the average rounds half up from exact integers', async ({ page }) => {
  for (const [sum, n, text] of [
    [1, 3, '0.3'],
    [10, 3, '3.3'],
    [11, 3, '3.7'],
    [5, 1, '5.0'],
    [9, 2, '4.5'],
  ] as const) {
    await page.unroute('**/api/customer-programme-coordination**').catch(() => undefined);
    await mock(page, {
      report: () => report({ feedback: { ...report().feedback, ratingSum: sum, ratingCount: n } }),
    });
    await page.goto(origin);
    await expect(page.getByRole('table', { name: 'Plan and results' })).toContainText(
      text + ' out of 5 from ' + n,
    );
  }
});
test('access expiry clears the report without extending permission', async ({ page }) => {
  await mock(page, { tasks: () => tasks(undefined, null, 700) });
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByRole('table')).toHaveCount(0);
});
test('changing the signed-in account discards the previous account data', async ({ page }) => {
  await mock(page);
  await page.goto(origin);
  await expect(page.getByText('Synthetic participant Bob').first()).toBeVisible();
  await page.unroute('**/api/customer-programme-coordination**');
  await mock(page, {
    report: () => report({ participants: [], activeParticipants: 0 }),
    tasks: () => tasks([]),
  });
  await page.evaluate(
    (i) =>
      window.dispatchEvent(
        new CustomEvent('fixture-customer-change', {
          detail: { subject: 'synthetic-bob', issuer: i },
        }),
      ),
    issuer,
  );
  await expect(page.getByText('No registered participants yet.')).toBeVisible();
  await expect(page.getByText('Synthetic arrange airport pickups')).toHaveCount(0);
});
for (const width of [320, 390, 768, 1440])
  test('keyboard and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mock(page);
    await page.goto(origin);
    await expect(page.getByRole('table', { name: 'Plan and results' })).toBeVisible();
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
        path: '.cache/v3-programme-coordination/after/organiser-320.png',
        fullPage: true,
      });
    }
  });
