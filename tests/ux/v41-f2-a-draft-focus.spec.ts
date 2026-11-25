import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// UI/UX.v4.1 audit, unit F2 (builder A), finding 17: the saved request page (/account/drafts/[workspace]) does not
// take focus on first load. The real component on a small bundled page (no server, no sign-in); the list read is
// answered by this file. That focus still moves to the step heading after a step change is proved, with the whole
// form, in tests/operator/v3-guided-request-ui.spec.ts.

const fixturePath = '/__v41-f2-a-draft-focus';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { GuidedRequest } from ${JSON.stringify(resolve('apps/web/app/account/drafts/guided-request.tsx'))};
        createRoot(document.getElementById('app')).render(
          <main id="main"><h1>Start a request</h1>
            <GuidedRequest subject="synthetic-alice" issuer="https://issuer.invalid" workspaceId="00000000-0000-4000-8000-0000000000a1" profilesEnabled />
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
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draft focus fixture</title></head><body><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

test('17: first load leaves focus at the top of the page, not on the step heading', async ({
  page,
}) => {
  await page.route('**' + fixturePath, (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/api/**', (route) => route.fulfill({ status: 500, json: {} }));
  await page.goto(fixturePath);
  // The heading that used to take focus is drawn and can still be focused by the form after a step change.
  const heading = page.locator('h2[tabindex="-1"]');
  await expect(heading).toBeVisible();
  await expect(page.getByText('could not be loaded')).toBeVisible();
  await expect(heading).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
});
