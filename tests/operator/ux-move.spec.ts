import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Your Move (Lane 4 of the UX update), mounted the way the other operator specs mount their screens:
// the real component, the real provider and the real stylesheets in a small page. The page route
// itself reads the database and the sign-in provider, so what is proved here is what a person sees:
// the cards, the empty state, the words in each language, the device-only read mark and the layout
// on a phone. Every name, date and company is invented.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

const owner = { id: '11111111-1111-4111-8111-111111111111', name: 'Atelier Rahman', role: 'owner' };
const member = { id: '22222222-2222-4222-8222-222222222222', name: 'Dhaka Knits', role: 'member' };
const request = (id: string, status: string, replies: string[] = []) => ({
  id,
  workspaceId: owner.id,
  createdAt: '2026-10-02T00:00:00Z',
  progress: {
    status,
    receivedAt: '2026-10-02T09:00:00Z',
    replies: replies.map((createdAt) => ({ createdAt })),
  },
});
const draft = (n: number) => ({
  id: `d${n}`,
  workspaceId: owner.id,
  title: `Fabric cutting machine ${n}`,
  updatedAt: `2026-10-0${n}T00:00:00Z`,
});
const cases = {
  full: {
    workspaces: [owner, member],
    drafts: [draft(1)],
    quotes: [
      { id: 'q2', workspaceId: member.id, title: 'Interpreter in Guangzhou', contextLabel: 'M' },
    ],
    companyLinks: [{ workspaceId: owner.id, organisationName: 'Atelier Rahman Ltd' }],
    requests: [request('r1', 'OUTREACH', ['2026-10-09T10:00:00Z'])],
  },
  quiet: {
    workspaces: [owner],
    drafts: [],
    quotes: [],
    companyLinks: [],
    requests: [request('r9', 'FOLLOW_UP')],
  },
  many: {
    workspaces: [owner],
    drafts: [1, 2, 3, 4, 5, 6, 7].map(draft),
    quotes: [],
    companyLinks: [],
    requests: [],
  },
  nothing: { workspaces: [], drafts: [], quotes: [], companyLinks: [], requests: [] },
} as const;
type Case = keyof typeof cases;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{WorkspaceShell}from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
      import{CustomerNav}from ${JSON.stringify(resolve('apps/web/components/customer-nav.tsx'))};
      import{MoveView}from ${JSON.stringify(resolve('apps/web/app/account/move/move-view.tsx'))};
      import{buildMoveModel}from ${JSON.stringify(resolve('apps/web/lib/move-cards.ts'))};
      const q=new URLSearchParams(location.search);
      const input=JSON.parse(q.get('input'));
      const offered=(q.get('offered')||'en').split(',').map(code=>({code,draft:code!=='en'}));
      const skipped=Number(q.get('skipped')||0);
      const partial=q.get('partial')==='1';
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={offered}>
          <WorkspaceShell eyebrow="YOUR MOVE" title="Here is what is waiting for you."
            nav={<CustomerNav current="move" plainNames move companies/>}>
            <MoveView model={buildMoveModel(input)} startHref="/plan" skippedWorkspaces={skipped} partial={partial}/>
          </WorkspaceShell>
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
                : 'const router={replace:()=>{},refresh:()=>{}};export function useRouter(){return router}',
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
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Move fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

const open = (page: Page, name: Case, extra = '') =>
  page.goto(`${origin}/?input=${encodeURIComponent(JSON.stringify(cases[name]))}${extra}`);

test('the cards show what is waiting for the person and who holds the rest', async ({ page }) => {
  await open(page, 'full');
  await expect(page.getByRole('heading', { name: 'Waiting for you', exact: true })).toBeVisible();
  await expect(page.getByText('Send your draft request')).toBeVisible();
  await expect(page.getByText('Add evidence for your company link')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the draft' })).toHaveAttribute(
    'href',
    `/account/drafts/${owner.id}`,
  );
  await expect(page.getByRole('heading', { name: 'Waiting on others' })).toBeVisible();
  await expect(
    page.getByText('The Corridra team is looking for suppliers or buyers.'),
  ).toBeVisible();
  // A member's quote is never offered as an action.
  await expect(page.getByText('A quote is waiting for a workspace owner or admin')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Accept or decline' })).toHaveCount(0);
  // The navigation names the five places.
  const tabs = page.getByRole('navigation', { name: 'Customer navigation' });
  await expect(tabs.getByRole('link')).toHaveText([
    'Your Move',
    'Missions',
    'Companies',
    'Library',
    'More',
  ]);
  await expect(tabs.getByRole('link', { name: 'Your Move' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('a new reply is kept on this device only, and can be marked read and forgotten', async ({
  page,
}) => {
  await open(page, 'full');
  await expect(page.getByText('Read the new reply from the Corridra team')).toBeVisible();
  await page.getByRole('button', { name: 'Mark as read' }).click();
  await expect(page.getByText('Read the new reply from the Corridra team')).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('corridra.move.seen'))).toContain(
    '2026-10-09T10:00:00Z',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Waiting for you', exact: true })).toBeVisible();
  await expect(page.getByText('Read the new reply from the Corridra team')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Forget which replies I have read on this device' })
    .click();
  await expect(page.getByText('Read the new reply from the Corridra team')).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('corridra.move.seen'))).toBe('{}');
});

test('blocked storage does not break the page', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    });
  });
  await open(page, 'full');
  await expect(page.getByText('Read the new reply from the Corridra team')).toBeVisible();
  await page.getByRole('button', { name: 'Mark as read' }).click();
  await expect(page.getByText('Read the new reply from the Corridra team')).toHaveCount(0);
});

test('when nothing waits it says so, shows where the latest request stands and offers Start a request', async ({
  page,
}) => {
  await open(page, 'quiet');
  await expect(page.getByText('Nothing is waiting for you right now.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your most recent request' })).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Start a request' })).toHaveAttribute(
    'href',
    '/plan',
  );
  await open(page, 'nothing');
  await expect(page.getByText('Nothing is waiting for you right now.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your most recent request' })).toHaveCount(0);
});

test('shows five cards and the rest behind one control', async ({ page }) => {
  await open(page, 'many');
  await expect(page.locator('.mr-move')).toHaveCount(7);
  await expect(page.locator('.move-more')).toHaveJSProperty('open', false);
  await page.getByText('Show 2 more').click();
  await expect(page.locator('.move-more')).toHaveJSProperty('open', true);
});

test('says when only the first workspaces were read', async ({ page }) => {
  await open(page, 'many', '&skipped=3');
  await expect(page.getByText('Showing items from your first 8 workspaces.')).toBeVisible();
});

test('says when a list was too long to read in full, and says nothing otherwise', async ({
  page,
}) => {
  await open(page, 'nothing', '&partial=1');
  await expect(
    page.getByText(
      'Some of your lists were too long to read in full. Open your missions to see everything.',
    ),
  ).toBeVisible();
  await open(page, 'nothing');
  await expect(page.getByText('too long to read in full')).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide: no sideways scroll, 44 pixel targets, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['full', 'quiet', 'many'] as const) {
      await open(page, name);
      await expect(
        page.getByRole('heading', { name: 'Waiting for you', exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `${name} at ${width}`,
      ).toBeLessThanOrEqual(width);
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll('main :is(a[href], button, summary)'))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.height < 43.5)
          .map(
            ({ el }) => `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 30)}`,
          ),
      );
      expect(small, `${name} at ${width}`).toEqual([]);
      expect((await new AxeBuilder({ page }).analyze()).violations, `axe ${name} ${width}`).toEqual(
        [],
      );
      // Screenshots for the evidence folder are written only when asked for.
      if (process.env.UX_SHOTS_DIR)
        await page.screenshot({
          path: `${process.env.UX_SHOTS_DIR}/your-move-${name}-${width}.png`,
          fullPage: true,
        });
    }
  });
}

test('speaks the chosen language, says which language the region is in and mirrors right to left', async ({
  page,
}) => {
  await open(page, 'full', '&offered=en,bn,ar');
  await page.evaluate(() => window.localStorage.setItem('corridra.language', 'bn'));
  await page.reload();
  const region = page.locator('.move-view');
  await expect(region).toHaveAttribute('lang', 'bn');
  await expect(page.getByRole('heading', { name: 'আপনার জন্য অপেক্ষায়' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'খসড়া খুলুন' })).toBeVisible();
  await page.evaluate(() => window.localStorage.setItem('corridra.language', 'ar'));
  await page.reload();
  await expect(region).toHaveAttribute('lang', 'ar');
  await expect(region).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'بانتظارك' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
