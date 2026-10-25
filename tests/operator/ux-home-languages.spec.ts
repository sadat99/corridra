import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { localeCodes, localeMeta } from '../../apps/web/lib/i18n/locales';
import { translate } from '../../apps/web/lib/i18n/messages';

// The home page in every language (owner decision of 25 October 2026: pages follow the chosen language, behind
// CORRIDRA_LANGUAGES_PAGES). The real home page is shown in the real stylesheets with the real self-hosted faces.
// What is proved: with the page switch off the page is English whatever language is chosen; with it on the main
// region carries the chosen language and direction, the headline and lead are that language's words, the five
// trust names stay English and say so, and at 320, 390, 768 and 1440 px nothing scrolls sideways and the
// accessibility scan is clean, including Arabic read right to left and the long German and French strings.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const font = (name: string) => readFileSync(resolve('apps/web/app/fonts', name));
const fontCss = `
@font-face{font-family:'FxGeist';src:url('/fonts/geist-latin-variable.woff2') format('woff2');font-weight:100 900}
@font-face{font-family:'FxNewsreader';src:url('/fonts/newsreader-latin-variable.woff2') format('woff2');font-weight:200 800}
@font-face{font-family:'FxBengaliSans';src:url('/fonts/noto-sans-bengali-variable.woff2') format('woff2');font-weight:100 900}
@font-face{font-family:'FxBengaliSerif';src:url('/fonts/noto-serif-bengali-variable.woff2') format('woff2');font-weight:100 900}
:root{--font-geist:'FxGeist';--font-newsreader:'FxNewsreader';--font-bengali-sans:'FxBengaliSans';--font-bengali:'FxBengaliSerif';--font-geist-mono:'DejaVu Sans Mono'}`;
const trustNames = [
  'Self-declared',
  'Evidence available',
  'Verified',
  'Derived',
  'Outcome observed',
];

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import Home from ${JSON.stringify(resolve('apps/web/app/page.tsx'))};
      const offered=['en','bn','zh','es','ar','fr','de'].map((code)=>({code,draft:false}));
      const released=new URLSearchParams(location.search).get('pages')||'';
      const pageLocales=released==='1'?['bn','zh','es','ar','fr','de']:released.split(',').filter((code)=>['bn','zh','es','ar','fr','de'].includes(code));
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={offered} pageLocales={pageLocales}><Home/></LanguageProvider>);`,
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
      res.end(`${css}\n${componentCss}\n${fontCss}`);
      return;
    }
    if (path.startsWith('/fonts/')) {
      res.setHeader('content-type', 'font/woff2');
      res.end(font(path.slice('/fonts/'.length)));
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Home fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

for (const code of localeCodes) {
  test(`${code}: with the page switch off the page is English, whatever language is chosen`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('corridra.language', value), code);
    await page.goto(`${origin}/?pages=0`);
    const main = page.locator('main#main');
    await expect(main).toHaveAttribute('lang', 'en');
    await expect(main).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('h1')).toHaveText(translate('en', 'home.title'));
    await expect(page.locator('.ac1-hero .ac1-lead')).toHaveText(translate('en', 'home.lead'));
  });
}

for (const code of localeCodes) {
  test(`${code}: with the page switch on the main region follows the language and the trust names stay English`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('corridra.language', value), code);
    await page.goto(`${origin}/?pages=1`);
    const main = page.locator('main#main');
    await expect(main).toHaveAttribute('lang', localeMeta[code].html);
    await expect(main).toHaveAttribute('dir', localeMeta[code].dir);
    await expect(page.locator('h1')).toHaveText(translate(code, 'home.title'));
    await expect(page.locator('.ac1-hero .ac1-lead')).toHaveText(translate(code, 'home.lead'));
    await expect(page.locator('.ac1-truth .guide-tag')).toHaveCount(5);
    for (const tag of await page.locator('.ac1-truth .guide-tag, .ac1-buyers .guide-tag').all())
      await expect(tag).toHaveAttribute('lang', 'en');
    expect(await page.locator('.ac1-truth .guide-tag').allInnerTexts()).toEqual(trustNames);
    if (code !== 'en')
      await expect(page.locator('h1')).not.toHaveText(translate('en', 'home.title'));
  });
}

test('a language whose page words are not released stays English while another is released', async ({
  page,
}) => {
  await page.addInitScript((v) => localStorage.setItem('corridra.language', v), 'fr');
  await page.goto(`${origin}/?pages=de`);
  await expect(page.locator('h1')).toHaveText(translate('en', 'home.title'));
  await expect(page.locator('main#main')).toHaveAttribute('lang', 'en');
  const german = await page.context().newPage();
  await german.addInitScript((v) => localStorage.setItem('corridra.language', v), 'de');
  await german.goto(`${origin}/?pages=de`);
  await expect(german.locator('h1')).toHaveText(translate('de', 'home.title'));
  await expect(german.locator('main#main')).toHaveAttribute('lang', 'de');
});

test('no word on the page is written by the stylesheet, so every word is translated and read aloud', async ({
  page,
}) => {
  await page.addInitScript((v) => localStorage.setItem('corridra.language', v), 'ar');
  await page.goto(`${origin}/?pages=1`);
  await expect(page.locator('h1')).toHaveText(translate('ar', 'home.title'));
  const generated = await page.evaluate(() =>
    Array.from(document.querySelectorAll('main *'))
      .flatMap((el) => [
        getComputedStyle(el, '::before').content,
        getComputedStyle(el, '::after').content,
      ])
      .filter((content) => content && !['none', 'normal', '""', "''"].includes(content)),
  );
  expect(generated).toEqual([]);
  await expect(page.locator('.ac1-route-tag').first()).toContainText(
    translate('ar', 'home.route.tag'),
  );
  await expect(page.locator('.ac1-other .ac1-route-tag')).toHaveText(
    translate('ar', 'home.other.tag'),
  );
});

test('with Arabic chosen but its page words not released, the English page keeps its arrows', async ({
  page,
}) => {
  await page.addInitScript((v) => localStorage.setItem('corridra.language', v), 'ar');
  await page.goto(`${origin}/?pages=0`);
  // The chrome around the page follows Arabic and reads right to left; the page itself is English, left to right.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('main#main')).toHaveAttribute('dir', 'ltr');
  for (const selector of ['.ac1-route-arrow', '.ac1-job-go', '.arrow-icon'])
    for (const arrow of await page.locator(selector).all())
      expect(await arrow.evaluate((el) => getComputedStyle(el).transform), selector).toBe('none');
});

test('read right to left, arrows point the other way and the arrow keys swap on the example tabs', async ({
  page,
}) => {
  const transform = () =>
    page
      .locator('.ac1-route-arrow')
      .first()
      .evaluate((el) => getComputedStyle(el).transform);
  await page.addInitScript((v) => localStorage.setItem('corridra.language', v), 'ar');
  await page.goto(`${origin}/?pages=1`);
  await expect(page.locator('main#main')).toHaveAttribute('dir', 'rtl');
  expect(await transform()).toBe('matrix(-1, 0, 0, 1, 0, 0)');
  const tabs = page.getByRole('tab');
  await tabs.first().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.first()).toBeFocused();

  const english = await page.context().newPage();
  await english.addInitScript((v) => localStorage.setItem('corridra.language', v), 'en');
  await english.goto(`${origin}/?pages=1`);
  expect(
    await english
      .locator('.ac1-route-arrow')
      .first()
      .evaluate((el) => getComputedStyle(el).transform),
  ).toBe('none');
  const englishTabs = english.getByRole('tab');
  await englishTabs.first().focus();
  await english.keyboard.press('ArrowRight');
  await expect(englishTabs.nth(1)).toBeFocused();
});

for (const width of [320, 390, 768, 1440]) {
  for (const code of localeCodes) {
    test(`${code}: fits at ${width} wide with no sideways scroll and no accessibility violation`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => localStorage.setItem('corridra.language', value), code);
      await page.goto(`${origin}/?pages=1`);
      await expect(page.locator('h1')).toHaveText(translate(code, 'home.title'));
      await page.evaluate(() => document.fonts.ready);
      // Name what sticks out, so a failure says which words are too long. The example tables scroll inside their
      // own box on a narrow screen, so what is inside it is allowed to be wider than the page.
      const offenders = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return Array.from(document.querySelectorAll('main *'))
          .filter((el) => !el.parentElement?.closest('.ac1-proofs'))
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && (box.right > width + 0.5 || box.left < -0.5);
          })
          .map(
            (el) => `${el.tagName.toLowerCase()}.${el.className}: ${el.textContent?.slice(0, 60)}`,
          );
      });
      expect(offenders).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      // The example tables scroll inside their own box on a narrow screen; the page itself never does.
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
      // Screenshots for the owner's review are written only when asked for: HOME_SCREENSHOTS=1.
      if (process.env.HOME_SCREENSHOTS === '1' && width === 390 && code !== 'en')
        await page.screenshot({
          path: `docs/design-system/evidence/language-pages/home-${code}-390.png`,
          fullPage: true,
        });
    });
  }
}
