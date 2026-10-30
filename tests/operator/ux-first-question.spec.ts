import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { localeMeta } from '../../apps/web/lib/i18n/locales';
import { translate } from '../../apps/web/lib/i18n/messages';
import { mkdirSync } from 'node:fs';

// The first question and the single Sample label (Lane 6 of the UX update), mounted the way the other
// operator specs mount their screens: the real intake, the real header and the real stylesheets in a
// small page. What is proved is what a person sees and can do: five pictures that choose a start,
// every job type still selectable, the original radios unchanged with the switch off, one visible mode
// label, and the layout on a phone. Nothing is submitted.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
let css = '';
let fontClass = '';

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{SiteHeader}from ${JSON.stringify(resolve('apps/web/components/site-header.tsx'))};
      import{offeredLanguages}from ${JSON.stringify(resolve('apps/web/lib/i18n/locales.ts'))};
      import{languagesWithPages}from ${JSON.stringify(resolve('apps/web/lib/i18n/pages.ts'))};
      import{Intake}from ${JSON.stringify(resolve('apps/web/app/plan/intake.tsx'))};
      const q=new URLSearchParams(location.search);
      const mode=q.get('mode')||undefined;
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={offeredLanguages({CORRIDRA_LANGUAGES_REVIEWED:q.get('reviewed')||''})} pageLocales={languagesWithPages({CORRIDRA_LANGUAGES_PAGES:q.get('pages')||''})}>
          <div className="site-shell">
            <SiteHeader accounts={false} mode={mode}/>
            <main id="main" lang="en" dir="ltr" className="ux-intake-page"><section className="guide-plan">
              <header className="guide-plan-head"><p className="label">PLAN A MISSION</p><h1>What do you want to do?</h1></header>
              <Intake firstQuestion={q.get('fq')==='1'}/>
            </section></main>
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
                : 'const router={replace:()=>{},refresh:()=>{},push:()=>{}};export function useRouter(){return router}',
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
      `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plan fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>`,
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

const open = async (page: Page, query = '') => {
  await page.goto(`${origin}/?${query}`);
  await expect(
    page.getByRole('heading', { name: 'What are you trying to achieve?' }),
  ).toBeVisible();
};
const job = (page: Page) => page.getByLabel('Commercial job');

test('with the switch off the original six radios and the job list are exactly there', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole('radio')).toHaveCount(6);
  await expect(page.getByRole('radio', { name: 'Source suppliers' })).toBeVisible();
  await expect(page.locator('.mr-fq')).toHaveCount(0);
  await expect(job(page).locator('option')).toHaveCount(16);
});

test('shows five pictures that choose a start, and keeps every job type selectable', async ({
  page,
}) => {
  await open(page, 'fq=1');
  await expect(page.locator('.mr-fq input[type="radio"]')).toHaveCount(5);
  await expect(page.getByRole('radio', { name: /Source suppliers/ })).toHaveCount(0);
  await page.getByRole('radio', { name: /Buy a machine/ }).check();
  await expect(job(page)).toHaveValue('machinery_procurement');
  await page.getByRole('radio', { name: /Sell abroad/ }).check();
  await expect(job(page)).toHaveValue('buyers');
  await page.getByRole('radio', { name: /Lead a group trip/ }).check();
  await expect(job(page)).toHaveValue('delegations');
  await page.getByRole('radio', { name: /Trips, visits or fairs/ }).check();
  await expect(page.getByRole('radio', { name: /Trips, visits or fairs/ })).toBeChecked();
  // This picture has no default job: the person chooses one, and nothing is filled in for them.
  await expect(job(page)).toHaveValue('');
  await job(page).selectOption('factory_visits');
  await expect(page.getByRole('radio', { name: /Trips, visits or fairs/ })).toBeChecked();
  // Choosing the picture again keeps the job the person chose.
  await page.getByRole('radio', { name: /Trips, visits or fairs/ }).check();
  await expect(job(page)).toHaveValue('factory_visits');
  // Every one of the fifteen jobs, plus the prompt, is still there.
  await expect(job(page).locator('option')).toHaveCount(16);
});

test('choosing a job from the list moves the picture to the one that opens it', async ({
  page,
}) => {
  await open(page, 'fq=1');
  await job(page).selectOption('distributors');
  await expect(page.getByRole('radio', { name: /Sell abroad/ })).toBeChecked();
  await job(page).selectOption('supplier_evaluation');
  await expect(page.getByRole('radio', { name: /Buy products/ })).toBeChecked();
  await job(page).selectOption('business_trips');
  await expect(page.getByRole('radio', { name: /Trips, visits or fairs/ })).toBeChecked();
});

test('a link that names a job (the home cards) opens with its picture chosen', async ({ page }) => {
  await open(page, 'fq=1&job=sourcing');
  await expect(page.getByRole('radio', { name: /Buy products/ })).toBeChecked();
  await page.goto(`${origin}/?fq=1&job=delegations`);
  await expect(page.getByRole('radio', { name: /Lead a group trip/ })).toBeChecked();
});

test('works with the keyboard and moves on to the next step', async ({ page }) => {
  await open(page, 'fq=1');
  await page.getByRole('radio', { name: /Buy products/ }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: /Buy a machine/ })).toBeChecked();
  await page
    .getByRole('button', { name: /Continue|Next/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Where?' })).toBeVisible();
});

test('shows one Sample label and the start button keeps a plain name', async ({ page }) => {
  await open(page, 'fq=1&mode=sample');
  await expect(page.locator('.mr-mode')).toHaveCount(1);
  await expect(page.locator('.mr-mode')).toHaveText('Sample');
  await expect(page.getByRole('link', { name: 'Start a request', exact: true })).toBeVisible();
  await open(page, 'fq=1&mode=real');
  await expect(page.locator('.mr-mode')).toHaveText('Real');
  await open(page);
  await expect(page.locator('.mr-mode')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Start a request (sample request)' })).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide: no sideways scroll, 44 pixel targets, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, 'fq=1&mode=sample');
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() =>
        Array.from(document.fonts as FontFaceSet & Iterable<FontFace>).some(
          (f) => f.status === 'loaded',
        ),
      ),
    ).toBe(true);
    const wide = await page.evaluate((limit) => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('header, main, main *, header *'))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > limit + 1)
          out.push(
            `${el.tagName.toLowerCase()}.${(el as HTMLElement).className} ${Math.round(r.right)}`,
          );
      }
      return out.slice(0, 6);
    }, width);
    expect(wide, `at ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.mr-fq-card, .mr-mode'))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => el.classList.contains('mr-fq-card'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.height < 43.5 || r.width < 43.5)
        .map(({ el }) => (el.textContent || '').trim().slice(0, 30)),
    );
    expect(small, `at ${width}`).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations, `axe at ${width}`).toEqual([]);
    if (process.env.UX_SHOTS_DIR)
      await page.screenshot({
        path: `${process.env.UX_SHOTS_DIR}/first-question-${width}.png`,
        fullPage: true,
      });
  });
}

for (const code of ['bn', 'zh', 'es', 'ar', 'fr', 'de'] as const) {
  for (const width of [320, 390, 768, 1440]) {
    test(`${code}: translated trips entry at ${width}, with its original value and no page overflow`, async ({
      page,
    }) => {
      await page.addInitScript((value) => localStorage.setItem('corridra.language', value), code);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`${origin}/?fq=1&reviewed=bn,zh,es,ar,fr,de`);
      const group = page.locator('.mr-fq');
      await expect(group).toHaveAttribute('lang', localeMeta[code].html);
      await expect(group).toHaveAttribute('dir', localeMeta[code].dir);
      const card = group
        .locator('label')
        .filter({ has: page.locator('input[value="something-else"]') });
      await expect(card.locator('b')).toHaveText(translate(code, 'fq.visits.label'));
      await expect(card.locator('small')).toHaveText(translate(code, 'fq.visits.hint'));
      expect(await card.locator('span[lang="en"]').count()).toBe(0);
      await card.locator('input').check();
      await expect(card.locator('input')).toBeChecked();
      await expect(card.locator('input')).toHaveValue('something-else');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const directory = 'docs/design-system/evidence/ux-repair-2026-10-29/after';
      mkdirSync(directory, { recursive: true });
      await page.screenshot({
        path: `${directory}/first-question-${code}-${width}.png`,
        fullPage: true,
      });
    });
  }
}
for (const pages of ['', 'true', 'es,de']) {
  test(`the first-question words keep their existing release rule with pages=${pages || 'unset'}`, async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('corridra.language', 'de'));
    await page.goto(`${origin}/?fq=1&reviewed=de&pages=${pages}`);
    await expect(page.locator('.mr-fq b').last()).toHaveText('Reisen, Besuche oder Messen');
  });
}
test('a language not offered as reviewed is not selected by stored choice', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('corridra.language', 'fr'));
  await page.goto(`${origin}/?fq=1&reviewed=de`);
  await expect(page.locator('.mr-fq')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.mr-fq b').last()).toHaveText('Trips, visits or fairs');
});

test('notes validation keeps its context hint and exposes the error on the textarea', async ({
  page,
}) => {
  await open(page);
  await job(page).selectOption('sourcing');
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(next).toBeEnabled();
  await next.click();
  await page
    .getByRole('combobox', { name: 'Where is the company based?', exact: true })
    .selectOption('BD');
  await page
    .getByRole('combobox', { name: 'Which market is involved?', exact: true })
    .selectOption('CN');
  await next.click();
  await page
    .getByLabel('Your offer or requirement', { exact: true })
    .fill('Synthetic cotton fabric requirement');
  await next.click();
  const notes = page.locator('.intake-form textarea');
  await expect(notes).toHaveAttribute('aria-describedby', 'request-context-hint');
  await notes.evaluate((el) => ((el as HTMLTextAreaElement).maxLength = 2000));
  await notes.fill('x'.repeat(1001));
  await page.getByRole('checkbox').first().check();
  await next.click();
  await expect(page.locator('#notes-error')).toBeVisible();
  await expect(notes).toHaveAttribute('aria-invalid', 'true');
  await expect(notes).toHaveAttribute('aria-describedby', 'request-context-hint notes-error');
});
