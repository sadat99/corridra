import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// An archived workspace is not offered as a normal choice: the account menu, the rail's New Request and the search
// Pages leave it out, and /account keeps it under the Archived view with its label and Restore Workspace for the owner.
// The real customer header, rail, search and Workspaces list are mounted as a fixture; the workspace list and the
// lifecycle answers are scripted with page.route and can change mid-test, as a Restore does. The database truth of the
// flag is proven in tests/integration/archived-workspace-list.test.ts. Nothing here reads a database.
const issuer = 'https://ep-awh-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const active = '00000000-0000-4000-8000-0000000000b1';
const archived = '00000000-0000-4000-8000-0000000000b2';
const memberArchived = '00000000-0000-4000-8000-0000000000b3';
const names: Record<string, string> = {
  [active]: 'Synthetic Dhaka Knits',
  [archived]: 'Synthetic Old Mill',
  [memberArchived]: 'Synthetic Closed Dyers',
};
const workHref = '/account?view=work#customer-workspaces';

let server: Server, origin: string;
test.beforeAll(async () => {
  const source = (path: string) => JSON.stringify(resolve(path));
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
import{LanguageProvider}from ${source('apps/web/components/language-provider.tsx')};
import{AppHeader}from ${source('apps/web/components/ux/app-header.tsx')};
import{BrandLockup}from ${source('apps/web/components/site-header.tsx')};
import{LeftNavFrame,LeftNavList}from ${source('apps/web/components/ux/left-nav.tsx')};
import{customerTabs}from ${source('apps/web/lib/ux/customer-navigation.ts')};
import{CustomerRailTop,CustomerRailFoot}from ${source('apps/web/components/ux/customer-rail.tsx')};
import{CustomerWorkspaces}from ${source('apps/web/app/account/customer-workspaces.tsx')};
import*as store from ${source('apps/web/components/ux/customer-bar-store.ts')};
store.setCustomerCompanies(true);
store.setCustomerBilling(true);
store.setCustomerNotificationSettings(true);
store.setCustomerOrganisationProfiles(true);
const words={navLabel:'Navigation',menuLabel:'Menu',closeLabel:'Close menu',collapseLabel:'Collapse menu',expandLabel:'Expand menu'};
const items=customerTabs({companies:true,move:false}).map(t=>({key:t.key,label:t.label,href:t.href,icon:t.icon}));
createRoot(document.getElementById('fixture')).render(
  <LanguageProvider offered={[{code:'en',draft:false}]}>
    <div className="site-shell">
      <AppHeader kind="customer" live={false} notifications brandMark={<BrandLockup/>}/>
      <LeftNavFrame navId="customer-navigation" words={words} nav={<><CustomerRailTop/><LeftNavList id="customer-navigation" label="Navigation" items={items} current="requests"/><CustomerRailFoot/></>}>
        <main className="ux-customer"><h1>Synthetic account page</h1>
          {location.pathname==='/account'?<CustomerWorkspaces subject="synthetic-alice" issuer=${JSON.stringify(issuer)} requestsEnabled draftsEnabled billingEnabled/>:null}
        </main>
      </LeftNavFrame>
    </div>
  </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    external: ['/flags/*'],
    write: false,
    outdir: 'out',
    loader: { '.css': 'css', '.woff2': 'empty' },
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
                : 'const router={replace:()=>{},push:()=>{},refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return location.pathname}export function useSearchParams(){return new URLSearchParams(location.search)}',
          }));
        },
      },
    ],
  });
  const javascript = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const globalCss = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(`${globalCss}\n${componentCss}`);
    } else if (path === '/account' || path.startsWith('/account/')) {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic customer page</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Fixture address unavailable');
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

type Row = { id: string; role: 'owner' | 'admin' | 'member'; archived: boolean };
type World = { rows: Row[]; status?: number; versions: Record<string, number> };
/** Answers the workspace list and the lifecycle control from `world`, which a test or a Restore can change. */
async function serve(page: Page, world: World) {
  await page.route('**/api/customer-workspaces', (route) =>
    world.status
      ? route.fulfill({ status: world.status, json: { error: 'Sign in to continue' } })
      : route.fulfill({
          json: {
            synthetic: true,
            workspaces: world.rows.map((row) => ({
              ...row,
              name: names[row.id],
              synthetic: true,
              organisationId: null,
            })),
          },
        }),
  );
  const state = (row: Row) => ({
    open: true,
    workspaceId: row.id,
    name: names[row.id],
    archived: row.archived,
    version: world.versions[row.id] ?? 1,
    role: row.role,
    history: [],
    offer: null,
    ownerMemberId: null,
    protectedMembers: [],
    keepsAccess: false,
  });
  await page.route('**/api/customer-workspace-lifecycle**', (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      const id = new URL(request.url()).searchParams.get('workspaceId');
      const row = world.rows.find((candidate) => candidate.id === id);
      return route.fulfill({
        json: row
          ? state(row)
          : world.rows.map((r) => ({
              workspaceId: r.id,
              archived: r.archived,
              version: world.versions[r.id] ?? 1,
            })),
      });
    }
    const body = request.postDataJSON() as { action: string; workspaceId: string };
    const row = world.rows.find((candidate) => candidate.id === body.workspaceId)!;
    if (body.action === 'restore') row.archived = false;
    if (body.action === 'archive') row.archived = true;
    world.versions[row.id] = (world.versions[row.id] ?? 1) + 1;
    return route.fulfill({ json: { workspaceId: row.id, operation: body.action } });
  });
  await page.route('**/api/customer-workspace-access*', (route) =>
    route.fulfill({
      json: {
        workspaceId: active,
        ownerProtected: true,
        invitations: [],
        memberships: [],
        nextInvitationAfter: null,
        nextMemberAfter: null,
      },
    }),
  );
  await page.route('**/api/customer-inbox*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({
      json: { user: { name: 'Synthetic Alice', email: 'synthetic-alice@example.invalid' } },
    }),
  );
}
async function visit(page: Page, path: string) {
  const read = page.waitForResponse('**/api/customer-workspaces');
  await page.goto(origin + path);
  await page.waitForSelector('header.ux-app-header');
  await read;
}
async function openMenu(page: Page) {
  const avatar = page.getByRole('button', { name: 'Account menu', exact: true });
  await avatar.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Account menu', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByText('synthetic-alice@example.invalid')).toBeVisible();
  return menu;
}
const workspaceGroup = (menu: ReturnType<Page['getByRole']>) =>
  menu.getByRole('group', { name: 'Workspace', exact: true });
const railNew = (page: Page) => page.locator('a.ux-rail-new');
async function searchPages(page: Page) {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search Requests, Companies and pages' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Pages', exact: true }).click();
  const options = dialog.getByRole('option');
  await expect(options.first()).toBeVisible();
  const pages = await options.evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: node.querySelector('strong')?.textContent ?? '',
      href: node.getAttribute('href') ?? '',
    })),
  );
  await page.keyboard.press('Escape');
  return pages;
}
const menuAxe = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .include('[role="menu"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations.map((violation) => violation.id);

test('an archived workspace is absent from the account menu, the rail New Request and the search pages', async ({
  page,
}) => {
  await serve(page, {
    rows: [
      { id: archived, role: 'owner', archived: true },
      { id: active, role: 'owner', archived: false },
    ],
    versions: {},
  });
  await visit(page, '/account/move');
  const menu = await openMenu(page);
  const group = workspaceGroup(menu);
  await expect(group.getByRole('menuitem', { name: names[active], exact: true })).toHaveAttribute(
    'href',
    `/account/profile/${active}`,
  );
  await expect(group.getByText(names[archived]!)).toHaveCount(0);
  await expect(group.getByRole('menuitem', { name: 'Manage Workspaces' })).toHaveAttribute(
    'href',
    workHref,
  );
  // The one active workspace is the one whose profile Company Profile opens.
  await expect(
    menu.getByRole('menuitem', { name: 'Company Profile', exact: true }),
  ).toHaveAttribute('href', `/account/profile/${active}`);
  expect(await menuAxe(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(railNew(page)).toHaveAttribute('href', workHref);
  const pages = await searchPages(page);
  expect(pages.find((p) => p.label === 'New Request')?.href).toBe(workHref);
  expect(pages.map((p) => p.href).filter((href) => href.includes(archived))).toEqual([]);
});

test('with every workspace archived the menu says so, and New Request goes to the plan page', async ({
  page,
}) => {
  await serve(page, {
    rows: [
      { id: archived, role: 'owner', archived: true },
      { id: memberArchived, role: 'member', archived: true },
    ],
    versions: {},
  });
  await visit(page, '/account/move');
  const menu = await openMenu(page);
  const group = workspaceGroup(menu);
  await expect(group.getByText('All your workspaces are archived.', { exact: true })).toBeVisible();
  await expect(group.getByRole('menuitem')).toHaveText(['Manage Workspaces']);
  await expect(
    menu.getByRole('menuitem', { name: 'Company Profile', exact: true }),
  ).toHaveAttribute('href', '/account/profile');
  expect(await menuAxe(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(railNew(page)).toHaveAttribute('href', '/plan');
  const pages = await searchPages(page);
  expect(pages.find((p) => p.label === 'New Request')?.href).toBe('/plan');
  expect(pages.find((p) => p.label === 'Manage Workspaces')?.href).toBe(workHref);
});

test('/account keeps archived workspaces under Archived with the label, the owner restores one, and the menu lists it again', async ({
  page,
}) => {
  const world: World = {
    rows: [
      { id: active, role: 'owner', archived: false },
      { id: archived, role: 'owner', archived: true },
      { id: memberArchived, role: 'member', archived: true },
    ],
    versions: { [archived]: 4 },
  };
  await serve(page, world);
  await visit(page, '/account');
  const table = page.getByRole('table', { name: 'Your workspaces' });
  await expect(table).toBeVisible();
  await expect(page.getByRole('radio', { name: /Active/ })).toBeChecked();
  await expect(table.getByRole('row', { name: new RegExp(names[archived]!) })).toHaveCount(0);
  await page.getByRole('radio', { name: /Archived/ }).check();
  const row = table.getByRole('row', { name: new RegExp(names[archived]!) });
  await expect(row.locator('.ux-badge')).toHaveText('Archived');
  // A member of an archived workspace sees it labelled, with no Restore.
  await page.getByRole('button', { name: 'Actions for ' + names[memberArchived] }).click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('menuitem', { name: 'Restore Workspace' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'New Request' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The owner restores; the list's flag flips with it.
  await page.getByRole('button', { name: 'Actions for ' + names[archived] }).click();
  await page.getByRole('menuitem', { name: 'Restore Workspace' }).click();
  await page
    .getByRole('dialog', { name: 'Restore ' + names[archived] + '?' })
    .getByRole('button', { name: 'Restore Workspace' })
    .click();
  await expect(page.getByText(names[archived] + ' was restored.')).toBeVisible();
  await expect(table.getByRole('row', { name: new RegExp(names[archived]!) })).toHaveCount(0);
  await page.getByRole('radio', { name: /Active/ }).check();
  await expect(table.getByRole('row', { name: new RegExp(names[archived]!) })).toBeVisible();
  await expect(
    table.getByRole('row', { name: new RegExp(names[archived]!) }).locator('.ux-badge'),
  ).toHaveCount(0);
  // The next read of the menu lists it again.
  await visit(page, '/account/move');
  const menu = await openMenu(page);
  await expect(
    workspaceGroup(menu).getByRole('menuitem', { name: names[archived], exact: true }),
  ).toBeVisible();
});

test('on /account a restore and an archive change the menu and the rail New Request without a reload', async ({
  page,
}) => {
  const world: World = {
    rows: [
      { id: archived, role: 'owner', archived: true },
      { id: memberArchived, role: 'member', archived: true },
    ],
    versions: { [archived]: 4 },
  };
  await serve(page, world);
  await visit(page, '/account');
  let menu = await openMenu(page);
  await expect(
    workspaceGroup(menu).getByText('All your workspaces are archived.', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(railNew(page)).toHaveAttribute('href', '/plan');
  await page.getByRole('radio', { name: /Archived/ }).check();
  // Restore: the menu reads again and lists the workspace, with no reload.
  await page.getByRole('button', { name: 'Actions for ' + names[archived] }).click();
  await page.getByRole('menuitem', { name: 'Restore Workspace' }).click();
  const reread = page.waitForResponse('**/api/customer-workspaces');
  await page
    .getByRole('dialog', { name: 'Restore ' + names[archived] + '?' })
    .getByRole('button', { name: 'Restore Workspace' })
    .click();
  await expect(page.getByText(names[archived] + ' was restored.')).toBeVisible();
  await reread;
  menu = await openMenu(page);
  await expect(
    workspaceGroup(menu).getByRole('menuitem', { name: names[archived], exact: true }),
  ).toBeVisible();
  await expect(workspaceGroup(menu).getByText('All your workspaces are archived.')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(railNew(page)).toHaveAttribute('href', workHref);
  // Archive: it leaves the menu again, still with no reload.
  await page.getByRole('radio', { name: /Active/ }).check();
  await page.getByRole('button', { name: 'Actions for ' + names[archived] }).click();
  await page.getByRole('menuitem', { name: 'Archive Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive ' + names[archived] + '?' });
  await dialog.getByLabel('Type the workspace name to confirm').fill(names[archived]!);
  await dialog.getByRole('button', { name: 'Archive Workspace' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'was archived.' })).toBeVisible();
  menu = await openMenu(page);
  await expect(
    workspaceGroup(menu).getByText('All your workspaces are archived.', { exact: true }),
  ).toBeVisible();
  await expect(workspaceGroup(menu).getByText(names[archived]!)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(railNew(page)).toHaveAttribute('href', '/plan');
});

for (const width of [390, 768]) {
  test(`on an archived workspace's own page the menu shows it checked and labelled, with 44 pixel rows at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await serve(page, {
      rows: [
        { id: archived, role: 'owner', archived: true },
        { id: active, role: 'owner', archived: false },
        { id: memberArchived, role: 'member', archived: true },
      ],
      versions: {},
    });
    await visit(page, `/account/billing/${archived}`);
    const menu = await openMenu(page);
    const radios = workspaceGroup(menu).getByRole('menuitemradio');
    await expect(radios).toHaveCount(2);
    await expect(radios.nth(0)).toHaveAccessibleName(names[active]!);
    await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'false');
    await expect(radios.nth(1)).toHaveAccessibleName(`${names[archived]} Archived`);
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(radios.nth(1).locator('.ux-badge')).toHaveText('Archived');
    await expect(menu.getByText(names[memberArchived]!)).toHaveCount(0);
    // "Signed in as" names the workspace without the label.
    const who = menu.getByRole('group', { name: 'Signed in as' });
    await expect(who.getByText(names[archived]!, { exact: true })).toBeVisible();
    await expect(who.locator('.ux-badge')).toHaveCount(0);
    for (const target of await menu.locator('.ux-menu-row:visible').all())
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await menuAxe(page)).toEqual([]);
  });
}

test('an expired session draws no Workspace group, and New Request goes to the plan page', async ({
  page,
}) => {
  await serve(page, { rows: [], status: 401, versions: {} });
  await visit(page, '/account/move');
  const menu = await openMenu(page);
  await expect(workspaceGroup(menu)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(railNew(page)).toHaveAttribute('href', '/plan');
});
