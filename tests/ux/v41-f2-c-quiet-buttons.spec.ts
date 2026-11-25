import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Audit row public-customer-09: the home's line of quiet choices ("Open the Delegation Route", "Something Else",
// "Show Every Route"). The real QuietButton with the home's real styles and words, in the home's own row, on a small
// bundled page. It proves a label never breaks inside a word, the buttons stack full width on the narrowest phone, and
// two buttons never touch.

const fixturePath = '/__v41-f2-c-quiet-buttons';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { QuietButton } from ${JSON.stringify(resolve('apps/web/components/ux/open-card.tsx'))};
        import { homeEn } from ${JSON.stringify(resolve('apps/web/lib/i18n/home-words.ts'))};
        const words = (name) => homeEn[name];
        createRoot(document.getElementById('app')).render(
          <main id="main" className="ux-guide-home ac1-home tr-home"><h1>Home</h1>
            <section className="tr-section tr-choose">
              <div className="tr-open-more">
                <p>{words('home.tr.open.more')}</p>
                <QuietButton onClick={() => {}}>{words('home.tr.open.delegation')}</QuietButton>
                <QuietButton onClick={() => {}}>{words('home.tr.open.other')}</QuietButton>
                <QuietButton onClick={() => {}}>{words('home.tr.open.everything')}</QuietButton>
              </div>
            </section>
          </main>,
        );`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const css = [
    'app/globals.css',
    'components/home-landing.css',
    'components/home-routes.css',
    'components/ux/open-card.css',
  ]
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Quiet buttons fixture</title><style>${css}</style></head><body><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number) {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: 800 });
  await page.goto(fixturePath);
  await expect(page.getByRole('button', { name: 'Something Else' })).toBeVisible();
}

/** For each quiet button: its box, and whether any word of its label is drawn on more than one line. */
const measure = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.ux-quiet-button')).map((button) => {
      const node = button.firstChild as Text;
      const label = node.textContent ?? '';
      let splitWord = false;
      for (const match of label.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
        if (tops.size > 1) splitWord = true;
      }
      const box = button.getBoundingClientRect();
      const wrap = getComputedStyle(button).overflowWrap;
      return {
        label,
        splitWord,
        wrap,
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        width: box.width,
      };
    }),
  );

for (const width of [320, 359, 390, 768, 1440]) {
  test(`quiet choices at ${width}: whole words, 8 px apart, no sideways scroll`, async ({
    page,
  }) => {
    await open(page, width);
    const buttons = await measure(page);
    expect(buttons.map((b) => b.label)).toEqual([
      'Open the Delegation Route',
      'Something Else',
      'Show Every Route',
    ]);
    for (const button of buttons) {
      expect(button.splitWord, button.label + ' breaks inside a word').toBe(false);
      expect(button.wrap, button.label + ' may not wrap inside a word').not.toBe('anywhere');
      expect(button.bottom - button.top).toBeGreaterThanOrEqual(44);
    }
    for (let i = 0; i < buttons.length; i++)
      for (let j = i + 1; j < buttons.length; j++) {
        const a = buttons[i]!;
        const b = buttons[j]!;
        const across = Math.max(b.left - a.right, a.left - b.right);
        const down = Math.max(b.top - a.bottom, a.top - b.bottom);
        expect(Math.max(across, down), `${a.label} and ${b.label}`).toBeGreaterThanOrEqual(8);
      }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test('under 360 px the quiet choices stack, each the full width of the row', async ({ page }) => {
  await open(page, 320);
  const row = (await page.locator('.tr-open-more').boundingBox())!;
  const buttons = await measure(page);
  for (const button of buttons) expect(Math.round(button.width)).toBe(Math.round(row.width));
  expect(new Set(buttons.map((b) => Math.round(b.top))).size).toBe(3);
});
