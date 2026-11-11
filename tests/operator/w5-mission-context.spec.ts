import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { MISSION_A, MISSION_B, NOTE, UNLISTED, commercial, listed } from './mission-hint-fixture';

// W5: operator section links keep the mission. The real components are mounted with the data their
// own endpoints return (mocked at the network edge). What is proved: the mission page links for
// "Find and add companies" and "Quotes and billing" carry the mission; the two sections preselect a
// mission that is in the list they already load; a malformed id is ignored; a mission that is not
// listed shows one plain note and changes nothing else; the person's own choice always wins; and
// nothing new is fetched. Meetings and delivery keep the links they had.
const TENANT = '99999999-9999-4999-8999-999999999999';

let server: Server, origin: string;
let bundle = '';

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{useState}from'react';
      import{Counterparties}from ${JSON.stringify(resolve('apps/web/app/operator/counterparties.tsx'))};
      import{CommercialProgress}from ${JSON.stringify(resolve('apps/web/app/operator/opportunities.tsx'))};
      import{MissionPage}from ${JSON.stringify(resolve('apps/web/app/operator/[section]/[missionId]/mission-page.tsx'))};
      const c=new URLSearchParams(location.search).get('c');
      const tenant=${JSON.stringify(TENANT)};
      // The team shell draws only the section in view, so leaving a section unmounts it. This stands in for that.
      function Leaving(){const[shown,setShown]=useState(true);return <>
        <button type="button" onClick={()=>setShown(!shown)}>{shown?'Leave the section':'Return to the section'}</button>
        {shown&&<Counterparties tenant={tenant} purpose="synthetic_validation"/>}</>}
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page">
          {c==='research'&&<Counterparties tenant={tenant} purpose="synthetic_validation"/>}
          {c==='commercial'&&<CommercialProgress tenant={tenant} revision={0}/>}
          {c==='both'&&<><Counterparties tenant={tenant} purpose="synthetic_validation"/><CommercialProgress tenant={tenant} revision={0}/></>}
          {c==='leaving'&&<Leaving/>}
          {c==='mission'&&<MissionPage tenant={tenant} workspaceName="Sample team" missionId=${JSON.stringify(MISSION_A)} moveRecords={false}/>}
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
                : 'const router={replace:()=>{},refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return "/operator"}export function useSearchParams(){return new URLSearchParams(location.search)}',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>W5 fixture</title></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

/** Answers the workspace endpoints the mounted section already uses, and records every request. */
async function mock(page: Page) {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    const json = (body: unknown) => route.fulfill({ json: body });
    switch (url.pathname) {
      case '/api/workspace/research':
        return json({ role: 'owner', total: 0, offset: 0, organisations: [] });
      case '/api/workspace/workspace':
        return json({ sources: [], claims: [] });
      case '/api/workspace/missions':
        return json({ missions: listed, owners: [], total: listed.length });
      case '/api/workspace/shortlist':
        return json({ targets: [], total: 0 });
      case '/api/workspace/opportunities':
        return json(commercial);
      case '/api/workspace/commercial-mission':
        return json({ quotations: [], targets: [] });
      case '/api/workspace/meetings':
        return json({ meetings: [], meetingsTotal: 0, next: null });
      case '/api/workspace/delivery':
        return json({ participants: [], publications: [], owners: [] });
      case '/api/team-work/mission':
        return json({
          role: 'owner',
          owners: [],
          missions: [
            {
              id: MISSION_A,
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
              brief: {
                company: 'Acme Textiles',
                objective: 'Sell',
                market: 'Spain',
                outcomes: ['Meet buyers'],
              },
            },
          ],
          total: 1,
          history: [],
          replies: [],
        });
      default:
        return json({});
    }
  });
  return { requests, errors };
}

// The links from a mission page name the section in the # part, so the section applies the hint.
const hashes: Record<string, string> = {
  research: '#workspace-research',
  commercial: '#workspace-commercial',
};
const open = (page: Page, component: string, mission?: string, hash = hashes[component] ?? '') =>
  page.goto(
    `${origin}/?c=${component}${mission === undefined ? '' : `&mission=${mission}`}${hash}`,
  );
const shortlistCalls = (requests: string[]) =>
  requests.filter((r) => r.startsWith('/api/workspace/shortlist'));
const filteredCommercial = (requests: string[]) =>
  requests.filter((r) => r.startsWith('/api/workspace/opportunities') && r.includes('&mission='));
const unfilteredCommercial = (requests: string[]) =>
  requests.filter((r) => r.startsWith('/api/workspace/opportunities') && !r.includes('&mission='));
const missionListCalls = (requests: string[]) =>
  requests.filter((r) => r.startsWith('/api/workspace/missions'));
// A filtered request is fired from an effect after the select changes, so it can arrive after the
// select already shows the value. A positive read therefore polls. A "nothing was asked" read first
// confirms the section's own first load was recorded (it is recorded before the options render, so
// this is a guard against a load that never happened), then waits for the network to go quiet. The
// quiet wait is what lets a late, effect-fired request arrive before the empty read.
const quiet = (page: Page) => page.waitForLoadState('networkidle');

test('W5-links: the mission page sends research and commercial links with the mission, and keeps the others', async ({
  page,
}) => {
  const seen = await mock(page);
  await open(page, 'mission');
  await page.getByRole('tab', { name: 'Companies' }).click();
  await expect(page.getByRole('link', { name: 'Find and add companies' })).toHaveAttribute(
    'href',
    `/operator?workspace=${TENANT}&mission=${MISSION_A}#workspace-research`,
  );
  await page.getByRole('tab', { name: 'Quotes' }).click();
  await expect(page.getByRole('link', { name: 'Quotes and billing' })).toHaveAttribute(
    'href',
    `/operator?workspace=${TENANT}&mission=${MISSION_A}#workspace-commercial`,
  );
  await page.getByRole('tab', { name: 'Meetings' }).click();
  await expect(page.getByRole('link', { name: 'Introductions and meetings' })).toHaveAttribute(
    'href',
    `/operator?workspace=${TENANT}#workspace-meetings`,
  );
  await page.getByRole('tab', { name: 'Delivery' }).click();
  await expect(
    page.getByRole('link', { name: 'Write, approve and share a report' }),
  ).toHaveAttribute('href', `/operator?workspace=${TENANT}#workspace-delivery`);
  await expect(page.getByRole('link', { name: 'All missions' })).toHaveAttribute(
    'href',
    `/operator?workspace=${TENANT}#workspace-missions`,
  );
  expect(seen.errors).toEqual([]);
});

test('W5-research: a listed mission is preselected and its shortlist is read', async ({ page }) => {
  const seen = await mock(page);
  await open(page, 'research', MISSION_A);
  const select = page.getByLabel('Shortlist mission');
  await expect(select).toHaveValue(MISSION_A);
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect.poll(() => shortlistCalls(seen.requests).length).toBe(1);
  expect(shortlistCalls(seen.requests)[0]).toContain(`mission=${MISSION_A}`);
  expect(seen.errors).toEqual([]);
});

test('W5-research: a malformed mission value is ignored', async ({ page }) => {
  const seen = await mock(page);
  await open(page, 'research', 'not-a-uuid');
  const select = page.getByLabel('Shortlist mission');
  await expect(select.locator('option')).toHaveCount(3);
  await expect(select).toHaveValue('');
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect.poll(() => missionListCalls(seen.requests).length).toBeGreaterThan(0);
  await quiet(page);
  expect(shortlistCalls(seen.requests)).toEqual([]);
});

test('W5-research: a mission that is not in the loaded list shows the note and changes nothing else', async ({
  page,
}) => {
  const seen = await mock(page);
  await open(page, 'research', UNLISTED);
  const select = page.getByLabel('Shortlist mission');
  await expect(select.locator('option')).toHaveCount(3);
  await expect(page.getByText(NOTE)).toHaveCount(1);
  await expect(select).toHaveValue('');
  await expect.poll(() => missionListCalls(seen.requests).length).toBeGreaterThan(0);
  await quiet(page);
  expect(shortlistCalls(seen.requests)).toEqual([]);
  // The person's own choice clears the note and wins.
  await select.selectOption(MISSION_B);
  await expect(select).toHaveValue(MISSION_B);
  await expect(page.getByText(NOTE)).toHaveCount(0);
});

test('W5-research: the person own later choice wins over the address', async ({ page }) => {
  const seen = await mock(page);
  await open(page, 'research', MISSION_A);
  const select = page.getByLabel('Shortlist mission');
  await expect(select).toHaveValue(MISSION_A);
  await select.selectOption(MISSION_B);
  await expect(select).toHaveValue(MISSION_B);
  await expect
    .poll(() => shortlistCalls(seen.requests).some((r) => r.includes(`mission=${MISSION_B}`)))
    .toBe(true);
  await select.selectOption('');
  await expect(select).toHaveValue('');
  await page.waitForTimeout(300);
  await expect(select).toHaveValue('');
});

test('W5-commercial: a listed mission is preselected through the existing mission filter', async ({
  page,
}) => {
  const seen = await mock(page);
  await open(page, 'commercial', MISSION_A);
  const select = page.getByLabel('Commercial report mission');
  await expect(select).toHaveValue(MISSION_A);
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect.poll(() => filteredCommercial(seen.requests).length).toBeGreaterThan(0);
  for (const request of filteredCommercial(seen.requests))
    expect(request).toContain(`&mission=${MISSION_A}`);
  expect(seen.errors).toEqual([]);
});

test('W5-commercial: a malformed mission value is ignored', async ({ page }) => {
  const seen = await mock(page);
  await open(page, 'commercial', 'not-a-uuid');
  const select = page.getByLabel('Commercial report mission');
  await expect(select.locator('option')).toHaveCount(3);
  await expect(select).toHaveValue('');
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect.poll(() => unfilteredCommercial(seen.requests).length).toBeGreaterThan(0);
  await quiet(page);
  expect(filteredCommercial(seen.requests)).toEqual([]);
});

test('W5-commercial: a mission that is not in the loaded list shows the note and changes nothing else', async ({
  page,
}) => {
  const seen = await mock(page);
  await open(page, 'commercial', UNLISTED);
  const select = page.getByLabel('Commercial report mission');
  await expect(select.locator('option')).toHaveCount(3);
  await expect(page.getByText(NOTE)).toHaveCount(1);
  await expect(select).toHaveValue('');
  await expect.poll(() => unfilteredCommercial(seen.requests).length).toBeGreaterThan(0);
  await quiet(page);
  expect(filteredCommercial(seen.requests)).toEqual([]);
  await select.selectOption(MISSION_B);
  await expect(select).toHaveValue(MISSION_B);
  await expect(page.getByText(NOTE)).toHaveCount(0);
});

test('W5-commercial: the person own later choice wins over the address', async ({ page }) => {
  await mock(page);
  await open(page, 'commercial', MISSION_A);
  const select = page.getByLabel('Commercial report mission');
  await expect(select).toHaveValue(MISSION_A);
  await select.selectOption(MISSION_B);
  await expect(select).toHaveValue(MISSION_B);
  await select.selectOption('');
  await expect(select).toHaveValue('');
  await page.waitForTimeout(300);
  await expect(select).toHaveValue('');
});

const researchSelect = (page: Page) => page.getByLabel('Shortlist mission');
const commercialSelect = (page: Page) => page.getByLabel('Commercial report mission');

test('W5-both: with both panels mounted, the hint opens only the section the address names', async ({
  page,
}) => {
  const seen = await mock(page);
  await open(page, 'both', MISSION_A, '#workspace-research');
  await expect(researchSelect(page)).toHaveValue(MISSION_A);
  await expect(commercialSelect(page).locator('option')).toHaveCount(3);
  await expect(commercialSelect(page)).toHaveValue('');
  await quiet(page);
  expect(filteredCommercial(seen.requests)).toEqual([]);
  await expect(page.getByText(NOTE)).toHaveCount(0);
  expect(seen.errors).toEqual([]);
});

test('W5-both: the other address opens only the Commercial section', async ({ page }) => {
  const seen = await mock(page);
  await open(page, 'both', MISSION_A, '#workspace-commercial');
  await expect(commercialSelect(page)).toHaveValue(MISSION_A);
  await expect(researchSelect(page).locator('option')).toHaveCount(3);
  await expect(researchSelect(page)).toHaveValue('');
  await quiet(page);
  expect(shortlistCalls(seen.requests)).toEqual([]);
});

test('W5-both: an unlisted mission shows the note only in the named section', async ({ page }) => {
  await mock(page);
  await open(page, 'both', UNLISTED, '#workspace-commercial');
  await expect(commercialSelect(page).locator('option')).toHaveCount(3);
  await expect(researchSelect(page).locator('option')).toHaveCount(3);
  await expect(page.getByText(NOTE)).toHaveCount(1);
  // The note sits right after the Commercial mission select, not after the Research one.
  await expect(
    page.locator('p[role="note"]').locator('xpath=preceding::select[1]').locator('option').first(),
  ).toHaveText('All accessible missions');
});

test('W5-both: an address that names no section opens neither', async ({ page }) => {
  await mock(page);
  await open(page, 'both', MISSION_A, '');
  await expect(researchSelect(page).locator('option')).toHaveCount(3);
  await expect(commercialSelect(page).locator('option')).toHaveCount(3);
  await expect(researchSelect(page)).toHaveValue('');
  await expect(commercialSelect(page)).toHaveValue('');
  await expect(page.getByText(NOTE)).toHaveCount(0);
});

test('W5-leaving: a section that is left and returned to does not apply the old hint again', async ({
  page,
}) => {
  const seen = await mock(page);
  await open(page, 'leaving', MISSION_A, '#workspace-research');
  await expect(researchSelect(page)).toHaveValue(MISSION_A);
  await researchSelect(page).selectOption(MISSION_B);
  await expect(researchSelect(page)).toHaveValue(MISSION_B);
  await page.getByRole('button', { name: 'Leave the section' }).click();
  await expect(researchSelect(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to the section' }).click();
  await expect(researchSelect(page).locator('option')).toHaveCount(3);
  await expect(researchSelect(page)).toHaveValue('');
  await quiet(page);
  await expect(researchSelect(page)).toHaveValue('');
  expect(
    shortlistCalls(seen.requests).filter((request) => request.includes(`mission=${MISSION_A}`)),
  ).toHaveLength(1);
});

test('W5-leaving: the note for an unlisted mission is not shown again on return', async ({
  page,
}) => {
  await mock(page);
  await open(page, 'leaving', UNLISTED, '#workspace-research');
  await expect(researchSelect(page).locator('option')).toHaveCount(3);
  await expect(page.getByText(NOTE)).toHaveCount(1);
  await page.getByRole('button', { name: 'Leave the section' }).click();
  await page.getByRole('button', { name: 'Return to the section' }).click();
  await expect(researchSelect(page).locator('option')).toHaveCount(3);
  await quiet(page);
  await expect(page.getByText(NOTE)).toHaveCount(0);
});
