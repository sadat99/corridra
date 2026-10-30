import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { Pool } from '../../packages/db/src/index';
import { noticeVersion } from '../../packages/domain/src/missions';
import { localeMeta, type Locale } from '../../apps/web/lib/i18n/locales';
import { words as ar } from '../../apps/web/lib/i18n/form-words/ar';
import { words as de } from '../../apps/web/lib/i18n/form-words/de';

async function openFineTune(page: Page) {
  const details = page.locator('.ux-fine-tune');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

test('UX-02 discovery completes a synthetic brief with original money, retry, duplicate and receipt denial semantics', async ({
  page,
}) => {
  test.setTimeout(120000);
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const server = spawn(process.execPath, [tsx, 'scripts/ux02-intake-browser-server.ts'], {
    cwd: resolve('.'),
    stdio: 'ignore',
    env: { PATH: process.env.PATH },
  });
  try {
    await expect(async () => {
      expect((await page.request.get('http://127.0.0.1:3450/')).status()).toBe(200);
    }).toPass({ timeout: 30000 });
    const email = `ux02-${randomUUID()}@example.invalid`;
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto('http://127.0.0.1:3450/corridors');
    await openFineTune(page);
    await page
      .getByRole('combobox', { name: "I'm trying to" })
      .selectOption('machinery_procurement');
    await page
      .getByRole('combobox', { name: 'Commercial direction', exact: true })
      .selectOption('bangladesh-china');
    await page.getByRole('link', { name: 'Plan a mission on this route' }).click();
    await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
      'machinery_procurement',
    );
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(
      page.getByRole('combobox', { name: 'Where is the company based?', exact: true }),
    ).toHaveValue('BD');
    await expect(
      page.getByRole('combobox', { name: 'Which market is involved?', exact: true }),
    ).toHaveValue('CN');
    await page.getByLabel('Yes', { exact: true }).check();
    await page.getByLabel('From', { exact: true }).fill('2026-11-10');
    await page.getByLabel('To', { exact: true }).fill('2026-11-01');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('End date must follow the start date')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Check this step.' })).toBeFocused();
    await page.getByLabel('To', { exact: true }).fill('2026-11-15');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .getByLabel('Your offer or requirement')
      .fill('原始机器要求。 কাল্পনিক যন্ত্রপাতির পরীক্ষামূলক বিবরণ।');
    await page
      .getByLabel('Technical purpose (optional)', { exact: true })
      .fill('Synthetic equipment assessment');
    await page.getByText('Budget context (optional)', { exact: true }).click();
    await page.getByLabel('Budget in original currency (optional)', { exact: true }).fill('1.234');
    await page
      .getByRole('combobox', { name: 'Original currency', exact: true })
      .selectOption('BHD');
    await page
      .getByLabel('Budget basis, such as total equipment budget', { exact: true })
      .fill('Original synthetic equipment quote');
    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Your example request' })).toContainText(
      '1.234 BHD',
    );
    await expect(page.getByLabel('Your offer or requirement')).toHaveValue(
      '原始机器要求。 কাল্পনিক যন্ত্রপাতির পরীক্ষামূলক বিবরণ।',
    );
    await mkdir('.cache/ux02/after', { recursive: true });
    await page.screenshot({ path: '.cache/ux02/after/intake-original-390.png', fullPage: true });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Relevant meetings', { exact: true }).check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('UX Two Synthetic Person');
    await page.getByLabel('Company', { exact: true }).fill('UX Two Invented Equipment Company');
    await page.getByLabel('Work email', { exact: true }).fill('do-not-send@example.com');
    await page.getByLabel('I have read the test intake notice', { exact: false }).check();
    let writes = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/intake') && request.method() === 'POST') writes++;
    });
    await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
    await expect(page.getByLabel('Work email', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(writes).toBe(0);
    await page.getByLabel('Work email', { exact: true }).fill(email);
    await page.route('**/api/intake', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic transport interruption. Retry the same brief.' }),
      }),
    );
    await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Synthetic transport interruption');
    await expect(page.getByLabel('Work email', { exact: true })).toHaveValue(email);
    await page.unroute('**/api/intake');
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/intake') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const payload = response.request().postDataJSON();
    expect(payload.brief.experience.requirements).toMatchObject({
      budgetMinor: '1234',
      currency: 'BHD',
    });
    expect(payload.brief.offer).toBe('原始机器要求。 কাল্পনিক যন্ত্রপাতির পরীক্ষামূলক বিবরণ।');
    const result = await response.json();
    const duplicate = await page.request.post('http://127.0.0.1:3450/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3450' },
      data: payload,
    });
    expect(duplicate.status()).toBe(201);
    expect(await duplicate.json()).toMatchObject({
      id: result.id,
      receipt: result.receipt,
      duplicate: true,
    });
    expect(typeof result.id).toBe('string');
    expect(typeof result.receipt).toBe('string');
    const sameBriefNewKey = await page.request.post('http://127.0.0.1:3450/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3450' },
      data: { ...payload, key: randomUUID() },
    });
    expect(sameBriefNewKey.status()).toBe(201);
    expect(await sameBriefNewKey.json()).toEqual({ duplicate: true });
    await expect(page.getByLabel('Private receipt code')).toHaveValue(result.receipt);
    await page.reload();
    await expect(page.getByLabel('Private receipt code')).toHaveValue(result.receipt);
    await page.getByRole('button', { name: 'Check status and replies' }).click();
    await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
    await page.getByLabel('Receipt code', { exact: true }).fill('0'.repeat(64));
    const rejected = page.waitForResponse((response) =>
      response.url().endsWith('/api/intake/receipt'),
    );
    await page.getByRole('button', { name: 'Check status and replies' }).click();
    expect((await rejected).ok()).toBe(false);
    await expect(page.getByText('DRAFT', { exact: true })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    server.kill('SIGTERM');
  }
});

// The request form in a released language against the real intake (Lane 11). /plan is built in advance, so the form
// release cannot be switched on at `next start`; the real page is bundled with the release on and served from the
// same origin, and every request goes to the real handlers and database.
test('the sample form completes in German and Arabic against the real intake and sends the English request', async ({
  browser,
}) => {
  test.setTimeout(240000);
  const origin = 'http://127.0.0.1:3450';
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const server = spawn(process.execPath, [tsx, 'scripts/ux02-intake-browser-server.ts'], {
    cwd: resolve('.'),
    stdio: 'ignore',
    env: { PATH: process.env.PATH },
  });
  try {
    const fixture = await build({
      stdin: {
        contents: `import{createRoot}from'react-dom/client';
        import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
        import Page from ${JSON.stringify(resolve('apps/web/app/plan/page.tsx'))};
        const offered=['en','bn','zh','es','ar','fr','de'].map((code)=>({code,draft:false}));
        createRoot(document.getElementById('fixture')).render(<LanguageProvider offered={offered}><div className="site-shell"><Page/></div></LanguageProvider>);`,
        loader: 'tsx',
        resolveDir: resolve('apps/web'),
      },
      nodePaths: [resolve('apps/web/node_modules')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      jsx: 'automatic',
      loader: { '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"production"', 'process.env': 'globalThis.fixtureEnv' },
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
    const script = fixture.outputFiles[0].text;
    const page0 = await browser.newPage();
    await expect(async () => {
      expect((await page0.request.get(`${origin}/plan`)).status()).toBe(200);
    }).toPass({ timeout: 30000 });
    const built = await (await page0.request.get(`${origin}/plan`)).text();
    await page0.close();
    const stylesheets = [...built.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]
      .map((match) => `<link rel="stylesheet" href="${match[1]}">`)
      .join('');
    const email = `ux02-language-${randomUUID()}@example.invalid`;
    const offer = '原始机器要求。 কাল্পনিক যন্ত্রপাতির পরীক্ষামূলক বিবরণ।';
    const words = { de, ar };
    const run = async (code: Locale, query: string) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript((value) => {
        crypto.randomUUID = () => '00000000-0000-4000-8000-000000000004';
        localStorage.setItem('corridra.language', value);
      }, code);
      await page.route(`${origin}/fixture-plan.js`, (route) =>
        route.fulfill({ contentType: 'text/javascript', body: script }),
      );
      await page.route(`${origin}/fixture-plan?*`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">${stylesheets}<script>const q=new URLSearchParams(location.search);globalThis.fixtureEnv={DATA_ENVIRONMENT:'synthetic',CORRIDRA_LANGUAGES_FORM:q.get('form')||'',CORRIDRA_UX_FIRSTQ:q.get('fq')==='1'?'true':''};</script></head><body><div id="fixture"></div><script type="module" src="/fixture-plan.js"></script></body></html>`,
        }),
      );
      await page.goto(`${origin}/fixture-plan?${query}`);
      const form = page.locator('form.intake-form');
      const next = form.locator('.guide-actions .primary-link');
      await expect(next).toBeEnabled();
      if (code !== 'en') {
        await expect(page.locator('#main')).toHaveAttribute('lang', localeMeta[code].html);
        await expect(next).toHaveText(words[code as 'de' | 'ar']['form.action.continue']);
      }
      // Every step is first sent empty, so each step's errors are shown, then answered.
      const step = async (answer: () => Promise<unknown>) => {
        await next.click();
        await expect(page.locator('.ux-error-summary')).toBeFocused();
        await answer();
        const before = await form.locator('h2').textContent();
        await next.click();
        await expect(form.locator('h2')).not.toHaveText(before ?? '');
      };
      await step(() => form.locator('select').first().selectOption('machinery_procurement'));
      await step(async () => {
        await form.locator('select').nth(0).selectOption('BD');
        await form.locator('select').nth(1).selectOption('CN');
        await form.locator('input[name="attendance"]').first().check();
        await form.locator('#brief-startDate').fill('2026-11-10');
        await form.locator('#brief-endDate').fill('2026-11-15');
      });
      await step(async () => {
        await form.locator('textarea').first().fill(offer);
        await form.locator('#brief-technicalPurpose').fill('Synthetic equipment assessment');
        await form.locator('details summary').click();
        await form.locator('#brief-budgetAmount').fill('1.234');
        await form.locator('details select').selectOption('BHD');
        await form.locator('#brief-budgetBasis').fill('Original synthetic equipment quote');
      });
      await step(() => form.locator('input[type="checkbox"]').first().check());
      await next.click();
      await expect(page.locator('.ux-error-summary')).toBeFocused();
      await form.locator('#brief-name').fill('UX Two Synthetic Person');
      await form.locator('#brief-company').fill('UX Two Invented Equipment Company');
      await form.locator('#brief-email').fill(email);
      await form.locator('label.choice input[type="checkbox"]').check();
      if (code === 'de') {
        // A forced outage first: said in German, answers kept, and the retry sends the same request.
        await page.route('**/api/intake', (route) =>
          route.fulfill({ status: 503, json: { error: 'Intake is unavailable' } }),
        );
        await next.click();
        await expect(page.locator('.guide-status')).toHaveText(
          de['form.message.intakeUnavailable'],
        );
        await expect(form.locator('#brief-email')).toHaveValue(email);
        await page.unroute('**/api/intake');
      }
      const saved = page.waitForResponse(
        (response) =>
          response.url() === `${origin}/api/intake` && response.request().method() === 'POST',
      );
      await next.click();
      const response = await saved;
      expect(response.status()).toBe(201);
      const result = await response.json();
      await expect(page.locator('.receipt-panel input[readonly]')).toHaveValue(result.receipt);
      if (code !== 'en') {
        await expect(page.locator('.guide-status')).toHaveText(
          words[code as 'de' | 'ar']['form.message.duplicate'],
        );
        await page.locator('#receipt-check button.primary-link').click();
        await expect(page.locator('#receipt-check strong[lang="en"]')).toHaveText('DRAFT');
      }
      const body = response.request().postData() ?? '';
      await context.close();
      return { body, result };
    };
    const english = await run('en', 'form=true');
    expect(english.result.duplicate).toBe(false);
    const german = await run('de', 'form=true');
    const arabic = await run('ar', 'form=true&fq=1');
    expect(german.body).toBe(english.body);
    expect(arabic.body).toBe(english.body);
    for (const reply of [german.result, arabic.result])
      expect(reply).toMatchObject({
        id: english.result.id,
        receipt: english.result.receipt,
        duplicate: true,
      });
    const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
    const db = new Pool({
      host: '127.0.0.1',
      port: 54329,
      user: 'postgres',
      password: local.ownerPassword,
      database: 'corridra_browser_ux02_intake',
    });
    try {
      const sent = JSON.parse(english.body);
      const rows = (
        await db.query(
          'SELECT notice_version, brief FROM app.mission_intake WHERE request_key=$1',
          [sent.key],
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].notice_version).toBe(noticeVersion);
      expect(rows[0].brief).toEqual(sent.brief);
      expect(rows[0].brief.market).toBe('China');
    } finally {
      await db.end();
    }
  } finally {
    server.kill('SIGTERM');
  }
});
