import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Audit row public-customer-17: the team and helper sign-in forms. The real form on a small bundled page; the identity
// service is answered by the test. It proves focus is not moved on first load, and is moved to the heading when the
// step changes and to the message when sign-in fails.

const fixturePath = '/__v41-f2-c-signin';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { OperatorSignin } from ${JSON.stringify(resolve('apps/web/app/operator/signin/signin-form.tsx'))};
        const helper = new URLSearchParams(window.location.search).has('helper');
        createRoot(document.getElementById('app')).render(
          <main id="main" className="operator-page ux-workspace ux-access"><h1>Sign in</h1><OperatorSignin returnTo={helper ? '/contributor' : '/operator'} /></main>,
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
  const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in fixture</title><style>${css}</style></head><body><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, query = '') {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixturePath + query);
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
}

const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? el.tagName + (el.getAttribute('role') ? ':' + el.getAttribute('role') : '') : '';
  });

for (const [name, query, heading] of [
  ['team', '', 'Use your operator account'],
  ['helper', '?helper=1', 'Use your helper work account'],
] as const) {
  test(`${name} sign-in: focus is not moved on first load`, async ({ page }) => {
    await open(page, query);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    // Give any effect a moment to run before reading where focus is.
    await page.waitForTimeout(150);
    expect(await focused(page)).toBe('BODY');
    // The first Tab lands on the first field, not past the form.
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email')).toBeFocused();
  });
}

test('a step change moves focus to the new heading', async ({ page }) => {
  await page.route('**/sign-in/email', (route) =>
    route.fulfill({ json: { twoFactorRedirect: true } }),
  );
  await open(page);
  await page.getByLabel('Email').fill('person@example.invalid');
  await page.getByLabel('Password').fill('a-made-up-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  const heading = page.getByRole('heading', { name: 'Verify your authenticator' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
});

test('a failed sign-in moves focus to the message', async ({ page }) => {
  await page.route('**/sign-in/email', (route) =>
    route.fulfill({ status: 401, json: { message: 'Invalid email or password' } }),
  );
  await open(page);
  await page.getByLabel('Email').fill('person@example.invalid');
  await page.getByLabel('Password').fill('a-made-up-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('Sign-in failed. Check your details and try again.');
  await expect(alert).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Use your operator account' })).toBeVisible();
});
