import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// L12 (signed-in sweep, owner screenshots of 13 November 2026): the Workspaces list with archived workspaces. Harness
// copied from revamp-g4-workspace-lifecycle.spec.ts; each case fails on the code before the L12 fixes.
const issuer = 'https://ep-g4-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const ids = {
  own: '00000000-0000-4000-8000-0000000000e1',
  adm: '00000000-0000-4000-8000-0000000000e2',
  mem: '00000000-0000-4000-8000-0000000000e3',
};
const memberA = '00000000-0000-4000-8000-0000000000f1';
const memberB = '00000000-0000-4000-8000-0000000000f2';
const offerId = '00000000-0000-4000-8000-0000000000d1';
const workspaces = [
  { id: ids.own, name: 'Synthetic Dhaka Knits', role: 'owner' },
  { id: ids.adm, name: 'Synthetic Chattogram Dyers', role: 'admin' },
  { id: ids.mem, name: 'Synthetic Gazipur Wovens', role: 'member' },
].map((row) => ({ ...row, synthetic: true, organisationId: null }));
const on = { requestsEnabled: true, draftsEnabled: true, memberRolesEnabled: true };
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{CustomerWorkspaces}from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
      const q=new URLSearchParams(location.search);
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <main className="operator-page ux-workspace ux-customer"><h1>Your requests and workspaces.</h1>
            <CustomerWorkspaces subject="synthetic-alice" issuer=${JSON.stringify(issuer)} {...JSON.parse(q.get('props')||'{}')}/>
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspaces</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

type Sent = Record<string, unknown>;
type Setup = {
  /** The list answers this status instead of a list: the control is closed. */
  closed?: number;
  states?: Record<string, Record<string, unknown>>;
  /** Set failReads while the test runs and every read of the lifecycle answers 500. */
  control?: { failReads: boolean };
  answer?: (sent: Sent) => { status: number; json: unknown } | undefined;
};
const stateFor = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  open: true,
  workspaceId: id,
  name: workspaces.find((w) => w.id === id)!.name,
  archived: false,
  version: 3,
  role,
  history: [],
  offer: null,
  ownerMemberId: null,
  protectedMembers: [],
  keepsAccess: false,
  ...extra,
});
async function open(page: Page, setup: Setup = {}) {
  const states: Record<string, Record<string, unknown>> = {
    [ids.own]: stateFor(ids.own, 'owner'),
    [ids.adm]: stateFor(ids.adm, 'admin'),
    [ids.mem]: stateFor(ids.mem, 'member'),
    ...setup.states,
  };
  const sent: Sent[] = [];
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces } }),
  );
  await page.route('**/api/customer-workspace-access*', (route) =>
    route.fulfill({
      json: {
        workspaceId: ids.own,
        ownerProtected: true,
        nextInvitationAfter: null,
        nextMemberAfter: null,
        invitations: [],
        memberships: [
          {
            id: memberA,
            label: 'Synthetic Rahim',
            role: 'admin',
            createdAt: '2026-11-01T09:00:00Z',
            status: 'active',
          },
          {
            id: memberB,
            label: 'Synthetic Salma',
            role: 'member',
            createdAt: '2026-11-01T09:00:00Z',
            status: 'active',
          },
          {
            id: '00000000-0000-4000-8000-0000000000f3',
            label: 'Synthetic Gone',
            role: 'member',
            createdAt: '2026-11-01T09:00:00Z',
            status: 'revoked',
          },
        ],
      },
    }),
  );
  await page.route('**/api/customer-workspace-lifecycle**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      if (setup.closed) return route.fulfill({ status: setup.closed, json: { error: 'closed' } });
      if (setup.control?.failReads)
        return route.fulfill({
          status: 500,
          json: { error: 'The request could not be completed.' },
        });
      const id = new URL(request.url()).searchParams.get('workspaceId');
      return route.fulfill({
        json: id
          ? states[id]
          : Object.values(states).map((s) => ({
              workspaceId: s.workspaceId,
              archived: s.archived,
              version: s.version,
            })),
      });
    }
    const body = request.postDataJSON() as Sent;
    sent.push(body);
    const id = String(body.workspaceId ?? ids.own);
    const custom = setup.answer?.(body);
    if (custom) return route.fulfill({ status: custom.status, json: custom.json });
    const state = states[id]!;
    if (body.action === 'rename') state.name = String(body.name);
    if (body.action === 'archive') state.archived = true;
    if (body.action === 'restore') state.archived = false;
    if (body.action === 'archive' || body.action === 'restore' || body.action === 'rename')
      state.version = Number(state.version) + 1;
    if (body.action === 'offer_transfer')
      state.offer = {
        offerId,
        toMemberId: body.memberId,
        expiresAt: '2099-01-01T10:00:00Z',
        toYou: false,
        byYou: true,
      };
    if (body.action === 'cancel_transfer') state.offer = null;
    return route.fulfill({
      json: { workspaceId: id, operation: String(body.action), expiresAt: '2099-01-01T10:00:00Z' },
    });
  });
  await page.goto(`${origin}/?props=${encodeURIComponent(JSON.stringify(on))}`);
  await expect(page.getByRole('table', { name: 'Your workspaces' })).toBeVisible();
  return { sent };
}

const archivedOwn = { [ids.own]: stateFor(ids.own, 'owner', { archived: true, version: 5 }) };
const owner = 'Synthetic Dhaka Knits';

test('L12-1 an archived workspace says it is archived once, not in the banner and again in its row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { states: archivedOwn });
  await page.getByRole('radio', { name: /Archived/ }).check();
  await expect(page.getByText(/This workspace is archived\./)).toHaveCount(1);
  await expect(
    page.getByText('New requests are closed while this workspace is archived.'),
  ).toHaveCount(0);
  // No New Request for an archived workspace is still true: the menu offers none.
  await page
    .getByRole('row', { name: new RegExp(owner) })
    .getByRole('button')
    .click();
  await expect(page.getByRole('menuitem', { name: 'New Request' })).toHaveCount(0);
});

test('L12-2 the workspace name and its Archived badge have a gap in the banner', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { states: archivedOwn });
  await page.getByRole('radio', { name: /Archived/ }).check();
  const card = page.getByRole('group', { name: 'Workspace notices for ' + owner });
  const name = await card.locator('strong').boundingBox();
  const badge = await card.locator('.ux-badge').boundingBox();
  expect(badge!.x - (name!.x + name!.width)).toBeGreaterThanOrEqual(4);
});

test('L12-3 the Role column shows a capitalised role', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const cell = page
    .getByRole('row', { name: new RegExp(owner) })
    .getByRole('cell')
    .first();
  await expect(cell).toHaveText(/owner/i);
  expect(await cell.evaluate((el) => getComputedStyle(el).textTransform)).toBe('capitalize');
});

test('L12-4 the Active and Archived filter is as wide as its two segments', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { states: archivedOwn });
  const row = await page.locator('.ux-segments-row').boundingBox();
  const segments = await page
    .locator('.ux-segment')
    .evaluateAll((els) => els.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0));
  expect(row!.width).toBeLessThanOrEqual(segments + 2);
});
