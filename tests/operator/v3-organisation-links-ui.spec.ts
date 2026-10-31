import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

// Explicit UI protocol fixtures. Real restricted customer and staff authority has separate database acceptance.
const issuer = 'https://ep-links-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = randomUUID();
const tenant = randomUUID();
const claimId = randomUUID();
const orgId = randomUUID();
const future = () => new Date(Date.now() + 60000).toISOString();
const linkText =
  'Company link reviewed by Corridra staff from the evidence supplied (synthetic test)';
type Json = Record<string, unknown>;
const view = (over: Json = {}): Json => ({
  workspaceId,
  expiresAt: future(),
  canEdit: true,
  status: 'none',
  currentProfileVersion: 1,
  canFile: true,
  link: null,
  claim: null,
  ...over,
});
const claim = (over: Json = {}): Json => ({
  state: 'pending',
  awaitingCreation: false,
  kind: 'EXISTING',
  filedAt: '2026-10-20T08:00:00.000Z',
  profileVersion: 1,
  profileChanged: false,
  id: claimId,
  version: 1,
  note: 'Synthetic note that this is our invented company',
  evidenceCount: 0,
  evidence: [],
  history: [
    {
      seq: 1,
      kind: 'filed',
      state: 'pending',
      at: '2026-10-20T08:00:00.000Z',
      by: 'customer',
      reason: null,
    },
  ],
  decision: null,
  target: { name: 'Synthetic Dhaka Textiles', country: 'BD' },
  canAddEvidence: true,
  canWithdraw: true,
  ...over,
});
const approvedLink = {
  organisation: { name: 'Synthetic Dhaka Textiles', country: 'BD' },
  linkedAt: '2026-10-20T09:00:00.000Z',
  reviewedProfileVersion: 1,
  profileChanged: false,
  label: linkText,
  reason: 'Name and country agree with the catalogue record',
};
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {CompanyLink} from ${JSON.stringify(resolve('apps/web/app/account/profile/company-link.tsx'))};
import {CustomerWorkspaces} from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
import {CompanyLinkReview} from ${JSON.stringify(resolve('apps/web/app/operator/company-link-review.tsx'))};
const q=new URLSearchParams(location.search),subject='synthetic-alice',issuer=${JSON.stringify(issuer)},ws=${JSON.stringify(workspaceId)};
const mode=q.get('mode');
createRoot(document.getElementById('fixture')).render(
 mode==='list'?<CustomerWorkspaces subject={subject} issuer={issuer} linksEnabled={q.get('links')!=='off'}/>:
 mode==='staff'?<CompanyLinkReview tenant={${JSON.stringify(tenant)}}/>:
 <CompanyLink subject={subject} issuer={issuer} workspaceId={ws}/>);`,
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
  // The browser bundle must carry no server authority code.
  expect(Object.keys(result.metafile!.inputs).some((p) => p.includes('packages/auth/src'))).toBe(
    false,
  );
  const javascript = result.outputFiles[0].text,
    css = await readFile('apps/web/app/globals.css');
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(css);
    } else if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic company link fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace"><h1>Synthetic company link fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>',
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

async function openCustomer(page: Page, get: () => Json, query = '') {
  await page.route('**/api/customer-organisation-links**', (route) => {
    if (route.request().method() === 'GET') {
      const url = new URL(route.request().url());
      if (url.searchParams.get('scope') === 'search')
        return route.fulfill({
          json: {
            workspaceId,
            expiresAt: future(),
            organisations: [{ id: orgId, name: 'Synthetic Dhaka Textiles', country: 'BD' }],
          },
        });
      return route.fulfill({ json: get() });
    }
    return route.fallback();
  });
  await page.goto(origin + '/' + query);
  return page.getByRole('region', { name: 'Company link', exact: true });
}

test('an owner finds the company, sends one exact request and sees the waiting status', async ({
  page,
}) => {
  const posts: Json[] = [];
  const panel = await openCustomer(page, () => view());
  await expect(panel.getByText('No company link yet')).toBeVisible();
  await expect(panel.getByText(/does not check who you are/)).toBeVisible();
  await page.route('**/api/customer-organisation-links', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const request = route.request();
    expect(request.headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(request.headers()['x-corridra-customer-issuer']).toBe(issuer);
    const body = request.postDataJSON();
    posts.push(body);
    return route.fulfill({
      json: view({ commandId: body.commandId, status: 'pending', canFile: false, claim: claim() }),
    });
  });
  await panel.getByLabel('Search the list (at least 3 letters)').fill('dha');
  await panel.getByRole('button', { name: 'Search', exact: true }).click();
  await panel.getByLabel('Synthetic Dhaka Textiles (BD)').check();
  await panel
    .getByLabel('Why this is your company (start with Synthetic)')
    .fill('Synthetic note that this is our invented company');
  expect(posts).toHaveLength(0);
  await panel.getByRole('button', { name: 'Request company link' }).click();
  await expect(panel.getByText('Waiting for review', { exact: true })).toBeVisible();
  await expect(panel.getByText('Your request is waiting for Corridra staff.')).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'commandId',
    'expectedProfileVersion',
    'kind',
    'note',
    'organisationId',
    'workspaceId',
  ]);
  expect(posts[0]).toMatchObject({
    action: 'file',
    kind: 'EXISTING',
    organisationId: orgId,
    expectedProfileVersion: 1,
    workspaceId,
  });
  // The form is gone while a request is open.
  await expect(panel.getByRole('button', { name: 'Request company link' })).toHaveCount(0);
});

test('proposing a new company needs no search and sends no organisation id', async ({ page }) => {
  const posts: Json[] = [];
  const panel = await openCustomer(page, () => view());
  await page.route('**/api/customer-organisation-links', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    posts.push(body);
    return route.fulfill({
      json: view({
        commandId: body.commandId,
        status: 'pending',
        canFile: false,
        claim: claim({ kind: 'PROPOSED_NEW', target: null }),
      }),
    });
  });
  await panel.getByLabel('My company is not on the list yet').check();
  await expect(panel.getByLabel('Search the list (at least 3 letters)')).toHaveCount(0);
  await panel
    .getByLabel('Why this is your company (start with Synthetic)')
    .fill('Synthetic note that this is our invented company');
  await panel.getByRole('button', { name: 'Request company link' }).click();
  await expect(panel.getByText('Propose a new company record')).toBeVisible();
  expect(posts[0]).toMatchObject({ kind: 'PROPOSED_NEW', organisationId: null });
});

test('a member sees the status read-only with no forms and no evidence text', async ({ page }) => {
  const panel = await openCustomer(page, () =>
    view({
      canEdit: false,
      canFile: false,
      status: 'pending',
      claim: {
        state: 'pending',
        awaitingCreation: false,
        kind: 'EXISTING',
        filedAt: '2026-10-20T08:00:00.000Z',
        profileVersion: 1,
        profileChanged: false,
      },
    }),
  );
  await expect(panel.getByText('Waiting for review', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(0);
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await expect(panel.getByText('Add evidence')).toHaveCount(0);
});

test('an approved link names the company, says what it does not mean, and offers a change to writers only', async ({
  page,
}) => {
  const panel = await openCustomer(page, () =>
    view({ status: 'approved', link: approvedLink, canFile: true }),
  );
  await expect(
    panel.getByText('Linked to Synthetic Dhaka Textiles', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText(linkText)).toBeVisible();
  await expect(panel.getByText(/does not check who you are/)).toBeVisible();
  await expect(
    panel.getByText('Staff note: Name and country agree with the catalogue record'),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Request a different company link' }).click();
  await expect(
    panel.getByRole('group', { name: 'Request a different company link' }),
  ).toBeVisible();
  const member = await page.context().newPage();
  await member.route('**/api/customer-organisation-links**', (route) =>
    route.fulfill({
      json: view({
        canEdit: false,
        canFile: false,
        status: 'approved',
        link: { ...approvedLink, reason: undefined },
      }),
    }),
  );
  await member.goto(origin + '/');
  const read = member.getByRole('region', { name: 'Company link', exact: true });
  await expect(read.getByText('Linked to Synthetic Dhaka Textiles', { exact: true })).toBeVisible();
  await expect(read.getByRole('button')).toHaveCount(0);
  await expect(read.getByText('Staff note')).toHaveCount(0);
});

test('a rejected request shows the staff reason and lets a writer ask again', async ({ page }) => {
  const panel = await openCustomer(page, () =>
    view({
      status: 'rejected',
      claim: claim({
        state: 'rejected',
        canAddEvidence: false,
        canWithdraw: false,
        decision: {
          kind: 'rejected',
          reason: 'The evidence does not match any listed company',
          at: '2026-10-20T10:00:00.000Z',
        },
      }),
    }),
  );
  await expect(panel.getByText('Not approved', { exact: true })).toBeVisible();
  await expect(
    panel.getByText('Staff note: The evidence does not match any listed company'),
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Request company link' })).toBeVisible();
});

test('more evidence is added as one exact request and a retry reuses the command id', async ({
  page,
}) => {
  const ids: string[] = [];
  const posts: Json[] = [];
  let fail = true;
  const panel = await openCustomer(page, () =>
    view({
      status: 'needs_evidence',
      canFile: false,
      claim: claim({
        state: 'needs_evidence',
        version: 3,
        decision: {
          kind: 'evidence_requested',
          reason: 'Please add a trade reference statement',
          at: '2026-10-20T10:00:00.000Z',
        },
      }),
    }),
  );
  await expect(panel.getByText('More evidence needed', { exact: true })).toBeVisible();
  await expect(panel.getByText('Staff note: Please add a trade reference statement')).toBeVisible();
  await page.route('**/api/customer-organisation-links', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    ids.push(body.commandId);
    posts.push(body);
    if (fail) return route.fulfill({ status: 500, json: { error: 'x' } });
    return route.fulfill({
      json: view({
        commandId: body.commandId,
        status: 'pending',
        canFile: false,
        claim: claim({
          version: 4,
          evidenceCount: 1,
          evidence: [
            {
              id: randomUUID(),
              kind: 'TRADE_REFERENCE_STATEMENT',
              statement: 'Synthetic trade reference from an invented buyer',
              url: null,
            },
          ],
        }),
      }),
    });
  });
  await panel.getByLabel('Type of evidence').selectOption('TRADE_REFERENCE_STATEMENT');
  await panel
    .getByLabel('Statement (start with Synthetic)')
    .fill('Synthetic trade reference from an invented buyer');
  await panel.getByRole('button', { name: 'Add evidence' }).click();
  await expect(panel.getByRole('alert')).toContainText('could not be confirmed');
  fail = false;
  await panel.getByRole('button', { name: 'Retry the same evidence' }).click();
  await expect(
    panel.getByText('Trade reference statement: Synthetic trade reference from an invented buyer'),
  ).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'claimId',
    'commandId',
    'evidenceKind',
    'expectedVersion',
    'statement',
    'url',
    'workspaceId',
  ]);
  expect(posts[0]).toMatchObject({
    action: 'add_evidence',
    claimId,
    expectedVersion: 3,
    url: null,
  });
});

test('withdrawing asks first and sends one exact request', async ({ page }) => {
  const posts: Json[] = [];
  const panel = await openCustomer(page, () =>
    view({ status: 'pending', canFile: false, claim: claim() }),
  );
  await page.route('**/api/customer-organisation-links', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    posts.push(body);
    return route.fulfill({ json: view({ commandId: body.commandId }) });
  });
  await panel.getByRole('button', { name: 'Withdraw this request' }).click();
  expect(posts).toHaveLength(0);
  await panel.getByRole('button', { name: 'Keep the request' }).click();
  expect(posts).toHaveLength(0);
  await panel.getByRole('button', { name: 'Withdraw this request' }).click();
  await panel.getByRole('button', { name: 'Confirm withdrawal' }).click();
  await expect(panel.getByText('No company link yet')).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'action',
    'claimId',
    'commandId',
    'expectedVersion',
    'workspaceId',
  ]);
  expect(posts[0]).toMatchObject({ action: 'withdraw', claimId, expectedVersion: 1 });
});

test('stale, unavailable, denied and malformed answers are never shown as success', async ({
  page,
}) => {
  let status = 409;
  let body: Json = { error: 'x' };
  const panel = await openCustomer(page, () =>
    view({ status: 'pending', canFile: false, claim: claim() }),
  );
  await page.route('**/api/customer-organisation-links', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({ status, json: body });
  });
  const withdraw = async () => {
    const open = panel.getByRole('button', { name: 'Withdraw this request' });
    const confirm = panel.getByRole('button', { name: 'Confirm withdrawal' });
    // Wait for the panel to settle in either state before choosing: an immediate count can read zero
    // while the panel is still redrawing after the previous answer.
    await expect(open.or(confirm)).toBeVisible();
    if (await open.isVisible()) await open.click();
    await confirm.click();
  };
  await withdraw();
  await expect(panel.getByRole('alert')).toContainText('changed');
  await expect(panel.getByRole('status')).toHaveCount(0);
  // A malformed 200 is not accepted.
  status = 200;
  body = { workspaceId: randomUUID(), status: 'none' };
  await withdraw();
  await expect(panel.getByRole('alert')).toContainText('could not be confirmed');
  status = 503;
  await withdraw();
  await expect(panel.getByRole('alert')).toContainText('not available');
  await expect(panel.getByText('Waiting for review')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Reload company link' })).toBeVisible();
});

test('a denied load clears every detail', async ({ page }) => {
  await page.route('**/api/customer-organisation-links**', (route) =>
    route.fulfill({ status: 403, json: { error: 'x' } }),
  );
  await page.goto(origin + '/');
  const panel = page.getByRole('region', { name: 'Company link', exact: true });
  await expect(panel.getByRole('alert')).toContainText('Access to this company link changed');
  await expect(panel.getByText('Waiting for review')).toHaveCount(0);
});

test('the workspace list shows the link status, and shows nothing when the module is off', async ({
  page,
}) => {
  const rows = [
    {
      id: workspaceId,
      name: 'Synthetic Dhaka workspace',
      role: 'owner',
      synthetic: true,
      organisationId: null,
    },
    {
      id: randomUUID(),
      name: 'Synthetic Other workspace',
      role: 'member',
      synthetic: true,
      organisationId: null,
    },
  ];
  let overviewCalls = 0;
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: rows } }),
  );
  await page.route('**/api/customer-organisation-links**', (route) => {
    overviewCalls++;
    return route.fulfill({
      json: {
        expiresAt: future(),
        workspaces: [
          {
            workspaceId: rows[0]!.id,
            status: 'approved',
            organisationName: 'Synthetic Dhaka Textiles',
          },
          { workspaceId: rows[1]!.id, status: 'needs_evidence', organisationName: null },
        ],
      },
    });
  });
  await page.goto(origin + '/?mode=list');
  await expect(page.getByText('Company link: Linked to Synthetic Dhaka Textiles')).toBeVisible();
  await expect(page.getByText('Company link: More evidence needed')).toBeVisible();
  expect(overviewCalls).toBeGreaterThan(0);
  const before = overviewCalls;
  await page.goto(origin + '/?mode=list&links=off');
  await expect(page.getByText('Synthetic Dhaka workspace', { exact: false })).toBeVisible();
  await expect(page.getByText(/Company link:/)).toHaveCount(0);
  expect(overviewCalls).toBe(before);
  // A failing status service never breaks the list.
  await page.unroute('**/api/customer-organisation-links**');
  await page.route('**/api/customer-organisation-links**', (route) =>
    route.fulfill({ status: 503, json: { error: 'x' } }),
  );
  await page.goto(origin + '/?mode=list');
  await expect(page.getByText('Synthetic Dhaka workspace', { exact: false })).toBeVisible();
  await expect(page.getByText(/Company link:/)).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440])
  test(
    'the customer panel works by keyboard and passes accessibility checks at ' + width,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const panel = await openCustomer(page, () => view());
      await expect(panel.getByText('No company link yet')).toBeVisible();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.tagName)).toMatch(
        /INPUT|SELECT|BUTTON|TEXTAREA|A/,
      );
      await panel.getByLabel('Search the list (at least 3 letters)').focus();
      await page.keyboard.type('dha');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await expect(panel.getByLabel('Synthetic Dhaka Textiles (BD)')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        (
          await new AxeBuilder({ page })
            .include('main')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations.map((v) => v.id),
      ).toEqual([]);
    },
  );

// ---- Staff review screen ----
const queueItem = {
  claimId,
  workspaceId,
  workspaceName: 'Synthetic Dhaka workspace',
  kind: 'EXISTING',
  state: 'pending',
  version: 2,
  filedAt: '2026-10-20T08:00:00.000Z',
  legalName: 'Synthetic Dhaka Textiles Ltd',
  country: 'BD',
  evidenceCount: 1,
  candidateCount: 2,
};
const review = (over: Json = {}): Json => ({
  claimId,
  workspaceId,
  workspaceName: 'Synthetic Dhaka workspace',
  expiresAt: future(),
  kind: 'EXISTING',
  state: 'pending',
  version: 2,
  filedAt: '2026-10-20T08:00:00.000Z',
  note: 'Synthetic note that this is our invented company',
  profile: {
    version: 1,
    currentVersion: 1,
    legalName: 'Synthetic Dhaka Textiles Ltd',
    countryCode: 'BD',
    website: 'https://www.dhaka-textiles.example.invalid',
    summary: 'Synthetic invented textile supplier',
    commercialRoles: ['SUPPLIER'],
    sectors: ['Textiles'],
    sizeBand: '11-50',
  },
  chosenOrganisation: { id: orgId, name: 'Synthetic Dhaka Textiles', country: 'BD' },
  activeLink: null,
  evidence: [
    {
      id: randomUUID(),
      kind: 'REGISTRATION_STATEMENT',
      statement: 'Synthetic registration SYN-0001',
      url: 'https://registry.example.invalid/1',
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
      byYou: null,
      reason: null,
      internalNote: null,
    },
  ],
  candidates: {
    organisations: [
      {
        id: orgId,
        name: 'Synthetic Dhaka Textiles',
        country: 'BD',
        reasons: ['name_country', 'website_host'],
        linkedWorkspaces: 1,
      },
    ],
    workspaces: [
      {
        claimId: randomUUID(),
        workspaceId: randomUUID(),
        state: 'pending',
        legalName: 'Synthetic Dhaka Textiles Limited',
        country: 'BD',
        reasons: ['name_country'],
      },
    ],
  },
  decisions: ['approve', 'request_evidence', 'reject'],
  ...over,
});
async function openStaff(
  page: Page,
  state: { queueStatus?: number; reviewStatus?: number; r?: Json } = {},
) {
  await page.route('**/api/workspace/customer-organisation-links**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    expect(url.searchParams.get('tenant')).toBe(tenant);
    if (url.searchParams.get('claim'))
      return state.reviewStatus
        ? route.fulfill({ status: state.reviewStatus, json: { error: 'x' } })
        : route.fulfill({ json: state.r ?? review() });
    return state.queueStatus
      ? route.fulfill({ status: state.queueStatus, json: { error: 'x' } })
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
  await page.getByRole('button', { name: 'Load company link requests' }).click();
}

test('staff load the queue, review a request with matches, and send one exact decision', async ({
  page,
}) => {
  const posts: Json[] = [];
  await openStaff(page);
  await expect(
    page.getByText(/Synthetic Dhaka Textiles Ltd.*1 evidence.*2 possible matches/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review Synthetic Dhaka Textiles Ltd' }).click();
  const section = page.getByRole('region', { name: 'Review of Synthetic Dhaka Textiles Ltd' });
  await expect(section.getByText('Synthetic registration SYN-0001')).toBeVisible();
  await expect(section.getByText(/already linked to 1 other workspace/)).toBeVisible();
  await expect(
    section.getByText(/Another workspace: Synthetic Dhaka Textiles Limited/),
  ).toBeVisible();
  await page.route('**/api/workspace/customer-organisation-links**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    posts.push(body);
    return route.fulfill({
      json: {
        claimId,
        commandId: body.commandId,
        decision: body.decision,
        state: 'approved',
        version: 3,
        shared: true,
      },
    });
  });
  // The shared-link confirmation and a reason are required before anything is sent.
  await section.getByRole('button', { name: 'Record decision' }).click();
  expect(posts).toHaveLength(0);
  await section
    .getByLabel('Reason the customer will read')
    .fill('Same company; both workspaces are contacts');
  await section
    .getByLabel('Internal note (staff only, optional)')
    .fill('Checked the invented registry');
  await section.getByRole('button', { name: 'Record decision' }).click();
  expect(posts).toHaveLength(0);
  await section.getByLabel(/I confirm both workspaces may be linked/).check();
  await section.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByRole('status')).toContainText('Decision recorded: Approved');
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'claimId',
    'commandId',
    'decision',
    'expectedVersion',
    'internalNote',
    'organisationId',
    'reason',
    'shareConfirmed',
  ]);
  expect(posts[0]).toMatchObject({
    claimId,
    expectedVersion: 2,
    decision: 'approve',
    organisationId: orgId,
    shareConfirmed: true,
    internalNote: 'Checked the invented registry',
  });
});

test('a staff decision that is not confirmed is retried with the same command id, and a conflict clears it', async ({
  page,
}) => {
  const ids: string[] = [];
  let status = 500;
  await openStaff(page);
  await page.getByRole('button', { name: 'Review Synthetic Dhaka Textiles Ltd' }).click();
  const section = page.getByRole('region', { name: 'Review of Synthetic Dhaka Textiles Ltd' });
  await page.route('**/api/workspace/customer-organisation-links**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    ids.push(body.commandId);
    return status === 200
      ? route.fulfill({
          json: {
            claimId,
            commandId: body.commandId,
            decision: 'reject',
            state: 'rejected',
            version: 3,
            shared: false,
          },
        })
      : route.fulfill({ status, json: { error: 'x' } });
  });
  await section.getByLabel('Decision').selectOption('reject');
  await section
    .getByLabel('Reason the customer will read')
    .fill('The evidence does not match any listed company');
  await section.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByRole('status')).toContainText('could not be completed');
  status = 200;
  await section.getByRole('button', { name: 'Retry the same decision' }).click();
  await expect(page.getByRole('status')).toContainText('Decision recorded: Rejected');
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

test('a stale decision, a denied reviewer and an unavailable module show plain messages', async ({
  page,
}) => {
  await openStaff(page);
  await page.getByRole('button', { name: 'Review Synthetic Dhaka Textiles Ltd' }).click();
  const section = page.getByRole('region', { name: 'Review of Synthetic Dhaka Textiles Ltd' });
  let status = 409;
  await page.route('**/api/workspace/customer-organisation-links**', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status, json: { error: 'x' } })
      : route.fallback(),
  );
  await section.getByLabel('Decision').selectOption('reject');
  await section
    .getByLabel('Reason the customer will read')
    .fill('The evidence does not match any listed company');
  await section.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByRole('status')).toContainText('changed or conflicts');
  await expect(section.getByRole('button', { name: 'Record decision' })).toBeVisible();
  status = 403;
  await section.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByRole('status')).toContainText('Reviewer access');
});

test('the queue shows denied, unavailable and empty states', async ({ page }) => {
  await openStaff(page, { queueStatus: 403 });
  await expect(page.getByRole('status')).toContainText('Reviewer access');
  await page.getByRole('button', { name: 'Load company link requests' }).click();
  await page.unroute('**/api/workspace/customer-organisation-links**');
  await page.route('**/api/workspace/customer-organisation-links**', (route) =>
    route.fulfill({ status: 503, json: { error: 'x' } }),
  );
  await page.getByRole('button', { name: 'Load company link requests' }).click();
  await expect(page.getByRole('status')).toContainText('unavailable');
  await page.unroute('**/api/workspace/customer-organisation-links**');
  await page.route('**/api/workspace/customer-organisation-links**', (route) =>
    route.fulfill({ json: { scope: 'open', synthetic: true, nextAfter: null, items: [] } }),
  );
  await page.getByRole('button', { name: 'Load company link requests' }).click();
  await expect(page.getByRole('status')).toContainText('No requests to show');
});

test('a closed request offers no decision except ending an active link', async ({ page }) => {
  await openStaff(page, { r: review({ state: 'rejected', decisions: [] }) });
  await page.getByRole('button', { name: 'Review Synthetic Dhaka Textiles Ltd' }).click();
  await expect(
    page.getByText('This request is closed. No further decision is possible.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record decision' })).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440])
  test(
    'the staff review works by keyboard and passes accessibility checks at ' + width,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openStaff(page);
      await page.getByRole('button', { name: 'Review Synthetic Dhaka Textiles Ltd' }).focus();
      await page.keyboard.press('Enter');
      const section = page.getByRole('region', { name: 'Review of Synthetic Dhaka Textiles Ltd' });
      await expect(section).toBeVisible();
      await section.getByLabel('Decision').focus();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.tagName)).toMatch(
        /SELECT|TEXTAREA|INPUT/,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        (
          await new AxeBuilder({ page })
            .include('main')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations.map((v) => v.id),
      ).toEqual([]);
    },
  );

test('a failed evidence request is never reused for a different action', async ({ page }) => {
  const posts: Json[] = [];
  const panel = await openCustomer(page, () =>
    view({ status: 'pending', canFile: false, claim: claim() }),
  );
  await page.route('**/api/customer-organisation-links', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    posts.push(body);
    if (body.action === 'add_evidence') return route.fulfill({ status: 500, json: { error: 'x' } });
    return route.fulfill({ json: view({ commandId: body.commandId }) });
  });
  await panel
    .getByLabel('Statement (start with Synthetic)')
    .fill('Synthetic registration statement from an invented registry');
  await panel.getByRole('button', { name: 'Add evidence' }).click();
  await expect(panel.getByRole('alert')).toContainText('could not be confirmed');
  await panel.getByRole('button', { name: 'Withdraw this request' }).click();
  await panel.getByRole('button', { name: 'Confirm withdrawal' }).click();
  await expect(panel.getByText('No company link yet')).toBeVisible();
  expect(posts.map((p) => p.action)).toEqual(['add_evidence', 'withdraw']);
  expect(posts[1]!.commandId).not.toBe(posts[0]!.commandId);
});

test('a rejected replacement shows its staff reason while the earlier link stays approved', async ({
  page,
}) => {
  const panel = await openCustomer(page, () =>
    view({
      status: 'approved',
      link: approvedLink,
      claim: claim({
        state: 'rejected',
        canAddEvidence: false,
        canWithdraw: false,
        decision: {
          kind: 'rejected',
          reason: 'The replacement evidence is not enough',
          at: '2026-10-20T11:00:00.000Z',
        },
      }),
    }),
  );
  await expect(panel.getByText(linkText)).toBeVisible();
  await expect(panel.getByText('Staff note: The replacement evidence is not enough')).toBeVisible();
});

test('staff can page through a queue that has more than one page', async ({ page }) => {
  const second = {
    ...queueItem,
    claimId: randomUUID(),
    legalName: 'Synthetic Chattogram Mills Ltd',
  };
  const afters: (string | null)[] = [];
  await page.route('**/api/workspace/customer-organisation-links**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    const after = url.searchParams.get('after');
    afters.push(after);
    return route.fulfill({
      json: {
        scope: url.searchParams.get('scope') ?? 'open',
        synthetic: true,
        nextAfter: after ? null : queueItem.claimId,
        items: [after ? second : queueItem],
      },
    });
  });
  await page.goto(origin + '/?mode=staff');
  await page.getByText('Customer company link requests', { exact: true }).click();
  await page.getByRole('button', { name: 'Load company link requests' }).click();
  await expect(page.getByText('Synthetic Dhaka Textiles Ltd', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show more requests' }).click();
  await expect(page.getByText('Synthetic Chattogram Mills Ltd', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic Dhaka Textiles Ltd', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show more requests' })).toHaveCount(0);
  expect(afters).toEqual([null, queueItem.claimId]);
});
