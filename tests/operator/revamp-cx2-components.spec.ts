import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CX PR 2a shared components (docs/revamp/specs/customer-experience.md, Components): the row-link list, the
// segmented filter, the dialog and the empty state, mounted with the real stylesheets. Case ids: CX-04 (filter
// applies at once, one link per row) and CX-05 (keyboard, Escape, focus return and axe at 390 and 1440).
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{useState}from'react';
      import{RowList,RowLink}from ${JSON.stringify(resolve('apps/web/components/ux/row-list.tsx'))};
      import{SegmentedFilter}from ${JSON.stringify(resolve('apps/web/components/ux/segmented-filter.tsx'))};
      import{Dialog}from ${JSON.stringify(resolve('apps/web/components/ux/dialog.tsx'))};
      import{EmptyState}from ${JSON.stringify(resolve('apps/web/components/ux/empty-state.tsx'))};
      const all=[['Sell','Sell machines to Dhaka'],['Sell','Sell denim to Berlin'],['Source','Source trims'],['Organise','Plan a fair visit'],['Other','Ask about duty'],['Other','Check a receipt']];
      function App(){
        const[kind,setKind]=useState('all');const[open,setOpen]=useState(false);
        const shown=all.filter(([k])=>kind==='all'||k.toLowerCase()===kind);
        const count=(k)=>k==='all'?all.length:all.filter(([x])=>x.toLowerCase()===k).length;
        return <main className="operator-page ux-workspace"><h1>Components fixture</h1>
          <SegmentedFilter label="Show" value={kind} onChange={setKind} options={['all','sell','source','organise','other'].map(k=>({value:k,label:k[0].toUpperCase()+k.slice(1),count:count(k)}))}/>
          <RowList label="Requests" columns={[{name:'Kind'},{name:'Status'},{name:'Updated'}]}>
            {shown.map(([k,t],i)=><RowLink key={t} href={'/account/requests/'+i} title={t} cells={[{name:'Kind',value:k},{name:'Status',value:'In progress',status:true},{name:'Updated',value:'3 Nov 2026'}]}/>)}
          </RowList>
          <button type="button" id="opener" onClick={()=>setOpen(true)}>Join a workspace</button>
          <Dialog open={open} onClose={()=>setOpen(false)} title="Join a workspace">
            <label>Invitation<input id="invite" type="text"/></label>
            <button type="button">Join</button>
          </Dialog>
          <EmptyState icon="company" action={<a className="button" href="/account/companies">Manage company profiles</a>}>No companies yet.</EmptyState>
        </main>;
      }
      createRoot(document.getElementById('fixture')).render(<App/>);`,
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
          b.onResolve({ filter: /^next\/link$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents: 'export default function Link({prefetch,...props}){return <a {...props}/>}',
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
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Components fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

const rows = (page: Page) => page.getByRole('list', { name: 'Requests' }).getByRole('listitem');

test('CX-04 the filter applies at once with no submit button, and every row is one link', async ({
  page,
}) => {
  await page.goto(origin);
  await expect(rows(page)).toHaveCount(6);
  await expect(page.getByRole('button', { name: /show|apply|filter/i })).toHaveCount(0);
  await page.getByRole('radio', { name: /^Sell/ }).check();
  await expect(rows(page)).toHaveCount(2);
  for (const row of await rows(page).all()) await expect(row.getByRole('link')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /^Sell/ })).toBeChecked();
});

test('CX-04 the arrow keys move between segments and apply each at once', async ({ page }) => {
  await page.goto(origin);
  await page.getByRole('radio', { name: /^All/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /^Sell/ })).toBeChecked();
  await expect(rows(page)).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /^Source/ })).toBeChecked();
  await expect(rows(page)).toHaveCount(1);
});

test('CX-04 counts use tabular numerals and each row keeps a 44 px target', async ({ page }) => {
  await page.goto(origin);
  const numerals = await page
    .locator('.ux-segment-count')
    .first()
    .evaluate((el) => getComputedStyle(el).fontVariantNumeric);
  expect(numerals).toContain('tabular-nums');
  const heights = await page
    .locator('.ux-row-link')
    .evaluateAll((all) => all.map((a) => a.getBoundingClientRect().height));
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
});

test('CX-05 the dialog opens by keyboard, keeps focus inside, closes on Escape and returns focus', async ({
  page,
}) => {
  await page.goto(origin);
  const opener = page.getByRole('button', { name: 'Join a workspace' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Join a workspace' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('CX-05 the dialog closes with its Close button and on a click outside, and returns focus each time', async ({
  page,
}) => {
  await page.goto(origin);
  const opener = page.getByRole('button', { name: 'Join a workspace' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Join a workspace' });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('the empty state is an icon, one sentence and one action', async ({ page }) => {
  await page.goto(origin);
  const empty = page.locator('.ux-empty');
  await expect(empty.locator('svg')).toHaveCount(1);
  await expect(empty.getByRole('link')).toHaveCount(1);
  await expect(empty.getByRole('button')).toHaveCount(0);
  await expect(empty).toContainText('No companies yet.');
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`CX-05 axe is clean at ${width} with the dialog closed and open, and no sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    const scan = () =>
      new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect((await scan()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.getByRole('button', { name: 'Join a workspace' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect((await scan()).violations).toEqual([]);
  });
