import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The customer inbox when its list is full (30 newest, all read) and the server count cannot be read: older unread
// items may exist, so Mark All Read stays available instead of vanishing.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{NotificationInbox}from ${JSON.stringify(resolve('apps/web/components/ux/notification-inbox.tsx'))};
      createRoot(document.getElementById('fixture')).render(<NotificationInbox endpoint="/api/customer-inbox" grouped />);`,
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
        '<!doctype html><html lang="en"><head><title>Inbox</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

const read = (index: number) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  type: 'REPLY_POSTED',
  payload: { title: `Reply ${index}` },
  readAt: '2026-11-04T11:00:00Z',
  createdAt: '2026-11-03T11:00:00Z',
});

test('a full list whose count cannot be read still offers Mark All Read, and it sends only {all:true}', async ({
  page,
}) => {
  const posted: string[] = [];
  await page.route('**/api/customer-inbox**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      posted.push(request.postData() ?? '');
      return route.fulfill({ json: { marked: 4, unread: 0 } });
    }
    if (new URL(request.url()).searchParams.get('count') === '1')
      return route.fulfill({ status: 500, json: { error: 'down' } });
    return route.fulfill({ json: Array.from({ length: 30 }, (_, index) => read(index + 1)) });
  });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark All Read' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark All Read' }).click();
  await expect.poll(() => posted).toEqual(['{"all":true}']);
});

test('a short list with nothing unread has no Mark All Read', async ({ page }) => {
  await page.route('**/api/customer-inbox**', (route) =>
    route.fulfill({ json: [read(1), read(2)] }),
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark All Read' })).toHaveCount(0);
});
