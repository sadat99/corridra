import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Team desk v4.1 follow-up B (owner decision 26 Nov 2026): the staff screens that ended on a dead-end message when the
// authenticator check had lapsed (401 STEP_UP_REQUIRED) now give the existing in-place recovery. The real screens and
// the real "Confirm it is you" check are bundled from the source and every request is answered here, so no database is
// needed. For each screen: the refused request opens the check, and after the code is accepted the same request goes
// once more on the same screen; with the check closed, the screen says what to do and nothing was changed. The server
// rule is not touched: every refusal here is the server's own.
const tenant = '00000000-0000-4000-8000-0000000000a1';
const mission = '00000000-0000-4000-8000-0000000000b2';
const publication = '00000000-0000-4000-8000-0000000000c3';
const owner = { user_id: '00000000-0000-4000-8000-0000000000d4', name: 'Invented Owner Ada' };
const stepUp = {
  status: 401,
  json: { error: 'Verify your authenticator again to continue', code: 'STEP_UP_REQUIRED' },
};
const kept = 'Confirm your authenticator code to finish this. Your changes are kept.';
const readClosed = 'Confirm your authenticator code to see this. Nothing was changed.';

let server: Server;
let origin = '';
test.beforeAll(async () => {
  const source = (path: string) => JSON.stringify(resolve('apps/web', path));
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{CustomerServiceCatalogue}from ${source('app/operator/customer-service-catalogue.tsx')};
      import{CompanyLinkReview}from ${source('app/operator/company-link-review.tsx')};
      import{SpecificationRequests}from ${source('app/operator/specification-requests.tsx')};
      import{DecisionDisclosures}from ${source('app/operator/decision-disclosures.tsx')};
      import{CustomerMissionDelivery}from ${source('app/operator/customer-mission-delivery.tsx')};
      import{StepUpDialog}from ${source('components/ux/step-up-dialog.tsx')};
      const screen=new URLSearchParams(location.search).get('screen');
      const publications=[{id:${JSON.stringify(publication)},copy:{title:'Invented client report'},revoked:false}];
      const owners=[${JSON.stringify(owner)}];
      const el=screen==='catalogue'?<CustomerServiceCatalogue tenant="${tenant}"/>
        :screen==='links'?<CompanyLinkReview tenant="${tenant}"/>
        :screen==='specification'?<SpecificationRequests tenant="${tenant}" publications={publications} owners={owners}/>
        :screen==='decisions'?<DecisionDisclosures tenant="${tenant}" publications={publications}/>
        :<CustomerMissionDelivery tenant="${tenant}" mission="${mission}"/>;
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page ux-workspace"><h1>Team screen</h1>{el}<StepUpDialog/></main>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css', '.woff2': 'empty' },
    external: ['/flags/*'],
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'fixture-next',
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
                : 'export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>"/operator";export const useSearchParams=()=>new URLSearchParams();',
          }));
        },
      },
    ],
  });
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/fixture.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end(css + '\n' + componentCss);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Team screen</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Answer = { status: number; json: unknown };
type Sent = { method: string; path: string; body: Record<string, unknown> | null };

/** Opens one screen. Requests to `path` get `answers` in order (the last repeats); the code check always passes. */
async function open(page: Page, screen: string, path: string, answers: Answer[]) {
  const sent: Sent[] = [];
  const codes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/verify-totp')) {
      codes.push(String((request.postDataJSON() as { code?: unknown } | null)?.code));
      return route.fulfill({ json: { token: 'invented', user: { id: owner.user_id } } });
    }
    if (url.pathname === path) {
      expect(url.searchParams.get('tenant')).toBe(tenant);
      sent.push({
        method: request.method(),
        path: url.pathname + url.search,
        body: request.method() === 'POST' ? request.postDataJSON() : null,
      });
      const answer = answers[Math.min(sent.length, answers.length) - 1]!;
      return route.fulfill({ status: answer.status, json: answer.json });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${origin}/?screen=${screen}`);
  return { sent, codes };
}

const codeCheck = (page: Page) => page.getByRole('dialog', { name: 'Confirm it is you' });
async function confirmCode(page: Page) {
  const dialog = codeCheck(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Six-digit code').fill('123456');
  await dialog.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(dialog).toBeHidden();
}
async function closeCheck(page: Page) {
  const dialog = codeCheck(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
}
async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations.map((v) => v.id);
}

const catalogue = '/api/workspace/customer-service-requests';
const service = {
  key: 'site-visit',
  version: 1,
  title: 'Invented site visit',
  summary: 'An invented visit to a supplier site.',
  included: ['One visit'],
  excluded: ['Travel'],
  regions: ['Dhaka'],
  quoteBasis: 'per_visit',
  active: true,
};

test.describe('the service catalogue', () => {
  test('a refused list shows one quiet line; after the code the list reads again', async ({
    page,
  }) => {
    const { sent, codes } = await open(page, 'catalogue', catalogue, [
      stepUp,
      { status: 200, json: { services: [service] } },
    ]);
    const line = page.getByTestId('reverify-line');
    await expect(line).toContainText(
      'Confirm your code to see the services customers can ask for.',
    );
    await expect(page.getByText('The service list could not be loaded.')).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    await line.getByRole('button', { name: 'Confirm Code' }).click();
    await confirmCode(page);
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Invented site visit' }),
    ).toBeVisible();
    await expect(line).toHaveCount(0);
    expect(codes).toEqual(['123456']);
    expect(sent.map((s) => s.method)).toEqual(['GET', 'GET']);
  });

  test('a refused save opens the check and saves the same change once more', async ({ page }) => {
    const { sent } = await open(page, 'catalogue', catalogue, [
      { status: 200, json: { services: [service] } },
      stepUp,
      { status: 200, json: { ok: true } },
      { status: 200, json: { services: [service] } },
    ]);
    await page.getByRole('button', { name: 'Edit Invented site visit' }).click();
    await page.getByRole('button', { name: 'Save Service' }).click();
    await confirmCode(page);
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    const posts = sent.filter((s) => s.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual(posts[0]!.body);
  });

  test('with the check closed the form and its command stay, and nothing reads as a failure', async ({
    page,
  }) => {
    const { sent } = await open(page, 'catalogue', catalogue, [
      { status: 200, json: { services: [service] } },
      stepUp,
      stepUp,
      { status: 200, json: { ok: true } },
      { status: 200, json: { services: [service] } },
    ]);
    await page.getByRole('button', { name: 'Edit Invented site visit' }).click();
    await page.getByLabel('Plain title').fill('Invented site visit, longer');
    await page.getByRole('button', { name: 'Save Service' }).click();
    await closeCheck(page);
    await expect(page.getByRole('alert')).toHaveText(kept);
    await expect(page.getByLabel('Plain title')).toHaveValue('Invented site visit, longer');
    await expect(page.getByRole('button', { name: 'Save the Same Change Again' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    // The next try sends the same command (same id): it cannot be applied twice.
    await page.getByRole('button', { name: 'Save the Same Change Again' }).click();
    await confirmCode(page);
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    const posts = sent.filter((s) => s.method === 'POST');
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((p) => p.body!.commandId)).size).toBe(1);
  });
});

test.describe('company link requests', () => {
  const links = '/api/workspace/customer-organisation-links';
  const empty = { scope: 'open', synthetic: true, nextAfter: null, items: [] };
  test('Load opens the check and reads again on the same screen', async ({ page }) => {
    const { sent } = await open(page, 'links', links, [stepUp, { status: 200, json: empty }]);
    await page.getByText('Customer company link requests').click();
    await page.getByRole('button', { name: 'Load Company Link Requests' }).click();
    await confirmCode(page);
    await expect(page.getByRole('status')).toHaveText('No requests to show.');
    await expect(page.getByText(/then reload/)).toHaveCount(0);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.path).toBe(sent[0]!.path);
  });
  test('with the check closed it says what to do, not to reload', async ({ page }) => {
    const { sent } = await open(page, 'links', links, [stepUp]);
    await page.getByText('Customer company link requests').click();
    await page.getByRole('button', { name: 'Load Company Link Requests' }).click();
    await closeCheck(page);
    await expect(page.getByRole('status')).toHaveText(readClosed);
    expect(sent).toHaveLength(1);
    expect(await axe(page)).toEqual([]);
  });
});

// Each of these reads opens the check, reads once more after the code (answered here with "unavailable", so the screen
// shows its own words for that answer and not the old dead end), and with the check closed says what to do.
for (const [screen, path, button, unavailable, closed] of [
  [
    'specification',
    '/api/workspace/specification-confirmations',
    'Load Reviewed Requirements',
    /Specification confirmation is not available right now/,
    'Confirm your authenticator code to load the current requirements. Nothing was changed.',
  ],
  [
    'decisions',
    '/api/workspace/customer-decision-disclosures',
    'Load Decision Review',
    /Reviewed decision disclosure is unavailable/,
    'Confirm your authenticator code to see the decisions. Nothing was changed.',
  ],
  [
    'delivery',
    '/api/workspace/customer-mission-delivery',
    'Load Account Delivery Review',
    /Account delivery review is unavailable/,
    'Confirm your authenticator code to see the account delivery. Nothing was changed.',
  ],
] as const) {
  test.describe(`the ${screen} review`, () => {
    async function start(page: Page, answers: Answer[]) {
      const opened = await open(page, screen, path, answers);
      const summary = page.locator('summary').first();
      await summary.click();
      const choose = page.getByRole('combobox');
      if (await choose.count()) await choose.selectOption(publication);
      await page.getByRole('button', { name: button }).click();
      return opened;
    }
    test('the read opens the check and goes once more after the code', async ({ page }) => {
      const { sent } = await start(page, [stepUp, { status: 503, json: { error: 'off' } }]);
      await confirmCode(page);
      await expect(page.getByRole('status')).toHaveText(unavailable);
      expect(sent).toHaveLength(2);
      expect(sent[1]!.path).toBe(sent[0]!.path);
    });
    test('with the check closed it says what to do and nothing was changed', async ({ page }) => {
      const { sent } = await start(page, [stepUp]);
      await closeCheck(page);
      await expect(page.getByRole('status')).toHaveText(closed);
      expect(sent).toHaveLength(1);
      expect(await axe(page)).toEqual([]);
    });
  });
}
