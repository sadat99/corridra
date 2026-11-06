import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CRUD G1, the saved requests: Withdraw Request opens a dialog that names the request and its consequence, asks for a
// reason and says who sees it; the destructive button is not focused and the dialog cannot be dismissed while the
// change is in flight; Undo lasts ten seconds; Withdrawn is a filter kept in the address; Restore Request is direct.
// Case ids: CX-02 (the actions exist), CX-04 (the filter is in the address), CX-05 (dialog keyboard and axe).
const issuer = 'https://ep-g1-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
const workspace = '00000000-0000-4000-8000-0000000000aa';
const reasonWords = 'I sent this to the wrong team and will send it again';
const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: ids[n]!,
  workspaceId: workspace,
  createdAt: `2026-11-0${n + 1}T09:00:00.000Z`,
  synthetic: true,
  available: true,
  title: ['Sell towels in Spain', 'Source packaging in Turkey', 'Plan a trade visit'][n],
  progress: { status: 'ACTIVE', receivedAt: `2026-11-0${n + 1}T09:00:00.000Z`, replies: [] },
  ...extra,
});
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{CustomerRequests}from ${JSON.stringify(resolve('apps/web/app/account/customer-requests.tsx'))};
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <main className="operator-page ux-workspace ux-customer"><h1>Requests</h1>
            <CustomerRequests subject="synthetic-alice" issuer=${JSON.stringify(issuer)} statuses={['ACTIVE','CLOSED']} canSubmit={false} detailsEnabled={false} />
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
                : 'const router={replace:()=>{},push:()=>{}};export function useRouter(){return router}export function usePathname(){return "/account"}',
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
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reports</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Sent = { action: string; requestId: string; commandId: string; reason?: string };
type Setup = {
  open?: boolean;
  withdrawn?: number[];
  answer?: (sent: Sent) => { status: number; json: unknown } | 'hold';
  query?: string;
};
async function open(page: Page, setup: Setup = {}) {
  const withdrawn = new Set(setup.withdrawn ?? []);
  const sent: Sent[] = [];
  const held: (() => void)[] = [];
  await page.route('**/api/customer-requests**', (route) =>
    route.fulfill({
      json: {
        requests: [0, 1, 2].map((n) =>
          row(n, withdrawn.has(n) ? { withdrawn: true } : { withdrawn: false }),
        ),
        nextAfter: null,
        synthetic: true,
      },
    }),
  );
  await page.route('**/api/customer-request-withdrawals', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          open: setup.open ?? true,
          items: [...withdrawn].map((n) => ({
            requestId: ids[n],
            at: '2026-11-04T10:00:00Z',
            reason: reasonWords,
          })),
        },
      });
    const body = route.request().postDataJSON() as Sent;
    sent.push(body);
    const answer = setup.answer?.(body) ?? {
      status: 200,
      json: { withdrawn: body.action === 'withdraw', changed: true },
    };
    if (answer === 'hold') await new Promise<void>((done) => held.push(done));
    const final =
      answer === 'hold'
        ? { status: 200, json: { withdrawn: body.action === 'withdraw', changed: true } }
        : answer;
    return route.fulfill({ status: final.status, json: final.json });
  });
  await page.goto(origin + (setup.query ?? ''));
  await expect(page.getByRole('heading', { name: 'Saved requests' })).toBeVisible();
  await expect(page.getByRole('article').first()).toBeVisible();
  return { sent, release: () => held.splice(0).forEach((done) => done()) };
}
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);
const article = (page: Page, title: string) =>
  page.getByRole('article').filter({ has: page.getByRole('heading', { name: title }) });

test('CX-02 every active request offers Withdraw Request, and Withdrawn holds the ones already withdrawn', async ({
  page,
}) => {
  await open(page, { withdrawn: [2] });
  await expect(page.getByRole('button', { name: 'Withdraw Request', exact: true })).toHaveCount(2);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByText('Plan a trade visit')).toHaveCount(0);
  await page.getByRole('radio', { name: /Withdrawn/ }).check();
  const withdrawn = article(page, 'Plan a trade visit');
  await expect(withdrawn).toBeVisible();
  await expect(withdrawn).toContainText('You withdrew this request on');
  await expect(withdrawn).toContainText('Only you can see your reason: ' + reasonWords);
  await expect(
    withdrawn.getByRole('button', { name: 'Restore Request', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('CX-04 the filter lives in the address, and an address with ?status=withdrawn opens on Withdrawn', async ({
  page,
}) => {
  await open(page, { withdrawn: [1] });
  await page.getByRole('radio', { name: /Withdrawn/ }).check();
  await expect(page).toHaveURL(/status=withdrawn/);
  await page.getByRole('radio', { name: /Active/ }).check();
  await expect(page).not.toHaveURL(/status=/);
  const again = await page.context().newPage();
  await again.route('**/api/customer-requests**', (route) =>
    route.fulfill({
      json: {
        requests: [row(0), row(1, { withdrawn: true }), row(2)],
        nextAfter: null,
        synthetic: true,
      },
    }),
  );
  await again.route('**/api/customer-request-withdrawals', (route) =>
    route.fulfill({
      json: {
        open: true,
        items: [{ requestId: ids[1], at: '2026-11-04T10:00:00Z', reason: reasonWords }],
      },
    }),
  );
  await again.goto(origin + '?status=withdrawn');
  await expect(again.getByRole('article')).toHaveCount(1);
  await expect(again.getByRole('radio', { name: /Withdrawn/ })).toBeChecked();
});

test('with withdrawing closed and nothing withdrawn there is no Withdraw Request and no filter', async ({
  page,
}) => {
  await open(page, { open: false });
  await expect(page.getByRole('button', { name: 'Withdraw Request' })).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(3);
});

test('CX-05 the dialog names the request and its consequence, asks for a reason, says who sees it, and does not focus the destructive button', async ({
  page,
}) => {
  const { sent } = await open(page);
  await article(page, 'Sell towels in Spain')
    .getByRole('button', { name: 'Withdraw Request' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw Request?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Sell towels in Spain');
  await expect(dialog).toContainText('Nothing is deleted');
  await expect(dialog).toContainText('restore it from Withdrawn');
  await expect(dialog).toContainText(
    'Only you can see this reason; the Corridra team sees that you withdrew the request and when.',
  );
  await expect(dialog.getByRole('button', { name: 'Keep Request' })).toBeFocused();
  const confirm = dialog.getByRole('button', { name: 'Withdraw Request', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Why are you withdrawing it?').fill('too short');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Why are you withdrawing it?').fill(reasonWords);
  await expect(confirm).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(sent).toHaveLength(0);
});

test('CX-02 withdrawing moves the request to Withdrawn, Undo brings it back, and each sends one command', async ({
  page,
}) => {
  const { sent } = await open(page);
  await article(page, 'Sell towels in Spain')
    .getByRole('button', { name: 'Withdraw Request' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw Request?' });
  await dialog.getByLabel('Why are you withdrawing it?').fill(reasonWords);
  await dialog.getByRole('button', { name: 'Withdraw Request', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ action: 'withdraw', requestId: ids[0], reason: reasonWords });
  expect(sent[0]!.commandId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByText('Sell towels in Spain')).toHaveCount(1);
  const undo = page.getByRole('status').filter({ hasText: 'was withdrawn.' });
  await expect(undo).toContainText('Sell towels in Spain was withdrawn.');
  await expect(page.getByRole('article')).toHaveCount(2);
  await undo.getByRole('button', { name: 'Undo' }).click();
  expect(sent).toHaveLength(2);
  expect(sent[1]).toMatchObject({ action: 'restore', requestId: ids[0] });
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.getByRole('status').filter({ hasText: 'was withdrawn.' })).toHaveCount(0);
});

test('Undo is offered for ten seconds, after which Restore Request on Withdrawn is the way back', async ({
  page,
}) => {
  await page.clock.install();
  await open(page);
  await article(page, 'Plan a trade visit')
    .getByRole('button', { name: 'Withdraw Request' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw Request?' });
  await dialog.getByLabel('Why are you withdrawing it?').fill(reasonWords);
  await dialog.getByRole('button', { name: 'Withdraw Request', exact: true }).click();
  const undo = page.getByRole('status').filter({ hasText: 'was withdrawn.' });
  await expect(undo).toBeVisible();
  await page.clock.fastForward(10_500);
  await expect(undo).toHaveCount(0);
  await page.getByRole('radio', { name: /Withdrawn/ }).check();
  await expect(
    article(page, 'Plan a trade visit').getByRole('button', { name: 'Restore Request' }),
  ).toBeVisible();
});

test('the dialog cannot be dismissed while the change is in flight', async ({ page }) => {
  const { sent, release } = await open(page, { answer: () => 'hold' });
  await article(page, 'Sell towels in Spain')
    .getByRole('button', { name: 'Withdraw Request' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw Request?' });
  await dialog.getByLabel('Why are you withdrawing it?').fill(reasonWords);
  await dialog.getByRole('button', { name: 'Withdraw Request', exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Please Wait…' })).toBeDisabled();
  release();
  await expect(dialog).toBeHidden();
});

test('a retry after a failure reuses the same command id, and every refusal says so in words', async ({
  page,
}) => {
  const answers: { status: number; json: unknown }[] = [
    { status: 500, json: {} },
    { status: 403, json: {} },
    { status: 429, json: {} },
    { status: 200, json: { withdrawn: false, changed: false, reason: 'closed' } },
    { status: 200, json: { withdrawn: false, changed: false, reason: 'not-withdrawable' } },
  ];
  const { sent } = await open(page, {
    answer: () => answers.shift() ?? { status: 200, json: { withdrawn: true, changed: true } },
  });
  await article(page, 'Sell towels in Spain')
    .getByRole('button', { name: 'Withdraw Request' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw Request?' });
  await dialog.getByLabel('Why are you withdrawing it?').fill(reasonWords);
  const confirm = dialog.getByRole('button', { name: 'Withdraw Request', exact: true });
  const words = [
    'The change was not confirmed. Try the same request again.',
    'This request is not available to change.',
    'The request limit was reached. Try again later.',
    'Withdrawing requests is not open yet.',
    'This request is closed, so there is nothing left to withdraw.',
  ];
  for (const text of words) {
    await confirm.click();
    await expect(dialog.getByRole('alert')).toHaveText(text);
  }
  expect(new Set(sent.map((s) => s.commandId)).size).toBe(1);
  await confirm.click();
  await expect(dialog).toBeHidden();
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`CX-05 the list and the dialog have no axe violations and no sideways scroll at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page, { withdrawn: [2] });
    expect(await axe(page)).toEqual([]);
    await article(page, 'Sell towels in Spain')
      .getByRole('button', { name: 'Withdraw Request' })
      .click();
    await page
      .getByRole('dialog', { name: 'Withdraw Request?' })
      .getByLabel('Why are you withdrawing it?')
      .fill(reasonWords);
    expect(await axe(page)).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const folder = resolve('docs/design-system/evidence/revamp-g1');
    mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: resolve(folder, `withdraw-dialog-${width}.png`) });
  });
