import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CRUD G6, Email choices: the requests a person muted from an email link, with a way back. Unmute asks first and
// says what it sends; Mute Again is direct; the dialog cannot be dismissed while the change is in flight; every
// failure says so in words. Case ids: CX-02 (the action exists), CX-05 (dialog keyboard and axe at 390, 1440).
const issuer = 'https://ep-g6-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const a_id = '00000000-0000-4000-8000-0000000000a1';
const b_id = '00000000-0000-4000-8000-0000000000b2';
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{MutedRequests}from ${JSON.stringify(resolve('apps/web/app/account/notifications/muted-requests.tsx'))};
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <main className="operator-page ux-workspace ux-customer"><h1>Email choices</h1>
            <MutedRequests
              subject="synthetic-alice"
              issuer=${JSON.stringify(issuer)}
              titles={{ ${JSON.stringify(a_id)}: 'Sell towels in Spain' }}
              initial={[
                { store: 'request', requestId: ${JSON.stringify(a_id)}, muted: true, at: '2026-11-05T10:00:00Z' },
                { store: 'reminder', requestId: ${JSON.stringify(a_id)}, muted: false, at: '2026-11-04T10:00:00Z' },
                { store: 'reminder', requestId: ${JSON.stringify(b_id)}, muted: true, at: '2026-11-03T10:00:00Z' },
              ]}
            />
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

type Sent = { store: string; requestId: string; commandId: string; muted: boolean };
async function open(
  page: Page,
  answer: (sent: Sent) => { status: number; json: unknown } | 'hold',
) {
  const sent: Sent[] = [];
  const held: (() => void)[] = [];
  await page.route('**/api/pulse/mutes', async (route) => {
    const body = route.request().postDataJSON() as Sent;
    sent.push(body);
    const result = answer(body);
    if (result === 'hold') await new Promise<void>((done) => held.push(done));
    const final =
      result === 'hold' ? { status: 200, json: { muted: body.muted, changed: true } } : result;
    return route.fulfill({ status: final.status, json: final.json });
  });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Requests you muted' })).toBeVisible();
  return { sent, release: () => held.splice(0).forEach((done) => done()) };
}
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);

test('CX-02 lists each muted request with its kind and state, and the right action for each', async ({
  page,
}) => {
  await open(page, () => ({ status: 200, json: { muted: false, changed: true } }));
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Sell towels in Spain');
  await expect(rows.nth(0)).toContainText('Receipt and progress emails: stopped');
  await expect(rows.nth(0).getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
  await expect(rows.nth(1)).toContainText('Reminder emails: on again');
  await expect(rows.nth(1).getByRole('button', { name: 'Mute Again', exact: true })).toBeVisible();
  // A request the list does not name still reads plainly, never as an id.
  await expect(rows.nth(2)).toContainText('A request you sent');
  await expect(page.locator('body')).not.toContainText(b_id);
});

test('CX-05 Unmute asks first, says what it sends, and one choice sends one command', async ({
  page,
}) => {
  const { sent } = await open(page, (body) => ({
    status: 200,
    json: { muted: body.muted, changed: true },
  }));
  await page.getByRole('listitem').nth(0).getByRole('button', { name: 'Unmute' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start Emails Again?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Nothing from the time you stopped them is sent');
  await expect(dialog.getByRole('button', { name: 'Keep Them Stopped' })).toBeFocused();
  expect(sent).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Start Emails Again' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ store: 'request', requestId: a_id, muted: false });
  expect(sent[0]!.commandId).toMatch(/^[0-9a-f-]{36}$/);
  const row = page.getByRole('listitem').nth(0);
  await expect(row).toContainText('Receipt and progress emails: on again');
  await expect(row.getByRole('status')).toHaveText('Emails about this request are on again.');
  await expect(row.getByRole('button', { name: 'Mute Again' })).toBeVisible();
});

test('CX-05 Keep Them Stopped and Escape send nothing and put focus back on Unmute', async ({
  page,
}) => {
  const { sent } = await open(page, () => ({ status: 200, json: { muted: false, changed: true } }));
  const unmute = page.getByRole('listitem').nth(0).getByRole('button', { name: 'Unmute' });
  await unmute.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Start Emails Again?' })).toBeHidden();
  await expect(unmute).toBeFocused();
  await unmute.click();
  await page.getByRole('button', { name: 'Keep Them Stopped' }).click();
  expect(sent).toHaveLength(0);
});

test('the dialog cannot be dismissed while the change is in flight, and the answer is not lost', async ({
  page,
}) => {
  const { sent, release } = await open(page, () => 'hold');
  await page.getByRole('listitem').nth(0).getByRole('button', { name: 'Unmute' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start Emails Again?' });
  await dialog.getByRole('button', { name: 'Start Emails Again' }).click();
  await expect.poll(() => sent.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Please Wait…' })).toBeDisabled();
  release();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem').nth(0)).toContainText('on again');
});

test('Mute Again is direct, and a retry after a failure reuses the same command id', async ({
  page,
}) => {
  let failFirst = true;
  const { sent } = await open(page, (body) => {
    if (failFirst) {
      failFirst = false;
      return { status: 500, json: { error: 'x' } };
    }
    return { status: 200, json: { muted: body.muted, changed: true } };
  });
  const row = page.getByRole('listitem').nth(1);
  await row.getByRole('button', { name: 'Mute Again' }).click();
  await expect(row.getByRole('status')).toHaveText(
    'The change was not confirmed. Try the same request again.',
  );
  await row.getByRole('button', { name: 'Mute Again' }).click();
  await expect(row).toContainText('Reminder emails: stopped');
  expect(sent).toHaveLength(2);
  expect(sent[1]!.commandId).toBe(sent[0]!.commandId);
});

test("every refusal says so in words: the closed control, another person's request, the limit and no answer", async ({
  page,
}) => {
  const answers: { status: number; json: unknown }[] = [
    { status: 200, json: { muted: true, changed: false, reason: 'closed' } },
    { status: 403, json: { error: 'x' } },
    { status: 429, json: { error: 'x' } },
    { status: 503, json: { error: 'x' } },
  ];
  await open(page, () => answers.shift() ?? { status: 500, json: {} });
  const row = page.getByRole('listitem').nth(0);
  const words = [
    'Emails cannot be turned on right now.',
    'This request is not available to change.',
    'The request limit was reached. Try again later.',
    'Email choices are unavailable right now.',
  ];
  for (const text of words) {
    await row.getByRole('button', { name: 'Unmute' }).click();
    await page.getByRole('button', { name: 'Start Emails Again' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: text })
        .or(page.getByRole('alert').filter({ hasText: text }))
        .first(),
    ).toBeVisible();
    if (page.url() && (await page.getByRole('dialog', { name: 'Start Emails Again?' }).isVisible()))
      await page.getByRole('button', { name: 'Keep Them Stopped' }).click();
  }
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`CX-05 the list and the dialog have no axe violations and no sideways scroll at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page, () => ({ status: 200, json: { muted: false, changed: true } }));
    expect(await axe(page)).toEqual([]);
    await page.getByRole('listitem').nth(0).getByRole('button', { name: 'Unmute' }).click();
    await expect(page.getByRole('dialog', { name: 'Start Emails Again?' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const folder = resolve('docs/design-system/evidence/revamp-g6');
    mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: resolve(folder, `muted-requests-dialog-${width}.png`) });
  });
