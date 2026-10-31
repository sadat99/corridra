import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { CustomerRequestDetail } from ${JSON.stringify(resolve('apps/web/app/account/requests/request-detail.tsx'))};
        const query = new URLSearchParams(location.search);
        const subject = query.get('subject') || 'synthetic-alice';
        const issuer = query.get('issuer') || ${JSON.stringify(issuer)};
        
        const root=createRoot(document.getElementById('fixture'));
        root.render(query.has('before')?null:<CustomerRequestDetail subject={subject} issuer={issuer} requestId="00000000-0000-4000-8000-000000000001" />);
        window.addEventListener('fixture-customer-change',event=>root.render(<CustomerRequestDetail subject={event.detail.subject} issuer={event.detail.issuer} requestId="00000000-0000-4000-8000-000000000001" />));`,
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

const id = '00000000-0000-4000-8000-000000000001';
const source = () => ({
  objective: 'Source suppliers',
  market: 'China',
  attendance: 'Not decided',
  startDate: '',
  endDate: '',
  timezone: 'Asia/Dhaka',
  offer: 'Original machinery 工厂 বাংলা requirements',
  website: 'https://example.invalid/',
  outcomes: ['Supplier visits'],
  notes: 'Original scope; installation excluded',
  name: 'Synthetic Person',
  company: 'Fictional Company',
  email: 'test@example.invalid',
  acknowledged: true,
  experience: {
    schemaVersion: 1,
    companyCountry: 'BD',
    marketCode: 'CN',
    job: 'machinery_procurement',
    requirements: {
      objective: 'Find suitable machinery',
      role: 'IMPORTER',
      product: 'Synthetic packaging machine',
      budgetMinor: '1234',
      currency: 'BHD',
      budgetBasis: 'One machine, installation excluded',
      machinery: { installationReferences: 'Supplier must confirm installation and commissioning' },
    },
  },
});
const payload = () => ({
  id,
  workspaceId: '00000000-0000-4000-8000-000000000002',
  createdAt: '2026-10-18T01:00:00Z',
  synthetic: true,
  available: true,
  original: source(),
  progress: {
    status: 'DRAFT',
    receivedAt: '2026-10-18T01:00:00Z',
    replies: [{ body: 'Original team reply বাংলা', createdAt: '2026-10-18T02:00:00Z' }],
  },
});
test('reopens original requirements,precise currency,canonical status and replies through the read-only scoped endpoint', async ({
  page,
}) => {
  let reads = 0;
  await page.route('**/api/customer-requests/' + id, async (route) => {
    reads++;
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(route.request().headers()['x-corridra-customer-issuer']).toBe(issuer);
    await route.fulfill({ json: payload() });
  });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Source suppliers' })).toBeVisible();
  await expect(
    page.getByText('Original machinery 工厂 বাংলা requirements', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/BHD.*1\.234/)).toBeVisible();
  await expect(page.getByText('Original team reply বাংলা')).toBeVisible();
  await expect(page.getByText('Received, waiting for review', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to my saved requests' })).toHaveAttribute(
    'href',
    '/account#customer-requests',
  );
  expect(reads).toBe(1);
});
test('unavailable and malformed acknowledgements never display source;explicit retry recovers', async ({
  page,
}) => {
  let turn = 0;
  await page.route('**/api/customer-requests/' + id, async (route) => {
    turn++;
    await route.fulfill(
      turn === 1
        ? { status: 503, json: { error: 'unavailable' } }
        : turn === 2
          ? { json: { ...payload(), id: 'wrong-resource' } }
          : { json: payload() },
    );
  });
  await page.goto(origin);
  await expect(page.getByRole('status')).toContainText('unavailable');
  await page.getByRole('button', { name: 'Refresh request details' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.getByText('Original machinery 工厂 বাংলা requirements')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh request details' }).click();
  await expect(page.getByRole('heading', { name: 'Source suppliers' })).toBeVisible();
});
test('expired retention hides original requirements and progress;permission loss clears an existing display', async ({
  page,
}) => {
  let turn = 0;
  await page.route('**/api/customer-requests/' + id, async (route) => {
    turn++;
    await route.fulfill(
      turn === 1
        ? { json: { ...payload(), available: false, original: null, progress: null } }
        : turn === 2
          ? { json: payload() }
          : { status: 403, json: { error: 'denied' } },
    );
  });
  await page.goto(origin);
  await expect(page.getByRole('status')).toContainText('no longer available');
  await expect(page.getByText('Original submitted requirements', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh request details' }).click();
  await expect(page.getByRole('heading', { name: 'Source suppliers' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh request details' }).click();
  await expect(page.getByRole('alert')).toContainText('No request details');
  await expect(page.getByText('Original machinery 工厂 বাংলা requirements')).toHaveCount(0);
});
test('account context change discards a pending earlier-account read', async ({ page }) => {
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/customer-requests/' + id, async (route) => {
    if (route.request().headers()['x-corridra-customer-subject'] === 'synthetic-alice') {
      await hold;
      await route.fulfill({ json: payload() }).catch(() => {});
    } else await route.fulfill({ status: 403, json: { error: 'denied' } });
  });
  await page.goto(origin);
  await expect(page.getByRole('status')).toContainText('Loading');
  await page.evaluate(
    (issuer) =>
      window.dispatchEvent(
        new CustomEvent('fixture-customer-change', {
          detail: { subject: 'synthetic-bob', issuer },
        }),
      ),
    issuer,
  );
  await expect(page.getByRole('alert')).toContainText('No request details');
  release();
  await expect(page.getByText('Original machinery 工厂 বাংলা requirements')).toHaveCount(0);
});
test('page hiding clears private source and restoration rechecks access', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/customer-requests/' + id, async (route) => {
    reads++;
    await route.fulfill(
      reads === 1 ? { json: payload() } : { status: 401, json: { error: 'denied' } },
    );
  });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Source suppliers' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.getByText('Original machinery 工厂 বাংলা requirements')).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByRole('alert')).toContainText('No request details');
});
test('responsive,keyboard and axe checks retain readable original-script requirements at three widths', async ({
  page,
}) => {
  await page.route('**/api/customer-requests/' + id, (route) => route.fulfill({ json: payload() }));
  await mkdir('.cache/v3-request-detail/after', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin);
    await expect(page.getByRole('heading', { name: 'Source suppliers' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: '.cache/v3-request-detail/after/detail-' + width + '.png',
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.getByText('Original submitted requirements', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Original machinery 工厂 বাংলা requirements')).not.toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Original machinery 工厂 বাংলা requirements')).toBeVisible();
});
