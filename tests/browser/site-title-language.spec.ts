import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { translate } from '../../apps/web/lib/i18n/messages';

// Language-aware tab title (commercial-ready run, unit L0). Pages are built in English, so the title in the HTML is
// the English one; after load the tab shows the site's default title in the chosen language. A page with its own
// title is never touched. The real SiteTitle is mounted under the real LanguageProvider with every language offered.
let server: Server, origin: string;
const english = 'Corridra | Cross-border market access';

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'one width is enough for the tab title');
});

test.beforeAll(async () => {
  const at = (path: string) => JSON.stringify(resolve(path));
  const offered = ['en', 'bn', 'zh', 'es', 'ar', 'fr', 'de']
    .map((code) => `{code:'${code}',draft:false}`)
    .join(',');
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider,useLanguage}from ${at('apps/web/components/language-provider.tsx')};
      import{SiteTitle}from ${at('apps/web/components/ux/site-title.tsx')};
      function Choose(){const{choose,locale}=useLanguage();window.choose=choose;return <p id="locale">{locale}</p>}
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[${offered}]}><SiteTitle /><Choose /></LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'empty' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://fixture.invalid');
    if (url.pathname === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
    } else {
      const title = url.searchParams.get('title') ?? english;
      res.setHeader('content-type', 'text/html');
      res.end(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>Title fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

const choose = (page: import('@playwright/test').Page, code: string) =>
  page.evaluate(
    (next) => (window as unknown as { choose: (c: string) => void }).choose(next),
    code,
  );

test('the site default title follows the chosen language, in all seven', async ({ page }) => {
  await page.goto(origin);
  await expect(page).toHaveTitle(english);
  for (const code of ['bn', 'zh', 'es', 'ar', 'fr', 'de'] as const) {
    await choose(page, code);
    await expect(page.locator('#locale')).toHaveText(code);
    const wanted = translate(code, 'site.title');
    expect(wanted).not.toBe(english);
    expect(wanted.startsWith('Corridra | ')).toBe(true);
    await expect(page).toHaveTitle(wanted);
  }
  await choose(page, 'en');
  await expect(page).toHaveTitle(english);
});

test('a remembered language is applied on load, and the title element is kept, not replaced', async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem('corridra.language', 'es'));
  await page.goto(origin);
  await expect(page).toHaveTitle(translate('es', 'site.title'));
  expect(await page.locator('head > title').count()).toBe(1);
  // What the framework does on a move between pages: it writes the next title into the same text node.
  await page.evaluate(() => {
    (document.querySelector('title')!.firstChild as Text).data = 'About | Corridra';
  });
  await expect(page).toHaveTitle('About | Corridra');
  await page.evaluate((title) => {
    (document.querySelector('title')!.firstChild as Text).data = title;
  }, english);
  await expect(page).toHaveTitle(translate('es', 'site.title'));
});

test('a page with its own title keeps it in every language', async ({ page }) => {
  await page.goto(`${origin}/?title=${encodeURIComponent('How It Works | Corridra')}`);
  await choose(page, 'de');
  await expect(page.locator('#locale')).toHaveText('de');
  await expect(page).toHaveTitle('How It Works | Corridra');
});

test('the built site still serves the English title to search and share previews', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain(`<title>${english}</title>`);
  expect(html).toContain(
    'content="Corridra helps Bangladeshi businesses enter China, the EU, the UK, the US, Australia and key Asian markets with qualified buyers and clear next steps."',
  );
});
