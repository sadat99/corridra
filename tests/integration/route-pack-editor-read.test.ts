import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { changeMemberNow } from './change-member';
import { AccessService } from '../../packages/auth/src/access';
import { configureSourcingWorkflow } from '../../packages/auth/src/sourcing-workflow-configuration';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateSourcingWorkflow } from '../../packages/db/src/sourcing-workflow-migrate';
import { migrateRoutePack } from '../../packages/db/src/route-pack-migrate';
import { countryCodes } from '../../packages/domain/src/countries';
import { initialRoutes, type RouteConfiguration } from '../../packages/domain/src/corridors';
import {
  coreKeysV1,
  deriveCompleteness,
  standardFieldsV1,
  type ContentDocument,
  type ContentFact,
  type PackStatus,
} from '../../packages/domain/src/route-pack-standard';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { OperationsService } from '../../packages/missions/src/operations';
import { RoutePackContentService } from '../../packages/missions/src/route-pack-content';
import { createRoutePack } from '../../packages/missions/src/route-pack-form';
import { RoutePackSheetService } from '../../packages/missions/src/route-pack-sheet';
import type {
  OverviewList,
  OverviewRoute,
  FactVersion,
  PackVersion,
} from '../../apps/web/lib/route-pack-editor-read';

// ADR-093 Phase 3, PR 1: the three read actions behind the route pack editor. The real handler, services and an isolated
// PostgreSQL with the route pack module installed; only the session provider, the switch reader and (for the module absent
// case) the marker answer are replaced. Red on the code before PR 1: the three actions did not exist and answered 404.
const web = vi.hoisted(() => ({
  actor: 'owner' as string | null,
  switchOn: true,
  installed: true,
  failOnce: false,
  contentCalls: 0,
  markerCalls: 0,
}));
let f: Awaited<ReturnType<typeof commercialFixture>>;
let corridors: CorridorService, operations: OperationsService, content: RoutePackContentService;
let sheet: RoutePackSheetService;
// Counts every call into the content service, and can fail the next one, so the tests can see that a refused request never
// reached it and that a failed read recovers.
const watched = () =>
  new Proxy(content, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        web.contentCalls++;
        if (web.failOnce) {
          web.failOnce = false;
          throw new Error('Synthetic read failure');
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'http://localhost:3300' },
    provider: {
      getSession: async () => (web.actor ? { token: f.users[web.actor]!.ctx.token } : null),
    },
    routePackContent: watched(),
    routePackSheet: {
      available: async () => {
        web.markerCalls++;
        return web.installed && (await sheet.available());
      },
    },
  }),
}));
vi.mock('../../apps/web/lib/ux-switches', () => ({ uxSwitchOn: () => web.switchOn }));
vi.mock('../../apps/web/lib/notify', () => ({ notify: vi.fn() }));
import { GET, POST } from '../../apps/web/app/api/team-control/[action]/route';

const reason = 'Synthetic route pack editor read test';
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const lastYear = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
const owner = () => f.users.owner.ctx;
const draftConfiguration = (): RouteConfiguration => initialRouteConfiguration(initialRoutes[2]);
const lockedCore = {
  missionTypes: ['sourcing'],
  languages: ['en'],
  currencies: ['USD'],
  timeZones: ['Etc/UTC'],
  channels: ['SYNTHETIC'],
};
let pairs = 0;
async function newRoute() {
  const id = randomUUID();
  const [origin, destination] = [countryCodes[2 * pairs]!, countryCodes[2 * pairs + 1]!];
  pairs++;
  await corridors.createRoute(owner(), { id, origin, destination, reason });
  return id;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 3));
async function appendPack(routeId: string, version: number, status: PackStatus) {
  await pause();
  return corridors.appendPack(owner(), {
    id: randomUUID(),
    routeId,
    version,
    status,
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: draftConfiguration(),
  });
}
const coreContentField = standardFieldsV1.find(
  (field) => field.part === 'Content' && field.core && field.type === 'text',
)!;
const fact = (key: string, extra: Partial<ContentFact> = {}) =>
  ({
    key,
    state: 'FILLED',
    value: 'Sample route fact',
    source: 'staff knowledge',
    observedOn: yesterday,
    ...extra,
  }) as ContentFact;
async function saveFacts(routeId: string, facts: ContentFact[]) {
  const document: ContentDocument = { standardVersion: 1, sectionMarks: [], facts };
  const [view] = (await content.overview(owner(), { routeIds: [routeId] })).routes;
  return content.append(owner(), {
    id: randomUUID(),
    routeId,
    version: (view?.content?.version ?? 0) + 1,
    document,
    reason,
  });
}
const base = 'http://localhost:3300/api/team-control';
const read = (action: string, query = '', tenant = f.tenantA) =>
  GET(new Request(`${base}/${action}?tenant=${tenant}${query ? '&' + query : ''}`), {
    params: Promise.resolve({ action }),
  });
const post = (action: string, query = '') =>
  POST(
    new Request(`${base}/${action}?tenant=${f.tenantA}${query ? '&' + query : ''}`, {
      method: 'POST',
      headers: { origin: 'http://localhost:3300', 'content-type': 'application/json' },
      body: '{}',
    }),
    { params: Promise.resolve({ action }) },
  );
const reads = ['route-pack-overview', 'route-pack-fact-history', 'route-pack-pack-history'];
// The keys of one pack history version, sorted (PR 4 adds `reason`, Guardian G72 ruling of 27 Nov).
const packVersionKeys = [
  'effectiveFrom',
  'proposedAndPublishedBySame',
  'proposedAndPublishedByYou',
  'reason',
  'reviewed',
  'version',
];
const overview = async (routeId?: string, tenant = f.tenantA) =>
  (await read('route-pack-overview', routeId ? `routeId=${routeId}` : '', tenant)).json();
// The answer of an unknown action, which the new actions must match byte for byte (but for the request id).
async function shape(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  delete body.correlationId;
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  delete headers['x-corridra-request-id'];
  return { status: response.status, headers, body };
}

let withPack: string, withoutPack: string, staleRoute: string;
beforeAll(async () => {
  process.env.CORRIDRA_ROUTE_PACK_FORM = 'true';
  f = await commercialFixture();
  await migrateCustomerRealUse(f.owner);
  await migrateSourcingWorkflow(f.owner);
  await configureSourcingWorkflow(f.owner, {
    enabled: true,
    reason: 'Synthetic sourcing control open for the route pack editor read test',
  });
  await migrateRoutePack(f.owner);
  corridors = new CorridorService(f.runtime);
  operations = new OperationsService(f.runtime);
  content = new RoutePackContentService(f.runtime);
  sheet = new RoutePackSheetService(f.runtime, corridors, operations, content);
  await corridors.installTemplates(owner());
  // The reviewer is an admin for these tests (owner, admin and viewer are the three readers).
  await changeMemberNow(new AccessService(f.runtime), owner(), {
    userId: f.users.reviewer.id,
    role: 'admin',
    revoked: false,
  });
  withPack = await newRoute();
  withoutPack = await newRoute();
  staleRoute = await newRoute();
  // Live with every Core field Pending, one fact saved.
  await appendPack(withPack, 1, 'ACTIVE');
  await saveFacts(withPack, [fact('notes.general')]);
  // A Core fact that has run out of date.
  await appendPack(staleRoute, 1, 'TESTING');
  await saveFacts(staleRoute, [
    fact(coreContentField.key, { observedOn: lastYear, validUntil: lastYear }),
  ]);
}, 180000);
afterAll(async () => {
  delete process.env.CORRIDRA_ROUTE_PACK_FORM;
  await f?.close();
});
beforeEach(async () => {
  web.actor = 'owner';
  web.switchOn = true;
  web.installed = true;
  web.failOnce = false;
  web.contentCalls = 0;
  web.markerCalls = 0;
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});

describe('route-pack-overview, the list', () => {
  test('counts come from the shared completeness, not from the page; no document or configuration is sent', async () => {
    const body = (await overview()) as OverviewList;
    expect(body.capabilities).toEqual({
      routePackForm: true,
      contentInstalled: true,
      onePersonPublication: expect.any(Boolean),
    });
    const live = body.routes.find((route) => route.routeId === withPack)!;
    const expected = deriveCompleteness(
      { status: 'ACTIVE', configuration: draftConfiguration() },
      { standardVersion: 1, sectionMarks: [], facts: [fact('notes.general')] },
      today,
    );
    expect(live.core).toEqual({
      total: coreKeysV1.length,
      pending: expected.pendingCore.length,
      stale: 0,
    });
    expect(live.core.pending).toBeGreaterThan(0);
    expect(live).toMatchObject({
      pack: { version: 1, status: 'ACTIVE' },
      facts: { version: 1 },
      optionalPending: expected.pendingOptionalCount,
      liveWithGaps: true,
    });
    const text = JSON.stringify(body);
    for (const word of ['"document"', '"configuration"', 'createdBy', f.users.owner.id])
      expect(text).not.toContain(word);
  });

  test('a route with no pack and no facts reads as all Core Pending and is not live with gaps; a stale Core fact is counted', async () => {
    const body = (await overview()) as OverviewList;
    const empty = body.routes.find((route) => route.routeId === withoutPack)!;
    expect(empty).toMatchObject({
      pack: null,
      facts: null,
      core: { total: coreKeysV1.length, pending: coreKeysV1.length, stale: 0 },
      liveWithGaps: false,
    });
    const stale = body.routes.find((route) => route.routeId === staleRoute)!;
    expect(stale.core.stale).toBe(1);
    expect(stale.liveWithGaps).toBe(false);
  });
});

describe('route-pack-overview, one route', () => {
  test('the whole route with its completeness, and no actor id', async () => {
    const body = (await overview(withPack)) as OverviewRoute;
    expect(body.route?.content?.document.facts.map((item) => item.key)).toEqual(['notes.general']);
    expect(body.route?.completeness.fields.length).toBeGreaterThanOrEqual(standardFieldsV1.length);
    expect(body.route?.pack).toMatchObject({ version: 1, status: 'ACTIVE' });
    expect(body.customLabels).toEqual({});
    const text = JSON.stringify(body);
    expect(text).not.toContain('createdBy');
    expect(text).not.toContain(f.users.owner.id);
    // Only what the page draws: no record id, no free staff text, no pack id in readiness.
    expect(Object.keys(body.route!.pack!).sort()).toEqual(['configuration', 'status', 'version']);
    expect(Object.keys(body.route!.content!).sort()).toEqual(['document', 'version']);
    expect(Object.keys(body.route!).sort()).toEqual([
      'completeness',
      'content',
      'destination',
      'key',
      'origin',
      'pack',
      'readiness',
      'routeId',
    ]);
    expect(text).not.toContain(reason);
    expect(text).not.toContain('"reason"');
    // The owner reads readiness for the pack in force: none recorded yet.
    expect(body.route?.readiness).toEqual({ completeMissionTypes: [] });
  });

  test('a route of no workspace we can read answers null, and another workspace gets no data', async () => {
    const unknown = (await overview(randomUUID())) as OverviewRoute;
    expect(unknown.route).toBeNull();
    // A member of workspace B asking B for the route id of workspace A sees nothing of A.
    web.actor = 'other';
    const other = (await overview(withPack, f.tenantB)) as OverviewRoute;
    expect(other.route).toBeNull();
    expect(JSON.stringify(other)).not.toContain('notes.general');
  });
});

describe('route-pack-fact-history and route-pack-pack-history', () => {
  test('fact history says whether it was you, with no id; any staff role with missions.read may read it', async () => {
    const mine = (await (await read('route-pack-fact-history', `routeId=${withPack}`)).json()) as {
      versions: FactVersion[];
    };
    expect(mine.versions).toEqual([
      {
        id: expect.any(String),
        version: 1,
        packId: expect.any(String),
        createdAt: expect.any(String),
        createdByYou: true,
        reason,
      },
    ]);
    web.actor = 'viewer';
    const other = await read('route-pack-fact-history', `routeId=${withPack}`);
    expect(other.status).toBe(200);
    const text = JSON.stringify(await other.json());
    expect(text).toContain('"createdByYou":false');
    expect(text).not.toContain('createdBy"');
    expect(text).not.toContain(f.users.owner.id);
  });

  test('pack history after a reviewed publish says one person proposed and published it, with its decision reason and no id', async () => {
    const routeId = await newRoute();
    await pause();
    await createRoutePack({ corridors, operations, content }, owner(), {
      routeId,
      version: 1,
      status: 'TESTING',
      effectiveFrom: new Date().toISOString(),
      reason,
      missionTypes: lockedCore.missionTypes,
      languages: lockedCore.languages,
      currencies: lockedCore.currencies,
      timeZones: lockedCore.timeZones,
      manualChannel: false,
    });
    const answer = await read('route-pack-pack-history', `routeId=${routeId}`);
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { versions: PackVersion[] };
    expect(body.versions).toHaveLength(1);
    // PR 4 (Guardian G72, 27 Nov): exactly these keys per version. The one reason sent is the stored publish decision
    // reason, verbatim; no pack id, status, proposal reason or actor id.
    expect(Object.keys(body.versions[0]!).sort()).toEqual(packVersionKeys);
    const [decision] = (
      await f.owner.query<{ reason: string }>(
        `SELECT d.reason FROM app.configuration_decision d
         JOIN app.corridor_pack_version p ON p.tenant_id=d.tenant_id AND p.id=d.published_pack_id
         WHERE p.tenant_id=$1 AND p.route_id=$2 AND d.decision='PUBLISH'`,
        [f.tenantA, routeId],
      )
    ).rows;
    expect(decision?.reason).toEqual(expect.any(String));
    expect(body.versions[0]).toEqual({
      version: 1,
      effectiveFrom: expect.any(String),
      reviewed: true,
      proposedAndPublishedByYou: true,
      proposedAndPublishedBySame: true,
      reason: decision!.reason,
    });
    const text = JSON.stringify(body);
    for (const word of [
      'publishedBy"',
      'proposedBy"',
      'proposalReason',
      'decisionReason',
      'packId',
      '"status"',
      '"id"',
      f.users.owner.id,
    ])
      expect(text).not.toContain(word);
    // The admin did neither step: not by you, still by one person.
    web.actor = 'reviewer';
    const admin = (await (await read('route-pack-pack-history', `routeId=${routeId}`)).json()) as {
      versions: PackVersion[];
    };
    expect(admin.versions[0]).toMatchObject({
      proposedAndPublishedByYou: false,
      proposedAndPublishedBySame: true,
      reason: decision!.reason,
    });
  });

  test('a pack that did not go through review has no decision, so its reason is null, never the pack reason', async () => {
    const answer = await read('route-pack-pack-history', `routeId=${withPack}`);
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { versions: PackVersion[] };
    expect(body.versions).toHaveLength(1);
    expect(Object.keys(body.versions[0]!).sort()).toEqual(packVersionKeys);
    expect(body.versions[0]).toEqual({
      version: 1,
      effectiveFrom: expect.any(String),
      reviewed: false,
      proposedAndPublishedByYou: false,
      proposedAndPublishedBySame: false,
      reason: null,
    });
    expect(JSON.stringify(body)).not.toContain(reason);
  });
});

describe('roles', () => {
  test('an admin reads the overview, readiness and pack history', async () => {
    web.actor = 'reviewer';
    const body = (await overview(withPack)) as OverviewRoute;
    expect(body.route?.readiness).toEqual({ completeMissionTypes: [] });
    expect((await read('route-pack-pack-history', `routeId=${withPack}`)).status).toBe(200);
  });

  test('a viewer reads the overview and fact history, sees no readiness and is refused the pack history', async () => {
    web.actor = 'viewer';
    const body = (await overview(withPack)) as OverviewRoute;
    expect(body.route?.readiness).toBeNull();
    expect((await read('route-pack-fact-history', `routeId=${withPack}`)).status).toBe(200);
    const refused = await read('route-pack-pack-history', `routeId=${withPack}`);
    expect(refused.status).toBe(403);
    const text = JSON.stringify(await refused.json());
    expect(text).not.toContain('versions');
    expect(text).not.toContain('"reason"');
  });
});

describe('denial', () => {
  test('no session answers 401 for each action', async () => {
    web.actor = null;
    for (const action of reads)
      expect((await read(action, `routeId=${withPack}`)).status).toBe(401);
  });

  test('a member of another workspace asking for this workspace gets 403 and no data', async () => {
    web.actor = 'other';
    for (const action of reads) {
      const response = await read(action, `routeId=${withPack}`, f.tenantA);
      expect(response.status).toBe(403);
      const text = JSON.stringify(await response.json());
      expect(text).not.toContain('notes.general');
      expect(text).not.toContain(withPack);
    }
  });

  test('a routeId that is not a uuid answers 400; the history reads need one', async () => {
    expect((await read('route-pack-overview', 'routeId=nope')).status).toBe(400);
    expect((await read('route-pack-fact-history', 'routeId=nope')).status).toBe(400);
    expect((await read('route-pack-pack-history', 'routeId=nope')).status).toBe(400);
    expect((await read('route-pack-fact-history')).status).toBe(400);
  });

  test('only GET reads: POST answers 404 for each action, as an unknown action does', async () => {
    const unknown = await shape(await post('route-pack-unknown'));
    for (const action of reads) expect(await shape(await post(action))).toEqual(unknown);
    expect(unknown.status).toBe(404);
  });

  test('switch off: 404 for all three, the same as an unknown action, with no marker query and no service call', async () => {
    web.switchOn = false;
    const unknown = await shape(await read('route-pack-unknown'));
    for (const action of reads) {
      // A bad routeId is never looked at: the gate comes first.
      expect(await shape(await read(action, 'routeId=nope'))).toEqual(unknown);
      expect(await shape(await read(action, `routeId=${withPack}`))).toEqual(unknown);
    }
    expect(unknown).toMatchObject({ status: 404, body: { error: 'Not found' } });
    expect(web.markerCalls).toBe(0);
    expect(web.contentCalls).toBe(0);
  });

  test('module absent (marker missing): 404 for the three reads, export and import, and no service call', async () => {
    web.installed = false;
    const unknown = await shape(await read('route-pack-unknown'));
    for (const action of reads)
      expect(await shape(await read(action, 'routeId=nope'))).toEqual(unknown);
    for (const action of ['route-pack-export', 'route-pack-import'])
      expect(await shape(await read(action, 'routes=BD-CN'))).toEqual(unknown);
    expect(web.contentCalls).toBe(0);
  });
});

describe('recovery', () => {
  test('after a failed read the same request succeeds', async () => {
    web.failOnce = true;
    const failed = await read('route-pack-overview');
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain('Synthetic read failure');
    expect((await read('route-pack-overview')).status).toBe(200);
  });

  test('after the switch is turned off and on again the same request answers data again', async () => {
    web.switchOn = false;
    expect((await read('route-pack-overview')).status).toBe(404);
    web.switchOn = true;
    const again = await read('route-pack-overview');
    expect(again.status).toBe(200);
    expect(((await again.json()) as OverviewList).routes.length).toBeGreaterThan(0);
  });
});
