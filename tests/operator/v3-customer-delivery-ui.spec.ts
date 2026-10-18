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
      contents: `import {createRoot} from 'react-dom/client';import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';import {AssignedMissions} from ${JSON.stringify(resolve('apps/web/app/account/assigned-missions.tsx'))};import {CustomerMissionDelivery} from ${JSON.stringify(resolve('apps/web/app/operator/customer-mission-delivery.tsx'))};const root=createRoot(document.getElementById('fixture'));const props={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)}};const router={push:path=>location.assign(path),replace:path=>location.replace(path),back:()=>history.back(),forward:()=>history.forward(),refresh:()=>{},hmrRefresh:()=>{},prefetch:async()=>{}};const render=p=>root.render(<AppRouterContext.Provider value={router}>{new URLSearchParams(location.search).has('staff')?<CustomerMissionDelivery tenant='00000000-0000-4000-8000-000000000004' mission='00000000-0000-4000-8000-000000000005'/>:<AssignedMissions {...props} {...p}/>}</AppRouterContext.Provider>);render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    // Next replaces browser compile-time environment constants in its real build.
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

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => console.error('Component fixture runtime error:', error.message));
});
const assignment = '00000000-0000-4000-8000-000000000001',
  requestId = '00000000-0000-4000-8000-000000000002',
  resource = '00000000-0000-4000-8000-000000000003',
  mission = '00000000-0000-4000-8000-000000000005',
  link = '00000000-0000-4000-8000-000000000006';
const expires = () => new Date(Date.now() + 3600000).toISOString();
const item = (id = assignment) => ({
  id,
  requestId,
  available: true,
  title: 'Reviewed commercial mission 工厂 বাংলা',
  expiresAt: expires(),
  savedResourceId: null,
});
const deliveries = (assignments: unknown[] = [item()], nextAfter: string | null = null) => ({
  assignments,
  nextAfter,
  synthetic: true,
});
const receipt = () => ({
  id: resource,
  available: true,
  removed: false,
  title: 'Reviewed commercial mission 工厂 বাংলা',
  expiresAt: expires(),
});
const review = () => ({
  missionId: mission,
  synthetic: true,
  request: { id: requestId, createdAt: '2026-10-18T00:00:00Z' },
  links: [
    {
      id: link,
      title: 'Original approved client report',
      expiresAt: expires(),
      assignmentId: null,
    },
  ],
});
test('creator acknowledges and saves a delivered report into the existing same-host workspace', async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/customer-assigned-missions*', (r) => {
    expect(r.request().headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    if (r.request().method() === 'GET') return r.fulfill({ json: deliveries() });
    bodies.push(r.request().postDataJSON());
    return r.fulfill({ json: receipt() });
  });
  await page.route('**/account/missions/*', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<h1>Existing approved report protocol fixture</h1>',
    }),
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: item().title })).toBeVisible();
  await page.getByRole('button', { name: 'Save and open approved report' }).click();
  expect(bodies).toHaveLength(0);
  await page.getByRole('checkbox', { name: /I understand this saves/ }).check();
  await page.getByRole('button', { name: 'Save and open approved report' }).click();
  await expect(page).toHaveURL(origin + '/account/missions/' + resource);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ assignmentId: assignment, acknowledged: true });
  expect(Object.keys(bodies[0]).sort()).toEqual(['acknowledged', 'assignmentId', 'commandId']);
});
test('already-saved deliveries link to the original report without another save or pasted token', async ({
  page,
}) => {
  await page.route('**/api/customer-assigned-missions*', (r) =>
    r.fulfill({ json: deliveries([{ ...item(), savedResourceId: resource }]) }),
  );
  await page.goto(origin);
  await expect(
    page.getByRole('link', { name: 'Open approved commercial mission' }),
  ).toHaveAttribute('href', '/account/missions/' + resource);
  await expect(page.getByRole('button', { name: 'Save and open approved report' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => Object.keys(localStorage).length + Object.keys(sessionStorage).length,
    ),
  ).toBe(0);
});
test('empty,revoked,malformed and unavailable states do not invent a report or retain an old title', async ({
  page,
}) => {
  for (const [payload, status, message] of [
    [deliveries([]), 200, 'No commercial report has been delivered'],
    [
      deliveries([{ id: assignment, requestId, available: false }]),
      200,
      'This delivery is unavailable',
    ],
    [
      deliveries([{ ...item(), savedResourceId: 'https://example.invalid/foreign' }]),
      200,
      'Deliveries could not be checked',
    ],
    [{ error: 'Unavailable' }, 503, 'Account mission delivery is unavailable'],
  ] as const) {
    await page.route('**/api/customer-assigned-missions*', (r) =>
      r.fulfill({ status, json: payload }),
    );
    await page.goto(origin);
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: item().title })).toHaveCount(0);
    await page.unroute('**/api/customer-assigned-missions*');
  }
});
test('denial and account change clear previously loaded private delivery details', async ({
  page,
}) => {
  let deny = false;
  await page.route('**/api/customer-assigned-missions*', (r) =>
    deny || r.request().headers()['x-corridra-customer-subject'] === 'synthetic-bob'
      ? r.fulfill({ status: 403, json: { error: 'denied' } })
      : r.fulfill({ json: deliveries() }),
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: item().title })).toBeVisible();
  deny = true;
  await page.getByRole('button', { name: 'Refresh delivered missions' }).click();
  await expect(page.getByRole('heading', { name: item().title })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Return to your account' })).toHaveAttribute(
    'href',
    '/account',
  );
  deny = false;
  await page.getByRole('button', { name: 'Refresh delivered missions' }).click();
  await expect(page.getByRole('heading', { name: item().title })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', { detail: { subject: 'synthetic-bob' } }),
    ),
  );
  await expect(page.getByRole('heading', { name: item().title })).toHaveCount(0);
});
test('pagination cannot extend the original private display window and hide clears loaded data', async ({
  page,
}) => {
  await page.clock.install();
  await page.route('**/api/customer-assigned-missions*', (r) =>
    r.fulfill({
      json: new URL(r.request().url()).searchParams.has('after')
        ? deliveries([
            {
              ...item('00000000-0000-4000-8000-000000000007'),
              title: 'Second independent approved report',
            },
          ])
        : deliveries([item()], assignment),
    }),
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: item().title })).toBeVisible();
  await page.clock.fastForward(30000);
  await page.getByRole('button', { name: 'Load more delivered missions' }).click();
  await expect(
    page.getByRole('heading', { name: 'Second independent approved report' }),
  ).toBeVisible();
  await page.clock.fastForward(31000);
  await expect(page.getByRole('heading', { name: item().title })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Second independent approved report' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh delivered missions' }).click();
  await expect(page.getByRole('heading', { name: item().title })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: item().title })).toHaveCount(0);
  await expect(page.getByText(/Private delivery details cleared/)).toBeVisible();
});
test('uncertain save response retains the exact acknowledged command for retry', async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/customer-assigned-missions*', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: deliveries() });
    bodies.push(r.request().postDataJSON());
    return bodies.length === 1
      ? r.fulfill({ status: 503, json: { error: 'Unavailable' } })
      : r.fulfill({ json: receipt() });
  });
  await page.route('**/account/missions/*', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<h1>Original report protocol fixture</h1>' }),
  );
  await page.goto(origin);
  await page.getByRole('checkbox', { name: /I understand this saves/ }).check();
  await page.getByRole('button', { name: 'Save and open approved report' }).click();
  await expect(page.getByText(/Saving was not confirmed/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry saving the same report' }).click();
  await expect(page).toHaveURL(origin + '/account/missions/' + resource);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
});
test('staff explicitly reviews original request/report and retries an uncertain approval without duplication', async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/workspace/customer-mission-delivery*', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: review() });
    const body = r.request().postDataJSON();
    bodies.push(body);
    return bodies.length === 1
      ? r.fulfill({ status: 503, json: { error: 'Unavailable' } })
      : r.fulfill({ json: { id: body.commandId } });
  });
  await page.goto(origin + '?staff=1');
  await page
    .getByText('Deliver a reviewed mission to the customer account', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Load account delivery review' }).click();
  await page.getByRole('radio', { name: /Original approved client report/ }).check();
  await page
    .getByLabel('Reason for account delivery')
    .fill('Explicit fictional creator-only delivery');
  await page.getByRole('checkbox', { name: /I reviewed the report scope/ }).check();
  await page.getByRole('button', { name: 'Approve account delivery' }).click();
  await expect(page.getByText(/Delivery was not confirmed/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry the same delivery approval' }).click();
  await expect(
    page.getByText(/Reviewed report delivered to the original request creator account/),
  ).toBeVisible();
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({ requestId, linkId: link, approved: true });
});
test('missing customer binding and gated staff review expose no fake approval form', async ({
  page,
}) => {
  for (const [payload, status, message] of [
    [{ ...review(), request: null, links: [] }, 200, 'This mission has no customer-owned request'],
    [{ error: 'Unavailable' }, 503, 'Account delivery review is unavailable'],
  ] as const) {
    await page.route('**/api/workspace/customer-mission-delivery*', (r) =>
      r.fulfill({ status, json: payload }),
    );
    await page.goto(origin + '?staff=1');
    await page
      .getByText('Deliver a reviewed mission to the customer account', { exact: true })
      .click();
    await page.getByRole('button', { name: 'Load account delivery review' }).click();
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve account delivery' })).toHaveCount(0);
    await page.unroute('**/api/workspace/customer-mission-delivery*');
  }
});
test('both real components support keyboard,WCAG and mobile/tablet/desktop widths', async ({
  page,
}) => {
  await page.route('**/api/customer-assigned-missions*', (r) => r.fulfill({ json: deliveries() }));
  await page.route('**/api/workspace/customer-mission-delivery*', (r) =>
    r.fulfill({ json: review() }),
  );
  await mkdir('.cache/v3-customer-delivery/after', { recursive: true });
  for (const staff of [false, true]) {
    await page.goto(origin + (staff ? '?staff=1' : ''));
    if (staff) {
      await page
        .getByText('Deliver a reviewed mission to the customer account', { exact: true })
        .click();
      await page.getByRole('button', { name: 'Load account delivery review' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Reason for account delivery')).toBeVisible();
    } else await expect(page.getByRole('heading', { name: item().title })).toBeVisible();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path:
          '.cache/v3-customer-delivery/after/' +
          (staff ? 'staff' : 'customer') +
          '-' +
          width +
          '.png',
        fullPage: true,
      });
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
});
