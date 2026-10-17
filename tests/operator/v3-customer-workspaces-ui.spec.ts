import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Component protocol fixture only. No auth, database or provider success is fabricated by the app.
// Real restricted-role/idempotency/context enforcement has separate integration acceptance.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { CustomerWorkspaces } from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
        const query = new URLSearchParams(location.search);
        const subject = query.get('subject') || 'synthetic-alice';
        const issuer = query.get('issuer') || ${JSON.stringify(issuer)};
        createRoot(document.getElementById('fixture')).render(<CustomerWorkspaces key={issuer + ':' + subject} subject={subject} issuer={issuer} />);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    metafile: true,
  });
  expect(
    Object.keys(result.metafile!.inputs).some((path) => path.includes('packages/auth/src')),
  ).toBe(false);
  const javascript = result.outputFiles[0].text;
  const css = await readFile('apps/web/app/globals.css');
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic component protocol fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic component protocol fixture</h1><div id="fixture"></div><section id="customer-missions"><h2>Existing shared mission section</h2></section></main><script type="module" src="/fixture.js"></script></body></html>',
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
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

const row = (name: string) => ({
  id: randomUUID(),
  name,
  role: 'owner',
  synthetic: true,
  organisationId: null,
});

test('customer workspace UI preserves one command through loading, duplicate submit, lost acknowledgement and reload retry', async ({
  page,
}) => {
  const posts: { commandId: string; name: string }[] = [];
  const records: ReturnType<typeof row>[] = [];
  let releaseGet!: () => void, releasePost!: () => void, startedPost!: () => void;
  const getGate = new Promise<void>((done) => {
    releaseGet = done;
  });
  const postGate = new Promise<void>((done) => {
    releasePost = done;
  });
  const postStarted = new Promise<void>((done) => {
    startedPost = done;
  });
  await page.route('**/api/customer-workspaces', async (route) => {
    expect(route.request().headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    if (route.request().method() === 'GET') {
      await getGate;
      await route.fulfill({ json: { synthetic: true, workspaces: records } });
      return;
    }
    const body = route.request().postDataJSON();
    posts.push(body);
    if (posts.length === 1) {
      records.push(row(body.name));
      startedPost();
      await postGate;
      await route.abort('failed');
    } else {
      await route.fulfill({ json: records[0] });
    }
  });
  await page.goto(origin);
  await expect(page.getByRole('status')).toHaveText('Loading your test workspaces…');
  await expect(page.getByRole('form', { name: 'Create a test workspace' })).toHaveCount(0);
  releaseGet();
  await expect(page.getByText('No test workspaces yet.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create test workspace', exact: true }).click();
  expect(posts).toHaveLength(0);
  const name = page.getByLabel('Test workspace name', { exact: true });
  await name.fill('Lost acknowledgement');
  await name.focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Create test workspace', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await postStarted;
  await expect(page.getByRole('button', { name: 'Please wait…', exact: true })).toBeDisabled();
  await page
    .getByRole('form', { name: 'Create a test workspace' })
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
  expect(posts).toHaveLength(1);
  releasePost();
  await expect(page.getByRole('alert')).toContainText('Creation was not confirmed');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(name).toHaveAttribute('readonly', '');
  const first = posts[0];
  expect(Object.keys(first).sort()).toEqual(['commandId', 'name']);
  expect(first.name).toBe('Synthetic Lost acknowledgement');
  await page.reload();
  await expect(name).toHaveValue('Lost acknowledgement');
  await expect(page.getByText('Synthetic Lost acknowledgement', { exact: true })).toBeVisible();
  await expect(name).toHaveAttribute('readonly', '');
  const retry = page.getByRole('button', { name: 'Retry workspace creation', exact: true });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Your test workspace is confirmed.');
  expect(posts).toEqual([first, first]);
  await expect(page.getByText('Synthetic Lost acknowledgement', { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => Object.keys(sessionStorage).length)).toBe(0);
  await mkdir('.cache/v3-customer-ui/after', { recursive: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: `.cache/v3-customer-ui/after/workspaces-${width}.png`,
      fullPage: true,
    });
  }
});

test('customer workspace UI hides received rows and creation controls on expired, denied, changed or unavailable access', async ({
  page,
}) => {
  let responseStatus = 200,
    posts = 0;
  const record = row('Synthetic private context row');
  await page.route('**/api/customer-workspaces', async (route) => {
    if (route.request().method() === 'POST') posts++;
    await route.fulfill({
      status: responseStatus,
      json:
        responseStatus === 200
          ? { synthetic: true, workspaces: [record] }
          : { error: 'Synthetic denied transport' },
    });
  });
  for (const status of [401, 403, 409, 503]) {
    responseStatus = 200;
    await page.goto(origin);
    await expect(page.getByText(record.name, { exact: true })).toBeVisible();
    responseStatus = status;
    await page.getByRole('button', { name: 'Refresh workspaces', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(record.name, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Create a test workspace' })).toHaveCount(0);
    if (status === 401)
      await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
        'href',
        '/signin',
      );
    if (status === 403 || status === 409)
      await expect(page.getByRole('link', { name: 'Reload account', exact: true })).toHaveAttribute(
        'href',
        '/account',
      );
    if (status === 503) {
      responseStatus = 200;
      await page.getByRole('button', { name: 'Retry loading workspaces', exact: true }).click();
      await expect(page.getByText(record.name, { exact: true })).toBeVisible();
    }
  }
  expect(posts).toBe(0);
});

test('customer workspace drafts and responses stay scoped to the mounted issuer and subject through account changes', async ({
  page,
}) => {
  let current = 'synthetic-alice';
  const posts: { commandId: string; name: string }[] = [];
  const records = new Map<string, ReturnType<typeof row>[]>();
  await page.route('**/api/customer-workspaces', async (route) => {
    const expected = route.request().headers()['x-corridra-customer-subject'];
    if (expected !== current) {
      await route.fulfill({ status: 409, json: { error: 'Synthetic switched account' } });
      return;
    }
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { synthetic: true, workspaces: records.get(current) ?? [] } });
      return;
    }
    const body = route.request().postDataJSON();
    posts.push(body);
    const record = row(body.name);
    records.set(current, [record]);
    if (current === 'synthetic-alice') await route.abort('failed');
    else await route.fulfill({ json: record });
  });
  await page.goto(origin);
  await page.getByLabel('Test workspace name', { exact: true }).fill('Alice draft');
  await page.getByRole('button', { name: 'Create test workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Creation was not confirmed');
  current = 'synthetic-bob';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('Your account or saved request changed');
  await expect(page.getByRole('form', { name: 'Create a test workspace' })).toHaveCount(0);
  await page.goto(origin + '/?subject=synthetic-bob');
  await expect(page.getByLabel('Test workspace name', { exact: true })).toBeEmpty();
  await expect(page.getByText('Alice draft', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Retry workspace creation', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Test workspace name', { exact: true }).fill('Bob own workspace');
  await page.getByRole('button', { name: 'Create test workspace', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Your test workspace is confirmed.');
  expect(posts).toHaveLength(2);
  expect(posts[1].commandId).not.toBe(posts[0].commandId);
  expect(posts[1].name).toBe('Synthetic Bob own workspace');
  const stored = await page.evaluate(() => Object.entries(sessionStorage));
  expect(stored).toHaveLength(1);
  expect(stored[0][0]).toBe(`corridra.customer-workspace.v1:${issuer}:synthetic-alice`);
  expect(Object.keys(JSON.parse(stored[0][1])).sort()).toEqual(['commandId', 'name', 'version']);
  current = 'synthetic-alice';
  await page.goto(
    origin +
      '/?issuer=' +
      encodeURIComponent(issuer.replace('ep-ui-fixture', 'ep-another-fixture')),
  );
  await expect(page.getByLabel('Test workspace name', { exact: true })).toBeEmpty();
  await expect(
    page.getByRole('button', { name: 'Retry workspace creation', exact: true }),
  ).toHaveCount(0);
});

test('customer workspace UI sends no mutation when retry storage fails and does not accept malformed success', async ({
  page,
}) => {
  let posts = 0;
  await page.addInitScript(() => {
    let blocked = true;
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, 'allowSyntheticStorage', {
      value: () => {
        blocked = false;
      },
    });
    Storage.prototype.setItem = function (key, value) {
      if (blocked) throw new DOMException('Synthetic storage unavailable');
      return original.call(this, key, value);
    };
  });
  await page.route('**/api/customer-workspaces', async (route) => {
    if (route.request().method() === 'GET')
      await route.fulfill({ json: { synthetic: true, workspaces: [] } });
    else {
      posts++;
      await route.fulfill({
        json: { id: randomUUID(), name: 'Synthetic malformed response', synthetic: false },
      });
    }
  });
  await page.goto(origin);
  await page.getByLabel('Test workspace name', { exact: true }).fill('Storage failure');
  await page.getByRole('button', { name: 'Create test workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No workspace request was sent');
  expect(posts).toBe(0);
  await page.evaluate(() => Reflect.get(window, 'allowSyntheticStorage')());
  await page.getByRole('button', { name: 'Refresh workspaces', exact: true }).click();
  await page.getByRole('button', { name: 'Create test workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Creation was not confirmed');
  expect(posts).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Retry workspace creation', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Your test workspace is confirmed.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Discard retry details', exact: true }).click();
  await expect(page.getByLabel('Test workspace name', { exact: true })).toBeEmpty();
  expect(await page.evaluate(() => Object.keys(sessionStorage).length)).toBe(0);
  expect(posts).toBe(1);
});
