import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// Team desk v4.1 review minor (reference-picker.tsx): when the picker's list needs a fresh authenticator check, the
// field stays in the form, disabled, with its chosen value and its hidden input, and the one quiet line offers the
// check beside it. The real picker on a small bundled page; the picker API is answered by the test.

const fixturePath = '/__v41-reference-picker';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { useState } from 'react';
        import { ReferencePicker } from ${JSON.stringify(resolve('apps/web/components/ux/reference-picker.tsx'))};
        function Form() {
          const [value, setValue] = useState('m-1');
          return (
            <form id="form">
              <ReferencePicker
                kind="mission"
                tenant="t-1"
                name="missionId"
                value={value}
                onChange={setValue}
                initialOptions={[{ value: 'm-1', label: 'Atlas sourcing mission' }]}
              />
            </form>
          );
        }
        createRoot(document.getElementById('app')).render(<main id="main"><h1>Picker</h1><Form /></main>);`,
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
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Picker fixture</title></head><body><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function openPicker(
  page: import('@playwright/test').Page,
  answer: { status: number; json: unknown },
) {
  let asked = 0;
  await page.route('**/api/picker/**', (route) => {
    asked += 1;
    return route.fulfill(answer);
  });
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(fixturePath);
  return () => asked;
}

test('a lapsed check keeps the field disabled with its value and hidden input, and shows one quiet line', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const asked = await openPicker(page, { status: 401, json: { code: 'STEP_UP_REQUIRED' } });
  const line = page.getByTestId('reverify-line');
  await expect(line).toHaveText('Confirm your code to see the list of missions.Confirm Code');
  await expect(line).toHaveAttribute('role', 'status');
  await expect(page.getByRole('button', { name: 'Confirm Code', exact: true })).toBeEnabled();
  const field = page.getByRole('combobox', { name: 'Mission' });
  await expect(field).toBeDisabled();
  await expect(field).toHaveValue('Atlas sourcing mission');
  await expect(page.locator('#form input[type="hidden"][name="missionId"]')).toHaveValue('m-1');
  expect(
    await page.evaluate(() =>
      [...new FormData(document.getElementById('form') as HTMLFormElement).entries()].map(
        ([key, value]) => [key, String(value)],
      ),
    ),
  ).toEqual([['missionId', 'm-1']]);
  // No error line: a lapsed check is not a failed search.
  await expect(page.getByText('Search is not available right now. Try again.')).toHaveCount(0);
  // Held back: no further search until the check passes.
  await page.waitForTimeout(400);
  expect(asked()).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('a plain refusal is a failed search, never the quiet line', async ({ page }) => {
  await openPicker(page, { status: 401, json: { error: 'Sign in to continue' } });
  await expect(page.getByText('Search is not available right now. Try again.')).toBeVisible();
  await expect(page.getByTestId('reverify-line')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Mission' })).toBeEnabled();
});
