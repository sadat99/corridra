import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit component protocol fixtures, not actual provider, email or database acceptance.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const token = 'A'.repeat(43);
const workspace = {
  id: randomUUID(),
  name: 'Synthetic invited workspace',
  role: 'member',
  synthetic: true,
  organisationId: null,
};
const joined = {
  workspaceId: workspace.id,
  memberId: randomUUID(),
  invitationId: randomUUID(),
  workspace,
};
let server: Server, origin: string;
test.beforeAll(async () => {
  const baseline = execFileSync(
    'git',
    [
      'show',
      '2a0055f5e21674a47bd3a38b1f38c8b055d2c153:apps/web/app/account/customer-workspaces.tsx',
    ],
    { encoding: 'utf8' },
  );
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {CustomerWorkspaces} from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
import {CustomerWorkspaces as Baseline} from 'v3-invitation-baseline';
const params=new URLSearchParams(location.search),subject=params.get('subject')||'synthetic-alice',issuer=params.get('issuer')||${JSON.stringify(issuer)};
const Component=params.get('view')==='baseline'?Baseline:CustomerWorkspaces;
createRoot(document.getElementById('fixture')).render(<Component key={issuer+':'+subject} subject={subject} issuer={issuer}/>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    plugins: [
      {
        name: 'immutable-before-view',
        setup(builder) {
          builder.onResolve({ filter: /^v3-invitation-baseline$/ }, () => ({
            path: 'baseline',
            namespace: 'v3-before',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'v3-before' }, () => ({
            contents: baseline,
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic invitation component fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic invitation component fixture</h1><div id="fixture"></div><section id="customer-missions"><h2>Existing shared mission section</h2></section></main><script type="module" src="/fixture.js"></script></body></html>',
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

test('invitation UI preserves one command after lost acknowledgement, supports keyboard and responsive access, and never stores the code', async ({
  page,
}) => {
  const records: (typeof workspace)[] = [],
    posts: { commandId: string; token: string }[] = [];
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: records } }),
  );
  await page.route('**/api/customer-workspace-access', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    expect(new URL(request.url()).search).toBe('');
    const body = request.postDataJSON();
    expect(Object.keys(body).sort()).toEqual(['action', 'commandId', 'token']);
    expect(body.action).toBe('accept');
    expect(body.token === token).toBe(true);
    posts.push(body);
    if (posts.length === 1) {
      await firstResponse;
      records.push(workspace);
      await route.abort('failed');
    } else await route.fulfill({ json: joined });
  });
  const directory = '.cache/v3-invitation-ui/after';
  await mkdir(directory, { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + '?view=baseline');
    await expect(page.getByText('No test workspaces yet.', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${directory}/before-${width}.png`, fullPage: true });
    await page.goto(origin);
    const summary = page.getByText('Join a workspace', { exact: true });
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Workspace invitation code', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${directory}/after-${width}.png`, fullPage: true });
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
  await page.getByLabel('Workspace invitation code', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Join workspace', exact: true }).click();
  try {
    await expect.poll(() => posts.length).toBe(1);
    await expect(page.getByRole('button', { name: 'Please wait…', exact: true })).toBeDisabled();
    await page
      .getByRole('form', { name: 'Accept a workspace invitation', exact: true })
      .evaluate((form) => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    expect(posts.length).toBe(1);
  } finally {
    releaseFirst();
  }
  await expect(page.getByRole('alert')).toContainText('Joining was not confirmed');
  expect(posts.length).toBe(1);
  await expect(page.getByLabel('Workspace invitation code', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  expect(
    await page.evaluate(
      () => Object.keys(sessionStorage).length + Object.keys(localStorage).length,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: 'Retry joining workspace', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('You have joined the workspace.');
  expect(posts.length).toBe(2);
  expect(posts[0].commandId === posts[1].commandId).toBe(true);
  await expect(page.getByText(workspace.name, { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: 'Existing shared mission section', exact: true }),
  ).toBeVisible();
  await page.getByText('Join a workspace', { exact: true }).click();
  await expect(page.getByLabel('Workspace invitation code', { exact: true })).toBeEmpty();
  expect(await page.evaluate(() => location.search)).toBe('');
});

test('invitation denial clears the code and stale workspace view without claiming membership', async ({
  page,
}) => {
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [workspace] } }),
  );
  for (const status of [401, 403, 409, 503]) {
    await page.route('**/api/customer-workspace-access', (route) =>
      route.fulfill({ status, json: { error: 'Synthetic denied fixture' } }),
    );
    await page.goto(origin);
    await expect(page.getByText(workspace.name, { exact: true })).toBeVisible();
    await page.getByText('Join a workspace', { exact: true }).click();
    await page.getByLabel('Workspace invitation code', { exact: true }).fill(token);
    await page.getByRole('button', { name: 'Join workspace', exact: true }).click();
    await expect(page.getByText(workspace.name, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Workspace invitation code', { exact: true })).toHaveCount(0);
    await expect(page.getByText('You have joined the workspace.', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Existing shared mission section', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => Object.keys(sessionStorage).length + Object.keys(localStorage).length,
      ),
    ).toBe(0);
    await page.unroute('**/api/customer-workspace-access');
  }
});

test('malformed success never claims membership, and clearing an uncertain code sends no second request', async ({
  page,
}) => {
  let posts = 0;
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: [] } }),
  );
  for (const response of [
    { ...joined, workspace: { ...workspace, role: 'owner' } },
    { ...joined, workspace: { ...workspace, synthetic: false } },
    { ...joined, workspaceId: randomUUID() },
    { ...joined, memberId: 'invalid' },
  ]) {
    await page.route('**/api/customer-workspace-access', (route) => {
      posts++;
      return route.fulfill({ json: response });
    });
    await page.goto(origin);
    await page.getByText('Join a workspace', { exact: true }).click();
    await page.getByLabel('Workspace invitation code', { exact: true }).fill(token);
    await page.getByRole('button', { name: 'Join workspace', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Joining was not confirmed');
    await expect(page.getByText('You have joined the workspace.', { exact: true })).toHaveCount(0);
    const before = posts;
    await page.getByRole('button', { name: 'Clear invitation code', exact: true }).click();
    await expect(page.getByLabel('Workspace invitation code', { exact: true })).toBeEmpty();
    await expect(page.getByRole('alert')).toContainText(
      'earlier request may already have succeeded',
    );
    expect(posts).toBe(before);
    await page.unroute('**/api/customer-workspace-access');
  }
  expect(posts).toBe(4);
});

test('reload requires code re-entry, preserves the existing grant and sends only the current identity context', async ({
  page,
}) => {
  const records: (typeof workspace)[] = [],
    posts: { commandId: string; token: string }[] = [];
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: records } }),
  );
  await page.route('**/api/customer-workspace-access', async (route) => {
    expect(route.request().headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(route.request().headers()['x-corridra-customer-issuer']).toBe(issuer);
    posts.push(route.request().postDataJSON());
    if (posts.length === 1) {
      records.push(workspace);
      await route.abort('failed');
    } else await route.fulfill({ json: joined });
  });
  await page.goto(origin);
  await page.getByText('Join a workspace', { exact: true }).click();
  await page.getByLabel('Workspace invitation code', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Join workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Joining was not confirmed');
  await page.reload();
  await expect(page.getByText(workspace.name, { exact: true })).toHaveCount(1);
  await page.getByText('Join a workspace', { exact: true }).click();
  await expect(page.getByLabel('Workspace invitation code', { exact: true })).toBeEmpty();
  await page.getByLabel('Workspace invitation code', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Join workspace', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('You have joined the workspace.');
  expect(posts.length).toBe(2);
  expect(posts[0].commandId === posts[1].commandId).toBe(false);
  await expect(page.getByText(workspace.name, { exact: true })).toHaveCount(1);
  records.length = 0;
  const nextIssuer = issuer.replace('ep-ui-fixture', 'ep-other');
  await page.goto(origin + '?subject=synthetic-bob&issuer=' + encodeURIComponent(nextIssuer));
  await page.getByText('Join a workspace', { exact: true }).click();
  await expect(page.getByLabel('Workspace invitation code', { exact: true })).toBeEmpty();
  await expect(page.getByText(workspace.name, { exact: true })).toHaveCount(0);
  expect(posts.length).toBe(2);
  expect(
    await page.evaluate(
      () => Object.keys(sessionStorage).length + Object.keys(localStorage).length,
    ),
  ).toBe(0);
});
