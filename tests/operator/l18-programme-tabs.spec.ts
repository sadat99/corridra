import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// L18 (signed-in sweep): on a phone the organiser's programme page scrolled sideways (scrollWidth 609 at 390 px) because
// the row of page tabs was not bounded by the page. The tabs are one row that scrolls inside itself; the page does not.
// Real list, real stylesheet, in the customer frame (main.ux-customer) the live page uses. Names are invented.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const programmeId = '00000000-0000-4000-8000-000000000002';
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const programme = {
  id: programmeId,
  workspaceId,
  name: 'Synthetic commercial delegation',
  reportingPurpose: 'Fictional participant needs and commercial objectives',
  createdAt: '2026-10-18T00:00:00Z',
  synthetic: true,
};

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{CustomerProgrammes}from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};
      import{ProgrammeRoomStyles}from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-room-styles.tsx'))};
      const q=new URLSearchParams(location.search);
      const room=q.get('room')==='1';
      const bare=q.get('bare')==='1';
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace ux-customer">
          <h1>Plan delegations</h1>
          {room&&<ProgrammeRoomStyles/>}
          <CustomerProgrammes subject="synthetic-alice" issuer=${JSON.stringify(issuer)} workspaceId=${JSON.stringify(workspaceId)}
            participantsEnabled={!bare} coordinationEnabled={!bare} termsEnabled={!bare} economicsEnabled={!bare}
            templatesEnabled pricingEnabled roomEnabled={room} projectionsEnabled={q.get('proj')==='1'}/>
        </main>);`,
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
                : 'const router={replace:()=>{},refresh:()=>{},push:()=>{}};export function useRouter(){return router}',
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
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Programme fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

test('the programme page tabs scroll inside themselves and the page does not scroll sideways at 390', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/customer-programme-*', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
    }),
  );
  await page.goto(`${origin}/?room=1`);
  const tabs = page.locator('.programme-page-tabs > .ux-subtabs-list');
  await expect(tabs).toBeVisible();
  const measure = () =>
    page.evaluate(() => {
      const list = document.querySelector('.programme-page-tabs > .ux-subtabs-list') as HTMLElement;
      return {
        page: document.documentElement.scrollWidth,
        view: window.innerWidth,
        listClient: list.clientWidth,
        listScroll: list.scrollWidth,
      };
    });
  const box = await measure();
  expect(box.page, 'the page is no wider than the screen').toBeLessThanOrEqual(box.view);
  expect(box.listClient, 'the tab row fits the screen').toBeLessThanOrEqual(box.view);
  // UI/UX.v4.1: creating a programme is the page's primary action, not a tab, so the three tabs that remain fit
  // this fixture at 390. At 320 they are wider than the row and scroll inside it, as before.
  await page.setViewportSize({ width: 320, height: 844 });
  const narrow = await measure();
  expect(narrow.page, 'the page is no wider than the screen').toBeLessThanOrEqual(narrow.view);
  expect(
    narrow.listScroll,
    'the tabs are wider than the row, so they scroll inside it',
  ).toBeGreaterThan(narrow.listClient);
  // The last tab is reachable by scrolling the row, never by scrolling the page.
  const last = page.getByRole('tab', { name: 'Pricing, Series and Exports' });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(last).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

// Team desk v4.1 brings the chosen tab into view inside a tab row that scrolls, and only inside the team desk frame.
// The customer programme page is not a desk page: its tab row is never moved for the reader, so a page opened on
// its last tab still starts with the row at its beginning, as it did before the desk page pattern existed.
test('the programme page tab row is never scrolled for the reader: opened on the last tab it stays at the start', async ({
  page,
}) => {
  // 320 px: the width at which the three page tabs are wider than their row.
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route('**/api/customer-programme-*', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
    }),
  );
  await page.goto(`${origin}/?room=1&tab=pricing`);
  const last = page.getByRole('tab', { name: 'Pricing, Series and Exports' });
  await expect(last).toHaveAttribute('aria-selected', 'true');
  const row = page.locator('.programme-page-tabs > .ux-subtabs-list');
  expect(await page.locator('.ux-desk-frame').count()).toBe(0);
  // The chosen tab is out of view to the right, so this row is one the desk rule would have moved.
  expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(
    await last.evaluate(
      (el) => el.getBoundingClientRect().right > el.parentElement!.getBoundingClientRect().right,
    ),
  ).toBe(true);
  expect(await row.evaluate((el) => el.scrollLeft)).toBe(0);
  // Choosing another tab and coming back leaves the row where the reader has it.
  await page.getByRole('tab', { name: 'Programmes' }).click();
  await page.getByRole('tab', { name: 'Programmes' }).press('End');
  await expect(last).toHaveAttribute('aria-selected', 'true');
  expect(await row.evaluate((el) => el.scrollLeft)).toBe(0);
});
