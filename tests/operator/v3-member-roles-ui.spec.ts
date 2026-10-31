import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. Real restricted customer authority has separate database acceptance.
const issuer = 'https://ep-roles-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const owned = {
  id: randomUUID(),
  name: 'Synthetic owner team workspace',
  role: 'owner',
  synthetic: true,
  organisationId: null,
};
const joined = {
  id: randomUUID(),
  name: 'Synthetic joined colleague workspace',
  role: 'member',
  synthetic: true,
  organisationId: null,
};
type Member = {
  id: string;
  label: string;
  role: 'admin' | 'member';
  roleVersion?: number;
  createdAt: string;
  status: 'active';
};
const member = (name: string, over: Partial<Member> = {}): Member => ({
  id: randomUUID(),
  label: 'Synthetic ' + name,
  role: 'member',
  roleVersion: 0,
  createdAt: '2026-10-17T12:00:00.000Z',
  status: 'active',
  ...over,
});
const access = (id: string, memberships: Member[]) => ({
  workspaceId: id,
  ownerProtected: true,
  invitations: [],
  memberships,
  nextInvitationAfter: null as string | null,
  nextMemberAfter: null as string | null,
});
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {CustomerWorkspaces} from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
const q=new URLSearchParams(location.search),subject=q.get('subject')||'synthetic-alice',issuer=q.get('issuer')||${JSON.stringify(issuer)};
createRoot(document.getElementById('fixture')).render(<CustomerWorkspaces key={issuer+':'+subject} subject={subject} issuer={issuer} memberRolesEnabled={q.get('roles')!=='off'}/>);`,
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
    define: { 'process.env.NODE_ENV': '"production"' },
    metafile: true,
  });
  // The browser bundle must carry no server authority code.
  expect(Object.keys(result.metafile!.inputs).some((p) => p.includes('packages/auth/src'))).toBe(
    false,
  );
  const javascript = result.outputFiles[0].text,
    css = await readFile('apps/web/app/globals.css');
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic member role fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace"><h1>Synthetic member role fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>',
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
async function openOwnerTeam(page: Page, memberships: Member[], query = '') {
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [owned] } }),
  );
  await page.route('**/api/customer-workspace-access**', (route) =>
    route.fulfill({ json: access(owned.id, memberships) }),
  );
  await page.goto(origin + '/' + query);
  await page.getByText('Manage team', { exact: true }).click();
  return page.getByRole('region', { name: 'Team for ' + owned.name, exact: true });
}

test('an owner changes a role only after confirming, with one exact request, and the list reflects the new role', async ({
  page,
}) => {
  const people = [member('Dhaka buyer lead'), member('Dhaka finance lead')];
  const posts: Record<string, unknown>[] = [];
  const panel = await openOwnerTeam(page, people);
  await page.unroute('**/api/customer-workspace-access**');
  await page.route('**/api/customer-workspace-access**', (route) =>
    route.fulfill({ json: access(owned.id, people) }),
  );
  await page.route('**/api/customer-workspace-members', async (route) => {
    const request = route.request();
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    expect(new URL(request.url()).search).toBe('');
    const body = request.postDataJSON();
    posts.push(body);
    const target = people.find((p) => p.id === body.memberId)!;
    target.role = body.role;
    target.roleVersion = (target.roleVersion ?? 0) + 1;
    return route.fulfill({
      json: {
        workspaceId: owned.id,
        memberId: target.id,
        role: target.role,
        roleVersion: target.roleVersion,
      },
    });
  });
  await expect(
    panel.getByRole('button', { name: 'Make Synthetic Dhaka buyer lead an admin' }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Make Synthetic Dhaka buyer lead an admin' }).click();
  // Nothing is sent until the explicit confirmation.
  expect(posts).toHaveLength(0);
  await expect(panel.getByText(/An admin can edit the company profile/)).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include('main').analyze()).violations.map((v) => v.id),
  ).toEqual([]);
  await panel.getByRole('button', { name: 'Close role confirmation' }).click();
  expect(posts).toHaveLength(0);
  await panel.getByRole('button', { name: 'Make Synthetic Dhaka buyer lead an admin' }).click();
  await panel.getByRole('button', { name: 'Confirm admin role' }).click();
  await expect(panel.getByRole('status')).toContainText('The member is now an admin');
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'commandId',
    'expectedRole',
    'memberId',
    'role',
    'workspaceId',
  ]);
  expect(posts[0]).toMatchObject({
    action: 'set_role',
    workspaceId: owned.id,
    memberId: people[0]!.id,
    role: 'admin',
    expectedRole: 'member',
  });
  await expect(panel.getByText('Synthetic Dhaka buyer lead · admin · active')).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Make Synthetic Dhaka buyer lead a regular member' }),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Make Synthetic Dhaka finance lead an admin' }),
  ).toBeVisible();
});

test('role controls are absent without the flag, or when the module is not installed', async ({
  page,
}) => {
  const off = await openOwnerTeam(page, [member('Dhaka buyer lead')], '?roles=off');
  await expect(off.getByText('Synthetic Dhaka buyer lead · member · active')).toBeVisible();
  await expect(off.getByRole('button', { name: /Make Synthetic/ })).toHaveCount(0);
  await page.unroute('**/api/customer-workspace-access**');
  const legacy = member('Dhaka buyer lead');
  delete legacy.roleVersion;
  await page.route('**/api/customer-workspace-access**', (route) =>
    route.fulfill({ json: access(owned.id, [legacy]) }),
  );
  await page.goto(origin + '/');
  await page.getByText('Manage team', { exact: true }).click();
  const on = page.getByRole('region', { name: 'Team for ' + owned.name, exact: true });
  await expect(on.getByText('Synthetic Dhaka buyer lead · member · active')).toBeVisible();
  await expect(on.getByRole('button', { name: /Make Synthetic/ })).toHaveCount(0);
});

test('a stale role, an unavailable module and a lost owner right are each handled without false success', async ({
  page,
}) => {
  const people = [member('Dhaka buyer lead')];
  let status = 409;
  const panel = await openOwnerTeam(page, people);
  await page.route('**/api/customer-workspace-members', (route) =>
    route.fulfill({ status, json: { error: 'x' } }),
  );
  const ask = async () => {
    await panel.getByRole('button', { name: 'Make Synthetic Dhaka buyer lead an admin' }).click();
    await panel.getByRole('button', { name: 'Confirm admin role' }).click();
  };
  await ask();
  await expect(panel.getByRole('alert')).toContainText('already changed');
  await expect(panel.getByRole('status')).toHaveCount(0);
  // After a stale answer the list is reloaded and the confirmation is closed, so the owner starts again.
  status = 503;
  await ask();
  await expect(panel.getByRole('alert')).toContainText('Team role changes are unavailable');
  // A failure that is not confirmed keeps the same confirmation open for an identical retry.
  status = 500;
  await panel.getByRole('button', { name: 'Confirm admin role' }).click();
  await expect(panel.getByRole('alert')).toContainText('not confirmed');
  status = 403;
  await panel.getByRole('button', { name: 'Confirm admin role' }).click();
  await expect(page.getByRole('region', { name: /Team for/ })).toHaveCount(0);
  await expect(page.getByText('Your account or saved request changed.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reload account' })).toBeVisible();
});

test('a retried role change reuses the same command id', async ({ page }) => {
  const people = [member('Dhaka buyer lead')];
  const ids: string[] = [];
  const panel = await openOwnerTeam(page, people);
  let fail = true;
  await page.route('**/api/customer-workspace-members', async (route) => {
    ids.push(route.request().postDataJSON().commandId);
    if (fail) return route.fulfill({ status: 500, json: { error: 'x' } });
    return route.fulfill({
      json: { workspaceId: owned.id, memberId: people[0]!.id, role: 'admin', roleVersion: 1 },
    });
  });
  await panel.getByRole('button', { name: 'Make Synthetic Dhaka buyer lead an admin' }).click();
  await panel.getByRole('button', { name: 'Confirm admin role' }).click();
  await expect(panel.getByRole('alert')).toContainText('not confirmed');
  fail = false;
  await panel.getByRole('button', { name: 'Confirm admin role' }).click();
  await expect(panel.getByRole('status')).toContainText('The member is now an admin');
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

test('a malformed role response is not shown as success', async ({ page }) => {
  const people = [member('Dhaka buyer lead')];
  const panel = await openOwnerTeam(page, people);
  await page.route('**/api/customer-workspace-members', (route) =>
    route.fulfill({
      json: { workspaceId: owned.id, memberId: randomUUID(), role: 'admin', roleVersion: 1 },
    }),
  );
  await panel.getByRole('button', { name: 'Make Synthetic Dhaka buyer lead an admin' }).click();
  await panel.getByRole('button', { name: 'Confirm admin role' }).click();
  await expect(panel.getByRole('alert')).toContainText('not confirmed');
  await expect(panel.getByRole('status')).toHaveCount(0);
});

test('a non-owner confirms before leaving, sends one exact request, and the workspace disappears', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [joined] } }),
  );
  await page.route('**/api/customer-workspace-members', (route) => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({
      json: { workspaceId: joined.id, memberId: randomUUID(), status: 'left' },
    });
  });
  await page.goto(origin + '/');
  await expect(page.getByText(joined.name + ' · member')).toBeVisible();
  // The owner-only team section is not offered to a member.
  await expect(page.getByText('Manage team')).toHaveCount(0);
  await page.getByRole('button', { name: 'Leave ' + joined.name }).click();
  expect(posts).toHaveLength(0);
  await expect(page.getByText(/You lose access to it straight away/)).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include('main').analyze()).violations.map((v) => v.id),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Keep my access' }).click();
  expect(posts).toHaveLength(0);
  await page.getByRole('button', { name: 'Leave ' + joined.name }).click();
  await page.getByRole('button', { name: 'Confirm leaving' }).click();
  await expect(page.getByText('No workspaces yet. Create your first one below.')).toBeVisible();
  await expect(page.getByText('You have left the workspace')).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual(['action', 'commandId', 'workspaceId']);
  expect(posts[0]).toMatchObject({ action: 'leave', workspaceId: joined.id });
});

test('leaving is retried with the same command, an unconfirmed leave keeps the workspace, and the owner and flag-off views offer no leave', async ({
  page,
}) => {
  const ids: string[] = [];
  let status = 500;
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [joined] } }),
  );
  await page.route('**/api/customer-workspace-members', (route) => {
    ids.push(route.request().postDataJSON().commandId);
    return status === 200
      ? route.fulfill({ json: { workspaceId: joined.id, memberId: randomUUID(), status: 'left' } })
      : route.fulfill({ status, json: { error: 'x' } });
  });
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Leave ' + joined.name }).click();
  await page.getByRole('button', { name: 'Confirm leaving' }).click();
  await expect(page.getByRole('alert')).toContainText('Leaving was not confirmed');
  await expect(page.getByText(joined.name + ' · member')).toBeVisible();
  status = 503;
  await page.getByRole('button', { name: 'Confirm leaving' }).click();
  await expect(page.getByRole('alert')).toContainText('unavailable');
  status = 200;
  await page.getByRole('button', { name: 'Confirm leaving' }).click();
  await expect(page.getByText('No workspaces yet. Create your first one below.')).toBeVisible();
  expect(new Set(ids).size).toBe(1);
  expect(ids).toHaveLength(3);
  // Flag off: no leave control for a member.
  await page.goto(origin + '/?roles=off');
  await expect(page.getByText(joined.name + ' · member')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Leave / })).toHaveCount(0);
  // The owner never gets a leave control.
  await page.unroute('**/api/customer-workspaces');
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [owned] } }),
  );
  await page.goto(origin + '/');
  await expect(page.getByText(owned.name + ' · owner')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Leave / })).toHaveCount(0);
});

test('a leave answered with access denied is not shown as a completed leave', async ({ page }) => {
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [joined] } }),
  );
  await page.route('**/api/customer-workspace-members', (route) =>
    route.fulfill({ status: 403, json: { error: 'x' } }),
  );
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Leave ' + joined.name }).click();
  await page.getByRole('button', { name: 'Confirm leaving' }).click();
  await expect(
    page.getByText('Your access could not be confirmed. Reload your account'),
  ).toBeVisible();
  await expect(page.getByText('You have left the workspace')).toHaveCount(0);
});
