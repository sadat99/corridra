import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ADR-087 U1q (owner, 17 November 2026, relayed: "Yes, hide from viewers"): the commercial mission page and the delivery
// experience approval list, mounted with the real components and the answers the services give each role. A viewer
// receives each quotation with its terms, uncertainties and reason null and sees "Not available for your role" in their
// place, with the supplier, currency and revision still shown; an operator sees the terms. No database.
let server: Server, origin: string;
let bundle = '',
  componentCss = '';
const tenant = '11111111-1111-4111-8111-111111111111';
const mission = '33333333-3333-4333-8333-333333333333';
const quoteId = '55555555-5555-4555-8555-555555555555';
const targetId = '66666666-6666-4666-8666-666666666666';
const requirementId = '77777777-7777-4777-8777-777777777777';
const uncertainty = 'Synthetic supplier uncertainty for the quotation terms check';
const leadTime = 'Synthetic lead time of forty days';
const reasonText = 'Synthetic recorded reason restating the quoted terms';
const hidden = 'Not available for your role';
const terms = {
  quantity: '100',
  unit: 'pieces',
  unitPriceMinor: '1234',
  totalPriceMinor: '123400',
  leadTime,
};

const quotation = (full: boolean) => ({
  id: quoteId,
  version: 1,
  mission_id: mission,
  rfq_id: '88888888-8888-4888-8888-888888888888',
  target_id: targetId,
  requirement_id: requirementId,
  revision: 2,
  currency: 'USD',
  created_at: '2026-11-17T08:00:00Z',
  source_id: '99999999-9999-4999-8999-999999999999',
  terms: full ? terms : null,
  uncertainties: full ? uncertainty : null,
  reason: full ? reasonText : null,
});
const comparison = (full: boolean) =>
  full
    ? {
        id: quoteId,
        currency: 'USD',
        requirementId,
        evidenceCurrent: true,
        terms,
        uncertainties: uncertainty,
        missing: ['specification'],
        differences: [],
        status: 'NOT COMPARABLE',
        inconsistentTotal: false,
        expired: false,
        derivedTotal: null,
      }
    : {
        id: quoteId,
        currency: 'USD',
        requirementId,
        evidenceCurrent: true,
        terms: null,
        uncertainties: null,
        missing: null,
        differences: null,
        status: null,
        inconsistentTotal: null,
        expired: null,
        derivedTotal: null,
      };
const commercial = (role: string, full: boolean) => ({
  role,
  mission: { id: mission, version: 1, created_at: '2026-11-17T07:00:00Z' },
  assignments: [],
  requirements: [],
  assessments: [],
  rfqs: [],
  quotations: [quotation(full)],
  decisions: [],
  schedules: [],
  meetings: [],
  targets: [{ id: targetId, name: 'Synthetic Supplier Works' }],
  owners: [],
  comparison: [comparison(full)],
});
const experience = (full: boolean) => ({
  targetOutreach: null,
  organisations: [],
  contexts: [],
  agenda: [],
  requirements: [],
  targets: [{ id: targetId, name: 'Synthetic Supplier Works' }],
  quotations: [
    {
      id: quoteId,
      target_id: targetId,
      currency: 'USD',
      revision: 2,
      uncertainties: full ? uncertainty : null,
    },
  ],
  links: [],
  rfqs: [],
  disclosures: [],
  specificationConfirmationsAvailable: false,
  responses: [],
});

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{DeliveryExperience}from ${JSON.stringify(resolve('apps/web/app/operator/delivery-experience.tsx'))};
      import{CommercialMission}from ${JSON.stringify(resolve('apps/web/app/operator/commercial-mission.tsx'))};
      import{OperatorFlags}from ${JSON.stringify(resolve('apps/web/app/operator/operator-flags.tsx'))};
      import{MissionPage}from ${JSON.stringify(resolve('apps/web/app/operator/[section]/[missionId]/mission-page.tsx'))};
      const q=new URLSearchParams(location.search);
      const role=q.get('role');
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page ux-workspace"><h1>Mission</h1>
        <OperatorFlags replyReview={false}>
        {q.get('page')==='mission'
          ?<MissionPage tenant="${tenant}" workspaceName="Sample team" missionId="${mission}" moveRecords={false}/>
          :q.get('page')==='experience'
          ?<DeliveryExperience role={role} tenant="${tenant}" programme="" mission="${mission}" participants={[]} publications={[]} owners={[]}/>
          :<CommercialMission tenant="${tenant}" missionId="${mission}"/>}</OperatorFlags></main>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    // The flag pictures are static files of the site, not modules to bundle.
    external: ['/flags/*'],
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'fixture-next',
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
                : 'export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>"/operator";export const useSearchParams=()=>new URLSearchParams();',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = readFileSync('apps/web/app/globals.css', 'utf8');
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/fixture.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end(css + '\n' + componentCss);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staff quotation terms</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

const teamMission = (role: string) => ({
  role,
  owners: [],
  missions: [
    {
      id: mission,
      status: 'OPEN',
      version: 1,
      reason: '',
      notice_version: 'v1',
      acknowledged_at: '2026-11-01T00:00:00.000Z',
      source_kind: 'SELF_SERVE',
      claim_status: 'SELF_DECLARED',
      country_code: 'ES',
      target_profile: null,
      owner_id: null,
      due_at: '2026-12-01T00:00:00.000Z',
      next_action: 'Call the buyer',
      route_label: null,
      brief: { company: 'Acme Textiles', objective: 'Sell', market: 'Spain', outcomes: [] },
    },
  ],
  total: 1,
  history: [],
  replies: [],
});

async function answer(page: Page, role: string, full: boolean) {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const json =
      url.pathname === '/api/workspace/commercial-mission'
        ? commercial(role, full)
        : url.pathname === '/api/workspace/mission-catalogue'
          ? { packs: [], types: [], requirements: [], assessments: [] }
          : url.pathname === '/api/workspace/workspace'
            ? { sources: [], claims: [] }
            : url.pathname === '/api/workspace/delivery'
              ? experience(full)
              : url.pathname === '/api/team-work/mission'
                ? teamMission(role)
                : url.pathname === '/api/workspace/meetings'
                  ? { meetings: [], meetingsTotal: 0, next: null }
                  : {};
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(json),
    });
  });
}

test('the commercial mission page shows a viewer that a quotation exists, never its terms', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'viewer', false);
  await page.goto(`${origin}/?page=commercial`);
  await page.getByRole('button', { name: 'Review Requirements, Offers and Visits' }).click();
  const table = page.getByRole('table', {
    name: 'Latest supplier quotations, original currencies',
  });
  await expect(table.getByRole('cell', { name: 'Synthetic Supplier Works' })).toBeVisible();
  await expect(table.getByRole('cell', { name: `USD · ${hidden}` })).toBeVisible();
  await page.getByText('Original offers and revision history (1)').click();
  await expect(page.getByText(/revision 2 · USD/)).toBeVisible();
  await expect(page.getByText(`Terms and uncertainty: ${hidden}`)).toBeVisible();
  for (const words of [uncertainty, leadTime, reasonText, '12.34', '1,234.00'])
    await expect(page.getByText(words)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the commercial mission page shows an operator the quoted terms', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'operator', true);
  await page.goto(`${origin}/?page=commercial`);
  await page.getByRole('button', { name: 'Review Requirements, Offers and Visits' }).click();
  const table = page.getByRole('table', {
    name: 'Latest supplier quotations, original currencies',
  });
  await expect(table.getByText(uncertainty)).toBeVisible();
  await page.getByText('Original offers and revision history (1)').click();
  await expect(page.getByText(`Uncertainty: ${uncertainty}`)).toBeVisible();
  await expect(page.getByText(new RegExp(reasonText))).toBeVisible();
  await expect(page.getByText(hidden)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the participant approval list shows a viewer each quotation without its uncertainties', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'viewer', false);
  await page.goto(`${origin}/?page=experience&role=viewer`);
  await page.getByText('Approve participant mission detail').click();
  const list = page.getByRole('group', { name: 'Explicitly approved quotations' });
  await expect(
    list.getByText(`Synthetic Supplier Works · USD · revision 2 · ${hidden}`),
  ).toBeVisible();
  await expect(page.getByText(uncertainty)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the participant approval list shows an operator the quotation uncertainties', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'operator', true);
  await page.goto(`${origin}/?page=experience&role=operator`);
  await page.getByText('Approve participant mission detail').click();
  const list = page.getByRole('group', { name: 'Explicitly approved quotations' });
  await expect(
    list.getByText(`Synthetic Supplier Works · USD · revision 2 · ${uncertainty}`),
  ).toBeVisible();
  await expect(list.getByText(hidden)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the mission page Quotes list shows a viewer the currency and no money', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'viewer', false);
  await page.goto(`${origin}/?page=mission`);
  await page.getByRole('tab', { name: 'Quotes' }).click();
  const item = page.getByRole('listitem').filter({ hasText: 'Synthetic Supplier Works' });
  await expect(item).toContainText(`revision 2 · USD · ${hidden}`);
  await expect(item).not.toContainText('1,234');
  await expect(item).not.toContainText('total');
  await expect(item).not.toContainText('per unit');
  expect(errors).toEqual([]);
});

test('the mission page Quotes list shows an operator the quoted total', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await answer(page, 'operator', true);
  await page.goto(`${origin}/?page=mission`);
  await page.getByRole('tab', { name: 'Quotes' }).click();
  const item = page.getByRole('listitem').filter({ hasText: 'Synthetic Supplier Works' });
  await expect(item).toContainText('1,234');
  await expect(item).toContainText('total');
  await expect(item).not.toContainText(hidden);
  expect(errors).toEqual([]);
});
