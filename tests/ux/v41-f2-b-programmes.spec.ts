import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v4.1, unit F2 (builder B): the organiser's programme page. The real CustomerProgrammes room and its real
// stylesheets inside the customer frame on a small bundled page (no server, no sign-in); the programme API is
// answered by the test and every name is invented. It proves:
//   01  one tab row on the page: creating a programme is the page's one primary action and not a tab, the
//       programme's views are toggle buttons, and Pricing, Series and Exports is a radio group; `?tab=new` still
//       opens the create view;
//   07  the view buttons wrap, so the page does not scroll sideways at 320 px or at 200% text;
//   13  the framed page has no back link;
//   15  the page has one h1;
//   22  while the room reads, one loading line is shown and the values wait as quiet bars.
const fixturePath = '/__v41-f2-b-programmes';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const programmeId = '00000000-0000-4000-8000-000000000002';
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let html = '';

const programme = {
  id: programmeId,
  workspaceId,
  name: 'Synthetic commercial delegation',
  reportingPurpose: 'Fictional participant needs and commercial objectives',
  createdAt: '2026-10-18T00:00:00Z',
  synthetic: true,
};

test.beforeAll(async () => {
  const from = (file: string) => JSON.stringify(resolve('apps/web', file));
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { WorkspaceShell } from ${from('components/workspace-shell.tsx')};
        import { CustomerProgrammes } from ${from('app/account/delegations/customer-programmes.tsx')};
        import { ProgrammeRoomStyles } from ${from('app/account/delegations/programme-room-styles.tsx')};
        import ${from('app/account/delegations/programme-frame.css')};
        createRoot(document.getElementById('app')).render(
          <WorkspaceShell title={<span className="sr-only">Plan delegations</span>} customer>
            <ProgrammeRoomStyles />
            <CustomerProgrammes subject="synthetic-alice" issuer=${JSON.stringify(issuer)}
              workspaceId=${JSON.stringify(workspaceId)} participantsEnabled coordinationEnabled termsEnabled
              economicsEnabled templatesEnabled pricingEnabled projectionsEnabled roomEnabled framed />
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
                : 'const router={replace:()=>{},refresh:()=>{},push:()=>{}};export function useRouter(){return router}',
          }));
        },
      },
    ],
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const bundled = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = [
    readFileSync(resolve('apps/web/app/globals.css'), 'utf8'),
    readFileSync(resolve('apps/web/components/ux/shells.css'), 'utf8'),
    bundled,
  ].join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Programme fixture</title><style>${css}</style></head><body><div id="app"></div><script type="module">${js.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, query = '', participantsDelay = 0) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/customer-programme-*', async (route) => {
    if (participantsDelay && route.request().url().includes('customer-programme-participants'))
      await new Promise((done) => setTimeout(done, participantsDelay));
    await route.fulfill({ status: 503, json: { error: 'unavailable' } }).catch(() => {});
  });
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
    }),
  );
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(fixturePath + query);
  await expect(page.getByRole('main')).toBeVisible();
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const width of [390, 1440])
  test(`01, ${width} px: one tab row, one h1, and creating a programme is a button outside the tabs`, async ({
    page,
  }) => {
    await open(page, width);
    await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
    // One tablist in the whole page, hidden parts included, and one h1.
    await expect(page.locator('[role="tablist"]')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Plan delegations');
    await expect(page.getByRole('tab')).toHaveText([
      'Programmes',
      'Templates',
      'Pricing, Series and Exports',
    ]);
    // The action is a button, the only primary in the page lead, and it is not inside the tablist.
    const create = page.getByRole('button', { name: 'New Sample Programme', exact: true });
    await expect(create).toBeVisible();
    await expect(create).toHaveClass(/primary-link/);
    await expect(
      page.locator('[role="tablist"] :is(button, a)').filter({ hasText: /New/ }),
    ).toHaveCount(0);
    expect(
      await create.evaluate((node) => !!node.closest('[role="tablist"], [role="tabpanel"]')),
    ).toBe(false);
    // The programme's views are toggle buttons in a named group, not tabs.
    const views = page.getByRole('group', { name: 'Programme views' });
    await expect(views.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(views.getByRole('tab')).toHaveCount(0);
    // The third level is a radio group: still one tablist with it on screen.
    await page.getByRole('tab', { name: 'Pricing, Series and Exports' }).click();
    const pricing = page.getByRole('region', { name: 'Pricing, series and exports', exact: true });
    await expect(pricing.getByRole('radio', { name: 'Pricing', exact: true })).toBeChecked();
    await pricing.getByRole('radio', { name: 'Exports', exact: true }).check();
    await expect(pricing.getByRole('heading', { name: 'Exports', exact: true })).toBeVisible();
    await expect(page.locator('[role="tablist"]')).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get('tab')).toBe('pricing');
  });

test('01: the create view opens from the button and from the old ?tab=new address, and nothing typed is lost', async ({
  page,
}) => {
  await open(page, 390);
  const create = page.getByRole('button', { name: 'New Sample Programme', exact: true });
  await create.click();
  expect(new URL(page.url()).searchParams.get('tab')).toBe('new');
  const view = page.getByRole('region', { name: 'New Sample Programme' });
  await expect(view).toBeFocused();
  // While it is open the tabs are away, so the page shows no tab row at all and one primary (the form's own).
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('main .primary-link:visible')).toHaveText(['Save Sample Programme']);
  await view.getByLabel('Programme name').fill('Synthetic kept name');
  await page.getByRole('button', { name: 'Show Programmes' }).click();
  await expect(create).toBeFocused();
  await expect(page.getByRole('tablist')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('tab')).toBeNull();
  await create.click();
  await expect(view.getByLabel('Programme name')).toHaveValue('Synthetic kept name');
  // The old address of the tab.
  await open(page, 390, '?tab=new');
  await expect(page.getByRole('region', { name: 'New Sample Programme' })).toBeVisible();
  await expect(page.getByLabel('Programme name')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
});

test('13: the framed page has no back link and no link twice in main', async ({ page }) => {
  await open(page, 390);
  await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Back to/ })).toHaveCount(0);
  const links = await page
    .locator('main a[href]')
    .evaluateAll((list) => list.map((node) => node.getAttribute('href')));
  expect(new Set(links).size).toBe(links.length);
});

// 200% text is measured as the browser applies it to a layout: every width in em halves. A 320 px phone at 200%
// text is laid out like a 160 px one at the usual size (10em), and a 390 px phone like a 195 px one.
for (const [name, width] of [
  ['320 px at 200% text', 160],
  ['390 px at 200% text', 195],
  ['768 px', 768],
] as const)
  test(`07, ${name}: the view buttons wrap inside the page and nothing scrolls sideways`, async ({
    page,
  }) => {
    await open(page, width);
    const views = page.getByRole('group', { name: 'Programme views' });
    await expect(views).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
    const boxes = await views
      .getByRole('button')
      .evaluateAll((list) => list.map((node) => node.getBoundingClientRect().toJSON()));
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width + 0.5);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // No view is hidden behind a sideways scroll of the row.
    expect(await views.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });

for (const width of [320, 390])
  test(`07, ${width} px at the usual text size: the views are chips in one row and the page does not scroll sideways`, async ({
    page,
  }) => {
    await open(page, width);
    const views = page.getByRole('group', { name: 'Programme views' });
    await expect(views).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
    // Chips, not a second row of tabs: each has its own border and no shared underline.
    expect(await views.evaluate((node) => getComputedStyle(node).borderBottomWidth)).toBe('0px');
    for (const chip of await views.getByRole('button').all())
      expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

test('16: at 768 px the row menu button and Reload are 44 px targets', async ({ page }) => {
  await open(page, 768);
  await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
  for (const control of [
    page.getByRole('button', { name: 'Reload Planning Programmes' }),
    page.getByRole('button', { name: 'New Sample Programme', exact: true }),
  ])
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('22: while the room reads there is one loading line and the values wait as quiet bars', async ({
  page,
}) => {
  await open(page, 390, '', 4000);
  const room = page.getByRole('article', { name: programme.name });
  await expect(room).toBeVisible();
  await expect(room.getByRole('status')).toHaveText(['Checking where this programme stands…']);
  const waiting = room.locator('.programme-wait');
  expect(await waiting.count()).toBeGreaterThanOrEqual(2);
  // "Checking…" is not drawn as a value anywhere: every copy of the words is for assistive technology only.
  const drawn = await room
    .getByText('Checking…', { exact: true })
    .evaluateAll((list) => list.filter((node) => !node.closest('.sr-only')).length);
  expect(drawn).toBe(0);
  await expect(room.locator('.room-next b')).toHaveText('Checking…');
});
