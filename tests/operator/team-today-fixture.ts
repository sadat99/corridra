import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// The team overview bundled from the source with the real stylesheets and the team shell switch on (the team
// header, the team left bar, the workspace toolbar, Today and the quiet footer), served on a local port. Reads
// are answered by the caller with page.route. `root` is the checkout to bundle; dependencies always come from
// this checkout, so an older revision extracted elsewhere renders in the same frame.
export const fixtureTenant = '00000000-0000-4000-8000-0000000000a1';

// The self-hosted faces of apps/web/app/layout.tsx, so the page is measured with the fonts people see.
const faces = [
  ['--font-newsreader', 'newsreader-latin-variable.woff2', '200 800'],
  ['--font-geist', 'geist-latin-variable.woff2', '100 900'],
  ['--font-geist-mono', 'geist-mono-latin-variable.woff2', '100 900'],
  ['--font-bengali', 'noto-serif-bengali-variable.woff2', '100 900'],
  ['--font-bengali-sans', 'noto-sans-bengali-variable.woff2', '100 900'],
] as const;
const fontCss = faces
  .map(
    ([variable, file, weight]) =>
      `@font-face{font-family:'${file}';src:url(/fonts/${file}) format('woff2');font-weight:${weight};font-display:block}\n:root{${variable}:'${file}'}`,
  )
  .join('\n');

export async function startTodayFixture(root = resolve('.')) {
  const source = (path: string) => JSON.stringify(resolve(root, path));
  const css = readFileSync(resolve(root, 'apps/web/app/globals.css'), 'utf8');
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${source('apps/web/components/language-provider.tsx')};
      import{AppHeader}from ${source('apps/web/components/ux/app-header.tsx')};
      import{BrandLockup}from ${source('apps/web/components/site-header.tsx')};
      import{TeamFrame}from ${source('apps/web/components/ux/team-frame.tsx')};
      import{WorkspaceShell}from ${source('apps/web/components/workspace-shell.tsx')};
      import{TeamSecondLevel}from ${source('apps/web/components/ux/team-second-level.tsx')};
      import{SiteFooterPlace}from ${source('apps/web/components/site-footer-place.tsx')};
      import{OperatorFlags}from ${source('apps/web/app/operator/operator-flags.tsx')};
      import{Workspace}from ${source('apps/web/app/operator/workspace.tsx')};
      import ${source('apps/web/app/operator/operator-overview.css')};
      // ?shells=off renders the frame with the team shell switch off (no team header or left bar, every
      // panel mounted and hidden), as the protected operator suite runs it.
      const shells = new URLSearchParams(location.search).get('shells') !== 'off';
      // ?owner=on shows the owner page entry, as an owner with the owner page switched on sees it.
      // A plain link to a '#' address reloads the page without this query, so the choice is kept for the tab.
      const flag = (name) => {
        const given = new URLSearchParams(location.search).get(name);
        if (given !== null) sessionStorage.setItem('fixture-' + name, given);
        return sessionStorage.getItem('fixture-' + name);
      };
      const ownerPage = flag('owner') === 'on';
      // ?urls=off builds the hash links the sidebar and menus use while section addresses are switched off.
      const urls = flag('urls') !== 'off';
      // ?reports=on is a workspace where Report a Problem is offered (both probes hold), as the server tells the workspace
      // (and, with the shells on, the team frame). Off or missing, nothing is added.
      const reports = flag('reports') === 'on';
      // ?role=operator is a team member who may not see the problem report or erasure queues. Default owner.
      const role = flag('role') ?? 'owner';
      const workspace = (
        <OperatorFlags replyReview={false}>
          <Workspace tenants={[{id:${JSON.stringify(fixtureTenant)},name:'Synthetic request operations',role:role}]}
            initialTenant=${JSON.stringify(fixtureTenant)} shellsV2={shells} problemReports={reports}/>
        </OperatorFlags>
      );
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <div className="site-shell">
            {shells ? (
              <>
                <AppHeader kind="team" live={false} notifications brandMark={<BrandLockup/>}/>
                <TeamFrame urls={urls} ownerPage={ownerPage} problemReports={reports}>
                  <WorkspaceShell eyebrow="TEAM WORKSPACE" title="Today" className="ux-operator-home ux-titled-today">
                    <TeamSecondLevel urls={urls} ownerPage={ownerPage}/>
                    {workspace}
                  </WorkspaceShell>
                </TeamFrame>
                <SiteFooterPlace realUse={false} shells/>
              </>
            ) : (
              <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Your workspace." className="ux-operator-home">
                {workspace}
              </WorkspaceShell>
            )}
          </div>
        </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve(root, 'apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css', '.woff2': 'empty' },
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
                : 'const router={replace:()=>{},push:()=>{},refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return "/operator"}export function useSearchParams(){return new URLSearchParams(location.search)}',
          }));
        },
      },
    ],
  });
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path.startsWith('/fonts/')) {
      res.setHeader('content-type', 'font/woff2');
      res.end(readFileSync(resolve('apps/web/app/fonts', basename(path))));
    } else if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${fontCss}\n${css}\n${componentCss}`);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Today</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
