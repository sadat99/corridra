import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Fair pages and the Countdown (Lane 12): the real views and the real stylesheet, fed invented fairs
// (the shipped list is empty). What is proved: every date shows its source, who read it and when; a
// date that has passed is said plainly; a date not announced says so; the empty list says so; and the
// pages fit a phone with nothing scrolling sideways.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const fairsCss = readFileSync(resolve('apps/web/app/fairs/fairs.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{FairsIndexView,FairDetailView}from ${JSON.stringify(resolve('apps/web/components/fairs-view.tsx'))};
      const q=new URLSearchParams(location.search);
      const fairs=JSON.parse(q.get('fairs')||'[]');
      const today=q.get('today')||'2026-10-25';
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace">
          <h1>Fairs we have checked.</h1>
          {q.get('view')==='detail'
            ? <FairDetailView fair={fairs[0]} today={today}/>
            : <FairsIndexView list={fairs} today={today}/>}
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
                : 'const router={replace:()=>{},refresh:()=>{}};export function useRouter(){return router}',
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
      res.end(`${css}\n${fairsCss}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>View as fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

const fair = {
  slug: 'example-fair',
  name: 'Example Trade Fair',
  city: 'Frankfurt',
  countryCode: 'DE',
  website: 'https://example.com/fair',
  dates: [
    {
      kind: 'opens',
      on: '2027-03-10',
      source: 'https://example.com/fair/dates',
      verifiedBy: 'A. Rahman',
      verifiedOn: '2026-10-20',
    },
    {
      kind: 'closes',
      on: null,
      source: 'https://example.com/fair/dates',
      verifiedBy: 'A. Rahman',
      verifiedOn: '2026-10-21',
    },
  ],
};
const go = (page: import('@playwright/test').Page, fairs: unknown[], extra = '') =>
  page.goto(`${origin}/?fairs=${encodeURIComponent(JSON.stringify(fairs))}${extra}`);

test('the empty list says so and invents nothing', async ({ page }) => {
  await go(page, []);
  await expect(page.getByText('No fairs are listed yet.')).toBeVisible();
  await expect(page.getByText(/read on the fair's own site by a person/)).toBeVisible();
});

test('the list shows the next checked date, the days to it and the day it was last checked', async ({
  page,
}) => {
  await go(page, [fair]);
  await expect(page.getByRole('link', { name: 'Example Trade Fair' })).toHaveAttribute(
    'href',
    '/fairs/example-fair',
  );
  await expect(page.getByText('Frankfurt, DE')).toBeVisible();
  await expect(page.getByText('Opens')).toBeVisible();
  await expect(page.locator('.countdown')).toHaveText('In 136 days');
  await expect(page.getByText('Dates last checked 2026-10-21')).toBeVisible();
});

test("each fair's name is a link with a 44 pixel target that looks like a link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await go(page, [fair]);
  const link = page.getByRole('link', { name: 'Example Trade Fair' });
  const box = await link.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(43.5);
  expect(await link.evaluate((node) => getComputedStyle(node).textDecorationLine)).toBe(
    'underline',
  );
});

test('a fair with nothing still to come says no date has been checked, not a guess', async ({
  page,
}) => {
  await go(page, [fair], '&today=2027-06-01');
  await expect(page.getByText('No upcoming date has been announced or checked.')).toBeVisible();
  await expect(page.locator('.countdown')).toHaveCount(0);
});

test('a fair shows each date with its source, who read it and when, and says when one is not announced', async ({
  page,
}) => {
  await go(page, [fair], '&view=detail');
  await expect(page.getByText('Opens', { exact: true })).toBeVisible();
  await expect(page.locator('time[datetime="2027-03-10"]')).toHaveText('2027-03-10');
  await expect(page.locator('.countdown').first()).toHaveText('In 136 days');
  await expect(page.getByText('Not announced yet')).toBeVisible();
  const source = page.getByRole('link', { name: "the fair's page" }).first();
  await expect(source).toHaveAttribute('href', 'https://example.com/fair/dates');
  await expect(page.getByText(/by A\. Rahman on/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: "The fair's own site" })).toHaveAttribute(
    'href',
    'https://example.com/fair',
  );
});

test('a date that has passed is said plainly, and the next real date is named only when there is one', async ({
  page,
}) => {
  await go(page, [fair], '&view=detail&today=2027-03-11');
  await expect(page.locator('.countdown').first()).toHaveText('This date passed yesterday');
  // The closing date is not announced, so there is no next date to name.
  await expect(page.getByText(/The next date is/)).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide: no sideways scroll, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const extra of ['', '&view=detail']) {
      await go(
        page,
        [
          fair,
          {
            ...fair,
            slug: 'second-fair',
            name: 'A second fair with a much longer name that has to wrap on a phone',
          },
        ],
        extra,
      );
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
      if ((width === 320 || width === 1440) && extra === '&view=detail')
        await page.screenshot({
          path: `docs/design-system/evidence/lane12-fairs/fair-${width}.png`,
          fullPage: true,
        });
    }
  });
}
