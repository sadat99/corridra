import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v4 screen 10 (owner, 18 Nov 2026: Wave 1 "start", option 1a): Listen, the language as its short code and Menu in
// the top bar of the public header, each an icon plus a word at 44 px; under 360 px Listen and the language move into the
// drawer; the language chooser is a bottom sheet in each language's own script; the drawer ends with Sign In, Start a
// Request and Help. The real SiteHeader is mounted with the real stylesheets and all seven languages offered (the live
// site offers only reviewed ones, which are set by environment), so the sheet is exercised in full, at 320 and in Arabic.
let server: Server, origin: string;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'widths are set in each case');
});

test.beforeAll(async () => {
  const at = (path: string) => JSON.stringify(resolve(path));
  const offered = ['en', 'bn', 'zh', 'es', 'ar', 'fr', 'de']
    .map((code) => `{code:'${code}',draft:${code !== 'en'}}`)
    .join(',');
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${at('apps/web/components/language-provider.tsx')};
      import{SiteHeader}from ${at('apps/web/components/site-header.tsx')};
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[${offered}]}>
          <SiteHeader accounts={false} />
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
                : 'const router={replace:()=>{},push:()=>{},refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return "/about"}export function useSearchParams(){return new URLSearchParams(location.search)}',
          }));
        },
      },
    ],
  });
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
    } else {
      const filler = Array.from({ length: 60 }, (_, i) => `<p>Sample line ${i + 1}</p>`).join('');
      res.setHeader('content-type', 'text/html');
      res.end(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Top bar fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="shell" class="site-shell"><div id="fixture" style="display:contents"></div><main id="main"><h1>Top bar fixture</h1>${filler}</main></div><script type="module" src="/fixture.js"></script></body></html>`,
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

const header = (page: Page) => page.locator('header.public-header');
const listen = (page: Page) =>
  page.getByRole('button', { name: /^(Listen to This Page|Stop Reading)$/ });
const language = (page: Page) => page.locator('header button[aria-haspopup="dialog"]:visible');
const menu = (page: Page) => page.locator('header .menu-toggle');

async function open(page: Page, width: number, lang?: string) {
  await page.setViewportSize({ width, height: 844 });
  // A browser with a voice for English and Arabic, and a record of what was asked of it.
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __speech: string[] }).__speech = calls;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [{ lang: 'en-US' }, { lang: 'ar-SA' }, { lang: 'bn-BD' }],
        addEventListener: () => {},
        removeEventListener: () => {},
        speak: () => calls.push('speak'),
        cancel: () => calls.push('cancel'),
      },
    });
    if (typeof SpeechSynthesisUtterance === 'undefined')
      (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
        class {};
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: { error: 'none' } }));
  if (lang)
    await page.addInitScript((code) => localStorage.setItem('corridra.language', code), lang);
  await page.goto(origin);
  await expect(header(page)).toBeVisible();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Visible header controls smaller than a 44 px target. */
const small = (page: Page) =>
  header(page).evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('a[href], button'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (box.width < 43.5 || box.height < 43.5);
      })
      .map((el) => el.textContent?.trim()),
  );

test('the phone top bar shows the orb, Listen, the language code and Menu, each 44 px, in a 60 px sticky bar', async ({
  page,
}) => {
  await open(page, 390);
  const bar = header(page);
  await expect(listen(page)).toBeVisible();
  await expect(listen(page)).toContainText('Listen');
  await expect(language(page)).toContainText('EN');
  await expect(menu(page)).toHaveText('Menu');
  await expect(bar.locator('.brand-mark')).toBeVisible();
  await expect(bar.locator('.brand-word')).toBeHidden();
  expect(await small(page)).toEqual([]);
  expect(Math.round((await bar.boundingBox())!.height)).toBe(60);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  // Sticky with a light translucent fill: still at the top after a long scroll.
  await page.evaluate(() => window.scrollTo(0, 1200));
  expect(Math.round((await bar.boundingBox())!.y)).toBe(0);
  expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
});

test('under 360 px Listen and the language move into the drawer; from 360 px they sit in the bar', async ({
  page,
}) => {
  await open(page, 360);
  await expect(listen(page)).toBeVisible();
  await expect(language(page)).toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(await small(page)).toEqual([]);

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(listen(page)).toBeHidden();
  await expect(language(page)).toBeHidden();
  await menu(page).click();
  await expect(listen(page)).toBeVisible();
  await expect(language(page)).toBeVisible();
  expect(await small(page)).toEqual([]);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test('the drawer lists the five choices, then Sign In, Start a Request and Help as the last rows', async ({
  page,
}) => {
  await open(page, 390);
  await menu(page).click();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const names = ['What We Do', 'How It Works', 'Markets', 'Trust', 'Sign In', 'Start a Request'];
  const tops: number[] = [];
  for (const name of names) {
    const target = nav.getByRole(name === 'What We Do' ? 'button' : 'link', {
      name: new RegExp(`^${name}`),
    });
    tops.push((await target.first().boundingBox())!.y);
  }
  const help = nav.getByRole('button', { name: 'Help', exact: true });
  tops.push((await help.boundingBox())!.y);
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  await help.click();
  await expect(nav.getByRole('link', { name: 'See How It Works' })).toBeVisible();
  expect(await small(page)).toEqual([]);
});

test('the language sheet lists each language in its own script with its code, and says six of seven are drafts', async ({
  page,
}) => {
  await open(page, 390);
  await language(page).click();
  const sheet = page.getByRole('dialog', { name: 'Language' });
  await expect(sheet).toBeVisible();
  const rows = sheet.getByRole('button').filter({ hasNotText: 'Close' });
  await expect(rows).toHaveCount(7);
  for (const [code, name] of [
    ['EN', 'English'],
    ['BN', 'বাংলা'],
    ['ZH', '中文'],
    ['ES', 'Español'],
    ['AR', 'العربية'],
    ['FR', 'Français'],
    ['DE', 'Deutsch'],
  ])
    await expect(
      sheet.getByRole('button', { name: new RegExp(`${code}\\s*${name}`) }),
    ).toBeVisible();
  await expect(
    sheet.getByText('Six of seven are draft translations. Native review pending.'),
  ).toBeVisible();
  // The sheet sits at the bottom of the window.
  const box = (await sheet.boundingBox())!;
  await expect
    .poll(async () =>
      Math.round((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height),
    )
    .toBe(844);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test('choosing a language switches the page, keeps the choice and returns focus; Escape closes the sheet', async ({
  page,
}) => {
  await open(page, 390);
  await language(page).click();
  await page
    .getByRole('dialog', { name: 'Language' })
    .getByRole('button', { name: /BN\s*বাংলা/ })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(language(page)).toContainText('BN');
  await expect(language(page)).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('corridra.language'))).toBe('bn');
  await page.reload();
  await expect(language(page)).toContainText('BN');

  await language(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(language(page)).toBeFocused();
});

test('Arabic stays right to left in the bar, the drawer and its own row of the sheet, at 320 and 390', async ({
  page,
}) => {
  await open(page, 390, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(language(page)).toContainText('AR');
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(await small(page)).toEqual([]);
  // The brand is at the start (right) and Menu at the end (left).
  const brand = (await header(page).locator('.brand').boundingBox())!;
  const menuBox = (await menu(page).boundingBox())!;
  expect(brand.x).toBeGreaterThan(menuBox.x);
  await language(page).click();
  const row = page.getByRole('dialog').getByRole('button', { name: /AR\s*العربية/ });
  await expect(row).toHaveAttribute('dir', 'rtl');
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 320, height: 640 });
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await menu(page).click();
  await expect(language(page)).toBeVisible();
  expect(await small(page)).toEqual([]);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await language(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test('Listen starts and stops the reading, as the corner Listen did', async ({ page }) => {
  await open(page, 390);
  await listen(page).click();
  await expect(listen(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(listen(page)).toContainText('Stop');
  await listen(page).click();
  await expect(listen(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => (window as unknown as { __speech: string[] }).__speech)).toEqual(
    ['cancel', 'speak', 'cancel'],
  );
});

test('the wide bar keeps the links and ends with Listen and the language code', async ({
  page,
}) => {
  await open(page, 1440);
  const bar = header(page);
  await expect(bar.getByRole('button', { name: 'What We Do' })).toBeVisible();
  await expect(listen(page)).toBeVisible();
  await expect(language(page)).toContainText('EN');
  await expect(menu(page)).toBeHidden();
  await expect(bar.getByRole('button', { name: 'Help', exact: true })).toBeHidden();
  const start = (await bar.getByRole('link', { name: /^Start a Request/ }).boundingBox())!;
  const tool = (await language(page).boundingBox())!;
  expect(tool.x).toBeGreaterThan(start.x);
  expect(await small(page)).toEqual([]);
  const results = await new AxeBuilder({ page }).include('header').analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
