import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Team desk v4.1, units D8, D9 and D10 (CORRIDRA_UX_TEAM_DESK_V41). The mission page and the company
// research section are bundled from the source with the real stylesheets, and every request is answered
// here, so no database is needed. `desk=on` hands the switch down the way the pages do; `desk=off` is the
// page as it is today, and the "off" tests hold it there. D8_ROOT bundles another checkout (an export of
// the commit before this change) in the same frame, which is how the "on" tests were shown to fail first.
// D8_SHOTS names a folder for screenshots at the six widths, switch off and on.
const root = resolve(process.env.D8_ROOT ?? '.');
const tenant = '00000000-0000-4000-8000-0000000000a1';
const mission = '00000000-0000-4000-8000-0000000000b2';
const otherMission = '00000000-0000-4000-8000-0000000000b3';
const namelessMission = '00000000-0000-4000-8000-0000000000b4';
const programmeId = '00000000-0000-4000-8000-0000000000d1';
const link = '00000000-0000-4000-8000-0000000000e1';
const otherLink = '00000000-0000-4000-8000-0000000000e2';
const reply = '00000000-0000-4000-8000-0000000000f1';
const otherReply = '00000000-0000-4000-8000-0000000000f2';
const organisation = '00000000-0000-4000-8000-000000000101';
const relationship = '00000000-0000-4000-8000-000000000102';
const claim = '00000000-0000-4000-8000-000000000103';
const owner = {
  user_id: '00000000-0000-4000-8000-0000000000c3',
  name: 'Invented Owner Ada',
  role: 'owner',
};
const longNote =
  'Invented relationship note that runs on for a long while so the list has to keep it to one short line';

let server: Server;
let origin = '';
test.beforeAll(async () => {
  const source = (path: string) => JSON.stringify(resolve(root, path));
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{OperatorFlags}from ${source('apps/web/app/operator/operator-flags.tsx')};
      import{MissionPage}from ${source('apps/web/app/operator/[section]/[missionId]/mission-page.tsx')};
      import{Counterparties}from ${source('apps/web/app/operator/counterparties.tsx')};
      import{StepUpDialog}from ${source('apps/web/components/ux/step-up-dialog.tsx')};
      import ${source('apps/web/app/operator/operator-overview.css')};
      import ${source('apps/web/app/operator/[section]/[missionId]/mission-page.css')};
      const q=new URLSearchParams(location.search);
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page ux-workspace"><h1>Missions</h1>
        <OperatorFlags replyReview={q.get('review')!=='off'} teamDeskV41={q.get('desk')==='on'}>
        {q.get('page')==='research'
          ?<Counterparties tenant="${tenant}"/>
          :<MissionPage tenant="${tenant}" workspaceName="Sample team" missionId="${mission}" moveRecords={false}/>}
        </OperatorFlags><StepUpDialog/></main>);`,
      loader: 'tsx',
      resolveDir: resolve(root, 'apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    external: ['/flags/*'],
    loader: { '.css': 'css', '.woff2': 'empty' },
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
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = readFileSync(resolve(root, 'apps/web/app/globals.css'), 'utf8');
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
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Missions</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

const brief = (company: string) => ({
  company,
  objective: 'Source suppliers',
  market: 'Spain',
  offer: 'Invented curtain track, 4 m, 10 pieces',
  outcomes: ['Three comparable quotes'],
  attendance: 'No',
});
const missionRow = (id: string, status: string, company: string | undefined) => ({
  id,
  status,
  version: 3,
  reason: '',
  notice_version: 'invented-notice-1',
  acknowledged_at: '2026-11-01T00:00:00.000Z',
  source_kind: 'SELF_SERVE',
  claim_status: 'SELF_DECLARED',
  country_code: 'ES',
  target_profile: null,
  owner_id: owner.user_id,
  due_at: '2026-12-01T09:00:00.000Z',
  updated_at: '2026-11-20T09:00:00.000Z',
  next_action: 'Compare the invented quotes',
  route_label: null,
  brief: company === undefined ? {} : brief(company),
});
const supplierReply = (id: string, linkId: string, words: string) => ({
  id,
  link_id: linkId,
  created_at: '2026-11-20T08:00:00Z',
  source_kind: 'SELF_DECLARED',
  body: {
    body: words,
    meetingInterest: false,
    quotation: {
      currency: 'USD',
      terms: {
        specification: 'Curtain track, 4 m',
        quantity: '10',
        unit: 'pieces',
        unitPriceMinor: '1250',
        totalPriceMinor: '12500',
      },
      uncertainties: 'Lead time not yet known',
    },
  },
});
const completeTerms = {
  specification: 'Curtain track, 4 m',
  quantity: '10',
  unit: 'pieces',
  unitPriceMinor: '1250',
  totalPriceMinor: '12500',
  leadTime: '6 weeks',
  validUntil: '2099-12-31T23:59:59Z',
  incoterm: 'FOB',
  shipping: 'INCLUDED',
  paymentTerms: '30 percent deposit',
  toolingMinor: '0',
  setupMinor: '0',
  packagingMinor: '0',
};
const snapshot = (participants: unknown[]) => ({
  role: 'owner',
  programmes: [{ id: programmeId, name: 'Invented Trade Visit' }],
  programmeTotal: 1,
  participants,
  publications: [],
  owners: [owner],
});

type Options = {
  desk: boolean;
  role?: string;
  review?: boolean;
  /** The reply states every term the engine compares, so its verdict is "comparable". */
  complete?: boolean;
  /** The workspace read is at its limit of 100 replies, none of them through this mission's links. */
  capped?: boolean;
  width?: number;
};
async function open(page: Page, where: 'mission' | 'research', options: Options) {
  const role = options.role ?? 'owner';
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const reads: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'POST') {
      posted.push({ path, body: request.postDataJSON() as Record<string, unknown> });
      return route.fulfill({ status: 201, json: { ok: true } });
    }
    reads.push(path);
    const action = url.searchParams.get('action');
    let json: unknown = {};
    if (path === '/api/team-work/mission')
      json = {
        role,
        total: 1,
        owners: [owner],
        history: [],
        missions: [missionRow(mission, 'TARGETING', 'Invented Machinery Co')],
        replies: [
          {
            id: 'r2',
            mission_id: mission,
            body: 'Second invented reply to the customer',
            created_at: '2026-11-21T09:00:00Z',
          },
          {
            id: 'r1',
            mission_id: mission,
            body: 'First invented reply to the customer',
            created_at: '2026-11-19T09:00:00Z',
          },
        ],
      };
    else if (path === '/api/team-work/flags') json = { missionsV2: true };
    else if (path === '/api/workspace/commercial-mission')
      json = {
        role,
        mission: { id: mission, version: 3, created_at: '2026-11-17T07:00:00Z' },
        assignments: [],
        requirements: [{ id: 'q1', version: 2, fields: { product: 'Reviewed curtain track' } }],
        assessments: [],
        rfqs: [],
        quotations: [
          {
            id: 'quote-1',
            target_id: 'target-1',
            currency: 'USD',
            revision: 1,
            terms: { totalPriceMinor: '12500' },
            created_at: '2026-11-20T10:00:00Z',
          },
        ],
        decisions: [],
        schedules: [],
        meetings: [],
        targets: [{ id: 'target-1', name: 'Invented Supplier Ltd' }],
        owners: [],
        comparison: [],
      };
    else if (path === '/api/workspace/delivery' && action === 'experience')
      json = {
        organisations: [],
        contexts: [],
        agenda: [],
        requirements: [],
        targets: [],
        targetOutreach: null,
        quotations: [],
        rfqs: [],
        links: [
          { id: link, company: 'Invented Supplier Ltd', mission_id: mission },
          { id: otherLink, company: 'Invented Other Supplier', mission_id: otherMission },
        ],
        disclosures: [
          { link_id: link, role: 'SUPPLIER', shared_requirements: 'Curtain track, 10 pieces' },
        ],
        responses: options.capped
          ? Array.from({ length: 100 }, (_, index) =>
              supplierReply(
                `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
                otherLink,
                'A reply that belongs to another mission.',
              ),
            )
          : [
              options.complete
                ? {
                    ...supplierReply(reply, link, 'We can quote the invented track.'),
                    body: {
                      body: 'We can quote the invented track.',
                      meetingInterest: false,
                      quotation: {
                        currency: 'USD',
                        terms: completeTerms,
                        uncertainties: 'None stated',
                      },
                    },
                  }
                : supplierReply(reply, link, 'We can quote the invented track.'),
              supplierReply(otherReply, otherLink, 'A reply that belongs to another mission.'),
            ],
      };
    else if (path === '/api/workspace/delivery') {
      json = snapshot([]);
    } else if (path === '/api/reply/review') json = { open: true, reviews: [] };
    else if (path === '/api/reply/prefill') json = { eligible: false, code: 'NOT_PUBLISHED' };
    else if (path === '/api/workspace/meetings')
      json = { meetings: [], meetingsTotal: 0, next: null };
    else if (path === '/api/workspace/mission-catalogue')
      json = { routes: [], packs: [], types: [], requirements: [], assessments: [] };
    else if (path === '/api/workspace/research')
      json = {
        role,
        total: 1,
        offset: 0,
        organisations: [
          {
            id: organisation,
            canonical_id: organisation,
            name: 'Invented Mill SA',
            country: 'ES',
            domain: 'mill.invalid',
            identity_status: 'SOURCE_REPORTED',
          },
        ],
      };
    else if (path === '/api/workspace/workspace') json = { sources: [], claims: [] };
    else if (path === '/api/workspace/missions')
      json = {
        role,
        total: 3,
        owners: [owner],
        missions: [
          missionRow(mission, 'TARGETING', 'Invented Machinery Co'),
          missionRow(otherMission, 'DRAFT', 'Invented Other Co'),
          missionRow(namelessMission, 'ACTIVE', undefined),
        ],
      };
    else if (path === '/api/workspace/counterparty')
      json = {
        role,
        organisation: {
          id: organisation,
          canonical_id: organisation,
          name: 'Invented Mill SA',
          country: 'ES',
          domain: 'mill.invalid',
          identity_status: 'SOURCE_REPORTED',
        },
        aliasIds: [organisation],
        identities: [
          { id: organisation, name: 'Invented Mill SA', country: 'ES', status: 'SOURCE_REPORTED' },
        ],
        relationships: [{ id: relationship, note: longNote, status: 'ACTIVE' }],
        contacts: [],
        notes: [],
        attributes: [
          {
            id: 'a1',
            claim_id: claim,
            statement: 'Invented mill makes curtain track',
            status: 'SOURCE_REPORTED',
          },
        ],
        publicFacts: [],
        candidates: [],
        resolutions: [],
      };
    else if (path === '/api/workspace/shortlist')
      json = { targets: [], total: 0, changes: { installed: false, open: false } };
    return route.fulfill({ json });
  });
  if (options.width) await page.setViewportSize({ width: options.width, height: 900 });
  const flags = `desk=${options.desk ? 'on' : 'off'}${options.review === false ? '&review=off' : ''}`;
  await page.goto(
    where === 'research'
      ? `${origin}/?page=research&${flags}&mission=${mission}#workspace-research`
      : `${origin}/?page=mission&${flags}`,
  );
  return { posted, reads };
}
/** Opens the company and its "add to a shortlist" form. On a phone the form sits inside a closed fold. */
async function openAddForm(page: Page) {
  await page.getByRole('button', { name: /Invented Mill SA/ }).click();
  const add = page.getByText('Add this relationship to a mission shortlist');
  await expect(add).toBeAttached();
  if (!(await add.isVisible())) await page.getByText('Show entity matching and ambiguity').click();
  await add.click();
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const panel = (page: Page) => page.getByRole('tabpanel');
const axe = async (page: Page, scope: string) =>
  (
    await new AxeBuilder({ page })
      .include(scope)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations.map((v) => v.id);

test('D8 on: Quotes sets what the customer asked for beside the replies to review', async ({
  page,
}) => {
  await open(page, 'mission', { desk: true });
  await tab(page, 'Quotes').click();
  const asked = page.getByRole('region', { name: 'What the customer asked for' });
  await expect(asked).toContainText('Invented curtain track, 4 m, 10 pieces');
  await expect(asked).toContainText('Three comparable quotes');
  await expect(asked).toContainText('Reviewed curtain track');
  const review = page.getByRole('region', { name: 'Replies to review' });
  // The company is named and the link id is not shown; another mission's reply stays out.
  await expect(review.getByText('From Invented Supplier Ltd')).toBeVisible();
  // Each card is its own region named by the company, with one date format.
  const card = review.getByRole('article', { name: 'From Invented Supplier Ltd' });
  await expect(card).toContainText('Received 20 Nov 2026');
  // The term grid waits behind a disclosure; the verdict and the actions stay open.
  const terms = card.locator('details', { hasText: 'Terms: 5 stated, 14 not stated' });
  await expect(terms).not.toHaveAttribute('open', '');
  await expect(card.getByText('Not comparable yet')).toBeVisible();
  await expect(card.getByText('Minimum order')).toBeHidden();
  await terms.locator('summary').click();
  await expect(card.getByText('Minimum order')).toBeVisible();
  // Exactly one cobalt action, and it follows the verdict: not comparable, so Ask.
  await expect(card.locator('.primary-link')).toHaveCount(1);
  await expect(card.locator('.primary-link')).toHaveText('Ask for Missing Terms');
  await expect(review).not.toContainText('Recipient link');
  await expect(review).not.toContainText(link.slice(0, 8));
  await expect(review).not.toContainText('A reply that belongs to another mission.');
  await expect(review.locator('.reply-review-card')).toHaveCount(1);
  // The three reply-review actions, exactly as that backend offers them to an owner.
  await expect(
    review.getByRole('button', { name: 'Publish: Prepare As a Quotation' }),
  ).toBeVisible();
  await expect(review.getByRole('button', { name: 'Ask for Missing Terms' })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Reject', exact: true })).toBeVisible();
  // The recorded offers and both original links stay.
  // The recorded offers wait behind a disclosure that carries their count.
  const recorded = page.getByRole('region', { name: 'Offers recorded on this mission' });
  await expect(recorded.locator('details')).not.toHaveAttribute('open', '');
  await expect(recorded.locator('summary')).toHaveText('Offers recorded on this mission: 1');
  await recorded.locator('summary').click();
  await expect(recorded.getByText('revision 1')).toBeVisible();
  // The inner headings of a card sit under its h5 title.
  await expect(card.locator('h4')).toHaveCount(0);
  await expect(card.locator('h6', { hasText: 'What the supplier was shown' })).toBeVisible();
  await expect(recorded).toContainText('Invented Supplier Ltd');
  await expect(recorded).toContainText('revision 1');
  await expect(recorded.getByRole('link', { name: 'Open Money' })).toHaveAttribute(
    'href',
    `/operator?workspace=${tenant}&mission=${mission}#workspace-commercial`,
  );
  await recorded.getByRole('button', { name: 'Record or Revise a Supplier Offer' }).click();
  await expect(tab(page, 'Requirements')).toHaveAttribute('aria-selected', 'true');
});

test('D8 on: Reject, Ask and Publish send the same reply-review payloads as today', async ({
  page,
}) => {
  const { posted } = await open(page, 'mission', { desk: true });
  await tab(page, 'Quotes').click();
  const review = page.getByRole('region', { name: 'Replies to review' });
  await review.getByRole('button', { name: 'Reject', exact: true }).click();
  await review.getByRole('button', { name: 'Record the Rejection' }).click();
  await expect(review.getByText('Decision recorded.')).toBeVisible();
  await review.getByRole('button', { name: 'Ask for Missing Terms' }).click();
  await review.getByRole('button', { name: 'Record the Request' }).click();
  await expect.poll(() => posted.length).toBe(2);
  await review.getByRole('button', { name: 'Publish: Prepare As a Quotation' }).click();
  await expect.poll(() => posted.length).toBe(3);
  expect(posted.map((p) => p.path)).toEqual(Array(3).fill('/api/reply/review'));
  expect(posted[0]!.body).toMatchObject({
    responseId: reply,
    seen: 0,
    decision: 'REJECT',
    reasonCode: 'NOT_A_FIT',
  });
  expect(posted[1]!.body).toMatchObject({ responseId: reply, decision: 'ASK' });
  expect(Array.isArray(posted[1]!.body.askTerms)).toBe(true);
  expect(posted[2]!.body).toMatchObject({ responseId: reply, seen: 0, decision: 'PUBLISH' });
  expect(Object.keys(posted[2]!.body).sort()).toEqual([
    'commandId',
    'decision',
    'responseId',
    'seen',
  ]);
});

test('D8 on, phone: what the customer asked for folds behind a summary that names the offer', async ({
  page,
}) => {
  await open(page, 'mission', { desk: true, width: 390 });
  await tab(page, 'Quotes').click();
  const asked = page.getByRole('region', { name: 'What the customer asked for' });
  await expect(asked.locator('details')).not.toHaveAttribute('open', '');
  await expect(asked.locator('summary')).toHaveText(
    'What the customer asked for: Invented curtain track, 4 m, 10 pieces',
  );
  await expect(asked.getByText('Three comparable quotes')).toBeHidden();
  await asked.locator('summary').click();
  await expect(asked.getByText('Three comparable quotes')).toBeVisible();
});

test('D8 on: a comparable reply makes Publish the one cobalt action', async ({ page }) => {
  await open(page, 'mission', { desk: true, complete: true });
  await tab(page, 'Quotes').click();
  const card = page.getByRole('article', { name: 'From Invented Supplier Ltd' });
  await expect(card.getByText('Comparable on supplied terms')).toBeVisible();
  await expect(card.locator('.primary-link')).toHaveCount(1);
  await expect(card.locator('.primary-link')).toHaveText('Publish: Prepare As a Quotation');
});

test('D8 on: a reply read at its limit says so and never says no supplier replied', async ({
  page,
}) => {
  await open(page, 'mission', { desk: true, capped: true });
  await tab(page, 'Quotes').click();
  const review = page.getByRole('region', { name: 'Replies to review' });
  await expect(review).toContainText(
    'Only the latest 100 supplier replies in this workspace are read here, so this list may not show everything. Every reply is under Reports.',
  );
  await expect(review).not.toContainText('No supplier has replied');
  await expect(review.getByRole('link', { name: 'Open Reports' })).toHaveAttribute(
    'href',
    `/operator?workspace=${tenant}&mission=${mission}#workspace-delivery`,
  );
});

for (const width of [390, 1024])
  test(`D8 on at ${width}px with text at 200%: nothing scrolls sideways`, async ({ page }) => {
    await open(page, 'mission', { desk: true, width });
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    await tab(page, 'Quotes').click();
    const card = page.getByRole('article', { name: 'From Invented Supplier Ltd' });
    await card.locator('summary', { hasText: 'Terms:' }).click();
    await expect(card.getByText('Minimum order')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });

test('D8 on: no review control where the backend would refuse it', async ({ page }) => {
  // An operator may read but not decide (ADR-069: owner or admin).
  await open(page, 'mission', { desk: true, role: 'operator' });
  await tab(page, 'Quotes').click();
  const review = page.getByRole('region', { name: 'Replies to review' });
  await expect(review.getByText('From Invented Supplier Ltd')).toBeVisible();
  await expect(review.getByRole('button')).toHaveCount(0);
  // Reply review switched off: no reply read is made and the panel says why nothing can be decided.
  await open(page, 'mission', { desk: true, review: false });
  await tab(page, 'Quotes').click();
  const off = page.getByRole('region', { name: 'Replies to review' });
  await expect(off).toContainText('Reply review is not switched on in this workspace');
  await expect(off.getByRole('button')).toHaveCount(0);
  await expect(off).toContainText('You can read supplier replies under Reports.');
  await expect(off.getByRole('link', { name: 'Open Reports' })).toHaveAttribute(
    'href',
    `/operator?workspace=${tenant}&mission=${mission}#workspace-delivery`,
  );
  await expect(page.getByRole('region', { name: 'What the customer asked for' })).toBeVisible();
});

test('D9 on: one timeline the customer can read, oldest first, and one message box', async ({
  page,
}) => {
  const { posted, reads } = await open(page, 'mission', { desk: true });
  await tab(page, 'Replies').click();
  const timeline = page.getByRole('region', { name: 'What the customer can read' });
  await expect(timeline.getByRole('listitem')).toHaveCount(2);
  await expect(timeline.getByRole('listitem').nth(0)).toContainText('First invented reply');
  await expect(timeline.getByRole('listitem').nth(1)).toContainText('Second invented reply');
  // One box, the existing receipt reply form: same field name, same button, same payload.
  await expect(panel(page).locator('textarea')).toHaveCount(1);
  const box = panel(page).locator('textarea[name="body"]');
  await box.fill('Third invented reply to the customer');
  await panel(page).getByRole('button', { name: 'Post Receipt Reply' }).click();
  await expect(page.getByText('Reply posted.')).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]!.path).toBe('/api/workspace/mission-reply');
  expect(posted[0]!.body).toMatchObject({
    id: mission,
    body: 'Third invented reply to the customer',
  });
  expect(String(posted[0]!.body.replyId)).toMatch(/^[0-9a-f-]{36}$/);
  expect(Object.keys(posted[0]!.body).sort()).toEqual(['body', 'id', 'replyId']);
  // No delegation block and no "Choose a programme" line on the mission page; no programme is looked up.
  // The block stays at its Reports address, the same one today's Delivery tab links to.
  expect(reads.filter((path) => path === '/api/workspace/delivery')).toEqual([]);
  await expect(panel(page)).not.toContainText('Choose a programme');
  await expect(
    page.getByRole('heading', { name: 'Mission and delegation experience' }),
  ).toHaveCount(0);
  await expect(page.getByText('Delegation context', { exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole('link', { name: 'Open Reports' })).toHaveAttribute(
    'href',
    `/operator?workspace=${tenant}&mission=${mission}#workspace-delivery`,
  );
  await expect(panel(page)).toContainText('Choose this mission there.');
});

test('D9 on: a role that cannot reply gets the timeline and no message box', async ({ page }) => {
  await open(page, 'mission', { desk: true, role: 'viewer' });
  await tab(page, 'Replies').click();
  await expect(
    page.getByRole('region', { name: 'What the customer can read' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(panel(page).locator('textarea')).toHaveCount(0);
  await expect(panel(page)).toContainText(
    'Only an owner, admin or operator can post a reply on the receipt.',
  );
});

test('D10 on: the mission from the address is named at the top and preselected, and the reason is required', async ({
  page,
}) => {
  const { posted } = await open(page, 'research', { desk: true });
  const banner = page.locator('[data-desk-mission]');
  await expect(banner).toContainText('Adding companies to Invented Machinery Co');
  await expect(banner).toContainText('Finding companies');
  await openAddForm(page);
  const form = page.locator('form.operator-form', {
    has: page.getByRole('button', { name: 'Add Mission Target' }),
  });
  await expect(form.locator('select[name="missionId"]')).toHaveValue(mission);
  // Names are short and an id is never a name.
  const missionOptions = await form.locator('select[name="missionId"] option').allInnerTexts();
  expect(missionOptions).toEqual(['Choose a record', 'Invented Machinery Co', 'Unnamed mission']);
  const relationOption = await form
    .locator(`select[name="relationshipId"] option[value="${relationship}"]`)
    .innerText();
  expect(relationOption.length).toBeLessThanOrEqual(60);
  expect(relationOption.endsWith('…')).toBe(true);
  await expect(page.locator('#main')).not.toContainText(namelessMission);
  await expect(page.locator('#main')).not.toContainText('Original record');
  // Stored codes are shown in plain words; what is sent is still the code.
  expect(await form.locator('select[name="fit"] option').allInnerTexts()).toEqual([
    'Research',
    'Possible',
    'Strong',
    'Unsuitable',
  ]);
  await expect(form.locator('select[name="fit"]')).toHaveValue('RESEARCH');
  await expect(form).toContainText('Invented mill makes curtain track · Source-reported');
  await expect(form).not.toContainText('SOURCE_REPORTED');
  // The reason keeps its field name and must be given.
  const reason = form.getByLabel('Reason this company belongs on the mission');
  await expect(reason).toHaveAttribute('name', 'rationale');
  await expect(reason).toHaveAttribute('required', '');
  await expect(reason).toHaveAttribute('minlength', '3');
  await form.locator('select[name="relationshipId"]').selectOption(relationship);
  await form.locator('input[name="claimIds"]').check();
  await form.locator('input[name="uncertainty"]').fill('Invented capacity not confirmed');
  await form.locator('input[name="gaps"]').fill('No invented audit yet');
  await form.locator('input[name="nextAction"]').fill('Ask the invented mill for a sample');
  await form.getByRole('button', { name: 'Add Mission Target' }).click();
  expect(posted).toHaveLength(0);
  expect(await reason.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  await reason.fill('Makes the invented track the customer asked for');
  await form.getByRole('button', { name: 'Add Mission Target' }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]!.path).toBe('/api/workspace/research');
  expect(posted[0]!.body).toMatchObject({
    action: 'target',
    missionId: mission,
    relationshipId: relationship,
    contactId: null,
    claimIds: [claim],
    fit: 'RESEARCH',
    rationale: 'Makes the invented track the customer asked for',
    uncertainty: 'Invented capacity not confirmed',
    gaps: 'No invented audit yet',
    nextAction: 'Ask the invented mill for a sample',
  });
  expect(Object.keys(posted[0]!.body).sort()).toEqual([
    'action',
    'claimIds',
    'commandId',
    'contactId',
    'dueAt',
    'fit',
    'gaps',
    'missionId',
    'nextAction',
    'rationale',
    'relationshipId',
    'uncertainty',
  ]);
});

test('switch off: the Quotes and Replies tabs and the research section are today’s', async ({
  page,
}) => {
  await open(page, 'mission', { desk: false });
  await tab(page, 'Quotes').click();
  await expect(panel(page).getByRole('heading', { name: 'Quotes' })).toBeVisible();
  await expect(panel(page)).toContainText('Invented Supplier Ltd · revision 1');
  await expect(panel(page)).not.toContainText('What the customer asked for');
  await expect(panel(page)).not.toContainText('Replies to review');
  await expect(
    panel(page).getByRole('button', { name: 'Record or Revise a Supplier Offer' }),
  ).toBeVisible();
  await tab(page, 'Replies').click();
  await expect(
    panel(page).getByRole('heading', { name: 'Receipt replies to the customer' }),
  ).toBeVisible();
  // Today's order (as read) and today's whole delivery block, reply review included.
  await expect(panel(page).locator('ul > li').first()).toContainText('Second invented reply');
  await expect(
    panel(page).getByRole('heading', { name: 'Mission and delegation experience' }),
  ).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'Review supplier replies' })).toBeVisible();
  await expect(panel(page)).toContainText(`Recipient link ${link.slice(0, 8)}`);
  await expect(panel(page)).not.toContainText('What the customer can read');
  await expect(panel(page).locator('textarea[name="body"]')).toHaveCount(0);

  await open(page, 'research', { desk: false });
  await expect(page.locator('[data-desk-mission]')).toHaveCount(0);
  await openAddForm(page);
  await expect(page.locator('#main')).toContainText('Original record');
  const form = page.locator('form.operator-form', {
    has: page.getByRole('button', { name: 'Add Mission Target' }),
  });
  await expect(form.locator('select[name="missionId"]')).toHaveValue('');
  expect(await form.locator('select[name="missionId"] option').allInnerTexts()).toEqual([
    'Choose a record',
    'Invented Machinery Co',
    namelessMission,
  ]);
  expect(
    await form.locator(`select[name="relationshipId"] option[value="${relationship}"]`).innerText(),
  ).toBe(longNote);
  expect(await form.locator('select[name="fit"] option').allInnerTexts()).toEqual([
    'RESEARCH',
    'POSSIBLE',
    'STRONG',
    'UNSUITABLE',
  ]);
  await expect(form).toContainText('Invented mill makes curtain track · SOURCE_REPORTED');
  const rationale = form.getByLabel('Fit rationale');
  await expect(rationale).toHaveAttribute('name', 'rationale');
  expect(await rationale.getAttribute('minlength')).toBeNull();
});

// Owner rule, 24 Nov 2026: a destination has one link on a screen. Every address linked inside <main> is
// collected with the switch on and none may appear twice. No exception is named: nothing here needs one.
// "Open Reports" and "Open Money" are each a contextual deep link (Guardian ruling, 24 Nov 2026): they carry
// ?mission=<id> to a view opened on this mission, so they are not copies of the Reports and Money menu places.
test('switch on: no address is linked twice inside main on Quotes, Replies or Add companies', async ({
  page,
}) => {
  const addresses = () =>
    page.locator('#main a[href]').evaluateAll((links) => links.map((a) => a.getAttribute('href')!));
  const expectNoRepeat = async (where: string, atLeast: number) => {
    const found = await addresses();
    expect(found.length, where).toBeGreaterThanOrEqual(atLeast);
    expect(
      found.filter((href, index) => found.indexOf(href) !== index),
      where,
    ).toEqual([]);
  };
  const reports = `/operator?workspace=${tenant}&mission=${mission}#workspace-delivery`;
  const money = `/operator?workspace=${tenant}&mission=${mission}#workspace-commercial`;

  await open(page, 'mission', { desk: true });
  await tab(page, 'Quotes').click();
  await expect(page.getByText('From Invented Supplier Ltd')).toBeVisible();
  await expectNoRepeat('Quotes', 2);
  expect(await addresses()).toContain(money);

  await open(page, 'mission', { desk: true, capped: true });
  await tab(page, 'Quotes').click();
  await expect(page.getByRole('link', { name: 'Open Reports' })).toBeVisible();
  await expectNoRepeat('Quotes, reply read at its limit', 3);
  expect((await addresses()).filter((href) => href === reports)).toHaveLength(1);

  await open(page, 'mission', { desk: true, review: false });
  await tab(page, 'Quotes').click();
  await expect(page.getByRole('link', { name: 'Open Reports' })).toBeVisible();
  await expectNoRepeat('Quotes, reply review off', 3);

  await open(page, 'mission', { desk: true });
  await tab(page, 'Replies').click();
  await expect(page.getByRole('link', { name: 'Open Reports' })).toBeVisible();
  await expectNoRepeat('Replies', 2);

  await open(page, 'research', { desk: true });
  await openAddForm(page);
  await expectNoRepeat('Add companies', 0);
});

for (const width of [320, 390, 768, 1024, 1440, 1920])
  test(`D8 to D10 at ${width}px: nothing runs off the page and the panels are axe clean`, async ({
    page,
  }) => {
    const shots = process.env.D8_SHOTS;
    if (shots) mkdirSync(shots, { recursive: true });
    const fits = async () =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    for (const desk of [false, true]) {
      const state = desk ? 'on' : 'off';
      await open(page, 'mission', { desk, width });
      await tab(page, 'Quotes').click();
      await expect(
        page.getByText(desk ? 'From Invented Supplier Ltd' : 'Invented Supplier Ltd · revision 1'),
      ).toBeVisible();
      await fits();
      if (desk) expect(await axe(page, '[role="tabpanel"]')).toEqual([]);
      if (shots)
        await page.screenshot({ path: `${shots}/quotes-${state}-${width}.png`, fullPage: true });
      if (shots && desk && (width === 390 || width === 1440)) {
        // The Quotes tab with one reply, in screens of 844 (phone) and 900 (desktop) px, disclosures closed.
        const screen = width === 390 ? 844 : 900;
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        console.log(
          `quotes-height ${width}: ${height}px = ${(height / screen).toFixed(2)} screens`,
        );
      }
      await tab(page, 'Replies').click();
      // Scoped to the tab panel: the mission page's own summary also quotes the latest reply.
      await expect(panel(page).getByText('Second invented reply to the customer')).toBeVisible();
      await fits();
      if (desk) expect(await axe(page, '[role="tabpanel"]')).toEqual([]);
      if (shots)
        await page.screenshot({ path: `${shots}/replies-${state}-${width}.png`, fullPage: true });
      await open(page, 'research', { desk, width });
      await openAddForm(page);
      const form = page.locator('form.operator-form', {
        has: page.getByRole('button', { name: 'Add Mission Target' }),
      });
      await expect(form).toBeVisible();
      await form.scrollIntoViewIfNeeded();
      await fits();
      if (desk) {
        expect(await axe(page, '[data-desk-mission]')).toEqual([]);
        expect(
          await new AxeBuilder({ page })
            .include('form.operator-form')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
            .then((r) => r.violations.map((v) => v.id)),
        ).toEqual([]);
      }
      if (shots) await page.screenshot({ path: `${shots}/add-companies-${state}-${width}.png` });
    }
  });
