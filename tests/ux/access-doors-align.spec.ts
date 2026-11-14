import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Access doors, Unit A follow-up: on /access/customer the two actions of the "New to Corridra" panel, Create Account
// and Start a Request Without an Account, start at the same left edge. The global sibling-margin rule
// (`main :is(section, div, ...) > a + a`) used to push the second one 12 px to the right from 640 px up. The real
// panel component and the real stylesheets sit on a small bundled page inside a main element, because the customer
// page only shows Create Account where customer sign-in is configured, and the test server has none.
const fixturePath = '/__access-panel-align-fixture';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { CreatePanel } from ${JSON.stringify(resolve('apps/web/app/access/customer/create-panel.tsx'))};
        createRoot(document.getElementById('app')).render(
          <div className="access-page access-panels">
            <CreatePanel text="Create an account to start and follow your requests." button={true} />
          </div>);`,
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
  const css = ['app/globals.css', 'components/page-compact.css', 'app/access/access.css']
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Access panel fixture</title><style>${css}</style></head><body><div class="site-shell"><main id="app"></main></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

for (const width of [390, 768, 1440]) {
  test(`Create Account and Start a Request Without an Account share one left edge at ${width}px`, async ({
    page,
  }) => {
    await page.route('**' + fixturePath + '*', (route) =>
      route.fulfill({ contentType: 'text/html', body: html }),
    );
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await page.goto(fixturePath);
    const links = page.locator('.access-panel').getByRole('link');
    await expect(links).toHaveText(['Create Account', 'Start a Request Without an Account']);
    const lefts = await links.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().left),
    );
    expect(Math.abs(lefts[0]! - lefts[1]!), `left edges ${lefts.join(' and ')}`).toBeLessThan(0.5);
  });
}
