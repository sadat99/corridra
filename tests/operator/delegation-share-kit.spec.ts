import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jsQR from 'jsqr';
import { isTitleCase } from '../../apps/web/lib/ux/title-case';

// ADR-084 slice S1, behind CORRIDRA_PROGRAMME_SHARE_KIT: the share section and the responsible paragraph of the public
// programme page as the real components with the real stylesheets, at 390, 768 and 1440. The kit is switched on or off by
// the page address (?kit=1, ?days=1), because the switch itself is read on the server by the real page. Owner rule: the
// page with the kit on is never taller than with it off, closed state, at every width, with and without stated days. The
// QR code lives on the flyer; it is proven by decoding the picture the browser actually shows back to the page address.
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
      import{QrCode}from ${JSON.stringify(resolve('apps/web/app/delegations/[address]/qr-code.tsx'))};
      import ${JSON.stringify(resolve('apps/web/app/delegations/[address]/share-kit.css'))};
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
          {q.get('qr')==='1'?<QrCode text={url} label="QR code that opens the page"/>:<ProgrammePageView page={page} url={url}
            shareKit={q.get('kit')==='1'?shareKitParts({address:page.address,url,title:page.programme.title,calendar:q.get('days')==='1'}):undefined}/>}
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

const widths = [
  ['phone', 390, 844],
  ['tablet', 768, 1024],
  ['desktop', 1440, 900],
] as const;
const height = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight);

for (const [name, width, tall] of widths) {
  test.describe(name, () => {
    test.use({ viewport: { width, height: tall } });

    test('with the kit off the share row is exactly the three actions it had and the sentence is unchanged', async ({
      page,
    }) => {
      await open(page, 'kit=0');
      await expect(share(page).locator('a, button')).toHaveText([
        'Copy Link',
        'Share on WhatsApp',
        'Share on Facebook',
      ]);
      await expect(page.locator('.programme-kit-attribution, #programme-share-more')).toHaveCount(
        0,
      );
      await expect(page.getByText('Corridra provides the tools the organiser uses.')).toBeVisible();
    });

    test('the page with the kit on is never taller than with it off, with and without stated days', async ({
      page,
    }) => {
      await open(page, 'kit=0');
      const off = await height(page);
      for (const days of ['0', '1']) {
        await open(page, `kit=1&days=${days}`);
        expect(await height(page), `days=${days}`).toBeLessThanOrEqual(off + 1);
      }
    });

    test('the kit adds one closed More Options button; Open Flyer and a calendar link only with days open under it', async ({
      page,
    }) => {
      await open(page, 'kit=1&days=1');
      await expect(share(page).getByRole('button')).toHaveText(['Copy Link', 'More Options']);
      const more = page.getByRole('button', { name: 'More Options' });
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('link', { name: 'Open Flyer' })).toBeHidden();
      // Keyboard: focus the button and press Enter.
      await more.focus();
      await page.keyboard.press('Enter');
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('link', { name: 'Open Flyer' })).toHaveAttribute(
        'href',
        '/delegations/synthetic-china-agricultural-machinery-delegation-k3x9q2m7ab/flyer',
      );
      await expect(page.getByRole('link', { name: 'Add to Calendar' })).toHaveAttribute(
        'href',
        '/delegations/synthetic-china-agricultural-machinery-delegation-k3x9q2m7ab/calendar.ics',
      );
      await page.keyboard.press('Enter');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('link', { name: 'Open Flyer' })).toBeHidden();
      await open(page, 'kit=1&days=0');
      await page.getByRole('button', { name: 'More Options' }).click();
      await expect(page.getByRole('link', { name: 'Open Flyer' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add to Calendar' })).toHaveCount(0);
      const labels = await share(page).locator('a, button').allInnerTexts();
      expect(labels.filter((label) => !isTitleCase(label))).toEqual([]);
    });

    test('the attribution is a link inside the responsible sentence, in place of the sentence about Corridra tools', async ({
      page,
    }) => {
      await open(page, 'kit=1&days=0');
      const link = page.getByRole('link', { name: 'Page made with Corridra Programmes' });
      await expect(link).toHaveAttribute('href', '/trade-missions#organise-entry-title');
      await expect(page.locator('p', { has: link })).toContainText(
        'Everything on this page is stated by the organiser. Page made with Corridra Programmes. Corridra is not the travel operator and has not checked these details.',
      );
      await expect(page.getByText('Corridra provides the tools the organiser uses.')).toHaveCount(
        0,
      );
    });

    test('every share action is at least 44 px high up to 768 px, the page does not scroll sideways and axe is clean', async ({
      page,
    }) => {
      await open(page, 'kit=1&days=1');
      await page.getByRole('button', { name: 'More Options' }).click();
      for (const control of await share(page).locator('a:visible, button:visible').all()) {
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
      const axe = await new AxeBuilder({ page })
        .include('.programme-public-share')
        .include('#programme-who-runs-title')
        .analyze();
      expect(axe.violations).toEqual([]);
      const whole = await new AxeBuilder({ page }).include('.programme-public').analyze();
      expect(whole.violations).toEqual([]);
    });
  });
}

test('the QR code on the flyer is a picture that scans back to the page address, and loads nothing', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(`${origin}/?qr=1`);
  const code = page.getByRole('img', { name: 'QR code that opens the page' });
  await expect(code).toBeVisible();
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
  expect(
    requests.every((request) => request.startsWith(origin) || request.startsWith('data:')),
  ).toBe(true);
});
