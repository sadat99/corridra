import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// CRUD G12 follow-up: the paged-list control keeps the keyboard focus while the next page loads and says
// what arrived in a polite status. The real ShowMore is bundled from the source into a small list that
// pages a mocked meetings read the way the operator lists do (append, keep the first page's total).
const origin = 'http://show-more.test';
let bundle = '';

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{useEffect,useState}from'react';
      import{ShowMore}from ${JSON.stringify(resolve('apps/web/app/operator/show-more.tsx'))};
      function List(){
        const [rows,setRows]=useState([]),[total,setTotal]=useState(null),[next,setNext]=useState(null),[busy,setBusy]=useState(false);
        const read=(q)=>fetch('/api/workspace/meetings?tenant=t'+q).then((r)=>r.json());
        useEffect(()=>{read('').then((v)=>{setRows(v.meetings);setTotal(v.meetingsTotal);setNext(v.next);});},[]);
        async function more(){
          setBusy(true);
          const v=await read('&after='+encodeURIComponent(next));
          setRows((old)=>[...old,...v.meetings]);
          setTotal((old)=>v.meetingsTotal??old);
          setNext(v.next);
          setBusy(false);
        }
        async function reload(){
          const v=await read('&reload=1');
          setRows(v.meetings);setTotal(v.meetingsTotal);setNext(v.next);
        }
        return <><ul>{rows.map((m)=><li key={m.id}>{m.title}</li>)}</ul>
          <button type="button" onClick={()=>void reload()}>Reload</button>
          <ShowMore shown={rows.length} total={total} next={next} busy={busy} label="Meetings" onMore={()=>void more()}/></>;
      }
      createRoot(document.getElementById('root')).render(<List/>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  bundle = result.outputFiles[0]!.text;
});

const meeting = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  title: `Invented meeting ${n}`,
});

test('Show More keeps the focus, says it is busy and announces the new count', async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((done) => (release = done));
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><body><main id="root"></main><script type="module">${bundle.replace(/<\/script/g, '<\\/script')}</script></body></html>`,
      });
    const after = url.searchParams.get('after');
    // A fresh read of a list that now fits on one page.
    if (url.searchParams.get('reload'))
      return route.fulfill({ json: { meetings: [meeting(1)], meetingsTotal: 1, next: null } });
    if (!after)
      return route.fulfill({
        json: { meetings: [1, 2].map(meeting), meetingsTotal: 5, next: 'page-2' },
      });
    if (after === 'page-2') {
      await held;
      // A continuation carries no total; the list keeps the first page's.
      return route.fulfill({
        json: { meetings: [3, 4].map(meeting), meetingsTotal: null, next: 'page-3' },
      });
    }
    return route.fulfill({ json: { meetings: [meeting(5)], meetingsTotal: null, next: null } });
  });
  await page.goto(origin);
  const status = page.getByRole('status');
  const button = page.getByRole('button', { name: 'Show More Meetings' });
  await expect(status).toHaveText('Showing 2 of 5 meetings.');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await button.focus();
  await page.keyboard.press('Enter');
  // While the page loads the button stays focused and says it is unavailable instead of disappearing.
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  release();
  await expect(page.getByRole('listitem')).toHaveCount(4);
  await expect(status).toHaveText('Showing 4 of 5 meetings.');
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
  await expect(button).toBeFocused();
  // The last page removes the button; the focus moves to the control's own container (not the status,
  // which would be announced twice), and the status says everything is shown.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listitem')).toHaveCount(5);
  await expect(button).toHaveCount(0);
  await expect(status).toHaveText('Showing all 5 meetings.');
  await expect(page.locator('.ux-show-more')).toBeFocused();
  // A fresh read back to one page drops the control: the list was not paged in this read, and the
  // focus is not pulled anywhere.
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload' })).toBeFocused();
});

test('a list with one page shows no paging control', async ({ page }) => {
  await page.route(`${origin}/**`, (route) => {
    const url = new URL(route.request().url());
    return url.pathname === '/'
      ? route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><body><main id="root"></main><script type="module">${bundle.replace(/<\/script/g, '<\\/script')}</script></body></html>`,
        })
      : route.fulfill({ json: { meetings: [meeting(1)], meetingsTotal: 1, next: null } });
  });
  await page.goto(origin);
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Show More/ })).toHaveCount(0);
});
