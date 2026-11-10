import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// ADR-079 slice A. The queue and the review of a claim whose text was hidden at the customer's request carry redacted
// true and the marker text, exactly as the database returns them. Both screens load them and show the marker once in
// each place the text was, with no label or bracket added around it. The API is answered by the page route.
const tenant = randomUUID();
const claimId = randomUUID();
const workspaceId = randomUUID();
const orgId = randomUUID();
const future = () => new Date(Date.now() + 60000).toISOString();
const hidden = 'This text is hidden.';
const issuer =
  'https://ep-links-redacted-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const label = 'Company link reviewed by Corridra staff from the evidence supplied (synthetic test)';
const times = (text: string | null) => (text ?? '').split(hidden).length - 1;
type Json = Record<string, unknown>;
const queueItem = {
  claimId,
  workspaceId,
  workspaceName: 'Synthetic Dhaka workspace',
  kind: 'EXISTING',
  state: 'approved',
  version: 2,
  filedAt: '2026-10-20T08:00:00.000Z',
  legalName: hidden,
  country: 'BD',
  redacted: true,
  evidenceCount: 1,
  candidateCount: 0,
};
const review: Json = {
  claimId,
  workspaceId,
  workspaceName: 'Synthetic Dhaka workspace',
  expiresAt: future(),
  kind: 'EXISTING',
  state: 'approved',
  version: 2,
  filedAt: '2026-10-20T08:00:00.000Z',
  note: hidden,
  profile: {
    version: 1,
    currentVersion: 1,
    legalName: hidden,
    countryCode: 'BD',
    website: null,
    summary: hidden,
    commercialRoles: ['SUPPLIER'],
    sectors: ['Textiles'],
    sizeBand: '11-50',
  },
  chosenOrganisation: { id: orgId, name: 'Synthetic Dhaka Textiles', country: 'BD' },
  activeLink: {
    claimId,
    organisation: { id: orgId, name: 'Synthetic Dhaka Textiles', country: 'BD' },
    linkedAt: '2026-10-20T09:00:00.000Z',
    shared: false,
  },
  evidence: [
    {
      id: randomUUID(),
      kind: 'REGISTRATION_STATEMENT',
      statement: hidden,
      url: hidden,
      addedAt: '2026-10-20T08:05:00.000Z',
    },
  ],
  history: [
    {
      seq: 2,
      kind: 'approved',
      state: 'approved',
      at: '2026-10-20T09:00:00.000Z',
      by: 'staff',
      byYou: false,
      reason: hidden,
      internalNote: hidden,
    },
  ],
  candidates: { organisations: [], workspaces: [] },
  decisions: ['revoke'],
  redacted: true,
};
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {CompanyLink} from ${JSON.stringify(resolve('apps/web/app/account/profile/company-link.tsx'))};
import {CompanyLinkReview} from ${JSON.stringify(resolve('apps/web/app/operator/company-link-review.tsx'))};
const staff=new URLSearchParams(location.search).get('mode')==='staff';
createRoot(document.getElementById('fixture')).render(staff?<CompanyLinkReview tenant={${JSON.stringify(tenant)}}/>:
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

test('staff load a queue row and a review whose text is hidden, and each place shows the marker once', async ({
  page,
}) => {
  await page.route('**/api/workspace/customer-organisation-links**', (route) => {
    const url = new URL(route.request().url());
    return url.searchParams.get('claim')
      ? route.fulfill({ json: review })
      : route.fulfill({
          json: {
            scope: url.searchParams.get('scope') ?? 'open',
            synthetic: true,
            nextAfter: null,
            items: [queueItem],
          },
        });
  });
  await page.goto(origin + '/?mode=staff');
  await page.getByText('Customer company link requests', { exact: true }).click();
  await page.getByRole('button', { name: 'Load Company Link Requests' }).click();
  const row = page.locator('li', { hasText: 'possible match' });
  expect(times(await row.innerText())).toBe(1);
  await page.getByRole('button', { name: 'Review request' }).click();
  const section = page.getByRole('region', { name: 'Review of request' });
  await expect(section.getByRole('heading', { level: 3 })).toHaveText(hidden);
  // One marker in each field, nothing added in front of it or around it.
  for (const field of ['Website', 'About', 'Customer note']) {
    const value = section
      .locator('dt', { hasText: field })
      .locator('xpath=following-sibling::dd[1]');
    await expect(value).toHaveText(field === 'Website' ? 'Not provided' : hidden);
  }
  const evidence = section.locator('h4:has-text("Evidence from the customer") + ul > li');
  await expect(evidence).toHaveText([hidden]);
  const history = section.locator('details ol > li');
  expect(times(await history.textContent())).toBe(1);
  await expect(section).not.toContainText('staff only: ' + hidden);
  await expect(section).not.toContainText('(' + hidden + ')');
  await expect(section.getByText('Synthetic Dhaka Textiles').first()).toBeVisible();
  await expect(page.getByText(/could not be loaded|unexpected|Unrecognized/i)).toHaveCount(0);
});

test('the customer screen shows the marker once for the link note, the staff note, the request, the evidence and the history', async ({
  page,
}) => {
  const claim = {
    state: 'rejected',
    awaitingCreation: false,
    kind: 'PROPOSED_NEW',
    filedAt: '2026-10-20T08:00:00.000Z',
    profileVersion: 1,
    profileChanged: false,
    id: claimId,
    version: 3,
    note: hidden,
    evidenceCount: 1,
    evidence: [
      {
        id: randomUUID(),
        kind: 'WEBSITE_STATEMENT',
        statement: hidden,
        url: hidden,
        addedAt: '2026-10-20T08:05:00.000Z',
      },
    ],
    history: [
      {
        seq: 1,
        kind: 'filed',
        state: 'pending',
        at: '2026-10-20T08:00:00.000Z',
        by: 'customer',
        reason: null,
      },
      {
        seq: 3,
        kind: 'rejected',
        state: 'rejected',
        at: '2026-10-20T09:00:00.000Z',
        by: 'staff',
        reason: hidden,
      },
    ],
    decision: { kind: 'rejected', reason: hidden, at: '2026-10-20T09:00:00.000Z' },
    target: null,
    canAddEvidence: false,
    canWithdraw: false,
    redacted: true,
  };
  await page.route('**/api/customer-organisation-links**', (route) =>
    route.fulfill({
      json: {
        workspaceId,
        expiresAt: future(),
        canEdit: true,
        status: 'approved',
        currentProfileVersion: 1,
        canFile: true,
        link: {
          organisation: { name: 'Synthetic Dhaka Textiles', country: 'BD' },
          linkedAt: '2026-10-20T09:00:00.000Z',
          reviewedProfileVersion: 1,
          profileChanged: false,
          label,
          reason: hidden,
        },
        claim,
      },
    }),
  );
  await page.goto(origin + '/');
  const panel = page.getByRole('region', { name: 'Company link', exact: true });
  await expect(panel.getByText('Linked to Synthetic Dhaka Textiles')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  // Link note, staff note on the request, request note and the evidence line: each is the marker alone.
  await expect(panel.getByText(hidden, { exact: true })).toHaveCount(4);
  const evidence = panel.locator('h3:has-text("Evidence") + ul > li');
  await expect(evidence).toHaveText([hidden]);
  await expect(panel).not.toContainText('Staff note');
  await expect(panel).not.toContainText('(' + hidden + ')');
  await expect(panel).not.toContainText('Website statement');
  const history = panel.locator('details ol > li');
  expect(times(await history.last().textContent())).toBe(1);
});
