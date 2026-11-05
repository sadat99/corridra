import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CX PR 2b, the Workspaces tab: the real workspaces table with the real stylesheets. Case ids: CX-05 (the row
// menu and the Create, Join, Team and Leave dialogs work from the keyboard, Escape closes them, focus returns,
// axe is clean at 390 and 1440) and CX-07 (screenshots at 390 and 1440, written to the evidence folder).
const issuer = 'https://ep-cx2b-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const ownerId = '00000000-0000-4000-8000-0000000000e1';
const memberId = '00000000-0000-4000-8000-0000000000e2';
const workspaces = [
  { id: ownerId, name: 'Synthetic Dhaka Knits', role: 'owner' },
  { id: memberId, name: 'Synthetic Chattogram Dyers', role: 'member' },
  { id: '00000000-0000-4000-8000-0000000000e3', name: 'Synthetic Gazipur Wovens', role: 'admin' },
].map((row) => ({ ...row, synthetic: true, organisationId: null }));
const on = {
  requestsEnabled: true,
  draftsEnabled: true,
  profilesEnabled: true,
  programmesEnabled: true,
  serviceRequestsEnabled: true,
  billingEnabled: true,
  memberRolesEnabled: true,
};
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const folder = 'docs/design-system/evidence/revamp-cx2b';

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
  mkdirSync(folder, { recursive: true });
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

async function open(page: Page, rows = workspaces) {
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: rows } }),
  );
  await page.route('**/api/customer-workspace-access*', (route) =>
    route.fulfill({
      json: {
        workspaceId: ownerId,
        ownerProtected: true,
        nextInvitationAfter: null,
        nextMemberAfter: null,
        invitations: [],
        memberships: [],
      },
    }),
  );
  await page.goto(`${origin}/?props=${encodeURIComponent(JSON.stringify(on))}`);
  await expect(page.getByRole('table', { name: 'Your workspaces' })).toBeVisible();
}
const trigger = (page: Page, name: string) =>
  page.getByRole('button', { name: 'Actions for ' + name });
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);

test('CX-05 a row menu opens from the keyboard, moves with the arrows and Escape returns focus to its button', async ({
  page,
}) => {
  await open(page);
  const button = trigger(page, 'Synthetic Dhaka Knits');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem', { name: 'New Request', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Continue a Saved Draft' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Manage Team', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('menu', { name: 'Actions for Synthetic Dhaka Knits' })).toBeHidden();
});

test('CX-05 Create and Join open in dialogs that hold focus, close on Escape and give focus back', async ({
  page,
}) => {
  await open(page);
  for (const [opener, title] of [
    ['Create a Workspace', 'Create a Workspace'],
    ['Join a Workspace', 'Join a Workspace'],
  ] as const) {
    const button = page.getByRole('button', { name: opener, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    // Tab never leaves the dialog.
    for (let n = 0; n < 8; n++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  }
});

test('CX-05 Manage Team and Leave Workspace open from the row menu and close on Escape', async ({
  page,
}) => {
  await open(page);
  await trigger(page, 'Synthetic Dhaka Knits').click();
  await page.getByRole('menuitem', { name: 'Manage Team', exact: true }).click();
  const team = page.getByRole('dialog', { name: 'Team for Synthetic Dhaka Knits' });
  await expect(team).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(team).toBeHidden();
  await trigger(page, 'Synthetic Chattogram Dyers').click();
  await expect(page.getByRole('menuitem', { name: 'Manage Team', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Leave Workspace', exact: true }).click();
  const leave = page.getByRole('dialog', { name: /Leave/ });
  await expect(leave).toBeVisible();
  await expect(leave.getByRole('button', { name: 'Confirm leaving' })).toBeVisible();
  await leave.getByRole('button', { name: 'Keep my access' }).click();
  await expect(leave).toBeHidden();
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`CX-05 and CX-07 the workspaces table has no sideways scroll and no axe violations at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: `${folder}/workspaces-after-${width}.png`, fullPage: true });
    await trigger(page, 'Synthetic Dhaka Knits').click();
    expect(await axe(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
