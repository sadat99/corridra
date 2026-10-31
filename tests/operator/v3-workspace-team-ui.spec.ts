import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. Real restricted customer authority has separate DB acceptance.
const issuer = 'https://ep-owner-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const token = 'T'.repeat(43),
  expiry = '2026-10-18T12:00:00.000Z';
const owner = {
  id: randomUUID(),
  name: 'Synthetic owner team workspace',
  role: 'owner',
  synthetic: true,
  organisationId: null,
};
const invitation = (name: string) => ({
  id: randomUUID(),
  label: 'Synthetic ' + name,
  expiresAt: expiry,
  memberId: null,
  status: 'pending',
});
const member = (name: string) => ({
  id: randomUUID(),
  label: 'Synthetic ' + name,
  role: 'member',
  createdAt: '2026-10-17T12:00:00.000Z',
  status: 'active',
});
const access = (
  id: string = owner.id,
  invitations: ReturnType<typeof invitation>[] = [],
  memberships: ReturnType<typeof member>[] = [],
) => ({
  workspaceId: id,
  ownerProtected: true,
  invitations,
  memberships,
  nextInvitationAfter: null as string | null,
  nextMemberAfter: null as string | null,
});
let server: Server, origin: string;
test.beforeAll(async () => {
  const baseline = execFileSync(
    'git',
    [
      'show',
      'd8f843f751d0c5029e60af0b1a9e44db762e6544:apps/web/app/account/customer-workspaces.tsx',
    ],
    { encoding: 'utf8' },
  );
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {CustomerWorkspaces} from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
import {CustomerWorkspaces as Baseline} from 'v3-team-baseline';
const q=new URLSearchParams(location.search),subject=q.get('subject')||'synthetic-alice',issuer=q.get('issuer')||${JSON.stringify(issuer)},Component=q.get('view')==='baseline'?Baseline:CustomerWorkspaces;
createRoot(document.getElementById('fixture')).render(<Component key={issuer+':'+subject} subject={subject} issuer={issuer}/>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    plugins: [
      {
        name: 'immutable-team-before',
        setup(builder) {
          builder.onResolve({ filter: /^v3-team-baseline$/ }, () => ({
            path: 'baseline',
            namespace: 'v3-before',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'v3-before' }, () => ({
            contents: baseline,
            loader: 'tsx',
            resolveDir: resolve('apps/web/app/account'),
          }));
        },
      },
    ],
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic team component fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic team component fixture</h1><div id="fixture"></div><section id="customer-missions"><h2>Existing shared mission section</h2></section></main><script type="module" src="/fixture.js"></script></body></html>',
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

test('owner team UI issues one-time codes, confirms cancellation and revocation, preserves history and supports keyboard/responsive access', async ({
  page,
}) => {
  const invitations = [invitation('existing invitation')],
    memberships = [member('existing member')];
  const posts: Record<string, string>[] = [];
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [owner] } }),
  );
  await page.route('**/api/customer-workspace-access**', async (route) => {
    const request = route.request();
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    if (request.method() === 'GET') {
      expect(new URL(request.url()).searchParams.get('workspaceId')).toBe(owner.id);
      return route.fulfill({ json: access(owner.id, invitations, memberships) });
    }
    const body = request.postDataJSON();
    posts.push(body);
    expect(body.workspaceId).toBe(owner.id);
    expect(new URL(request.url()).search).toBe('');
    if (body.action === 'invite') {
      expect(Object.keys(body).sort()).toEqual(['action', 'commandId', 'label', 'workspaceId']);
      const record = invitation(body.label.slice('Synthetic '.length));
      invitations.push(record);
      return route.fulfill({
        json: {
          workspaceId: owner.id,
          invitationId: record.id,
          expiresAt: expiry,
          issued: true,
          token,
        },
      });
    }
    expect(body.action).toBe('revoke');
    expect(Object.keys(body).sort()).toEqual([
      'action',
      'commandId',
      'kind',
      'targetId',
      'workspaceId',
    ]);
    if (body.kind === 'invitation') {
      const record = invitations.find((r) => r.id === body.targetId)!;
      expect(!!record).toBe(true);
      record.status = 'cancelled';
      return route.fulfill({
        json: { workspaceId: owner.id, invitationId: record.id, status: 'cancelled' },
      });
    }
    const record = memberships.find((r) => r.id === body.targetId)!;
    expect(!!record).toBe(true);
    record.status = 'revoked';
    return route.fulfill({
      json: { workspaceId: owner.id, memberId: record.id, status: 'revoked' },
    });
  });
  const folder = '.cache/v3-owner-team-ui/after';
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + '?view=baseline');
    await expect(page.getByText(owner.name, { exact: true })).toBeVisible();
    await page.screenshot({ path: `${folder}/before-${width}.png`, fullPage: true });
    await page.goto(origin);
    await page.getByText('Manage team', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Synthetic existing invitation', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${folder}/after-${width}.png`, fullPage: true });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  const panel = page.getByRole('region', { name: 'Team for ' + owner.name, exact: true });
  await panel.getByLabel('Sample invitation label', { exact: true }).fill('new teammate');
  await panel.getByRole('button', { name: 'Issue sample invitation', exact: true }).click();
  await expect(panel.getByLabel('New workspace invitation code', { exact: true })).toBeVisible();
  expect(
    (await panel.getByLabel('New workspace invitation code', { exact: true }).inputValue()) ===
      token,
  ).toBe(true);
  await expect(
    panel.getByRole('button', { name: 'Issue sample invitation', exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => Object.keys(sessionStorage).length + Object.keys(localStorage).length,
    ),
  ).toBe(0);
  await panel.getByRole('button', { name: 'Clear new invitation code', exact: true }).click();
  const cancel = panel.getByRole('button', {
    name: 'Cancel invitation for Synthetic new teammate',
    exact: true,
  });
  await cancel.click();
  expect(posts.length).toBe(1);
  await panel.getByRole('button', { name: 'Close confirmation', exact: true }).click();
  expect(posts.length).toBe(1);
  await cancel.click();
  await panel.getByRole('button', { name: 'Confirm invitation cancellation', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('invitation is cancelled');
  expect(invitations.length).toBe(2);
  expect(invitations[1].status).toBe('cancelled');
  await expect(panel.getByText('Synthetic new teammate', { exact: true })).toBeVisible();
  await panel
    .getByRole('button', {
      name: 'Remove invited membership for Synthetic existing member',
      exact: true,
    })
    .click();
  await panel.getByRole('button', { name: 'Confirm membership removal', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('membership is revoked');
  await expect(
    panel.getByRole('button', {
      name: 'Remove invited membership for Synthetic existing member',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(panel.getByText('Synthetic existing member', { exact: true })).toBeVisible();
  expect(posts.length).toBe(3);
  expect(memberships.length).toBe(1);
  expect(memberships[0].status).toBe('revoked');
  await expect(page.getByText(owner.name, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Existing shared mission section', exact: true }),
  ).toBeVisible();
});

test('lost issuance retries after reload without recovering a secret, and a new confirmed code survives failed history refresh', async ({
  page,
}) => {
  const invitations: ReturnType<typeof invitation>[] = [],
    commands: string[] = [];
  let failHistory = false;
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [owner] } }),
  );
  await page.route('**/api/customer-workspace-access**', async (route) => {
    if (route.request().method() === 'GET') {
      if (failHistory) {
        failHistory = false;
        return route.fulfill({ status: 500, json: { error: 'Synthetic history failure' } });
      }
      return route.fulfill({ json: access(owner.id, invitations) });
    }
    const body = route.request().postDataJSON();
    if (body.action === 'revoke') {
      const record = invitations.find((i) => i.id === body.targetId)!;
      record.status = 'cancelled';
      return route.fulfill({
        json: { workspaceId: owner.id, invitationId: record.id, status: 'cancelled' },
      });
    }
    commands.push(body.commandId);
    if (commands.length === 1) {
      invitations.push(invitation('lost response'));
      return route.abort('failed');
    }
    if (commands.length === 2)
      return route.fulfill({
        json: {
          workspaceId: owner.id,
          invitationId: invitations[0].id,
          expiresAt: expiry,
          issued: false,
          token: null,
        },
      });
    const record = invitation('new confirmed code');
    invitations.push(record);
    failHistory = true;
    return route.fulfill({
      json: {
        workspaceId: owner.id,
        invitationId: record.id,
        expiresAt: expiry,
        issued: true,
        token,
      },
    });
  });
  await page.goto(origin);
  await page.getByText('Manage team', { exact: true }).click();
  let panel = page.getByRole('region', { name: 'Team for ' + owner.name, exact: true });
  await panel.getByLabel('Sample invitation label', { exact: true }).fill('lost response');
  await panel.getByRole('button', { name: 'Issue sample invitation', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Issuing was not confirmed');
  expect(await page.evaluate((code) => JSON.stringify(sessionStorage).includes(code), token)).toBe(
    false,
  );
  await page.reload();
  await page.getByText('Manage team', { exact: true }).click();
  panel = page.getByRole('region', { name: 'Team for ' + owner.name, exact: true });
  await expect(panel.getByLabel('Sample invitation label', { exact: true })).toHaveValue(
    'lost response',
  );
  await panel.getByRole('button', { name: 'Retry issuing invitation', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('code cannot be retrieved');
  await expect(panel.getByLabel('New workspace invitation code', { exact: true })).toHaveCount(0);
  expect(commands.length).toBe(2);
  expect(commands[0] === commands[1]).toBe(true);
  expect(invitations.length).toBe(1);
  await panel
    .getByRole('button', { name: 'Cancel invitation for Synthetic lost response', exact: true })
    .click();
  await panel.getByRole('button', { name: 'Confirm invitation cancellation', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('invitation is cancelled');
  await panel.getByLabel('Sample invitation label', { exact: true }).fill('new confirmed code');
  await panel.getByRole('button', { name: 'Issue sample invitation', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Team access could not be loaded');
  expect(
    (await panel.getByLabel('New workspace invitation code', { exact: true }).inputValue()) ===
      token,
  ).toBe(true);
  expect(commands[2] === commands[0]).toBe(false);
  expect(invitations.length).toBe(2);
  expect(await page.evaluate(() => Object.keys(sessionStorage).length)).toBe(0);
  await panel.getByRole('button', { name: 'Retry loading team access', exact: true }).click();
  await expect(panel.getByText('Synthetic new confirmed code', { exact: true })).toBeVisible();
  expect(
    (await panel.getByLabel('New workspace invitation code', { exact: true }).inputValue()) ===
      token,
  ).toBe(true);
});

test('members and admins receive no owner controls; denied or malformed owner views never expose actionable history', async ({
  page,
}) => {
  let role = 'member',
    calls = 0,
    response: unknown = access(),
    status = 200;
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [{ ...owner, role }] } }),
  );
  await page.route('**/api/customer-workspace-access**', (route) => {
    calls++;
    return route.fulfill({ status, json: response });
  });
  for (role of ['member', 'admin']) {
    await page.goto(origin);
    await expect(page.getByText(owner.name, { exact: true })).toBeVisible();
    await expect(page.getByText('Manage team', { exact: true })).toHaveCount(0);
  }
  expect(calls).toBe(0);
  role = 'owner';
  for (status of [401, 403, 409, 503]) {
    await page.goto(origin);
    await page.getByText('Manage team', { exact: true }).click();
    await expect(page.getByText(owner.name, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Issue sample invitation', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Existing shared mission section', exact: true }),
    ).toBeVisible();
  }
  status = 200;
  for (response of [
    { ...access(), workspaceId: randomUUID() },
    { ...access(), ownerProtected: false },
    { ...access(), memberships: [{ ...member('forged owner'), role: 'owner' }] },
  ]) {
    await page.goto(origin);
    await page.getByText('Manage team', { exact: true }).click();
    const panel = page.getByRole('region', { name: 'Team for ' + owner.name, exact: true });
    await expect(panel.getByRole('alert')).toContainText('Team access could not be loaded');
    await expect(
      panel.getByRole('button', { name: 'Issue sample invitation', exact: true }),
    ).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /Remove invited membership/ })).toHaveCount(0);
  }
});

test('blocked browser storage sends no invitation, and malformed acknowledgement cannot display a code or success', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    let allow = false;
    Storage.prototype.setItem = function (...args) {
      if (!allow) throw Error('Synthetic blocked storage');
      return original.apply(this, args);
    };
    Reflect.set(window, 'allowSyntheticInviteStorage', () => {
      allow = true;
    });
  });
  let posts = 0;
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [owner] } }),
  );
  await page.route('**/api/customer-workspace-access**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: access() });
    posts++;
    return route.fulfill({
      json: {
        workspaceId: randomUUID(),
        invitationId: randomUUID(),
        expiresAt: expiry,
        issued: true,
        token,
      },
    });
  });
  await page.goto(origin);
  await page.getByText('Manage team', { exact: true }).click();
  const panel = page.getByRole('region', { name: 'Team for ' + owner.name, exact: true });
  await panel.getByLabel('Sample invitation label', { exact: true }).fill('blocked request');
  await panel.getByRole('button', { name: 'Issue sample invitation', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('No invitation request was sent');
  expect(posts).toBe(0);
  await page.evaluate(() => Reflect.get(window, 'allowSyntheticInviteStorage')());
  await panel
    .getByRole('button', { name: 'Discard invitation retry details', exact: true })
    .click();
  await panel.getByLabel('Sample invitation label', { exact: true }).fill('malformed response');
  await panel.getByRole('button', { name: 'Issue sample invitation', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Issuing was not confirmed');
  expect(posts).toBe(1);
  await expect(panel.getByLabel('New workspace invitation code', { exact: true })).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: 'Retry issuing invitation', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate((code) => JSON.stringify(sessionStorage).includes(code), token)).toBe(
    false,
  );
});

test('independent history cursors and saved invitation requests remain scoped to workspace and identity', async ({
  page,
}) => {
  const other = { ...owner, id: randomUUID(), name: 'Synthetic other team workspace' },
    bob = { ...owner, id: randomUUID(), name: 'Synthetic Bob workspace' };
  const inv1 = invitation('first page'),
    inv2 = invitation('second page'),
    mem1 = member('first member'),
    mem2 = member('second member');
  const invitationAfter = randomUUID(),
    memberAfter = randomUUID(),
    posts: { workspaceId: string; commandId: string }[] = [];
  let currentSubject = 'synthetic-alice',
    currentIssuer = issuer;
  await page.route('**/api/customer-workspaces', (route) => {
    expect(route.request().headers()['x-corridra-customer-subject']).toBe(currentSubject);
    return route.fulfill({
      json: {
        synthetic: true,
        workspaces: currentSubject === 'synthetic-alice' ? [owner, other] : [bob],
      },
    });
  });
  await page.route('**/api/customer-workspace-access**', (route) => {
    const request = route.request();
    expect(request.headers()['x-corridra-customer-subject']).toBe(currentSubject);
    expect(request.headers()['x-corridra-customer-issuer']).toBe(currentIssuer);
    if (request.method() === 'POST') {
      posts.push(request.postDataJSON());
      return route.abort('failed');
    }
    const q = new URL(request.url()).searchParams,
      id = q.get('workspaceId')!;
    if (id !== owner.id) return route.fulfill({ json: access(id) });
    const next = access(
      id,
      q.get('invitationAfter') ? [inv2] : [inv1],
      q.get('memberAfter') ? [mem2] : [mem1],
    );
    next.nextInvitationAfter = q.get('invitationAfter') ? null : invitationAfter;
    next.nextMemberAfter = q.get('memberAfter') ? null : memberAfter;
    if (q.get('memberAfter')) expect(q.get('invitationAfter')).toBe(invitationAfter);
    return route.fulfill({ json: next });
  });
  await page.goto(origin);
  await page
    .getByRole('listitem')
    .filter({ has: page.getByText(owner.name, { exact: true }) })
    .getByText('Manage team', { exact: true })
    .click();
  const first = page.getByRole('region', { name: 'Team for ' + owner.name, exact: true });
  await first.getByRole('button', { name: 'Next invitations', exact: true }).click();
  await expect(first.getByText(inv2.label, { exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Next invited members', exact: true }).click();
  await expect(first.getByText(mem2.label, { exact: true })).toBeVisible();
  await expect(first.getByText(inv2.label, { exact: true })).toBeVisible();
  await first.getByLabel('Sample invitation label', { exact: true }).fill('Alice first pending');
  await first.getByRole('button', { name: 'Issue sample invitation', exact: true }).click();
  await expect(first.getByRole('alert')).toContainText('Issuing was not confirmed');
  await page
    .getByRole('listitem')
    .filter({ has: page.getByText(other.name, { exact: true }) })
    .getByText('Manage team', { exact: true })
    .click();
  const second = page.getByRole('region', { name: 'Team for ' + other.name, exact: true });
  await second.getByLabel('Sample invitation label', { exact: true }).fill('Alice second pending');
  await second.getByRole('button', { name: 'Issue sample invitation', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('Issuing was not confirmed');
  expect(posts.length).toBe(2);
  expect(posts[0].workspaceId).toBe(owner.id);
  expect(posts[1].workspaceId).toBe(other.id);
  expect(posts[0].commandId === posts[1].commandId).toBe(false);
  expect(await page.evaluate(() => Object.keys(sessionStorage).length)).toBe(2);
  currentSubject = 'synthetic-bob';
  currentIssuer = issuer.replace('ep-owner-ui-fixture', 'ep-other');
  await page.goto(
    origin + '?subject=' + currentSubject + '&issuer=' + encodeURIComponent(currentIssuer),
  );
  await page.getByText('Manage team', { exact: true }).click();
  const next = page.getByRole('region', { name: 'Team for ' + bob.name, exact: true });
  await expect(next.getByLabel('Sample invitation label', { exact: true })).toBeEmpty();
  await expect(
    next.getByRole('button', { name: 'Retry issuing invitation', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(owner.name, { exact: true })).toHaveCount(0);
  expect(posts.length).toBe(2);
});
