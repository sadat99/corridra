import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Helpers (/operator/network), drawn from the real screen, the real stylesheets and the real "Confirm it is you" check;
// every request is answered here. Two follow-ups of the final walk (26 Nov 2026):
//   A06 country words: the closed fold "Current private work profiles" showed the stored status ("ACTIVE") and country
//       codes ("DE"). With team desk v4.1 on it reads plain words and place names, like the rest of v4.1; with the
//       switch off the line is exactly as it was.
//   B   a profile status review refused only because the authenticator check lapsed ended on the server's words. It
//       now opens the check in place and sends the same review once more.
const tenant = '00000000-0000-4000-8000-0000000000a1';
const profile = (status: string, workCountries: string[]) => ({
  id: '00000000-0000-4000-8000-0000000000b2',
  principal_id: '00000000-0000-4000-8000-0000000000c3',
  version: 1,
  configuration: {
    alias: 'Invented helper Rafi',
    status,
    capabilities: ['supplier_research'],
    markets: ['DE'],
    workCountries,
  },
});
const snapshot = (status = 'SUSPENDED', countries = ['DE', 'BD']) => ({
  purpose: 'SAMPLE',
  enabled: true,
  profiles: [profile(status, countries)],
  profilesTotal: 1,
  profilesNext: null,
  tasks: [],
  tasksTotal: 0,
  tasksNext: null,
  performance: [],
});

let server: Server;
let origin = '';
test.beforeAll(async () => {
  const source = (path: string) => JSON.stringify(resolve('apps/web', path));
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{OperatorFlags}from ${source('app/operator/operator-flags.tsx')};
      import{ExecutionNetwork}from ${source('app/operator/network.tsx')};
      import{StepUpDialog}from ${source('components/ux/step-up-dialog.tsx')};
      const on=new URLSearchParams(location.search).get('v41')==='on';
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page ux-workspace"><h1>Helpers</h1>
        <OperatorFlags replyReview={false} teamDeskV41={on}><ExecutionNetwork tenant="${tenant}" role="owner"/></OperatorFlags>
        <StepUpDialog/></main>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css', '.woff2': 'empty' },
    external: ['/flags/*'],
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'fixture-next',
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
                : 'export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>"/operator/network";export const useSearchParams=()=>new URLSearchParams();',
          }));
        },
      },
    ],
  });
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/fixture.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end(css + '\n' + componentCss);
    } else if (path.startsWith('/flags/')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"/>');
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Helpers</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Answer = { status: number; json: unknown };
async function open(page: Page, v41: boolean, posts: Answer[] = [], status?: string) {
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/verify-totp'))
      return route.fulfill({ json: { token: 'invented', user: { id: 'invented' } } });
    if (url.pathname === '/api/workspace/network' && request.method() === 'GET')
      return route.fulfill({ json: snapshot(status) });
    if (url.pathname === '/api/workspace/network-profile' && request.method() === 'POST') {
      sent.push(request.postDataJSON() as Record<string, unknown>);
      const answer = posts[Math.min(sent.length, posts.length) - 1]!;
      return route.fulfill({ status: answer.status, json: answer.json });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${origin}/?v41=${v41 ? 'on' : 'off'}`);
  const quality = page.getByRole('tab', { name: 'Quality' });
  if (await quality.count()) await quality.click();
  const fold = page.locator('details', {
    has: page.locator('summary', { hasText: 'Current private work profiles' }),
  });
  await fold.locator('summary').click();
  return { fold, sent };
}

test('with team desk v4.1 on, a work profile reads plain status words and place names', async ({
  page,
}) => {
  const { fold } = await open(page, true);
  const line = fold.locator('form p').first();
  await expect(line).toContainText(
    'Invented helper Rafi · Task access paused · reviewed countries',
  );
  await expect(line).toContainText('Germany');
  await expect(line).toContainText('Bangladesh');
  expect(await line.innerText()).not.toMatch(/\bSUSPENDED\b|\bDE\b|\bBD\b/);
  const axe = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

for (const [status, words] of [
  ['ACTIVE', 'Active'],
  ['RETIRED', 'Retired'],
] as const)
  test(`with v4.1 on, ${status} reads "${words}"`, async ({ page }) => {
    const { fold } = await open(page, true, [], status);
    await expect(fold.locator('form p').first()).toContainText(`· ${words} ·`);
  });

test('with the switch off the line is exactly as it was', async ({ page }) => {
  const { fold } = await open(page, false);
  await expect(fold.locator('form p').first()).toHaveText(
    'Invented helper Rafi · SUSPENDED · reviewed countries DE, BD',
  );
});

test('a status review refused for a lapsed check opens the check and sends the same review once more', async ({
  page,
}) => {
  const { fold, sent } = await open(page, true, [
    {
      status: 401,
      json: { error: 'Verify your authenticator again to continue', code: 'STEP_UP_REQUIRED' },
    },
    { status: 200, json: { id: '00000000-0000-4000-8000-0000000000e5' } },
  ]);
  const form = fold.locator('form').first();
  await form.getByLabel('Review reason').fill('Invented review after the task');
  await form.getByRole('button', { name: 'Append Status Review' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Six-digit code').fill('123456');
  await dialog.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(dialog).toBeHidden();
  await expect(form).toContainText('Saved. Reference 00000000-0000-4000-8000-0000000000e5.');
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
});

test('with the check closed the review and its words are kept', async ({ page }) => {
  const { fold, sent } = await open(page, true, [
    {
      status: 401,
      json: { error: 'Verify your authenticator again to continue', code: 'STEP_UP_REQUIRED' },
    },
  ]);
  const form = fold.locator('form').first();
  await form.getByLabel('Review reason').fill('Invented review after the task');
  await form.getByRole('button', { name: 'Append Status Review' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(form).toContainText(
    'Confirm your authenticator code to finish this. Your changes are kept.',
  );
  await expect(form.getByLabel('Review reason')).toHaveValue('Invented review after the task');
  expect(sent).toHaveLength(1);
});
