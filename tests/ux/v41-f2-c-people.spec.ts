import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Audit row public-customer-25: /how-it-works has one tab row (the phases of the approach), so the eight people it
// borrows from the home are a group of named choices there. The real component with the home's real styles on a small
// bundled page. It proves: no tab list, eight visible names, one pressed choice that shows as chosen, the words of the
// chosen person, 44 px targets and no sideways scroll; and that the home's own tab group is unchanged.

const fixturePath = '/__v41-f2-c-people';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { People } from ${JSON.stringify(resolve('apps/web/components/home-more.tsx'))};
        import { LanguageProvider } from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
        const home = new URLSearchParams(window.location.search).has('home');
        createRoot(document.getElementById('app')).render(
          <LanguageProvider offered={[{ code: 'en', draft: false }]}>
            <main id="main" className="ac1-home tr-home tr-more-sections"><h1>Page</h1>{home ? <People /> : <People choices />}</main>
          </LanguageProvider>,
        );`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    external: ['/flags/*'],
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const css = ['app/globals.css', 'components/home-landing.css', 'components/home-routes.css']
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>People fixture</title><style>${css}</style></head><body><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, query = '') {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: 800 });
  await page.goto(fixturePath + query);
  await expect(
    page.getByRole('button', { name: 'Exporter' }).or(page.getByRole('tab', { name: 'Exporter' })),
  ).toBeVisible();
}

for (const width of [320, 390, 768, 1440]) {
  test(`the people as choices at ${width}: no tab list, eight names, one pressed`, async ({
    page,
  }) => {
    await open(page, width);
    await expect(page.locator('[role="tablist"], [role="tab"], [role="tabpanel"]')).toHaveCount(0);
    const people = page.getByRole('group', { name: 'Who are you?' });
    const buttons = people.getByRole('button');
    await expect(buttons).toHaveCount(8);
    for (const button of await buttons.all()) {
      expect((await button.innerText()).trim()).not.toBe('');
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect(people.locator('[aria-pressed="true"]')).toHaveText('Exporter');
    const first = await page.locator('#who-panel').innerText();
    await people.getByRole('button', { name: 'Importer' }).click();
    await expect(people.locator('[aria-pressed="true"]')).toHaveText('Importer');
    await expect(page.locator('#who-panel')).not.toHaveText(first);
    await expect(page.locator('#who-panel')).toHaveAttribute('aria-live', 'polite');
    // The chosen one looks chosen: its fill differs from an unchosen one.
    const fills = await people.evaluate((node) =>
      Array.from(node.querySelectorAll('button')).map((b) => getComputedStyle(b).backgroundColor),
    );
    expect(fills[1]).not.toBe(fills[0]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test('the home keeps the people as its one tab group', async ({ page }) => {
  await open(page, 390, '?home=1');
  const tabs = page.getByRole('tablist', { name: 'Who are you?' });
  await expect(tabs.getByRole('tab')).toHaveCount(8);
  await tabs.getByRole('tab', { name: 'Exporter' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Importer' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
});
