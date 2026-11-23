import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CX PR 2b, the Workspaces tab: the real workspaces table with the real stylesheets. Case ids: CX-05 (the row
// menu and the Create, Join, Team and Leave dialogs work from the keyboard, Escape closes them, focus returns,
// axe is clean at 390 and 1440) and CX-07 (screenshots at 390 and 1440, written to the evidence folder).
const issuer = 'https://ep-cx2b-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const ownerId = '00000000-0000-4000-8000-0000000000e1';
const memberId = '00000000-0000-4000-8000-0000000000e2';
const workspaces = [
  { id: ownerId, name: 'Synthetic Dhaka Knits', role: 'owner' },
  { id: memberId, name: 'Synthetic Chattogram Dyers', role: 'member' },
  { id: '00000000-0000-4000-8000-0000000000e3', name: 'Synthetic Gazipur Wovens', role: 'admin' },
].map((row) => ({ ...row, synthetic: true, organisationId: null }));
const on = {
  requestsEnabled: true,
  draftsEnabled: true,
  profilesEnabled: true,
  programmesEnabled: true,
  serviceRequestsEnabled: true,
  billingEnabled: true,
  memberRolesEnabled: true,
};
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const folder = 'docs/design-system/evidence/revamp-cx2b';

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
  mkdirSync(folder, { recursive: true });
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

async function open(page: Page, rows = workspaces) {
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { synthetic: true, workspaces: rows } }),
  );
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
  await page.goto(`${origin}/?props=${encodeURIComponent(JSON.stringify(on))}`);
  await expect(page.getByRole('table', { name: 'Your workspaces' })).toBeVisible();
}
const trigger = (page: Page, name: string) =>
  page.getByRole('button', { name: 'Actions for ' + name });
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);

test('CX-05 a row menu opens from the keyboard, moves with the arrows and Escape returns focus to its button', async ({
  page,
}) => {
  await open(page);
  const button = trigger(page, 'Synthetic Dhaka Knits');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem', { name: 'New Request', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Continue a Saved Request' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Manage Team', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('menu', { name: 'Actions for Synthetic Dhaka Knits' })).toBeHidden();
});

test('CX-05 Create and Join open in dialogs that hold focus, close on Escape and give focus back', async ({
  page,
}) => {
  await open(page);
  for (const [opener, title] of [
    ['Create a Workspace', 'Create a Workspace'],
    ['Join a Workspace', 'Join a Workspace'],
  ] as const) {
    const button = page.getByRole('button', { name: opener, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    // Tab never leaves the dialog.
    for (let n = 0; n < 8; n++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  }
});

test('CX-05 Manage Team and Leave Workspace open from the row menu and close on Escape', async ({
  page,
}) => {
  await open(page);
  await trigger(page, 'Synthetic Dhaka Knits').click();
  await page.getByRole('menuitem', { name: 'Manage Team', exact: true }).click();
  const team = page.getByRole('dialog', { name: 'Team for Synthetic Dhaka Knits' });
  await expect(team).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(team).toBeHidden();
  await trigger(page, 'Synthetic Chattogram Dyers').click();
  await expect(page.getByRole('menuitem', { name: 'Manage Team', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Leave Workspace', exact: true }).click();
  const leave = page.getByRole('dialog', { name: /Leave/ });
  await expect(leave).toBeVisible();
  await expect(leave.getByRole('button', { name: 'Confirm leaving' })).toBeVisible();
  await leave.getByRole('button', { name: 'Keep my access' }).click();
  await expect(leave).toBeHidden();
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`CX-05 and CX-07 the workspaces table has no sideways scroll and no axe violations at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: `${folder}/workspaces-after-${width}.png`, fullPage: true });
    await trigger(page, 'Synthetic Dhaka Knits').click();
    expect(await axe(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });

// A dialog that sends a command cannot be dismissed while the request is in flight (Escape, Close and the dimmed
// area do nothing; Close is disabled and says so), and the answer is reconciled before the dialog's state goes.
const gated = () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  return { gate, release };
};
async function pressDismiss(page: Page, dialog: ReturnType<Page['getByRole']>) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click({ force: true });
  // The dimmed area is the dialog element itself.
  await dialog.click({ position: { x: 1, y: 1 } });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Working…')).toBeVisible();
}

test('CX-05 Leave cannot be dismissed while sending, then the row goes and focus returns to the list', async ({
  page,
}) => {
  await open(page);
  const { gate, release } = gated();
  let posts = 0;
  await page.route('**/api/customer-workspace-members', async (route) => {
    posts++;
    await gate;
    await route.fulfill({
      json: { workspaceId: memberId, memberId: ownerId, status: 'left' },
    });
  });
  await trigger(page, 'Synthetic Chattogram Dyers').click();
  await page.getByRole('menuitem', { name: 'Leave Workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Leave/ });
  await dialog.getByRole('button', { name: 'Confirm leaving' }).click();
  await expect.poll(() => posts).toBe(1);
  await pressDismiss(page, dialog);
  release();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('You have left the workspace')).toBeVisible();
  await expect(trigger(page, 'Synthetic Chattogram Dyers')).toHaveCount(0);
  // The answer is announced: the confirmation takes focus, as it did before the dialogs.
  await expect(page.getByRole('status').filter({ hasText: 'You have left' })).toBeFocused();
  expect(posts).toBe(1);
});

test('CX-05 Join cannot be dismissed while sending, then it closes and the confirmation takes focus', async ({
  page,
}) => {
  await open(page);
  const { gate, release } = gated();
  let posts = 0;
  const joinedId = '00000000-0000-4000-8000-0000000000f1';
  await page.route('**/api/customer-workspace-access', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts++;
    await gate;
    return route.fulfill({
      json: {
        workspaceId: joinedId,
        memberId: ownerId,
        invitationId: memberId,
        workspace: {
          id: joinedId,
          name: 'Synthetic Invited Mills',
          role: 'member',
          synthetic: true,
          organisationId: null,
        },
      },
    });
  });
  const button = page.getByRole('button', { name: 'Join a Workspace', exact: true });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Join a Workspace' });
  await dialog.getByLabel('Workspace invitation code', { exact: true }).fill('T'.repeat(43));
  await dialog.getByRole('button', { name: 'Join Workspace', exact: true }).click();
  await expect.poll(() => posts).toBe(1);
  await pressDismiss(page, dialog);
  release();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'You have joined' })).toBeFocused();
  expect(posts).toBe(1);
});

test('CX-05 Create cannot be dismissed while sending, then it closes and the confirmation takes focus', async ({
  page,
}) => {
  await open(page);
  const { gate, release } = gated();
  let posts = 0;
  await page.route('**/api/customer-workspaces', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts++;
    await gate;
    return route.fulfill({
      json: {
        id: '00000000-0000-4000-8000-0000000000f2',
        name: 'Synthetic Gate test',
        role: 'owner',
        synthetic: true,
        organisationId: null,
      },
    });
  });
  const button = page.getByRole('button', { name: 'Create a Workspace', exact: true });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Create a Workspace' });
  await dialog.getByLabel('Workspace name', { exact: true }).fill('Gate test');
  await dialog.getByRole('button', { name: 'Create Workspace', exact: true }).click();
  await expect.poll(() => posts).toBe(1);
  await pressDismiss(page, dialog);
  release();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Your workspace is confirmed' }),
  ).toBeFocused();
  expect(posts).toBe(1);
});

test('CX-05 Team cannot be dismissed while sending, then it can be closed and focus returns to the row menu', async ({
  page,
}) => {
  await open(page);
  const { gate, release } = gated();
  let posts = 0;
  await page.route('**/api/customer-workspace-access**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts++;
    await gate;
    return route.fulfill({
      json: {
        workspaceId: ownerId,
        invitationId: memberId,
        expiresAt: '2026-12-18T12:00:00.000Z',
        issued: true,
        token: 'T'.repeat(43),
      },
    });
  });
  await trigger(page, 'Synthetic Dhaka Knits').click();
  await page.getByRole('menuitem', { name: 'Manage Team', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Team for Synthetic Dhaka Knits' });
  await dialog.getByLabel('Sample invitation label', { exact: true }).fill('gate test');
  await dialog.getByRole('button', { name: 'Issue Sample Invitation', exact: true }).click();
  await expect.poll(() => posts).toBe(1);
  await pressDismiss(page, dialog);
  release();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  await expect(dialog.getByText('Working…')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger(page, 'Synthetic Dhaka Knits')).toBeFocused();
  expect(posts).toBe(1);
});

test('CX-05 returning to the window while a dialog is sending does not reload the list or strand the lock', async ({
  page,
}) => {
  await open(page);
  let gets = 0;
  await page.route('**/api/customer-workspaces', (route) => {
    if (route.request().method() === 'GET') gets++;
    return route.fallback();
  });
  const { gate, release } = gated();
  let posts = 0;
  await page.route('**/api/customer-workspace-members', async (route) => {
    posts++;
    await gate;
    await route.fulfill({
      json: { workspaceId: memberId, memberId: ownerId, status: 'left' },
    });
  });
  await trigger(page, 'Synthetic Chattogram Dyers').click();
  await page.getByRole('menuitem', { name: 'Leave Workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Leave/ });
  await dialog.getByRole('button', { name: 'Confirm leaving' }).click();
  await expect.poll(() => posts).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(300);
  expect(gets).toBe(0);
  await expect(dialog).toBeVisible();
  release();
  await expect(page.getByText('You have left the workspace')).toBeVisible();
  // With nothing sending, a return to the window refreshes the list again.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => gets).toBe(1);
});

test('CX-05 a Join that succeeded leaves no lock behind when the dialog is opened again', async ({
  page,
}) => {
  await open(page);
  const joinedId = '00000000-0000-4000-8000-0000000000f1';
  await page.route('**/api/customer-workspace-access', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      json: {
        workspaceId: joinedId,
        memberId: ownerId,
        invitationId: memberId,
        workspace: {
          id: joinedId,
          name: 'Synthetic Invited Mills',
          role: 'member',
          synthetic: true,
          organisationId: null,
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Join a Workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Join a Workspace' });
  await dialog.getByLabel('Workspace invitation code', { exact: true }).fill('T'.repeat(43));
  await dialog.getByRole('button', { name: 'Join Workspace', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'You have joined' })).toBeVisible();
  await page.getByRole('button', { name: 'Join a Workspace', exact: true }).click();
  const again = page.getByRole('dialog', { name: 'Join a Workspace' });
  await expect(again.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  await expect(again.getByText('Working…')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(again).toBeHidden();
});

// UI/UX.v3 consistency pass, unit A2 (action hierarchy): one primary per view. Create a Workspace is the cobalt action,
// Join a Workspace is outlined, Refresh is an icon beside the title with its name kept, and the primary comes first.
for (const width of [390, 768, 1440])
  test(`A2 the Workspaces header has one primary, Join outlined and Refresh as an icon beside the title at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const create = page.getByRole('button', { name: 'Create a Workspace', exact: true });
    const join = page.getByRole('button', { name: 'Join a Workspace', exact: true });
    const refresh = page.getByRole('button', { name: 'Refresh workspaces', exact: true });
    await expect(create).toHaveClass(/primary-link/);
    await expect(join).not.toHaveClass(/primary-link/);
    await expect(page.locator('.ux-section-head .primary-link')).toHaveCount(1);
    expect(((await refresh.textContent()) ?? '').trim()).toBe('');
    const [title, c, j, r] = await Promise.all([
      page.getByRole('heading', { name: 'Workspaces', exact: true }).boundingBox(),
      create.boundingBox(),
      join.boundingBox(),
      refresh.boundingBox(),
    ]);
    // Refresh sits on the title's row; the primary comes before Join (left of it, or above it on a phone).
    expect(Math.abs(r!.y + r!.height / 2 - (title!.y + title!.height / 2))).toBeLessThan(16);
    expect(r!.x).toBeGreaterThan(title!.x);
    expect(c!.y < j!.y || c!.x < j!.x).toBe(true);
    if (width < 768) expect(c!.height).toBeGreaterThanOrEqual(44);
  });

// Unit B3b (owner walk, 23 November 2026).
// D-051: the row menu is drawn over the table card, never cut off by it. Every item of the last row's menu is fully
// painted and takes a click, at a phone, a tablet and a desktop width. The window is tall enough to hold the whole
// menu, so nothing is scrolled to bring an item into sight: a clipping card can be scrolled inside by a script, which
// would hide the very fault this test is for.
for (const width of [390, 768, 1440])
  test(`D-051 the last row's menu is whole and every item can be pressed at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1400 });
    await open(page);
    const table = page.getByRole('table', { name: 'Your workspaces' });
    await trigger(page, 'Synthetic Gazipur Wovens').click();
    const menu = page.getByRole('menu', { name: 'Actions for Synthetic Gazipur Wovens' });
    await expect(menu).toBeVisible();
    const items = menu.getByRole('menuitem');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(6);
    await expect(items.nth(2)).toHaveText('Send a Private Request');
    // The menu reaches below the card, so the card would cut it off if it clipped.
    const edges = await menu.evaluate((panel) => ({
      menuBottom: panel.getBoundingClientRect().bottom,
      tableBottom: document.querySelector('.ux-ws-table')!.getBoundingClientRect().bottom,
    }));
    expect(edges.menuBottom).toBeGreaterThan(edges.tableBottom);
    expect(await table.evaluate((node) => getComputedStyle(node).overflow)).toBe('visible');
    expect(await table.evaluate((node) => node.scrollTop)).toBe(0);
    for (let index = 0; index < count; index++) {
      const item = items.nth(index);
      await expect(item).toBeInViewport({ ratio: 1 });
      // The middle of each edge and the centre of the item are the item itself, so no ancestor clips any side of it
      // (the corners are left out: the row is rounded, and a rounded corner is not part of the row).
      const covered = await item.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const midX = box.left + box.width / 2;
        const midY = box.top + box.height / 2;
        const points = [
          [midX, box.top + 2],
          [midX, box.bottom - 2],
          [box.left + 2, midY],
          [box.right - 2, midY],
          [midX, midY],
        ];
        return points.every(([x, y]) => {
          const hit = document.elementFromPoint(x!, y!);
          return !!hit && (hit === node || node.contains(hit));
        });
      });
      expect(covered, `menu item ${index + 1} is fully painted`).toBe(true);
      await item.click({ trial: true, timeout: 2000 });
    }
    // The card keeps its rounded border with the menu open, and its head row stays inside the rounded corner.
    expect(
      await table.evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius)),
    ).toBeGreaterThan(0);
    expect(await table.evaluate((node) => parseFloat(getComputedStyle(node).borderTopWidth))).toBe(
      1,
    );
    // On a phone-height window the page itself scrolls to the last item; the card is not what scrolls.
    await page.setViewportSize({ width, height: 700 });
    await items.last().scrollIntoViewIfNeeded();
    await expect(items.last()).toBeInViewport({ ratio: 0.9 });
    expect(await table.evaluate((node) => node.scrollTop)).toBe(0);
  });

// D-052: the row menu says "Continue a Saved Request"; the route it opens is unchanged.
test('D-052 the row menu offers Continue a Saved Request and still opens the same page', async ({
  page,
}) => {
  await open(page);
  await trigger(page, 'Synthetic Dhaka Knits').click();
  const menu = page.getByRole('menu', { name: 'Actions for Synthetic Dhaka Knits' });
  await expect(
    menu.getByRole('menuitem', { name: 'Continue a Saved Request', exact: true }),
  ).toHaveAttribute('href', '/account/drafts/' + ownerId);
  await expect(menu.getByText(/draft/i)).toHaveCount(0);
});

// D-050: a time in the Team dialog is written the one way, in the reader's own time zone, never in UTC.
// D-044: the new invitation code has the shared Copy Code button beside it.
test.describe('D-050 and D-044 in the Team dialog, read in Dhaka', () => {
  test.use({ timezoneId: 'Asia/Dhaka', permissions: ['clipboard-read', 'clipboard-write'] });
  test('an invitation expiry and a new code read in the local time zone, and the code can be copied', async ({
    page,
  }) => {
    await open(page);
    await page.route('**/api/customer-workspace-access**', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            json: {
              workspaceId: ownerId,
              invitationId: memberId,
              expiresAt: '2026-11-24T07:07:00.000Z',
              issued: true,
              token: 'T'.repeat(43),
            },
          })
        : route.fulfill({
            json: {
              workspaceId: ownerId,
              ownerProtected: true,
              nextInvitationAfter: null,
              nextMemberAfter: null,
              invitations: [
                {
                  id: memberId,
                  label: 'Synthetic buyer desk',
                  expiresAt: '2026-11-24T07:07:00.000Z',
                  memberId: null,
                  status: 'pending',
                },
              ],
              memberships: [],
            },
          }),
    );
    await trigger(page, 'Synthetic Dhaka Knits').click();
    await page.getByRole('menuitem', { name: 'Manage Team', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Team for Synthetic Dhaka Knits' });
    const row = dialog.getByRole('listitem').filter({ hasText: 'Synthetic buyer desk' });
    await expect(row).toContainText('Expires 24 Nov 2026, 13:07 (Dhaka, UTC+6)');
    await expect(row.locator('time')).toHaveAttribute('datetime', '2026-11-24T07:07:00.000Z');
    await expect(dialog.getByText(/\d{2}:\d{2} UTC/)).toHaveCount(0);

    await dialog.getByLabel('Sample invitation label', { exact: true }).fill('copy test');
    await dialog.getByRole('button', { name: 'Issue Sample Invitation', exact: true }).click();
    const code = dialog.getByLabel('New workspace invitation code', { exact: true });
    await expect(code).toHaveValue('T'.repeat(43));
    await expect(dialog.getByText('It expires 24 Nov 2026, 13:07 (Dhaka, UTC+6).')).toBeVisible();
    await dialog.getByRole('button', { name: 'Copy Code', exact: true }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('T'.repeat(43));
  });
});
