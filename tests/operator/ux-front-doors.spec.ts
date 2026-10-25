import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Founder and helper front doors (Lane 13): the real component and the real stylesheets, fed the real
// card tables. What is proved: each card is one link to the page it names, the primary card is marked,
// every card is at least 44 px tall, and both doors fit a phone with nothing scrolling sideways.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{FrontDoor}from ${JSON.stringify(resolve('apps/web/components/front-door.tsx'))};
      import{founderDoor,helperDoor}from ${JSON.stringify(resolve('apps/web/lib/front-doors.ts'))};
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <main id="main" className="operator-page ux-workspace">
            <h1>Doors</h1>
            <section aria-label="Founder"><FrontDoor label="Founder areas" items={founderDoor}/></section>
            <section aria-label="Helper"><FrontDoor label="Ways in for a helper" items={helperDoor}/></section>
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
      res.end(`${css}\n${componentCss}`);
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

test('each card is one link to the page it names, and the primary card is marked', async ({
  page,
}) => {
  await page.goto(origin);
  const founder = page.getByRole('navigation', { name: 'Founder areas' });
  await expect(founder.getByRole('link')).toHaveCount(5);
  await expect(founder.getByRole('link', { name: /^Ready to start\?/ })).toHaveAttribute(
    'href',
    '/operator#ops-gates',
  );
  await expect(founder.getByRole('link', { name: /^Business/ })).toHaveAttribute(
    'href',
    '/operator#workspace-commercial',
  );
  await expect(founder.locator('[data-primary="true"]')).toHaveCount(1);
  const helper = page.getByRole('navigation', { name: 'Ways in for a helper' });
  await expect(helper.getByRole('link')).toHaveCount(3);
  await expect(helper.getByRole('link', { name: /^Accept a reviewed invitation/ })).toHaveAttribute(
    'href',
    '/contributor/setup',
  );
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide: no sideways scroll, 44 pixel cards, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await expect(page.getByRole('navigation', { name: 'Founder areas' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    for (const card of await page.locator('.front-door-card').all()) {
      const box = await card.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(43.5);
    }
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    if (width === 320 || width === 1440)
      await page.screenshot({
        path: `docs/design-system/evidence/lane13-front-doors/front-doors-${width}.png`,
        fullPage: true,
      });
  });
}
