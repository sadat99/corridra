import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The real Meetings page in the real shell, for the page-length test (layout budget, docs/revamp/specs/layout-budget.md
// section 2: full document height over viewport height, header and footer included, real fonts). The real
// apps/web/app/account/meetings/page.tsx is bundled with the real CustomerShell, header, footer, language provider,
// globals.css and room-view.css. Only what a page cannot have outside a server is stood in: the session, the two loads
// (loadWorkItems and loadMeetings) and the module switches. The root layout adds the same parts around the page
// (header, footer, corner dock, language provider); they are composed here in the same order.

const web = resolve('apps/web');
const fontDir = resolve(web, 'app/fonts');
const bengaliRange = 'U+0951-0952,U+0964-0965,U+0980-09FE,U+200C-200D,U+20B9,U+25CC';
// The real layout loads these faces with next/font and defines the variables that --font-ui reads. Without them the
// whole --font-ui value is invalid and the text falls back to the browser default, which changes every length measured.
const fontFaces: [variable: string, family: string, file: string, range?: string][] = [
  ['--font-newsreader', 'Newsreader', 'newsreader-latin-variable.woff2'],
  ['--font-geist', 'Geist', 'geist-latin-variable.woff2'],
  ['--font-geist-mono', 'Geist Mono', 'geist-mono-latin-variable.woff2'],
  ['--font-bengali', 'Noto Serif Bengali', 'noto-serif-bengali-variable.woff2', bengaliRange],
  ['--font-bengali-sans', 'Noto Sans Bengali', 'noto-sans-bengali-variable.woff2', bengaliRange],
];
export const fontCss = `${fontFaces
  .map(
    ([, family, file, range]) =>
      `@font-face{font-family:'${family}';src:url('/fonts/${file}') format('woff2');font-weight:100 900;font-display:block;${range ? `unicode-range:${range};` : ''}}`,
  )
  .join(
    '\n',
  )}\n:root{${fontFaces.map(([variable, family]) => `${variable}:'${family}'`).join(';')}}`;

/** Serves a font file by name from apps/web/app/fonts. */
export function fontFile(path: string) {
  return readFileSync(resolve(fontDir, path.slice('/fonts/'.length).replace(/[^\w.-]/g, '')));
}

/** The person's requests as the work list returns them: one item per title, with the title null when it has none. */
export const requestItems = (titles: (string | null)[]) =>
  titles.map((title, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    return {
      key: `request:${id}`,
      kind: 'request',
      id,
      workspaceId: '00000000-0000-4000-8000-000000000900',
      family: 'SELL',
      title,
      status: '',
      at: '2026-10-01T00:00:00.000Z',
      atKind: 'created',
      href: `/account/rooms/${id}`,
    };
  });

export type RealPageState = {
  /** Workspaces and requests modules on. */
  readable: boolean;
  items: ReturnType<typeof requestItems>;
  listPartial: boolean;
  meetings: {
    rows: unknown[];
    notSaved: number;
    partial: boolean;
    capped: boolean;
    reportsOff: boolean;
  };
};

// What the page imports from the server, answered from the state the test passes in the address.
const stubs: Record<string, string> = {
  '@corridra/config': `export const readNeonAuthConfig=()=>({NEON_AUTH_BASE_URL:'https://auth.example'});`,
  '@corridra/auth/customer-requests': `export const customerRequestsEnabled=()=>globalThis.__w8.readable;`,
  '@corridra/auth/customer-workspaces': `export const customerWorkspacesEnabled=()=>globalThis.__w8.readable;`,
  'lib/neon-auth': `export const neonAuth=()=>({getSession:async()=>({data:{user:{id:'user-1',emailVerified:true}}})});`,
  'lib/work-items/load': `export const loadWorkItems=async()=>({items:globalThis.__w8.items,unreadable:[],partial:globalThis.__w8.listPartial,skippedWorkspaces:0,workspaces:[]});`,
  'lib/meetings/load': `export const meetingReportCap=12;export const loadMeetings=async()=>globalThis.__w8.meetings;`,
  // The shell asks these modules only whether they are on; the closed-account gate is off, so the frame is bare.
  '@corridra/auth/customer-production': `export const realUseEnabled=()=>false;`,
  '@corridra/auth/customer-billing': `export const customerBillingEnabled=()=>false;`,
  '@corridra/auth/customer-account-lifecycle': `export const customerAccountLifecycleEnabled=()=>false;`,
  '@corridra/auth/customer-companies': `export const customerCompaniesEnabled=()=>false;`,
  '@corridra/auth/customer-notifications': `export const customerNotificationsEnabled=()=>false;export const customerNotificationWithdrawalEnabled=()=>false;`,
  '@corridra/auth/customer-organisation-profiles': `export const customerOrganisationProfilesEnabled=()=>false;`,
};

const entry = `import{createRoot}from'react-dom/client';
import{LanguageProvider}from ${JSON.stringify(resolve(web, 'components/language-provider.tsx'))};
import{ShellHeader}from ${JSON.stringify(resolve(web, 'components/ux/shell-header.tsx'))};
import{SiteFooter}from ${JSON.stringify(resolve(web, 'components/site-footer.tsx'))};
import{CornerDock}from ${JSON.stringify(resolve(web, 'components/corner-dock.tsx'))};
import{SkipLink}from ${JSON.stringify(resolve(web, 'components/skip-link.tsx'))};
import{offeredLanguages}from ${JSON.stringify(resolve(web, 'lib/i18n/locales.ts'))};
import Page from ${JSON.stringify(resolve(web, 'app/account/meetings/page.tsx'))};
const state=JSON.parse(new URLSearchParams(location.search).get('state'));
globalThis.__w8={readable:state.readable,items:state.items,listPartial:state.listPartial,meetings:state.meetings};
const element=await Page();
createRoot(document.getElementById('root')).render(
  <LanguageProvider offered={offeredLanguages()}>
    <SkipLink/>
    <div className="site-shell">
      <ShellHeader shells notifications={false} live={false} accounts/>
      {element}
      <SiteFooter/>
      <CornerDock/>
    </div>
  </LanguageProvider>);`;

export type RealPage = { origin: string; close: () => Promise<void> };

/** Bundles the real page and serves it with the real stylesheets and fonts. */
export async function serveRealMeetingsPage(): Promise<RealPage> {
  const result = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: web },
    nodePaths: [resolve(web, 'node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    define: {
      'process.env': JSON.stringify({
        NODE_ENV: 'production',
        CORRIDRA_UX_SHELLS_V2: 'true',
        CORRIDRA_UX_ROAD: 'true',
        CORRIDRA_UX_TRIP: 'true',
        CORRIDRA_UX_LENSES: 'true',
      }),
    },
    plugins: [
      {
        name: 'w8-real-page',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'w8-stub',
          }));
          b.onResolve({ filter: /.*/ }, (args) => {
            const key = Object.keys(stubs).find(
              (name) =>
                args.path === name ||
                (name.startsWith('lib/') &&
                  resolve(args.resolveDir, args.path).endsWith(`/apps/web/${name}`)),
            );
            return key ? { path: key, namespace: 'w8-stub' } : undefined;
          });
          b.onLoad({ filter: /.*/, namespace: 'w8-stub' }, (args) => ({
            loader: 'tsx',
            resolveDir: web,
            contents:
              stubs[args.path] ??
              (args.path === 'next/link'
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : "const router={replace:()=>{},refresh:()=>{},push:()=>{},prefetch:()=>{}};export function useRouter(){return router}export function usePathname(){return '/account/meetings'}export function useSearchParams(){return new URLSearchParams(location.search)}export function notFound(){throw new Error('notFound')}export function redirect(to){throw new Error('redirect '+to)}"),
          }));
        },
      },
    ],
  });
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const bundleCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const globals = readFileSync(resolve(web, 'app/globals.css'), 'utf8');
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/page.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${globals}\n${bundleCss}\n${fontCss}`);
    } else if (path.startsWith('/fonts/')) {
      res.setHeader('content-type', 'font/woff2');
      res.end(fontFile(path));
    } else if (path.startsWith('/api/')) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    } else if (path.endsWith('.js')) {
      // The layout's language boot script: nothing to set up here.
      res.setHeader('content-type', 'text/javascript');
      res.end('');
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meetings</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/page.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Real page address missing');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** The address that opens the real page in a given state (and tab, when asked). */
export const realPageUrl = (page: RealPage, state: RealPageState, tab?: string) =>
  `${page.origin}/?state=${encodeURIComponent(JSON.stringify(state))}${tab ? `&tab=${tab}` : ''}`;

/** A long Chinese meeting name and place, the worst case for line breaks in the narrow column. */
export const longName = (n: number) =>
  `与孟加拉国服装制造商和出口商协会的会议编号${n}：在达卡商会大楼的长时间访问和工厂参观`;
export const longPlace = (n: number) =>
  `达卡商会 ${n} 号厅，摩提杰商业区，孟加拉国达卡 1000，Motijheel Commercial Area, Dhaka 1000 Bangladesh`;

const meetingRow = (
  items: ReturnType<typeof requestItems>,
  request: number,
  label: string,
  over = {},
) => ({
  requestId: items[request]!.id,
  requestTitle: items[request]!.title,
  savedResourceId: `00000000-0000-4000-8000-00000000${String(100 + request).padStart(4, '0')}`,
  label,
  changed: false,
  status: 'SCHEDULED',
  ...over,
});
const noMeetings = { rows: [], notSaved: 0, partial: false, capped: false, reportsOff: false };

/** Three meetings and two requests: the typical person. */
export function typicalState(): RealPageState {
  const items = requestItems(['Sell in Spain', 'Source from Bangladesh']);
  return {
    readable: true,
    items,
    listPartial: false,
    meetings: {
      ...noMeetings,
      rows: [
        meetingRow(items, 0, 'Visit to the Dhaka Chamber of Commerce', {
          startsAt: '2099-11-11T04:00:00Z',
          endsAt: '2099-11-11T06:30:00Z',
          timezone: 'Asia/Dhaka',
          location: 'Dhaka Chamber of Commerce',
        }),
        meetingRow(items, 1, 'Factory tour', {
          startsAt: '2099-11-13T04:00:00Z',
          timezone: 'Asia/Dhaka',
          location: 'Gazipur factory',
        }),
        meetingRow(items, 0, 'First introduction call', {
          startsAt: '2020-10-01T04:00:00Z',
          timezone: 'Asia/Dhaka',
          status: 'HELD',
        }),
      ],
    },
  };
}

/** Twelve long Chinese meetings across three requests: the longest page the cap allows. */
export function longChineseState(): RealPageState {
  const items = requestItems(['Sell in Spain', 'Source from Bangladesh', '向孟加拉国出口']);
  return {
    readable: true,
    items,
    listPartial: false,
    meetings: {
      ...noMeetings,
      rows: Array.from({ length: 12 }, (_, n) =>
        meetingRow(items, n % 3, longName(n), {
          startsAt: `2099-11-${11 + (n % 9)}T04:00:00Z`,
          endsAt: `2099-11-${11 + (n % 9)}T06:00:00Z`,
          timezone: 'Asia/Dhaka',
          location: longPlace(n),
        }),
      ),
    },
  };
}
