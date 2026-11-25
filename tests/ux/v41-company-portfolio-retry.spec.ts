import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// Audit row public-customer-24 (second half): /account/companies said "Companies could not be loaded. Refresh and try
// again." with no way to try again in place. The real portfolio on a small bundled page; the companies read is
// answered by the test: first a failure, then an empty page.

const fixturePath = '/__v41-company-portfolio';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { CompanyPortfolio } from ${JSON.stringify(resolve('apps/web/app/account/companies/company-portfolio.tsx'))};
        createRoot(document.getElementById('app')).render(
          <main id="main"><h1>Companies</h1><CompanyPortfolio subject="s-1" issuer="i-1" /></main>);`,
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
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Portfolio fixture</title></head><body><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

test('a failed read offers Try Again in place, and Try Again reads again', async ({ page }) => {
  let asked = 0;
  await page.route('**/api/customer-companies*', (route) => {
    asked += 1;
    return asked === 1
      ? route.fulfill({ status: 429, json: { error: 'Too many requests' } })
      : route.fulfill({
          json: {
            synthetic: true,
            companies: [],
            nextAfter: null,
            scopesRead: 0,
            unavailableScopes: 0,
            expiresAt: null,
          },
        });
  });
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(fixturePath);
  await expect(page.getByRole('alert')).toHaveText('Companies could not be loaded.');
  const retry = page.getByRole('button', { name: 'Try Again', exact: true });
  await expect(retry).toBeVisible();
  // One action for the failure: the refresh button of a loaded list is not drawn beside it.
  await expect(page.getByRole('button', { name: 'Refresh Approved Companies' })).toHaveCount(0);
  await retry.click();
  await expect.poll(() => asked).toBe(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(retry).toHaveCount(0);
});
