import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CRUD G1 follow-up: the read-only line the Corridra team sees on a mission whose customer withdrew the request.
// Mounted with the real stylesheets, the interface answered by the test. It names the date, never a reason, offers no
// control, and shows nothing for a mission that is not withdrawn. No database, no customer.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const tenant = '11111111-1111-4111-8111-111111111111';
const mission = '22222222-2222-4222-8222-222222222222';

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{WithdrawalNote}from ${JSON.stringify(resolve('apps/web/app/operator/mission-withdrawal-note.tsx'))};
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace"><h1>Mission</h1><h2>Requests</h2><h3>One request</h3><WithdrawalNote tenant=${JSON.stringify(tenant)} missionId=${JSON.stringify(mission)} /></main>);`,
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
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moves fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

async function open(page: Page, answer: { status: number; body: unknown }) {
  const urls: string[] = [];
  await page.route('**/api/mission-withdrawal**', async (route) => {
    urls.push(route.request().url());
    return route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      body: JSON.stringify(answer.body),
    });
  });
  await page.goto(`${origin}/`);
  return urls;
}

test('says when the customer withdrew the request, with no reason and no control', async ({
  page,
}) => {
  const urls = await open(page, {
    status: 200,
    body: { withdrawn: true, at: '2026-11-09T10:00:00.000Z' },
  });
  const note = page.getByTestId('withdrawn-by-customer');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Withdrawn by the customer on');
  await expect(note).toContainText('9 Nov 2026');
  await expect(note).toContainText('The reason stays private to the customer.');
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain(`tenant=${tenant}`);
  expect(urls[0]).toContain(`mission=${mission}`);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('shows nothing for a mission that is not withdrawn', async ({ page }) => {
  await open(page, { status: 200, body: { withdrawn: false, at: null } });
  await expect(page.getByRole('heading', { name: 'Mission' })).toBeVisible();
  await expect(page.getByTestId('withdrawn-by-customer')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('says so plainly when the status cannot be read, instead of showing nothing', async ({
  page,
}) => {
  await open(page, { status: 500, body: { error: 'Request failed' } });
  await expect(page.getByRole('status')).toHaveText('The withdrawal status could not be read.');
  await expect(page.getByTestId('withdrawn-by-customer')).toHaveCount(0);
});

test('shows nothing at all when the person may not read it or the module is not available', async ({
  page,
}) => {
  for (const status of [403, 503]) {
    await page.unroute('**/api/mission-withdrawal**').catch(() => undefined);
    await open(page, { status, body: { error: 'Access denied' } });
    await expect(page.getByRole('heading', { name: 'Mission' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByTestId('withdrawn-by-customer')).toHaveCount(0);
  }
});
