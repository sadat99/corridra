import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// Audit row public-customer-24: the public header's signed-in check. The real hook on a small bundled page; the
// identity service is answered by the test. It proves one page load asks the team session once (the `pageshow` of a
// first load is not a reason to ask again), a page restored from the back button's cache asks again, and a refused
// answer leaves the page signed out without an error of the page's own.

const fixturePath = '/__v41-f2-c-session';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { useSignedIn } from ${JSON.stringify(resolve('apps/web/components/use-signed-in.ts'))};
        function Who() {
          const who = useSignedIn(false);
          return <p id="who">{who ?? 'no one'}</p>;
        }
        createRoot(document.getElementById('app')).render(<main id="main"><h1>Page</h1><Who /></main>);`,
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
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Session fixture</title></head><body><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

test('one load asks the team session once; only a restored page asks again', async ({ page }) => {
  // A browser that has signed in to the team desk carries the plain marker beside the HttpOnly session cookie.
  await page.addInitScript(() => {
    document.cookie = 'corridra-team=1; path=/';
  });
  let asked = 0;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/operator-auth/get-session', (route) => {
    asked += 1;
    return route.fulfill({ status: 429, json: { message: 'Too many requests' } });
  });
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(fixturePath);
  await expect(page.locator('#who')).toHaveText('no one');
  await expect.poll(() => asked).toBe(1);
  // What a browser fires at the end of every first load.
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })),
  );
  await page.waitForTimeout(200);
  expect(asked).toBe(1);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect.poll(() => asked).toBe(2);
  await expect(page.locator('#who')).toHaveText('no one');
  expect(pageErrors).toEqual([]);
});

test('without the team session marker the team session is never asked', async ({ page }) => {
  let asked = 0;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/operator-auth/get-session', (route) => {
    asked += 1;
    return route.fulfill({ json: { user: { id: 'u' }, session: { id: 's' } } });
  });
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(fixturePath);
  await expect(page.locator('#who')).toHaveText('no one');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await page.waitForTimeout(300);
  expect(asked).toBe(0);
  // With the marker, the same answer signs the page in as the team.
  await page.evaluate(() => {
    document.cookie = 'corridra-team=1; path=/';
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#who')).toHaveText('staff');
  expect(asked).toBe(1);
  expect(pageErrors).toEqual([]);
});
