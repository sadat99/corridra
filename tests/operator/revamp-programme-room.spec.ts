import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Wave 5 organiser room, browser cases C-09 and C-10 (docs/revamp/specs/programme-consent.md). The real
// programme list and room with the real stylesheet, every API answering "unavailable" calmly, so what is
// counted is the room's own structure: which views there are, which ids and links they expose, and that each
// original view is still reachable. The views are opened generically (every button of the group), so the check
// holds however the views are grouped. Names are invented; nothing is real. Sensitive: yes (consent).
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

async function open(page: Page, query: string) {
  await page.route('**/api/customer-programme-*', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
    }),
  );
  await page.goto(`${origin}/?${query}`);
  await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
}

// Opens every view the room offers, whatever it is called, and reports the room's structure.
async function structure(page: Page) {
  const room = page.getByRole('article', { name: programme.name });
  const views = room.getByRole('group', { name: 'Programme views' });
  const labels = await views.getByRole('button').allInnerTexts();
  const count = await views.getByRole('button').count();
  for (let index = 0; index < count; index++) await views.getByRole('button').nth(index).click();
  return page
    .evaluate(
      ({ id }) => {
        const room = document.querySelector('article.programme-room')!;
        const sections = Array.from(room.querySelectorAll(`section[id^="${id}-"]`)).map(
          (node) => node.id,
        );
        const ids = Array.from(room.querySelectorAll('[id]'))
          .map((node) => node.id)
          .sort();
        const links = Array.from(room.querySelectorAll('a[href]'))
          .map((node) => node.getAttribute('href')!)
          .sort();
        const controls = Array.from(room.querySelectorAll('.room-lens')).map(
          (node) => node.getAttribute('aria-controls') ?? '',
        );
        return { sections, ids, links, controls };
      },
      { id: programmeId },
    )
    .then((found) => ({ labels, ...found }));
}

// The old five views, with the projections switch off: exactly these labels, in this order, and these sections.
const oldFive = ['Overview', 'People', 'Plan and report', 'Terms and places', 'Money'];
const oldKeys = ['overview', 'people', 'plan', 'terms', 'money'];

const frozenIds = ['overview', 'people', 'companies', 'agenda', 'plan', 'terms', 'money'];
const frozenLinks: string[] = [];

test('C-10 with the projections switch off the room has the old five views and no company, agenda or count view', async ({
  page,
}) => {
  await open(page, 'room=1&proj=0');
  const found = await structure(page);
  expect(found.labels).toEqual(oldFive);
  expect(found.sections.sort()).toEqual(oldKeys.map((key) => `${programmeId}-${key}`).sort());
  for (const absent of ['companies', 'agenda'])
    expect(found.sections).not.toContain(`${programmeId}-${absent}`);
  await expect(
    page.getByRole('heading', { name: /Companies and readiness|Timed agenda/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/Meeting counts are/)).toHaveCount(0);
  await expect(page.locator('[aria-label="Programme company and meeting sharing"]')).toHaveCount(0);
});

test('C-09 every original room view stays reachable, with its section id, and no id or link is lost', async ({
  page,
}) => {
  await open(page, 'room=1&proj=1');
  const found = await structure(page);
  // The five original views and the two projection views: each one still has its section and is reachable
  // from a button that controls it.
  const keys = [...oldKeys, 'companies', 'agenda'];
  for (const key of keys) {
    expect(found.sections, key).toContain(`${programmeId}-${key}`);
    expect(found.controls, key).toContain(`${programmeId}-${key}`);
  }
  expect(found.ids).toEqual(expect.arrayContaining(keys.map((key) => `${programmeId}-${key}`)));
  // No id or link of the room as it was before the regroup is gone. Frozen on 4 Nov 2026 from the room before
  // Wave 5, with every API answering unavailable: the room's own seven section ids and no links. The panels
  // inside are not touched by the regroup and have their own id and link tests.
  for (const id of frozenIds) expect(found.ids, id).toContain(`${programmeId}-${id}`);
  for (const href of frozenLinks) expect(found.links, href).toContain(href);
});
