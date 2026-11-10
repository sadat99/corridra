import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Navigation v1, the customer avatar menu (UtilityMenus board), with the owner's direction of 10 Nov 2026: menu
// items that can be real are real. With the organisation profiles module on, Company Profile always opens a
// profile: the chosen workspace's, or else the workspace chooser at /account/profile. With the module off it stays
// plain text tagged Coming soon, and the workspace names are plain text, never links to an unavailable profile.
// The menu is mounted as a fixture with explicit protocol answers; the profile pages check access on the server.
const first = '00000000-0000-4000-8000-0000000000a1';
const second = '00000000-0000-4000-8000-0000000000a2';
const workspaces = [
  { id: first, name: 'Synthetic Dhaka Knits' },
  { id: second, name: 'Synthetic Chattogram Dyers' },
];
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {AvatarMenu} from ${JSON.stringify(resolve('apps/web/components/ux/utility-menus.tsx'))};
import {setCustomerOrganisationProfiles} from ${JSON.stringify(resolve('apps/web/components/ux/customer-bar-store.ts'))};
setCustomerOrganisationProfiles(new URLSearchParams(location.search).get('profiles')==='on');
const router={push:path=>location.assign(path),replace:path=>location.replace(path),back:()=>history.back(),forward:()=>history.forward(),refresh:()=>{},hmrRefresh:()=>{},prefetch:async()=>{}};
createRoot(document.getElementById('fixture')).render(<AppRouterContext.Provider value={router}><AvatarMenu active/></AppRouterContext.Provider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    metafile: true,
  });
  // The browser bundle must carry no server authority code.
  expect(Object.keys(result.metafile!.inputs).some((p) => p.includes('packages/auth/src'))).toBe(
    false,
  );
  const javascript = result.outputFiles[0].text;
  // The tokens and the menu's own styles, so the accessibility check sees the real colours and sizes.
  const css = (
    await Promise.all(
      [
        'apps/web/app/globals.css',
        'apps/web/components/ux/overflow-menu.css',
        'apps/web/components/ux/customer-bar.css',
        'apps/web/components/ux/utility-menus.css',
      ].map((path) => readFile(path, 'utf8')),
    )
  ).join('\n');
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(css);
    } else if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic avatar menu fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><header class="ux-customer-header"><div id="fixture"></div></header><main id="main" tabindex="-1"><h1>Synthetic avatar menu fixture</h1></main><script type="module" src="/fixture.js"></script></body></html>',
      );
    } else if (path.startsWith('/account/profile')) {
      // Where the menu leads; the real page checks the session and the workspace on the server.
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><head><title>Synthetic company profile destination</title></head><body><main><h1>Synthetic company profile destination</h1></main></body></html>',
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

type Answer = { list: typeof workspaces } | { status: number } | 'pending';
/** Mounts the menu with the profiles module on or off and the workspaces read answering as told, then opens it. */
async function openMenu(page: Page, profiles: 'on' | 'off', answer: Answer) {
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({
      json: { user: { name: 'Synthetic Alice', email: 'synthetic-alice@example.invalid' } },
    }),
  );
  let answered = false;
  await page.route('**/api/customer-workspaces', (route) => {
    // A read that never answers: the list is still loading when the menu opens.
    if (answer === 'pending') return;
    answered = true;
    return 'status' in answer
      ? route.fulfill({ status: answer.status, json: { error: 'Service unavailable' } })
      : route.fulfill({ json: { synthetic: true, workspaces: answer.list } });
  });
  await page.goto(`${origin}/?profiles=${profiles}`);
  if (answer !== 'pending') await expect.poll(() => answered).toBe(true);
  // Keyboard: focus the avatar and open the menu with the arrow key, as the overflow menu offers.
  const avatar = page.getByRole('button', { name: 'Account menu', exact: true });
  await avatar.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Account menu', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByText('synthetic-alice@example.invalid')).toBeVisible();
  return menu;
}
const companyProfile = (menu: ReturnType<Page['getByRole']>) =>
  menu.getByRole('menuitem', { name: 'Company Profile', exact: true });
const profileHrefs = (menu: ReturnType<Page['getByRole']>) =>
  menu
    .getByRole('menuitem')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('href'))
        .filter((href): href is string => !!href && href.startsWith('/account/profile')),
    );
/** Axe on the open menu. best-practice brings aria-allowed-role; with aria-required-children it judges the text in the group. */
async function axeIds(page: Page) {
  const result = await new AxeBuilder({ page })
    .include('[role="menu"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const passed = result.passes.map((rule) => rule.id);
  expect(passed).toContain('aria-required-children');
  expect(passed).toContain('aria-allowed-role');
  return result.violations.map((violation) => violation.id);
}

test('profiles on, two workspaces off a workspace page: Company Profile opens the chooser, and each workspace its profile', async ({
  page,
}) => {
  const menu = await openMenu(page, 'on', { list: workspaces });
  const entry = companyProfile(menu);
  await expect(entry).toHaveAttribute('href', '/account/profile');
  await expect(entry).not.toHaveAttribute('aria-disabled', /.*/);
  await expect(entry).toHaveAccessibleName('Company Profile');
  await expect(entry.getByText('Coming soon')).toHaveCount(0);
  const group = menu.getByRole('group', { name: 'Workspace', exact: true });
  for (const w of workspaces)
    await expect(group.getByRole('menuitem', { name: w.name, exact: true })).toHaveAttribute(
      'href',
      `/account/profile/${w.id}`,
    );
  await expect(group.getByRole('menuitem', { name: 'Manage Workspaces' })).not.toHaveAttribute(
    'aria-describedby',
    /.*/,
  );
  expect(await axeIds(page)).toEqual([]);
  // The keyboard reaches it with the arrows, and Enter opens the chooser.
  for (let step = 0; step < 6; step += 1) {
    if (await entry.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(entry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${origin}/account/profile`);
  await expect(
    page.getByRole('heading', { name: 'Synthetic company profile destination' }),
  ).toBeVisible();
});

test('profiles on, one workspace: Company Profile opens that workspace profile', async ({
  page,
}) => {
  const menu = await openMenu(page, 'on', { list: [workspaces[0]!] });
  await expect(companyProfile(menu)).toHaveAttribute('href', `/account/profile/${first}`);
});

test('profiles on, no workspace yet: Company Profile opens the chooser', async ({ page }) => {
  const menu = await openMenu(page, 'on', { list: [] });
  await expect(companyProfile(menu)).toHaveAttribute('href', '/account/profile');
  await expect(menu.getByRole('group', { name: 'Workspace', exact: true })).toHaveCount(0);
});

test('profiles on, the workspaces read fails: Company Profile still opens the chooser', async ({
  page,
}) => {
  const menu = await openMenu(page, 'on', { status: 503 });
  await expect(companyProfile(menu)).toHaveAttribute('href', '/account/profile');
  await expect(companyProfile(menu)).not.toHaveAttribute('aria-disabled', /.*/);
});

test('profiles on, the workspaces read is still loading: Company Profile already opens the chooser', async ({
  page,
}) => {
  const menu = await openMenu(page, 'on', 'pending');
  await expect(companyProfile(menu)).toHaveAttribute('href', '/account/profile');
  await expect(companyProfile(menu)).not.toHaveAttribute('aria-disabled', /.*/);
});

test('profiles off, two workspaces: Company Profile is Coming soon and no profile is offered', async ({
  page,
}) => {
  const menu = await openMenu(page, 'off', { list: workspaces });
  // The row as it has always been: plain text with its tag, so its name carries the tag too.
  const entry = menu.getByRole('menuitem', { name: 'Company Profile Coming soon', exact: true });
  await expect(entry).toHaveAttribute('aria-disabled', 'true');
  await expect(entry).not.toHaveAttribute('href', /.*/);
  await expect(entry.getByText('Coming soon', { exact: true })).toBeVisible();
  expect(await profileHrefs(menu)).toEqual([]);
  // The names are plain text in the Workspace group, and they describe the one Manage Workspaces link.
  const group = menu.getByRole('group', { name: 'Workspace', exact: true });
  for (const w of workspaces) {
    await expect(group.getByText(w.name, { exact: true })).toBeVisible();
    await expect(group.getByRole('menuitem', { name: w.name })).toHaveCount(0);
  }
  const manage = group.getByRole('menuitem', { name: 'Manage Workspaces', exact: true });
  await expect(manage).toHaveAttribute('href', '/account?view=work#customer-workspaces');
  await expect(manage).toHaveAccessibleDescription(
    'Synthetic Dhaka Knits Synthetic Chattogram Dyers',
  );
  // The arrows move over links only: the plain names are never focused.
  const focused: string[] = [];
  for (let step = 0; step < 4; step += 1) {
    focused.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
    await page.keyboard.press('ArrowDown');
  }
  expect(focused[0]).toBe('Manage Workspaces');
  expect(focused).not.toContain('Synthetic Dhaka Knits');
  expect(await axeIds(page)).toEqual([]);
});
