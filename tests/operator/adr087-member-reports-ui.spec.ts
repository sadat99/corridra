import { test, expect, type Page, type Request } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// ADR-087 U5, Members' Reports and the read-only member report, mounted the way the other operator specs mount their
// screens: the real components and stylesheets in a small page, with the member access route answered by the test.
// What is proved is what an owner or admin sees and, because every read of a member's item is recorded, that nothing is
// read before it is asked for. Every name, date and company is invented.
test.use({ locale: 'en-US', timezoneId: 'Asia/Dhaka' });
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

const subject = 'subject-1';
const issuer = 'https://example.invalid/corridra/auth';
const W1 = '0b9a6d3e-1c2f-4a5b-8c7d-9e0f1a2b3c4d';
const W2 = '1c0b7e4f-2d3a-4b6c-9d8e-0f1a2b3c4d5e';
const W3 = '2d1c8f5a-3e4b-4c7d-8e9f-1a2b3c4d5e6f';
const R1 = '33333333-3333-4333-8333-333333333331';
const R2 = '33333333-3333-4333-8333-333333333332';
const R3 = '33333333-3333-4333-8333-333333333333';
const C1 = '44444444-4444-4444-8444-444444444441';
const C2 = '44444444-4444-4444-8444-444444444442';

const workspaces = {
  workspaces: [
    {
      workspaceId: W1,
      name: 'Sample Exports',
      role: 'owner',
      opensAt: '2026-11-01T00:00:00.000Z',
      open: true,
      cards: true,
    },
    {
      workspaceId: W2,
      name: 'Sample Sourcing',
      role: 'admin',
      opensAt: '2099-01-01T06:30:00.000Z',
      open: false,
      cards: true,
    },
    {
      workspaceId: W3,
      name: 'Sample Travel',
      role: 'admin',
      opensAt: null,
      open: false,
      cards: true,
    },
  ],
};
const saved = (id: string, title: string, memberLabel: string | null) => ({
  id,
  available: true,
  title,
  expiresAt: '2099-01-01T00:00:00.000Z',
  savedAt: '2026-10-01T00:00:00.000Z',
  memberLabel,
});
const cards = {
  cards: [
    {
      id: C1,
      resourceId: R1,
      decisionId: '55555555-5555-4555-8555-555555555551',
      state: 'ACTIVE',
      createdAt: '2026-11-10T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      company: '绿野机械有限公司',
      decision: 'SELECT',
      memberLabel: 'Rahim',
    },
    {
      id: C2,
      resourceId: R1,
      decisionId: '55555555-5555-4555-8555-555555555552',
      state: 'EXPIRED',
      createdAt: '2026-10-10T00:00:00.000Z',
      expiresAt: '2026-10-17T00:00:00.000Z',
      company: null,
      decision: null,
      memberLabel: null,
    },
  ],
  nextAfter: null,
};
const card = {
  workspaceId: W1,
  cardId: C1,
  resourceId: R1,
  fields: {
    company: '绿野机械有限公司',
    decision: 'SELECT',
    rationale: 'Shortest lead time',
    nextAction: 'Ask for samples',
    dueAt: '2026-12-01T00:00:00.000Z',
    provenance: { sourceKind: 'self_declaration', claimStatus: 'self_declared' },
  },
  expiresAt: '2099-01-01T00:00:00.000Z',
  memberLabel: 'Rahim',
};
const report = (resourceId: string) => ({
  resourceId,
  memberLabel: 'Rahim',
  workspaceId: W1,
  workspaceName: 'Sample Exports',
  report: {
    schemaVersion: 1,
    audience: 'CLIENT_PROGRESS',
    allowExport: false,
    expiresAt: '2099-01-01T00:00:00Z',
    purpose: 'Review of shortlisted suppliers',
    attribution: 'Prepared by the Corridra team',
    missions: [
      {
        publicationId: 'pub-1',
        title: 'Cutting machine mission',
        company: 'Atelier Rahman',
        objective: 'Find an automatic cutting machine',
        brief: 'Sample mission',
        nextAction: 'Review the offers',
        dueAt: '2026-11-05T00:00:00Z',
        reviewedAt: '2026-10-08T00:00:00Z',
        updatedAt: '2026-10-08T00:00:00Z',
        status: 'MEETINGS',
        itinerary: [{ label: 'Factory visit', status: 'SCHEDULED', scheduleChanged: false }],
        totals: [],
        outcomes: {
          opportunities: 0,
          qualified: 0,
          proposals: 0,
          contracts: 0,
          rfqs: 0,
          samples: 0,
          heldMeetings: 0,
        },
        requests: [
          {
            id: 'e1',
            title: 'Import licence number',
            instructions: 'Add your import licence number.',
            dueAt: '2026-11-05T00:00:00Z',
            status: 'OPEN',
            response: 'Licence 12345',
          },
        ],
      },
    ],
  },
});

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{ReportsTabs}from ${JSON.stringify(resolve('apps/web/app/account/reports-tabs.tsx'))};
      import{MemberReports}from ${JSON.stringify(resolve('apps/web/app/account/member-reports.tsx'))};
      import{SavedCommercialReport}from ${JSON.stringify(resolve('apps/web/app/account/missions/saved-commercial-report.tsx'))};
      const q=new URLSearchParams(location.search);
      const scope={subject:${JSON.stringify(subject)},issuer:${JSON.stringify(issuer)}};
      const mode=q.get('mode');
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <main className="ux-customer">
            {mode==='tabs'
              ? <ReportsTabs saved={<p>Your saved missions</p>} members={<MemberReports {...scope}/>}/>
              : mode==='members'
                ? <MemberReports {...scope}/>
                : <SavedCommercialReport {...scope} resourceId={q.get('resourceId')} books
                    member={mode==='member-report'?{workspaceId:q.get('workspaceId')}:undefined}/>}
          </main>
        </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    // The flag stylesheet names its pictures by their public path; they are served files, not bundled ones.
    external: ['/flags/*'],
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'next-fixture',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : 'const router={replace(){},push(){},refresh(){}};export function useRouter(){return router}',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Members fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Answer = { status: number; body: unknown };
type Rig = { gets: number; posts: Record<string, unknown>[]; urls: string[] };
/**
 * Answers the member access route: GET with the workspaces, each POST with what `answer` returns for its body.
 * Records every request, so a test can prove which reads were made and when.
 */
async function rig(
  page: Page,
  answer: (body: Record<string, unknown>) => Answer,
  list: Answer = { status: 200, body: workspaces },
): Promise<Rig> {
  const state: Rig = { gets: 0, posts: [], urls: [] };
  await page.route('**/api/**', async (route) => {
    const request: Request = route.request();
    state.urls.push(request.url());
    if (!request.url().includes('/api/customer-member-access'))
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    if (request.method() === 'GET') {
      state.gets += 1;
      return route.fulfill({
        status: list.status,
        contentType: 'application/json',
        body: JSON.stringify(list.body),
      });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    state.posts.push(body);
    const { status, body: reply } = answer(body);
    if (reply instanceof Uint8Array)
      return route.fulfill({
        status,
        headers: {
          'content-type': 'application/pdf',
          'x-corridra-book-digest': 'a'.repeat(64),
          'x-corridra-book-generated-at': '2026-11-18T10:00:00.000Z',
        },
        body: Buffer.from(reply),
      });
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  return state;
}
const lists = (body: Record<string, unknown>): Answer =>
  body.action === 'reports'
    ? {
        status: 200,
        body: {
          missions: body.after
            ? [saved(R3, 'Packaging mission', null)]
            : [
                saved(R1, 'Cutting machine mission', 'Rahim'),
                {
                  id: R2,
                  available: false,
                  title: null,
                  expiresAt: null,
                  savedAt: '2026-10-01T00:00:00.000Z',
                  memberLabel: 'Rahim',
                },
              ],
          nextAfter: body.after ? null : R2,
        },
      }
    : body.action === 'cards'
      ? { status: 200, body: cards }
      : body.action === 'card'
        ? { status: 200, body: card }
        : { status: 500, body: {} };
const membersPanel = (page: Page) => page.locator('.member-reports');

test('a tab switch reads nothing again, and a page restored from history stays closed until asked', async ({
  page,
}) => {
  const state = await rig(page, lists);
  await page.goto(`${origin}/?mode=members`);
  await expect(
    page.getByRole('heading', { name: 'Cutting machine mission', level: 4 }),
  ).toBeVisible();
  expect(state.gets).toBe(1);
  expect(state.posts).toHaveLength(1);
  // Hidden, then visible again: every list read is recorded, so nothing is read again and the lists stay as they were.
  for (const hidden of [true, false])
    await page.evaluate((value) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (value ? 'hidden' : 'visible'),
      });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await expect(
    page.getByRole('heading', { name: 'Cutting machine mission', level: 4 }),
  ).toBeVisible();
  expect(state.gets).toBe(1);
  expect(state.posts).toHaveLength(1);
  // Restored from the back-forward cache: the lists are closed and read again only when the person asks.
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.getByText('These lists closed when you left the page.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Cutting machine mission', level: 4 }),
  ).toHaveCount(0);
  expect(state.gets).toBe(1);
  expect(state.posts).toHaveLength(1);
  await page.getByRole('button', { name: "Refresh members' reports" }).click();
  await expect(
    page.getByRole('heading', { name: 'Cutting machine mission', level: 4 }),
  ).toBeVisible();
  expect(state.gets).toBe(2);
  expect(state.posts).toHaveLength(2);
});

test('lists only the first open workspace, reads nothing else until asked, and says when the others open', async ({
  page,
}) => {
  const state = await rig(page, lists);
  await page.goto(`${origin}/?mode=members`);
  await expect(
    page.getByRole('heading', { name: 'Cutting machine mission', level: 4 }),
  ).toBeVisible();
  // One GET (not recorded by the database) and one recorded read: the first open workspace's saved reports.
  expect(state.gets).toBe(1);
  expect(state.posts).toEqual([{ action: 'reports', workspaceId: W1, after: null }]);
  await expect(page.getByText('Saved by Rahim.')).toBeVisible();
  await expect(
    page
      .locator(`[data-row="${R1}"]`)
      .getByText('Original access expires 1 Jan 2099, 00:00 (UTC).'),
  ).toBeVisible();
  const open = page.getByRole('link', { name: 'Open Report, Cutting machine mission' });
  await expect(open).toHaveAttribute('href', `/account/member-reports/${W1}/${R1}`);
  await expect(open).toHaveText('Open Report');
  await expect(page.getByRole('heading', { name: 'Report not available', level: 4 })).toBeVisible();
  await expect(
    page.getByText('Its link has expired or was withdrawn. No report content is shown.'),
  ).toBeVisible();
  // The workspaces that are not open are closed sections; opening them reads nothing.
  await page.getByRole('heading', { name: 'Sample Sourcing' }).click();
  await expect(
    page.getByText(/^Not open yet\. Members' items show here from 1 Jan 2099/),
  ).toBeVisible();
  await page.getByRole('heading', { name: 'Sample Travel' }).click();
  await expect(
    page.getByText(
      'Not open yet. Members of this workspace have not been told about this access yet.',
    ),
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
  // Nothing on the screen removes, withdraws or changes anything.
  for (const word of [/remove/i, /withdraw/i, /edit/i, /send/i, /save/i])
    await expect(membersPanel(page).getByRole('button', { name: word })).toHaveCount(0);
});

test('Load More reads the next page only when pressed, moves the focus to the first new row and recovers from a failure', async ({
  page,
}) => {
  let fail = true;
  const state = await rig(page, (body) =>
    body.action === 'reports' && body.after && fail ? { status: 500, body: {} } : lists(body),
  );
  await page.goto(`${origin}/?mode=members`);
  const more = page.getByRole('button', { name: 'Load More Reports' });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole('alert')).toHaveText('More items could not be loaded. Try again.');
  await expect(page.getByRole('heading', { name: 'Cutting machine mission' })).toBeVisible();
  fail = false;
  await more.click();
  const added = page.locator(`[data-row="${R3}"]`);
  await expect(added).toBeFocused();
  await expect(added.getByText('Saved by a member of this workspace.')).toBeVisible();
  await expect(more).toHaveCount(0);
  expect(state.posts.map((p) => p.after)).toEqual([null, R2, R2]);
});

test('decision cards are read only when their disclosure opens, and one card only when it is chosen', async ({
  page,
}) => {
  const state = await rig(page, lists);
  await page.goto(`${origin}/?mode=members`);
  await expect(page.getByRole('heading', { name: 'Cutting machine mission' })).toBeVisible();
  expect(state.posts.filter((p) => p.action !== 'reports')).toEqual([]);
  await page.getByText('Decision cards', { exact: true }).click();
  const row = page.locator(`[data-row="${C1}"]`);
  await expect(row).toContainText('绿野机械有限公司 · Selected');
  await expect(row.locator('.ux-status')).toHaveText('Active');
  await expect(row.locator('.ux-status')).toHaveAttribute('data-tone', 'positive');
  await expect(row.getByText('Made by Rahim.')).toBeVisible();
  const expired = page.locator(`[data-row="${C2}"]`);
  await expect(expired.locator('.ux-status')).toHaveText('Expired');
  await expect(expired.getByText('Made by a member of this workspace.')).toBeVisible();
  await expect(expired.getByRole('button')).toHaveCount(0);
  expect(state.posts.map((p) => p.action)).toEqual(['reports', 'cards']);
  const view = page.getByRole('button', { name: 'View Decision, 绿野机械有限公司' });
  await view.click();
  const dialog = page.getByRole('dialog', { name: 'Shared decision' });
  await expect(dialog.getByText('Made by Rahim. Read only.')).toBeVisible();
  await expect(dialog.locator('dt')).toHaveText([
    'Company',
    'Decision',
    'Reason',
    'Next step',
    'Due',
    'Source',
  ]);
  await expect(dialog.getByText('Shortest lead time')).toBeVisible();
  expect(state.posts.at(-1)).toEqual({ action: 'card', workspaceId: W1, cardId: C1 });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(view).toBeFocused();
  expect(state.posts).toHaveLength(3);
});

test('a card that is gone says so, and a failed one can be tried again', async ({ page }) => {
  let answer: Answer = { status: 403, body: {} };
  await rig(page, (body) => (body.action === 'card' ? answer : lists(body)));
  await page.goto(`${origin}/?mode=members`);
  await page.getByText('Decision cards', { exact: true }).click();
  await page.getByRole('button', { name: 'View Decision, 绿野机械有限公司' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shared decision' });
  await expect(dialog.getByRole('alert')).toHaveText(
    'This decision card is not available. It may have expired or been withdrawn.',
  );
  await page.keyboard.press('Escape');
  answer = { status: 500, body: {} };
  await page.getByRole('button', { name: 'View Decision, 绿野机械有限公司' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'This decision could not be opened. Try again.',
  );
  answer = { status: 200, body: card };
  await dialog.getByRole('button', { name: 'Try Again' }).click();
  await expect(dialog.getByText('Ask for samples')).toBeVisible();
});

test('inside the Reports tabs, nothing of a member is read until the tab is chosen', async ({
  page,
}) => {
  const state = await rig(page, lists);
  await page.goto(`${origin}/?mode=tabs`);
  const tab = page.getByRole('tab', { name: "Members' Reports" });
  await expect(tab).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText(['Saved Missions', "Members' Reports"]);
  await expect.poll(() => state.gets).toBe(1);
  await page.waitForTimeout(300);
  expect(state.posts).toEqual([]);
  await tab.click();
  await expect(page.getByRole('heading', { name: 'Cutting machine mission' })).toBeVisible();
  expect(state.posts).toEqual([{ action: 'reports', workspaceId: W1, after: null }]);
});

test('the list states say what happened and what to do next', async ({ page }) => {
  await rig(page, lists, { status: 403, body: {} });
  await page.goto(`${origin}/?mode=members`);
  await expect(page.getByRole('alert')).toHaveText(
    "Your access to members' reports could not be confirmed. Sign in again or check your role in the workspace.",
  );
  await page.unrouteAll();
  await rig(page, lists, { status: 500, body: {} });
  await page.goto(`${origin}/?mode=members`);
  await expect(page.getByRole('alert')).toHaveText(
    "Members' reports could not be loaded. Try again.",
  );
  await expect(page.getByRole('button', { name: "Refresh members' reports" })).toBeVisible();
  await page.unrouteAll();
  await rig(page, lists, { status: 503, body: {} });
  await page.goto(`${origin}/?mode=members`);
  await expect(page.getByRole('status')).toHaveText(
    "Members' reports are not available right now.",
  );
  await page.unrouteAll();
  // No workspace owned or managed: nothing is drawn at all.
  await rig(page, lists, { status: 200, body: { workspaces: [] } });
  await page.goto(`${origin}/?mode=members`);
  await expect(page.locator('#fixture main')).toBeEmpty();
});

test('the member report is read only: no back link, form, label or decisions, and its books ask the member route', async ({
  page,
}) => {
  let book: Answer = { status: 503, body: {} };
  const state = await rig(page, (body) =>
    body.action === 'report'
      ? { status: 200, body: report(R1) }
      : body.action === 'book'
        ? book
        : lists(body),
  );
  await page.goto(`${origin}/?mode=member-report&workspaceId=${W1}&resourceId=${R1}`);
  await expect(
    page.getByText(
      'Saved by Rahim in Sample Exports. You can read it and download its books. You cannot change or remove it.',
    ),
  ).toBeVisible();
  expect(state.posts[0]).toEqual({ action: 'report', workspaceId: W1, resourceId: R1 });
  await expect(page.getByText('Back to my saved commercial missions')).toHaveCount(0);
  await expect(page.locator('.privacy-label')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Evidence and Decisions' }).click();
  await expect(page.getByText("The member's self-declared response: Licence 12345")).toBeVisible();
  await expect(page.locator('form, textarea')).toHaveCount(0);
  await expect(page.getByText('My shared missions')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Downloads' }).click();
  await page.getByText('Download a Trip Book or Supplier Book').click();
  const trip = page.getByRole('button', { name: 'Download Trip Book' });
  await trip.click();
  await expect(page.getByRole('alert')).toBeVisible();
  book = { status: 200, body: new Uint8Array([37, 80, 68, 70]) };
  const [download] = await Promise.all([page.waitForEvent('download'), trip.click()]);
  expect(download.suggestedFilename()).toBe('corridra-trip-book-20261118.pdf');
  const books = state.posts.filter((p) => p.action === 'book');
  expect(books).toHaveLength(2);
  expect(Object.keys(books[0]!).sort()).toEqual([
    'acknowledged',
    'action',
    'commandId',
    'kind',
    'resourceId',
    'workspaceId',
  ]);
  expect(books[0]).toMatchObject({
    workspaceId: W1,
    resourceId: R1,
    kind: 'TRIP',
    acknowledged: true,
  });
  // The unconfirmed first try is retried with the same command, so it can never make a second record.
  expect(books[1]!.commandId).toBe(books[0]!.commandId);
  expect(state.urls.every((url) => url.includes('/api/customer-member-access'))).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test('a member report that is gone says so and shows nothing of it', async ({ page }) => {
  await rig(page, () => ({ status: 403, body: {} }));
  await page.goto(`${origin}/?mode=member-report&workspaceId=${W1}&resourceId=${R1}`);
  await expect(page.getByRole('alert')).toHaveText(
    'This report is not available to you. It may have been removed by the member who saved it, or your access changed. No report content is shown.',
  );
  await expect(page.getByText('Cutting machine mission')).toHaveCount(0);
});

for (const width of [390, 768, 1440])
  test(`fits at ${width} px: no sideways scroll, every action at least 44 px tall up to 768`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await rig(page, lists);
    await page.goto(`${origin}/?mode=members`);
    await page.getByText('Decision cards', { exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'View Decision, 绿野机械有限公司' }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    if (width <= 768)
      for (const control of await membersPanel(page)
        .locator('a:visible, button:visible, summary:visible')
        .all()) {
        const box = await control.boundingBox();
        expect(box!.height, await control.innerText()).toBeGreaterThanOrEqual(44);
      }
    if (process.env.UX_SHOTS_DIR)
      await page.screenshot({
        path: `${process.env.UX_SHOTS_DIR}/members-reports-${width}.png`,
        fullPage: true,
      });
  });
