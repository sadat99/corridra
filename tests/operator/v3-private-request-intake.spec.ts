import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual components with invented provider/API protocol fixtures only.
// Restricted PostgreSQL authority is separately tested; private provider acceptance is not implied.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let server: Server, origin: string;
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) =>
    console.error('Protocol fixture browser error: ' + error.message),
  );
});
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { PrivateRequestIntake } from ${JSON.stringify(resolve('apps/web/app/account/request/private-request-intake.tsx'))};
        import { AccountSignout } from ${JSON.stringify(resolve('apps/web/app/account/signout.tsx'))};
        const query = new URLSearchParams(location.search);
        const subject = query.get('subject') || 'synthetic-alice';
        const issuer = query.get('issuer') || ${JSON.stringify(issuer)};
        const workspaceId=query.get('workspace')||'00000000-0000-4000-8000-000000000010';
        const root=createRoot(document.getElementById('fixture'));
        root.render(query.has('logout')?<AccountSignout/>:query.has('before')?null:<PrivateRequestIntake subject={subject} issuer={issuer} workspaceId={workspaceId} />);
        window.addEventListener('fixture-customer-change',event=>root.render(<PrivateRequestIntake subject={event.detail.subject} issuer={event.detail.issuer} workspaceId={event.detail.workspaceId} />));`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    // Next normally replaces browser environment references. The standalone
    // protocol bundle must supply the same empty public environment boundary.
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    metafile: true,
    plugins: [
      {
        name: 'controlled-logout-protocol',
        setup(builder) {
          builder.onResolve({ filter: /^next\/navigation$/ }, (args) =>
            /\/(app\/account\/signout\.tsx|components\/use-sign-out\.ts)$/.test(args.importer)
              ? { path: 'router', namespace: 'logout-fixture' }
              : undefined,
          );
          builder.onResolve({ filter: /neon-auth-client$/ }, (args) =>
            /\/(app\/account\/signout\.tsx|components\/use-sign-out\.ts)$/.test(args.importer)
              ? { path: 'provider', namespace: 'logout-fixture' }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'logout-fixture' }, (args) => ({
            loader: 'js',
            contents:
              args.path === 'provider'
                ? 'export const accountClient={signOut:async()=>({error:window.__logoutFailure?{message:"Invented provider denial"}:null})};'
                : 'export function useRouter(){return {replace:path=>{window.__navigation=path},refresh:()=>{window.__refreshed=true}};}',
          }));
        },
      },
    ],
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
const workspaceId = '00000000-0000-4000-8000-000000000010';
const privatePrefix = 'corridra:private-request:v1:';
const original = '原始机器要求。 কাল্পনিক যন্ত্রপাতির পরীক্ষামূলক বিবরণ।';
const ack = { id: '00000000-0000-4000-8000-000000000011', workspaceId, synthetic: true };
async function complete(page: Page) {
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
    'machinery_procurement',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Where is the company based?', exact: true }),
  ).toHaveValue('BD');
  await expect(
    page.getByRole('combobox', { name: 'Which market is involved?', exact: true }),
  ).toHaveValue('CN');
  await page.getByLabel('No', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Your offer or requirement').fill(original);
  await page
    .getByLabel('Technical purpose (optional)', { exact: true })
    .fill('Synthetic private machinery assessment');
  await page.getByText('Budget context (optional)', { exact: true }).click();
  await page.getByLabel('Budget in original currency (optional)', { exact: true }).fill('1.234');
  await page.getByRole('combobox', { name: 'Original currency', exact: true }).selectOption('BHD');
  await page
    .getByLabel('Budget basis, such as total equipment budget', { exact: true })
    .fill('Original synthetic private requirement');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Relevant meetings', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic Private Request Person');
  await page.getByLabel('Company', { exact: true }).fill('Synthetic Private Equipment Company');
  await page.getByLabel('Work email', { exact: true }).fill('private@example.invalid');
  await page.getByLabel('I have read the test intake notice', { exact: false }).check();
}
const start = '/?job=machinery_procurement&companyCountry=BD&marketCode=CN';

test('private guided submission retains structured original inputs and uses the real private port only', async ({
  page,
}) => {
  const writes: unknown[] = [];
  let anonymous = 0;
  await page.route('**/api/intake', (route) => {
    anonymous++;
    return route.fulfill({ status: 500, json: { error: 'Wrong intake port' } });
  });
  await page.route('**/api/customer-requests', async (route) => {
    const request = route.request();
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    writes.push(request.postDataJSON());
    await route.fulfill({ json: ack });
  });
  await page.goto(origin + start);
  await complete(page);
  await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your private sample request is saved.', exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(anonymous).toBe(0);
  expect(writes[0]).toMatchObject({
    workspaceId,
    commandId: expect.any(String),
    brief: {
      offer: original,
      experience: { requirements: { budgetMinor: '1234', currency: 'BHD' } },
    },
  });
  expect(writes[0]).not.toHaveProperty('key');
  expect(writes[0]).not.toHaveProperty('receipt');
  expect(
    await page.evaluate(
      (prefix) => Object.keys(sessionStorage).filter((key) => key.startsWith(prefix)),
      privatePrefix,
    ),
  ).toEqual([]);
  await expect(
    page.getByText('A saved request is not an accepted engagement, meeting or deal.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Private receipt code', { exact: true })).toHaveCount(0);
});

test('lost response and reload freeze the original command and payload for an exact safe retry', async ({
  page,
}) => {
  const writes: unknown[] = [];
  await page.route('**/api/customer-requests', async (route) => {
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) await route.abort('failed');
    else await route.fulfill({ json: ack });
  });
  await page.goto(origin + start);
  await complete(page);
  await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry original request', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Your private sample request is saved.', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Your offer or requirement')).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Retry original request', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retry original request', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your private sample request is saved.', exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

test('private drafts never resume anonymous or another account and keep independent legacy receipts', async ({
  page,
}) => {
  await page.goto(origin + start);
  await page.evaluate(
    ({ issuer, workspaceId, prefix }) => {
      sessionStorage.setItem('corridra-mission-receipt', 'd'.repeat(64));
      sessionStorage.setItem(
        'corridra-mission-draft',
        JSON.stringify({
          version: 2,
          at: Date.now(),
          key: crypto.randomUUID(),
          step: 4,
          draft: { offer: 'Anonymous original sample requirement', outcomes: [] },
        }),
      );
      const key =
        prefix + encodeURIComponent(JSON.stringify([issuer, 'synthetic-bob', workspaceId]));
      sessionStorage.setItem(
        key + ':draft',
        JSON.stringify({
          version: 2,
          at: Date.now(),
          key: crypto.randomUUID(),
          step: 2,
          draft: { offer: 'Other account private requirement', outcomes: [] },
        }),
      );
    },
    { issuer, workspaceId, prefix: privatePrefix },
  );
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toBeVisible();
  await expect(page.getByLabel('Private receipt code', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('No', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Your offer or requirement')).toHaveValue('');
  expect(await page.evaluate(() => sessionStorage.getItem('corridra-mission-receipt'))).toBe(
    'd'.repeat(64),
  );
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('corridra-mission-draft')!).draft.offer,
    ),
  ).toBe('Anonymous original sample requirement');
});

test('malformed acknowledgement retains the pending request and permission denial clears only its scope', async ({
  page,
}) => {
  let denied = false;
  const writes: unknown[] = [];
  await page.route('**/api/customer-requests', async (route) => {
    writes.push(route.request().postDataJSON());
    await route.fulfill({
      status: denied ? 403 : 200,
      json: denied
        ? { error: 'Invented denial' }
        : { ...ack, workspaceId: '00000000-0000-4000-8000-000000000020' },
    });
  });
  await page.goto(origin + start);
  await complete(page);
  await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('acknowledgement could not be confirmed');
  await expect(
    page.getByRole('heading', { name: 'Your private sample request is saved.', exact: true }),
  ).toHaveCount(0);
  denied = true;
  await page.getByRole('button', { name: 'Retry original request', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Reload your account', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry original request', exact: true }),
  ).toHaveCount(0);
  expect(writes[1]).toEqual(writes[0]);
  expect(
    await page.evaluate(
      (prefix) => Object.keys(sessionStorage).filter((key) => key.startsWith(prefix)),
      privatePrefix,
    ),
  ).toEqual([]);
});

test('blocked retry storage sends no command and an invalid saved retry cannot create a request', async ({
  page,
}) => {
  let writes = 0;
  await page.route('**/api/customer-requests', (route) => {
    writes++;
    return route.fulfill({ json: ack });
  });
  await page.goto(origin + start);
  await complete(page);
  await page.evaluate((prefix) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith(prefix) && key.endsWith(':pending'))
        throw new DOMException('Blocked storage', 'SecurityError');
      return original.call(this, key, value);
    };
  }, privatePrefix);
  await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'No new request was sent' }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await page.reload();
  await page.evaluate(
    ({ prefix, issuer, workspaceId }) => {
      const key =
        prefix +
        encodeURIComponent(JSON.stringify([issuer, 'synthetic-alice', workspaceId])) +
        ':pending';
      sessionStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          workspaceId: 'wrong-workspace',
          commandId: crypto.randomUUID(),
          at: Date.now(),
          brief: { offer: 'Do not display another workspace' },
        }),
      );
    },
    { prefix: privatePrefix, issuer, workspaceId },
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Check your saved requests');
  expect(writes).toBe(0);
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveCount(0);
});

test('private sample request fields retain accessible responsive layouts and native keyboard controls', async ({
  page,
}) => {
  await page.goto(origin + start);
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toBeVisible();
  await mkdir('.cache/v3-private-intake/after', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: '.cache/v3-private-intake/after/intake-' + width + '.png',
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Continue', exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('combobox', { name: 'Where is the company based?', exact: true }),
  ).toBeVisible();
});

test('changing account context aborts an in-flight private write without displaying its late acknowledgement', async ({
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
  await page.route('**/api/customer-requests', async (route) => {
    observed();
    await held;
    try {
      await route.fulfill({ json: ack });
    } catch {
      /* The old identity request was canceled. */
    }
  });
  await page.goto(origin + start);
  await complete(page);
  await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
  await started;
  try {
    await page.evaluate(
      ({ issuer, workspaceId }) =>
        window.dispatchEvent(
          new CustomEvent('fixture-customer-change', {
            detail: { issuer, subject: 'synthetic-bob', workspaceId },
          }),
        ),
      { issuer, workspaceId },
    );
    await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(
    page.getByRole('heading', { name: 'Your private sample request is saved.', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Retry original request', exact: true }),
  ).toHaveCount(0);
});

test('confirmed customer logout clears only private request drafts and keeps independent public recovery', async ({
  page,
}) => {
  await page.goto(origin + '/?logout=1');
  await page.evaluate((prefix) => {
    sessionStorage.setItem(prefix + 'alice:pending', 'invented pending');
    sessionStorage.setItem(prefix + 'bob:draft', 'invented draft');
    sessionStorage.setItem('corridra-mission-receipt', 'independent public receipt marker');
    sessionStorage.setItem('corridra-mission-draft', 'independent public draft marker');
  }, privatePrefix);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __navigation?: string }).__navigation))
    .toBe('/signin');
  expect(
    await page.evaluate(
      (prefix) => Object.keys(sessionStorage).filter((key) => key.startsWith(prefix)),
      privatePrefix,
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem('corridra-mission-receipt'))).toBe(
    'independent public receipt marker',
  );
  expect(await page.evaluate(() => sessionStorage.getItem('corridra-mission-draft'))).toBe(
    'independent public draft marker',
  );
});

test('failed customer logout preserves private recovery and can retry the unchanged provider action', async ({
  page,
}) => {
  await page.goto(origin + '/?logout=1');
  await page.evaluate((prefix) => {
    sessionStorage.setItem(prefix + 'alice:pending', 'invented pending');
    Object.assign(window, { __logoutFailure: true });
  }, privatePrefix);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Sign-out could not be completed. Please try again.',
  );
  expect(
    await page.evaluate(
      (prefix) => sessionStorage.getItem(prefix + 'alice:pending'),
      privatePrefix,
    ),
  ).toBe('invented pending');
  expect(
    await page.evaluate(() => (window as unknown as { __navigation?: string }).__navigation),
  ).toBeUndefined();
  await page.evaluate(() => Object.assign(window, { __logoutFailure: false }));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __navigation?: string }).__navigation))
    .toBe('/signin');
  expect(
    await page.evaluate(
      (prefix) => sessionStorage.getItem(prefix + 'alice:pending'),
      privatePrefix,
    ),
  ).toBeNull();
});

test('restoring a hidden private form reloads server authority and resumes only the scoped draft', async ({
  page,
}) => {
  await page.goto(origin + start);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('No', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Your offer or requirement').fill(original);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  );
  await expect(page.getByRole('status')).toHaveText(
    'Rechecking account access before restoring your private draft…',
  );
  await expect(page.getByLabel('Your offer or requirement')).toHaveCount(0);
  const navigation = page.waitForResponse(
    (response) => response.request().isNavigationRequest() && response.url().startsWith(origin),
  );
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await navigation;
  await expect(page.getByLabel('Your offer or requirement')).toHaveValue(original);
});
