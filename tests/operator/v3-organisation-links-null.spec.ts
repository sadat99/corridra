import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// ADR-079 slice A, company link screen. A link to an organisation of the other provenance is returned with
// organisation null and status approved. The screen shows the status and no name, and does not call the reply
// invalid. The company search is a POST with the term in a JSON body, never in the address.
// Explicit UI protocol fixtures: the API is answered by the page route, no database is involved.
const issuer =
  'https://ep-links-null-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = randomUUID();
const future = () => new Date(Date.now() + 60000).toISOString();
const label = 'Company link reviewed by Corridra staff from the evidence supplied (synthetic test)';
type Json = Record<string, unknown>;
const view = (over: Json = {}): Json => ({
  workspaceId,
  expiresAt: future(),
  canEdit: true,
  status: 'approved',
  currentProfileVersion: 1,
  canFile: true,
  link: {
    organisation: null,
    linkedAt: '2026-10-20T09:00:00.000Z',
    reviewedProfileVersion: 1,
    profileChanged: false,
    label,
    reason: null,
  },
  claim: null,
  ...over,
});
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {CompanyLink} from ${JSON.stringify(resolve('apps/web/app/account/profile/company-link.tsx'))};
createRoot(document.getElementById('fixture')).render(
 <CompanyLink subject="synthetic-alice" issuer={${JSON.stringify(issuer)}} workspaceId={${JSON.stringify(workspaceId)}}/>);`,
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
  });
  const javascript = result.outputFiles[0].text;
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic company link fixture</title></head><body><main id="main" tabindex="-1"><h1>Synthetic company link fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>',
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Fixture address unavailable');
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

test('a link whose organisation is null shows approved, no name and no reply error', async ({
  page,
}) => {
  await page.route('**/api/customer-organisation-links**', (route) =>
    route.fulfill({ json: view() }),
  );
  await page.goto(origin + '/');
  const panel = page.getByRole('region', { name: 'Company link', exact: true });
  await expect(panel.getByText('Linked', { exact: true })).toBeVisible();
  await expect(panel.getByText(label)).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel).not.toContainText('reply link');
  await expect(panel).not.toContainText('could not be loaded');
  await expect(panel).not.toContainText('Linked to');
  await expect(panel).not.toContainText('null');
  await expect(panel.locator('strong')).toHaveCount(0);
  await expect(panel.getByText('Staff note')).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: 'Request a different company link' }),
  ).toBeVisible();
  // Only an explicit null is tolerated: a missing or nameless organisation is still a bad reply.
  await page.unroute('**/api/customer-organisation-links**');
  const link = (view().link as Json) ?? {};
  for (const organisation of [undefined, { country: 'BD' }, 'text']) {
    await page.route('**/api/customer-organisation-links**', (route) =>
      route.fulfill({ json: view({ link: { ...link, organisation } }) }),
    );
    await page.goto(origin + '/');
    await expect(panel.getByRole('alert')).toContainText('reply link');
    await page.unroute('**/api/customer-organisation-links**');
  }
});

test('the company search is a POST with a JSON body and nothing in the address', async ({
  page,
}) => {
  const seen: { method: string; url: string; type: string | undefined; body: unknown }[] = [];
  await page.route('**/api/customer-organisation-links**', (route) => {
    const request = route.request();
    if (request.method() === 'GET')
      return route.fulfill({ json: view({ status: 'none', link: null }) });
    seen.push({
      method: request.method(),
      url: request.url(),
      type: request.headers()['content-type'],
      body: request.postDataJSON(),
    });
    return route.fulfill({ json: { workspaceId, expiresAt: future(), organisations: [] } });
  });
  await page.goto(origin + '/');
  const panel = page.getByRole('region', { name: 'Company link', exact: true });
  await panel.getByLabel('Search the list (at least 3 letters)').fill('  acme  ');
  await panel.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    panel.getByText('No listed company matches. Try another word, or choose the other option.'),
  ).toBeVisible();
  expect(seen).toHaveLength(1);
  expect(seen[0]!.method).toBe('POST');
  expect(new URL(seen[0]!.url).search).toBe('');
  expect(seen[0]!.type).toContain('application/json');
  expect(seen[0]!.body).toEqual({ scope: 'search', workspaceId, q: 'acme' });
});

test('a refused search shows the existing error text, not the empty-result sentence', async ({
  page,
}) => {
  const methods: string[] = [];
  await page.route('**/api/customer-organisation-links**', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: view({ status: 'none', link: null }) });
    methods.push(route.request().method());
    return route.fulfill({ status: 403, json: { error: 'Request origin is not allowed' } });
  });
  await page.goto(origin + '/');
  const panel = page.getByRole('region', { name: 'Company link', exact: true });
  await panel.getByLabel('Search the list (at least 3 letters)').fill('acme');
  await panel.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText(
    'The company list could not be searched. Try again.',
  );
  expect(methods).toEqual(['POST']);
  await expect(panel.getByText('No listed company matches')).toHaveCount(0);
});
