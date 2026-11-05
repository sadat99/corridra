import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CX PR 2b, the Requests page: the real tabs on the shared sub-tabs and the real filter bar, with stand-in
// panels, in a small page with the real stylesheets. Case ids: CX-04 (tabs kept by ?tab=, old #id links open the
// right tab, the filter applies at once with no submit) and CX-05 (keyboard and axe at 390 and 1440).
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{RequestsTabs}from ${JSON.stringify(resolve('apps/web/app/account/requests-tabs.tsx'))};
      import{WorkFilterBar}from ${JSON.stringify(resolve('apps/web/app/account/work-filter.tsx'))};
      import{RowList,RowLink}from ${JSON.stringify(resolve('apps/web/components/ux/row-list.tsx'))};
      const filter=new URLSearchParams(location.search).get('work')||'all';
      const options=['all','sell','source','organise','other'].map(v=>({value:v,label:v[0].toUpperCase()+v.slice(1),count:v==='all'?6:1}));
      window.__replaced=[];
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <main className="operator-page ux-workspace ux-customer"><h1>Your requests and workspaces.</h1>
            <div id="my-work">
              <RequestsTabs
                requests={<section id="work-list"><h2>Your work</h2>
                  <p><a href="#customer-workspaces">Open your workspaces</a> <a href="#customer-requests">Open your saved requests</a></p>
                  <WorkFilterBar filter={filter} options={options}/>
                  <RowList label="Your work" title="Request" columns={[{name:'Kind'},{name:'Status'}]}>
                    {Array.from({length:Number(new URLSearchParams(location.search).get('rows')||1)},(_,n)=>
                      <RowLink key={n} href={'/account/requests/'+(n+1)} title={'Sell machines to Dhaka '+(n+1)} cells={[{name:'Kind',value:'Request'},{name:'Status',value:'In progress',status:true}]}/>)}
                  </RowList></section>}
                workspaces={<div id="customer-workspaces" tabIndex={-1}><h2>Workspaces</h2><p>Atelier Rahman</p><button type="button" id="in-workspaces">Create Workspace</button></div>}
                saved={<div id="customer-requests" tabIndex={-1}><h2>Saved requests</h2><p>Nothing saved.</p></div>}
              />
            </div>
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
                : 'const router={replace:(url)=>{window.__replaced.push(url)},push:()=>{}};export function useRouter(){return router}export function usePathname(){return "/account"}',
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Requests</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const replaced = (page: Page) =>
  page.evaluate(() => (window as never as { __replaced: string[] }).__replaced);

test('CX-04 the first tab shows by default and the others are in the page but hidden', async ({
  page,
}) => {
  await page.goto(`${origin}/?view=work`);
  await expect(tab(page, 'Requests')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Your work' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeHidden();
  await expect(page.locator('#customer-workspaces')).toHaveCount(1);
  await expect(page.locator('#customer-requests')).toHaveCount(1);
});

test('CX-04 ?tab= chooses the tab and a click keeps the other words in the address', async ({
  page,
}) => {
  await page.goto(`${origin}/?view=work&tab=saved`);
  await expect(tab(page, 'Saved')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Saved requests' })).toBeVisible();
  await tab(page, 'Workspaces').click();
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
  const search = new URL(page.url()).searchParams;
  expect(search.get('tab')).toBe('workspaces');
  expect(search.get('view')).toBe('work');
});

test('CX-04 an old #customer-workspaces link opens the Workspaces tab, and #customer-requests the Saved tab', async ({
  page,
}) => {
  await page.goto(`${origin}/?view=work#customer-workspaces`);
  await expect(tab(page, 'Workspaces')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#customer-workspaces')).toBeVisible();
  await page.goto(`${origin}/?view=work#customer-requests`);
  await expect(tab(page, 'Saved')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#customer-requests')).toBeVisible();
  await page.goto(`${origin}/?view=work#work-list`);
  await expect(tab(page, 'Requests')).toHaveAttribute('aria-selected', 'true');
});

test('CX-05 the arrow keys, Home and End move between the tabs', async ({ page }) => {
  await page.goto(`${origin}/?view=work`);
  await tab(page, 'Requests').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Workspaces')).toBeFocused();
  await expect(tab(page, 'Workspaces')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tab(page, 'Saved')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tab(page, 'Requests')).toHaveAttribute('aria-selected', 'true');
});

test('CX-04 choosing a segment changes the address at once with no submit, keeping the tab', async ({
  page,
}) => {
  await page.goto(`${origin}/?view=work&tab=requests`);
  await expect(page.getByRole('button', { name: /^show$/i })).toHaveCount(0);
  await page.getByRole('radio', { name: /^Sell/ }).click();
  expect(await replaced(page)).toEqual(['/?view=work&tab=requests&work=sell']);
  // Back to All from a chosen segment drops ?work= and keeps the tab.
  await page.goto(`${origin}/?view=work&tab=requests&work=sell`);
  await page.getByRole('radio', { name: /^All/ }).click();
  expect((await replaced(page)).at(-1)).toBe('/?view=work&tab=requests');
});

test('CX-04 the row is one link and the segments use the arrow keys', async ({ page }) => {
  await page.goto(`${origin}/?view=work`);
  await expect(page.getByRole('link', { name: /Sell machines to Dhaka/ })).toHaveAttribute(
    'href',
    '/account/requests/1',
  );
  await page.getByRole('radio', { name: /^All/ }).focus();
  await page.keyboard.press('ArrowRight');
  expect((await replaced(page)).at(-1)).toContain('work=sell');
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`CX-05 axe is clean at ${width} on each tab, with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const name of ['Requests', 'Workspaces', 'Saved']) {
      await page.goto(`${origin}/?view=work`);
      await tab(page, name).click();
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(result.violations, name).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
  });

test('CX-04 a link whose target is in another tab opens that tab itself, with no tab click', async ({
  page,
}) => {
  await page.goto(`${origin}/?view=work`);
  await expect(tab(page, 'Requests')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('link', { name: 'Open your workspaces' }).click();
  await expect(tab(page, 'Workspaces')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Create Workspace' })).toBeVisible();
  await expect(page.locator('#customer-workspaces')).toBeVisible();
  await page.goto(`${origin}/?view=work`);
  await page.getByRole('link', { name: 'Open your saved requests' }).click();
  await expect(tab(page, 'Saved')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#customer-requests')).toBeVisible();
});

test('CX-04 a hidden tab stays hidden: no panel is shown by an id or a stronger selector', async ({
  page,
}) => {
  await page.goto(`${origin}/?view=work`);
  for (const id of ['customer-workspaces', 'customer-requests'])
    await expect(page.locator('#' + id)).toBeHidden();
  const displays = await page
    .locator('[role="tabpanel"][hidden]')
    .evaluateAll((all) => all.map((el) => getComputedStyle(el).display));
  expect(displays).toEqual(['none', 'none']);
});

// CX-01 for Requests: six requests on the first tab fit in one screen at 1440 x 900 and two at 390 x 844. The
// fixture has no site header, so a fixed allowance stands in for the 56 px customer bar.
for (const [width, height, screens] of [
  [1440, 900, 1],
  [390, 844, 2],
] as const)
  test(`CX-01 six requests on the Requests tab fit in ${screens} screen${screens > 1 ? 's' : ''} at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/?view=work&rows=6`);
    await expect(page.getByRole('link', { name: /Sell machines to Dhaka 6/ })).toBeVisible();
    const used = await page.evaluate(
      () => document.querySelector('main')!.getBoundingClientRect().bottom + window.scrollY,
    );
    expect(used + 56).toBeLessThanOrEqual(height * screens);
  });
