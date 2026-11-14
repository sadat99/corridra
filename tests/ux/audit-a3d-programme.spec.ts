import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v3 audit unit A3d, part 2: the planning page (Programmes). The real CustomerProgrammes room and its real
// stylesheets are drawn on a small bundled page inside the customer frame with the page frame around it (no sign-in; the
// programme API is answered by the test), at the three widths of the owner's checklist. The change is presentation only,
// so these cases also pin what must not change: the rename form, the archive command and its payload, the help link and
// the Show Archived toggle. Every case that checks the new look fails on the code before this change: the page frame
// shows the back link, so the room draws a second one there, and there is no row menu.
const fixturePath = '/__audit-a3d-programme-fixture';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const viewHeight: Record<number, number> = { 390: 844, 768: 1024, 1440: 900 };
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { pageFrameSlots } from ${JSON.stringify(resolve('apps/web/components/ux/page-frame.tsx'))};
        import { CustomerProgrammes } from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};
        import { ProgrammeRoomStyles } from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-room-styles.tsx'))};
        import ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-frame.css'))};
        const framed = new URLSearchParams(location.search).get('framed') !== '0';
        const slots = pageFrameSlots(framed ? {
          back: { label: 'Back to my workspaces', href: '/account#customer-workspaces' },
        } : undefined);
        createRoot(document.getElementById('app')).render(
          <WorkspaceShell title={<span className="sr-only">Plan delegations</span>} customer above={slots.above} lead={slots.lead}>
            <ProgrammeRoomStyles />
            <CustomerProgrammes subject="synthetic-alice" issuer=${JSON.stringify(issuer)}
              workspaceId=${JSON.stringify(workspaceId)} roomEnabled serviceRequestsEnabled framed={framed} />
          </WorkspaceShell>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    outdir: 'out',
    loader: { '.css': 'css' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const bundled = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = [
    readFileSync(resolve('apps/web/app/globals.css'), 'utf8'),
    readFileSync(resolve('apps/web/components/ux/shells.css'), 'utf8'),
    bundled,
  ].join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Programme fixture</title><style>${css}</style></head><body><div class="site-shell"><div id="app"></div></div><script type="module">${js.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

const programme = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000020${n}`,
  workspaceId,
  name: `Sample Guangzhou delegation round ${n}`,
  reportingPurpose: 'Sample shared programme purpose, no private commercial details',
  createdAt: '2026-10-18T00:00:00Z',
  synthetic: true,
  archived: false,
  version: 1,
});
const firstName = programme(1).name;

async function open(page: Page, width: number, options: { rows?: number; framed?: boolean } = {}) {
  const posts: Record<string, unknown>[] = [];
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: {
        workspaceId,
        programmes: Array.from({ length: options.rows ?? 1 }, (_, n) => programme(n + 1)),
        nextAfter: null,
        synthetic: true,
      },
    }),
  );
  await page.route('**/api/customer-programme-lifecycle', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    return route.fulfill({
      json: {
        ...programme(1),
        name: body.operation === 'rename' ? String(body.name) : firstName,
        archived: body.operation === 'archive',
        version: 2,
        operation: body.operation,
      },
    });
  });
  await page.setViewportSize({ width, height: viewHeight[width]! });
  await page.goto(`${fixturePath}?framed=${options.framed === false ? '0' : '1'}`);
  await expect(page.getByRole('article', { name: firstName })).toBeVisible();
  return posts;
}
const menuButton = (page: Page) =>
  page.getByRole('button', { name: 'More actions for ' + firstName, exact: true });

for (const width of [390, 768, 1440]) {
  test.describe(`${width} px`, () => {
    test('the page frame carries the back link once; the room draws no second one', async ({
      page,
    }) => {
      await open(page, width);
      const back = page.getByRole('link', { name: /Back to my workspaces/ });
      await expect(back).toHaveCount(1);
      await expect(back).toHaveAttribute('href', '/account#customer-workspaces');
      await expect(page.locator('.ux-frame-above a')).toHaveCount(1);
    });

    test('Rename, Archive and Request Help are one tap deeper in a menu named for the programme', async ({
      page,
    }) => {
      await open(page, width);
      await expect(page.getByRole('button', { name: 'Rename Programme' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Archive Programme' })).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: /Request help with this programme/i }),
      ).toHaveCount(0);
      // The programme name is in the accessible name only; the visible button is an icon.
      expect(((await menuButton(page).textContent()) ?? '').trim()).toBe('');
      await menuButton(page).click();
      await expect(page.getByRole('menuitem')).toHaveText([
        'Rename Programme',
        'Archive Programme',
        'Request Help With This Programme',
      ]);
      await expect(
        page.getByRole('menuitem', { name: 'Request Help With This Programme' }),
      ).toHaveAttribute(
        'href',
        `/account/service-requests/new?kind=programme&ref=${programme(1).id}&workspace=${workspaceId}`,
      );
    });
  });
}

test('Archive asks first, sends nothing until confirmed and then sends the same command; Undo stays', async ({
  page,
}) => {
  const posts = await open(page, 1440);
  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'Archive Programme' }).click();
  const group = page.getByRole('group', { name: 'Confirm archiving ' + firstName });
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: 'Keep ' + firstName }).click();
  await expect(group).toHaveCount(0);
  expect(posts).toHaveLength(0);
  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'Archive Programme' }).click();
  await page.getByRole('button', { name: 'Archive ' + firstName }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([
    'commandId',
    'expectedVersion',
    'operation',
    'programmeId',
    'workspaceId',
  ]);
  expect(posts[0]).toMatchObject({
    operation: 'archive',
    workspaceId,
    programmeId: programme(1).id,
    expectedVersion: 1,
  });
  await expect(page.getByText('Programme archived: ' + firstName + '.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('the archive confirm takes focus when it opens, and Keep or Escape gives it back to the menu button', async ({
  page,
}) => {
  const posts = await open(page, 1440);
  const group = page.getByRole('group', { name: 'Confirm archiving ' + firstName });
  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'Archive Programme' }).click();
  await expect(group).toBeFocused();
  await group.getByRole('button', { name: 'Keep ' + firstName }).click();
  await expect(group).toHaveCount(0);
  await expect(menuButton(page)).toBeFocused();
  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'Archive Programme' }).click();
  await expect(group).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(group).toHaveCount(0);
  await expect(menuButton(page)).toBeFocused();
  expect(posts).toHaveLength(0);
});

test('a confirmed archive moves focus to the Undo that replaces the row', async ({ page }) => {
  const posts = await open(page, 1440);
  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'Archive Programme' }).click();
  await page.getByRole('button', { name: 'Archive ' + firstName }).click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeFocused();
});

test('an unanswered archive confirm does not come back after a rename is cancelled or the menu is opened again', async ({
  page,
}) => {
  await open(page, 1440);
  const group = page.getByRole('group', { name: 'Confirm archiving ' + firstName });
  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'Archive Programme' }).click();
  await expect(group).toBeVisible();
  // Opening the menu again ends the confirm.
  await menuButton(page).click();
  await expect(group).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Rename Programme' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('New programme name', { exact: true })).toHaveCount(0);
  await expect(group).toHaveCount(0);
  await expect(menuButton(page)).toBeFocused();
  // The same by keyboard: the arrow keys open the menu and end an open confirm too.
  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'Archive Programme' }).click();
  await expect(group).toBeVisible();
  await menuButton(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(group).toHaveCount(0);
});

test('Rename opens the same form from the menu, focus returns to the menu button, and the payload is unchanged', async ({
  page,
}) => {
  const posts = await open(page, 1440);
  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'Rename Programme' }).click();
  const name = page.getByLabel('New programme name', { exact: true });
  await expect(name).toBeFocused();
  await expect(page.getByRole('textbox', { name: /New reporting purpose/ })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(menuButton(page)).toBeFocused();
  expect(posts).toHaveLength(0);
  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'Rename Programme' }).click();
  await page.getByLabel('New programme name', { exact: true }).fill('Sample Guangzhou round one');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({
    operation: 'rename',
    workspaceId,
    programmeId: programme(1).id,
    expectedVersion: 1,
    name: 'Sample Guangzhou round one',
    reportingPurpose: programme(1).reportingPurpose,
  });
});

test('Show Archived Programmes stays one tap away, and on a phone the menu and that toggle are 44 px targets', async ({
  page,
}) => {
  await open(page, 390);
  const toggle = page.getByRole('button', { name: 'Show Archived Programmes' });
  await expect(toggle).toBeVisible();
  for (const target of [menuButton(page), toggle])
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Show Active Programmes' })).toBeVisible();
});

test('without the frame prop the room keeps its own back link, the direct buttons and the help line', async ({
  page,
}) => {
  await open(page, 1440, { framed: false });
  await expect(page.getByRole('link', { name: /Back to my workspaces/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Rename Programme' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive Programme' })).toBeVisible();
  await expect(page.locator('.ux-menu')).toHaveCount(0);
  await page.unroute('**/api/customer-programmes*');
  await page.unroute('**/api/customer-programme-lifecycle');
  await page.unroute('**' + fixturePath + '*');
  await open(page, 1440);
  await expect(page.locator('.ux-menu')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Rename Programme' })).toHaveCount(0);
});

// The owner's rule for the audit: no page longer than before at any width. The heights are the content (main) of the same
// fixture on origin/main (76066ca), room open, details closed, measured in the same Chromium; one pixel of room.
const before: Record<number, Record<string, number>> = {
  390: { 'list-1': 629.9, 'list-2': 714.7, new: 777.9 },
  768: { 'list-1': 703.3, 'list-2': 788.1, new: 699.9 },
  1440: { 'list-1': 444.0, 'list-2': 524.8, new: 693.1 },
};
for (const width of [390, 768, 1440])
  for (const state of ['list-1', 'list-2', 'new'])
    test(`${width} px, ${state}: the page is no longer than before`, async ({ page }) => {
      await open(page, width, { rows: state === 'list-2' ? 2 : 1 });
      if (state === 'new') await page.getByRole('tab', { name: 'New Sample Programme' }).click();
      await page.evaluate(() =>
        document.querySelectorAll('details').forEach((d) => (d.open = false)),
      );
      const height = await page.evaluate(
        () => document.querySelector('main')!.getBoundingClientRect().height,
      );
      expect(height).toBeLessThanOrEqual(before[width]![state]! + 1);
    });
