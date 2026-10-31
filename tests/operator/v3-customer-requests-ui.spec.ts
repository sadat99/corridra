import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
import { missionStatus } from '../../packages/domain/src/missions';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { CustomerRequests } from ${JSON.stringify(resolve('apps/web/app/account/customer-requests.tsx'))};
        const query = new URLSearchParams(location.search);
        const subject = query.get('subject') || 'synthetic-alice';
        const issuer = query.get('issuer') || ${JSON.stringify(issuer)};
        const statuses=${JSON.stringify(missionStatus.options)};
        const root=createRoot(document.getElementById('fixture'));
        root.render(query.has('before')?null:<CustomerRequests subject={subject} issuer={issuer} statuses={statuses} />);
        window.addEventListener('fixture-customer-change',event=>root.render(<CustomerRequests subject={event.detail.subject} issuer={event.detail.issuer} statuses={statuses} />));`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    // Shared UX components import their kit stylesheet; the fixture page does not need it.
    loader: { '.css': 'empty' },
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
  // Use the real compiled global CSS/font class, not unprocessed Tailwind source.
  const documentResponse = await fetch('http://127.0.0.1:3200/');
  expect(documentResponse.status).toBe(200);
  const document = await documentResponse.text();
  const fontClass = document.match(/<html[^>]*class="([\w -]+)"/)?.[1];
  expect(fontClass).toBeTruthy();
  const cssPaths = [
    ...new Set(
      [...document.matchAll(/href="(\/_next\/static\/[^"?]+\.css)(?:\?[^"\s]*)?"/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
  expect(cssPaths.length).toBeGreaterThan(0);
  for (const path of cssPaths) expect(path).toMatch(/^\/_next\/static\/chunks\/[\w.-]+\.css$/);
  const css = Buffer.concat(
    await Promise.all(
      cssPaths.map((path) =>
        readFile(resolve('apps/web/.next/static', path.slice('/_next/static/'.length))),
      ),
    ),
  );
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(css);
    } else if (/^\/_next\/static\/media\/[\w.-]+\.woff2$/.test(path)) {
      void readFile(resolve('apps/web/.next/static', path.slice('/_next/static/'.length)))
        .then((font) => {
          response.setHeader('Content-Type', 'font/woff2');
          response.end(font);
        })
        .catch(() => {
          response.statusCode = 404;
          response.end();
        });
    } else if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic component protocol fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic component protocol fixture</h1><div id="fixture"></div><section id="customer-missions"><h2>Existing shared mission section</h2></section></main><script type="module" src="/fixture.js"></script></body></html>`,
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
const id = (last: string) => '00000000-0000-4000-8000-' + last.padStart(12, '0');
const saved = (key = '1', available = true) => ({
  id: id(key),
  workspaceId: id('10'),
  createdAt: '2026-10-18T10:00:00Z',
  synthetic: true,
  available,
  progress: available
    ? {
        status: 'DRAFT',
        receivedAt: '2026-10-18T10:00:00Z',
        replies: [{ body: '原始供应商回复: 样本仅供测试。', createdAt: '2026-10-18T11:00:00Z' }],
      }
    : null,
});
const pageData = (requests: unknown[] = [], nextAfter: string | null = null) => ({
  requests,
  nextAfter,
  synthetic: true,
});

test('private saved requests show canonical status, original-script replies, expiry and bounded pagination', async ({
  page,
}) => {
  const calls: string[] = [];
  await page.route('**/api/customer-requests**', async (route) => {
    const request = route.request();
    calls.push(request.url());
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    expect(request.method()).toBe('GET');
    await route.fulfill({
      json: new URL(request.url()).searchParams.has('after')
        ? pageData([saved('2', false)])
        : pageData([saved()], id('1')),
    });
  });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Saved requests', exact: true })).toBeVisible();
  await expect(page.getByText('Received, waiting for review', { exact: true })).toBeVisible();
  await expect(page.getByText('DRAFT', { exact: true })).toHaveCount(0);
  await expect(page.getByText(id('1'), { exact: true })).toBeHidden();
  await page.getByText('Request reference', { exact: true }).first().click();
  await expect(page.getByText(id('1'), { exact: true })).toBeVisible();
  await expect(page.getByText('原始供应商回复: 样本仅供测试。', { exact: true })).toBeVisible();
  await expect(
    page.getByText('A saved request is not an accepted engagement, confirmed meeting or deal.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load more saved requests', exact: true }).click();
  await expect(
    page.getByText(
      'The original request progress is no longer available. Its retention period may have ended.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Load more saved requests', exact: true }),
  ).toHaveCount(0);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain('?after=' + id('1'));
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
  await page.reload();
  await expect(page.getByText('Received, waiting for review', { exact: true })).toBeVisible();
  await expect(page.getByText('DRAFT', { exact: true })).toHaveCount(0);
});

test('failed reads recover to empty and unavailable without pretending a request was created', async ({
  page,
}) => {
  let status = 500;
  await page.route('**/api/customer-requests**', (route) =>
    route.fulfill({
      status,
      json: status === 200 ? pageData() : { error: 'Invented fixture failure' },
    }),
  );
  await page.goto(origin);
  await expect(page.getByRole('alert')).toHaveText(
    'Your saved requests could not be loaded. Try again.',
  );
  status = 200;
  await page.getByRole('button', { name: 'Refresh saved requests', exact: true }).click();
  await expect(
    page.getByText('No saved requests yet. Choose a workspace to send your first one.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /create|submit|send/i })).toHaveCount(0);
  status = 503;
  await page.getByRole('button', { name: 'Refresh saved requests', exact: true }).click();
  await expect(
    page.getByText(
      'Saved request access is unavailable. Your existing receipts and shared mission links are separate.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('permission loss clears prior content and denied responses cannot disclose private replies', async ({
  page,
}) => {
  let denied = false;
  await page.route('**/api/customer-requests**', (route) =>
    route.fulfill({ status: denied ? 403 : 200, json: pageData([saved()]) }),
  );
  await page.goto(origin);
  await expect(page.getByText('原始供应商回复: 样本仅供测试。', { exact: true })).toBeVisible();
  denied = true;
  await page.getByRole('button', { name: 'Refresh saved requests', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Sign in again', exact: true })).toHaveAttribute(
    'href',
    '/signin',
  );
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('原始供应商回复: 样本仅供测试。', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Refresh saved requests', exact: true }),
  ).toHaveCount(0);
});

test('malformed source/progress is rejected without showing fabricated success', async ({
  page,
}) => {
  await page.route('**/api/customer-requests**', (route) =>
    route.fulfill({
      json: pageData([
        { ...saved(), progress: { ...saved().progress!, status: 'ACCEPTED_MEETING' } },
      ]),
    }),
  );
  await page.goto(origin);
  await expect(page.getByRole('alert')).toHaveText(
    'Your saved requests could not be loaded. Try again.',
  );
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('ACCEPTED_MEETING', { exact: true })).toHaveCount(0);
});

test('saved request views retain keyboard access and fit three widths with accessible states', async ({
  page,
}) => {
  await page.route('**/api/customer-requests**', (route) =>
    route.fulfill({ json: pageData([saved(), saved('2', false)]) }),
  );
  await mkdir('.cache/v3-request-ui/after', { recursive: true });
  // Fixture before/after only, never claimed as a private provider/account walkthrough.
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + '?before=1');
    await expect(
      page.getByRole('heading', { name: 'Existing shared mission section', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Saved requests', exact: true })).toHaveCount(0);
    await page.screenshot({
      path: '.cache/v3-request-ui/after/before-requests-' + width + '.png',
      fullPage: true,
    });
  }
  await page.goto(origin);
  await expect(page.getByText('Received, waiting for review', { exact: true })).toBeVisible();
  await expect(page.getByText('DRAFT', { exact: true })).toHaveCount(0);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(
      page.getByRole('button', { name: 'Refresh saved requests', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      path: '.cache/v3-request-ui/after/requests-' + width + '.png',
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Refresh saved requests', exact: true }).focus();
  await expect(
    page.getByRole('button', { name: 'Refresh saved requests', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Received, waiting for review', { exact: true })).toBeVisible();
  await expect(page.getByText('DRAFT', { exact: true })).toHaveCount(0);
});

test('identity changes abort stale private reads and remount without prior account state', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed!: () => void;
  const started = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route('**/api/customer-requests**', async (route) => {
    if (route.request().headers()['x-corridra-customer-subject'] === 'synthetic-alice') {
      observed();
      await held;
      try {
        await route.fulfill({ json: pageData([saved()]) });
      } catch {
        /* Browser canceled the old scoped request. */
      }
    } else await route.fulfill({ status: 403, json: { error: 'Denied fictional second account' } });
  });
  await page.goto(origin);
  await started;
  await page.evaluate(
    (value) =>
      window.dispatchEvent(
        new CustomEvent('fixture-customer-change', {
          detail: { subject: 'synthetic-bob', issuer: value },
        }),
      ),
    issuer,
  );
  await expect(page.getByRole('link', { name: 'Sign in again', exact: true })).toBeVisible();
  release();
  await page.waitForTimeout(50);
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('原始供应商回复: 样本仅供测试。', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
});

test('page restoration clears cached progress and rechecks current permission before showing content', async ({
  page,
}) => {
  let denied = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/customer-requests**', async (route) => {
    if (denied) {
      await pending;
      await route.fulfill({ status: 403, json: { error: 'Synthetic revoked page restore' } });
    } else await route.fulfill({ json: pageData([saved()]) });
  });
  await page.goto(origin);
  await expect(page.getByText('原始供应商回复: 样本仅供测试。', { exact: true })).toBeVisible();
  denied = true;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  try {
    await expect(page.getByRole('status')).toHaveText('Loading your saved requests…');
    await expect(page.getByRole('article')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByRole('link', { name: 'Sign in again', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});
