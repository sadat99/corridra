import { test, expect, type Locator, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';

// CQ-52 (the workspace card has one primary action and a More menu) and CQ-70 (the place options come
// from the chosen catalogue entry). Both screens are mounted as fixtures with explicit protocol
// answers; the restricted database authority has its own integration acceptance. No stylesheet is
// needed: a closed details element hides its links by itself.
const issuer = 'https://ep-cq-52-70-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-0000000000a1';
const programmeId = '00000000-0000-4000-8000-0000000000c3';
const ownerId = '00000000-0000-4000-8000-0000000000e1';
const memberId = '00000000-0000-4000-8000-0000000000e2';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {ServiceRequestNew} from ${JSON.stringify(resolve('apps/web/app/account/service-requests/service-request-new.tsx'))};
import {CustomerWorkspaces} from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
const q=new URLSearchParams(location.search),subject='synthetic-alice',issuer=${JSON.stringify(issuer)};
const el=q.get('view')==='workspaces'
?<CustomerWorkspaces subject={subject} issuer={issuer} {...JSON.parse(q.get('props')||'{}')}/>
:<ServiceRequestNew subject={subject} issuer={issuer} kind="programme" contextRef={${JSON.stringify(programmeId)}} workspaceId={${JSON.stringify(workspaceId)}}/>;
createRoot(document.getElementById('fixture')).render(el);`,
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
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    metafile: true,
  });
  // The browser bundle must carry no server authority code.
  expect(
    Object.keys(result.metafile!.inputs).some((path) => path.includes('packages/auth/src')),
  ).toBe(false);
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic CQ-52 and CQ-70 fixture</title></head><body><main id="main" tabindex="-1"><h1>Synthetic CQ-52 and CQ-70 fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>',
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

const allSwitches = {
  requestsEnabled: true,
  draftsEnabled: true,
  profilesEnabled: true,
  programmesEnabled: true,
  serviceRequestsEnabled: true,
  billingEnabled: true,
};
const people = [
  { id: ownerId, name: 'Synthetic Dhaka Knits', role: 'owner' },
  { id: memberId, name: 'Synthetic Chattogram Dyers', role: 'member' },
].map((row) => ({ ...row, synthetic: true, organisationId: null }));
async function openWorkspaces(page: Page, props: Record<string, boolean>) {
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: people } }),
  );
  // The owner's team panel and the invitation form read their own endpoints; this test is about the
  // action row only, so they answer "nothing here" and are not asserted.
  await page.route('**/api/customer-workspace-access*', (route) =>
    route.fulfill({
      json: {
        workspaceId: ownerId,
        ownerProtected: true,
        nextInvitationAfter: null,
        nextMemberAfter: null,
        invitations: [],
        memberships: [],
      },
    }),
  );
  await page.goto(origin + '/?view=workspaces&props=' + encodeURIComponent(JSON.stringify(props)));
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic Dhaka Knits', { exact: true })).toBeVisible();
}
const menuFor = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Actions for ' + name }).click();
  return page.getByRole('menu', { name: 'Actions for ' + name });
};
const linkPairs = (links: Locator) =>
  links.evaluateAll((nodes) =>
    nodes.map((node) => [node.textContent?.trim(), node.getAttribute('href')]),
  );

test('CQ-52: each workspace row keeps every action in one menu, the first being New Request', async ({
  page,
}) => {
  await openWorkspaces(page, allSwitches);
  // Closed: none of the actions can be seen or reached, and no link sits outside the menu.
  const row = page.getByRole('row').filter({ hasText: 'Synthetic Dhaka Knits' });
  await expect(row.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('menu', { name: 'Actions for Synthetic Dhaka Knits' })).toBeHidden();
  // Owner: all the original actions are reachable, New Request first, then Manage Team.
  const owner = await menuFor(page, 'Synthetic Dhaka Knits');
  await expect(owner.getByRole('menuitem', { name: 'Plan and Billing' })).toBeVisible();
  expect(await linkPairs(owner.locator('a'))).toEqual([
    ['New Request', '/account/drafts/' + ownerId],
    ['Continue a Saved Draft', '/account/drafts/' + ownerId],
    ['Send a Private Request', '/account/request/' + ownerId],
    ['Edit Company Profile', '/account/profile/' + ownerId],
    ['Plan Delegations', '/account/delegations/' + ownerId],
    ['Paid-Service Requests', '/account/service-requests/' + ownerId],
    ['Plan and Billing', '/account/billing/' + ownerId],
  ]);
  await expect(owner.getByRole('menuitem', { name: 'Manage Team' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(owner).toBeHidden();
  // Member: the same row, with the actions a member may use (view the profile, no delegations).
  const member = await menuFor(page, 'Synthetic Chattogram Dyers');
  expect(await linkPairs(member.locator('a'))).toEqual([
    ['New Request', '/account/drafts/' + memberId],
    ['Continue a Saved Draft', '/account/drafts/' + memberId],
    ['Send a Private Request', '/account/request/' + memberId],
    ['View Company Profile', '/account/profile/' + memberId],
    ['Paid-Service Requests', '/account/service-requests/' + memberId],
    ['Plan and Billing', '/account/billing/' + memberId],
  ]);
  await expect(member.getByRole('menuitem', { name: 'Manage Team' })).toHaveCount(0);
});

test('CQ-52: with saved drafts off New Request is the request form and extras that are on follow it', async ({
  page,
}) => {
  await openWorkspaces(page, { requestsEnabled: true });
  const owner = await menuFor(page, 'Synthetic Dhaka Knits');
  expect(await linkPairs(owner.locator('a'))).toEqual([
    ['New Request', '/account/request/' + ownerId],
  ]);
  await page.unroute('**/api/customer-workspaces');
  await page.unroute('**/api/customer-workspace-access*');
  await openWorkspaces(page, { requestsEnabled: true, billingEnabled: true });
  const billed = await menuFor(page, 'Synthetic Dhaka Knits');
  expect(await linkPairs(billed.locator('a'))).toEqual([
    ['New Request', '/account/request/' + ownerId],
    ['Plan and Billing', '/account/billing/' + ownerId],
  ]);
});

// The place options come from the chosen service's own list. Staff keep that list in the catalogue
// (customer_private.service_catalogue_version.regions, served by the catalogue scope), and the server
// refuses a place outside it, so the form can offer exactly what the answer carries.
const service = (key: string, title: string, regions: string[]) => ({
  key,
  version: 1,
  title,
  summary: `Synthetic summary for ${title}.`,
  included: ['Synthetic inclusion'],
  excluded: ['Synthetic exclusion'],
  regions,
  quoteBasis: 'per_day',
  synthetic: true,
});
const standardCatalogue = [
  service('interpreter-day', 'Interpreter day', ['Dhaka', 'Guangzhou']),
  service('local-meeting', 'Local meeting arrangement', ['Istanbul']),
  service('factory-visit', 'Factory visit escort', [
    'Chattogram',
    'Dhaka',
    'Guangzhou',
    'Istanbul',
  ]),
];
async function openNew(page: Page, services: unknown[], posts: Record<string, unknown>[] = []) {
  await page.route('**/api/customer-service-requests**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      posts.push(request.postDataJSON());
      return route.fulfill({ status: 500, json: { error: 'x' } });
    }
    return route.fulfill({
      json: { services, expiresAt: new Date(Date.now() + 60000).toISOString() },
    });
  });
  await page.goto(origin + '/');
  await expect(page.getByText(/linked to your delegation programme/)).toBeVisible();
}
const placeOptions = (page: Page) => page.getByLabel('Where do you need it?').locator('option');

test('CQ-70: the place options follow the chosen service and switching service replaces them', async ({
  page,
}) => {
  await openNew(page, standardCatalogue);
  // No service chosen yet: there is no place question to answer.
  await expect(page.getByLabel('Where do you need it?')).toHaveCount(0);
  await page.getByRole('radio', { name: /Interpreter day/ }).check();
  await expect(placeOptions(page)).toHaveText(['Choose a place', 'Dhaka', 'Guangzhou']);
  await page.getByRole('radio', { name: /Local meeting arrangement/ }).check();
  await expect(placeOptions(page)).toHaveText(['Choose a place', 'Istanbul']);
  await page.getByRole('radio', { name: /Factory visit escort/ }).check();
  await expect(placeOptions(page)).toHaveText([
    'Choose a place',
    'Chattogram',
    'Dhaka',
    'Guangzhou',
    'Istanbul',
  ]);
  await page.getByRole('radio', { name: /Interpreter day/ }).check();
  await expect(placeOptions(page)).toHaveText(['Choose a place', 'Dhaka', 'Guangzhou']);
});

test('CQ-70: the place options are the catalogue answer, not a fixed list', async ({ page }) => {
  await openNew(page, [service('night-market', 'Night market guide', ['Nairobi', 'Kampala'])]);
  await page.getByRole('radio', { name: /Night market guide/ }).check();
  await expect(placeOptions(page)).toHaveText(['Choose a place', 'Nairobi', 'Kampala']);
  await expect(page.getByLabel('Where do you need it?')).not.toContainText('Dhaka');
});

test('CQ-70: an empty place blocks sending, the place is a closed list, and a new service clears the old place', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  await openNew(page, standardCatalogue, posts);
  const place = page.getByLabel('Where do you need it?');
  const send = page.getByRole('button', { name: 'Send Help Request' });
  await page.getByRole('radio', { name: /Factory visit escort/ }).check();
  // A closed list: a select that requires a value, so there is no free-text place.
  await expect(place).toHaveJSProperty('tagName', 'SELECT');
  await expect(place).toHaveAttribute('required', '');
  await expect(page.getByRole('combobox', { name: 'Where do you need it?' })).toHaveValue('');
  await page
    .getByLabel(/What do you need/)
    .fill('Synthetic need: an escort for a factory visit and sample check');
  // Empty place: everything else is valid and Send is still blocked.
  await expect(send).toBeDisabled();
  await place.selectOption('Chattogram');
  await expect(send).toBeEnabled();
  // Switching the service replaces the options and empties the place: Send is blocked again.
  await page.getByRole('radio', { name: /Local meeting arrangement/ }).check();
  await expect(placeOptions(page)).toHaveText(['Choose a place', 'Istanbul']);
  await expect(place).toHaveValue('');
  await expect(send).toBeDisabled();
  await place.selectOption('Istanbul');
  await expect(send).toBeEnabled();
  await send.click();
  // The request carries the new service and a place from its own list (the fixture answers 500 so
  // that the form stays on screen).
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ serviceKey: 'local-meeting', region: 'Istanbul' });
});
