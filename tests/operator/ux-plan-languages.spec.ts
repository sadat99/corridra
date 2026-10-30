import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { localeCodes } from '../../apps/web/lib/i18n/locales';

// The request form in the chosen language (Lane 11), mounted in the real frame: the real header, the real /plan
// page (its main region, heading and form) and the built stylesheets. The page is compared with the request page
// of PR 214 (c29f2cc), built from `git show` of that commit, so "with the form switch off nothing changes" is
// proved against the code as it was, not against a copy of it.
const baseline = 'c29f2cc6da10052ba0be7a9e8ba2daf60f1e2f8d';
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
let css = '';
let fontClass = '';

const fixtureEnv = `<script>
const q=new URLSearchParams(location.search),real=q.get('mode')==='real';
globalThis.fixtureEnv={CORRIDRA_UX_FIRSTQ:q.get('fq')==='1'?'true':'',CORRIDRA_LANGUAGES_FORM:q.get('form')||'',
CORRIDRA_CUSTOMER_CODE_SIGNIN:q.get('code')==='1'?'true':'',DATA_ENVIRONMENT:real?'real':'synthetic',
CORRIDRA_REAL_USE_ENABLED:real?'true':''};
</script>`;

test.beforeAll(async () => {
  const before = (path: string) =>
    execFileSync('git', ['show', `${baseline}:apps/web/app/plan/${path}`], { encoding: 'utf8' });
  const sources: Record<string, string> = {
    page: before('page.tsx'),
    intake: before('intake.tsx'),
  };
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{SiteHeader}from ${JSON.stringify(resolve('apps/web/components/site-header.tsx'))};
      import{languagesWithPages}from ${JSON.stringify(resolve('apps/web/lib/i18n/pages.ts'))};
      import NowPage from ${JSON.stringify(resolve('apps/web/app/plan/page.tsx'))};
      import{Intake as NowIntake}from ${JSON.stringify(resolve('apps/web/app/plan/intake.tsx'))};
      import BasePage from 'plan-before:page';
      import{Intake as BaseIntake}from 'plan-before:intake';
      const q=new URLSearchParams(location.search),base=q.get('view')==='base';
      const offered=['en','bn','zh','es','ar','fr','de'].map((code)=>({code,draft:false}));
      const Page=base?BasePage:NowPage,Intake=base?BaseIntake:NowIntake;
      const submit=async()=>{window.privateSubmitted=(window.privateSubmitted||0)+1};
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={offered} pageLocales={languagesWithPages({CORRIDRA_LANGUAGES_PAGES:q.get('pages')||''})}>
          <div className="site-shell">
            <SiteHeader accounts={false}/>
            {q.get('mode')==='private'
              ? <main id="main" lang="en" dir="ltr" tabIndex={-1} className="ux-workspace"><Intake privateSubmission={{draftStorageKey:'fixture-private-draft',submit}}/></main>
              : <Page/>}
          </div>
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
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env': 'globalThis.fixtureEnv',
    },
    plugins: [
      {
        name: 'plan-before',
        setup(b) {
          b.onResolve({ filter: /^plan-before:(page|intake)$/ }, (args) => ({
            path: args.path.slice('plan-before:'.length),
            namespace: 'plan-before',
          }));
          // The old page imports its own old form.
          b.onResolve({ filter: /^\.\/intake$/, namespace: 'plan-before' }, () => ({
            path: 'intake',
            namespace: 'plan-before',
          }));
          b.onLoad({ filter: /.*/, namespace: 'plan-before' }, (args) => ({
            contents: sources[args.path],
            loader: 'tsx',
            resolveDir: resolve('apps/web/app/plan'),
          }));
        },
      },
      {
        name: 'next-fixture',
        setup(b) {
          b.onResolve({ filter: /neon-auth-client$|^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : args.path === 'next/navigation'
                  ? 'const router={replace:(path)=>{window.navigatedTo=path},refresh:()=>{},push:()=>{}};export function useRouter(){return router}'
                  : 'export const accountClient={getSession:async()=>({data:null,error:null}),signUp:{email:async()=>({error:null})}};',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const documentResponse = await fetch('http://127.0.0.1:3200/');
  expect(documentResponse.status).toBe(200);
  const document = await documentResponse.text();
  fontClass = document.match(/<html[^>]*class="([\w -]+)"/)?.[1] ?? '';
  expect(fontClass).toBeTruthy();
  const cssPaths = [
    ...new Set(
      [...document.matchAll(/href="(\/_next\/static\/[^"?]+\.css)(?:\?[^"\s]*)?"/g)].map(
        (m) => m[1]!,
      ),
    ),
  ];
  expect(cssPaths.length).toBeGreaterThan(0);
  css = cssPaths
    .map((path) =>
      readFileSync(resolve('apps/web/.next/static', path.slice('/_next/static/'.length)), 'utf8'),
    )
    .join('\n')
    .replaceAll('../media/', '/_next/static/media/');
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    if (/^\/_next\/static\/media\/[\w.-]+\.woff2$/.test(path)) {
      res.setHeader('content-type', 'font/woff2');
      res.end(readFileSync(resolve('apps/web/.next/static', path.slice('/_next/static/'.length))));
      return;
    }
    if (path.startsWith('/api/')) {
      res.statusCode = 404;
      res.end('{}');
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plan fixture</title><link rel="stylesheet" href="/app.css">${fixtureEnv}</head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>`,
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

/** The request API as the form sees it: a saved sample request, a receipt with one reply, no saved real request. */
async function stubApi(page: Page) {
  await page.route('**/api/intake', (route) =>
    route.fulfill({ status: 201, json: { receipt: 'CRDR-FIXTURE-RECEIPT-0001' } }),
  );
  await page.route('**/api/intake/receipt', (route) =>
    route.fulfill({
      json: {
        status: 'UNDER_REVIEW',
        replies: [{ body: 'Sample reply body.', createdAt: '2026-10-30T09:00:00.000Z' }],
      },
    }),
  );
  await page.route('**/api/intake/pending', (route) =>
    route.fulfill({
      json: route.request().method() === 'GET' ? { pending: false, available: true } : { ok: true },
    }),
  );
}

async function open(page: Page, language: string, query: string) {
  await page.addInitScript((value) => localStorage.setItem('corridra.language', value), language);
  await stubApi(page);
  await page.goto(`${origin}/?${query}`);
  await expect(page.locator('form.intake-form .guide-actions .primary-link')).toBeEnabled();
}

/** What a comparison reads at one state: the main region's markup and its accessibility tree. */
async function capture(page: Page, name: string) {
  const main = page.locator('#main');
  return { name, html: await main.evaluate((el) => el.outerHTML), aria: await main.ariaSnapshot() };
}

/**
 * Walks the form through every step with structural selectors only, so the same walk runs in every language:
 * the empty-step errors, a sample amount error, the receipt (sample) or the saved request (real) and a receipt check.
 */
async function walk(page: Page, mode: 'sample' | 'real' | 'private') {
  const states = [await capture(page, 'step 1')];
  const form = page.locator('form.intake-form');
  const next = form.locator('.guide-actions .primary-link');
  const heading = form.locator('h2');
  const go = async (name: string) => {
    const before = await heading.textContent();
    await next.click();
    await expect(heading).not.toHaveText(before ?? '');
    states.push(await capture(page, name));
  };
  await next.click();
  await expect(page.locator('.ux-error-summary')).toBeVisible();
  states.push(await capture(page, 'step 1 errors'));
  await form.locator('select').first().selectOption('machinery_procurement');
  await go('step 2');
  await next.click();
  await expect(page.locator('.ux-error-summary')).toBeVisible();
  states.push(await capture(page, 'step 2 errors'));
  await form.locator('select').nth(0).selectOption('DE');
  await form.locator('select').nth(1).selectOption('US');
  await form.locator('input[name="attendance"]').first().check();
  await form.locator('#brief-startDate').fill('2026-12-01');
  await form.locator('#brief-endDate').fill('2026-12-03');
  states.push(await capture(page, 'step 2 filled'));
  await go('step 3');
  await form.locator('textarea').first().fill('Packaging machines for a towel factory line.');
  await form.locator('details summary').click();
  await form.locator('#brief-budgetAmount').fill('12.345');
  await form.locator('details select').selectOption('CNY');
  await next.click();
  await expect(page.locator('.ux-error-summary')).toBeVisible();
  states.push(await capture(page, 'step 3 amount error'));
  await form.locator('#brief-budgetAmount').fill('12.30');
  await form.locator('#brief-budgetBasis').fill('Total equipment budget');
  await go('step 4');
  await next.click();
  await expect(page.locator('.ux-error-summary')).toBeVisible();
  states.push(await capture(page, 'step 4 errors'));
  await form.locator('input[type="checkbox"]').first().check();
  await go('step 5');
  await next.click();
  await expect(page.locator('.ux-error-summary')).toBeVisible();
  states.push(await capture(page, 'step 5 errors'));
  await form.locator('#brief-name').fill('Sample Person');
  await form.locator('#brief-company').fill('Sample Company');
  await form
    .locator('#brief-email')
    .fill(mode === 'real' ? 'person@company.test' : 'person@example.invalid');
  await form.locator('label.choice input[type="checkbox"]').check();
  if (mode === 'real') await form.locator('input[type="password"]').fill('a long sample password');
  states.push(await capture(page, 'step 5 filled'));
  await next.click();
  if (mode === 'sample') {
    await expect(page.locator('.receipt-panel input[readonly]')).toHaveValue(
      'CRDR-FIXTURE-RECEIPT-0001',
    );
    states.push(await capture(page, 'receipt'));
    await page.locator('#receipt-check button.primary-link').click();
    await expect(page.locator('#receipt-check .detail-card')).toBeVisible();
    states.push(await capture(page, 'receipt checked'));
  } else if (mode === 'real') {
    await expect(page.locator('#pending-request-title')).toBeVisible();
    states.push(await capture(page, 'saved request'));
  } else {
    await expect
      .poll(() => page.evaluate(() => (window as { privateSubmitted?: number }).privateSubmitted))
      .toBe(1);
    states.push(await capture(page, 'submitted'));
  }
  return states;
}

async function compareWithBaseline(
  page: Page,
  language: string,
  query: string,
  mode: 'sample' | 'real' | 'private',
) {
  await open(page, language, `${query}&view=base`);
  const before = await walk(page, mode);
  const now = await page.context().newPage();
  await open(now, language, query);
  const after = await walk(now, mode);
  expect(after.map((state) => state.name)).toEqual(before.map((state) => state.name));
  for (const [index, state] of after.entries()) {
    expect(state.html, `${language} ${query} ${state.name}`).toBe(before[index].html);
    expect(state.aria, `${language} ${query} ${state.name}`).toBe(before[index].aria);
  }
  // The main region says English whatever language is chosen.
  await expect(now.locator('#main')).toHaveAttribute('lang', 'en');
  await expect(now.locator('#main')).toHaveAttribute('dir', 'ltr');
  await now.close();
}

test.describe('with the form switch off', () => {
  for (const pages of ['', 'true', 'es,de'])
    for (const code of localeCodes)
      test(`${code}, page words ${pages || 'unset'}: the request form is exactly the PR 214 form at every step`, async ({
        page,
      }) => {
        await compareWithBaseline(page, code, `pages=${pages}`, 'sample');
      });

  for (const code of ['en', 'de', 'ar'])
    for (const [mode, query] of [
      ['sample', 'fq=1&pages=true'],
      ['real', 'mode=real&code=1&pages=true'],
      ['private', 'mode=private&pages=true'],
    ] as const)
      test(`${code}, ${query}: the request form is exactly the PR 214 form at every step`, async ({
        page,
      }) => {
        await compareWithBaseline(page, code, query, mode);
      });
});
