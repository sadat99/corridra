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
      contents: `import {createRoot} from 'react-dom/client';import {CompanyPortfolio} from ${JSON.stringify(resolve('apps/web/app/account/companies/company-portfolio.tsx'))};const root=createRoot(document.getElementById('fixture'));const props={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)}};root.render(<CompanyPortfolio {...props}/>);window.addEventListener('fixture-customer-change',event=>root.render(<CompanyPortfolio {...props} {...event.detail}/>));`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
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

const resource = '00000000-0000-4000-8000-000000000001',
  secondResource = '00000000-0000-4000-8000-000000000002',
  target = '00000000-0000-4000-8000-000000000003';
const expires = '2026-12-01T00:00:00Z';
const context = {
  resourceId: resource,
  targetId: target,
  missionTitle: 'Approved buyer context',
  objective: 'Develop an international relationship',
  company: 'Synthetic canonical company 工厂 বাংলা',
  country: 'ES',
  fit: 'POSSIBLE',
  rationale: 'Original approved qualification',
  uncertainty: 'Interest has not been verified',
  gaps: 'Need a direct response',
  verification: 'Self-declared evidence, not independently verified',
  expiresAt: expires,
};
const company = { id: 'a'.repeat(64), contexts: [context] };
const pageData = (companies: unknown[] = [company], nextAfter: string | null = null) => ({
  companies,
  nextAfter,
  scopesRead: 1,
  unavailableScopes: 0,
  expiresAt: expires,
  synthetic: true,
});
test('approved company context preserves original qualification and opens the existing same-host mission', async ({
  page,
}) => {
  await page.route('**/api/customer-companies*', (route) => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(route.request().headers()['x-corridra-customer-issuer']).toBe(issuer);
    return route.fulfill({ json: pageData() });
  });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: context.company })).toHaveCount(1);
  await page.getByText(context.missionTitle, { exact: true }).click();
  await expect(page.getByText('Uncertainty: ' + context.uncertainty)).toBeVisible();
  await expect(page.getByText('Evidence gaps: ' + context.gaps)).toBeVisible();
  await expect(page.getByText(context.verification, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open approved commercial report' })).toHaveAttribute(
    'href',
    '/account/missions/' + resource,
  );
  expect(
    await page.evaluate(
      () => Object.keys(localStorage).length + Object.keys(sessionStorage).length,
    ),
  ).toBe(0);
});
test('pagination merges canonical company references while retaining separate report targets and purposes', async ({
  page,
}) => {
  const second = {
    ...context,
    resourceId: secondResource,
    targetId: '00000000-0000-4000-8000-000000000004',
    missionTitle: 'Approved sourcing context',
    objective: 'Review machinery supply',
  };
  await page.route('**/api/customer-companies*', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has('after')
        ? pageData([{ ...company, contexts: [second] }])
        : pageData([company], resource),
    }),
  );
  await page.goto(origin);
  await expect(
    page.getByText('More mission reports have not been loaded.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load companies from more missions' }).click();
  await expect(page.getByRole('heading', { name: context.company })).toHaveCount(1);
  await expect(page.getByText('2 approved report contexts', { exact: true })).toBeVisible();
  await page.getByText(second.missionTitle, { exact: true }).click();
  await expect(page.getByText(second.objective, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load companies from more missions' })).toHaveCount(
    0,
  );
});
test('search is explicitly limited to loaded companies and does not manufacture empty-scope totals', async ({
  page,
}) => {
  await page.route('**/api/customer-companies*', (route) =>
    route.fulfill({ json: pageData([company], resource) }),
  );
  await page.goto(origin);
  const search = page.getByLabel('Search loaded companies', { exact: true });
  await search.fill('not in this loaded scope');
  await expect(page.getByText('No loaded companies match this search.')).toBeVisible();
  await expect(page.getByRole('heading', { name: context.company })).toHaveCount(0);
  await search.fill('বাংলা');
  await expect(page.getByRole('heading', { name: context.company })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Load companies from more missions' }),
  ).toBeVisible();
});
test('account/issuer changes and denied refresh clear previous company and search state', async ({
  page,
}) => {
  await page.route('**/api/customer-companies*', (route) =>
    route.fulfill(
      route.request().headers()['x-corridra-customer-subject'] === 'synthetic-alice'
        ? { json: pageData() }
        : { status: 403, json: { error: 'denied' } },
    ),
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: context.company })).toBeVisible();
  await page.getByLabel('Search loaded companies').fill('Synthetic');
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', { detail: { subject: 'synthetic-bob' } }),
    ),
  );
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByText(context.company, { exact: false })).toHaveCount(0);
  await expect(page.getByLabel('Search loaded companies')).toHaveCount(0);
});
test('page interruption clears private company details and restoration requires fresh permission', async ({
  page,
}) => {
  let allowed = true;
  await page.route('**/api/customer-companies*', (route) =>
    route.fulfill(allowed ? { json: pageData() } : { status: 403, json: { error: 'denied' } }),
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: context.company })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.getByRole('heading', { name: context.company })).toHaveCount(0);
  allowed = false;
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByText(context.company, { exact: false })).toHaveCount(0);
});
test('malformed,unavailable and empty original scopes have honest recovery with no stale company name', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/customer-companies*', (route) => {
    calls++;
    return route.fulfill(
      calls === 1
        ? { status: 503, json: { error: 'unavailable' } }
        : calls === 2
          ? {
              json: pageData([
                {
                  ...company,
                  contexts: [{ ...context, resourceId: 'https://evil.invalid/private' }],
                },
              ]),
            }
          : { json: { ...pageData([]), unavailableScopes: 1 } },
    );
  });
  await page.goto(origin);
  await expect(page.getByRole('status')).toContainText('unavailable');
  await page.getByRole('button', { name: 'Refresh approved companies' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.getByRole('heading', { name: context.company })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh approved companies' }).click();
  await expect(
    page.getByText('No companies are approved in these saved mission reports yet.'),
  ).toBeVisible();
  await expect(page.getByText('1 saved report is unavailable.', { exact: false })).toBeVisible();
});
test('scope expiry clears loaded content without polling or retaining private browser state', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-18T00:00:00Z') });
  await page.route('**/api/customer-companies*', (route) => route.fulfill({ json: pageData() }));
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: context.company })).toBeVisible();
  await page.clock.fastForward(60001);
  await expect(page.getByRole('status')).toContainText('Earlier details have been cleared');
  await expect(page.getByRole('heading', { name: context.company })).toHaveCount(0);
  await expect(page.getByLabel('Search loaded companies')).toHaveCount(0);
});
test('malformed pagination cannot silently repeat the same scoped page', async ({ page }) => {
  await page.route('**/api/customer-companies*', (route) =>
    route.fulfill({ json: pageData([company], resource) }),
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: context.company })).toBeVisible();
  await page.getByRole('button', { name: 'Load companies from more missions' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.getByRole('heading', { name: context.company })).toHaveCount(0);
});
test('company continuity supports keyboard,axe and original script at mobile,tablet and desktop widths', async ({
  page,
}) => {
  await page.route('**/api/customer-companies*', (route) => route.fulfill({ json: pageData() }));
  await mkdir('.cache/v3-companies/after', { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin);
    await expect(page.getByRole('heading', { name: context.company })).toBeVisible();
    await page.getByText(context.missionTitle, { exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(context.verification, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: '.cache/v3-companies/after/companies-' + width + '.png',
      fullPage: true,
    });
  }
});
