import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, signInCustomer } from '../fixtures';

// CX-07: screenshots of the customer pages at 390 and 1440 for the owner's named review (customer
// experience spec, docs/revamp/specs/customer-experience.md). Taken with the test-only customer sign-in
// on a production build. They are written only when CX_SHOTS_DIR names a folder, so an ordinary run
// leaves nothing behind. The folder is created if it is missing. The pages are the five in the left bar.
const folder = process.env.CX_SHOTS_DIR;
const pages: [string, string][] = [
  ['home', '/account'],
  ['requests', '/account?view=work'],
  ['companies', '/account/companies'],
  ['reports', '/account?view=results'],
  ['account', '/account?view=more'],
];

test.skip(!folder, 'Set CX_SHOTS_DIR to take the customer screenshots');

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`CX-07 customer pages at ${width}`, async ({ page, context }) => {
    mkdirSync(resolve(folder!), { recursive: true });
    await signInCustomer(context);
    await page.setViewportSize({ width, height });
    for (const [name, path] of pages) {
      await page.goto(path);
      await page.locator('main h1').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(folder!, `${name}-${width}.png`), fullPage: true });
    }
  });
