import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jsQR from 'jsqr';
import { isTitleCase } from '../../apps/web/lib/ux/title-case';

// ADR-084 slice S1, behind CORRIDRA_PROGRAMME_SHARE_KIT: the share section of the public programme page as the real
// components with the real stylesheets, at a phone and a desktop width. The kit is switched on or off by the page
// address (?kit=1, ?days=1), because the switch itself is read on the server by the real page. Whole page length is
// measured on a production build of the real route, not here: a fixture has no header or footer.
// The QR code is proven by decoding the picture the browser actually shows back to the page address.
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const url =
  'http://127.0.0.1:3200/delegations/synthetic-china-agricultural-machinery-delegation-k3x9q2m7ab';
let server: Server, origin: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import ${JSON.stringify(resolve('apps/web/app/delegations/[address]/programme-page.css'))};
      import{ProgrammePageView}from ${JSON.stringify(resolve('apps/web/app/delegations/[address]/programme-page-view.tsx'))};
      import{shareKitParts}from ${JSON.stringify(resolve('apps/web/app/delegations/[address]/share-kit.tsx'))};
      const q=new URLSearchParams(location.search);
      const page={state:'OPEN',closesAt:'2027-03-01T23:59:00.000Z',sample:true,address:'synthetic-china-agricultural-machinery-delegation-k3x9q2m7ab',
        programme:{title:'Synthetic China agricultural machinery delegation',organiser:'Synthetic Dhaka Agro Traders Association',
        summary:'A ten company buying delegation to compare rice transplanters and combine harvesters before the next season.',
        destination:'Guangzhou and Foshan, China',dates:'12 to 18 April 2027, to be confirmed',focus:'Agricultural machinery for small and medium farms',
        audience:'Owners and buyers of importers and dealers who plan to place an order within a year.',
        eligibility:'A registered business that imports or sells farm machinery.',
        activities:[{label:'Factory visits in Foshan',status:'PLANNED'}],included:['Programme coordination'],excluded:['Flights'],
        fee:'BDT 45,000 per company, paid to the organiser',capacity:10}};
      const url=${JSON.stringify(url)};
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page ux-workspace programme-page">
          <h1>{page.programme.title}</h1>
          <ProgrammePageView page={page} url={url}
            shareKit={q.get('kit')==='1'?shareKitParts({address:page.address,url,title:page.programme.title,calendar:q.get('days')==='1'}):undefined}/>
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
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    res.setHeader('cache-control', 'no-store');
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
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Share kit fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
});

const open = async (page: Page, query: string) => {
  await page.goto(`${origin}/?${query}`);
  await expect(page.getByRole('heading', { name: 'Share this page' })).toBeVisible();
};
const share = (page: Page) => page.locator('.programme-public-share');

for (const [name, width, height] of [
  ['phone', 390, 844],
  ['desktop', 1440, 900],
] as const) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } });

    test('with the kit off the share section is exactly the three actions it had', async ({
      page,
    }) => {
      await open(page, 'kit=0');
      await expect(share(page).locator('a, button')).toHaveText([
        'Copy Link',
        'Share on WhatsApp',
        'Share on Facebook',
      ]);
      await expect(page.locator('.programme-qr, .programme-kit-attribution')).toHaveCount(0);
    });

    test('with the kit on it adds Open Flyer, a calendar link only with days, Show QR Code and one quiet line', async ({
      page,
    }) => {
      await open(page, 'kit=1&days=1');
      await expect(share(page).locator('a, button')).toHaveText([
        'Copy Link',
        'Share on WhatsApp',
        'Share on Facebook',
        'Open Flyer',
        'Add to Calendar',
        'Show QR Code',
        'Page made with Corridra Programmes',
      ]);
      await expect(page.getByRole('link', { name: 'Open Flyer' })).toHaveAttribute(
        'href',
        '/delegations/synthetic-china-agricultural-machinery-delegation-k3x9q2m7ab/flyer',
      );
      await expect(page.getByRole('link', { name: 'Add to Calendar' })).toHaveAttribute(
        'href',
        '/delegations/synthetic-china-agricultural-machinery-delegation-k3x9q2m7ab/calendar.ics',
      );
      await expect(
        page.getByRole('link', { name: 'Page made with Corridra Programmes' }),
      ).toHaveAttribute('href', '/trade-missions#organise-entry-title');
      await open(page, 'kit=1&days=0');
      await expect(page.getByRole('link', { name: 'Add to Calendar' })).toHaveCount(0);
      // Actions are Title Case; the attribution is a sentence the ADR words exactly, not an action.
      const labels = (await share(page).locator('a, button').allInnerTexts()).filter(
        (label) => label !== 'Page made with Corridra Programmes',
      );
      expect(labels.filter((label) => !isTitleCase(label))).toEqual([]);
    });

    test('every share action is at least 44 px high up to 768 px, the page does not scroll sideways and axe is clean', async ({
      page,
    }) => {
      await open(page, 'kit=1&days=1');
      for (const control of await share(page).locator('a, button').all()) {
        const box = (await control.boundingBox())!;
        expect(box.height, await control.innerText()).toBeGreaterThanOrEqual(
          width <= 768 ? 44 : 24,
        );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.getByRole('button', { name: 'Show QR Code' }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      const axe = await new AxeBuilder({ page }).include('.programme-public-share').analyze();
      expect(axe.violations).toEqual([]);
    });

    test('Show QR Code opens a picture that scans back to the page address, and loads nothing', async ({
      page,
    }) => {
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await open(page, 'kit=1&days=0');
      const toggle = page.getByRole('button', { name: 'Show QR Code' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('.programme-qr')).toBeHidden();
      const before = requests.length;
      await toggle.click();
      await expect(page.getByRole('button', { name: 'Hide QR Code' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      const code = page.getByRole('img', {
        name: 'QR code that opens Synthetic China agricultural machinery delegation',
      });
      await expect(code).toBeVisible();
      // The picture the browser shows, drawn onto a canvas and read back.
      const pixels = await code.evaluate(async (element) => {
        const image = element as HTMLImageElement;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 420;
        const context = canvas.getContext('2d')!;
        context.fillStyle = 'white';
        context.fillRect(0, 0, 420, 420);
        context.drawImage(image, 0, 0, 420, 420);
        return Array.from(context.getImageData(0, 0, 420, 420).data);
      });
      expect(jsQR(new Uint8ClampedArray(pixels), 420, 420)?.data).toBe(url);
      // Opening it made no request at all, to us or anyone else.
      expect(requests.length).toBe(before);
      await page.getByRole('button', { name: 'Hide QR Code' }).click();
      await expect(page.locator('.programme-qr')).toBeHidden();
    });
  });
}
