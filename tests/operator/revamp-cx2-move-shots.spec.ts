import { test } from '@playwright/test';
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
      const input=JSON.parse(new URLSearchParams(location.search).get('input'));
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <WorkspaceShell title="Here is what is waiting for you." customer>
            <MoveView model={buildMoveModel(input)} startHref="/plan"/>
          </WorkspaceShell>
        </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve(root, 'apps/web'),
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
    [390, 844],
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
