import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CRUD G5, Account and Data: the Coming soon line while the control is closed, Close Account (wording A, typed
// phrase, blockers), Ask for Erasure (wording B, reference, due date), the closed and final states, and the
// closed-account screen. No request carries an id of a person. Case ids: G5-01 to G5-10.
import { accountLifecycleWords } from '../../packages/auth/src/customer-account-lifecycle';
import { accountWords } from '../../apps/web/app/account/account-lifecycle-words';
import { lifecycleWords } from '../../apps/web/app/account/workspace-lifecycle-client';

let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{AccountClosure,AccountClosureComingSoon}from ${JSON.stringify(resolve('apps/web/app/account/account-closure.tsx'))};
      import{ClosedAccountGate}from ${JSON.stringify(resolve('apps/web/components/customer-closed-account.tsx'))};
      const fixtureSubject='synthetic-fixture-subject';const fixtureIssuer='https://ep-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
      const part=new URLSearchParams(location.search).get('part');
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          {part==='gate'
            ? <ClosedAccountGate subject={fixtureSubject} issuer={fixtureIssuer}><main><h1>Home</h1><p>Customer pages</p></main></ClosedAccountGate>
            : part==='soon'
              ? <main className="operator-page ux-workspace ux-customer"><h1>Security</h1><AccountClosureComingSoon/></main>
              : <main className="operator-page ux-workspace ux-customer"><h1>Security</h1><AccountClosure subject={fixtureSubject} issuer={fixtureIssuer}/></main>}
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
          b.onResolve({ filter: /^next\/(link|navigation)$|neon-auth-client$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents: args.path.endsWith('neon-auth-client')
              ? 'export const accountClient={signOut:async()=>{if(window.__signOutFails)throw new Error("down");return {}}}'
              : args.path === 'next/link'
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : 'const router={replace:(path)=>{(window.__replaced=window.__replaced||[]).push(path)},push:()=>{},refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return "/account"}',
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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
type State = Record<string, unknown>;
const active: State = {
  open: true,
  status: 'active',
  closedAt: null,
  undoUntil: null,
  canUndo: false,
  erasure: null,
  blockers: [],
};
const closedState: State = {
  ...active,
  status: 'closed',
  closedAt: '2026-11-06T10:00:00Z',
  undoUntil: '2026-12-06T10:00:00Z',
  canUndo: true,
};
const erasure = {
  reference: 'ERA-2026-0042',
  filedAt: '2026-11-06T10:00:00Z',
  dueAt: '2026-12-06T10:00:00Z',
  status: 'received',
  note: null,
};
type Setup = {
  state?: State;
  status?: number;
  part?: string;
  /** Every state-changing answer waits this long, so a test can look at the screen while a request is in flight. */
  delayMs?: number;
  answer?: (sent: Sent) => { status: number; json: unknown } | undefined;
};
async function open(page: Page, setup: Setup = {}) {
  let state = setup.state ?? active;
  const sent: Sent[] = [];
  const identities: Record<string, string | undefined>[] = [];
  await page.route('**/api/customer-account-lifecycle', async (route) => {
    const request = route.request();
    identities.push({
      method: request.method(),
      subject: request.headers()['x-corridra-customer-subject'],
      issuer: request.headers()['x-corridra-customer-issuer'],
    });
    if (request.method() === 'GET')
      return route.fulfill({ status: setup.status ?? 200, json: state });
    const body = request.postDataJSON() as Sent;
    sent.push(body);
    if (setup.delayMs) await new Promise((done) => setTimeout(done, setup.delayMs));
    const custom = setup.answer?.(body);
    if (custom) return route.fulfill({ status: custom.status, json: custom.json });
    if (body.action === 'close') {
      state = closedState;
      return route.fulfill({
        json: {
          operation: 'close',
          changed: true,
          status: 'closed',
          closedAt: '2026-11-06T10:00:00Z',
          undoUntil: '2026-12-06T10:00:00Z',
        },
      });
    }
    if (body.action === 'undo') {
      state = active;
      return route.fulfill({
        json: {
          operation: 'undo',
          changed: true,
          status: 'active',
          closedAt: null,
          undoUntil: null,
        },
      });
    }
    state = { ...state, erasure };
    return route.fulfill({
      json: {
        operation: 'file_erasure',
        changed: true,
        reference: erasure.reference,
        filedAt: erasure.filedAt,
        dueAt: erasure.dueAt,
      },
    });
  });
  await page.goto(`${origin}/?part=${setup.part ?? 'closure'}`);
  return { sent, identities };
}
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);
const comingSoon =
  'Coming soon. To close your account or ask for erasure now, write to the privacy contact on the privacy page. We reply within 30 days.';

test('G5-01 the typed phrase and the wording stay in step with the server', () => {
  expect(accountWords.closePhrase).toBe(accountLifecycleWords.closePhrase);
  expect(JSON.stringify(accountWords)).not.toMatch(/—|–|MFA|read-only/);
});

for (const [name, setup] of [
  ['the server says the control is closed', { status: 503 }],
  ['the control is not open', { state: { ...active, open: false } }],
  ['the account is signed out', { status: 401 }],
] as const)
  test(`G5-02 ${name}: the Coming soon line shows, linked to the privacy page, with no control`, async ({
    page,
  }) => {
    await open(page, setup);
    const line = page.getByText(comingSoon, { exact: true });
    await expect(line).toBeVisible();
    await expect(line.getByRole('link', { name: 'privacy page' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    await expect(page.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

test('G5-03 the line is there at once when the server already knows the control is closed', async ({
  page,
}) => {
  await open(page, { part: 'soon' });
  await expect(page.getByText(comingSoon, { exact: true })).toBeVisible();
});

test('G5-04 Close Account shows wording A, needs the typed phrase, sends no id, then shows the closed state and Reopen My Account undoes it', async ({
  page,
}) => {
  const { sent } = await open(page);
  await expect(page.getByText(comingSoon)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Close Your Account?' });
  await expect(dialog.getByText(accountWords.closeBody, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep My Account' })).toBeFocused();
  const close = dialog.getByRole('button', { name: 'Close Account', exact: true });
  await expect(close).not.toBeFocused();
  await expect(close).toBeDisabled();
  await dialog.getByLabel('Type Close my account to confirm').fill('close my account');
  await expect(close).toBeDisabled();
  await dialog.getByLabel('Type Close my account to confirm').fill('Close my account');
  expect(sent).toHaveLength(0);
  await close.click();
  await expect(page.getByText('Your account is closed until 6 Dec 2026, 10:00 UTC.')).toBeVisible();
  expect(sent).toEqual([
    { action: 'close', confirmation: 'Close my account', commandId: expect.any(String) },
  ]);
  await page.getByRole('button', { name: 'Reopen My Account' }).click();
  await expect(page.getByText('Your account is open again.')).toBeVisible();
  expect(sent[1]).toMatchObject({ action: 'undo' });
  expect(JSON.stringify(sent)).not.toMatch(/subject|issuer|principal|accountId|userId/i);
});

test('G5-05 an account that still owns workspaces alone shows the blockers with links and no Close button', async ({
  page,
}) => {
  await open(page, {
    state: {
      ...active,
      blockers: [
        { workspaceId: '00000000-0000-4000-8000-0000000000e1', name: 'Synthetic Dhaka Knits' },
      ],
    },
  });
  await page.getByRole('button', { name: 'Close Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Close Your Account?' });
  await expect(dialog).toContainText('You are the only owner of these workspaces.');
  await expect(dialog.getByRole('link', { name: 'Manage Synthetic Dhaka Knits' })).toHaveAttribute(
    'href',
    /tab=workspaces/,
  );
  await expect(dialog.getByRole('button', { name: 'Close Account', exact: true })).toHaveCount(0);
});

test('G5-06 a refusal, a rate limit and an outage keep the dialog open with plain words, and the retry reuses the command id', async ({
  page,
}) => {
  const answers = [
    { status: 429, json: { error: 'slow' } },
    { status: 503, json: { error: 'x', code: 'unavailable' } },
    { status: 409, json: { error: 'Transfer or archive your workspaces first.' } },
  ];
  const { sent } = await open(page, { answer: () => answers.shift() });
  await page.getByRole('button', { name: 'Close Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Close Your Account?' });
  await dialog.getByLabel('Type Close my account to confirm').fill('Close my account');
  const close = dialog.getByRole('button', { name: 'Close Account', exact: true });
  await close.click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'The request limit was reached. Try again later.',
  );
  await close.click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'This is unavailable right now. Nothing was changed.',
  );
  await close.click();
  await expect(dialog.getByRole('alert')).toHaveText('Transfer or archive your workspaces first.');
  expect(sent[1]!.commandId).toEqual(sent[0]!.commandId);
  expect(sent[2]!.commandId).toEqual(sent[0]!.commandId);
  await close.click();
  await expect(page.getByText('Your account is closed until')).toBeVisible();
  expect(sent[3]!.commandId).not.toEqual(sent[2]!.commandId);
});

test('G5-07 Ask for Erasure shows wording B, files the request with no body but the action, and shows reference, dates and status', async ({
  page,
}) => {
  const { sent } = await open(page);
  await page.getByRole('button', { name: 'Ask for Erasure' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ask Us to Erase Your Personal Data' });
  await expect(dialog.getByText(accountWords.erasureBody, { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText(/will be erased|has been erased/i);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Send Erasure Request' }).click();
  await expect(
    page.getByText('Your erasure request was sent. Reference ERA-2026-0042.'),
  ).toBeVisible();
  expect(sent).toEqual([{ action: 'file_erasure', commandId: expect.any(String) }]);
  const panel = page.locator('dl');
  await expect(panel).toContainText('ERA-2026-0042');
  await expect(panel).toContainText('6 Nov 2026, 10:00 UTC');
  await expect(panel).toContainText('Staff reply due by');
  await expect(panel).toContainText('6 Dec 2026, 10:00 UTC');
  await expect(panel).toContainText('Received');
  await expect(page.getByRole('button', { name: 'Ask for Erasure' })).toHaveCount(0);
});

test('G5-08 an existing erasure request shows its panel instead of the button,', async ({
  page,
}) => {
  await open(page, { state: { ...active, erasure: { ...erasure, status: 'in_progress' } } });
  await expect(page.getByRole('button', { name: 'Ask for Erasure' })).toHaveCount(0);
  await expect(page.getByText('Staff are looking at your request.')).toBeVisible();
  await expect(page.getByText('In Review')).toBeVisible();
});

test('G5-09 a final account says so and offers no Reopen button', async ({ page }) => {
  await open(page, { state: { ...closedState, status: 'final', canUndo: false, undoUntil: null } });
  await expect(
    page.getByText('Your account was closed and can no longer be reopened.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen My Account' })).toHaveCount(0);
});

test('G5-10 the closed-account screen replaces the pages, shows the date, Reopen My Account and Sign Out only, and reopening works', async ({
  page,
}) => {
  const { sent } = await open(page, { part: 'gate', state: { ...closedState, erasure } });
  await expect(page.getByRole('heading', { name: 'Your Account Is Closed' })).toBeFocused();
  await expect(page.getByText('Customer pages')).toHaveCount(0);
  await expect(
    page.getByText('You can undo this until 6 Dec 2026, 10:00 UTC. After that it is final.'),
  ).toBeVisible();
  await expect(
    page.getByText('You also have an erasure request open. Reference ERA-2026-0042.'),
  ).toBeVisible();
  await expect(page.getByRole('button')).toHaveText(['Reopen My Account', 'Sign Out']);
  expect(await axe(page)).toEqual([]);
  for (const button of await page.getByRole('button').all())
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  page.on('framenavigated', () => undefined);
  await page.getByRole('button', { name: 'Reopen My Account' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ action: 'undo', commandId: expect.any(String) });
});

test('G5-11 an active account shows the customer pages unchanged, and a final account shows only Ask for Erasure and Sign Out', async ({
  page,
}) => {
  await open(page, { part: 'gate' });
  await expect(page.getByText('Customer pages')).toBeVisible();
  await page.unrouteAll();
  await open(page, {
    part: 'gate',
    state: { ...closedState, status: 'final', canUndo: false, undoUntil: null },
  });
  await expect(
    page.getByText('Your account was closed and can no longer be reopened.'),
  ).toBeVisible();
  await expect(page.getByRole('button')).toHaveText(['Ask for Erasure', 'Sign Out']);
});

test('G5-12 the dialogs trap focus, return focus to their button, and are axe clean at 390 and 1440', async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.unrouteAll();
    await open(page);
    const opener = page.getByRole('button', { name: 'Close Account', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Close Your Account?' });
    for (const name of ['Keep My Account', 'Close Account'])
      expect(
        (await dialog.getByRole('button', { name, exact: true }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    expect(await axe(page)).toEqual([]);
    for (let n = 0; n < 6; n++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  }
});

test('G5-13 a closed account stays closed on screen when the module control is paused: the gate shows the closed screen with Reopen and Sign Out', async ({
  page,
}) => {
  const { sent } = await open(page, { part: 'gate', state: { ...closedState, open: false } });
  await expect(page.getByRole('heading', { name: 'Your Account Is Closed' })).toBeFocused();
  await expect(page.getByText('Customer pages')).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveText([
    'Ask for Erasure',
    'Reopen My Account',
    'Sign Out',
  ]);
  await page.getByRole('button', { name: 'Reopen My Account' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ action: 'undo', commandId: expect.any(String) });
});

test('G5-14 a paused control with an active account still shows the customer pages and the Coming soon line', async ({
  page,
}) => {
  await open(page, { part: 'gate', state: { ...active, open: false } });
  await expect(page.getByText('Customer pages')).toBeVisible();
  await page.unrouteAll();
  await open(page, { state: { ...active, open: false } });
  await expect(page.getByText(comingSoon)).toBeVisible();
});

test('G5-15 the Account and Data section of a closed account offers Reopen when the control is paused', async ({
  page,
}) => {
  await open(page, { state: { ...closedState, open: false } });
  await expect(page.getByText('Your account is closed until 6 Dec 2026, 10:00 UTC.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen My Account' })).toBeVisible();
  await expect(page.getByText(comingSoon)).toHaveCount(0);
});

test('G5-16 after the account closes, focus lands on the section heading instead of being lost', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Close Account' }).click();
  const dialog = page.getByRole('dialog', { name: accountWords.closeTitle });
  await dialog
    .getByLabel(`Type ${accountWords.closePhrase} to confirm`)
    .fill(accountWords.closePhrase);
  await dialog.getByRole('button', { name: 'Close Account' }).click();
  await expect(page.getByText('Your account is closed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: accountWords.sectionHeading })).toBeFocused();
});

test('G5-17 a close that was not confirmed does not lend its command id to an erasure request', async ({
  page,
}) => {
  const { sent } = await open(page, {
    answer: (body) =>
      body.action === 'close' ? { status: 503, json: { error: 'down' } } : undefined,
  });
  await page.getByRole('button', { name: 'Close Account' }).click();
  const dialog = page.getByRole('dialog', { name: accountWords.closeTitle });
  await dialog
    .getByLabel(`Type ${accountWords.closePhrase} to confirm`)
    .fill(accountWords.closePhrase);
  await dialog.getByRole('button', { name: 'Close Account' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep My Account' }).click();
  await page.getByRole('button', { name: 'Ask for Erasure' }).click();
  await page.getByRole('button', { name: 'Send Erasure Request' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[0]!.action).toBe('close');
  expect(sent[1]!.action).toBe('file_erasure');
  expect(sent[1]!.commandId).not.toEqual(sent[0]!.commandId);
});

test('G5-18 the state read and every command name the person the page was drawn for', async ({
  page,
}) => {
  const { sent, identities } = await open(page);
  await page.getByRole('button', { name: 'Close Account' }).first().click();
  await page
    .getByLabel(`Type ${accountWords.closePhrase} to confirm`)
    .fill(accountWords.closePhrase);
  await page.getByRole('button', { name: 'Close Account' }).last().click();
  await page.getByRole('button', { name: 'Reopen My Account' }).click();
  await expect(page.getByRole('button', { name: 'Close Account' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Ask for Erasure' }).click();
  await page.getByRole('button', { name: 'Send Erasure Request' }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent.map((body) => body.action)).toEqual(['close', 'undo', 'file_erasure']);
  expect(identities.length).toBeGreaterThanOrEqual(4);
  for (const seen of identities)
    expect(seen).toMatchObject({
      subject: 'synthetic-fixture-subject',
      issuer: 'https://ep-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    });
});

test('G5-19 a closed person can ask for erasure from the closed screen: one click only opens the dialog, and the request names them', async ({
  page,
}) => {
  const { sent, identities } = await open(page, { part: 'gate', state: closedState });
  await page.getByRole('button', { name: 'Ask for Erasure' }).click();
  const dialog = page.getByRole('dialog', { name: accountWords.erasureTitle });
  await expect(dialog).toContainText(accountWords.erasureBody);
  expect(sent).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toEqual([]);
  await page.getByRole('button', { name: 'Ask for Erasure' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send Erasure Request' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ action: 'file_erasure', commandId: expect.any(String) });
  await expect(page.getByText(`Reference ${erasure.reference}`)).toBeVisible();
  for (const seen of identities) expect(seen.subject).toBe('synthetic-fixture-subject');
  await expect(page.getByText(/are hidden|separate reviewed step/)).toHaveCount(0);
});

test('G5-19b on the closed screen neither action can start while the other is in flight', async ({
  page,
}) => {
  const reopen = page.locator('button:has-text("Reopen My Account")');
  const erase = page.locator('button:has-text("Ask for Erasure")');
  await open(page, { part: 'gate', state: closedState, delayMs: 1500 });
  await erase.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send Erasure Request' }).click();
  await expect(reopen).toBeDisabled();
  await page.unrouteAll();
  await page.reload();
  const second = await open(page, { part: 'gate', state: closedState, delayMs: 1500 });
  await reopen.click();
  await expect(erase).toBeDisabled();
  await expect.poll(() => second.sent.length).toBe(1);
});

test('G5-20 a refusal that asks for a recent sign-in says so and offers to sign out and in again', async ({
  page,
}) => {
  await open(page, {
    answer: () => ({
      status: 403,
      json: { error: lifecycleWords.signInAgain, code: 'recent_sign_in_required' },
    }),
  });
  await page.getByRole('button', { name: 'Close Account' }).first().click();
  await page
    .getByLabel(`Type ${accountWords.closePhrase} to confirm`)
    .fill(accountWords.closePhrase);
  await page.getByRole('button', { name: 'Close Account' }).last().click();
  await expect(page.getByRole('alert')).toHaveText(lifecycleWords.signInAgain);
  await expect(page.getByRole('button', { name: 'Sign Out and Sign In Again' })).toBeVisible();
});

test('G5-21 Sign Out and Sign In Again returns to the sign-in page told where the person was, and says so when signing out fails', async ({
  page,
}) => {
  const refuse = () => ({
    status: 403,
    json: { error: lifecycleWords.signInAgain, code: 'recent_sign_in_required' },
  });
  await open(page, { answer: refuse });
  await page.getByRole('button', { name: 'Close Account' }).first().click();
  await page
    .getByLabel(`Type ${accountWords.closePhrase} to confirm`)
    .fill(accountWords.closePhrase);
  await page.getByRole('button', { name: 'Close Account' }).last().click();
  await page.evaluate(() => {
    (window as unknown as { __signOutFails: boolean }).__signOutFails = true;
  });
  await page.getByRole('button', { name: 'Sign Out and Sign In Again' }).click();
  await expect(page.getByText('Sign-out could not be completed. Please try again.')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __signOutFails: boolean }).__signOutFails = false;
  });
  await page.getByRole('button', { name: 'Sign Out and Sign In Again' }).click();
  // The page itself goes to the sign-in page and tells it where the person was.
  await expect(page).toHaveURL(new RegExp('/signin\\?next=' + encodeURIComponent('/') + '$'));
});
