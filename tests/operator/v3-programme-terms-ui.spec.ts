import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Actual component protocol fixtures with a mocked API, not provider or database acceptance.
// The real restricted authority has separate database tests.
const issuer = 'https://ep-terms-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000016';
const programmeId = '00000000-0000-4000-8000-000000000017';
const registrationId = '00000000-0000-4000-8000-0000000000c1';
const ownWorkspace = '00000000-0000-4000-8000-0000000000d1';
const memberKey = '00000000-0000-4000-8000-0000000000e1';
const taskId = '00000000-0000-4000-8000-000000000101';
let server: Server, origin: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {ProgrammeTerms} from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-terms.tsx'))};
import {ParticipantPlace} from ${JSON.stringify(resolve('apps/web/app/account/delegations/participant-place.tsx'))};
import {MyReminders} from ${JSON.stringify(resolve('apps/web/app/account/delegations/my-reminders.tsx'))};
import {CustomerProgrammes} from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};
const q=new URLSearchParams(location.search);
const base={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)}};
const root=createRoot(document.getElementById('fixture'));
const render=(p)=>{const c=q.get('c');const all={...base,...p};
if(c==='participant')root.render(<ParticipantPlace key={all.issuer+all.subject} {...all} registrationId=${JSON.stringify(registrationId)}/>);
else if(c==='reminders')root.render(<MyReminders key={all.issuer+all.subject} {...all}/>);
else if(c==='programmes')root.render(<CustomerProgrammes key={all.issuer+all.subject} {...all} workspaceId=${JSON.stringify(workspaceId)} participantsEnabled termsEnabled={q.get('terms')!=='off'} coordinationEnabled/>);
else root.render(<ProgrammeTerms key={all.issuer+all.subject} {...all} workspaceId=${JSON.stringify(workspaceId)} programmeId=${JSON.stringify(programmeId)} coordinationEnabled/>)};
render({});window.addEventListener('fixture-customer-change',e=>render(e.detail));`,
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
  // The browser bundle must carry no server authority code.
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
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic terms fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic terms fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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

const expires = (ttl = 60000) => new Date(Date.now() + ttl).toISOString();
const terms = (over: Record<string, unknown> = {}) => ({
  version: 1,
  included: 'Synthetic ground transport and two hotel nights',
  excluded: 'Synthetic flights and personal expenses',
  cancellationTerms: 'Synthetic cancel up to fourteen days before for a full place back',
  changeTerms: 'Synthetic the organiser may adjust the agenda with notice',
  feesApply: true,
  feeNote: 'Synthetic any fee is recorded by the organiser',
  reason: 'Synthetic first version of the terms',
  publishedAt: '2026-10-01T00:00:00Z',
  ...over,
});
const criteria = (over: Record<string, unknown> = {}) => ({
  version: 1,
  roles: ['SELLER'],
  sectors: ['Knitwear'],
  countries: ['BD'],
  sizeBands: [],
  minProfileFields: 6,
  reason: 'Synthetic only Bangladeshi sellers',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});
function state(over: Record<string, unknown> = {}, ttl = 60000) {
  return {
    workspaceId,
    programmeId,
    expiresAt: expires(ttl),
    sendsMessages: false,
    terms: { current: terms(), history: [terms({ version: 2 }), terms()] },
    eligibility: { current: criteria(), history: [criteria()] },
    places: {
      version: 1,
      minimum: 4,
      maximum: 10,
      waitlist: true,
      reason: 'Synthetic ten places',
      placed: 8,
    },
    tasks: [
      {
        id: taskId,
        seq: 1,
        version: 1,
        title: 'Synthetic confirm the hotel list',
        detail: null,
        status: 'OPEN',
        dueOn: '2026-10-23',
        assigneeLabel: null,
        plan: {
          version: 0,
          assigneeKey: null,
          assigneeLabel: null,
          assigneeActive: null,
          participantVisible: false,
        },
      },
    ],
    members: [
      { key: memberKey, label: 'Workspace owner', role: 'owner', isYou: true },
      {
        key: '00000000-0000-4000-8000-0000000000e2',
        label: 'Synthetic invited Rahim',
        role: 'member',
        isYou: false,
      },
    ],
    ...over,
  };
}
function report(over: Record<string, unknown> = {}, ttl = 60000) {
  return {
    workspaceId,
    programmeId,
    expiresAt: expires(ttl),
    asOf: '2026-10-20',
    verified: false,
    sendsMessages: false,
    places: {
      version: 1,
      minimum: 4,
      maximum: 10,
      waitlist: true,
      placed: 8,
      free: 2,
      fillPermille: 800,
      minimumMet: true,
      waiting: 3,
      promotable: 2,
    },
    funnel: {
      registered: 14,
      notApplied: 1,
      placed: 8,
      waitlisted: 3,
      notEligible: 2,
      cancelled: 0,
    },
    eligibility: { version: 1, notEligibleByReason: { ROLE: 1, COUNTRY: 1 } },
    terms: { version: 2, acceptedCurrent: 7, pendingAcceptance: 4, acceptanceRatePermille: 500 },
    satisfaction: {
      responses: 3,
      ratingCount: 3,
      ratingSum: 13,
      notShared: 0,
      responsesFromPlaced: 3,
    },
    outcomes: { shared: 2, participantsWithOutcome: 2, byKind: { MEETING_HELD: 2 } },
    rosterTruncated: false,
    roster: [
      {
        registrationId,
        label: 'Synthetic Dhaka Garments',
        status: 'PLACED',
        position: null,
        reasons: [],
        termsAcceptedVersion: 2,
        termsCurrent: true,
      },
      {
        registrationId: '00000000-0000-4000-8000-0000000000c2',
        label: 'Synthetic Berlin Buyer',
        status: 'NOT_ELIGIBLE',
        position: null,
        reasons: ['ROLE', 'COUNTRY'],
        termsAcceptedVersion: null,
        termsCurrent: false,
      },
      {
        registrationId: '00000000-0000-4000-8000-0000000000c3',
        label: 'Synthetic Chattogram Mills',
        status: 'WAITLISTED',
        position: 1,
        reasons: [],
        termsAcceptedVersion: 1,
        termsCurrent: false,
      },
    ],
    ...over,
  };
}
const emptyState = () =>
  state({
    terms: { current: null, history: [] },
    eligibility: { current: null, history: [] },
    places: { version: 0, minimum: null, maximum: null, waitlist: false, reason: null, placed: 0 },
    tasks: [],
  });
const emptyReport = () =>
  report({
    places: {
      version: 0,
      minimum: null,
      maximum: null,
      waitlist: false,
      placed: 0,
      free: null,
      fillPermille: null,
      minimumMet: null,
      waiting: 0,
      promotable: 0,
    },
    funnel: {
      registered: 0,
      notApplied: 0,
      placed: 0,
      waitlisted: 0,
      notEligible: 0,
      cancelled: 0,
    },
    eligibility: { version: 0, notEligibleByReason: {} },
    terms: { version: 0, acceptedCurrent: 0, pendingAcceptance: 0, acceptanceRatePermille: null },
    satisfaction: {
      responses: 0,
      ratingCount: 0,
      ratingSum: 0,
      notShared: 0,
      responsesFromPlaced: 0,
    },
    outcomes: { shared: 0, participantsWithOutcome: 0, byKind: {} },
    roster: [],
  });
function place(over: Record<string, unknown> = {}) {
  return {
    registrationId,
    programmeId,
    programmeName: 'Synthetic Dhaka trade programme',
    expiresAt: expires(),
    terms: terms({ version: 2 }),
    acceptedVersion: null,
    termsCurrent: false,
    criteria: criteria(),
    enrolment: { status: 'NOT_APPLIED', position: null, reasons: [] },
    placesAvailable: true,
    waitlist: true,
    fees: [{ currency: 'BDT', exponent: 2, dueMinor: '12000050' }],
    tasks: [],
    profileChoices: [
      { workspaceId: ownWorkspace, name: 'Synthetic Dhaka Garments workspace', hasProfile: true },
      {
        workspaceId: '00000000-0000-4000-8000-0000000000d2',
        name: 'Synthetic empty workspace',
        hasProfile: false,
      },
    ],
    sendsMessages: false,
    ...over,
  };
}
const reminders = (over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-20',
  windowDays: 3,
  expiresAt: expires(),
  sendsMessages: false,
  assignedToYou: [
    {
      workspaceId,
      programmeId,
      programmeName: 'Synthetic Dhaka trade programme',
      taskId,
      version: 1,
      title: 'Synthetic confirm the hotel list',
      dueOn: '2026-10-23',
      state: 'DUE_SOON',
    },
    {
      workspaceId,
      programmeId,
      programmeName: 'Synthetic Dhaka trade programme',
      taskId: '00000000-0000-4000-8000-000000000102',
      version: 2,
      title: 'Synthetic send the visa checklist',
      dueOn: '2026-10-18',
      state: 'OVERDUE',
    },
  ],
  forParticipant: [
    {
      registrationId,
      programmeName: 'Synthetic Dhaka trade programme',
      title: 'Synthetic bring a product sample',
      dueOn: '2026-10-22',
      state: 'DUE_SOON',
    },
  ],
  termsToAccept: [{ registrationId, programmeName: 'Synthetic Dhaka trade programme', version: 2 }],
  ...over,
});

type Mock = {
  views?: Record<string, () => { status?: number; json?: unknown }>;
  post?: (body: { action: string; input: Record<string, unknown> }) => {
    status?: number;
    json?: unknown;
  };
};
async function mock(page: Page, m: Mock = {}) {
  const posts: { action: string; input: Record<string, unknown> }[] = [];
  const gets: string[] = [];
  await page.route('**/api/customer-programme-terms**', async (route) => {
    const request = route.request();
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      posts.push(body);
      const answer = m.post?.(body) ?? {
        json: { commandId: body.input.commandId, replayed: false },
      };
      return route.fulfill({ status: answer.status ?? 200, json: answer.json });
    }
    const view = new URL(request.url()).searchParams.get('view') ?? '';
    gets.push(view);
    const answer = m.views?.[view]?.();
    if (!answer) return route.fulfill({ status: 400, json: { error: 'x' } });
    return route.fulfill({ status: answer.status ?? 200, json: answer.json });
  });
  return { posts, gets };
}
const organiser = (page: Page, query = '') => page.goto(origin + '/' + query);
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Programme terms, eligibility and places' });
const noViolations = async (page: Page) =>
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);

test('an organiser publishes a new terms version with one exact request and sees the fee boundary', async ({
  page,
}) => {
  let current = terms();
  const { posts } = await mock(page, {
    views: {
      state: () => ({ json: state({ terms: { current, history: [current] } }) }),
      report: () => ({ json: report() }),
    },
    post: (body) => {
      current = terms({ version: 2, included: body.input.included, reason: body.input.reason });
      return { json: { commandId: body.input.commandId, replayed: false, terms: current } };
    },
  });
  await organiser(page);
  const p = panel(page);
  await expect(p.getByRole('tab', { name: 'Terms' })).toHaveAttribute('aria-selected', 'true');
  await expect(
    p.getByText('Synthetic ground transport and two hotel nights').first(),
  ).toBeVisible();
  await expect(p.getByText(/Amounts are recorded under fees and costs, never here/)).toBeVisible();
  await expect(p.getByText(/7 of 14 registered people have accepted version 2/)).toBeVisible();
  await p
    .getByLabel('What is included')
    .fill('Synthetic ground transport, hotel nights and breakfast');
  await p.getByLabel('Why this version').fill('Synthetic breakfast added');
  await p.getByRole('button', { name: 'Publish new version' }).click();
  await expect(p.getByRole('status').first()).toContainText('Terms saved as a new version');
  expect(posts).toHaveLength(1);
  expect(posts[0]!.action).toBe('terms');
  expect(Object.keys(posts[0]!.input).sort()).toEqual([
    'cancellationTerms',
    'changeTerms',
    'commandId',
    'excluded',
    'expectedVersion',
    'feeNote',
    'feesApply',
    'included',
    'programmeId',
    'reason',
    'workspaceId',
  ]);
  expect(posts[0]!.input).toMatchObject({
    expectedVersion: 1,
    workspaceId,
    programmeId,
    feesApply: true,
  });
});

test('terms that are not synthetic are stopped before any request, and an empty programme reads calmly', async ({
  page,
}) => {
  const { posts } = await mock(page, {
    views: { state: () => ({ json: emptyState() }), report: () => ({ json: emptyReport() }) },
  });
  await organiser(page);
  const p = panel(page);
  await expect(
    p.getByText('No terms yet. Participants can apply without accepting any terms.'),
  ).toBeVisible();
  await p.getByLabel('What is included').fill('Real hotel nights');
  await p.getByRole('button', { name: 'Publish terms' }).click();
  await expect(p.getByRole('alert')).toContainText('Start each text with the word Synthetic');
  expect(posts).toHaveLength(0);
  await p.getByRole('tab', { name: 'Eligibility' }).click();
  await expect(p.getByText('No criteria yet. Anyone registered can apply.')).toBeVisible();
  await p.getByRole('tab', { name: 'Capacity' }).click();
  await expect(p.getByText('No one is registered yet.')).toBeVisible();
  await expect(p.getByText('No maximum set')).toBeVisible();
  await p.getByRole('tab', { name: 'Reminders' }).click();
  await expect(p.getByText(/No tasks yet/)).toBeVisible();
});

test('tabs work from the keyboard, and eligibility criteria are sent as one exact versioned request', async ({
  page,
}) => {
  const { posts } = await mock(page, {
    views: { state: () => ({ json: state() }), report: () => ({ json: report() }) },
  });
  await organiser(page);
  const p = panel(page);
  await p.getByRole('tab', { name: 'Terms' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(p.getByRole('tab', { name: 'Eligibility' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(p.getByRole('tab', { name: 'Eligibility' })).toBeFocused();
  await expect(p.getByText(/never what is in their profile/)).toBeVisible();
  await expect(p.getByText('Commercial role does not match: 1')).toBeVisible();
  await page.keyboard.press('End');
  await expect(p.getByRole('tab', { name: 'Reminders' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await p.getByLabel('Buyer').check();
  await p.getByLabel('Countries (two-letter codes, separated by commas)').fill('bd, de');
  await p.getByLabel('Why this change').fill('Synthetic also welcome buyers from Germany');
  await p.getByRole('button', { name: 'Save criteria' }).click();
  await expect(p.getByRole('status').first()).toContainText('Criteria saved as a new version');
  expect(posts).toHaveLength(1);
  expect(posts[0]!.action).toBe('eligibility');
  expect(posts[0]!.input).toMatchObject({
    expectedVersion: 1,
    roles: ['SELLER', 'BUYER'],
    countries: ['BD', 'DE'],
    sectors: ['Knitwear'],
    minProfileFields: 6,
  });
  // Bad country codes never reach the server.
  await p.getByLabel('Countries (two-letter codes, separated by commas)').fill('Bangladesh');
  await p.getByLabel('Why this change').fill('Synthetic try a long country name');
  await p.getByRole('button', { name: 'Save criteria' }).click();
  await expect(p.getByRole('alert')).toContainText('two-letter codes');
  expect(posts).toHaveLength(1);
});

test('capacity shows exact figures, validates places before sending and moves waiting people up on request', async ({
  page,
}) => {
  const { posts } = await mock(page, {
    views: { state: () => ({ json: state() }), report: () => ({ json: report() }) },
  });
  await organiser(page);
  const p = panel(page);
  await p.getByRole('tab', { name: 'Capacity' }).click();
  const table = p.getByRole('table', { name: 'Capacity, acceptance and satisfaction' });
  await expect(table.getByText('8 of 10 (80.0% full)')).toBeVisible();
  await expect(table.getByText('4 · reached')).toBeVisible();
  await expect(table.getByText('3 waiting')).toBeVisible();
  await expect(table.getByText('7 of 14 (50.0%)')).toBeVisible();
  await expect(table.getByText('4.3 out of 5 from 3 shared ratings')).toBeVisible();
  await expect(
    p.getByRole('listitem').filter({ hasText: 'Synthetic Chattogram Mills' }),
  ).toContainText('On the waiting list, number 1');
  await expect(p.getByRole('listitem').filter({ hasText: 'Synthetic Berlin Buyer' })).toContainText(
    'Commercial role does not match; Country does not match',
  );
  await p.getByLabel('Minimum to run the programme').fill('12');
  await p.getByLabel('Maximum places').fill('10');
  await p.getByLabel('Why this change').fill('Synthetic more places');
  await p.getByRole('button', { name: 'Save places' }).click();
  await expect(p.getByRole('alert')).toContainText('The minimum cannot be more than the maximum');
  expect(posts).toHaveLength(0);
  await p.getByLabel('Minimum to run the programme').fill('4');
  await p.getByLabel('Maximum places').fill('12');
  await p.getByRole('button', { name: 'Save places' }).click();
  await expect(p.getByRole('status').first()).toContainText('Places saved');
  expect(posts[0]).toMatchObject({
    action: 'places',
    input: { expectedVersion: 1, minimum: 4, maximum: 12, waitlist: true },
  });
  await p.getByRole('button', { name: 'Move waiting people up' }).click();
  await expect(p.getByRole('status').first()).toContainText(
    'Waiting people were moved up in order',
  );
  expect(posts[1]!.action).toBe('refresh');
  expect(Object.keys(posts[1]!.input).sort()).toEqual(['commandId', 'programmeId', 'workspaceId']);
});

test('task owners are chosen from workspace members and sent with the version the organiser saw', async ({
  page,
}) => {
  const { posts } = await mock(page, {
    views: { state: () => ({ json: state() }), report: () => ({ json: report() }) },
  });
  await organiser(page);
  const p = panel(page);
  await p.getByRole('tab', { name: 'Reminders' }).click();
  const save = p.getByRole('button', { name: 'Save owner for Synthetic confirm the hotel list' });
  await expect(save).toBeDisabled();
  await p
    .getByLabel('Owner of Synthetic confirm the hotel list')
    .selectOption({ label: 'Synthetic invited Rahim' });
  await p.getByLabel('Show the title and due date to people with a place').check();
  await save.click();
  await expect(p.getByRole('status').first()).toContainText('Task owner saved');
  expect(posts[0]).toMatchObject({
    action: 'assign',
    input: {
      taskId,
      expectedVersion: 0,
      assigneeKey: '00000000-0000-4000-8000-0000000000e2',
      participantVisible: true,
      workspaceId,
      programmeId,
    },
  });
});

test('a retried save reuses the same command id and a stale answer asks for a reload without false success', async ({
  page,
}) => {
  let answer: { status?: number; json?: unknown } = { status: 500, json: { error: 'x' } };
  const { posts } = await mock(page, {
    views: { state: () => ({ json: state() }), report: () => ({ json: report() }) },
    post: () => answer,
  });
  await organiser(page);
  const p = panel(page);
  await p.getByLabel('Why this version').fill('Synthetic clearer wording');
  await p.getByRole('button', { name: 'Publish new version' }).click();
  await expect(p.getByRole('alert')).toContainText('It could not be saved');
  answer = { status: 409, json: { error: 'x' } };
  await p.getByRole('button', { name: 'Publish new version' }).click();
  await expect(p.getByRole('alert')).toContainText('This changed since you opened it');
  await expect(p.getByRole('status')).toHaveCount(0);
  answer = { json: { commandId: 'x' } };
  await p.getByRole('button', { name: 'Publish new version' }).click();
  await expect(p.getByRole('status').first()).toContainText('Terms saved');
  expect(posts).toHaveLength(3);
  expect(new Set(posts.map((x) => x.input.commandId)).size).toBe(1);
});

for (const status of [401, 403])
  test('a ' + status + ' answer clears the private view', async ({ page }) => {
    await mock(page, {
      views: {
        state: () => ({ status, json: { error: 'x' } }),
        report: () => ({ json: report() }),
      },
    });
    await organiser(page);
    await expect(page.getByRole('alert')).toContainText('access changed');
    await expect(page.getByLabel('What is included')).toHaveCount(0);
  });

test('an unavailable module, a failed read and a malformed answer each read calmly', async ({
  page,
}) => {
  await mock(page, {
    views: {
      state: () => ({ status: 503, json: { error: 'x' } }),
      report: () => ({ json: report() }),
    },
  });
  await organiser(page);
  await expect(page.getByRole('status').filter({ hasText: 'unavailable' })).toBeVisible();
  const second = await page.context().newPage();
  await mock(second, {
    views: { state: () => ({ json: { workspaceId } }), report: () => ({ json: report() }) },
  });
  await organiser(second);
  await expect(second.getByRole('alert')).toContainText('could not be loaded');
  await expect(second.getByRole('button', { name: 'Reload terms and places' })).toBeVisible();
});

test('the terms button is offered with the flag and absent without it', async ({ page }) => {
  await page.route('**/api/customer-programmes**', (route) =>
    route.fulfill({
      json: {
        synthetic: true,
        workspaceId,
        nextAfter: null,
        programmes: [
          {
            id: programmeId,
            workspaceId,
            name: 'Synthetic Dhaka trade programme',
            reportingPurpose: 'Synthetic buyers meet makers',
            createdAt: '2026-10-01T00:00:00Z',
            synthetic: true,
          },
        ],
      },
    }),
  );
  await page.route('**/api/customer-programme-context**', (route) =>
    route.fulfill({ status: 503, json: { error: 'x' } }),
  );
  await organiser(page, '?c=programmes');
  await expect(page.getByRole('button', { name: 'Terms, eligibility and places' })).toBeVisible();
  await organiser(page, '?c=programmes&terms=off');
  await expect(page.getByText('Synthetic Dhaka trade programme').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Terms, eligibility and places' })).toHaveCount(0);
});

test('a participant must accept the terms and choose a profile before applying, then sends one exact request', async ({
  page,
}) => {
  const { posts } = await mock(page, {
    views: { place: () => ({ json: place() }) },
    post: (b) => ({ json: { commandId: b.input.commandId, status: 'PLACED', position: null } }),
  });
  await organiser(page, '?c=participant');
  const p = page.getByRole('region', { name: 'Your place in Synthetic Dhaka trade programme' });
  await expect(p.getByText('No place yet')).toBeVisible();
  await p.getByText('Programme terms, version 2').click();
  await expect(
    p.getByText(/Recorded for you by the organiser: 120000.50 BDT\. Nothing is collected here/),
  ).toBeVisible();
  await p.getByText('Who can take part').click();
  await expect(p.getByText('Commercial roles: Seller')).toBeVisible();
  const apply = p.getByRole('button', { name: 'Apply for a place' });
  await expect(apply).toBeDisabled();
  await p
    .getByLabel('Organisation profile to check')
    .selectOption({ label: 'Synthetic Dhaka Garments workspace' });
  await expect(apply).toBeDisabled();
  await p.getByLabel(/I have read and accept version 2/).check();
  await expect(apply).toBeEnabled();
  await apply.click();
  expect(posts).toHaveLength(1);
  expect(posts[0]!.action).toBe('enrol');
  expect(Object.keys(posts[0]!.input).sort()).toEqual([
    'acknowledged',
    'action',
    'commandId',
    'profileWorkspaceId',
    'registrationId',
    'termsVersion',
  ]);
  expect(posts[0]!.input).toMatchObject({
    action: 'apply',
    registrationId,
    termsVersion: 2,
    profileWorkspaceId: ownWorkspace,
    acknowledged: true,
  });
});

test('criteria with every list empty and no minimum ask for no profile, and the request sends none', async ({
  page,
}) => {
  const { posts } = await mock(page, {
    views: {
      place: () => ({
        json: place({
          criteria: criteria({
            roles: [],
            sectors: [],
            countries: [],
            sizeBands: [],
            minProfileFields: 0,
          }),
        }),
      }),
    },
    post: (b) => ({ json: { commandId: b.input.commandId, status: 'PLACED', position: null } }),
  });
  await organiser(page, '?c=participant');
  const p = page.getByRole('region', { name: 'Your place in Synthetic Dhaka trade programme' });
  await expect(p.getByLabel('Organisation profile to check')).toHaveCount(0);
  const apply = p.getByRole('button', { name: 'Apply for a place' });
  await expect(apply).toBeDisabled();
  await p.getByLabel(/I have read and accept version 2/).check();
  await expect(apply).toBeEnabled();
  await apply.click();
  expect(posts).toHaveLength(1);
  expect(posts[0]!.input).toMatchObject({
    action: 'apply',
    termsVersion: 2,
    profileWorkspaceId: null,
  });
});

test('a participant who is not eligible reads plain reasons and nothing from the profile', async ({
  page,
}) => {
  await mock(page, {
    views: {
      place: () => ({
        json: place({
          enrolment: {
            status: 'NOT_ELIGIBLE',
            position: null,
            reasons: ['ROLE', 'COMPLETENESS', 'NO_PROFILE'],
          },
        }),
      }),
    },
  });
  await organiser(page, '?c=participant');
  const p = page.getByRole('region', { name: 'Your place in Synthetic Dhaka trade programme' });
  await expect(p.getByText('Not eligible').first()).toBeVisible();
  await expect(
    p.getByText("Your organisation's commercial role is not one this programme accepts."),
  ).toBeVisible();
  await expect(p.getByText('fewer details filled in than this programme asks for')).toBeVisible();
  await expect(p.getByText('Add one in your account, then apply again.')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Apply for a place' })).toBeVisible();
  await expect(p.getByRole('heading', { name: 'Apply again' })).toBeVisible();
});

test('a waiting participant sees their number and can give the place up only after confirming', async ({
  page,
}) => {
  const { posts } = await mock(page, {
    views: {
      place: () => ({
        json: place({
          acceptedVersion: 2,
          termsCurrent: true,
          enrolment: { status: 'WAITLISTED', position: 2, reasons: [] },
        }),
      }),
    },
    post: (b) => ({ json: { commandId: b.input.commandId, status: 'CANCELLED', position: null } }),
  });
  await organiser(page, '?c=participant');
  const p = page.getByRole('region', { name: 'Your place in Synthetic Dhaka trade programme' });
  await expect(p.getByText('On the waiting list, number 2')).toBeVisible();
  const give = p.getByRole('button', { name: 'Give up my place' });
  await expect(give).toBeDisabled();
  await p.getByLabel(/I want to give up my place/).check();
  await give.click();
  expect(posts).toHaveLength(1);
  expect(posts[0]!.input).toMatchObject({ action: 'cancel', registrationId, acknowledged: true });
  expect(Object.keys(posts[0]!.input).sort()).toEqual([
    'acknowledged',
    'action',
    'commandId',
    'registrationId',
  ]);
});

test('newer terms need a fresh acceptance, and a full programme without a waiting list cannot be applied to', async ({
  page,
}) => {
  const { posts } = await mock(page, {
    views: {
      place: () => ({
        json: place({
          acceptedVersion: 1,
          termsCurrent: false,
          tasks: [{ title: 'Synthetic bring a product sample', dueOn: '2026-10-22' }],
          enrolment: { status: 'PLACED', position: null, reasons: [] },
        }),
      }),
    },
    post: (b) => ({ json: { commandId: b.input.commandId, status: 'PLACED', position: null } }),
  });
  await organiser(page, '?c=participant');
  const p = page.getByRole('region', { name: 'Your place in Synthetic Dhaka trade programme' });
  await expect(p.getByText('Your place is confirmed')).toBeVisible();
  await expect(p.getByText('You accepted version 1.')).toBeVisible();
  await expect(p.getByText('Synthetic bring a product sample · due 2026-10-22')).toBeVisible();
  const accept = p.getByRole('button', { name: 'Accept the new terms' });
  await expect(accept).toBeDisabled();
  await p.getByLabel('I accept version 2 of the programme terms.').check();
  await accept.click();
  expect(posts[0]!.input).toMatchObject({
    action: 'accept_terms',
    termsVersion: 2,
    registrationId,
  });
  const second = await page.context().newPage();
  await mock(second, {
    views: { place: () => ({ json: place({ placesAvailable: false, waitlist: false }) }) },
  });
  await organiser(second, '?c=participant');
  const q = second.getByRole('region', { name: 'Your place in Synthetic Dhaka trade programme' });
  await expect(q.getByText('This programme is full and has no waiting list.')).toBeVisible();
  await expect(q.getByRole('button', { name: 'Apply for a place' })).toBeDisabled();
});

test('reminders list what is due or late, mark done sends one exact request, and an empty list says so', async ({
  page,
}) => {
  let data = reminders();
  const { posts } = await mock(page, {
    views: { reminders: () => ({ json: data }) },
    post: (b) => {
      data = reminders({ assignedToYou: [] });
      return { json: { commandId: b.input.commandId, status: 'DONE' } };
    },
  });
  await organiser(page, '?c=reminders');
  const p = page.getByRole('region', { name: 'Your reminders' });
  await expect(
    p.getByText('no email, text or push message is sent', { exact: false }),
  ).toBeVisible();
  await expect(p.getByText('Overdue')).toBeVisible();
  await expect(p.getByText('Due soon').first()).toBeVisible();
  await expect(p.getByText('Synthetic bring a product sample')).toBeVisible();
  await expect(
    p.getByText(/Synthetic Dhaka trade programme has new terms \(version 2\)/),
  ).toBeVisible();
  await p.getByRole('button', { name: 'Mark done: Synthetic confirm the hotel list' }).click();
  await expect(p.getByText('Marked done: Synthetic confirm the hotel list')).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    action: 'done',
    input: { workspaceId, programmeId, taskId, expectedVersion: 1 },
  });
  expect(Object.keys(posts[0]!.input).sort()).toEqual([
    'commandId',
    'expectedVersion',
    'programmeId',
    'taskId',
    'workspaceId',
  ]);
  const second = await page.context().newPage();
  await mock(second, {
    views: {
      reminders: () => ({
        json: reminders({ assignedToYou: [], forParticipant: [], termsToAccept: [] }),
      }),
    },
  });
  await organiser(second, '?c=reminders');
  await expect(
    second.getByText('Nothing is due soon. You are up to date as of 2026-10-20.'),
  ).toBeVisible();
});

test('a reminder that is no longer yours is reported, and denied access clears the list', async ({
  page,
}) => {
  await mock(page, {
    views: { reminders: () => ({ json: reminders() }) },
    post: () => ({ status: 409, json: { error: 'x' } }),
  });
  await organiser(page, '?c=reminders');
  const p = page.getByRole('region', { name: 'Your reminders' });
  await p.getByRole('button', { name: 'Mark done: Synthetic confirm the hotel list' }).click();
  await expect(p.getByRole('alert')).toContainText('no longer yours');
  const second = await page.context().newPage();
  await mock(second, { views: { reminders: () => ({ status: 403, json: { error: 'x' } }) } });
  await organiser(second, '?c=reminders');
  await expect(second.getByRole('alert')).toContainText('access changed');
  await expect(second.getByText('Synthetic confirm the hotel list')).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440])
  test('keyboard and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mock(page, {
      views: {
        state: () => ({ json: state() }),
        report: () => ({ json: report() }),
        place: () => ({ json: place() }),
        reminders: () => ({ json: reminders() }),
      },
    });
    await organiser(page);
    const p = panel(page);
    for (const tab of ['Terms', 'Eligibility', 'Capacity', 'Reminders']) {
      await p.getByRole('tab', { name: tab }).click();
      await expect(p.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await noViolations(page);
    }
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBeTruthy();
    await organiser(page, '?c=participant');
    await expect(page.getByRole('region', { name: /Your place in/ })).toBeVisible();
    await page.getByText('Programme terms, version 2').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await noViolations(page);
    await organiser(page, '?c=reminders');
    await expect(
      page.getByRole('region', { name: 'Your reminders' }).getByText('Overdue'),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await noViolations(page);
  });
