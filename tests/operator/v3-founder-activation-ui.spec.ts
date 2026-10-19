import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures for the staff-only founder activation table.
const tenant = '00000000-0000-4000-8000-000000000006';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {FounderActivation} from ${JSON.stringify(resolve('apps/web/components/founder-activation.tsx'))};const root=createRoot(document.getElementById('fixture'));const render=tenant=>root.render(<FounderActivation key={tenant} tenant={tenant}/>);render(${JSON.stringify(tenant)});window.addEventListener('fixture-tenant',event=>render(event.detail));`,
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
    } else if (path === '/' || path === '/account/delegations') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic component protocol fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic component protocol fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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

const module_ = (key: string, label: string, state: string) => ({
  key,
  label,
  flag: 'CORRIDRA_CUSTOMER_' + key.toUpperCase().replace(/-/g, '_') + '_ENABLED',
  state,
});
const body = (over: Record<string, unknown> = {}) => ({
  role: 'owner',
  environment: {
    deployment: 'preview',
    data: 'synthetic',
    productionUnlocked: false,
    openAdmission: false,
  },
  modules: [
    module_('workspaces', 'Customer workspaces', 'ON'),
    module_('requests', 'Private requests', 'OFF'),
    module_('programme-templates', 'Repeatable programme templates', 'WAITING_PREREQUISITE'),
    module_('programmes', 'Delegation programmes', 'LOCKED_PRODUCTION'),
    module_('companies', 'Company continuity', 'LOCKED_NOT_SYNTHETIC'),
  ],
  counts: { on: 1, total: 5 },
  note: 'Configuration only. A module also needs its database installation, checked separately by the owner.',
  ...over,
});
async function mock(page: Page, respond: () => { status?: number; json: unknown }) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  await page.route('**/api/workspace/founder-activation**', (route) => {
    seen.push({ url: route.request().url(), headers: route.request().headers() });
    const out = respond();
    return route.fulfill({ status: out.status ?? 200, json: out.json });
  });
  return seen;
}

test('shows the environment, the count and each module with a plain reason', async ({ page }) => {
  const seen = await mock(page, () => ({ json: body() }));
  await page.goto(origin);
  const summary = page.getByText(/This deployment is/);
  await expect(summary).toContainText('preview');
  await expect(summary).toContainText('synthetic');
  await expect(summary).toContainText('1 of 5 customer modules are on');
  // Another panel on the page owns the single status region, so this one must not add one.
  await expect(page.getByRole('status')).toHaveCount(0);
  const table = page.getByRole('region', { name: 'Customer modules' });
  await expect(table.getByRole('row')).toHaveCount(6);
  await expect(table.getByRole('row', { name: /Customer workspaces/ })).toContainText('On');
  await expect(table.getByRole('row', { name: /Private requests/ })).toContainText(
    'Off, flag unset',
  );
  await expect(table.getByRole('row', { name: /Repeatable programme templates/ })).toContainText(
    'waiting for a prerequisite module',
  );
  await expect(table.getByRole('row', { name: /Delegation programmes/ })).toContainText(
    'never runs in production',
  );
  await expect(table.getByRole('row', { name: /Company continuity/ })).toContainText(
    'data is not synthetic',
  );
  await expect(table.getByText('CORRIDRA_CUSTOMER_REQUESTS_ENABLED')).toBeVisible();
  await expect(page.getByText('checked separately by the owner')).toBeVisible();
  expect(seen).toHaveLength(1);
  expect(new URL(seen[0]!.url).searchParams.get('tenant')).toBe(tenant);
});

test('says plainly when production is unlocked and accounts are admitted automatically', async ({
  page,
}) => {
  await mock(page, () => ({
    json: body({
      environment: {
        deployment: 'production',
        data: 'synthetic',
        productionUnlocked: true,
        openAdmission: true,
      },
    }),
  }));
  await page.goto(origin);
  const summary = page.getByText(/This deployment is/);
  await expect(summary).toContainText('production');
  await expect(summary).toContainText('Production is unlocked for synthetic use by the owner.');
  await expect(summary).toContainText('Any email-verified account is admitted automatically.');
});

test('an older response without the unlock fields still renders and claims nothing', async ({
  page,
}) => {
  await mock(page, () => ({
    json: body({ environment: { deployment: 'preview', data: 'synthetic' } }),
  }));
  await page.goto(origin);
  const summary = page.getByText(/This deployment is/);
  await expect(summary).toContainText('preview');
  await expect(summary).not.toContainText('unlocked');
  await expect(summary).not.toContainText('admitted automatically');
});

test('a failed request shows an error and assumes nothing is on', async ({ page }) => {
  await mock(page, () => ({ status: 403, json: { error: 'denied' } }));
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('Nothing is assumed to be on');
  await expect(page.getByRole('region', { name: 'Customer modules' })).toHaveCount(0);
  await expect(page.getByText(/modules are on/)).toHaveCount(0);
});

test('a malformed or extended response is rejected rather than rendered', async ({ page }) => {
  for (const json of [
    body({ modules: [module_('x', 'Odd module', 'ENABLED')] }),
    body({ counts: { on: 'one', total: 5 } }),
    body({ environment: { deployment: 'preview' } }),
    { role: 'owner' },
    null,
  ]) {
    await page.unrouteAll();
    await mock(page, () => ({ json }));
    await page.goto(origin);
    await expect(page.getByRole('alert')).toContainText('Nothing is assumed to be on');
    await expect(page.getByText('Odd module')).toHaveCount(0);
  }
});

test('changing the workspace reloads for the new workspace', async ({ page }) => {
  const other = '00000000-0000-4000-8000-000000000099';
  const seen = await mock(page, () => ({ json: body() }));
  await page.goto(origin);
  await expect(page.getByRole('region', { name: 'Customer modules' })).toBeVisible();
  await page.evaluate(
    (id) => window.dispatchEvent(new CustomEvent('fixture-tenant', { detail: id })),
    other,
  );
  await expect.poll(() => seen.length).toBe(2);
  expect(new URL(seen[1]!.url).searchParams.get('tenant')).toBe(other);
});

test('nothing in the response can be mistaken for a secret or a live figure', async ({ page }) => {
  await mock(page, () => ({ json: body() }));
  await page.goto(origin);
  const text = (await page.locator('#fixture').innerText()).toLowerCase();
  expect(text).not.toMatch(/postgres:|secret|password|token|revenue|\$\d/);
});

for (const width of [320, 390, 768, 1440])
  test('keyboard and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mock(page, () => ({ json: body() }));
    await page.goto(origin);
    const region = page.getByRole('region', { name: 'Customer modules' });
    await expect(region).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(region).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
