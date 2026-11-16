import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Audit fixes 1, customer set (owner-approved packet, 16 Nov 2026), proved in the real signed-in frame (left-nav.tsx
// with the customer sidebar) and the real stylesheets on a small bundled page, with every read answered by the test.
//   20  a programme room (/account/delegations/<workspace id>) marks Programmes in the sidebar, never Requests;
//   22  on a desktop the request room's stage timeline starts on the same line as the left column;
//   23  each journey has one colour: the sidebar dot, the room tag and the Home tag agree;
//   28  Shared With Me gets a Refresh once a shared mission is open, and Refresh reads every open mission again
//       in place, keeping a typed evidence response and a retained retry.
// AUDIT_SHOTS_DIR=<folder> also writes screenshots at 360, 390, 768, 1280 and 1440. Every name is invented.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = [
  'app/globals.css',
  'components/ux/shells.css',
  'components/ux/team-nav.css',
  'components/ux/left-nav.css',
  'components/ux/customer-bar.css',
  'components/ux/customer-rail.css',
  'app/account/move/move-view.css',
]
  .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
  .join('\n');
const shots = process.env.AUDIT_SHOTS_DIR;
const widths = [360, 390, 768, 1280, 1440];

const requestId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '0f8fad5b-d9cb-469f-a165-70867728950e';
const token = 'c'.repeat(64);

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{LeftNavFrame,LeftNavMenuButton}from ${JSON.stringify(resolve('apps/web/components/ux/left-nav.tsx'))};
      import{CustomerSideNav}from ${JSON.stringify(resolve('apps/web/components/ux/customer-rail.tsx'))};
      import{WorkspaceShell}from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
      import{RoomView}from ${JSON.stringify(resolve('apps/web/app/account/rooms/[requestId]/room-view.tsx'))};
      import{CustomerMissions}from ${JSON.stringify(resolve('apps/web/app/account/customer-missions.tsx'))};
      const q=new URLSearchParams(location.search);
      const words={navLabel:'Customer navigation',menuLabel:'Menu',closeLabel:'Close menu',collapseLabel:'Collapse menu',expandLabel:'Expand menu'};
      const items=[
        {key:'home',label:'Home',href:'/account/move',icon:'home'},
        {key:'requests',label:'Requests',href:'/account?view=work',icon:'mission'},
        {key:'reports',label:'Reports',href:'/account?view=results',icon:'document'},
      ];
      const journeys=[
        {key:'journey-source',label:'Sourcing',href:'/account/move?journey=source',tone:'action',lead:true},
        {key:'journey-organise',label:'Organising',href:'/account/move?journey=organise',tone:'positive'},
        {key:'journey-sell',label:'Selling',href:'/account/move?journey=sell',tone:'ornament'},
      ];
      const groups=[
        {key:'programmes',label:'Programmes',href:'/account/delegations/organise',icon:'trip'},
        {key:'registrations',label:'Registrations',href:'/account/delegations',icon:'people'},
      ];
      const mode=q.get('mode');
      const body=mode==='room'
        ? <RoomView {...JSON.parse(q.get('props'))}/>
        : mode==='shared'
          ? <CustomerMissions/>
          : <p>Programme room page.</p>;
      createRoot(document.getElementById('menu')).render(<LeftNavMenuButton/>);
      createRoot(document.getElementById('app')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <LeftNavFrame navId="customer-navigation" words={words}
            nav={<CustomerSideNav id="customer-navigation" label="Customer navigation" items={items} current={q.get('current')??'requests'} journeys={journeys} groups={groups}/>}>
            <WorkspaceShell customer title={<span className="sr-only">Your request, in one place.</span>}>
              {body}
            </WorkspaceShell>
          </LeftNavFrame>
        </LanguageProvider>);`,
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
                : 'const router={replace:()=>{},push:()=>{},refresh:()=>{}};export function useRouter(){return router}export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);',
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
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer fixture</title><link rel="stylesheet" href="/app.css"></head><body><div class="site-shell"><header class="site-header ux-app-header"><div id="menu"></div></header><div id="app"></div></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

async function shot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

const roomDetail = {
  id: requestId,
  synthetic: true,
  available: true,
  original: { objective: 'Automatic fabric cutting machine', market: 'China' },
  progress: { status: 'MEETINGS', receivedAt: '2026-10-02T09:00:00Z', replies: [] },
};
// The room names a journey from the stored objective, as the intake writes it.
const objectives = {
  source: 'Source suppliers',
  sell: 'Sell in a new market',
  organise: 'Run a multi-company mission',
} as const;
async function openRoom(page: Page, width: number, journey?: keyof typeof objectives) {
  await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
  await page.route('**/api/customer-requests/**', (route) =>
    route.fulfill({
      json: journey
        ? { ...roomDetail, original: { ...roomDetail.original, objective: objectives[journey] } }
        : roomDetail,
    }),
  );
  await page.route('**/api/customer-saved-missions', (route) =>
    route.fulfill({ status: 404, json: { error: 'unavailable' } }),
  );
  const props = {
    requestId,
    subject: 'subject-1',
    issuer: 'https://example.invalid/corridra/auth',
    link: { reportAvailable: false, savedResourceId: null },
    serviceRequestsEnabled: false,
    decisionsEnabled: false,
    lenses: true,
    trip: false,
  };
  await page.goto(
    `${origin}/account/rooms/${requestId}?mode=room&props=${encodeURIComponent(JSON.stringify(props))}`,
  );
  await expect(page.locator('.room-stage .mr-stage')).toBeVisible();
}

test.describe('20: a programme room belongs to Programmes in the sidebar', () => {
  for (const width of [390, 1440]) {
    test(`at ${width} Programmes is current and Requests is not`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
      await page.goto(`${origin}/account/delegations/${workspaceId}?mode=nav&current=requests`);
      if (width < 1024) await page.locator('[data-leftnav-opener]').click();
      const nav = page.locator('#customer-navigation');
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Programmes' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(nav.getByRole('link', { name: 'Requests' })).not.toHaveAttribute(
        'aria-current',
        'page',
      );
      await shot(page, `20-programme-room-nav-${width}`);
    });
  }
});

test.describe('22: the request room stage lines up with the left column on a desktop', () => {
  for (const width of [1280, 1440]) {
    test(`at ${width} the stage timeline and the journey tags start on one line`, async ({
      page,
    }) => {
      await openRoom(page, width);
      const tops = await page.evaluate(() => {
        const top = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect().top;
        return {
          stage: top('.room-head > .room-stage'),
          tags: top('.room-head > .room-tags'),
          header: document.querySelector('.site-header')!.getBoundingClientRect().bottom,
        };
      });
      test.info().annotations.push({
        type: 'measure',
        description: `stage ${tops.stage - tops.header}px and tags ${tops.tags - tops.header}px below the top bar`,
      });
      expect(Math.abs(tops.stage - tops.tags)).toBeLessThanOrEqual(1);
      // 24 px from the top bar to the first thing on the page (ui-direction, Sizes in use).
      expect(Math.abs(tops.stage - tops.header - 24)).toBeLessThanOrEqual(1);
      await shot(page, `22-room-${width}`);
    });
  }
  for (const width of [360, 390, 768]) {
    test(`at ${width} the stage stays under the title`, async ({ page }) => {
      await openRoom(page, width);
      const order = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        return { title: box('.room-head > h2').bottom, stage: box('.room-head > .room-stage').top };
      });
      expect(order.stage).toBeGreaterThanOrEqual(order.title);
      await shot(page, `22-room-${width}`);
    });
  }
});

test.describe('23: one colour per journey', () => {
  test('the sidebar dot, the room tag and the Home tag of a journey share one colour, and the tags pass axe', async ({
    page,
  }) => {
    for (const journey of ['source', 'sell', 'organise'] as const) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await openRoom(page, 1440, journey);
      const colours = await page.evaluate((j) => {
        const sample = document.createElement('span');
        sample.className = 'move-tag';
        sample.dataset.journey = j;
        sample.textContent = j;
        document.body.append(sample);
        const tone = j === 'sell' ? 'ornament' : j === 'organise' ? 'positive' : 'action';
        const dot = document.querySelector(`.ux-customer-nav-dot[data-tone='${tone}']`)!;
        const tag = document.querySelector('.room-tag')!;
        const out = {
          tagJourney: tag.getAttribute('data-journey'),
          dot: getComputedStyle(dot).backgroundColor,
          homeDot: getComputedStyle(sample, '::before').backgroundColor,
          homeText: getComputedStyle(sample).color,
          roomText: getComputedStyle(tag).color,
        };
        sample.remove();
        return out;
      }, journey);
      expect(colours.tagJourney).toBe(journey);
      // The sidebar dot and the Home dot are the journey colour; the room tag and the Home tag words share one ink.
      expect(colours.homeDot).toBe(colours.dot);
      expect(colours.roomText).toBe(colours.homeText);
      expect(await axe(page)).toEqual([]);
      await shot(page, `23-room-tag-${journey}-1440`);
    }
  });
});

test.describe('28: Shared With Me reads open missions again', () => {
  for (const width of widths) {
    test(`at ${width} Refresh appears once a mission is open and reads it again`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
      let reads = 0;
      await page.route('**/api/customer-missions*', (route) => {
        reads += 1;
        return route.fulfill({ status: 404, json: { error: 'unavailable' } });
      });
      await page.goto(`${origin}/account?mode=shared&current=reports`);
      const section = page.getByRole('region', { name: 'Shared missions' });
      await expect(section.getByRole('heading', { name: 'Shared missions' })).toBeVisible();
      // Nothing open: nothing to read again, so no Refresh.
      await expect(section.getByRole('button', { name: 'Refresh shared missions' })).toHaveCount(0);
      await shot(page, `28-shared-empty-${width}`);
      await section.getByLabel('Private mission invitation').fill(`${origin}/client#${token}`);
      await section.getByRole('button', { name: 'Open Shared Mission' }).click();
      await expect(section.getByRole('heading', { name: 'Mission invitation 1' })).toBeVisible();
      await expect.poll(() => reads).toBeGreaterThan(0);
      const refresh = section.getByRole('button', { name: 'Refresh shared missions' });
      await expect(refresh).toBeVisible();
      await expect(refresh).toHaveText('Refresh');
      if (width <= 768) expect((await refresh.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const before = reads;
      await refresh.click();
      await expect.poll(() => reads).toBeGreaterThan(before);
      expect(await axe(page)).toEqual([]);
      await shot(page, `28-shared-open-${width}`);
    });
  }
});

// An invented approved report with one open evidence request, as /api/customer-missions answers a view.
const sharedReport = {
  schemaVersion: 1,
  scopeId: 'scope-1',
  audience: 'CLIENT_PROGRESS',
  purpose: 'synthetic_validation',
  programme: 'Invented Textile Mission',
  generatedAt: '2026-11-10T09:00:00Z',
  expiresAt: '2026-12-10T09:00:00Z',
  allowExport: false,
  approvedParticipants: 1,
  approvedCompanies: 1,
  qualifiedCounterparties: 0,
  totals: [],
  attribution: 'Prepared by Corridra from approved records.',
  missions: [
    {
      publicationId: 'publication-1',
      title: 'Fabric buyers',
      company: 'Invented Mills',
      objective: 'Meet fabric buyers',
      brief: 'An invented brief.',
      nextAction: 'Send the fabric sample list',
      dueAt: '2026-11-20T09:00:00Z',
      reviewedAt: '2026-11-09T09:00:00Z',
      status: 'ACTIVE',
      updatedAt: '2026-11-09T09:00:00Z',
      itinerary: [],
      outcomes: {
        opportunities: 0,
        qualified: 0,
        proposals: 0,
        contracts: 0,
        rfqs: 0,
        samples: 0,
        heldMeetings: 0,
      },
      totals: [],
      requests: [
        {
          id: 'request-1',
          title: 'Sample list',
          instructions: 'List the fabric samples you will bring.',
          dueAt: '2026-11-20T09:00:00Z',
          status: 'OPEN',
        },
      ],
    },
  ],
};

test.describe('28: Refresh keeps a typed evidence response and a retained retry', () => {
  for (const width of [390, 1280]) {
    test(`at ${width} Refresh reads again without dropping the draft`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
      let views = 0;
      await page.route('**/api/customer-missions*', (route) => {
        const input = route.request().postDataJSON();
        if (input.action === 'respond')
          return route.fulfill({ status: 503, json: { error: 'Invented interruption' } });
        views += 1;
        return route.fulfill({ json: sharedReport });
      });
      await page.goto(`${origin}/account?mode=shared&current=reports`);
      const section = page.getByRole('region', { name: 'Shared missions' });
      await section.getByLabel('Private mission invitation').fill(`${origin}/client#${token}`);
      await section.getByRole('button', { name: 'Open Shared Mission' }).click();
      const response = section.getByLabel('Response', { exact: true });
      await expect(response).toBeVisible();
      const draft = 'Twelve invented fabric samples.';
      await response.fill(draft);
      const refresh = section.getByRole('button', { name: 'Refresh shared missions' });
      let before = views;
      await refresh.click();
      await expect.poll(() => views).toBeGreaterThan(before);
      await expect(response).toHaveValue(draft);
      // A send that fails is kept for the same retry; Refresh must not drop it either.
      await section.getByLabel('This response is my declaration', { exact: false }).check();
      await section.getByRole('button', { name: 'Send response' }).click();
      const retry = section.getByRole('button', { name: 'Retry same evidence response' });
      await expect(retry).toBeVisible();
      before = views;
      await refresh.click();
      await expect.poll(() => views).toBeGreaterThan(before);
      await expect(retry).toBeVisible();
      await expect(response).toHaveValue(draft);
    });
  }
});

test('28: a mission opened after Refresh reads once with its own token', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const second = 'd'.repeat(64);
  const views: string[] = [];
  await page.route('**/api/customer-missions*', (route) => {
    const input = route.request().postDataJSON();
    views.push(input.token);
    // A view without a valid token is refused, as the route refuses it.
    if (!/^[a-f0-9]{64}$/.test(input.token))
      return route.fulfill({ status: 400, json: { error: 'Check the submitted values' } });
    return route.fulfill({ json: sharedReport });
  });
  await page.goto(`${origin}/account?mode=shared&current=reports`);
  const section = page.getByRole('region', { name: 'Shared missions' });
  const invitation = section.getByLabel('Private mission invitation');
  await invitation.fill(`${origin}/client#${token}`);
  await section.getByRole('button', { name: 'Open Shared Mission' }).click();
  await expect(section.getByLabel('Response', { exact: true })).toBeVisible();
  const before = views.length;
  await section.getByRole('button', { name: 'Refresh shared missions' }).click();
  await expect.poll(() => views.length).toBeGreaterThan(before);
  await invitation.fill(`${origin}/client#${second}`);
  await section.getByRole('button', { name: 'Open Shared Mission' }).click();
  const mission = section.locator('article').filter({
    has: page.getByRole('heading', { name: 'Mission invitation 2' }),
  });
  await expect(mission.getByLabel('Response', { exact: true })).toBeEnabled();
  await expect(mission.getByRole('button', { name: 'Send response' })).toBeEnabled();
  await expect(mission.getByRole('alert')).toHaveCount(0);
  // Exactly one view for the new mission, sent with its own token, and none with an empty one.
  expect(views.filter((sent) => sent === second)).toHaveLength(1);
  expect(views.filter((sent) => sent !== token && sent !== second)).toEqual([]);
});

for (const first of ['report', 'failure'] as const)
  test(`28: a slow first read never overwrites a newer Refresh (held first ${first})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    let release: () => void = () => {};
    const held = new Promise<void>((done) => (release = done));
    let views = 0;
    await page.route('**/api/customer-missions*', async (route) => {
      views += 1;
      if (views === 1) {
        // The first load is held until the Refresh has answered, then answers with the older state.
        await held;
        return first === 'report'
          ? route.fulfill({ json: { ...sharedReport, programme: 'Older Textile Mission' } })
          : route.fulfill({ status: 503, json: { error: 'Invented slow failure' } });
      }
      return route.fulfill({ json: { ...sharedReport, programme: 'Newer Textile Mission' } });
    });
    await page.goto(`${origin}/account?mode=shared&current=reports`);
    const section = page.getByRole('region', { name: 'Shared missions' });
    await section.getByLabel('Private mission invitation').fill(`${origin}/client#${token}`);
    await section.getByRole('button', { name: 'Open Shared Mission' }).click();
    await expect.poll(() => views).toBe(1);
    await section.getByRole('button', { name: 'Refresh shared missions' }).click();
    await expect(section.getByText(/^Newer Textile Mission/)).toBeVisible();
    release();
    // Give the held answer time to arrive; it must change nothing.
    await page.waitForTimeout(500);
    await expect(section.getByText(/^Newer Textile Mission/)).toBeVisible();
    await expect(section.getByText(/Older Textile Mission/)).toHaveCount(0);
    await expect(section.getByRole('alert')).toHaveCount(0);
    await expect(section.getByLabel('Response', { exact: true })).toBeEnabled();
  });
