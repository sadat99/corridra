import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The customer Room's vertical stage timeline (AC/1) must not reach the organiser programme room, which
// shares the .room-stage wrapper and the stage bar and keeps its horizontal bar. Names are invented.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const programmeId = '00000000-0000-4000-8000-000000000002';
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const programme = {
  id: programmeId,
  workspaceId,
  name: 'Synthetic commercial delegation',
  reportingPurpose: 'Fictional participant needs and commercial objectives',
  createdAt: '2026-10-18T00:00:00Z',
  synthetic: true,
};

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{CustomerProgrammes}from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};
      import{ProgrammeRoomStyles}from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-room-styles.tsx'))};
      const q=new URLSearchParams(location.search);
      const room=q.get('room')==='1';
      const bare=q.get('bare')==='1';
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace">
          <h1>Plan delegations</h1>
          {room&&<ProgrammeRoomStyles/>}
          <CustomerProgrammes subject="synthetic-alice" issuer=${JSON.stringify(issuer)} workspaceId=${JSON.stringify(workspaceId)}
            participantsEnabled={!bare} coordinationEnabled={!bare} termsEnabled={!bare} economicsEnabled={!bare}
            templatesEnabled={false} roomEnabled={room} projectionsEnabled={q.get('proj')==='1'}/>
        </main>);`,
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
                : 'const router={replace:()=>{},refresh:()=>{},push:()=>{}};export function useRouter(){return router}',
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
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Programme fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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
type Meetings = {
  state: 'NOT_SHARED' | 'UNAVAILABLE' | 'AVAILABLE' | 'PARTIAL';
  sharedLinks: number;
  unavailableLinks: number;
  participantsSharing: number;
  scheduled: number | null;
  qualifiedHeld: number | null;
};
const projection = (meetings: Meetings) => ({
  workspaceId,
  programmeId,
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  sendsMessages: false,
  readiness: { activeParticipants: 4, readyParticipants: 1, definition: 'x' },
  companies: [],
  nextAfter: null,
  context: null,
  agenda: [],
  conflicts: [],
  meetings,
});

const none: Meetings = {
  state: 'NOT_SHARED',
  sharedLinks: 0,
  unavailableLinks: 0,
  participantsSharing: 0,
  scheduled: null,
  qualifiedHeld: null,
};
async function open(
  page: Page,
  query: string,
  meetings?: Meetings,
  extra: { body?: Record<string, unknown>; economics?: Record<string, unknown> } = {},
) {
  await page.route('**/api/customer-programme-*', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  if (meetings)
    await page.route('**/api/customer-programme-projections**', (route) =>
      route.fulfill({ json: { ...projection(meetings), ...extra.body } }),
    );
  if (extra.economics)
    await page.route('**/api/customer-programme-economics**', (route) => {
      const view = new URL(route.request().url()).searchParams.get('view');
      return route.fulfill({
        json:
          view === 'summary'
            ? extra.economics
            : {
                workspaceId,
                programmeId,
                entries: [],
                nextBefore: null,
                expiresAt: new Date(Date.now() + 600000).toISOString(),
              },
      });
    });
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
    }),
  );
  await page.goto(`${origin}/?${query}`);
  await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
}
test('the organiser programme room keeps its horizontal stage bar at 1440', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'room=1&proj=1', none);
  const items = page.locator('.programme-stage .mr-stage > li');
  await expect(items).toHaveCount(6);
  const boxes = await items.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y) };
    }),
  );
  expect(new Set(boxes.map((b) => b.y)).size).toBe(1);
  expect(new Set(boxes.map((b) => b.x)).size).toBe(6);
});
