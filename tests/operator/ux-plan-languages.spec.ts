import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { localeCodes, localeMeta, type Locale } from '../../apps/web/lib/i18n/locales';
import { translate } from '../../apps/web/lib/i18n/messages';
import { fill } from '../../apps/web/lib/i18n/fill';
import { formEn, type FormCatalog, type FormKey } from '../../apps/web/lib/i18n/form-words/en';
import { words as ar } from '../../apps/web/lib/i18n/form-words/ar';
import { words as bn } from '../../apps/web/lib/i18n/form-words/bn';
import { words as de } from '../../apps/web/lib/i18n/form-words/de';
import { words as es } from '../../apps/web/lib/i18n/form-words/es';
import { words as fr } from '../../apps/web/lib/i18n/form-words/fr';
import { words as zh } from '../../apps/web/lib/i18n/form-words/zh';

// The request form in the chosen language (Lane 11), mounted in the real frame: the real header, the real /plan
// page (its main region, heading and form) and the built stylesheets. The page is compared with the request page
// of PR 214 (c29f2cc), built from `git show` of that commit, so "with the form switch off nothing changes" is
// proved against the code as it was, not against a copy of it.
const baseline = 'c29f2cc6da10052ba0be7a9e8ba2daf60f1e2f8d';
let server: Server, origin: string;
let bundle = '';
const chunks = new Map<string, string>();
/** The file holding the German form words, as the fixture's bundler split it out. */
let germanChunk = '';
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
      import{offeredLanguages}from ${JSON.stringify(resolve('apps/web/lib/i18n/locales.ts'))};
      import{CornerDock}from ${JSON.stringify(resolve('apps/web/components/corner-dock.tsx'))};
      import{formEn}from ${JSON.stringify(resolve('apps/web/lib/i18n/form-words/en.ts'))};
      import NowPage from ${JSON.stringify(resolve('apps/web/app/plan/page.tsx'))};
      import{Intake as NowIntake}from ${JSON.stringify(resolve('apps/web/app/plan/intake.tsx'))};
      import BasePage from 'plan-before:page';
      import{Intake as BaseIntake}from 'plan-before:intake';
      const q=new URLSearchParams(location.search),base=q.get('view')==='base';
      const offered=offeredLanguages({CORRIDRA_LANGUAGES_REVIEWED:q.get('reviewed')??'bn,zh,es,ar,fr,de'});
      if(q.get('pseudo')==='1'){
        // German words 40 percent longer than English, with a long compound every third sentence. Step words,
        // buttons, headings and pills keep to their own length limits (checked in language-form.test.ts), so they
        // are made longer but get no compound.
        const {words}=await import(${JSON.stringify(resolve('apps/web/lib/i18n/form-words/de.ts'))});
        const limited=/^form\.(step|action|head|pending|receipt|check)\.|(Pill|Heading)$/;
        let n=0;
        for(const key of Object.keys(formEn)){
          const text=formEn[key],extra=Math.ceil(text.length*0.4);
          const filler=' lorem ipsum dolor sit amet consectetur adipiscing'.repeat(3).slice(0,extra).trimEnd();
          words[key]=text+' '+filler+(!limited.test(key)&&(n++%3===0)?' Arbeitsbereichsverwaltungsberechtigung':'');
        }
      }
      const Page=base?BasePage:NowPage,Intake=base?BaseIntake:NowIntake;
      const submit=async(id,brief)=>{window.privateSubmitted=(window.privateSubmitted||0)+1;window.privateBody=JSON.stringify({id,brief})};
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={offered} pageLocales={languagesWithPages({CORRIDRA_LANGUAGES_PAGES:q.get('pages')||''})}>
          <div className="site-shell">
            <SiteHeader accounts={false}/>
            {q.get('dock')==='1'?<CornerDock/>:null}
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
    splitting: true,
    charset: 'utf8',
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
  for (const file of result.outputFiles)
    if (file.path.endsWith('.js'))
      chunks.set(file.path.slice(file.path.lastIndexOf('/') + 1), file.text);
  bundle = chunks.get('stdin.js')!;
  germanChunk = [...chunks].find(([, text]) => text.includes(de['form.notice.englishParts']))![0];
  expect(
    [...chunks.values()].filter((text) => text.includes(de['form.notice.englishParts'])),
  ).toHaveLength(1);
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
    if (chunks.has(path.slice(1)) && path !== '/stdin.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(chunks.get(path.slice(1)));
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
  server.closeAllConnections();
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
async function walk(
  page: Page,
  mode: 'sample' | 'real' | 'private',
  check: (state: string) => Promise<void> = async () => {},
) {
  const look = async (name: string) => {
    const state = await capture(page, name);
    await check(name);
    return state;
  };
  const states = [await look('step 1')];
  const form = page.locator('form.intake-form');
  const next = form.locator('.guide-actions .primary-link');
  const heading = form.locator('h2');
  const go = async (name: string) => {
    const before = await heading.textContent();
    await next.click();
    await expect(heading).not.toHaveText(before ?? '');
    states.push(await look(name));
  };
  await next.click();
  await expect(page.locator('.ux-error-summary')).toBeVisible();
  states.push(await look('step 1 errors'));
  await form.locator('select').first().selectOption('machinery_procurement');
  await go('step 2');
  await next.click();
  await expect(page.locator('.ux-error-summary')).toBeVisible();
  states.push(await look('step 2 errors'));
  await form.locator('select').nth(0).selectOption('DE');
  await form.locator('select').nth(1).selectOption('US');
  await form.locator('input[name="attendance"]').first().check();
  await form.locator('#brief-startDate').fill('2026-12-01');
  await form.locator('#brief-endDate').fill('2026-12-03');
  states.push(await look('step 2 filled'));
  await go('step 3');
  await form.locator('textarea').first().fill('Packaging machines for a towel factory line.');
  await form.locator('details summary').click();
  await form.locator('#brief-budgetAmount').fill('12.345');
  await form.locator('details select').selectOption('CNY');
  await next.click();
  await expect(page.locator('.ux-error-summary')).toBeVisible();
  states.push(await look('step 3 amount error'));
  await form.locator('#brief-budgetAmount').fill('12.30');
  await form.locator('#brief-budgetBasis').fill('Total equipment budget');
  await go('step 4');
  await next.click();
  await expect(page.locator('.ux-error-summary')).toBeVisible();
  states.push(await look('step 4 errors'));
  await form.locator('input[type="checkbox"]').first().check();
  await go('step 5');
  await next.click();
  await expect(page.locator('.ux-error-summary')).toBeVisible();
  states.push(await look('step 5 errors'));
  await form.locator('#brief-name').fill('Sample Person');
  await form.locator('#brief-company').fill('Sample Company');
  await form
    .locator('#brief-email')
    .fill(mode === 'real' ? 'person@company.test' : 'person@example.invalid');
  await form.locator('label.choice input[type="checkbox"]').check();
  if (mode === 'real') await form.locator('input[type="password"]').fill('a long sample password');
  states.push(await look('step 5 filled'));
  await next.click();
  if (mode === 'sample') {
    await expect(page.locator('.receipt-panel input[readonly]')).toHaveValue(
      'CRDR-FIXTURE-RECEIPT-0001',
    );
    states.push(await look('receipt'));
    await page.locator('#receipt-check button.primary-link').click();
    await expect(page.locator('#receipt-check .detail-card')).toBeVisible();
    states.push(await look('receipt checked'));
  } else if (mode === 'real') {
    await expect(page.locator('#pending-request-title')).toBeVisible();
    states.push(await look('saved request'));
  } else {
    await expect
      .poll(() => page.evaluate(() => (window as { privateSubmitted?: number }).privateSubmitted))
      .toBe(1);
    states.push(await look('submitted'));
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

// With the form released (step 3 of the build): the drafts, loaded on demand, in the real frame.
type FormLanguage = Exclude<Locale, 'en'>;
const drafts: Record<FormLanguage, FormCatalog> = { bn, zh, es, ar, fr, de };
const draftCodes = Object.keys(drafts) as FormLanguage[];
const titles: FormKey[] = [
  'form.step.titleGoal',
  'form.step.titleWhere',
  'form.step.titleDetails',
  'form.step.titleResults',
  'form.step.titleContact',
];
const stepWords: FormKey[] = [
  'form.step.goal',
  'form.step.where',
  'form.step.details',
  'form.step.results',
  'form.step.contact',
];

async function openTranslated(page: Page, code: FormLanguage, query: string) {
  await open(page, code, query);
  await expect(page.locator('#main')).toHaveAttribute('lang', localeMeta[code].html);
  await expect(page.locator('form.intake-form .guide-actions .primary-link')).toHaveText(
    drafts[code]['form.action.continue'],
  );
}

/** Picks a language with the real language chip in the header. */
async function chooseLanguage(page: Page, code: Locale) {
  await page
    .locator('details:has(button[lang]) > summary')
    .filter({ visible: true })
    .first()
    .click();
  await page
    .locator(`details[open] button[lang="${localeMeta[code].html}"]`)
    .filter({ visible: true })
    .first()
    .click();
}

/** English form words still on screen outside the parts that stay English (should be none). */
async function englishLeft(page: Page, code: FormLanguage) {
  const english = (Object.keys(formEn) as FormKey[])
    .filter((key) => drafts[code][key] !== formEn[key])
    .map((key) => formEn[key].split(/\{\w+\}/)[0])
    .filter((text) => text.length >= 12);
  return page.locator('#main').evaluate((main, list) => {
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[lang="en"], .guide-bn, .mr-fq').forEach((el) => el.remove());
    const text = clone.textContent ?? '';
    return list.filter((words) => text.includes(words));
  }, english);
}

/** What does not fit: anything past the page edges, sideways scroll, and controls under 44 px up to 768 px. */
async function layoutProblems(page: Page, width: number) {
  return page.evaluate((viewport) => {
    const edge = document.documentElement.clientWidth;
    const problems = Array.from(document.querySelectorAll('#main *'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && (box.right > edge + 0.5 || box.left < -0.5);
      })
      .map(
        (el) =>
          `outside: ${el.tagName.toLowerCase()}.${el.className} ${el.textContent?.slice(0, 50)}`,
      );
    if (document.documentElement.scrollWidth > edge) problems.push('sideways scroll');
    if (viewport <= 768)
      for (const el of Array.from(
        document.querySelectorAll(
          '#main :is(button, select, textarea, summary, label.choice, input:not([type=checkbox]):not([type=radio]))',
        ),
      )) {
        const box = el.getBoundingClientRect();
        if (box.width > 0 && !el.matches('.text-link') && box.height < 43.5)
          problems.push(`small target ${Math.round(box.height)}: ${el.textContent?.slice(0, 40)}`);
      }
    return problems;
  }, width);
}

test.describe('with the form released', () => {
  for (const code of draftCodes)
    test(`${code}: every step, the receipt and the receipt check read in that language, and English parts say so`, async ({
      page,
    }) => {
      const words = drafts[code];
      await openTranslated(page, code, 'form=true&fq=1');
      const form = page.locator('form.intake-form');
      await expect(page.locator('#main')).toHaveAttribute('dir', localeMeta[code].dir);
      await expect(page.locator('h1')).toHaveText(words['form.head.title']);
      // The first question keeps its own language and words.
      await expect(page.locator('.mr-fq')).toHaveAttribute('lang', localeMeta[code].html);
      await expect(page.locator('.mr-fq-legend')).toHaveText(translate(code, 'fq.legend'));
      await expect(page.locator('.guide-journey-bar b')).toHaveText(
        stepWords.map((key) => words[key]),
      );
      await expect(page.locator('.guide-journey-bar')).toHaveAttribute(
        'aria-label',
        words['form.step.journey'],
      );
      await expect(
        page.locator('.intake-notice .lang-island[lang="en"][dir="ltr"] a[href="/privacy"]'),
      ).toHaveText('Read the test intake notice');
      await expect(page.locator('.intake-notice > p').last()).toHaveText(
        words['form.notice.englishParts'],
      );
      await expect(page.locator('.guide-draft-line span[lang="en"][dir="ltr"]')).toHaveText(
        'Drafts stay in this tab for 24 hours.',
      );
      await expect(page.locator('.guide-bn')).toHaveAttribute('lang', 'bn');
      await walk(page, 'sample', async (state) => {
        expect(await englishLeft(page, code), `${code} ${state}`).toEqual([]);
        if (state === 'receipt')
          await expect(page.locator('.guide-status span[lang="en"]')).toHaveText(
            'No real customer mission has been accepted.',
          );
        const step = Number(state.match(/^step (\d)/)?.[1] ?? 0);
        if (!step) return;
        await expect(form.locator('h2')).toHaveText(words[titles[step - 1]]);
        await expect(form.locator('> p.label')).toHaveText(
          fill(words['form.step.counter'], { step, total: '5' }),
        );
        if (state.endsWith('errors'))
          await expect(page.locator('.ux-error-summary strong')).toHaveText(
            words['form.summary.title'],
          );
        if (step === 5) {
          await expect(form.locator('label.choice')).toHaveAttribute('lang', 'en');
          await expect(form.locator('#brief-email')).toHaveAttribute('dir', 'ltr');
          await expect(form.locator('#brief-name')).toHaveAttribute('dir', 'auto');
        }
      });
      await expect(page.locator('#plan-receipt-title')).toHaveText(words['form.receipt.title']);
      await expect(page.locator('.receipt-panel .lang-island[lang="en"]')).toHaveText(
        'Anyone with this code can read the mission status and replies. It expires after 30 days.',
      );
      await expect(page.locator('#receipt-check h2')).toHaveText(words['form.check.sampleTitle']);
      await expect(page.locator('#receipt-check strong[lang="en"]')).toHaveText('UNDER REVIEW');
      await expect(page.locator('#receipt-check .detail-card p')).toHaveAttribute('dir', 'auto');
      await expect(page.locator('#receipt-check .detail-card p')).toHaveText('Sample reply body.');
    });

  test('a list releases only those languages: French chosen stays English while its first question is French', async ({
    page,
  }) => {
    await openTranslated(page, 'es', 'form=es,de&fq=1');
    await expect(page.locator('h1')).toHaveText(es['form.head.title']);
    const french = await page.context().newPage();
    await open(french, 'fr', 'form=es,de&fq=1');
    await expect(french.locator('#main')).toHaveAttribute('lang', 'en');
    await expect(french.locator('h1')).toHaveText(formEn['form.head.title']);
    await expect(french.locator('.mr-fq')).toHaveAttribute('lang', 'fr');
    await expect(french.locator('.mr-fq-legend')).toHaveText(translate('fr', 'fq.legend'));
  });

  for (const form of ['', 'true', 'es,de'])
    test(`the first question follows the chosen language with the form switch ${form || 'unset'}`, async ({
      page,
    }) => {
      await open(page, 'fr', `form=${form}&fq=1`);
      await expect(page.locator('.mr-fq')).toHaveAttribute('lang', 'fr');
      await expect(page.locator('.mr-fq-legend')).toHaveText(translate('fr', 'fq.legend'));
      await expect(page.locator('#main')).toHaveAttribute('lang', form === 'true' ? 'fr' : 'en');
    });

  test('the home page release never translates the form', async ({ page }) => {
    await open(page, 'de', 'pages=true');
    await expect(page.locator('#main')).toHaveAttribute('lang', 'en');
    await expect(page.locator('h1')).toHaveText(formEn['form.head.title']);
    await expect(page.locator('form.intake-form .guide-actions .primary-link')).toHaveText(
      formEn['form.action.continue'],
    );
  });

  test('the signed-in request form stays English with every language released', async ({
    page,
  }) => {
    await open(page, 'de', 'mode=private&form=true');
    await expect(page.locator('#main')).toHaveAttribute('lang', 'en');
    await expect(page.locator('form.intake-form h2')).toHaveText(formEn['form.step.titleGoal']);
    // No language or direction is added anywhere inside: only the Bangla guide says its own language.
    await expect(page.locator('#main [lang]')).toHaveCount(1);
    await expect(page.locator('#main .guide-bn')).toHaveAttribute('lang', 'bn');
    await expect(page.locator('#main [dir]')).toHaveCount(0);
  });

  test('a released language the language chip does not offer is never shown', async ({ page }) => {
    await open(page, 'ar', 'reviewed=de&form=true');
    await expect(page.locator('#main')).toHaveAttribute('lang', 'en');
    await expect(page.locator('h1')).toHaveText(formEn['form.head.title']);
    const german = await page.context().newPage();
    await openTranslated(german, 'de', 'reviewed=de&form=true');
    await expect(german.locator('h1')).toHaveText(de['form.head.title']);
  });

  test('if the words file cannot be fetched the form stays English and works, and a reload tries again', async ({
    page,
  }) => {
    await page.route(`**/${germanChunk}`, (route) => route.abort());
    const failed = page.waitForEvent('requestfailed', (request) =>
      request.url().endsWith(germanChunk),
    );
    await open(page, 'de', 'form=true');
    await failed;
    await expect(page.locator('#main')).toHaveAttribute('lang', 'en');
    await expect(page.locator('h1')).toHaveText(formEn['form.head.title']);
    await page.locator('form.intake-form .guide-actions .primary-link').click();
    await expect(page.locator('.ux-error-summary strong')).toHaveText(formEn['form.summary.title']);
    // Another released language still loads; the browser keeps a failed module fetch for the life of the page.
    await chooseLanguage(page, 'fr');
    await expect(page.locator('#main')).toHaveAttribute('lang', 'fr');
    await page.unroute(`**/${germanChunk}`);
    await chooseLanguage(page, 'de');
    await page.reload();
    await expect(page.locator('#main')).toHaveAttribute('lang', 'de');
    await expect(page.locator('h1')).toHaveText(de['form.head.title']);
  });

  test('changing language mid-form keeps the step, the answers and the errors, and sends the same request', async ({
    browser,
  }) => {
    const sent = async (switching: boolean) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(() => {
        crypto.randomUUID = () => '00000000-0000-4000-8000-000000000001';
      });
      const bodies: string[] = [];
      if (switching) await openTranslated(page, 'de', 'form=true');
      else await open(page, 'en', 'form=true');
      await page.route('**/api/intake', (route) => {
        bodies.push(route.request().postData() ?? '');
        return route.fulfill({ status: 201, json: { receipt: 'CRDR-FIXTURE-RECEIPT-0001' } });
      });
      const form = page.locator('form.intake-form');
      await walk(page, 'sample', async (state) => {
        if (!switching || state !== 'step 3 amount error') return;
        for (const code of ['ar', 'en'] as const) {
          await chooseLanguage(page, code);
          await expect(page.locator('#main')).toHaveAttribute('lang', code);
          await expect(form.locator('h2')).toHaveText(
            code === 'en' ? formEn['form.step.titleDetails'] : ar['form.step.titleDetails'],
          );
          await expect(form.locator('textarea').first()).toHaveValue(
            'Packaging machines for a towel factory line.',
          );
          await expect(form.locator('#brief-budgetAmount')).toHaveValue('12.345');
          await expect(page.locator('.ux-error-summary')).toBeVisible();
        }
      });
      await context.close();
      expect(bodies).toHaveLength(1);
      return bodies[0];
    };
    const english = await sent(false);
    expect(JSON.parse(english).brief.market).toBe('United States');
    expect(await sent(true)).toBe(english);
  });

  test('a reload resumes the draft in the chosen language', async ({ page }) => {
    await openTranslated(page, 'de', 'form=true');
    const form = page.locator('form.intake-form');
    await form.locator('select').first().selectOption('machinery_procurement');
    await form.locator('.guide-actions .primary-link').click();
    await expect(form.locator('h2')).toHaveText(de['form.step.titleWhere']);
    await form.locator('select').first().selectOption('DE');
    await page.reload();
    await expect(page.locator('#main')).toHaveAttribute('lang', 'de');
    await expect(page.locator('.ux-draft-notice')).toHaveText(de['form.message.draftResumed']);
    await expect(form.locator('h2')).toHaveText(de['form.step.titleWhere']);
    await expect(form.locator('select').first()).toHaveValue('DE');
  });

  test('a draft that cannot be restored, resumed or saved says so in the chosen language', async ({
    browser,
  }) => {
    const contexts: BrowserContext[] = [];
    const page = async (setup: () => void) => {
      const context = await browser.newContext();
      contexts.push(context);
      const tab = await context.newPage();
      await tab.addInitScript(setup);
      await openTranslated(tab, 'de', 'form=true');
      return tab;
    };
    const broken = await page(() => sessionStorage.setItem('corridra-mission-draft', '{broken'));
    await expect(broken.locator('.ux-draft-notice')).toHaveText(de['form.message.draftLostSample']);
    const expired = await page(() =>
      sessionStorage.setItem(
        'corridra-mission-draft',
        JSON.stringify({
          version: 2,
          draft: { offer: '', outcomes: [] },
          step: 1,
          key: 'k',
          at: 0,
        }),
      ),
    );
    const notice = expired.locator('.ux-draft-notice');
    await expect(notice).toContainText(de['form.message.draftNotResumed']);
    await expect(notice.locator('span[lang="en"]')).toHaveText('Drafts expire after 24 hours.');
    const blocked = await page(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (this === sessionStorage) throw new Error('Storage is blocked');
        setItem.call(this, key, value);
      };
    });
    await blocked.locator('form.intake-form select').first().selectOption('buyers');
    await expect(blocked.locator('.ux-draft-notice')).toHaveText(
      de['form.message.draftUnsavedSample'],
    );
    for (const context of contexts) await context.close();
  });

  for (const width of [320, 390, 768, 1440])
    for (const code of localeCodes)
      test(`${code}: fits at ${width} with no sideways scroll, 44 px targets and no accessibility violation`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        if (code === 'en') await open(page, 'en', 'form=true');
        else await openTranslated(page, code, 'form=true');
        await page.evaluate(() => document.fonts.ready);
        const scanned = new Set([
          'step 1',
          'step 3 amount error',
          'step 5 errors',
          'receipt checked',
        ]);
        await walk(page, 'sample', async (state) => {
          expect(await layoutProblems(page, width), `${code} ${width} ${state}`).toEqual([]);
          if (!scanned.has(state)) return;
          const results = await new AxeBuilder({ page }).include('#main').analyze();
          expect(
            results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`),
            `${code} ${width} ${state}`,
          ).toEqual([]);
        });
      });

  for (const width of [320, 390, 768, 1440])
    test(`pseudo-language form words 40 percent longer than English fit at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, 'de', 'form=true&pseudo=1');
      await expect(page.locator('#main')).toHaveAttribute('lang', 'de');
      await expect(page.locator('h1')).toContainText('lorem');
      expect((await page.locator('h1').textContent())!.length).toBeGreaterThan(
        formEn['form.head.title'].length * 1.4,
      );
      await walk(page, 'sample', async (state) => {
        expect(await layoutProblems(page, width), `${width} ${state}`).toEqual([]);
      });
    });

  test('de at 390: by keyboard focus lands on the summary and on each step heading, and 200 percent text still fits', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTranslated(page, 'de', 'form=true');
    const form = page.locator('form.intake-form');
    const next = form.locator('.guide-actions .primary-link');
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ux-error-summary')).toBeFocused();
    await expect(page.locator('.ux-error-summary strong')).toHaveText(de['form.summary.title']);
    await form.locator('select').first().selectOption('machinery_procurement');
    for (const [index, key] of titles.slice(1, 3).entries()) {
      await next.focus();
      await page.keyboard.press('Enter');
      if (index === 0) {
        await expect(form.locator('h2')).toBeFocused();
        await expect(form.locator('h2')).toHaveText(de[key]);
        await form.locator('select').nth(0).selectOption('DE');
        await form.locator('select').nth(1).selectOption('US');
      } else {
        await expect(form.locator('h2')).toBeFocused();
        await expect(form.locator('h2')).toHaveText(de[key]);
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await form.locator('details summary').click();
    expect(await layoutProblems(page, 1440)).toEqual([]);
  });

  for (const code of ['bn', 'ar'] as const)
    test(`${code}: translated labels and headings are not letter-spaced`, async ({ page }) => {
      await openTranslated(page, code, 'form=true');
      const spacing = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#main :is(.label, .guide-pill, h1, h2, legend)'))
          .filter((el) => !el.closest('[lang="en"]'))
          .map((el) => getComputedStyle(el).letterSpacing),
      );
      expect(spacing.length).toBeGreaterThan(3);
      for (const value of spacing) expect(['normal', '0px']).toContain(value);
    });

  test('ar: right to left, the journey connectors clear the step dots and the main button sits at the inline end', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await openTranslated(page, 'ar', 'form=true');
    const form = page.locator('form.intake-form');
    await expect(page.locator('#main')).toHaveAttribute('dir', 'rtl');
    await form.locator('select').first().selectOption('buyers');
    await form.locator('.guide-actions .primary-link').click();
    await expect(form.locator('h2')).toHaveText(ar['form.step.titleWhere']);
    const connector = await page
      .locator('.guide-journey-bar li')
      .first()
      .evaluate((li) => {
        const after = getComputedStyle(li, '::after');
        return { left: after.left, right: after.right };
      });
    expect(connector).toEqual({ left: '8px', right: '40px' });
    const primary = (await form.locator('.guide-actions .primary-link').boundingBox())!;
    const back = (await form.locator('.guide-actions .button-secondary').boundingBox())!;
    expect(primary.x).toBeLessThan(back.x);
    const actions = (await form.locator('.guide-actions').boundingBox())!;
    expect(Math.abs(primary.x - actions.x)).toBeLessThanOrEqual(1);
    const transforms = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#main svg')).map(
        (svg) => getComputedStyle(svg).transform,
      ),
    );
    for (const transform of transforms) expect(transform).toBe('none');
  });

  test('Listen reads the form in its language, and is hidden where the browser has no voice for it', async ({
    browser,
  }) => {
    const contexts: BrowserContext[] = [];
    const tab = async (voices: string[], code: Locale, query: string) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.addInitScript((langs) => {
        window.speechSynthesis.getVoices = () =>
          langs.map((lang) => ({ lang, name: lang }) as SpeechSynthesisVoice);
        window.speechSynthesis.speak = (utterance) => {
          (window as unknown as { spoken: string }).spoken = utterance.lang;
        };
      }, voices);
      if (code === 'en' || !query.includes('form=true')) await open(page, code, query);
      else await openTranslated(page, code, query);
      return page;
    };
    const listen = (page: Page) => page.getByRole('button', { name: 'Listen to this page' });
    const arabic = await tab(['en-US'], 'ar', 'form=true&dock=1');
    await expect(listen(arabic)).toHaveCount(0);
    const englishForm = await tab(['en-US'], 'ar', 'dock=1');
    await expect(englishForm.locator('#main')).toHaveAttribute('lang', 'en');
    await expect(listen(englishForm)).toBeVisible();
    const german = await tab(['en-US', 'de-DE'], 'de', 'form=true&dock=1');
    await listen(german).click();
    await expect
      .poll(() => german.evaluate(() => (window as unknown as { spoken?: string }).spoken))
      .toBe('de');
    for (const context of contexts) await context.close();
  });
});

/** Fills every step with valid answers (a buyer search, Bangladesh to China) up to the send button. */
async function complete(page: Page, mode: 'sample' | 'real' = 'sample') {
  const form = page.locator('form.intake-form');
  const next = form.locator('.guide-actions .primary-link');
  const step = async () => {
    const before = await form.locator('h2').textContent();
    await next.click();
    await expect(form.locator('h2')).not.toHaveText(before ?? '');
  };
  await form.locator('select').first().selectOption('buyers');
  await step();
  await form.locator('select').nth(0).selectOption('BD');
  await form.locator('select').nth(1).selectOption('CN');
  await step();
  await form.locator('textarea').first().fill('Hotel towels for hospitality distributors.');
  await step();
  await form.locator('input[type="checkbox"]').first().check();
  await step();
  await form.locator('#brief-name').fill('Sample Person');
  await form.locator('#brief-company').fill('Sample Company');
  await form
    .locator('#brief-email')
    .fill(mode === 'real' ? 'person@company.test' : 'person@example.invalid');
  await form.locator('label.choice input[type="checkbox"]').check();
  if (mode === 'real') await form.locator('input[type="password"]').fill('a long sample password');
  return next;
}

/** Answers POST /api/intake with each reply in turn, keeping every body sent. */
async function replyInTurn(page: Page, replies: { status: number; json: object }[]) {
  const bodies: string[] = [];
  await page.route('**/api/intake', (route) => {
    bodies.push(route.request().postData() ?? '');
    return route.fulfill(replies[Math.min(bodies.length, replies.length) - 1]);
  });
  return bodies;
}

const fixedKey = () => {
  crypto.randomUUID = () => '00000000-0000-4000-8000-000000000002';
};

test.describe('messages in the chosen language', () => {
  for (const code of ['de', 'ar'] as const)
    test(`${code}: field errors, the focused summary and server replies are translated; unknown and consent messages stay English and say so`, async ({
      page,
    }) => {
      const words = drafts[code];
      await openTranslated(page, code, 'form=true');
      const form = page.locator('form.intake-form');
      const next = form.locator('.guide-actions .primary-link');
      const heading = form.locator('h2');
      const step = async () => {
        const before = await heading.textContent();
        await next.click();
        await expect(heading).not.toHaveText(before ?? '');
      };
      await next.click();
      await expect(page.locator('.ux-error-summary')).toBeFocused();
      await expect(page.locator('#objective-error')).toHaveText(
        words['form.message.chooseObjective'],
      );
      await expect(page.locator('#job-error')).toHaveText(words['form.message.chooseJob']);
      await form.locator('select').first().selectOption('machinery_procurement');
      await step();
      await next.click();
      await expect(page.locator('#companyCountry-error')).toHaveText(
        words['form.message.chooseCountry'],
      );
      await form.locator('select').nth(0).selectOption('DE');
      await form.locator('select').nth(1).selectOption('US');
      await form.locator('input[name="attendance"]').first().check();
      await form.locator('#brief-startDate').fill('2026-12-03');
      await form.locator('#brief-endDate').fill('2026-12-01');
      await form.locator('#brief-timezone').fill('Mars/Base');
      await next.click();
      await expect(page.locator('#endDate-error')).toHaveText(words['form.message.endAfterStart']);
      await expect(page.locator('#timezone-error')).toHaveText(words['form.message.timezone']);
      await form.locator('#brief-endDate').fill('2026-12-05');
      await form.locator('#brief-timezone').fill('UTC');
      await step();
      // A schema message, and the amount reader's message with its code and places.
      await form.locator('textarea').first().fill('short');
      await form.locator('details summary').click();
      await form.locator('#brief-budgetAmount').fill('12.345');
      await form.locator('details select').selectOption('CNY');
      await form.locator('#brief-budgetBasis').fill('Total equipment budget');
      await next.click();
      await expect(page.locator('#offer-error')).toHaveText(words['form.message.offerShort']);
      await expect(page.locator('#requirements-error')).toHaveText(
        fill(words['form.message.decimals'], { code: 'CNY', places: '2' }),
      );
      await form.locator('textarea').first().fill('Packaging machines for a towel factory line.');
      await form.locator('#brief-budgetAmount').fill('12.30');
      await step();
      await form.locator('input[type="checkbox"]').first().check();
      await step();
      // The schema library's own words, and the consent error led by the translated instruction.
      await form.locator('#brief-name').fill('Sample Person');
      await form.locator('#brief-company').fill('Sample Company');
      await form.locator('#brief-email').fill('nope');
      await next.click();
      await expect(page.locator('#email-error')).toHaveText(words['form.message.email']);
      const consent = page.locator('#acknowledged-error');
      await expect(consent).toContainText(words['form.message.consentLead']);
      await expect(consent.locator('span[lang="en"][dir="ltr"]')).toHaveText(
        'Read and acknowledge the test intake notice',
      );
      await form.locator('#brief-email').fill('person@example.invalid');
      await form.locator('label.choice input[type="checkbox"]').check();
      // Server replies: one it knows, then one it does not.
      await replyInTurn(page, [
        { status: 429, json: { error: 'Too many requests. Try again in an hour.' } },
        { status: 500, json: { error: 'Synthetic transport interruption' } },
      ]);
      const status = page.locator('.guide-status');
      await next.click();
      await expect(status).toHaveText(words['form.message.tooMany']);
      await next.click();
      await expect(status).toContainText(words['form.message.untranslated']);
      await expect(status.locator('span[lang="en"][dir="ltr"]')).toHaveText(
        'Synthetic transport interruption',
      );
    });

  test('de: a failed submit says so in German, and the retry with the same key succeeds', async ({
    page,
  }) => {
    await page.addInitScript(fixedKey);
    await openTranslated(page, 'de', 'form=true');
    const bodies = await replyInTurn(page, [
      { status: 500, json: { error: 'Intake could not be saved. Your input is still here.' } },
      { status: 201, json: { receipt: 'CRDR-FIXTURE-RECEIPT-0001' } },
    ]);
    const send = await complete(page);
    await send.click();
    await expect(page.locator('.guide-status')).toHaveText(de['form.message.intakeNotSaved']);
    await expect(page.locator('#brief-name')).toHaveValue('Sample Person');
    await send.click();
    await expect(page.locator('#plan-receipt-title')).toHaveText(de['form.receipt.title']);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0]).key).toBe('00000000-0000-4000-8000-000000000002');
  });

  test('with no connection the form says so in the chosen language, and English keeps the browser words', async ({
    browser,
  }) => {
    for (const code of ['en', 'de'] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      if (code === 'en') await open(page, 'en', 'form=true');
      else await openTranslated(page, code, 'form=true');
      await page.route('**/api/intake', (route) => route.abort('internetdisconnected'));
      await (await complete(page)).click();
      await expect(page.locator('.guide-status')).toHaveText(
        code === 'en' ? formEn['form.message.offline'] : de['form.message.offline'],
      );
      await context.close();
    }
  });
});

test.describe('the request sent is the same in every language', () => {
  for (const code of ['de', 'ar'] as const)
    test(`${code}: the request body equals the PR 214 form's for the same answers`, async ({
      browser,
    }) => {
      const sent = async (query: string, translated: boolean) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.addInitScript(fixedKey);
        if (translated) await openTranslated(page, code, query);
        else await open(page, code, query);
        const bodies = await replyInTurn(page, [
          { status: 201, json: { receipt: 'CRDR-FIXTURE-RECEIPT-0001' } },
        ]);
        await walk(page, 'sample');
        await context.close();
        expect(bodies).toHaveLength(1);
        return bodies[0];
      };
      const before = await sent('view=base', false);
      expect(await sent('form=true', true)).toBe(before);
    });

  test('the signed-in form sends the same request with German or Arabic chosen and every language released', async ({
    browser,
  }) => {
    const sent = async (code: Locale) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(fixedKey);
      await open(page, code, 'mode=private&form=true');
      await walk(page, 'private');
      const body = await page.evaluate(() => (window as { privateBody?: string }).privateBody);
      await context.close();
      return body;
    };
    const english = await sent('en');
    expect(english).toContain('"market":"United States"');
    expect(await sent('de')).toBe(english);
    expect(await sent('ar')).toBe(english);
  });
});
