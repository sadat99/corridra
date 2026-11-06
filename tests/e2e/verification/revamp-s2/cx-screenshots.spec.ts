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

// Navigation v1 (customer shell): the sidebar and the bottom tabs, with the avatar, language, help and
// notifications menus open, for the owner's review. Same folder rule as above.
for (const [width, height] of [
  [320, 700],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const)
  test(`NAV-07 customer shell and menus at ${width}`, async ({ page, context }) => {
    mkdirSync(resolve(folder!), { recursive: true });
    await signInCustomer(context);
    await page.route('**/api/customer-inbox', (route) =>
      route.fulfill({
        json: [
          {
            id: '1',
            type: 'TEAM_INVITE',
            payload: { title: 'Team invitation' },
            readAt: null,
            createdAt: '2026-11-04T10:00:00Z',
          },
          {
            id: '2',
            type: 'REPLY_POSTED',
            payload: { title: 'New reply' },
            readAt: null,
            createdAt: '2026-11-04T09:00:00Z',
          },
          {
            id: '3',
            type: 'REPORT_PUBLISHED',
            payload: { title: 'Report saved' },
            readAt: '2026-11-04T11:00:00Z',
            createdAt: '2026-11-03T09:00:00Z',
          },
        ],
      }),
    );
    await page.setViewportSize({ width, height });
    await page.goto('/account');
    await page.locator('main h1').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const shot = (name: string) =>
      page.screenshot({ path: resolve(folder!, `${name}-${width}.png`) });
    const header = page.locator('header.ux-app-header');
    await shot('shell');
    for (const [name, label] of [
      ['avatar-menu', 'Account menu'],
      ['help-menu', 'Help and accessibility'],
      ['language-menu', 'Language'],
      ['notifications', 'Inbox'],
    ] as const) {
      const trigger = header.getByRole('button', { name: label, exact: true });
      if (!(await trigger.isVisible())) continue;
      await trigger.click();
      if (name === 'notifications') await page.locator('.ux-notice-panel h3').first().waitFor();
      await shot(name);
      await page.keyboard.press('Escape');
    }
  });
