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
      contents: `import {createRoot} from 'react-dom/client';import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';import {ProgrammeObjectiveEditor} from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-objective-editor.tsx'))};const root=createRoot(document.getElementById('fixture'));const query=new URLSearchParams(location.search);const initial={subject:'synthetic-bob',issuer:${JSON.stringify(issuer)},registrationId:'00000000-0000-4000-8000-000000000004',view:query.get('mode')==='owner'?'manage':'own'};const router={push:path=>location.assign(path),replace:path=>location.replace(path),back:()=>history.back(),forward:()=>history.forward(),refresh:()=>{},hmrRefresh:()=>{},prefetch:async()=>{}};const render=p=>{const all={...initial,...p};root.render(<AppRouterContext.Provider value={router}><ProgrammeObjectiveEditor key={all.issuer+all.subject+all.registrationId+all.view} {...all}/></AppRouterContext.Provider>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
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
    } else if (path === '/' || path === '/account/delegations') {
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
const registrationId = '00000000-0000-4000-8000-000000000004',
  requestId = '00000000-0000-4000-8000-000000000005',
  linkId = '00000000-0000-4000-8000-000000000006';
const shared = (own = true) => ({
  id: linkId,
  version: 1,
  status: 'SHARED',
  summary: 'Synthetic supplier objective 工厂 বাংলা',
  claimStatus: 'Self-declared',
  sharedAt: '2026-10-18T00:00:00Z',
  ...(own ? { requestId } : {}),
});
const view = (
  rows: unknown[] = [],
  nextAfter: string | null = null,
  expiry = Date.now() + 60000,
) => ({
  registrationId,
  synthetic: true,
  active: true,
  objectives: rows,
  nextAfter,
  viewExpiresAt: new Date(expiry).toISOString(),
});
const choices = () => ({
  registrationId,
  synthetic: true,
  requests: [
    {
      id: requestId,
      label: 'Synthetic original private machinery request 工厂 বাংলা',
      available: true,
    },
  ],
  nextAfter: null,
  viewExpiresAt: new Date(Date.now() + 60000).toISOString(),
});
async function draft(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Choose an existing private request' }).click();
  await page.getByLabel('Original private request', { exact: true }).selectOption(requestId);
  await page
    .getByLabel('Fictional objective to share')
    .fill('Synthetic supplier objective 工厂 বাংলা');
  await page.getByLabel('I consent to programme organisers').check();
}
test('participant shares explicit text through a scoped real command and reopens only their original relative request', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-objectives*', async (r) => {
    expect(r.request().headers()['x-corridra-customer-subject']).toBe('synthetic-bob');
    if (r.request().method() === 'POST') {
      posts.push(r.request().postDataJSON());
      await r.fulfill({
        json: { id: linkId, registrationId, version: 1, status: 'SHARED', synthetic: true },
      });
    } else
      await r.fulfill({
        json:
          new URL(r.request().url()).searchParams.get('view') === 'choices'
            ? choices()
            : view(posts.length ? [shared()] : []),
      });
  });
  await page.goto(origin);
  await draft(page);
  await page.getByRole('button', { name: 'Share objective with organisers' }).click();
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    action: 'share',
    registrationId,
    requestId,
    summary: 'Synthetic supplier objective 工厂 বাংলা',
    expectedVersion: 0,
    consented: true,
  });
  expect(posts[0].commandId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(
    page.getByRole('link', { name: 'Open my original private request' }),
  ).toHaveAttribute('href', '/account/requests/' + requestId);
  await expect(page.getByLabel('Fictional objective to share')).toHaveCount(0);
});
test('organiser can only read consented summary and has no private link,choice,share or withdraw controls', async ({
  page,
}) => {
  await page.route('**/api/customer-programme-objectives*', (r) => {
    expect(r.request().method()).toBe('GET');
    expect(new URL(r.request().url()).searchParams.get('view')).toBe('manage');
    return r.fulfill({ json: view([shared(false)]) });
  });
  await page.goto(origin + '/?mode=owner');
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Choose an existing|Withdraw this|Share objective/ }),
  ).toHaveCount(0);
  await expect(page.locator('form')).toHaveCount(0);
});
test('withdrawal confirms beside the chosen objective and retains exact independent-rights disclosure', async ({
  page,
}) => {
  let withdrawn = false;
  await page.route('**/api/customer-programme-objectives*', async (r) => {
    if (r.request().method() === 'POST') {
      expect(r.request().postDataJSON()).toMatchObject({
        action: 'withdraw',
        linkId,
        expectedVersion: 1,
        acknowledged: true,
        reason: 'Synthetic explicit withdrawal',
      });
      withdrawn = true;
      await r.fulfill({
        json: { id: linkId, registrationId, version: 2, status: 'WITHDRAWN', synthetic: true },
      });
    } else
      await r.fulfill({
        json: view(
          withdrawn ? [{ id: linkId, version: 2, status: 'WITHDRAWN', requestId }] : [shared()],
        ),
      });
  });
  await page.goto(origin);
  await expect(page.getByLabel('Reason for objective withdrawal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Withdraw this shared objective' }).click();
  const row = page.locator('li').filter({ hasText: 'Synthetic supplier objective 工厂 বাংলা' });
  await row.getByLabel('Reason for objective withdrawal').fill('Synthetic explicit withdrawal');
  await row.getByLabel('I understand this ends objective sharing').check();
  await row.getByRole('button', { name: 'Confirm objective withdrawal' }).click();
  await expect(page.getByText('Objective sharing withdrawn.', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toHaveCount(0);
});
test('uncertain network result preserves command identity and payload on exact retry', async ({
  page,
}) => {
  const sent: unknown[] = [];
  await page.route('**/api/customer-programme-objectives*', async (r) => {
    if (r.request().method() === 'POST') {
      sent.push(r.request().postDataJSON());
      if (sent.length === 1) await r.fulfill({ status: 500, json: { error: 'uncertain' } });
      else
        await r.fulfill({
          json: { id: linkId, registrationId, version: 1, status: 'SHARED', synthetic: true },
        });
    } else
      await r.fulfill({
        json:
          new URL(r.request().url()).searchParams.get('view') === 'choices'
            ? choices()
            : view(sent.length > 1 ? [shared()] : []),
      });
  });
  await page.goto(origin);
  await draft(page);
  await page.getByRole('button', { name: 'Share objective with organisers' }).click();
  await expect(page.getByRole('button', { name: 'Retry exact objective change' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload shared objectives' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry exact objective change' }).click();
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toBeVisible();
  expect(sent[1]).toEqual(sent[0]);
});
test('permission denial removes original references,drafts and controls', async ({ page }) => {
  await page.route('**/api/customer-programme-objectives*', async (r) => {
    if (r.request().method() === 'POST')
      await r.fulfill({ status: 403, json: { error: 'denied' } });
    else
      await r.fulfill({
        json:
          new URL(r.request().url()).searchParams.get('view') === 'choices'
            ? choices()
            : view([shared()]),
      });
  });
  await page.goto(origin);
  await draft(page);
  await page.getByRole('button', { name: 'Update shared objective' }).click();
  await expect(
    page.getByText('Access changed. Private details and drafts were cleared.'),
  ).toBeVisible();
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);
  await expect(page.locator('form')).toHaveCount(0);
});
test('scope mismatch and unexpected private organiser fields fail closed', async ({ page }) => {
  await page.route('**/api/customer-programme-objectives*', (r) =>
    r.fulfill({ json: view([shared()]) }),
  );
  await page.goto(origin + '/?mode=owner');
  await expect(
    page.getByText('Objective access could not be checked. Reload to try again.'),
  ).toBeVisible();
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toHaveCount(0);
  await page.route('**/api/customer-programme-objectives*', (r) =>
    r.fulfill({ json: { ...view([]), registrationId: requestId } }),
  );
  await page.getByRole('button', { name: 'Reload shared objectives' }).click();
  await expect(
    page.getByText('Objective access could not be checked. Reload to try again.'),
  ).toBeVisible();
});
test('expiry and page hiding erase private snapshots and drafts', async ({ page }) => {
  await page.clock.install();
  let reads = 0;
  await page.route('**/api/customer-programme-objectives*', (r) =>
    r.fulfill({ json: view([shared()], null, Date.now() + (++reads === 1 ? 1500 : 60000)) }),
  );
  await page.goto(origin);
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(2000);
  await expect(
    page.getByText('Private details and drafts were cleared. Reload to check current access.'),
  ).toBeVisible();
  await expect(page.getByRole('link')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reload shared objectives' }).click();
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toHaveCount(0);
});
test('stale concurrent edit is rejected with recovery instead of an invented success', async ({
  page,
}) => {
  await page.route('**/api/customer-programme-objectives*', async (r) => {
    if (r.request().method() === 'POST')
      await r.fulfill({ status: 400, json: { error: 'version conflict' } });
    else
      await r.fulfill({
        json:
          new URL(r.request().url()).searchParams.get('view') === 'choices' ? choices() : view([]),
      });
  });
  await page.goto(origin);
  await draft(page);
  await page.getByRole('button', { name: 'Share objective with organisers' }).click();
  await expect(
    page.getByText('This change was not accepted. Reload to check the latest objective version.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry exact objective change' })).toHaveCount(0);
  await expect(page.getByLabel('Fictional objective to share')).toHaveValue(
    'Synthetic supplier objective 工厂 বাংলা',
  );
});
for (const width of [320, 390, 768, 1440])
  test(
    'objective privacy controls remain keyboard accessible and fit ' + width,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.route('**/api/customer-programme-objectives*', (r) =>
        r.fulfill({
          json:
            new URL(r.request().url()).searchParams.get('view') === 'choices'
              ? choices()
              : view([shared()]),
        }),
      );
      await page.goto(origin);
      await expect(
        page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Withdraw this shared objective' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Reason for objective withdrawal')).toBeVisible();
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await mkdir('.cache/v3-mission-shares/after', { recursive: true });
      await page.screenshot({
        path: '.cache/v3-mission-shares/after/own-' + width + '.png',
        fullPage: true,
      });
    },
  );
test('account changes clear old objectives and drafts before checking the new identity', async ({
  page,
}) => {
  await page.route('**/api/customer-programme-objectives*', async (r) => {
    if (r.request().headers()['x-corridra-customer-subject'] === 'synthetic-carol')
      await r.fulfill({ status: 403, json: { error: 'denied' } });
    else
      await r.fulfill({
        json:
          new URL(r.request().url()).searchParams.get('view') === 'choices'
            ? choices()
            : view([shared()]),
      });
  });
  await page.goto(origin);
  await draft(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', { detail: { subject: 'synthetic-carol' } }),
    ),
  );
  await expect(
    page.getByText('Objective access could not be checked. Reload to try again.'),
  ).toBeVisible();
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);
});
test('pagination does not extend the original private display deadline', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/customer-programme-objectives*', async (r) => {
    const q = new URL(r.request().url()).searchParams;
    await r.fulfill({
      json: q.has('after')
        ? view(
            [
              {
                ...shared(),
                id: '00000000-0000-4000-8000-000000000007',
                summary: 'Synthetic second objective',
              },
            ],
            null,
            Date.now() + 60000,
          )
        : view([shared()], linkId, Date.now() + 1500),
    });
  });
  await page.goto(origin);
  await expect(
    page.getByText('Synthetic supplier objective 工厂 বাংলা', { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(1000);
  await page.getByRole('button', { name: 'Load more shared objectives' }).click();
  await expect(page.getByText('Synthetic second objective', { exact: true })).toBeVisible();
  await page.clock.fastForward(1000);
  await expect(
    page.getByText('Private details and drafts were cleared. Reload to check current access.'),
  ).toBeVisible();
  await expect(page.getByText('Synthetic second objective', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);
});
test('unsaved draft prevents tool closure and uses a real interrupted-navigation warning', async ({
  page,
}) => {
  await page.route('**/api/customer-programme-objectives*', (r) =>
    r.fulfill({
      json:
        new URL(r.request().url()).searchParams.get('view') === 'choices' ? choices() : view([]),
    }),
  );
  await page.goto(origin);
  await draft(page);
  const allowed = await page.evaluate(
    ({ registrationId }) =>
      window.dispatchEvent(
        new CustomEvent('corridra-objective-close', {
          cancelable: true,
          detail: { registrationId, view: 'own' },
        }),
      ),
    { registrationId },
  );
  expect(allowed).toBe(false);
  await expect(
    page.getByText(
      'Your objective draft is unsaved. Save it or clear the text before closing these tools.',
    ),
  ).toBeVisible();
  const dialog = page.waitForEvent('dialog');
  const navigation = page.goto(origin + '/?leave=true').catch(() => null);
  const warning = await dialog;
  expect(warning.type()).toBe('beforeunload');
  await warning.dismiss();
  await navigation;
  await expect(page.getByLabel('Fictional objective to share')).toHaveValue(
    'Synthetic supplier objective 工厂 বাংলা',
  );
});
