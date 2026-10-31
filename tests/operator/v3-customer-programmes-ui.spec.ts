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
      contents: `import {createRoot} from 'react-dom/client';import {CustomerProgrammes} from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};import {CustomerWorkspaces} from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
        const query=new URLSearchParams(location.search);const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)},workspaceId:'00000000-0000-4000-8000-000000000001'};const render=props=>query.get('mode')==='workspaces'?<CustomerWorkspaces {...props} programmesEnabled={query.get('enabled')==='true'}/>:<CustomerProgrammes {...props}/>;root.render(render(initial));window.addEventListener('fixture-customer-change',event=>root.render(render({...initial,...event.detail})));`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
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

const workspaceId = '00000000-0000-4000-8000-000000000001';
const programme = {
  id: '00000000-0000-4000-8000-000000000002',
  workspaceId,
  name: 'Synthetic commercial delegation 工厂 বাংলা',
  reportingPurpose: 'Fictional participant needs and commercial objectives',
  createdAt: '2026-10-18T00:00:00Z',
  synthetic: true,
};
const list = (programmes: unknown[] = [], nextAfter: string | null = null) => ({
  workspaceId,
  programmes,
  nextAfter,
  synthetic: true,
});
async function fill(page: import('@playwright/test').Page) {
  await page.getByLabel('Programme name', { exact: true }).fill(programme.name);
  await page
    .getByLabel('Purpose and intended outcomes', { exact: true })
    .fill(programme.reportingPurpose);
  await page.getByRole('checkbox').check();
}
test('creates a real planning command with scoped headers then displays acknowledged canonical metadata only', async ({
  page,
}) => {
  let saved = false;
  let command: Record<string, unknown> | undefined;
  await page.route('**/api/customer-programmes*', async (route) => {
    const request = route.request();
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    if (request.method() === 'GET') return route.fulfill({ json: list(saved ? [programme] : []) });
    command = request.postDataJSON();
    saved = true;
    await route.fulfill({ json: programme });
  });
  await page.goto(origin);
  await expect(page.getByText('No sample programmes yet.')).toBeVisible();
  await fill(page);
  await page.getByRole('button', { name: 'Save sample programme', exact: true }).click();
  await expect(page.getByRole('heading', { name: programme.name })).toBeVisible();
  expect(command).toMatchObject({
    workspaceId,
    name: programme.name,
    reportingPurpose: programme.reportingPurpose,
    acknowledged: true,
  });
  expect(command?.commandId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Programme name', { exact: true })).toHaveValue('');
  await expect(
    page.getByText(
      /Participant invitations, private missions, dates, agendas, meetings, fees and costs are not available/,
    ),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to my workspaces' })).toHaveAttribute(
    'href',
    '/account#customer-workspaces',
  );
  expect(
    await page.evaluate(
      () => Object.keys(localStorage).length + Object.keys(sessionStorage).length,
    ),
  ).toBe(0);
});
test('lost acknowledgement freezes exact command and retries without duplicating or inventing success', async ({
  page,
}) => {
  const commands: unknown[] = [];
  let saved = false;
  await page.route('**/api/customer-programmes*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: list(saved ? [programme] : []) });
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) return route.abort('failed');
    saved = true;
    return route.fulfill({ json: programme });
  });
  await page.goto(origin);
  await expect(page.getByText('No sample programmes yet.')).toBeVisible();
  await fill(page);
  await page.getByRole('button', { name: 'Save sample programme', exact: true }).click();
  await expect(page.getByText(/Saving could not be confirmed/)).toBeVisible();
  await expect(page.getByLabel('Programme name', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry same planning request' }).click();
  await expect(page.getByRole('heading', { name: programme.name })).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});
test('account and workspace changes remount scope and clear old drafts and programme content', async ({
  page,
}) => {
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill(
      route.request().headers()['x-corridra-customer-subject'] === 'synthetic-alice'
        ? { json: list([programme]) }
        : { status: 403, json: { error: 'denied' } },
    ),
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: programme.name })).toBeVisible();
  await fill(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', { detail: { subject: 'synthetic-bob' } }),
    ),
  );
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByText(programme.name, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Programme name', { exact: true })).toHaveCount(0);
});
test('interruption hides private planning and resumes an unsent draft only after fresh same-scope access', async ({
  page,
}) => {
  let allowed = true;
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill(
      allowed ? { json: list([programme]) } : { status: 403, json: { error: 'denied' } },
    ),
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: programme.name })).toBeVisible();
  await fill(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.getByRole('heading', { name: programme.name })).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByLabel('Programme name', { exact: true })).toHaveValue(programme.name);
  allowed = false;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByLabel('Programme name', { exact: true })).toHaveCount(0);
});
test('malformed and unavailable lists show recovery without exposing untrusted records', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/customer-programmes*', (route) => {
    calls++;
    return route.fulfill(
      calls === 1
        ? { status: 503, json: { error: 'unavailable' } }
        : calls === 2
          ? { json: list([{ ...programme, workspaceId: '00000000-0000-4000-8000-000000000099' }]) }
          : { json: list() },
    );
  });
  await page.goto(origin);
  await expect(page.getByRole('status')).toContainText('unavailable');
  await page.getByRole('button', { name: 'Reload planning programmes' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.getByRole('heading', { name: programme.name })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reload planning programmes' }).click();
  await expect(page.getByText('No sample programmes yet.')).toBeVisible();
});
test('wrong-scope create acknowledgement remains unconfirmed and retains exact retry', async ({
  page,
}) => {
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'GET'
          ? list()
          : { ...programme, workspaceId: '00000000-0000-4000-8000-000000000099' },
    }),
  );
  await page.goto(origin);
  await expect(page.getByText('No sample programmes yet.')).toBeVisible();
  await fill(page);
  await page.getByRole('button', { name: 'Save sample programme', exact: true }).click();
  await expect(page.getByText(/Saving could not be confirmed/)).toBeVisible();
  await expect(page.getByRole('heading', { name: programme.name })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry same planning request' })).toBeVisible();
});
test('pagination appends only the next workspace-scoped planning page', async ({ page }) => {
  const second = {
    ...programme,
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Second fictional programme',
  };
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has('after')
        ? list([second])
        : list([programme], programme.id),
    }),
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: programme.name })).toBeVisible();
  await page.getByRole('button', { name: 'Load more planning programmes' }).click();
  await expect(page.getByRole('heading', { name: second.name })).toBeVisible();
  await expect(page.getByRole('heading', { name: programme.name })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Load more planning programmes' })).toHaveCount(0);
});
test('planning supports keyboard,axe and four responsive widths without losing original long text', async ({
  page,
}) => {
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({ json: list([{ ...programme, name: 'Original' + 'long'.repeat(35) }]) }),
  );
  await mkdir('.cache/v3-programmes/after', { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin);
    await expect(page.getByRole('heading', { name: /Originallong/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: '.cache/v3-programmes/after/planning-' + width + '.png',
      fullPage: true,
    });
  }
  await page.getByLabel('Programme name', { exact: true }).focus();
  await page.keyboard.type('Fictional keyboard programme');
  await expect(page.getByLabel('Programme name', { exact: true })).toHaveValue(
    'Fictional keyboard programme',
  );
});

test('unsaved planning warns before leaving instead of silently discarding the draft', async ({
  page,
}) => {
  await page.route('**/api/customer-programmes*', (route) => route.fulfill({ json: list() }));
  await page.goto(origin);
  await expect(page.getByText('No sample programmes yet.')).toBeVisible();
  await fill(page);
  const warning = page.waitForEvent('dialog').then(async (dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
  });
  await Promise.all([warning, page.getByRole('link', { name: 'Back to my workspaces' }).click()]);
  await expect(page.getByLabel('Programme name', { exact: true })).toHaveValue(programme.name);
});

test('planning entry stays contextual to current owner/admin workspace cards and its feature flag', async ({
  page,
}) => {
  const ids = [
    workspaceId,
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
  ];
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({
      json: {
        synthetic: true,
        workspaces: ['owner', 'admin', 'member'].map((role, n) => ({
          id: ids[n],
          name: 'Synthetic ' + role + ' workspace',
          role,
          synthetic: true,
          organisationId: null,
        })),
      },
    }),
  );
  await page.route('**/api/customer-workspace-access*', (route) =>
    route.fulfill({
      json: {
        workspaceId,
        ownerProtected: true,
        nextInvitationAfter: null,
        nextMemberAfter: null,
        invitations: [],
        memberships: [],
      },
    }),
  );
  await page.goto(origin + '/?mode=workspaces&enabled=true');
  // UX-07: secondary workspace actions sit in each workspace's More menu.
  await expect(page.locator('details.ux-more-menu > summary')).toHaveCount(2);
  for (const more of await page.locator('details.ux-more-menu > summary').all()) await more.click();
  const links = page.getByRole('link', { name: 'Plan delegations' });
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAttribute('href', '/account/delegations/' + ids[0]);
  await expect(links.nth(1)).toHaveAttribute('href', '/account/delegations/' + ids[1]);
  await page.getByText('Manage team', { exact: true }).click();
  await expect(page.getByText('No sample invitations on this page.')).toBeVisible();
  await page.goto(origin + '/?mode=workspaces&enabled=false');
  await expect(page.getByText('Synthetic owner workspace', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Plan delegations' })).toHaveCount(0);
});
