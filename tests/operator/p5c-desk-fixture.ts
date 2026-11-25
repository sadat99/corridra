import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// Team desk v4.1, units D17 (Settings), D18 (Inbox) and D19 (Supply), bundled from the source with the real
// stylesheets and served on a local port: the team header and left bar, then the page the address names.
// /operator/inbox is the Inbox page and /operator/supply... the Supply pages, each put together as its server
// page does (the same deskFrame call and the same body component); every other address is the workspace with
// the header operator-entry.tsx builds (operatorHeader). ?v41=on is CORRIDRA_UX_TEAM_DESK_V41 on; without it each
// page is the one the desk has today (and the Inbox page does not exist). Reads are answered by the caller.
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

export const fixtureMission = '00000000-0000-4000-8000-0000000000b1';
export const fixtureCandidate = '00000000-0000-4000-8000-0000000000c1';

export async function startP5cFixture(root = resolve('.')) {
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
      import{operatorHeader,deskFrame}from ${source('apps/web/components/ux/desk-frame.tsx')};
      import{InboxLists}from ${source('apps/web/app/operator/inbox/inbox-lists.tsx')};
      import{canOpenInbox}from ${source('apps/web/lib/ux/team-inbox.ts')};
      import{AccessState}from ${source('apps/web/components/access-state.tsx')};
      import{SupplyHub}from ${source('apps/web/app/operator/supply/supply-hub.tsx')};
      import{SupplyModeLine}from ${source('apps/web/app/operator/supply/supply-ui.tsx')};
      import{MissionCandidates}from ${source('apps/web/app/operator/supply/mission-candidates.tsx')};
      import{CandidateRecord}from ${source('apps/web/app/operator/supply/candidate-record.tsx')};
      import{DncPanel}from ${source('apps/web/app/operator/supply/dnc-panel.tsx')};
      import{TeamContextPublisher}from ${source('apps/web/components/ux/team-context-publisher.tsx')};
      import ${source('apps/web/app/operator/supply/supply.css')};
      import{SiteFooterPlace}from ${source('apps/web/components/site-footer-place.tsx')};
      import{OperatorFlags}from ${source('apps/web/app/operator/operator-flags.tsx')};
      import{Workspace}from ${source('apps/web/app/operator/workspace.tsx')};
      import{sectionForSlug}from ${source('apps/web/lib/operator-urls.ts')};
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
      const tenant = ${JSON.stringify(fixtureTenant)};
      const mission = ${JSON.stringify(fixtureMission)};
      const candidate = ${JSON.stringify(fixtureCandidate)};
      const path = location.pathname;
      let page;
      if (path === '/operator/inbox') {
        // apps/web/app/operator/inbox/page.tsx: the page does not exist with the switch off.
        const frame = deskFrame({ place: 'inbox', urls: true, ownerPage: false });
        page = !v41 ? <main id="main"><h1>This page could not be found.</h1></main> : (
          <WorkspaceShell title={frame.title} lead={frame.lead} className={'ux-operator-home ' + frame.className}>
            <TeamContextPublisher tenant={tenant} role={role}/>
            {canOpenInbox(role)
              ? <OperatorFlags replyReview={false} teamDeskV41><InboxLists tenant={tenant} role={role} problemReports={flag('reports') !== 'off'} programmeApplications={flag('applications') !== 'off'}/></OperatorFlags>
              : <AccessState kind="denied"><p>Only owners and admins can open the Inbox.</p></AccessState>}
          </WorkspaceShell>);
      } else if (path.startsWith('/operator/supply')) {
        // apps/web/app/operator/supply/supply-page.tsx and the four pages that use it.
        const screen = path.endsWith('/do-not-contact') ? 'supply-dnc' : path.includes('/candidates/') ? 'supply-candidate' : path.includes('/missions/') ? 'supply-mission' : 'supply';
        const title = { supply: 'Supply Sources', 'supply-dnc': 'Do Not Contact', 'supply-mission': 'Supply Candidates', 'supply-candidate': 'Candidate' }[screen];
        const frame = v41 ? deskFrame({ place: screen, urls: true, ownerPage: false, title }) : null;
        const body = screen === 'supply-mission' ? <MissionCandidates tenant={tenant} role={role} missionId={mission}/>
          : screen === 'supply-candidate' ? <CandidateRecord tenant={tenant} role={role} missionId={mission} candidateId={candidate}/>
          : screen === 'supply-dnc' ? <DncPanel tenant={tenant} role={role}/>
          : <SupplyHub tenant={tenant} role={role} desk={v41}/>;
        page = (
          <WorkspaceShell eyebrow={v41 ? undefined : 'TEAM WORKSPACE'} title={frame?.title ?? title} lead={frame?.lead} className={frame ? 'ux-operator-home ' + frame.className : ''}>
            <TeamContextPublisher tenant={tenant} role={role}/>
            <SupplyModeLine real={false}/>
            <OperatorFlags replyReview={false} supplySources teamDeskV41={v41}>{body}</OperatorFlags>
          </WorkspaceShell>);
      } else {
        // The same function operator-entry.tsx calls, so the header here is the header of the page.
        const header = operatorHeader({ shellsV2: true, urls: true, teamDeskV41: v41, section, ownerPage });
        page = (
          <WorkspaceShell eyebrow={header.eyebrow} title={header.title} lead={header.lead} className={header.className}>
            <TeamSecondLevel urls ownerPage={ownerPage}/>
            {header.segments}
            <OperatorFlags replyReview={false} teamDeskV41={v41}>
              <Workspace tenants={[{id:tenant,name:'Synthetic request operations',role:role}]}
                initialTenant={tenant} initialSection={section} shellsV2 ownerPage={ownerPage}
                problemReports={flag('reports') !== 'off'} programmeApplications={flag('applications') !== 'off'}/>
            </OperatorFlags>
          </WorkspaceShell>);
      }
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <div className="site-shell">
            <AppHeader kind="team" live={false} notifications brandMark={<BrandLockup/>}/>
            <TeamFrame urls ownerPage={ownerPage} problemReports={flag('reports') !== 'off'} deskV41={v41} supply>
              {page}
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
    // The flag pictures are static files the fixture serves itself (see /flags/ below), not modules to bundle.
    external: ['/flags/*'],
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
    if (/^\/flags\/[a-z]+\.svg$/.test(path)) {
      res.setHeader('content-type', 'image/svg+xml');
      res.end(readFileSync(resolve('apps/web/public/flags', basename(path))));
    } else if (path.startsWith('/fonts/')) {
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
