import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ADR-087 U1r (owner, 17 November 2026, relayed: "yes to both, drop the rest"): the evidence and sources panels and the
// commercial mission page, mounted with the real components and the answers the services give each role. A viewer receives
// a claim and verified fact linked to a quotation with the statement null, an evidence file on it marked withheld, and each
// selection with its rationale and next action null; the screens say "Not available for your role" in their place and offer
// no download. Unlinked evidence keeps its download. An operator sees everything. No database.
let server: Server, origin: string;
let bundle = '',
  componentCss = '';
const tenant = '11111111-1111-4111-8111-111111111111';
const mission = '33333333-3333-4333-8333-333333333333';
const targetId = '66666666-6666-4666-8666-666666666666';
const linkedClaim = '44444444-4444-4444-8444-444444444444';
const unlinkedClaim = '45555555-5555-4555-8555-555555555555';
const linkedFile = '46666666-6666-4666-8666-666666666666';
const unlinkedFile = '47777777-7777-4777-8777-777777777777';
const sourceId = '99999999-9999-4999-8999-999999999999';
const statement = 'Synthetic supplier declaration behind the quotation';
const unlinkedStatement = 'Synthetic unlinked claim stays readable';
const rationale = 'Synthetic selection rationale a viewer must not read';
const nextAction = 'Synthetic next action a viewer must not read';
const hidden = 'Not available for your role';

const snapshot = (role: string, full: boolean) => ({
  role,
  uploadsConfigured: false,
  scanMode: 'required',
  sources: [{ id: sourceId, locator: 'Synthetic supplier reply', kind: 'observation' }],
  claims: [
    {
      id: linkedClaim,
      source_id: sourceId,
      statement: full ? statement : null,
      status: 'SELF_DECLARED',
    },
    {
      id: unlinkedClaim,
      source_id: sourceId,
      statement: unlinkedStatement,
      status: 'SELF_DECLARED',
    },
  ],
  evidence: [
    {
      id: linkedFile,
      claim_id: linkedClaim,
      mime: 'application/pdf',
      status: 'UNDER_REVIEW',
      scan_status: 'CLEAN',
      ...(full ? {} : { withheld: true }),
    },
    {
      id: unlinkedFile,
      claim_id: unlinkedClaim,
      mime: 'image/png',
      status: 'UNDER_REVIEW',
      scan_status: 'CLEAN',
      ...(full ? {} : { withheld: false }),
    },
  ],
  facts: [{ id: '48888888-8888-4888-8888-888888888888', statement: full ? statement : null }],
});
const commercial = (role: string, full: boolean) => ({
  role,
  mission: { id: mission, version: 1, created_at: '2026-11-17T07:00:00Z' },
  assignments: [],
  requirements: [],
  assessments: [],
  rfqs: [],
  quotations: [],
  decisions: [
    {
      id: '49999999-9999-4999-8999-999999999999',
      target_id: targetId,
      decision: 'NEED_INFORMATION',
      rationale: full ? rationale : null,
      next_action: full ? nextAction : null,
      reason: 'Synthetic recorded reason',
      created_at: '2026-11-17T09:00:00Z',
    },
  ],
  schedules: [],
  meetings: [],
  targets: [{ id: targetId, name: 'Synthetic Supplier Works' }],
  owners: [],
  comparison: [],
});

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{CommercialMission}from ${JSON.stringify(resolve('apps/web/app/operator/commercial-mission.tsx'))};
      import{EvidencePanel}from ${JSON.stringify(resolve('apps/web/app/operator/evidence-panel.tsx'))};
      import{SourcesPanel}from ${JSON.stringify(resolve('apps/web/app/operator/sources-panel.tsx'))};
      import{OperatorFlags}from ${JSON.stringify(resolve('apps/web/app/operator/operator-flags.tsx'))};
      const q=new URLSearchParams(location.search);
      const page=q.get('page');
      const data=window.__snapshot;
      const none=()=>{};
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page ux-workspace"><h1>Workspace</h1>
        <OperatorFlags replyReview={false}>
        {page==='evidence'
          ?<EvidencePanel data={data} view="workspace-evidence" busy={false} tenant="${tenant}" flags={[]} act={async()=>true} request={async()=>({})}/>
          :page==='sources'
          ?<SourcesPanel data={data} view="workspace-sources" busy={false} source={none} claim={none} tenant="${tenant}"/>
          :<CommercialMission tenant="${tenant}" missionId="${mission}"/>}</OperatorFlags></main>);`,
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
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staff quotation evidence</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script>window.__snapshot=JSON.parse(decodeURIComponent(location.hash.slice(1)||"%7B%7D"))</script><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

async function open(page: Page, kind: string, role: string, full: boolean) {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const json =
      url.pathname === '/api/workspace/commercial-mission'
        ? commercial(role, full)
        : url.pathname === '/api/workspace/mission-catalogue'
          ? { packs: [], types: [], requirements: [], assessments: [] }
          : url.pathname === '/api/workspace/workspace'
            ? snapshot(role, full)
            : {};
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(json),
    });
  });
  await page.goto(
    `${origin}/?page=${kind}#${encodeURIComponent(JSON.stringify(snapshot(role, full)))}`,
  );
}

test('the evidence panel shows a viewer no quotation-linked claim and no download of its file', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 'evidence', 'viewer', false);
  await expect(page.getByText(`PDF for ${hidden}`)).toBeVisible();
  await expect(page.getByText(`Download: ${hidden}`)).toHaveCount(1);
  // The unlinked file keeps its download; the linked one offers none.
  await expect(page.getByRole('link', { name: 'Download evidence' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Download evidence' })).toHaveAttribute(
    'href',
    new RegExp(unlinkedFile),
  );
  await expect(page.getByText(`PNG image for ${unlinkedStatement}`)).toBeVisible();
  await expect(page.getByText(statement)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the evidence panel shows an operator both claims and both downloads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 'evidence', 'operator', true);
  await expect(page.getByText(`PDF for ${statement}`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download evidence' })).toHaveCount(2);
  await expect(page.getByText(hidden)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the sources panel shows a viewer the claim and verified fact rows without the linked statement', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 'sources', 'viewer', false);
  await expect(page.getByText(unlinkedStatement)).toBeVisible();
  // One claim row and one verified fact say the words in place of the statement.
  await expect(page.getByText(hidden)).toHaveCount(2);
  await expect(page.getByText(statement)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the sources panel shows an operator the linked statement', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 'sources', 'operator', true);
  await expect(page.getByText(statement)).toHaveCount(2);
  await expect(page.getByText(hidden)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the commercial mission page shows a viewer each selection without its rationale or next action', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 'commercial', 'viewer', false);
  await page.getByRole('button', { name: 'Review Requirements, Offers and Visits' }).click();
  await page.getByText('decisions (1)').click();
  await expect(page.getByText(new RegExp(`^${hidden} · 2026-11-17T09:00:00Z$`))).toBeVisible();
  await expect(page.getByText('NEED_INFORMATION')).toBeVisible();
  for (const words of [rationale, nextAction, 'Synthetic recorded reason'])
    await expect(page.getByText(words)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the commercial mission page shows an operator the selection rationale and next action', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 'commercial', 'operator', true);
  await page.getByRole('button', { name: 'Review Requirements, Offers and Visits' }).click();
  await page.getByText('decisions (1)').click();
  await expect(page.getByText(new RegExp(rationale))).toBeVisible();
  await expect(page.getByText(nextAction)).toBeVisible();
  await expect(page.getByText(hidden)).toHaveCount(0);
  expect(errors).toEqual([]);
});
