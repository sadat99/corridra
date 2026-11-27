import type { Page } from '@playwright/test';
import { fixtureCandidate, fixtureMission, fixtureTenant } from './p5c-desk-fixture';
import {
  routeDetail,
  summariseRoute,
  type PackVersion,
} from '../../apps/web/lib/route-pack-editor-read';
import type { RouteConfiguration } from '../../packages/domain/src/corridors';
import type { RouteView } from '../../packages/missions/src/route-pack-content';
import {
  deriveCompleteness,
  liveStatuses,
  standardFieldsV1,
  type ContentDocument,
  type ContentFact,
  type PackStatus,
} from '../../packages/domain/src/route-pack-standard';

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

/**
 * ADR-093 Phase 3, PR 1: what the three route fact reads answer, built from the standard the way the server builds them (the
 * one `deriveCompleteness`), so no count is typed here. Three routes of the catalogue: Bangladesh to China is Active with most
 * Core facts filled, one of them stale and three Pending; Bangladesh to the European Union is Testing with nothing filled and
 * one section marked Not applicable; Taiwan to Australia has no pack and no facts. With `complete` the second has every Core
 * field done.
 */
export type FactsWorld = {
  /** Status of the list read (no `routeId`). Default 200. */
  overview?: number;
  /** Status of the one-route read. Default 200. */
  detail?: number;
  /** Status of the pack history read. Default 200. */
  packHistory?: number;
  /** The one-route read waits this many milliseconds before it answers (to see the loading state). */
  delayDetail?: number;
  /** The next this many one-route reads answer 500, then it answers as `detail` says. */
  failDetail?: number;
  /** The newest pack of Bangladesh to China did not go through review. */
  unreviewedPack?: boolean;
  /** Every Core field of Bangladesh to the European Union is done and none is stale. */
  complete?: boolean;
};
const lockedCore = {
  missionTypes: ['supplier_discovery'],
  languages: ['en', 'bn'],
  currencies: ['USD'],
  timeZones: ['Asia/Dhaka'],
  channels: ['SYNTHETIC'],
};
const staleDay = '2025-12-31';
const observedDay = '2026-11-01';
const contentCore = standardFieldsV1.filter((field) => field.part === 'Content' && field.core);
const fact = (key: string, extra: Partial<ContentFact> = {}): ContentFact => ({
  key,
  state: 'FILLED',
  value: 'Sample route fact',
  source: 'staff knowledge',
  observedOn: observedDay,
  ...extra,
});
const valueFor = (key: string): ContentFact['value'] => {
  const field = standardFieldsV1.find((item) => item.key === key)!;
  return field.type === 'list' ? ['Sample item one', 'Sample item two'] : `Sample ${field.label}`;
};
// Every Core content field Filled except the last `pending`, the first of the filled ones stale.
const coreFacts = (pending: number, stale: boolean) =>
  contentCore.slice(0, contentCore.length - pending).map((field, index) =>
    fact(field.key, {
      value: valueFor(field.key),
      ...(stale && index === 0 ? { observedOn: '2025-06-01', validUntil: staleDay } : {}),
    }),
  );
const longWord = 'Long'.repeat(250);
const lastOfEach = (facts: ContentFact[]) => [
  ...new Map(facts.map((item) => [item.key, item])).values(),
];
const bdCnFacts: ContentFact[] = lastOfEach([
  ...coreFacts(3, true),
  fact('identity.summary', { value: '孟加拉国到中国：样品供应商路线 مسار تجريبي' }),
  fact('events.trade_fairs', {
    value: ['Fair one', 'Fair two', 'Fair three', 'Fair four', 'Fair five'],
    source: 'https://www.example.org/fairs/2027',
    validUntil: '2027-12-31',
  }),
  fact('notes.general', { value: longWord }),
  { key: 'events.other_events', state: 'NOT_APPLICABLE', note: 'No other events on this route' },
  fact('custom.fair_stand_cost', {
    label: 'Typical stand cost',
    section: 5,
    type: 'money',
    value: { currency: 'USD', amountMinor: '4500' },
  }),
]);
const documentOf = (
  facts: ContentFact[],
  sectionMarks: ContentDocument['sectionMarks'] = [],
): ContentDocument => ({ standardVersion: 1, sectionMarks, facts });
const configurationOf = (full: boolean) => (full ? lockedCore : {});
function routeView(
  key: string,
  routeId: string,
  pack: { status: PackStatus; version: number; full: boolean } | null,
  content: { version: number; document: ContentDocument } | null,
  readiness: string[] | null,
): RouteView {
  const [origin, destination] = key.split('-') as [string, string];
  const configuration = pack ? (configurationOf(pack.full) as unknown as RouteConfiguration) : null;
  return {
    routeId,
    key,
    origin,
    destination,
    pack: pack
      ? {
          id: id(210 + pack.version),
          version: pack.version,
          status: pack.status,
          configuration: configuration!,
          effectiveFrom: '2026-11-20T09:00:00.000Z',
          createdBy: id(990),
          reason: 'Synthetic pack reason',
        }
      : null,
    content: content
      ? {
          id: id(220 + content.version),
          version: content.version,
          packId: pack ? id(210 + pack.version) : null,
          document: content.document,
          createdAt: '2026-11-21T09:00:00.000Z',
          createdBy: id(990),
          reason: 'Synthetic facts reason',
        }
      : null,
    completeness: deriveCompleteness(
      pack ? { status: pack.status, configuration: configurationOf(pack.full) } : null,
      content?.document ?? null,
      new Date().toISOString().slice(0, 10),
    ),
    readiness:
      readiness && pack
        ? { packId: id(210 + pack.version), completeMissionTypes: readiness }
        : null,
  };
}
function routeViews(world: FactsWorld, role: string): RouteView[] {
  const reads = role === 'owner' || role === 'admin';
  const done = world.complete === true;
  return [
    routeView(
      'BD-CN',
      routeIds.bdCn,
      { status: 'ACTIVE', version: 2, full: true },
      { version: 5, document: documentOf(bdCnFacts) },
      reads ? ['supplier_discovery'] : null,
    ),
    routeView(
      'BD-EU',
      routeIds.bdEu,
      { status: 'TESTING', version: 1, full: done },
      {
        version: 1,
        document: documentOf(
          done ? coreFacts(0, false) : [],
          done ? [] : [{ section: 3, note: 'Languages, money and time are set in the pack' }],
        ),
      },
      reads ? [] : null,
    ),
    routeView('TW-AU', routeIds.twAu, null, null, null),
  ];
}
const packHistoryOf = (routeId: string, facts: FactsWorld): PackVersion[] =>
  routeId === routeIds.bdCn
    ? [
        {
          version: 2,
          effectiveFrom: '2026-11-20T09:00:00.000Z',
          reviewed: facts.unreviewedPack !== true,
          proposedAndPublishedByYou: true,
          proposedAndPublishedBySame: true,
        },
      ]
    : routeId === routeIds.bdEu
      ? [
          {
            version: 1,
            effectiveFrom: '2026-11-19T09:00:00.000Z',
            reviewed: true,
            proposedAndPublishedByYou: false,
            proposedAndPublishedBySame: false,
          },
        ]
      : [];
const factsCapabilities = {
  routePackForm: true,
  contentInstalled: true,
  onePersonPublication: false,
};

export type World = {
  role: string;
  /** What the mission catalogue read answers: the routes and packs, or a status for a failed read. */
  catalogue: typeof catalogue | { status: number };
  /** Whether the helper interest register answers that it is installed. */
  helperInterest: boolean;
  /** `empty`: the Supply reads answer with no rows, so the page holds no dates. */
  supply?: 'rows' | 'empty';
  /**
   * The route fact reads (ADR-093 Phase 3). Left out, the three actions answer 404 as an unknown action does: the page with
   * the switch off or the 2b marker absent.
   */
  facts?: FactsWorld;
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
    if (path.startsWith('/api/team-control/route-pack-') && world.facts) {
      const facts = world.facts;
      const asked = url.searchParams.get('routeId');
      const views = routeViews(facts, world.role);
      // A status other than 200 answers that status with the words the server uses.
      const refusal = (code: number) =>
        route.fulfill(
          json(
            {
              error:
                code === 403
                  ? 'Access denied'
                  : code === 404
                    ? 'Not found'
                    : 'The request could not be completed',
            },
            code,
          ),
        );
      if (path.endsWith('/route-pack-overview')) {
        const answer = () => {
          if (asked && facts.failDetail) {
            facts.failDetail -= 1;
            return refusal(500);
          }
          const code = (asked ? facts.detail : facts.overview) ?? 200;
          if (code !== 200) return refusal(code);
          if (!asked)
            return route.fulfill(
              json({
                capabilities: factsCapabilities,
                routes: views.map((view) => summariseRoute(view, liveStatuses)),
              }),
            );
          const found = views.find((view) => view.routeId === asked);
          return route.fulfill(
            json({
              capabilities: factsCapabilities,
              customLabels: { 'custom.fair_stand_cost': 'Typical stand cost' },
              route: found ? routeDetail(found) : null,
            }),
          );
        };
        return asked && facts.delayDetail
          ? new Promise((resolve) => setTimeout(resolve, facts.delayDetail)).then(answer)
          : answer();
      }
      if (path.endsWith('/route-pack-pack-history')) {
        const code = facts.packHistory ?? 200;
        if (code !== 200) return refusal(code);
        return route.fulfill(json({ versions: packHistoryOf(asked ?? '', facts) }));
      }
    }
    if (path === '/api/workspace/research') return route.fulfill(json({ organisations: [] }));
    if (path.startsWith('/api/picker/')) return route.fulfill(json({ options: [] }));
    return route.fulfill(json({ error: 'Not part of this fixture' }, 404));
  });
  return world;
}

export const tenantQuery = `workspace=${fixtureTenant}`;
