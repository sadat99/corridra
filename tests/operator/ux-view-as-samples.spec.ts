import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// View as, stage 2 (Lane 9): the Your Move cards and the Room header and Road drawn from fixed sample
// data inside the preview's inert stage, with the real stylesheets. What is proved: the samples use the
// real Move card, holder badge and Road, they hold no link, button or form (the preview must hold
// nothing that can act), nothing in them can be pressed or focused, and they fit a phone. No database,
// no sign-in.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const viewAsCss = readFileSync(resolve('apps/web/app/operator/view-as/view-as.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{SampleScreens}from ${JSON.stringify(resolve('apps/web/app/operator/view-as/[role]/sample-screens.tsx'))};
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <div className="ux-view-as">
            <main id="main" className="operator-page ux-workspace">
              <h1>What a customer sees.</h1>
              <div className="view-as-stage">
                <div className="view-as-content" inert>
                  <SampleScreens/>
                </div>
              </div>
            </main>
          </div>
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
      res.end(`${css}\n${viewAsCss}\n${componentCss}`);
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

test('the Move cards and the Room are drawn from sample data and say so', async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Sample: Your Move' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sample: the Room' })).toBeVisible();
  // The real Your Move screen: a card the person holds and a row somebody else holds.
  await expect(page.getByRole('heading', { name: 'Waiting for you', exact: true })).toBeVisible();
  await expect(page.getByText('the sample size for the first check')).toBeVisible();
  // The real Road at the meetings step.
  await expect(page.locator('.mr-road')).toBeVisible();
  await expect(page.locator('.mr-road [aria-current="step"]')).toHaveCount(1);
  await expect(page.locator('.room-emblem')).toHaveText('HT');
});

test('nothing in the samples can be pressed or focused, and there is no link or button to press', async ({
  page,
}) => {
  await page.goto(origin);
  await expect(page.locator('.view-as-content')).toHaveAttribute('inert', '');
  // The same rule the protected preview test holds the real page to.
  await expect(page.locator('main a, main button, main form, main input')).toHaveCount(0);
  // Nothing is read from this browser: a stored "read" mark makes no Forget button appear.
  await page.evaluate(() => localStorage.setItem('corridra.move.seen', '{"x":"2026-10-01"}'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sample: Your Move' })).toBeVisible();
  await expect(page.locator('main button')).toHaveCount(0);
  // Press Tab through the page: focus never lands inside the stage.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('.view-as-content'));
    expect(inside).toBe(false);
  }
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide: no sideways scroll, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await expect(page.getByRole('heading', { name: 'Sample: the Room' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    if (width === 320 || width === 1440)
      await page.screenshot({
        path: `docs/design-system/evidence/lane9-operator-urls/view-as-samples-${width}.png`,
        fullPage: true,
      });
  });
}
