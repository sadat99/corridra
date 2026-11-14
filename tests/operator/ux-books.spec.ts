import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The Trip Book and Supplier Book download panel (Batch E part E2b), mounted the way ux-room.spec.ts mounts the
// Room: the real saved report component, the real stylesheets, the saved-mission and book interfaces answered by
// the test. What is proved is what a person sees and what the browser sends. Every name and date is invented.
//
// Two knobs slow the answers down, as a busy CI runner does, so a test that measures or presses a key before the
// exact state has rendered fails here and not only on a slow machine: REPORT_DELAY_MS for the report and
// BOOK_DELAY_MS for the book. Run the spec with both 0 and with 600 and 400.
test.use({ locale: 'en-US', timezoneId: 'America/New_York' });
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

const resourceId = '33333333-3333-4333-8333-333333333333';
const subject = 'subject-1';
const issuer = 'https://example.invalid/corridra/auth';
const digest = '3f9a1c0b7d2e4a55' + 'b'.repeat(48);
const code = digest.slice(0, 16);
const madeAt = '2026-11-03T14:05:00.000Z';
const reportDelay = Number(process.env.REPORT_DELAY_MS ?? 0);
const bookDelay = Number(process.env.BOOK_DELAY_MS ?? 0);

type Meeting = Record<string, unknown>;
const meeting = (label: string, over: Meeting = {}): Meeting => ({
  label,
  status: 'SCHEDULED',
  scheduleChanged: false,
  startsAt: '2026-11-09T04:00:00Z',
  timezone: 'Asia/Dhaka',
  location: 'Dhaka Chamber of Commerce',
  ...over,
});
const company = (n: number, rationale = 'Fits the request') => ({
  id: `t${n}`,
  company: `Lantern Cutting Works ${n}`,
  country: 'China',
  fit: 'HIGH',
  rationale,
  uncertainty: 'None',
  gaps: 'None',
  verification: 'Self-declared',
});
type Shape = {
  trip?: number;
  suppliers?: number;
  long?: boolean;
};
const longText = (n: number) =>
  `Long ${'sentence about the request and its needs. '.repeat(n)}`.trim();
function reportBody({ trip = 3, suppliers = 2, long = false }: Shape = {}) {
  const itinerary = Array.from({ length: trip }, (_, n) =>
    meeting(
      long
        ? `Meeting with Bangladesh Garments Manufacturers and Exporters Association number ${n}`
        : `Meeting number ${n}`,
      {
        startsAt: `2026-11-${10 + n}T04:00:00Z`,
        location: long
          ? `Hall ${n}, Dhaka Chamber of Commerce, Motijheel Commercial Area, Dhaka 1000`
          : `Hall ${n}`,
      },
    ),
  );
  const money = (currency: string) => ({
    currency,
    contractMinor: '123456700',
    invoiceMinor: '1000',
    confirmedCashMinor: '500',
    repeatCashMinor: '0',
  });
  return {
    resourceId,
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
          objective: long ? longText(18) : 'Find an automatic cutting machine',
          brief: long ? longText(18) : 'Sample mission',
          nextAction: 'Review the offers',
          dueAt: '2026-11-05T00:00:00Z',
          reviewedAt: '2026-10-08T00:00:00Z',
          updatedAt: '2026-10-08T00:00:00Z',
          status: 'MEETINGS',
          itinerary,
          totals: long ? [money('USD'), money('BDT')] : [],
          outcomes: {
            opportunities: 0,
            qualified: 0,
            proposals: 0,
            contracts: 0,
            rfqs: 0,
            samples: 0,
            heldMeetings: 0,
          },
          requests: Array.from({ length: long ? 2 : 1 }, (_, n) => ({
            id: `e${n}`,
            title: `Import licence number ${n}`,
            instructions: long ? longText(10) : 'Add your import licence number.',
            dueAt: '2026-11-05T00:00:00Z',
            status: 'OPEN',
          })),
          experience: {
            schemaVersion: 1,
            requirements: {
              version: 1,
              fields: {
                objective: 'Find a cutting machine',
                role: 'BUYER',
                product: 'Cutting machine',
              },
              sourceKind: 'self_declaration',
              claimStatus: 'self_declared',
              current: true,
            },
            shortlist: Array.from({ length: suppliers }, (_, n) =>
              company(n, long ? longText(9) : undefined),
            ),
            quotations: [],
            agenda: [],
            documentAccess: 'None',
          },
        },
      ],
    },
  };
}

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{WorkspaceShell}from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
      import{SavedCommercialReport}from ${JSON.stringify(resolve('apps/web/app/account/missions/saved-commercial-report.tsx'))};
      const q=new URLSearchParams(location.search);
      const extra=q.get('books')==='omit'?{}:{books:q.get('books')==='1'};
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <WorkspaceShell eyebrow="REPORTS" title="Your commercial mission">
            <SavedCommercialReport subject=${JSON.stringify(subject)} issuer=${JSON.stringify(issuer)} resourceId=${JSON.stringify(resourceId)} {...extra}/>
          </WorkspaceShell>
        </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
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
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Books fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** The connection fails, as when the network drops. */
  fail?: boolean;
  /** The server commits a record for this command even though the answer is lost or refused. */
  commits?: boolean;
  /** The answer waits for this promise, so a test can look at the busy state for as long as it needs. */
  gate?: Promise<void>;
};
type Post = { body: Record<string, unknown>; headers: Record<string, string> };
type Rig = {
  posts: Post[];
  reports: { count: number };
  /** Replies to the next books, in order; after that every book succeeds. */
  replies: Reply[];
  /** Reports to give next, in order; after that the first one again. */
  nextReports: Shape[];
  /** The command ids the mock server holds a generation record for: one per id, as the real ledger keeps. */
  records: Set<string>;
  /** Book requests the test has finished answering (or could not, because the page had already left). */
  answered: { count: number };
};
const pdfReply = (over: Reply = {}): Reply => ({
  status: 200,
  headers: {
    'Content-Type': 'application/pdf',
    'X-Corridra-Book-Digest': digest,
    'X-Corridra-Book-Replayed': 'false',
    'X-Corridra-Book-Generated-At': madeAt,
  },
  body: '%PDF-1.4 invented',
  ...over,
});
const json = (status: number, body: unknown): Reply => ({
  status,
  body,
  headers: { 'Content-Type': 'application/json' },
});

type OpenOptions = {
  books?: '1' | '0' | 'omit';
  shape?: Shape;
  replies?: Reply[];
  /** The first reports to give, in order, so a test does not race the first read. */
  reports?: Shape[];
  /** The status the report interface gives to a response to an evidence request. */
  respondStatus?: number;
  /** Fake page timers, so a 60 second wait can be skipped without waiting. */
  clock?: boolean;
};
async function openPage(page: Page, options: OpenOptions = {}): Promise<Rig> {
  const rig: Rig = {
    posts: [],
    reports: { count: 0 },
    replies: [...(options.replies ?? [])],
    nextReports: [...(options.reports ?? [])],
    answered: { count: 0 },
    records: new Set(),
  };
  if (options.clock) await page.clock.install();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  // Record what the browser is asked to do: fetch options, object URLs made and given back, and downloads started.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__recording) return;
    w.__recording = true;
    w.__fetches = [];
    w.__created = [];
    w.__revoked = [];
    w.__downloads = 0;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      (w.__fetches as unknown[]).push({
        url: String(input),
        cache: init?.cache,
        method: init?.method,
      });
      return original(input, init);
    };
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      (w.__created as string[]).push(url);
      return url;
    };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      (w.__revoked as string[]).push(url);
      revoke(url);
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download')) (w.__downloads as number)++;
      return click.call(this);
    };
  });
  await page.route('**/api/customer-saved-missions', async (route) => {
    const action = (JSON.parse(route.request().postData() ?? '{}') as { action?: string }).action;
    if (action === 'respond') {
      await route.fulfill({
        status: options.respondStatus ?? 200,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'no' }),
      });
      return;
    }
    if (reportDelay > 0) await new Promise((done) => setTimeout(done, reportDelay));
    rig.reports.count++;
    const shape = rig.nextReports.shift() ?? options.shape ?? {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reportBody(shape)),
    });
  });
  await page.route('**/api/customer-books', async (route) => {
    rig.posts.push({
      body: JSON.parse(route.request().postData() ?? '{}'),
      headers: route.request().headers(),
    });
    if (bookDelay > 0) await new Promise((done) => setTimeout(done, bookDelay));
    const reply = rig.replies.shift() ?? pdfReply();
    if (reply.gate) await reply.gate;
    const sent = rig.posts[rig.posts.length - 1]!.body.commandId;
    if (reply.commits || (!reply.fail && (reply.status ?? 200) === 200))
      rig.records.add(String(sent));
    try {
      if (reply.fail) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: reply.status ?? 200,
        headers: reply.headers,
        body:
          typeof reply.body === 'string' || reply.body === undefined
            ? (reply.body as string | undefined)
            : JSON.stringify(reply.body),
      });
    } catch {
      // The page left before the answer was given; that is the case some tests make.
    } finally {
      rig.answered.count++;
    }
  });
  await page.goto(`${origin}/?books=${options.books ?? '1'}`);
  // The whole report page is cut into tabs and the downloads panel lives in its own tab: open it once the report is in.
  // A report that is denied or unavailable has no tab, which several tests rely on.
  if ((options.books ?? '1') === '1')
    await page
      .getByRole('tab', { name: 'Downloads' })
      .click({ timeout: 5000 })
      .catch(() => undefined);
  return rig;
}

const panel = (page: Page) => page.locator('details.book-downloads');
const summary = (page: Page) => panel(page).locator('> summary');
const trip = (page: Page) => page.getByRole('button', { name: 'Download Trip Book (PDF)' });
const supplier = (page: Page) => page.getByRole('button', { name: 'Download Supplier Book (PDF)' });
const refresh = (page: Page) =>
  page.getByRole('button', { name: 'Refresh approved commercial report' });
/** Wait for the exact rendered state: the report is in, the panel is there, and it is open. */
async function openPanel(page: Page) {
  // The panel is in its own tab of the report page; choosing a tab that is already chosen changes nothing.
  await page.getByRole('tab', { name: 'Downloads' }).click();
  await expect(summary(page)).toBeVisible();
  await summary(page).click();
  await expect(page.locator('details.book-downloads[open]')).toHaveCount(1);
  await expect(trip(page)).toBeVisible();
}
const status = (page: Page) => panel(page).getByRole('status');
const alert = (page: Page) => page.getByRole('alert');
const created = (book: string, time = '3 Nov 2026, 14:05 UTC') =>
  `Your ${book} was created. Your browser should now save the file. Keep it private. Created ${time}. Content code ${code}. Give this code to the Corridra team if you ask about the file.`;
const retryText =
  'We could not confirm the download. Try again. It will not create a second record.';
const browserState = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return {
      fetches: w.__fetches as { url: string; cache?: string; method?: string }[],
      created: w.__created as string[],
      revoked: w.__revoked as string[],
      downloads: w.__downloads as number,
    };
  });

test('with the switch off the page has no panel, makes no book request and is the page it was', async ({
  page,
}) => {
  const rig = await openPage(page, { books: '0' });
  await expect(page.getByRole('heading', { name: 'Commercial objective' })).toBeVisible();
  await expect(refresh(page)).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByText('Trip Book')).toHaveCount(0);
  const withFalse = await page
    .locator('section[aria-label="Approved saved commercial report"]')
    .innerHTML();
  expect(rig.posts).toHaveLength(0);
  const state = await browserState(page);
  expect(state.fetches.filter((f) => f.url.includes('customer-books'))).toHaveLength(0);
  // The same page with the prop left out is byte for byte the same.
  const other = await openPage(page, { books: 'omit' });
  await expect(page.getByRole('heading', { name: 'Commercial objective' })).toBeVisible();
  await expect(refresh(page)).toBeVisible();
  const without = await page
    .locator('section[aria-label="Approved saved commercial report"]')
    .innerHTML();
  expect(withFalse).toBe(without);
  expect(other.posts).toHaveLength(0);
});

test('at rest the panel is closed; open it shows the notice and two enabled buttons and nothing to tick', async ({
  page,
}) => {
  await openPage(page);
  await expect(summary(page)).toBeVisible();
  await expect(page.locator('details.book-downloads[open]')).toHaveCount(0);
  await expect(trip(page)).toBeHidden();
  await openPanel(page);
  await expect(
    page.getByRole('heading', { name: 'Download a Trip Book or Supplier Book' }),
  ).toBeVisible();
  await expect(panel(page)).toContainText(
    'Trip Book: 3 meetings or visits. Supplier Book: 2 companies.',
  );
  await expect(panel(page).locator('strong')).toHaveText('A downloaded file cannot be recalled.');
  await expect(trip(page)).toBeEnabled();
  await expect(supplier(page)).toBeEnabled();
  await expect(panel(page).locator('input')).toHaveCount(0);
  await expect(status(page)).toHaveText('');
  // Both buttons are described by the notice, so a screen reader reads it at the button.
  for (const button of [trip(page), supplier(page)]) {
    const id = await button.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    await expect(page.locator(`[id="${id}"]`)).toContainText(
      'A downloaded file cannot be recalled.',
    );
    await expect(page.locator(`[id="${id}"]`)).toContainText('stays on your device');
  }
  // The panel sets no language or direction of its own.
  await expect(panel(page).locator('[lang], [dir]')).toHaveCount(0);
  await expect(panel(page)).not.toHaveAttribute('lang', /.*/);
});

test('a Trip Book downloads once with the exact request, is named from the day, and its address is given back', async ({
  page,
}) => {
  const rig = await openPage(page);
  await openPanel(page);
  const [download] = await Promise.all([page.waitForEvent('download'), trip(page).click()]);
  expect(download.suggestedFilename()).toBe('corridra-trip-book-20261103.pdf');
  await expect(status(page)).toHaveText(created('Trip Book'));
  await expect(status(page).locator('code')).toHaveText(code);
  expect(rig.posts).toHaveLength(1);
  const post = rig.posts[0]!;
  expect(Object.keys(post.body).sort()).toEqual([
    'acknowledged',
    'commandId',
    'kind',
    'resourceId',
  ]);
  expect(post.body).toMatchObject({ resourceId, kind: 'TRIP', acknowledged: true });
  expect(post.body.commandId).toMatch(/^[0-9a-f-]{36}$/);
  expect(post.headers['x-corridra-customer-subject']).toBe(subject);
  expect(post.headers['x-corridra-customer-issuer']).toBe(issuer);
  // Focus stays on the button that was pressed; the label does not change.
  await expect(trip(page)).toBeFocused();
  await expect(alert(page)).toHaveCount(0);
  const state = await browserState(page);
  expect(state.fetches.find((f) => f.url.includes('customer-books'))).toMatchObject({
    cache: 'no-store',
    method: 'POST',
  });
  expect(state.created).toHaveLength(1);
  // The address of the file is given back once the browser has it.
  // It is given back well after the click, so a slow device has started the save first.
  await expect
    .poll(async () => (await browserState(page)).revoked, { timeout: 15_000 })
    .toEqual(state.created);
  // A Supplier Book is named for its kind.
  const [second] = await Promise.all([page.waitForEvent('download'), supplier(page).click()]);
  expect(second.suggestedFilename()).toBe('corridra-supplier-book-20261103.pdf');
  await expect(status(page)).toHaveText(created('Supplier Book'));
  expect(rig.posts[1]!.body.kind).toBe('SUPPLIER');
});

test('the address of the file is given back ten seconds after the save starts, not before', async ({
  page,
}) => {
  await openPage(page, { clock: true });
  await openPanel(page);
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book'));
  const made = (await browserState(page)).created;
  expect(made).toHaveLength(1);
  await page.clock.fastForward(9_000);
  expect((await browserState(page)).revoked).toEqual([]);
  await page.clock.fastForward(2_000);
  await expect.poll(async () => (await browserState(page)).revoked).toEqual(made);
});

test('while a book is being made the button is busy, the other is off, and a second press sends nothing', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  const rig = await openPage(page, { replies: [pdfReply({ gate })] });
  await openPanel(page);
  await trip(page).click();
  await expect(trip(page)).toHaveAttribute('aria-busy', 'true');
  await expect(trip(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(supplier(page)).toBeDisabled();
  await expect(status(page)).toHaveText('Preparing your Trip Book…');
  await expect(trip(page)).toBeFocused();
  // aria-disabled keeps the focus, so the press is real; Playwright needs force to press what is marked disabled.
  await trip(page).click({ force: true });
  await trip(page).press('Enter');
  expect(rig.posts).toHaveLength(1);
  release();
  await expect(status(page)).toHaveText(created('Trip Book'));
  await expect(trip(page)).not.toHaveAttribute('aria-busy', /.*/);
  await expect(supplier(page)).toBeEnabled();
  expect(rig.posts).toHaveLength(1);
});

test('a download that could not be confirmed is retried with the same command id; a new one after success has a new id', async ({
  page,
}) => {
  const rig = await openPage(page, { replies: [{ fail: true }, pdfReply({ fail: false })] });
  await openPanel(page);
  await trip(page).click();
  await expect(alert(page)).toHaveText(retryText);
  await expect(status(page)).toHaveText('');
  await expect(trip(page)).toBeEnabled();
  await expect(supplier(page)).toBeEnabled();
  await expect(trip(page)).toBeFocused();
  // No cancel control exists.
  await expect(panel(page).getByRole('button', { name: /cancel/i })).toHaveCount(0);
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book'));
  await expect(alert(page)).toHaveCount(0);
  expect(rig.posts).toHaveLength(2);
  expect(rig.posts[1]!.body.commandId).toBe(rig.posts[0]!.body.commandId);
  await trip(page).click();
  await expect.poll(() => rig.posts.length).toBe(3);
  await expect(status(page)).toHaveText(created('Trip Book'));
  expect(rig.posts[2]!.body.commandId).not.toBe(rig.posts[0]!.body.commandId);
});

test('a retry that is answered as already made shows the first time and the same code', async ({
  page,
}) => {
  const rig = await openPage(page, {
    replies: [
      { fail: true },
      pdfReply({
        headers: {
          'Content-Type': 'application/pdf',
          'X-Corridra-Book-Digest': digest,
          'X-Corridra-Book-Replayed': 'true',
          'X-Corridra-Book-Generated-At': '2026-11-02T09:30:15.000Z',
        },
      }),
    ],
  });
  await openPanel(page);
  await trip(page).click();
  await expect(alert(page)).toHaveText(retryText);
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book', '2 Nov 2026, 09:30 UTC'));
  await expect(status(page)).not.toContainText('saved to your device');
  expect(rig.posts[1]!.body.commandId).toBe(rig.posts[0]!.body.commandId);
});

test('the command id is kept when the page is hidden and shown again', async ({ page }) => {
  const rig = await openPage(page, { replies: [{ fail: true }] });
  await openPanel(page);
  await trip(page).click();
  await expect(alert(page)).toHaveText(retryText);
  // Leaving the page clears the report, and the panel with it; coming back reads the report again.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(panel(page)).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(summary(page)).toBeVisible();
  await openPanel(page);
  // The panel says again that the last download was not confirmed.
  await expect(alert(page)).toHaveText(retryText);
  await supplier(page).click();
  await expect(status(page)).toHaveText(created('Supplier Book'));
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book'));
  expect(rig.posts).toHaveLength(3);
  expect(rig.posts[2]!.body.commandId).toBe(rig.posts[0]!.body.commandId);
  expect(rig.posts[1]!.body.commandId).not.toBe(rig.posts[0]!.body.commandId);
});

for (const [code401, text, link] of [
  [403, 'This mission is unavailable or access has changed. Nothing was downloaded.', false],
  [401, 'Your sign-in has ended. Nothing was downloaded.', true],
] as const) {
  test(`${code401}: the report and the panel clear, nothing is saved, and the reason takes the focus`, async ({
    page,
  }) => {
    const rig = await openPage(page, { replies: [json(code401, { error: 'no' })] });
    await openPanel(page);
    await trip(page).click();
    await expect(page.getByRole('alert')).toHaveText(text);
    await expect(page.getByRole('alert')).toBeFocused();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Commercial objective' })).toHaveCount(0);
    await expect(page.getByText('Cutting machine mission')).toHaveCount(0);
    // Exactly one alert, not one from the panel and one from the page.
    await expect(page.getByRole('alert')).toHaveCount(1);
    const signIn = page.getByRole('link', { name: 'Sign in again' });
    if (link) await expect(signIn).toHaveAttribute('href', '/signin');
    else await expect(signIn).toHaveCount(0);
    expect((await browserState(page)).downloads).toBe(0);
    expect((await browserState(page)).created).toHaveLength(0);
    expect(rig.posts).toHaveLength(1);
  });
}

test('409 keeps the panel open, reads the report again, and the next press is a new command', async ({
  page,
}) => {
  const rig = await openPage(page, {
    replies: [json(409, { error: 'changed' })],
    reports: [
      { trip: 3, suppliers: 2 },
      { trip: 5, suppliers: 2 },
    ],
  });
  await openPanel(page);
  await expect(panel(page)).toContainText('Trip Book: 3 meetings or visits.');
  await panel(page).evaluate((el) => el.setAttribute('data-mark', 'same node'));
  await trip(page).click();
  await expect(alert(page)).toHaveText(
    'The reviewed content changed since you started. This page now shows the latest version. Download again to get it.',
  );
  await expect(panel(page)).toContainText('Trip Book: 5 meetings or visits.');
  expect(rig.reports.count).toBe(2);
  await expect(page.locator('details.book-downloads[open][data-mark="same node"]')).toHaveCount(1);
  await expect(trip(page)).toBeFocused();
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book'));
  expect(rig.posts[1]!.body.commandId).not.toBe(rig.posts[0]!.body.commandId);
});

// A command id is forgotten only when no record can exist for it: success, 409 and the two 422 reasons. A 429, 503 or
// 404 may come after a generation was committed (the route's rate budget also counts replays and reads, and a platform
// error can follow a commit), so the retry carries the same id and can only get that record.
const refusals: [string, Reply, string, boolean][] = [
  [
    '429',
    json(429, { error: 'Too many downloads' }),
    'Too many downloads for this mission just now. Try again later.',
    true,
  ],
  [
    '503',
    json(503, { error: 'unavailable' }),
    'Downloads are not available right now. Nothing was downloaded. Try again later.',
    true,
  ],
  [
    '404',
    json(404, { error: 'not found' }),
    'Downloads are not available right now. Nothing was downloaded. Try again later.',
    true,
  ],
  [
    '422 text the PDF cannot show',
    json(422, { error: 'x', reason: 'UNSUPPORTED_TEXT' }),
    'This book cannot be made because it has text the PDF cannot show. Ask the Corridra team for help.',
    false,
  ],
];
for (const [name, reply, text, keeps] of refusals) {
  test(`${name}: says exactly what happened and ${keeps ? 'keeps the command id for the retry' : 'forgets the command, so the next press is a new one'}`, async ({
    page,
  }) => {
    const rig = await openPage(page, { replies: [reply] });
    await openPanel(page);
    await trip(page).click();
    await expect(alert(page)).toHaveText(text);
    await expect(status(page)).toHaveText('');
    await expect(trip(page)).toBeEnabled();
    expect((await browserState(page)).downloads).toBe(0);
    await trip(page).click();
    await expect(status(page)).toHaveText(created('Trip Book'));
    const same = rig.posts[1]!.body.commandId === rig.posts[0]!.body.commandId;
    expect(same).toBe(keeps);
  });
}

test('a download whose answer was lost, then refused as too many, is still the same command: the server holds one record', async ({
  page,
}) => {
  // The first attempt is committed on the server but its answer never arrives. The retry is stopped by the rate budget
  // (it counts replays too). Once the budget clears, the next retry must still carry the first id.
  const rig = await openPage(page, {
    replies: [
      { fail: true, commits: true },
      json(429, { error: 'Too many downloads' }),
      pdfReply(),
    ],
  });
  await openPanel(page);
  await trip(page).click();
  await expect(alert(page)).toHaveText(retryText);
  await trip(page).click();
  await expect(alert(page)).toHaveText(
    'Too many downloads for this mission just now. Try again later.',
  );
  await expect(trip(page)).toBeEnabled();
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book'));
  expect(rig.posts).toHaveLength(3);
  expect(new Set(rig.posts.map((post) => post.body.commandId)).size).toBe(1);
  expect(rig.records.size).toBe(1);
  // After a success the next download is a new command, so a second record is then made on purpose.
  await trip(page).click();
  await expect.poll(() => rig.records.size).toBe(2);
});

test('422 for a book with nothing reviewed says so and reads the report again', async ({
  page,
}) => {
  await openPage(page, {
    replies: [json(422, { error: 'Nothing has been reviewed', reason: 'EMPTY' })],
    reports: [
      { trip: 3, suppliers: 2 },
      { trip: 0, suppliers: 2 },
    ],
  });
  await openPanel(page);
  await trip(page).click();
  await expect(alert(page)).toHaveText('Nothing has been reviewed for this book yet.');
  await expect(panel(page)).toContainText('Trip Book: none yet.');
  await expect(trip(page)).toBeDisabled();
  await expect(page.locator('details.book-downloads[open]')).toHaveCount(1);
  // The button that was pressed is now off, but it keeps the focus: the person is not thrown to the top of the page.
  await expect(trip(page)).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(
    'Download Trip Book (PDF)',
  );
});

test('a 409 that leaves a book with nothing reviewed keeps the focus on the button that was pressed', async ({
  page,
}) => {
  await openPage(page, {
    replies: [json(409, { error: 'changed' })],
    reports: [
      { trip: 3, suppliers: 2 },
      { trip: 3, suppliers: 0 },
    ],
  });
  await openPanel(page);
  await supplier(page).click();
  await expect(alert(page)).toHaveText(
    'The reviewed content changed since you started. This page now shows the latest version. Download again to get it.',
  );
  await expect(panel(page)).toContainText('Supplier Book: none yet.');
  await expect(supplier(page)).toBeDisabled();
  await expect(supplier(page)).toBeFocused();
});

test('a reply that is not the file is not a confirmed download and keeps the command id', async ({
  page,
}) => {
  const rig = await openPage(page, {
    replies: [
      pdfReply({ headers: { 'Content-Type': 'text/html' } }),
      pdfReply({ headers: { 'Content-Type': 'application/pdf' } }),
      json(500, { error: 'boom' }),
      pdfReply(),
    ],
  });
  await openPanel(page);
  for (let n = 0; n < 3; n++) {
    await trip(page).click();
    await expect(alert(page)).toHaveText(retryText);
    expect(rig.posts).toHaveLength(n + 1);
  }
  expect((await browserState(page)).downloads).toBe(0);
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book'));
  expect(new Set(rig.posts.map((post) => post.body.commandId)).size).toBe(1);
});

const empties: [string, Shape, boolean, boolean][] = [
  ['no meetings', { trip: 0, suppliers: 2 }, true, false],
  ['no companies', { trip: 3, suppliers: 0 }, false, true],
  ['neither', { trip: 0, suppliers: 0 }, true, true],
];
for (const [name, shape, tripOff, supplierOff] of empties) {
  test(`with ${name} reviewed the matching button is off and says why, and a press sends nothing`, async ({
    page,
  }) => {
    const rig = await openPage(page, { shape });
    await openPanel(page);
    const tripWhy = 'No meetings or visits have been reviewed yet, so there is no Trip Book.';
    const supplierWhy = 'No companies have been reviewed yet, so there is no Supplier Book.';
    await (tripOff ? expect(trip(page)).toBeDisabled() : expect(trip(page)).toBeEnabled());
    await (supplierOff
      ? expect(supplier(page)).toBeDisabled()
      : expect(supplier(page)).toBeEnabled());
    await expect(panel(page).getByText(tripWhy)).toHaveCount(tripOff ? 1 : 0);
    await expect(panel(page).getByText(supplierWhy)).toHaveCount(supplierOff ? 1 : 0);
    if (tripOff) {
      // The reason is visible text and is read at the button.
      const ids = (await trip(page).getAttribute('aria-describedby'))!.split(' ');
      await expect(page.locator(`[id="${ids[1]}"]`)).toHaveText(tripWhy);
      await expect(trip(page)).not.toHaveAttribute('title', /.*/);
      await trip(page).click({ force: true });
    }
    if (supplierOff) await supplier(page).click({ force: true });
    // A book that cannot be made is marked off but can still be reached and read by keyboard and screen reader.
    for (const [off, button] of [
      [tripOff, trip(page)],
      [supplierOff, supplier(page)],
    ] as const)
      if (off) {
        await expect(button).not.toHaveAttribute('disabled', /.*/);
        await expect(button).toHaveAttribute('aria-disabled', 'true');
        await button.focus();
        await expect(button).toBeFocused();
      }
    if (tripOff && supplierOff)
      await expect(panel(page)).toContainText('Trip Book: none yet. Supplier Book: none yet.');
    expect(rig.posts).toHaveLength(0);
  });
}

test('works from the keyboard: summary, Trip, Supplier, then the existing refresh button', async ({
  page,
}) => {
  const rig = await openPage(page);
  await expect(summary(page)).toBeVisible();
  await expect(refresh(page)).toBeVisible();
  await summary(page).focus();
  await expect(summary(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('details.book-downloads[open]')).toHaveCount(1);
  // Opening the panel does not move the focus.
  await expect(summary(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(trip(page)).toBeFocused();
  const ring = await trip(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
  });
  expect(ring).toBe(true);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(created('Trip Book'));
  await expect(trip(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(supplier(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(refresh(page)).toBeFocused();
  expect(rig.posts).toHaveLength(1);
});

test('starts no animation when the person asks for less movement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPage(page, { replies: [{ fail: true }] });
  await openPanel(page);
  await trip(page).click();
  await expect(alert(page)).toHaveText(retryText);
  const moving = await page.evaluate(
    () => document.getAnimations().filter((a) => a.effect?.getTiming().duration !== 0).length,
  );
  expect(moving).toBe(0);
  const slow = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('.book-downloads, .book-downloads *')).filter((el) => {
        const style = getComputedStyle(el);
        return style.animationName !== 'none' || parseFloat(style.transitionDuration) > 0.01;
      }).length,
  );
  expect(slow).toBe(0);
});

test('hiding the page while a book is being made stops it: nothing is saved, and the retry after showing uses the same command id', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  const rig = await openPage(page, { replies: [pdfReply({ gate })] });
  await openPanel(page);
  await trip(page).click();
  await expect(trip(page)).toHaveAttribute('aria-busy', 'true');
  await expect(status(page)).toHaveText('Preparing your Trip Book…');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(panel(page)).toHaveCount(0);
  // The file is only now answered, to a page that has left. Wait until the answer was given before looking.
  release();
  await expect.poll(() => rig.answered.count).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(summary(page)).toBeVisible();
  await openPanel(page);
  const state = await browserState(page);
  expect(state.downloads).toBe(0);
  expect(state.created).toHaveLength(0);
  expect(state.revoked).toHaveLength(0);
  await expect(status(page)).toHaveText('');
  await expect(alert(page)).toHaveText(retryText);
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book'));
  expect(rig.posts).toHaveLength(2);
  expect(rig.posts[1]!.body.commandId).toBe(rig.posts[0]!.body.commandId);
});

test('after 60 seconds without an answer the download is not confirmed, the button is free and the retry uses the same command id', async ({
  page,
}) => {
  const never = new Promise<void>(() => {});
  const rig = await openPage(page, { clock: true, replies: [pdfReply({ gate: never })] });
  await openPanel(page);
  await trip(page).click();
  await expect(trip(page)).toHaveAttribute('aria-busy', 'true');
  // Just under the limit nothing has changed.
  await page.clock.fastForward(59_000);
  await expect(trip(page)).toHaveAttribute('aria-busy', 'true');
  await page.clock.fastForward(2_000);
  await expect(alert(page)).toHaveText(retryText);
  await expect(trip(page)).not.toHaveAttribute('aria-busy', /.*/);
  await expect(trip(page)).toBeEnabled();
  await expect(supplier(page)).toBeEnabled();
  expect((await browserState(page)).downloads).toBe(0);
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book'));
  expect(rig.posts).toHaveLength(2);
  expect(rig.posts[1]!.body.commandId).toBe(rig.posts[0]!.body.commandId);
});

test('a denial clears the commands that were waiting, so a panel that comes back is clean and starts a new command', async ({
  page,
}) => {
  const rig = await openPage(page, {
    replies: [{ fail: true }, json(403, { error: 'no' })],
  });
  await openPanel(page);
  await trip(page).click();
  await expect(alert(page)).toHaveText(retryText);
  await supplier(page).click();
  await expect(page.getByRole('alert')).toHaveText(
    'This mission is unavailable or access has changed. Nothing was downloaded.',
  );
  await expect(panel(page)).toHaveCount(0);
  await refresh(page).click();
  await openPanel(page);
  // Nothing from before is waiting: no stale "could not confirm", and the next press is a new command.
  await expect(alert(page)).toHaveCount(0);
  await expect(page.getByText('This mission is unavailable or access has changed')).toHaveCount(0);
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book'));
  expect(rig.posts).toHaveLength(3);
  expect(rig.posts[2]!.body.commandId).not.toBe(rig.posts[0]!.body.commandId);
});

test('a book denial is forgotten once the report is read again, so a later denial of an evidence response is the usual one', async ({
  page,
}) => {
  const rig = await openPage(page, {
    respondStatus: 403,
    replies: [json(401, { error: 'no' }), { fail: true }],
  });
  await openPanel(page);
  await trip(page).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Your sign-in has ended. Nothing was downloaded.',
  );
  await expect(page.getByRole('link', { name: 'Sign in again' })).toBeVisible();
  // Away and back: the report is read again and the page is whole.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(summary(page)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // A download waits for a retry, then a response to an evidence request is refused.
  await openPanel(page);
  await trip(page).click();
  await expect(alert(page)).toHaveText(retryText);
  await page.getByRole('tab', { name: 'Evidence and Decisions' }).click();
  await page.getByLabel('Your response').fill('Our licence number is 12345.');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send response' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'This saved mission is unavailable or access could not be confirmed. No commercial report content is shown.',
  );
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Local response recovery' })).toHaveText(
    'Access or request state changed. Local response recovery was cleared for privacy.',
  );
  // The waiting download was forgotten with the rest: after the page is read again the next press is a new command.
  await refresh(page).click();
  await openPanel(page);
  await expect(alert(page)).toHaveCount(0);
  await trip(page).click();
  await expect(status(page)).toHaveText(created('Trip Book'));
  expect(rig.posts).toHaveLength(3);
  expect(rig.posts[2]!.body.commandId).not.toBe(rig.posts[1]!.body.commandId);
});

/**
 * The real page puts the report straight under main.ux-customer with the test-mode note and the tabs above it
 * (KI-16). The fixture is one level deeper, so rebuild that frame for a measurement. React's events are tied to the
 * old container, so do this last, after every click. Every disclosure is closed, as the budget is measured.
 */
async function toCustomerFrame(page: Page) {
  await expect(page.locator('#fixture > main > .ux-page-heading')).toHaveCount(1);
  await expect(page.locator('#fixture > main')).toHaveCount(1);
  await page.evaluate(() => {
    const main = document.querySelector('main')!;
    main.classList.add('ux-customer');
    const fixture = document.getElementById('fixture')!;
    main.style.cssText = '';
    const note = document.createElement('p');
    note.className = 'ux-testmode';
    note.textContent = 'Preview workspace: use made-up names and details here.';
    const nav = document.createElement('nav');
    nav.className = 'guide-tabs';
    nav.innerHTML = ['Home', 'My Work', 'Companies', 'Results', 'More']
      .map((name) => `<a href="#">${name}</a>`)
      .join('');
    main.querySelector('.ux-page-heading')!.after(note, nav);
    fixture.replaceWith(...Array.from(fixture.childNodes));
    for (const details of Array.from(document.querySelectorAll('details'))) details.open = false;
  });
}

const widths = [320, 390, 768, 1440] as const;
for (const width of widths) {
  test(`the panel fits at ${width} wide in every state: no sideways scroll, 44 pixel targets, readable type, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const states: [string, () => Promise<void>, Shape?][] = [
      ['idle', async () => {}],
      [
        'busy',
        async () => {
          await trip(page).click();
          await expect(trip(page)).toHaveAttribute('aria-busy', 'true');
          await expect(status(page)).toHaveText('Preparing your Trip Book…');
        },
      ],
      [
        'success',
        async () => {
          await trip(page).click();
          await expect(status(page)).toHaveText(created('Trip Book'));
        },
      ],
      [
        'error',
        async () => {
          await trip(page).click();
          await expect(alert(page)).toHaveText(retryText);
        },
      ],
      [
        'empty',
        async () => {
          await expect(panel(page)).toContainText('Trip Book: none yet. Supplier Book: none yet.');
          await expect(trip(page)).toBeDisabled();
        },
        { trip: 0, suppliers: 0 },
      ],
    ];
    for (const [name, act, shape] of states) {
      const never = new Promise<void>(() => {});
      await openPage(page, {
        shape,
        replies: [
          name === 'busy'
            ? pdfReply({ gate: never })
            : name === 'error'
              ? { fail: true }
              : pdfReply(),
        ],
      });
      await openPanel(page);
      await act();
      const label = `${name} at ${width}`;
      const wide = await page.evaluate((limit) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('main *'))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > limit + 1)
            out.push(
              `${el.tagName.toLowerCase()}.${(el as HTMLElement).className} ${Math.round(r.right)}`,
            );
        }
        return out.slice(0, 6);
      }, width);
      expect(wide, label).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        label,
      ).toBeLessThanOrEqual(width);
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.book-downloads :is(button, summary, a[href])'))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.height < 43.5)
          .map(
            ({ el }) => `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 30)}`,
          ),
      );
      expect(small, label).toEqual([]);
      const tiny = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.book-downloads *'))
          .filter((el) =>
            Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim()),
          )
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
          .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent || '').slice(0, 30)}`),
      );
      expect(tiny, label).toEqual([]);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations, `axe ${label}`).toEqual([]);
      if (process.env.UX_SHOTS_DIR)
        await page.screenshot({
          path: `${process.env.UX_SHOTS_DIR}/books-${name}-${width}.png`,
          fullPage: true,
        });
    }
  });
}

for (const state of ['idle', 'error', 'empty'] as const)
  test(`at 320 wide and 200 percent text nothing overflows and the notice and buttons are not clipped (${state})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openPage(page, {
      shape: state === 'empty' ? { trip: 0, suppliers: 0 } : undefined,
      replies: state === 'error' ? [{ fail: true }] : [],
    });
    await openPanel(page);
    if (state === 'error') {
      await trip(page).click();
      await expect(alert(page)).toHaveText(retryText);
    }
    if (state === 'empty') await expect(trip(page)).toBeDisabled();
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await expect
      .poll(() =>
        page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
      )
      .toBe(32);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.book-downloads-body p, .book-downloads button'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            el.scrollWidth > el.clientWidth + 1 ||
            el.scrollHeight > el.clientHeight + 1 ||
            r.right > 320 + 1 ||
            r.left < -1
          );
        })
        .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent || '').slice(0, 30)}`),
    );
    expect(clipped).toEqual([]);
  });

const budgets = [
  [390, 844, 4],
  [1440, 900, 2.5],
] as const;
test('scroll budget: the closed panel adds almost nothing to the longest saved report in the real customer frame', async ({
  page,
}, info) => {
  const long: Shape = { trip: 5, suppliers: 5, long: true };
  const figures: Record<string, Record<string, number>> = {};
  for (const [width, height, limit] of budgets) {
    await page.setViewportSize({ width, height });
    const measure = async (books: '0' | '1') => {
      await openPage(page, { books, shape: long });
      // Wait for the exact rendered report before anything is measured.
      await expect(page.getByRole('heading', { name: 'Commercial objective' })).toBeVisible();
      // The evidence requests are in their own tab; the downloads panel is in another.
      await page.getByRole('tab', { name: 'Evidence and Decisions' }).click();
      await expect(
        page.getByRole('heading', { name: 'Evidence requests and declarations' }),
      ).toBeVisible();
      await expect(refresh(page)).toBeVisible();
      if (books === '1') await page.getByRole('tab', { name: 'Downloads' }).click();
      if (books === '1') await expect(summary(page)).toBeVisible();
      else await expect(panel(page)).toHaveCount(0);
      await toCustomerFrame(page);
      return (await page.evaluate(() => document.documentElement.scrollHeight)) / height;
    };
    const off = await measure('0');
    const on = await measure('1');
    // The same page with the panel open, recorded and not budgeted.
    await page.evaluate(() => {
      (document.querySelector('details.book-downloads') as HTMLDetailsElement).open = true;
    });
    await expect(page.locator('details.book-downloads[open]')).toHaveCount(1);
    const openHeight = (await page.evaluate(() => document.documentElement.scrollHeight)) / height;
    const round = (n: number) => Math.round(n * 100) / 100;
    figures[`${width}`] = { off: round(off), on: round(on), open: round(openHeight), limit };
    expect(
      on - off,
      `${width} wide: ${off} screens without the panel, ${on} with it closed`,
    ).toBeLessThanOrEqual(0.12);
    // A page already over its limit without the panel is existing debt: the panel is held to its own share.
    if (off <= limit) expect(on, `${width} wide`).toBeLessThanOrEqual(limit);
  }
  info.annotations.push({ type: 'scroll-budget', description: JSON.stringify(figures) });
  console.log(`scroll budget (longest saved report, panel closed): ${JSON.stringify(figures)}`);
});
