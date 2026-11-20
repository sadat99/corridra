import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Account, Preferences, "This device" (UI/UX.v4, Wave 2 unit 04): the one place that clears which replies a person has
// read, kept in this browser only. The real component and the real stylesheet are mounted in a small page.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const seenKey = 'corridra.move.seen';
const seenValue = JSON.stringify({ 'r-1': '2026-10-09T10:00:00Z' });

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{ThisDevice}from ${JSON.stringify(resolve('apps/web/app/account/this-device.tsx'))};
      const offered=['en','bn','zh','es','ar','fr','de'].map(code=>({code,draft:code!=='en'}));
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={offered}>
          <main><section aria-label="Preferences and notifications" className="ux-account-panel"><h2>Preferences and Notifications</h2><ThisDevice /></section></main>
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
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>This device fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

async function mount(page: Page, language = 'en', blocked = false) {
  await page.addInitScript(
    ({ language, blocked, seenKey, seenValue }) => {
      localStorage.setItem('corridra.language', language);
      if (blocked) {
        Storage.prototype.setItem = () => {
          throw new DOMException('blocked', 'SecurityError');
        };
      } else if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(seenKey, seenValue);
        sessionStorage.setItem('seeded', '1');
      }
    },
    { language, blocked, seenKey, seenValue },
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'This device', level: 3 })).toBeVisible();
}
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), seenKey);

const forgotten: Record<string, string> = {
  en: 'Done. This device has forgotten which replies you read.',
  ar: 'تم. نسي هذا الجهاز الردود التي قرأتها.',
};
const buttons: Record<string, string> = {
  en: 'Forget Which Replies I Have Read on This Device',
  ar: 'انسَ الردود التي قرأتها على هذا الجهاز',
};

for (const language of ['en', 'ar']) {
  test(`clears at once with no confirmation, says so in a status line, and keeps focus (${language})`, async ({
    page,
  }) => {
    await mount(page, language);
    expect(await stored(page)).toBe(seenValue);
    const status = page.getByRole('status');
    await expect(status).toHaveCount(1);
    await expect(status).toHaveText('');
    const button = page.getByRole('button', { name: buttons[language] });
    await button.focus();
    await button.click();
    expect(await stored(page)).toBe('{}');
    await expect(status).toHaveText(forgotten[language]);
    await expect(button).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (language === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
}

test('the button is a secondary button at least 44 px high, even at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mount(page);
  const button = page.getByRole('button', { name: buttons.en });
  await expect(button).toHaveClass(/button-secondary/);
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('the line about this device is shown', async ({ page }) => {
  await mount(page);
  await expect(
    page.getByText('Which replies you have read is kept on this device only.'),
  ).toBeVisible();
});

test('when this device cannot remember, only the cannot-remember alert shows, never Done', async ({
  page,
}) => {
  await mount(page, 'en', true);
  await expect(page.getByRole('alert')).toHaveText(
    'This device cannot remember what you have read.',
  );
  await page.getByRole('button', { name: buttons.en }).click();
  await expect(page.getByRole('status')).toHaveText('');
  await expect(page.getByText('Done.')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText(
    'This device cannot remember what you have read.',
  );
});

test('axe is clean, in English and in Arabic', async ({ page }) => {
  for (const language of ['en', 'ar']) {
    await mount(page, language);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
    await page.evaluate(() => localStorage.clear());
  }
});
