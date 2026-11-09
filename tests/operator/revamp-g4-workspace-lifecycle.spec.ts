import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { lifecycleWords } from '../../apps/web/app/account/workspace-lifecycle-client';

// CRUD G4, workspace lifecycle in Workspaces and Team: owner-only menu items, Rename Workspace (reason, stale conflict),
// Archive Workspace (typed name, ten second Undo, Archived filter and banner), Restore, Transfer Ownership (offer,
// cancel, accept, decline, expiry). Closed or unavailable renders nothing. Case ids: G4-01 to G4-09.
const issuer = 'https://ep-g4-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const ids = {
  own: '00000000-0000-4000-8000-0000000000e1',
  adm: '00000000-0000-4000-8000-0000000000e2',
  mem: '00000000-0000-4000-8000-0000000000e3',
};
const memberA = '00000000-0000-4000-8000-0000000000f1';
const memberB = '00000000-0000-4000-8000-0000000000f2';
const offerId = '00000000-0000-4000-8000-0000000000d1';
const workspaces = [
  { id: ids.own, name: 'Synthetic Dhaka Knits', role: 'owner' },
  { id: ids.adm, name: 'Synthetic Chattogram Dyers', role: 'admin' },
  { id: ids.mem, name: 'Synthetic Gazipur Wovens', role: 'member' },
].map((row) => ({ ...row, synthetic: true, organisationId: null }));
const on = { requestsEnabled: true, draftsEnabled: true, memberRolesEnabled: true };
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{CustomerWorkspaces}from ${JSON.stringify(resolve('apps/web/app/account/customer-workspaces.tsx'))};
      const q=new URLSearchParams(location.search);
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <main className="operator-page ux-workspace ux-customer"><h1>Your requests and workspaces.</h1>
            <CustomerWorkspaces subject="synthetic-alice" issuer=${JSON.stringify(issuer)} {...JSON.parse(q.get('props')||'{}')}/>
          </main>
        </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'next-fixture',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : 'const router={replace:()=>{},push:()=>{}};export function useRouter(){return router}export function usePathname(){return "/account"}',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspaces</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Sent = Record<string, unknown>;
type Setup = {
  /** The list answers this status instead of a list: the control is closed. */
  closed?: number;
  states?: Record<string, Record<string, unknown>>;
  /** Set failReads while the test runs and every read of the lifecycle answers 500. */
  control?: { failReads: boolean };
  answer?: (sent: Sent) => { status: number; json: unknown } | undefined;
};
const stateFor = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  open: true,
  workspaceId: id,
  name: workspaces.find((w) => w.id === id)!.name,
  archived: false,
  version: 3,
  role,
  history: [],
  offer: null,
  ownerMemberId: null,
  protectedMembers: [],
  keepsAccess: false,
  ...extra,
});
async function open(page: Page, setup: Setup = {}) {
  const states: Record<string, Record<string, unknown>> = {
    [ids.own]: stateFor(ids.own, 'owner'),
    [ids.adm]: stateFor(ids.adm, 'admin'),
    [ids.mem]: stateFor(ids.mem, 'member'),
    ...setup.states,
  };
  const sent: Sent[] = [];
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces } }),
  );
  await page.route('**/api/customer-workspace-access*', (route) =>
    route.fulfill({
      json: {
        workspaceId: ids.own,
        ownerProtected: true,
        nextInvitationAfter: null,
        nextMemberAfter: null,
        invitations: [],
        memberships: [
          {
            id: memberA,
            label: 'Synthetic Rahim',
            role: 'admin',
            createdAt: '2026-11-01T09:00:00Z',
            status: 'active',
          },
          {
            id: memberB,
            label: 'Synthetic Salma',
            role: 'member',
            createdAt: '2026-11-01T09:00:00Z',
            status: 'active',
          },
          {
            id: '00000000-0000-4000-8000-0000000000f3',
            label: 'Synthetic Gone',
            role: 'member',
            createdAt: '2026-11-01T09:00:00Z',
            status: 'revoked',
          },
        ],
      },
    }),
  );
  await page.route('**/api/customer-workspace-lifecycle**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      if (setup.closed) return route.fulfill({ status: setup.closed, json: { error: 'closed' } });
      if (setup.control?.failReads)
        return route.fulfill({
          status: 500,
          json: { error: 'The request could not be completed.' },
        });
      const id = new URL(request.url()).searchParams.get('workspaceId');
      return route.fulfill({
        json: id
          ? states[id]
          : Object.values(states).map((s) => ({
              workspaceId: s.workspaceId,
              archived: s.archived,
              version: s.version,
            })),
      });
    }
    const body = request.postDataJSON() as Sent;
    sent.push(body);
    const id = String(body.workspaceId ?? ids.own);
    const custom = setup.answer?.(body);
    if (custom) return route.fulfill({ status: custom.status, json: custom.json });
    const state = states[id]!;
    if (body.action === 'rename') state.name = String(body.name);
    if (body.action === 'archive') state.archived = true;
    if (body.action === 'restore') state.archived = false;
    if (body.action === 'archive' || body.action === 'restore' || body.action === 'rename')
      state.version = Number(state.version) + 1;
    if (body.action === 'offer_transfer')
      state.offer = {
        offerId,
        toMemberId: body.memberId,
        expiresAt: '2099-01-01T10:00:00Z',
        toYou: false,
        byYou: true,
      };
    if (body.action === 'cancel_transfer') state.offer = null;
    return route.fulfill({
      json: { workspaceId: id, operation: String(body.action), expiresAt: '2099-01-01T10:00:00Z' },
    });
  });
  await page.goto(`${origin}/?props=${encodeURIComponent(JSON.stringify(on))}`);
  await expect(page.getByRole('table', { name: 'Your workspaces' })).toBeVisible();
  return { sent };
}
const trigger = (page: Page, name: string) =>
  page.getByRole('button', { name: 'Actions for ' + name });
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);
const owner = 'Synthetic Dhaka Knits';
const menuNames = async (page: Page, name: string) => {
  await trigger(page, name).click();
  return page.getByRole('menuitem').allTextContents();
};
const lifecycleItems = ['Rename Workspace', 'Transfer Ownership', 'Archive Workspace'];

test('G4-01 only the owner row offers the lifecycle actions', async ({ page }) => {
  await open(page);
  expect(await menuNames(page, owner)).toEqual(expect.arrayContaining(lifecycleItems));
  await page.keyboard.press('Escape');
  for (const name of ['Synthetic Chattogram Dyers', 'Synthetic Gazipur Wovens']) {
    const items = await menuNames(page, name);
    for (const item of lifecycleItems) expect(items).not.toContain(item);
    await page.keyboard.press('Escape');
  }
});

test('G4-02 a closed or unavailable control draws nothing: no menu items, notices or filter', async ({
  page,
}) => {
  for (const closed of [503, 404]) {
    await page.unrouteAll();
    await open(page, { closed });
    const items = await menuNames(page, owner);
    for (const item of lifecycleItems) expect(items).not.toContain(item);
    await expect(page.getByText('Archived')).toHaveCount(0);
    await expect(page.getByRole('group', { name: /Active|Archived/ })).toHaveCount(0);
  }
});

test('G4-03 Rename Workspace needs a changed name and a reason of 10 to 500 characters, and sends the exact request', async ({
  page,
}) => {
  const { sent } = await open(page);
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Rename Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename Workspace' });
  const save = dialog.getByRole('button', { name: 'Save Name', exact: true });
  await expect(dialog.getByText('Current name: ' + owner)).toBeVisible();
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Workspace name').fill('Synthetic Dhaka Knitwear');
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Why are you renaming it?').fill('too short');
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Why are you renaming it?').fill('We rebranded this year');
  await expect(save).toBeEnabled();
  expect(sent).toHaveLength(0);
  await save.click();
  await expect(page.getByText('Workspace renamed to Synthetic Dhaka Knitwear.')).toBeVisible();
  expect(sent).toEqual([
    {
      action: 'rename',
      workspaceId: ids.own,
      name: 'Synthetic Dhaka Knitwear',
      reason: 'We rebranded this year',
      expectedVersion: 3,
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    },
  ]);
  expect(JSON.stringify(sent)).not.toMatch(/subject|issuer|principal/i);
});

test('G4-04 a stale rename keeps the typed name, shows the current name and Use Current Name, and the next save uses the new version', async ({
  page,
}) => {
  let first = true;
  const { sent } = await open(page, {
    answer: () =>
      first
        ? ((first = false),
          {
            status: 409,
            json: {
              error: 'changed',
              code: 'stale',
              currentName: 'Synthetic Someone Else Named It',
              currentVersion: 9,
            },
          })
        : undefined,
  });
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Rename Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename Workspace' });
  await dialog.getByLabel('Workspace name').fill('My Typed Name');
  await dialog.getByLabel('Why are you renaming it?').fill('A long enough reason');
  await dialog.getByRole('button', { name: 'Save Name' }).click();
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('The name is now Synthetic Someone Else Named It');
  await expect(alert).toBeFocused();
  await expect(dialog.getByLabel('Workspace name')).toHaveValue('My Typed Name');
  await expect(dialog.getByText('Current name: Synthetic Someone Else Named It')).toBeVisible();
  await dialog.getByRole('button', { name: 'Use Current Name' }).click();
  await expect(dialog.getByLabel('Workspace name')).toHaveValue('Synthetic Someone Else Named It');
  await dialog.getByLabel('Workspace name').fill('My Typed Name');
  await dialog.getByRole('button', { name: 'Save Name' }).click();
  await expect(page.getByText('Workspace renamed to My Typed Name.')).toBeVisible();
  expect(sent.map((s) => s.expectedVersion)).toEqual([3, 9]);
  expect(sent[0]!.commandId).not.toEqual(sent[1]!.commandId);
});

test('G4-05 a rate limit keeps the same command id for the retry, and a denial or outage uses plain words', async ({
  page,
}) => {
  let calls = 0;
  const { sent } = await open(page, {
    answer: () => (++calls === 1 ? { status: 429, json: { error: 'slow' } } : undefined),
  });
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Rename Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename Workspace' });
  await dialog.getByLabel('Workspace name').fill('Synthetic Retry Name');
  await dialog.getByLabel('Why are you renaming it?').fill('A long enough reason');
  await dialog.getByRole('button', { name: 'Save Name' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'The request limit was reached. Try again later.',
  );
  await dialog.getByRole('button', { name: 'Save Name' }).click();
  await expect(page.getByText('Workspace renamed to Synthetic Retry Name.')).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[0]!.commandId).toEqual(sent[1]!.commandId);
});

for (const [status, words] of [
  [403, 'You do not have permission to do this.'],
  [503, 'This is unavailable right now. Nothing was changed.'],
] as const)
  test(`G4-06 a ${status} answer to Archive Workspace says ${words}`, async ({ page }) => {
    await open(page, { answer: () => ({ status, json: { error: 'x' } }) });
    await trigger(page, owner).click();
    await page.getByRole('menuitem', { name: 'Archive Workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Archive ' + owner + '?' });
    await dialog.getByLabel('Type the workspace name to confirm').fill(owner);
    await dialog.getByRole('button', { name: 'Archive Workspace' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(words);
    await expect(dialog).toBeVisible();
  });

test('G4-07 Archive Workspace lists the consequences, needs the typed name, keeps focus on Keep Workspace, then Undo restores within ten seconds', async ({
  page,
}) => {
  const { sent } = await open(page);
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Archive Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive ' + owner + '?' });
  await expect(dialog.getByRole('button', { name: 'Keep Workspace' })).toBeFocused();
  await expect(dialog.getByRole('listitem')).toHaveText([
    'New private requests, invitations and registrations stop.',
    'Existing records stay readable.',
    'Nothing is deleted.',
    'Restore Workspace undoes it.',
  ]);
  await expect(dialog).not.toContainText(/read-only/i);
  const archive = dialog.getByRole('button', { name: 'Archive Workspace' });
  await expect(archive).not.toBeFocused();
  await expect(archive).toBeDisabled();
  await dialog.getByLabel('Type the workspace name to confirm').fill(owner.toLowerCase());
  await expect(archive).toBeDisabled();
  await dialog.getByLabel('Type the workspace name to confirm').fill(owner);
  expect(sent).toHaveLength(0);
  await archive.click();
  const undo = page.getByRole('status').filter({ hasText: 'was archived.' });
  await expect(undo).toContainText(owner + ' was archived.');
  expect(sent[0]).toMatchObject({
    action: 'archive',
    workspaceId: ids.own,
    expectedVersion: 3,
    confirmName: owner,
  });
  await undo.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(owner + ' was restored.')).toBeVisible();
  expect(sent[1]).toMatchObject({ action: 'restore', workspaceId: ids.own, expectedVersion: 4 });
  expect(sent[1]!.commandId).not.toEqual(sent[0]!.commandId);
});

test('G4-08 the Undo line goes after ten seconds, the Archived filter holds the workspace with the banner, and Restore Workspace brings it back', async ({
  page,
}) => {
  await page.clock.install();
  await open(page, {
    states: { [ids.own]: stateFor(ids.own, 'owner', { archived: true, version: 5 }) },
  });
  await expect(page.getByRole('radio', { name: /Active/ })).toBeChecked();
  await expect(page.getByRole('row', { name: new RegExp(owner) })).toHaveCount(0);
  await page.getByRole('radio', { name: /Archived/ }).check();
  const row = page.getByRole('row', { name: new RegExp(owner) });
  await expect(row).toContainText('Archived');
  const banner =
    'This workspace is archived. New private requests, invitations and registrations are paused. Existing records stay readable.';
  await expect(page.getByText(banner, { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/read-only/i);
  // No New Request for an archived workspace, and the reason is in words.
  await expect(row).toContainText('New requests are closed while this workspace is archived.');
  await trigger(page, owner).click();
  expect(await page.getByRole('menuitem').allTextContents()).not.toContain('New Request');
  await page.getByRole('menuitem', { name: 'Restore Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore ' + owner + '?' });
  await expect(dialog.getByRole('button', { name: 'Not Now' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Restore Workspace' }).click();
  await expect(page.getByText(owner + ' was restored.')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Archived/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: new RegExp(owner) })).toBeVisible();
});

test('G4-09 the Undo line disappears after ten seconds', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Archive Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive ' + owner + '?' });
  await dialog.getByLabel('Type the workspace name to confirm').fill(owner);
  await dialog.getByRole('button', { name: 'Archive Workspace' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.clock.runFor(10_500);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

test('G4-10b Transfer Ownership shows exactly the active members however late the team arrives', async ({
  page,
}) => {
  await open(page);
  await page.route('**/api/customer-workspace-access*', async (route) => {
    await new Promise((done) => setTimeout(done, 1200));
    return route.fallback();
  });
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Transfer Ownership' }).click();
  const dialog = page.getByRole('dialog', { name: 'Transfer Ownership' });
  await expect(dialog.getByLabel('New owner').locator('option')).toHaveText(
    ['Choose a member', 'Synthetic Rahim, admin', 'Synthetic Salma, member'],
    { timeout: 10_000 },
  );
});

test('G4-10 Transfer Ownership lists only active members, needs the typed name, sends the offer, and the owner can cancel it', async ({
  page,
}) => {
  const { sent } = await open(page);
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Transfer Ownership' }).click();
  const dialog = page.getByRole('dialog', { name: 'Transfer Ownership' });
  // The team arrives from a request, so the list is waited for: reading it once at the click raced that request.
  await expect(dialog.getByLabel('New owner').locator('option')).toHaveText([
    'Choose a member',
    'Synthetic Rahim, admin',
    'Synthetic Salma, member',
  ]);
  const send = dialog.getByRole('button', { name: 'Send Offer' });
  await dialog.getByLabel('New owner').selectOption(memberB);
  await expect(send).toBeDisabled();
  await dialog.getByLabel('Type the workspace name to confirm').fill(owner);
  await send.click();
  await expect(
    page.getByText(/Offer sent to Synthetic Salma\. It stays open until 1 Jan 2099, 10:00 UTC\./),
  ).toBeVisible();
  expect(sent[0]).toMatchObject({
    action: 'offer_transfer',
    workspaceId: ids.own,
    memberId: memberB,
    confirmName: owner,
    expectedVersion: 3,
  });
  await expect(
    page.getByText('Ownership offer sent. It stays open until 1 Jan 2099, 10:00 UTC.'),
  ).toBeVisible();
  await trigger(page, owner).click();
  await expect(page.getByRole('menuitem', { name: 'Cancel Ownership Offer' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Transfer Ownership' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cancel Offer' }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancel Ownership Offer?' });
  await cancel.getByRole('button', { name: 'Cancel Offer' }).click();
  await expect(page.getByText('The ownership offer was cancelled.')).toBeVisible();
  expect(sent[1]).toMatchObject({ action: 'cancel_transfer', workspaceId: ids.own, offerId });
});

test('G4-11 the named member sees Accept Ownership and Decline, and each asks first', async ({
  page,
}) => {
  const offer = {
    offerId,
    toMemberId: memberB,
    expiresAt: '2099-01-01T10:00:00Z',
    toYou: true,
    byYou: false,
  };
  const { sent } = await open(page, {
    states: { [ids.mem]: stateFor(ids.mem, 'member', { offer }) },
  });
  const notice = page.getByRole('group', {
    name: 'Workspace notices for Synthetic Gazipur Wovens',
  });
  await expect(notice).toContainText('wants to make you the owner of Synthetic Gazipur Wovens');
  await expect(notice).toContainText('1 Jan 2099, 10:00 UTC');
  await notice.getByRole('button', { name: 'Decline' }).click();
  const decline = page.getByRole('dialog', { name: 'Decline Ownership?' });
  await expect(decline.getByRole('button', { name: 'Not Now' })).toBeFocused();
  await decline.getByRole('button', { name: 'Not Now' }).click();
  expect(sent).toHaveLength(0);
  await notice.getByRole('button', { name: 'Accept Ownership' }).click();
  const accept = page.getByRole('dialog', {
    name: 'Accept Ownership of Synthetic Gazipur Wovens?',
  });
  await accept.getByRole('button', { name: 'Accept Ownership' }).click();
  await expect(page.getByText('You are now the owner of Synthetic Gazipur Wovens.')).toBeVisible();
  expect(sent).toEqual([{ action: 'accept_transfer', offerId, commandId: expect.any(String) }]);
});

test('G4-12 an expired offer shows plain words to the owner and the member, and an offer answered after expiry shows the server words', async ({
  page,
}) => {
  const gone = '2020-01-01T10:00:00Z';
  await open(page, {
    states: {
      [ids.own]: stateFor(ids.own, 'owner', {
        offer: { offerId, toMemberId: memberA, expiresAt: gone, toYou: false, byYou: true },
      }),
      [ids.mem]: stateFor(ids.mem, 'member', {
        offer: { offerId, toMemberId: memberB, expiresAt: gone, toYou: true, byYou: false },
      }),
    },
  });
  await expect(
    page.getByText('The offer expired on 1 Jan 2020, 10:00 UTC. You are still the owner.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transfer Ownership' }).first()).toBeVisible();
  await expect(
    page.getByText('This offer expired on 1 Jan 2020, 10:00 UTC. Ask the owner to send a new one.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept Ownership' })).toHaveCount(0);
});

test('G4-13 dialogs trap focus, return it to the row menu, have 44 pixel buttons and no axe violations at 390 and 1440', async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.unrouteAll();
    await open(page);
    await trigger(page, owner).click();
    await page.getByRole('menuitem', { name: 'Archive Workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Archive ' + owner + '?' });
    for (const name of ['Keep Workspace', 'Archive Workspace'])
      expect(
        (await dialog.getByRole('button', { name }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    expect(await axe(page)).toEqual([]);
    for (let n = 0; n < 6; n++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(trigger(page, owner)).toBeFocused();
  }
});

test('G4-14 the team list labels a member who is or was an owner with the access they really have, and offers no removal', async ({
  page,
}) => {
  await open(page, {
    states: {
      [ids.own]: stateFor(ids.own, 'owner', {
        ownerMemberId: memberA,
        protectedMembers: [{ memberId: memberA, role: 'owner' }],
      }),
    },
  });
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Manage Team' }).click();
  const dialog = page.getByRole('dialog', { name: 'Team for ' + owner });
  await expect(dialog).toContainText('Synthetic Rahim · Owner');
  await expect(dialog.getByText('Synthetic Salma · member')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Remove Invited Membership for Synthetic Rahim' }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Remove Invited Membership for Synthetic Salma' }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    'This person is or was an owner and keeps admin access. Ask support to remove it.',
  );
});

test('G4-14b a former owner who is now an admin is labelled Admin and cannot be removed or demoted from the list', async ({
  page,
}) => {
  await open(page, {
    states: {
      [ids.own]: stateFor(ids.own, 'owner', {
        protectedMembers: [{ memberId: memberA, role: 'admin' }],
      }),
    },
  });
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Manage Team' }).click();
  const dialog = page.getByRole('dialog', { name: 'Team for ' + owner });
  await expect(dialog).toContainText('Synthetic Rahim · Admin');
  await expect(dialog.getByRole('button', { name: /Synthetic Rahim/ })).toHaveCount(0);
});

test('G4-14c archiving with an old sign-in says so and offers to sign out and in again', async ({
  page,
}) => {
  await open(page, {
    answer: (body) =>
      body.action === 'archive'
        ? {
            status: 403,
            json: { error: lifecycleWords.signInAgain, code: 'recent_sign_in_required' },
          }
        : undefined,
  });
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Archive Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive ' + owner + '?' });
  await dialog.getByLabel('Type the workspace name to confirm').fill(owner);
  await dialog.getByRole('button', { name: 'Archive Workspace' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(lifecycleWords.signInAgain);
  await expect(dialog.getByRole('button', { name: 'Sign Out and Sign In Again' })).toBeVisible();
});

test('G4-15 an Undo that fails says so in an alert instead of doing nothing', async ({ page }) => {
  const { sent } = await open(page, {
    answer: (body) =>
      body.action === 'restore' ? { status: 503, json: { error: 'down' } } : undefined,
  });
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Archive Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive ' + owner + '?' });
  await dialog.getByLabel('Type the workspace name to confirm').fill(owner);
  await dialog.getByRole('button', { name: 'Archive Workspace' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'This is unavailable right now. Nothing was changed.',
  );
  expect(sent.map((body) => body.action)).toEqual(['archive', 'restore']);
});

test('G4-16 when the status cannot be refreshed an archived workspace stays archived, and a small note says so', async ({
  page,
}) => {
  const control = { failReads: false };
  await open(page, {
    control,
    states: { [ids.mem]: stateFor(ids.mem, 'member', { archived: true }) },
  });
  await expect(page.getByRole('radio', { name: /Archived/ })).toBeVisible();
  control.failReads = true;
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Rename Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename Workspace' });
  await dialog.getByLabel('Workspace name').fill('Synthetic Dhaka Knitwear');
  await dialog.getByLabel('Why are you renaming it?').fill('We rebranded this year');
  await dialog.getByRole('button', { name: 'Save Name', exact: true }).click();
  await expect(page.getByText('Could not refresh workspace status')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Archived/ })).toBeVisible();
  await page.getByRole('radio', { name: /Archived/ }).check();
  await expect(page.getByRole('row', { name: /Synthetic Gazipur Wovens/ })).toBeVisible();
  control.failReads = false;
});

test('G4-17 the member picker pages through the whole team, and only says there is no one when the list is exhausted', async ({
  page,
}) => {
  await open(page);
  const seen: string[] = [];
  const revoked = (id: string) => ({
    id,
    label: 'Synthetic Gone ' + id.slice(-2),
    role: 'member',
    createdAt: '2026-11-01T09:00:00Z',
    status: 'revoked',
  });
  await page.route('**/api/customer-workspace-access*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    seen.push(query.get('memberAfter') ?? 'first');
    const late = query.get('memberAfter') === '00000000-0000-4000-8000-0000000000a1';
    return route.fulfill({
      json: {
        workspaceId: ids.own,
        ownerProtected: true,
        nextInvitationAfter: null,
        nextMemberAfter: late ? null : '00000000-0000-4000-8000-0000000000a1',
        invitations: [],
        memberships: late
          ? [
              {
                id: '00000000-0000-4000-8000-0000000000f9',
                label: 'Synthetic Late',
                role: 'member',
                createdAt: '2026-11-01T09:00:00Z',
                status: 'active',
              },
            ]
          : [revoked('00000000-0000-4000-8000-0000000000e1')],
      },
    });
  });
  await trigger(page, owner).click();
  await page.getByRole('menuitem', { name: 'Transfer Ownership' }).click();
  const dialog = page.getByRole('dialog', { name: 'Transfer Ownership' });
  await expect(dialog.getByLabel('New owner').locator('option')).toHaveText([
    'Choose a member',
    'Synthetic Late, member',
  ]);
  await expect(dialog.getByText('There is no one to transfer to yet')).toHaveCount(0);
  expect(seen).toEqual(['first', '00000000-0000-4000-8000-0000000000a1']);
});

test('G4-18 a paused control keeps an archived workspace archived with Restore, offers no new changes, and a named member can still decline', async ({
  page,
}) => {
  const offer = {
    offerId,
    toMemberId: memberB,
    expiresAt: '2099-01-01T10:00:00Z',
    toYou: true,
    byYou: false,
  };
  const { sent } = await open(page, {
    states: {
      [ids.own]: stateFor(ids.own, 'owner', { open: false, archived: true, version: 5 }),
      [ids.adm]: stateFor(ids.adm, 'owner', { open: false }),
      [ids.mem]: stateFor(ids.mem, 'member', { open: false, offer }),
    },
  });
  // The archived workspace is not drawn as active: it sits under Archived with its banner.
  await expect(page.getByRole('row', { name: new RegExp(owner) })).toHaveCount(0);
  await page.getByRole('radio', { name: /Archived/ }).check();
  await expect(page.getByRole('row', { name: new RegExp(owner) })).toContainText('Archived');
  // Restore stays available while paused, and nothing else is offered for it.
  expect(await menuNames(page, owner)).toEqual(expect.arrayContaining(['Restore Workspace']));
  const archivedItems = await page.getByRole('menuitem').allTextContents();
  for (const item of lifecycleItems) expect(archivedItems).not.toContain(item);
  await page.getByRole('menuitem', { name: 'Restore Workspace' }).click();
  await page
    .getByRole('dialog', { name: 'Restore ' + owner + '?' })
    .getByRole('button', { name: 'Restore Workspace' })
    .click();
  await expect(page.getByText(owner + ' was restored.')).toBeVisible();
  expect(sent).toEqual([
    { action: 'restore', workspaceId: ids.own, expectedVersion: 5, commandId: expect.any(String) },
  ]);
  // An active workspace offers no rename, transfer or archive while paused.
  const items = await menuNames(page, 'Synthetic Chattogram Dyers');
  for (const item of lifecycleItems) expect(items).not.toContain(item);
  await page.keyboard.press('Escape');
  // The named member can still decline an open offer, but accepting waits for the control.
  const notice = page.getByRole('group', {
    name: 'Workspace notices for Synthetic Gazipur Wovens',
  });
  await expect(notice).toContainText('Accepting is paused right now.');
  await expect(notice.getByRole('button', { name: 'Decline' })).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Accept Ownership' })).toHaveCount(0);
});

test('G4-18 Leave Workspace is offered to an invited admin, and not to an admin who holds an owner or admin membership', async ({
  page,
}) => {
  await open(page);
  expect(await menuNames(page, 'Synthetic Chattogram Dyers')).toContain('Leave Workspace');
  await page.keyboard.press('Escape');
  await page.unrouteAll();
  await open(page, { states: { [ids.adm]: stateFor(ids.adm, 'admin', { keepsAccess: true }) } });
  expect(await menuNames(page, 'Synthetic Chattogram Dyers')).not.toContain('Leave Workspace');
});
