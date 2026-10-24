import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The sign-in pages are prerendered and the saved request lives in a cookie, so the real component
// is bundled and mounted in a small page, with the one request it makes stubbed in the browser. This
// proves what a person sees for each answer, not the cookie or the database behind it.
let server: Server, origin: string;
let bundle = '';

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{PendingRequestNotice}from ${JSON.stringify(resolve('apps/web/components/pending-request-notice.tsx'))};
      const where=new URLSearchParams(location.search).get('where')||'verify';
      createRoot(document.getElementById('fixture')).render(<PendingRequestNotice where={where}/>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'link-fixture',
        setup(b) {
          b.onResolve({ filter: /^next\/link$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents: 'export default function Link(props){return <a {...props}/>}',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
  const css = `body{font:16px system-ui;margin:0;padding:24px;color:#18283c;background:#f6f8fb}.ux-draft-notice{padding:16px;margin:18px 0;border-left:3px solid #2856c5;background:#fff}.text-link{color:#1d3f91}`;
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved request notice fixture</title><style>${css}</style></head><body><main id="main"><h1>Account access</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

async function answer(page: Page, status: number, body: unknown) {
  await page.route('**/api/intake/pending', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

for (const where of ['verify', 'signin', 'signup', 'account'] as const) {
  test(`${where}: shows the saved request notice when this browser holds one`, async ({ page }) => {
    await answer(page, 200, { pending: true, available: true });
    await page.goto(`${origin}/?where=${where}`);
    const notice = page.locator('[data-pending-request-notice]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('It has not been sent yet.');
    await expect(notice).toContainText('We keep it for 24 hours.');
    if (where === 'account')
      await expect(notice.getByRole('link', { name: 'Open your request' })).toHaveAttribute(
        'href',
        '/plan',
      );
    else {
      await expect(notice.getByRole('link')).toHaveCount(0);
      await expect(notice).toContainText('this device and browser');
    }
  });
}

test('shows nothing when there is no saved request', async ({ page }) => {
  await answer(page, 200, { pending: false, available: true });
  await page.goto(`${origin}/?where=verify`);
  await expect(page.locator('#fixture')).toBeAttached();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-pending-request-notice]')).toHaveCount(0);
});

test('shows nothing, and no error, when the check fails', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await answer(page, 503, { error: 'unavailable' });
  await page.goto(`${origin}/?where=signin`);
  await page.waitForTimeout(500);
  await expect(page.locator('[data-pending-request-notice]')).toHaveCount(0);
  await page.unroute('**/api/intake/pending');
  await page.route('**/api/intake/pending', (route) => route.abort('connectionfailed'));
  await page.goto(`${origin}/?where=signin`);
  await page.waitForTimeout(500);
  await expect(page.locator('[data-pending-request-notice]')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('is readable on a phone and a desktop, with no overflow and no accessibility violations', async ({
  page,
}) => {
  await answer(page, 200, { pending: true, available: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/?where=account`);
    await expect(page.locator('[data-pending-request-notice]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations, `axe at ${width}`).toEqual([]);
  }
});
