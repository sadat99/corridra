import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// CX-07 screenshots of the Move page (Home once the front door switch is on). The page route needs the database
// and the sign-in provider and the verification server has the switch off, so this mounts the real MoveView with
// the real stylesheets, as ux-move.spec.ts does. It runs only when CX_SHOTS_DIR is set. CX_ROOT may point at
// another checkout (for example main) to take the "before" pictures with the same harness. Names are invented.
const out = process.env.CX_SHOTS_DIR;
const root = resolve(process.env.CX_ROOT ?? '.');
let server: Server, origin: string;
const owner = { id: '11111111-1111-4111-8111-111111111111', name: 'Atelier Rahman', role: 'owner' };
const member = { id: '22222222-2222-4222-8222-222222222222', name: 'Dhaka Knits', role: 'member' };
const request = (id: string, status: string) => ({
  id,
  workspaceId: owner.id,
  createdAt: '2026-10-02T00:00:00Z',
  progress: { status, receivedAt: '2026-10-02T09:00:00Z', replies: [] },
});
const cases = {
  full: {
    workspaces: [owner, member],
    drafts: [
      {
        id: 'd1',
        workspaceId: owner.id,
        title: 'Fabric cutting machine',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ],
    quotes: [
      { id: 'q2', workspaceId: member.id, title: 'Interpreter in Guangzhou', contextLabel: 'M' },
    ],
    companyLinks: [{ workspaceId: owner.id, organisationName: 'Atelier Rahman Ltd' }],
    requests: [request('r1', 'OUTREACH')],
  },
  quiet: {
    workspaces: [owner],
    drafts: [],
    quotes: [],
    companyLinks: [],
    requests: [request('r9', 'FOLLOW_UP')],
  },
};

test.beforeAll(async () => {
  if (!out) return;
  const at = (path: string) => JSON.stringify(resolve(root, path));
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${at('apps/web/components/language-provider.tsx')};
      import{WorkspaceShell}from ${at('apps/web/components/workspace-shell.tsx')};
      import{MoveView}from ${at('apps/web/app/account/move/move-view.tsx')};
      import{buildMoveModel}from ${at('apps/web/lib/move-cards.ts')};
      const params=new URLSearchParams(location.search);
      const input=JSON.parse(params.get('input'));
      const extra=JSON.parse(params.get('props')||'{}');
      const model=buildMoveModel(input);
      const taskJourneys=extra.allSell?Object.fromEntries([...model.cards,...model.waiting].map((e)=>[e.id,'sell'])):undefined;
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false},{code:'ar',draft:false}]}>
          <WorkspaceShell title="Good morning, Asha" quietTitle customer>
            <MoveView model={model} startHref="/plan" taskJourneys={taskJourneys} {...extra}/>
          </WorkspaceShell>
        </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve(root, 'apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    external: ['/flags/*'],
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
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = readFileSync(resolve(root, 'apps/web/app/globals.css'), 'utf8');
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Move</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

for (const [name, input] of Object.entries(cases))
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [768, 1024],
    [1440, 900],
  ] as const)
    test(`CX-07 Move ${name} at ${width}`, async ({ page }) => {
      test.skip(!out, 'Set CX_SHOTS_DIR to take the Move pictures.');
      mkdirSync(out!, { recursive: true });
      await page.setViewportSize({ width, height });
      await page.goto(`${origin}/?input=${encodeURIComponent(JSON.stringify(input))}`);
      await page.waitForSelector('.move-view');
      await page.screenshot({ path: resolve(out!, `move-${name}-${width}.png`), fullPage: true });
    });

test('CX-07 Move full in Arabic at 320', async ({ page }) => {
  test.skip(!out, 'Set CX_SHOTS_DIR to take the Move pictures.');
  mkdirSync(out!, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('corridra.language', 'ar'));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${origin}/?input=${encodeURIComponent(JSON.stringify(cases.full))}`);
  await page.waitForSelector('.move-view');
  await page.screenshot({ path: resolve(out!, 'move-full-ar-320.png'), fullPage: true });
});

// Review round 1 evidence on the real MoveView with the real stylesheets: the Today card with its due day and Mark As
// Read, the partial state, the filter row with two kinds, the no-match state and the blocked-storage line.
const sourceCard = {
  journey: 'source',
  id: 'r1',
  workspaceId: owner.id,
  count: '1',
  title: 'Spinning frames',
  kind: 'request',
  status: 'OUTREACH',
  statusWords: 'Finding companies',
  dateWords: '2 Oct 2026',
  at: '2026-10-02T00:00:00Z',
  href: '/account/rooms/r1',
};
const dueMove = {
  workspaces: [owner],
  drafts: [],
  quotes: [],
  companyLinks: [],
  requests: [request('r1', 'ACTIVE')],
  moves: [
    {
      requestId: 'r1',
      moves: [
        {
          id: 'm1',
          verb: 'Answer',
          object: 'the sample size',
          holder: 'customer',
          dueOn: '2026-11-20',
        },
      ],
    },
  ],
};
const withReply = {
  ...dueMove,
  moves: [],
  requests: [
    {
      ...request('r1', 'ACTIVE'),
      progress: {
        status: 'ACTIVE',
        receivedAt: '2026-10-02T09:00:00Z',
        replies: [{ createdAt: '2026-11-10T09:00:00Z' }],
      },
    },
  ],
};
const extraShots = {
  'today-due': { input: dueMove, props: {} },
  'today-reply': { input: withReply, props: {} },
  partial: { input: cases.full, props: { partial: true } },
  'filter-two-kinds': { input: dueMove, props: { allSell: true, journeys: [sourceCard] } },
  'no-match': {
    input: dueMove,
    props: { allSell: true, journeys: [sourceCard], journey: 'source' },
  },
} as const;

for (const [name, { input, props }] of Object.entries(extraShots))
  for (const [width, height] of [
    [320, 640],
    [390, 844],
  ] as const)
    test(`CX-07 Move ${name} at ${width}`, async ({ page }) => {
      test.skip(!out, 'Set CX_SHOTS_DIR to take the Move pictures.');
      mkdirSync(out!, { recursive: true });
      await page.setViewportSize({ width, height });
      await page.goto(
        `${origin}/?input=${encodeURIComponent(JSON.stringify(input))}&props=${encodeURIComponent(JSON.stringify(props))}`,
      );
      await page.waitForSelector('.move-view');
      if (name === 'today-due') {
        await expect(page.locator('.today-due')).toContainText('Due 20 November 2026');
      }
      if (name === 'today-reply') {
        await expect(page.getByRole('button', { name: 'Mark As Read' })).toBeVisible();
      }
      if (name === 'partial') {
        await expect(page.getByText('This page may not show everything yet.')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Try Again' }).first()).toBeVisible();
      }
      if (name === 'filter-two-kinds') {
        const chips = page.getByRole('navigation', { name: 'Show work for' }).getByRole('link');
        await expect(chips).toHaveCount(3);
        await expect(chips.first()).toHaveAttribute('aria-current', 'page');
        for (const chip of await chips.all()) {
          const style = await chip.evaluate((el) => {
            const css = getComputedStyle(el);
            return { height: el.getBoundingClientRect().height, size: css.fontSize };
          });
          expect(style.height).toBeGreaterThanOrEqual(44);
          expect(style.size).toBe('16px');
        }
        const snap = await page
          .getByRole('navigation', { name: 'Show work for' })
          .evaluate((el) => getComputedStyle(el).scrollSnapType);
        expect(snap).not.toBe('none');
      }
      if (name === 'no-match') {
        await expect(page.getByRole('link', { name: 'Show All' }).first()).toBeVisible();
        await expect(page.getByText(/all caught up/i)).toHaveCount(0);
      }
      await page.screenshot({ path: resolve(out!, `move-${name}-${width}.png`), fullPage: true });
    });

test('CX-07 Move Today with blocked storage says so quietly', async ({ page }) => {
  test.skip(!out, 'Set CX_SHOTS_DIR to take the Move pictures.');
  mkdirSync(out!, { recursive: true });
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/?input=${encodeURIComponent(JSON.stringify(withReply))}&props=%7B%7D`);
  await page.waitForSelector('.move-view');
  await expect(page.getByText('This device cannot remember what you have read.')).toBeVisible();
  await page.screenshot({ path: resolve(out!, 'move-storage-blocked-390.png'), fullPage: true });
});
