import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// The supply source screens (ADR-082 slice S3) bundled from the source with the real stylesheets and the team shell, served on a
// local port. The mode line, the hub intro and every screen body are the same components the pages draw. Every read and write is answered by the caller with page.route, so no database is needed. `?screen=` picks the
// screen: hub, mission, candidate or dnc; `?role=` is the person's role in the workspace (default owner).
export const supplyTenant = '00000000-0000-4000-8000-0000000000a1';
export const supplyMission = '00000000-0000-4000-8000-0000000000b1';
export const supplyCandidate = '00000000-0000-4000-8000-0000000000c1';

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

export async function startSupplyFixture(root = resolve('.')) {
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
      import{SiteFooterPlace}from ${source('apps/web/components/site-footer-place.tsx')};
      import{SupplyHub}from ${source('apps/web/app/operator/supply/supply-hub.tsx')};
      import{SupplyModeLine}from ${source('apps/web/app/operator/supply/supply-ui.tsx')};
      import{MissionCandidates}from ${source('apps/web/app/operator/supply/mission-candidates.tsx')};
      import{CandidateRecord}from ${source('apps/web/app/operator/supply/candidate-record.tsx')};
      import{DncPanel}from ${source('apps/web/app/operator/supply/dnc-panel.tsx')};
      import ${source('apps/web/app/operator/supply/supply.css')};
      const query = new URLSearchParams(location.search);
      const screen = query.get('screen') ?? 'hub';
      const role = query.get('role') ?? 'owner';
      const tenant = ${JSON.stringify(supplyTenant)};
      const mission = ${JSON.stringify(supplyMission)};
      const candidate = ${JSON.stringify(supplyCandidate)};
      const body =
        screen === 'mission' ? <MissionCandidates tenant={tenant} role={role} missionId={mission}/>
        : screen === 'candidate' ? <CandidateRecord tenant={tenant} role={role} missionId={mission} candidateId={candidate}/>
        : screen === 'dnc' ? <DncPanel tenant={tenant} role={role}/>
        : <SupplyHub tenant={tenant} role={role}/>;
      const title = screen === 'dnc' ? 'Do Not Contact' : screen === 'mission' ? 'Supply Candidates' : screen === 'candidate' ? 'Candidate' : 'Supply Sources';
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <div className="site-shell">
            <AppHeader kind="team" live={false} notifications brandMark={<BrandLockup/>}/>
            <TeamFrame urls ownerPage={false} problemReports={false}>
              <WorkspaceShell eyebrow="TEAM WORKSPACE" title={title}><SupplyModeLine real={false}/>{body}</WorkspaceShell>
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
                : 'const router={replace:()=>{},push:()=>{},refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return "/operator/supply"}export function useSearchParams(){return new URLSearchParams(location.search)}',
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
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Supply Sources</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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
