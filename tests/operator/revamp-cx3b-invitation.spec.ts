import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CX PR 3b, the Reports page (docs/revamp/specs/customer-experience.md): one "Open an Invitation" action opens one
// dialog that holds the two existing ways in, open it for this visit and save it to the account, instead of two
// forms and a link spread over the page. The forms keep their own logic. Case ids: CX-02 (every way in is still
// reachable), CX-04 (the tab that shows the result opens by itself), CX-05 (dialog keyboard and axe at 390, 1440).
const issuer = 'https://ep-cx3b-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const savedId = '00000000-0000-4000-8000-000000000001';
const token = 'a'.repeat(64);
const saved = {
  id: savedId,
  available: true,
  removed: false,
  title: 'Synthetic approved commercial scope',
  expiresAt: '2026-12-01T00:00:00Z',
};
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{ReportsTabs}from ${JSON.stringify(resolve('apps/web/app/account/reports-tabs.tsx'))};
      import{InvitationProvider,OpenInvitationButton}from ${JSON.stringify(resolve('apps/web/app/account/invitation-dialog.tsx'))};
      import{SavedMissions}from ${JSON.stringify(resolve('apps/web/app/account/saved-missions.tsx'))};
      import{CustomerMissions}from ${JSON.stringify(resolve('apps/web/app/account/customer-missions.tsx'))};
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <main className="operator-page ux-workspace ux-customer"><h1>Reports</h1>
            <InvitationProvider>
              <OpenInvitationButton/>
              <ReportsTabs
                delivered={<p>Nothing delivered yet.</p>}
                saved={<div id="saved-commercial-missions"><SavedMissions subject="synthetic-alice" issuer=${JSON.stringify(issuer)}/></div>}
                shared={<CustomerMissions/>}
              />
            </InvitationProvider>
          </main>
        </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'next-fixture',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : 'const router={replace:()=>{},push:()=>{}};export function useRouter(){return router}export function usePathname(){return "/account"}',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reports</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

let stored = false;
async function open(page: Page) {
  stored = false;
  await page.route('**/api/customer-saved-missions', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: { missions: stored ? [saved] : [], nextAfter: null, synthetic: true },
      });
    stored = true;
    return route.fulfill({ json: saved });
  });
  await page.route('**/api/customer-missions*', (route) =>
    route.fulfill({ status: 404, json: { error: 'unavailable' } }),
  );
  await page.goto(origin);
  await expect(page.getByRole('tab', { name: 'Delivered', exact: true })).toBeVisible();
}
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => v.id);

test('CX-02 one action opens one dialog holding both ways in; no paste field or link is spread over the page', async ({
  page,
}) => {
  await open(page);
  const button = page.getByRole('button', { name: 'Open an Invitation', exact: true });
  await expect(button).toHaveCount(1);
  // Closed: neither paste field is reachable, and the old link and disclosure are gone from the page.
  await expect(page.getByLabel('Private mission invitation', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Private client mission invitation', { exact: true })).toBeHidden();
  await expect(page.getByText('Open an original shared mission invitation')).toHaveCount(0);
  await expect(page.getByText('Save an invitation', { exact: true })).toHaveCount(0);
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Open an Invitation' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Private mission invitation', { exact: true })).toBeVisible();
  await expect(
    dialog.getByLabel('Private client mission invitation', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Open Shared Mission' })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Save Invitation to This Account' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test('CX-04 opening an invitation closes the dialog and shows the mission on the Shared With Me tab', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Open an Invitation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Open an Invitation' });
  // A wrong link is refused in the dialog, which stays open and says why.
  await dialog.getByLabel('Private mission invitation', { exact: true }).fill('not a link');
  await dialog.getByRole('button', { name: 'Open Shared Mission' }).click();
  await expect(dialog.getByRole('alert')).toContainText('complete private client link');
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel('Private mission invitation', { exact: true })
    .fill(`${origin}/client#${token}`);
  await dialog.getByRole('button', { name: 'Open Shared Mission' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Shared With Me' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: 'Mission invitation 1' })).toBeVisible();
});

test('CX-04 saving an invitation closes the dialog and shows it on the Saved Missions tab', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Open an Invitation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Open an Invitation' });
  await dialog
    .getByLabel('Private client mission invitation', { exact: true })
    .fill(`${origin}/client#${token}`);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Save Invitation to This Account' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Saved Missions' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Synthetic approved commercial scope')).toBeVisible();
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`CX-05 the invitation dialog has no axe violations and no sideways scroll at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'Open an Invitation', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Open an Invitation' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    // CX-07: the dialog at this width, for the owner's named review.
    mkdirSync('docs/design-system/evidence/revamp-cx3b', { recursive: true });
    await page.screenshot({
      path: `docs/design-system/evidence/revamp-cx3b/invitation-dialog-${width}.png`,
    });
  });
