import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CRUD-A (docs/revamp/specs/crud-standard.md, D-01, D-02, A-03): the customer removals that had no step before them.
// Case ids: CRUD-4 (remove, hide and restore keep the same item reachable) and D-02 (an irreversible action asks
// once, naming the object and its consequence, with the destructive button not focused first). The real
// components are mounted in a small page with the real stylesheets and answers from the routes below.
const issuer = 'https://ep-crud-a-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000006';
const resourceId = '00000000-0000-4000-8000-0000000000a1';
const cardId = '00000000-0000-4000-8000-0000000000c1';
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{DecisionCardPanel}from ${JSON.stringify(resolve('apps/web/app/account/missions/decision-card-panel.tsx'))};
      import{GuidedRequest}from ${JSON.stringify(resolve('apps/web/app/account/drafts/guided-request.tsx'))};
      const q=new URLSearchParams(location.search);
      const kind=q.get('kind');
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <main className="operator-page ux-workspace ux-customer"><h1>Fixture</h1>
            {kind==='drafts'
              ? <GuidedRequest subject="synthetic-alice" issuer=${JSON.stringify(issuer)} workspaceId=${JSON.stringify(workspaceId)} profilesEnabled={true}/>
              : <DecisionCardPanel resourceId=${JSON.stringify(resourceId)} subject="synthetic-alice" issuer=${JSON.stringify(issuer)} synthetic={true}
                  decisions={[{id:'d1',company:'Synthetic Dhaka Knits',decision:'GO',requirementCurrent:true}]}/>}
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>CRUD A</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);

test('D-02 withdrawing a decision link asks first, names the link and what ends, and focuses the safe choice', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route('**/api/customer-decision-cards', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'state')
      return route.fulfill({
        json: {
          canShare: true,
          maxActive: 5,
          cards: [
            {
              id: cardId,
              state: 'ACTIVE',
              expiresAt: '2026-12-01T10:00:00.000Z',
              opens: 2,
              lastOpenedAt: null,
            },
          ],
        },
      });
    posts.push(body);
    await gate;
    return route.fulfill({ json: {} });
  });
  await page.goto(`${origin}/?kind=card`);
  const withdraw = page.getByRole('button', { name: 'Withdraw', exact: true });
  await withdraw.click();
  // Nothing is sent by the first click.
  const dialog = page.getByRole('dialog', { name: 'Withdraw This Link?' });
  await expect(dialog).toBeVisible();
  expect(posts).toHaveLength(0);
  await expect(dialog).toContainText('Anyone who has this link loses access at once');
  await expect(dialog).toContainText('cannot be undone');
  // The safe choice is the one with focus.
  await expect(dialog.getByRole('button', { name: 'Keep Link', exact: true })).toBeFocused();
  expect(await axe(page)).toEqual([]);
  // Keeping it closes the dialog and sends nothing; focus returns to the button that opened it.
  await dialog.getByRole('button', { name: 'Keep Link', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(withdraw).toBeFocused();
  expect(posts).toHaveLength(0);
  // Escape does the same.
  await withdraw.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(posts).toHaveLength(0);
  // Confirming sends one withdraw, the dialog cannot be dismissed while it is out, then it closes.
  await withdraw.click();
  await dialog.getByRole('button', { name: 'Withdraw Link', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toBeHidden();
  expect(posts[0]).toMatchObject({ action: 'withdraw', cardId });
  await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);
});

test('CRUD-4 discarded drafts are hidden by default and one button shows them again', async ({
  page,
}) => {
  const row = (id: string, title: string, status: string) => ({
    id,
    version: 1,
    title,
    family: 'BUYERS_PARTNERS',
    status,
    requestId: null,
    updatedAt: '2026-10-19T00:00:00Z',
  });
  await page.route('**/api/customer-mission-drafts*', (route) =>
    route.fulfill({
      json: {
        workspaceId,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        nextAfter: null,
        drafts: [
          row('00000000-0000-4000-8000-0000000000d1', 'Synthetic towel buyer search', 'OPEN'),
          row('00000000-0000-4000-8000-0000000000d2', 'Synthetic old sourcing idea', 'DISCARDED'),
          row('00000000-0000-4000-8000-0000000000d3', 'Synthetic sent request', 'SUBMITTED'),
        ],
      },
    }),
  );
  await page.goto(`${origin}/?kind=drafts`);
  await expect(page.getByText('Synthetic towel buyer search', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic sent request', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic old sourcing idea', { exact: true })).toHaveCount(0);
  const toggle = page.getByRole('button', { name: 'Show Discarded Drafts (1)', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.getByText('Synthetic old sourcing idea', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Hide Discarded Drafts (1)', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Hide Discarded Drafts (1)', exact: true }).click();
  await expect(page.getByText('Synthetic old sourcing idea', { exact: true })).toHaveCount(0);
});
