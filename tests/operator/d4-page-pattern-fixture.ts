import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// The team desk page pattern (team desk v4.1, unit D4) bundled from the source with the real stylesheets and
// served on a local port: the team header and left bar, then the shell header exactly as
// apps/web/app/operator/operator-entry.tsx builds it for a section address, with the workspace under it.
// ?v41=on is CORRIDRA_UX_TEAM_DESK_V41 on; without it the header is the one the desk has today. The page in
// view comes from the address (/operator/<word>), as on the site. Reads are answered by the caller.
export const fixtureTenant = '00000000-0000-4000-8000-0000000000a1';

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

export async function startPagePatternFixture(root = resolve('.')) {
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
      import{deskFrame}from ${source('apps/web/components/ux/desk-frame.tsx')};
      import{SiteFooterPlace}from ${source('apps/web/components/site-footer-place.tsx')};
      import{OperatorFlags}from ${source('apps/web/app/operator/operator-flags.tsx')};
      import{Workspace}from ${source('apps/web/app/operator/workspace.tsx')};
      import{sectionForSlug}from ${source('apps/web/lib/operator-urls.ts')};
      import{teamSectionTitle}from ${source('apps/web/lib/ux/shells.ts')};
      import ${source('apps/web/app/operator/operator-overview.css')};
      // A segment link is a full page load without the query, so each choice is kept for the tab.
      const flag = (name) => {
        const given = new URLSearchParams(location.search).get(name);
        if (given !== null) sessionStorage.setItem('fixture-' + name, given);
        return sessionStorage.getItem('fixture-' + name);
      };
      const v41 = flag('v41') === 'on';
      const ownerPage = flag('owner') !== 'off';
      const role = flag('role') ?? 'owner';
      const section = sectionForSlug(location.pathname.split('/')[2] ?? '') ?? undefined;
      const heading = teamSectionTitle(section);
      const frame = v41 ? deskFrame({ place: section ?? 'home', urls: true, ownerPage }) : null;
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <div className="site-shell">
            <AppHeader kind="team" live={false} notifications brandMark={<BrandLockup/>}/>
            <TeamFrame urls ownerPage={ownerPage} problemReports={false}>
              <WorkspaceShell
                eyebrow={v41 ? undefined : 'TEAM WORKSPACE'}
                title={frame?.title ?? heading}
                lead={frame?.lead}
                className={(heading === 'Today' ? 'ux-operator-home ux-titled-today' : 'ux-operator-home') + (frame ? ' ' + frame.className : '')}
              >
                {frame ? frame.segments : <TeamSecondLevel urls ownerPage={ownerPage}/>}
                <OperatorFlags replyReview={false} deskV41={v41}>
                  <Workspace tenants={[{id:${JSON.stringify(fixtureTenant)},name:'Synthetic request operations',role:role}]}
                    initialTenant=${JSON.stringify(fixtureTenant)} initialSection={section} shellsV2 ownerPage={ownerPage}/>
                </OperatorFlags>
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
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Team desk</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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
