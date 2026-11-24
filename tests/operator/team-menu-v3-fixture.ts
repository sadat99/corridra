import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// The team frame bundled from the source with the real stylesheets, for menu v3 (team desk v4.1 unit D3): the team
// header, the team left bar with the switches the address asks for, and a page body tall enough to scroll. No
// workspace is mounted and nothing is read: the role comes from the address, as the server would publish it.
//   ?v41=on      CORRIDRA_UX_TEAM_DESK_V41 on (menu v3); otherwise the sidebar as it was
//   ?desk=on     CORRIDRA_UX_OPERATOR_DESK on (only read while v41 is off)
//   ?supply=on   CORRIDRA_SUPPLY_SOURCES on
//   ?role=owner  the person's role in the workspace (default owner); ?role=none leaves it unknown
//   ?urls=off    section addresses off (`#` links)
//   ?tall=on     a page body three screens tall
//   ?mount=on    the real workspace is mounted with two workspaces (its reads are answered by the caller with
//                page.route), with the second tab bar line the team pages have, so the toolbar and that bar can be seen
// The pathname is the browser's own, so /operator/settings?tab=settings-erasure is that address.
export const fixtureTenant = '00000000-0000-4000-8000-0000000000a1';
export const secondTenant = '00000000-0000-4000-8000-0000000000a2';

const faces = [
  ['--font-newsreader', 'newsreader-latin-variable.woff2', '200 800'],
  ['--font-geist', 'geist-latin-variable.woff2', '100 900'],
  ['--font-geist-mono', 'geist-mono-latin-variable.woff2', '100 900'],
] as const;
const fontCss = faces
  .map(
    ([variable, file, weight]) =>
      `@font-face{font-family:'${file}';src:url(/fonts/${file}) format('woff2');font-weight:${weight};font-display:block}\n:root{${variable}:'${file}'}`,
  )
  .join('\n');

export async function startMenuFixture(root = resolve('.')) {
  const source = (path: string) => JSON.stringify(resolve(root, path));
  const css = readFileSync(resolve(root, 'apps/web/app/globals.css'), 'utf8');
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${source('apps/web/components/language-provider.tsx')};
      import{AppHeader}from ${source('apps/web/components/ux/app-header.tsx')};
      import{BrandLockup}from ${source('apps/web/components/site-header.tsx')};
      import{TeamFrame}from ${source('apps/web/components/ux/team-frame.tsx')};
      import{TeamContextPublisher}from ${source('apps/web/components/ux/team-context-publisher.tsx')};
      import{WorkspaceShell}from ${source('apps/web/components/workspace-shell.tsx')};
      import{TeamSecondLevel}from ${source('apps/web/components/ux/team-second-level.tsx')};
      import{OperatorFlags}from ${source('apps/web/app/operator/operator-flags.tsx')};
      import{Workspace}from ${source('apps/web/app/operator/workspace.tsx')};
      import{SiteFooterPlace}from ${source('apps/web/components/site-footer-place.tsx')};
      import ${source('apps/web/app/operator/operator-overview.css')};
      const query = new URLSearchParams(location.search);
      const on = (name) => query.get(name) === 'on';
      const role = query.get('role') ?? 'owner';
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <div className="site-shell">
            <AppHeader kind="team" live={false} notifications brandMark={<BrandLockup/>}/>
            <TeamFrame urls={query.get('urls') !== 'off'} ownerPage={false} problemReports={on('reports')}
              desk={on('desk')} deskV41={on('v41')} supply={on('supply')}>
              <WorkspaceShell eyebrow="TEAM WORKSPACE" title="Today" className="ux-operator-home">
                {on('mount') ? (
                  <>
                    <TeamSecondLevel urls={query.get('urls') !== 'off'} ownerPage={false} desk={on('desk')}/>
                    <OperatorFlags replyReview={false}>
                      <Workspace tenants={[{id:${JSON.stringify(fixtureTenant)},name:'Synthetic request operations',role:role},{id:${JSON.stringify(secondTenant)},name:'Second workspace',role:role}]}
                        initialTenant=${JSON.stringify(fixtureTenant)} shellsV2 desk={on('desk')}/>
                    </OperatorFlags>
                  </>
                ) : role === 'none' ? null : <TeamContextPublisher tenant=${JSON.stringify(fixtureTenant)} role={role}/>}
                <p>Fixture page.</p>
                {on('tall') ? <div data-fixture-tall="" style={{height:'300vh'}}/> : null}
              </WorkspaceShell>
            </TeamFrame>
            <SiteFooterPlace realUse={false} shells/>
          </div>
        </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve(root, 'apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    // Flag images are served by the site, not bundled: a workspace tree that draws them still builds here.
    external: ['/flags/*'],
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
                : 'const router={replace:()=>{},push:()=>{},refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return location.pathname}export function useSearchParams(){return new URLSearchParams(location.search)}',
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
    } else if (path.startsWith('/api/')) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end('{"error":"Not part of this fixture"}');
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
