import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The real header, footer, skip link and language chip are bundled with the real provider and the
// real stylesheet, in a small page. This proves what a person sees and what is remembered. It does
// not prove the reviewed text: that is a native reviewer's job, recorded by the owner.
let server: Server, origin: string;
let bundle = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const all = 'en,bn,zh,es,ar';

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{SiteHeader}from ${JSON.stringify(resolve('apps/web/components/site-header.tsx'))};
      import{SiteFooterView}from ${JSON.stringify(resolve('apps/web/components/site-footer-view.tsx'))};
      import{SkipLink}from ${JSON.stringify(resolve('apps/web/components/skip-link.tsx'))};
      const q=new URLSearchParams(location.search);
      const drafts=(q.get('draft')||'').split(',');
      const offered=(q.get('offered')||'en').split(',').map(code=>({code,draft:drafts.includes(code)}));
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={offered}><SkipLink/><div className="site-shell">
          <SiteHeader accounts={false}/><main id="main" tabIndex={-1}><h1>Sample page</h1></main>
          <SiteFooterView realUse={true}/></div></LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
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
                ? 'export default function Link(props){return <a {...props}/>}'
                : 'const router={replace:()=>{},refresh:()=>{}};export function useRouter(){return router}',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(css);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Language fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

const attrs = (page: Page) =>
  page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    stored: window.localStorage.getItem('corridra.language'),
  }));
const chip = (page: Page) => page.locator('.lang-switcher > summary');
/** By the language's own tag, because the "(draft)" word follows the language being shown. */
async function pickCode(page: Page, html: string) {
  await chip(page).click();
  await page.locator(`.lang-switcher button[lang="${html}"]`).click();
}
async function pick(page: Page, name: string) {
  await chip(page).click();
  await page.getByRole('button', { name }).click();
}

test('with only English offered there is no chip and the page is English', async ({ page }) => {
  await page.goto(`${origin}/?offered=en`);
  await expect(page.getByRole('link', { name: 'How it works' })).toBeVisible();
  await expect(page.locator('.lang-switcher')).toHaveCount(0);
  expect((await attrs(page)).lang).toBe('en');
});

test('choosing a language changes the words, the page language and survives a reload', async ({
  page,
}) => {
  await page.goto(`${origin}/?offered=${all}&draft=bn,zh,es,ar`);
  await expect(chip(page)).toHaveAccessibleName('Language: English');
  await pick(page, 'বাংলা (draft)');
  await expect(page.getByRole('link', { name: 'কীভাবে কাজ করে' })).toBeVisible();
  await expect(page.getByText('বাজারে প্রবেশ হোক সুচিন্তিত।')).toBeVisible();
  // The brand and the product name are not translated.
  await expect(page.getByRole('link', { name: 'Corridra', exact: true }).first()).toBeVisible();
  expect(await attrs(page)).toEqual({ lang: 'bn', dir: 'ltr', stored: 'bn' });
  await page.reload();
  await expect(page.getByRole('link', { name: 'কীভাবে কাজ করে' })).toBeVisible();
  expect((await attrs(page)).lang).toBe('bn');
  await pick(page, 'English');
  await expect(page.getByRole('link', { name: 'How it works' })).toBeVisible();
  expect(await attrs(page)).toEqual({ lang: 'en', dir: 'ltr', stored: 'en' });
});

test('Chinese, Spanish and Arabic set the right page language and direction', async ({ page }) => {
  await page.goto(`${origin}/?offered=${all}`);
  await pick(page, '中文');
  await expect(page.getByRole('link', { name: '运作方式' })).toBeVisible();
  expect(await attrs(page)).toMatchObject({ lang: 'zh-Hans', dir: 'ltr' });
  await pick(page, 'Español');
  await expect(page.getByRole('link', { name: 'Cómo funciona' })).toBeVisible();
  expect(await attrs(page)).toMatchObject({ lang: 'es', dir: 'ltr' });
  await pick(page, 'العربية');
  await expect(page.getByRole('link', { name: 'كيف يعمل' })).toBeVisible();
  expect(await attrs(page)).toMatchObject({ lang: 'ar', dir: 'rtl' });
});

test('a language that is not offered is never applied, even if it was remembered', async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem('corridra.language', 'bn'));
  await page.goto(`${origin}/?offered=en,es`);
  await expect(page.getByRole('link', { name: 'How it works' })).toBeVisible();
  expect((await attrs(page)).lang).toBe('en');
});

test('the chip works with the keyboard: open, move, choose, Escape closes', async ({ page }) => {
  await page.goto(`${origin}/?offered=en,es`);
  await chip(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Español' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Español' })).toBeHidden();
  await expect(chip(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Cómo funciona' })).toBeVisible();
  await expect(chip(page)).toBeFocused();
});

test('blocked browser storage does not break the page or the choice for this visit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    });
  });
  await page.goto(`${origin}/?offered=en,es`);
  await pick(page, 'Español');
  await expect(page.getByRole('link', { name: 'Cómo funciona' })).toBeVisible();
});

test.describe('first visit, matching the browser language', () => {
  test.use({ locale: 'es-ES' });
  test('a Spanish browser gets Spanish when Spanish is offered, and English when it is not', async ({
    page,
  }) => {
    await page.goto(`${origin}/?offered=en,es`);
    await expect(page.getByRole('link', { name: 'Cómo funciona' })).toBeVisible();
    // Matching the browser is not a choice: nothing is stored until the person picks.
    expect((await attrs(page)).stored).toBeNull();
    await page.goto(`${origin}/?offered=en,bn`);
    await expect(page.getByRole('link', { name: 'How it works' })).toBeVisible();
  });
});

test.describe('Traditional Chinese browsers', () => {
  test.use({ locale: 'zh-TW' });
  test('are not given Simplified Chinese on their behalf', async ({ page }) => {
    await page.goto(`${origin}/?offered=en,zh`);
    await expect(page.getByRole('link', { name: 'How it works' })).toBeVisible();
  });
});

test('every language fits at 320, 390, 768 and 1440 wide and passes the accessibility scan', async ({
  page,
}) => {
  await page.goto(`${origin}/?offered=${all}&draft=bn,zh,es,ar`);
  for (const [html, name, label] of [
    ['en', 'English', 'How it works'],
    ['bn', 'বাংলা', 'কীভাবে কাজ করে'],
    ['zh-Hans', '中文', '运作方式'],
    ['es', 'Español', 'Cómo funciona'],
    ['ar', 'العربية', 'كيف يعمل'],
  ] as const) {
    await pickCode(page, html);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole('link', { name: label })).toBeVisible();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `${name} at ${width}`,
      ).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    expect((await new AxeBuilder({ page }).analyze()).violations, `axe ${name}`).toEqual([]);
  }
});

test('the chip is a 44 pixel target on a phone and inside the open menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/?offered=en,es`);
  await page.getByRole('button', { name: /^Menu/ }).click();
  const box = await chip(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await chip(page).click();
  const item = await page.getByRole('button', { name: 'Español' }).boundingBox();
  expect(item!.height).toBeGreaterThanOrEqual(44);
});
