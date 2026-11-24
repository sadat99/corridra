import type { Page } from '@playwright/test';
import { fixtureCandidate, fixtureMission, fixtureTenant } from './p5c-desk-fixture';

// Synthetic answers for every read the Settings, Inbox and Supply pages make in the P5c fixture. No database.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date().toISOString();
const later = new Date(Date.now() + 200 * 86400000).toISOString();

export const routeIds = { bdCn: id(101), bdEu: id(102), twAu: id(103) };
export const catalogue = {
  routes: [
    { id: routeIds.bdCn, origin_market: 'BD', destination_market: 'CN' },
    { id: routeIds.bdEu, origin_market: 'BD', destination_market: 'EU' },
    { id: routeIds.twAu, origin_market: 'TW', destination_market: 'AU' },
  ],
  packs: [
    {
      id: id(201),
      route_id: routeIds.bdCn,
      origin_market: 'BD',
      destination_market: 'CN',
      status: 'DRAFT',
      version: 1,
      configuration: { missionTypes: ['supplier_discovery'] },
    },
    {
      id: id(202),
      route_id: routeIds.bdCn,
      origin_market: 'BD',
      destination_market: 'CN',
      status: 'ACTIVE',
      version: 2,
      configuration: { missionTypes: ['supplier_discovery'] },
    },
    {
      id: id(203),
      route_id: routeIds.bdEu,
      origin_market: 'BD',
      destination_market: 'EU',
      status: 'TESTING',
      version: 1,
      configuration: {},
    },
  ],
  types: [{ id: id(301), key: 'supplier_discovery', description: 'Find suppliers' }],
  requirements: [{ id: id(302), key: 'supplier_profile' }],
  assessments: [{ id: id(303), key: 'supplier_fit' }],
};

const report = (n: number, status: string) => ({
  id: id(n),
  number: n,
  reference: `RP-00000${n}`,
  reporterKind: n % 2 ? 'customer' : 'team',
  filedAt: new Date(Date.now() - n * 86400000).toISOString(),
  category: 'did_not_work',
  side: 'sample',
  status,
  updatedAt: now,
  wordsRemoved: false,
  pageKind: 'this_page',
  page: '/account/requests/:id',
  detail: 'The button did nothing',
  history: [{ state: 'received', note: null, createdAt: now }],
});
const erasure = (n: number) => ({
  id: id(400 + n),
  number: n,
  reference: `ER-00000${n}`,
  filedAt: new Date(Date.now() - n * 86400000).toISOString(),
  dueAt: new Date(Date.now() + 20 * 86400000).toISOString(),
  daysLeft: 20,
  status: 'received',
  note: null,
  accountStatus: 'active',
  closedAt: null,
  undoUntil: null,
});
const application = (n: number) => ({
  id: id(500 + n),
  programmeId: id(900),
  workspaceId: id(901),
  status: 'SUBMITTED',
  displayLabel: `Synthetic applicant ${n}`,
  statement: `Synthetic statement ${n} about two combine harvesters.`,
  appliedAt: new Date(Date.now() - n * 3600000).toISOString(),
  decisionVersion: 0,
  programmeTitle: 'Synthetic China agricultural machinery delegation',
  organiser: 'Synthetic Dhaka Agro Traders Association',
  address: 'synthetic-china-delegation-abcdefghij',
  pageState: 'OPEN',
});
const supplySource = {
  id: id(601),
  kind: 'staff_research',
  versionId: id(602),
  version: 2,
  status: 'active',
  label: 'Trade register of Spain',
  sourceRecordId: null,
  defaultRetentionMonths: 12,
  agreementEndsAt: null,
  reason: 'Created by staff',
};
const candidate = {
  id: fixtureCandidate,
  missionId: fixtureMission,
  companyName: 'Ibérica Frutas SL',
  country: 'ES',
  sourceLabel: supplySource.label,
  sourceKind: 'staff_research',
  sourceVersion: 2,
  method: 'manual',
  state: 'source-reported',
  observedAt: now,
  retentionUntil: later,
  expired: false,
  warnings: [],
  websiteHost: null,
  publicIdentifier: null,
  nominationNote: null,
  sizeBand: null,
  counterpartyTypes: [],
  latestReview: null,
  latestMatch: null,
  currentMatch: null,
  reviews: [],
  matches: [],
};

export type World = {
  role: string;
  /** What the mission catalogue read answers: the routes and packs, or a status for a failed read. */
  catalogue: typeof catalogue | { status: number };
  /** Whether the helper interest register answers that it is installed. */
  helperInterest: boolean;
  /** `empty`: the Supply reads answer with no rows, so the page holds no dates. */
  supply?: 'rows' | 'empty';
  /** Every request the page made under /api, as `METHOD path?query`. */
  asked: string[];
};

/** Answers every read of the fixture. Returns the world, with the requests seen so far. */
export async function answerReads(page: Page, given: Partial<World> = {}): Promise<World> {
  const world: World = { role: 'owner', catalogue, helperInterest: true, asked: [], ...given };
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    world.asked.push(`${request.method()} ${path}${url.search}`);
    if (path === '/api/team-work/flags') return route.fulfill(json({ missionsV2: true }));
    if (path === '/api/workspace/workspace')
      return route.fulfill(
        json({
          purpose: 'synthetic_validation',
          uploadsConfigured: false,
          scanMode: 'bypass',
          role: world.role,
          sources: [],
          claims: [],
          evidence: [],
          facts: [],
        }),
      );
    if (path === '/api/workspace/config' || path === '/api/notifications')
      return route.fulfill(json([]));
    if (path === '/api/workspace/mission-catalogue')
      return 'status' in world.catalogue
        ? route.fulfill(
            json({ error: 'Reviewed references are unavailable.' }, world.catalogue.status),
          )
        : route.fulfill(json(world.catalogue));
    if (path === '/api/workspace/customer-erasure-queue')
      return route.fulfill(json({ items: [erasure(1)], nextAfter: null }));
    if (path === '/api/workspace/problem-reports') {
      const items = [report(1, 'received'), report(2, 'in_review')];
      return route.fulfill(
        json({
          items,
          total: 2,
          counts: { received: 1, in_review: 1, resolved: 0, closed: 0 },
          oldestReceivedAt: items[0]!.filedAt,
          nextAfter: null,
        }),
      );
    }
    if (path === '/api/workspace/programme-applications')
      return route.fulfill(json({ applications: [application(1)], total: 1, nextAfter: null }));
    if (path === '/api/helper-interest')
      return url.searchParams.get('view') === 'installed'
        ? route.fulfill(json({ installed: world.helperInterest }))
        : route.fulfill(
            json({
              installed: true,
              total: 1,
              nextOffset: null,
              rows: [
                {
                  id: id(701),
                  name: 'Synthetic Helper',
                  email: 'helper@example.invalid',
                  country: 'BD',
                  reason: 'I know the Dhaka garment suppliers.',
                  createdAt: now,
                },
              ],
            }),
          );
    if (path.startsWith('/api/supply/')) {
      const action = path.split('/').pop();
      if (action === 'state')
        return route.fulfill(
          json({
            moduleOpen: true,
            profile: { id: id(801), version: 3, role: 'BUYER' },
            kinds: ['staff_research'],
          }),
        );
      if (world.supply === 'empty' && ['sources', 'missions', 'route-kinds'].includes(action!))
        return route.fulfill(json({ [action === 'route-kinds' ? 'routes' : action!]: [] }));
      if (action === 'sources') return route.fulfill(json({ sources: [supplySource] }));
      if (action === 'missions')
        return route.fulfill(
          json({
            missions: [
              {
                id: fixtureMission,
                status: 'open',
                nextAction: 'Review candidates',
                createdAt: now,
                candidates: 1,
                candidatesLive: 1,
                profileVersion: 3,
              },
            ],
          }),
        );
      if (action === 'route-kinds')
        return route.fulfill(
          json({
            routes: [
              {
                id: fixtureMission,
                status: 'open',
                nextAction: 'Review candidates',
                createdAt: now,
                kinds: ['staff_research'],
              },
            ],
          }),
        );
      if (action === 'candidates') return route.fulfill(json({ candidates: [candidate] }));
      if (action === 'candidate') return route.fulfill(json({ candidate }));
      if (action === 'batches') return route.fulfill(json({ batches: [] }));
      if (action === 'blocks') return route.fulfill(json({ blocks: [] }));
    }
    if (path === '/api/workspace/research') return route.fulfill(json({ organisations: [] }));
    if (path.startsWith('/api/picker/')) return route.fulfill(json({ options: [] }));
    return route.fulfill(json({ error: 'Not part of this fixture' }, 404));
  });
  return world;
}

export const tenantQuery = `workspace=${fixtureTenant}`;
