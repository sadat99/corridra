import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let server: Server,
  origin: string,
  bundle = '',
  componentCss = '';
const tenant = '11111111-1111-4111-8111-111111111111';

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{DeliveryExperience}from ${JSON.stringify(resolve('apps/web/app/operator/delivery-experience.tsx'))};
      import{CornerDock}from ${JSON.stringify(resolve('apps/web/components/corner-dock.tsx'))};
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      const dock=new URLSearchParams(location.search).has('dock');
      createRoot(document.getElementById('fixture')).render(dock?
        <LanguageProvider offered={[{code:'en',draft:false},{code:'de',draft:false}]}><main id="main" lang="en" dir="ltr"><h1>Sample English record</h1><p>The record stays English when the surrounding language changes.</p></main><CornerDock/></LanguageProvider>:
        <main id="main" className="operator-page ux-workspace"><h1>Sample delivery review</h1><DeliveryExperience role="owner" tenant="${tenant}" programme="" mission="" participants={[]} publications={[]} owners={[]}/></main>);`,
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
        name: 'fixture-link',
        setup(b) {
          b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }));
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
  const css = readFileSync('apps/web/app/globals.css', 'utf8');
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/fixture.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end(css + '\n' + componentCss);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sample module visibility</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

for (const installed of [false, true, undefined]) {
  test(`confirmation controls require available module metadata: ${String(installed)}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let privateReads = 0;
    await page.route('**/api/workspace/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('specification-confirmations')) privateReads++;
      const body = url.pathname.endsWith('/meetings')
        ? { meetings: [] }
        : {
            organisations: [],
            contexts: [],
            agenda: [],
            requirements: [],
            targets: [],
            quotations: [],
            links: [],
            rfqs: [],
            disclosures: [],
            responses: [],
            ...(installed === undefined ? {} : { specificationConfirmationsAvailable: installed }),
          };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    await page.goto(origin);
    await expect(
      page.getByRole('heading', { name: 'Mission and delegation experience' }),
    ).toBeVisible();
    const control = page.getByText('Request customer specification confirmation', { exact: true });
    if (installed) await expect(control).toBeVisible();
    else await expect(control).toHaveCount(0);
    expect(privateReads).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('Listen stops and checks voices again when the chosen language changes on an English record', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { cancels: 0, voiceChecks: 0, spoken: 0 };
    Object.assign(window, { fixtureSpeech: state });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        text: string;
        lang = '';
        onend: unknown;
        onerror: unknown;
        constructor(text: string) {
          this.text = text;
        }
      },
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        cancel: () => state.cancels++,
        speak: () => state.spoken++,
        getVoices: () => {
          state.voiceChecks++;
          return [{ lang: 'en-US' }, { lang: 'de-DE' }];
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  });
  await page.goto(origin + '/?dock=1');
  await page.getByRole('button', { name: 'Listen to this page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop reading', exact: true })).toBeVisible();
  const before = await page.evaluate(() => ({
    ...(window as unknown as { fixtureSpeech: { cancels: number; voiceChecks: number } })
      .fixtureSpeech,
  }));
  await page.evaluate(() => {
    localStorage.setItem('corridra.language', 'de');
    window.dispatchEvent(new StorageEvent('storage', { key: 'corridra.language' }));
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('main')).toHaveAttribute('lang', 'en');
  await expect(
    page.getByRole('button', { name: 'Listen to this page', exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(
    () =>
      (window as unknown as { fixtureSpeech: { cancels: number; voiceChecks: number } })
        .fixtureSpeech,
  );
  expect(after.cancels).toBeGreaterThan(before.cancels);
  expect(after.voiceChecks).toBeGreaterThan(before.voiceChecks);
});
