import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ADR-087 U1: the operator delivery page and the delivery experience page, mounted with the real components and the
// workspace answers the service gives each role. A viewer receives replies and evidence answers without their bodies
// and sees "Not available for your role"; an operator receives and sees the words. No database.
let server: Server, origin: string;
let bundle = '',
  componentCss = '';
const tenant = '11111111-1111-4111-8111-111111111111';
const replyText = 'Synthetic supplier reply words for the body permission check';
const quotationNote = 'Synthetic supplier uncertainty for the body permission check';
const answerText = 'Synthetic participant answer words for the body permission check';
const hidden = 'Not available for your role';

const experience = (body: boolean) => ({
  targetOutreach: null,
  organisations: [],
  contexts: [],
  agenda: [],
  requirements: [],
  targets: [],
  quotations: [],
  links: [],
  rfqs: [],
  disclosures: [],
  specificationConfirmationsAvailable: false,
  responses: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      link_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      created_at: '2026-11-17T08:00:00Z',
      source_kind: 'SELF_DECLARATION',
      body: body
        ? {
            body: replyText,
            meetingInterest: true,
            quotation: { currency: 'USD', terms: {}, uncertainties: quotationNote },
          }
        : null,
    },
  ],
});
const workspace = (role: string, body: boolean) => ({
  role,
  programmes: [],
  programmeTotal: 0,
  participants: [],
  publications: [],
  links: [],
  owners: [],
  requests: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Confirm synthetic requirements',
      instructions: 'Describe the synthetic requirement.',
      status: 'RESPONDED',
      response: body ? answerText : null,
      answered: true,
      claim_status: 'SELF_DECLARED',
    },
  ],
});

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{DeliveryExperience}from ${JSON.stringify(resolve('apps/web/app/operator/delivery-experience.tsx'))};
      import{Delivery}from ${JSON.stringify(resolve('apps/web/app/operator/delivery.tsx'))};
      import{OperatorFlags}from ${JSON.stringify(resolve('apps/web/app/operator/operator-flags.tsx'))};
      const q=new URLSearchParams(location.search);
      const role=q.get('role');
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page ux-workspace"><h1>Delivery</h1>
        <OperatorFlags replyReview={q.get('review')==='1'}>
        {q.get('page')==='experience'
          ?<DeliveryExperience role={role} tenant="${tenant}" programme="" mission="" participants={[]} publications={[]} owners={[]}/>
          :<Delivery tenant="${tenant}" revision={0}/>}</OperatorFlags></main>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    external: ['/flags/*'],
    loader: { '.css': 'css' },
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
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = readFileSync('apps/web/app/globals.css', 'utf8');
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staff body permission</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

async function answer(page: Page, role: string, body: boolean, reviews: unknown[] = []) {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const json =
      url.pathname === '/api/workspace/delivery'
        ? url.searchParams.get('action') === 'experience'
          ? experience(body)
          : workspace(role, body)
        : url.pathname === '/api/reply/review'
          ? { open: true, reviews }
          : url.pathname === '/api/workspace/missions'
            ? { missions: [], total: 0 }
            : url.pathname.endsWith('/meetings')
              ? { meetings: [] }
              : {};
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(json),
    });
  });
}

test('the delivery experience page shows a viewer that a reply exists, never its words', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'viewer', false);
  await page.goto(`${origin}/?page=experience&role=viewer`);
  await expect(page.getByText('recipient link aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBeVisible();
  await expect(page.getByText(hidden, { exact: true })).toBeVisible();
  await expect(page.getByText(replyText)).toHaveCount(0);
  await expect(page.getByText(quotationNote)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the delivery experience page shows an operator the reply words', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'operator', true);
  await page.goto(`${origin}/?page=experience&role=operator`);
  await expect(page.getByText(replyText, { exact: true })).toBeVisible();
  await expect(page.getByText(quotationNote)).toBeVisible();
  await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the delivery page shows a viewer that an evidence request was answered, never the answer', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'viewer', false);
  await page.goto(`${origin}/?page=delivery`);
  await page.getByRole('tab', { name: 'Access and requests' }).click();
  await expect(page.getByText('Confirm synthetic requirements')).toBeVisible();
  await expect(page.getByText(`Self-declared response: ${hidden}`)).toBeVisible();
  await expect(page.getByText(answerText)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the delivery page shows an operator the self-declared answer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'operator', true);
  await page.goto(`${origin}/?page=delivery`);
  await page.getByRole('tab', { name: 'Access and requests' }).click();
  await expect(page.getByText(`Self-declared response: ${answerText}`)).toBeVisible();
  await expect(page.getByText(hidden)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with reply review on, a viewer gets a card that the reply exists and its review state, never its words', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'viewer', false);
  await page.goto(`${origin}/?page=experience&role=viewer&review=1`);
  const card = page.getByRole('region', { name: 'Review supplier replies' });
  await expect(card.getByText('Awaiting review.')).toBeVisible();
  await expect(card.getByText(hidden, { exact: true })).toBeVisible();
  await expect(page.getByText(replyText)).toHaveCount(0);
  await expect(page.getByText(quotationNote)).toHaveCount(0);
  await expect(card.getByRole('button')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with U2 installed, a viewer sees an Ask without its terms as "more detail", never an empty list', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // What ReplyReviewService.list gives a viewer through app.reply_review_meta: the decision and date, no terms or note.
  await answer(page, 'viewer', false, [
    {
      id: '55555555-5555-4555-8555-555555555555',
      responseId: '22222222-2222-4222-8222-222222222222',
      decision: 'ASK',
      reasonCode: null,
      askTerms: null,
      note: null,
      createdAt: '2026-11-17T09:00:00.000Z',
    },
  ]);
  await page.goto(`${origin}/?page=experience&role=viewer&review=1`);
  const card = page.getByRole('region', { name: 'Review supplier replies' });
  const state = card.locator('.reply-review-state[data-state="ASK"]');
  await expect(state).toHaveText('Asked for more detail. Waiting for a new reply.');
  await expect(card.getByText(/Asked for \./)).toHaveCount(0);
  await expect(card.getByText(hidden, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('with reply review on, an operator reads the reply words in the review card', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'operator', true);
  await page.goto(`${origin}/?page=experience&role=operator&review=1`);
  const card = page.getByRole('region', { name: 'Review supplier replies' });
  await expect(card.getByText(replyText, { exact: true })).toBeVisible();
  await expect(card.getByText(hidden)).toHaveCount(0);
  expect(errors).toEqual([]);
});
