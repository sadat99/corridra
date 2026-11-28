import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command } from './access-fixture';
import { changeMemberNow } from './change-member';
import { bdCnSourcingProfile } from './fixtures/bd-cn-sourcing-profile';
import { AccessService } from '../../packages/auth/src/access';
import { configureSourcingWorkflow } from '../../packages/auth/src/sourcing-workflow-configuration';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateSourcingWorkflow } from '../../packages/db/src/sourcing-workflow-migrate';
import { migrateRoutePack } from '../../packages/db/src/route-pack-migrate';
import { countryCodes } from '../../packages/domain/src/countries';
import { DomainError } from '../../packages/domain/src/index';
import { initialRoutes, type RouteConfiguration } from '../../packages/domain/src/corridors';
import { routePackWords, type PackStatus } from '../../packages/domain/src/route-pack-standard';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { OperationsService } from '../../packages/missions/src/operations';
import { RoutePackContentService } from '../../packages/missions/src/route-pack-content';
import { RoutePackSheetService } from '../../packages/missions/src/route-pack-sheet';
import {
  packPreviewAnswer,
  packPublishedAnswer,
  type PackPreview,
  type PackPublished,
} from '../../apps/web/lib/route-pack-editor-publish';

// ADR-093 Phase 3, PR 3a: the pack settings and status of the route pack editor, the team-control action route-pack-publish,
// previewed and published. The real handler, services and an isolated PostgreSQL with the route pack module installed; only the
// session provider, the switch reader and (for the module absent case) the marker answer are replaced. Red on the code before
// PR 3a: the action did not exist and answered 404 to every request below that expects a preview, a publish or a refusal of its
// own.
const web = vi.hoisted(() => ({
  actor: 'owner' as string | null,
  switchOn: true,
  installed: true,
  contentCalls: [] as string[],
  operationsCalls: [] as string[],
  markerCalls: 0,
  // Run once just before the next decide command reaches the operations service: a deterministic race.
  beforeDecide: null as null | (() => Promise<unknown>),
}));
let f: Awaited<ReturnType<typeof commercialFixture>>;
let corridors: CorridorService, operations: OperationsService, content: RoutePackContentService;
let sheet: RoutePackSheetService;
// Names every call into a service: a refused request must never reach it, and a refusal of authority must come first.
const watched = <T extends object>(service: () => T, calls: () => string[]) =>
  new Proxy(
    {},
    {
      get(_target, property) {
        const target = service();
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        return async (...args: unknown[]) => {
          calls().push(String(property));
          const race = web.beforeDecide;
          if (
            property === 'command' &&
            (args[1] as { action?: string }).action === 'decide' &&
            race
          ) {
            web.beforeDecide = null;
            await race();
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    },
  );
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'http://localhost:3300' },
    provider: {
      getSession: async () => (web.actor ? { token: f.users[web.actor]!.ctx.token } : null),
    },
    routePackContent: watched(
      () => content,
      () => web.contentCalls,
    ),
    operations: watched(
      () => operations,
      () => web.operationsCalls,
    ),
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

const reason = 'Synthetic route pack editor publish test';
const owner = () => f.users.owner.ctx;
const origin = 'http://localhost:3300';
const base = `${origin}/api/team-control`;
const action = 'route-pack-publish';
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const reviewerWords = 'An independent authorized reviewer is required';
const noChangeWords = 'Nothing changes in this pack. Change a setting or the status first.';
// A pack whose Locked Core lists are filled, so emptying one on a live route is the go-live refusal.
const filledConfiguration = (): RouteConfiguration => ({
  ...initialRouteConfiguration(initialRoutes[2]),
  languages: ['en'],
  currencies: ['EUR'],
  timeZones: ['Etc/UTC'],
  localities: ['dhaka'],
  evidenceTypes: ['invoice'],
});
let pairs = 0;
async function newRoute() {
  const id = randomUUID();
  const [from, to] = [countryCodes[2 * pairs]!, countryCodes[2 * pairs + 1]!];
  pairs++;
  await corridors.createRoute(owner(), { id, origin: from, destination: to, reason });
  return id;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 3));
async function appendPack(
  routeId: string,
  version: number,
  status: PackStatus,
  configuration: RouteConfiguration = filledConfiguration(),
) {
  await pause();
  return corridors.appendPack(owner(), {
    id: randomUUID(),
    routeId,
    version,
    status,
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration,
  });
}
const settings = (routeId: string, version: number, extra: Record<string, unknown> = {}) => ({
  kind: 'settings',
  commandId: randomUUID(),
  routeId,
  version,
  reason,
  ...extra,
});
const statusChange = (routeId: string, version: number, status: PackStatus) => ({
  kind: 'status',
  commandId: randomUUID(),
  routeId,
  version,
  reason,
  status,
});
type Options = {
  method?: string;
  tenant?: string;
  action?: string;
  headers?: Record<string, string>;
};
const url = (name: string, tenant: string) => `${base}/${name}?tenant=${tenant}`;
const send = (body: BodyInit | null, options: Options = {}) => {
  const name = options.action ?? action;
  return POST(
    new Request(url(name, options.tenant ?? f.tenantA), {
      method: options.method ?? 'POST',
      headers: { origin, 'content-type': 'application/json', ...options.headers },
      body,
    }),
    { params: Promise.resolve({ action: name }) },
  );
};
const preview = (change: unknown, options: Options = {}) =>
  send(JSON.stringify({ mode: 'preview', change }), options);
const publish = (change: unknown, options: Options = {}) =>
  send(JSON.stringify({ mode: 'publish', change }), options);
// A body that is never finished: counts how many chunks the handler pulled and whether it cancelled the stream.
function endless(options: Options = {}) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled++;
        controller.enqueue(new Uint8Array(65536).fill(97));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const response = POST(
    new Request(url(action, f.tenantA), {
      method: options.method ?? 'POST',
      headers: { origin, 'content-type': 'application/json', ...options.headers },
      body: stream,
      duplex: 'half',
    } as RequestInit),
    { params: Promise.resolve({ action }) },
  );
  return { state, response };
}
// The answer of an unknown action, which the gate must match exactly (but for the request id).
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
const unknownAction = () => send('{}', { action: 'route-pack-unknown' });
const asJson = async (response: Response) => (await response.json()) as Record<string, unknown>;
const tables = [
  'corridor_pack_version',
  'configuration_proposal',
  'configuration_decision',
  'route_readiness',
  'operations_command',
  'audit_event',
  'domain_event',
  'outbox',
];
// Every table a publish, a refusal or an event could write, counted across the database.
const counts = async () =>
  Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        Number((await f.owner.query(`SELECT count(*) FROM app.${table}`)).rows[0].count),
      ]),
    ),
  );
type StoredPack = {
  id: string;
  version: number;
  status: PackStatus;
  configuration: RouteConfiguration;
  created_by: string;
  reason: string;
};
const packsOf = async (routeId: string) =>
  (
    await f.owner.query<StoredPack>(
      'SELECT id,version,status,configuration,created_by,reason FROM app.corridor_pack_version WHERE route_id=$1 ORDER BY version',
      [routeId],
    )
  ).rows;
const proposalsOf = async (routeId: string) =>
  (
    await f.owner.query<{ id: string; created_by: string }>(
      'SELECT id,created_by FROM app.configuration_proposal WHERE route_id=$1',
      [routeId],
    )
  ).rows;
const decisionsOf = async (routeId: string) =>
  (
    await f.owner.query<{ created_by: string; published_pack_id: string | null }>(
      'SELECT d.created_by,d.published_pack_id FROM app.configuration_decision d JOIN app.configuration_proposal q ON q.tenant_id=d.tenant_id AND q.id=d.proposal_id WHERE q.route_id=$1',
      [routeId],
    )
  ).rows;
const expired = () =>
  f.owner.query("UPDATE identity.assurance SET verified_at=now()-interval '10 minutes'");
const fresh = () => f.owner.query('UPDATE identity.assurance SET verified_at=now()');
// Run with the one-person publication marker hidden, as before the ADR-093 2a install, and always put it back.
async function beforeTwoA(run: () => Promise<void>) {
  await f.owner.query(
    'ALTER FUNCTION app.route_pack_one_person_publication() RENAME TO route_pack_one_person_publication_hidden',
  );
  try {
    await run();
  } finally {
    await f.owner.query(
      'ALTER FUNCTION app.route_pack_one_person_publication_hidden() RENAME TO route_pack_one_person_publication',
    );
  }
}

beforeAll(async () => {
  process.env.CORRIDRA_ROUTE_PACK_FORM = 'true';
  f = await commercialFixture();
  await migrateCustomerRealUse(f.owner);
  await migrateSourcingWorkflow(f.owner);
  await configureSourcingWorkflow(f.owner, {
    enabled: true,
    reason: 'Synthetic sourcing control open for the route pack editor publish test',
  });
  await migrateRoutePack(f.owner);
  corridors = new CorridorService(f.runtime);
  operations = new OperationsService(f.runtime);
  content = new RoutePackContentService(f.runtime);
  sheet = new RoutePackSheetService(f.runtime, corridors, operations, content);
  await corridors.installTemplates(owner());
  // The reviewer is an admin for these tests.
  await changeMemberNow(new AccessService(f.runtime), owner(), {
    userId: f.users.reviewer.id,
    role: 'admin',
    revoked: false,
  });
}, 180000);
afterAll(async () => {
  delete process.env.CORRIDRA_ROUTE_PACK_FORM;
  await f?.close();
});
beforeEach(async () => {
  web.actor = 'owner';
  web.switchOn = true;
  web.installed = true;
  web.contentCalls.length = 0;
  web.operationsCalls.length = 0;
  web.markerCalls = 0;
  web.beforeDecide = null;
  await fresh();
});

describe('route-pack-publish, the gate', () => {
  test('switch off: the answer of an unknown action, before any body is read, with no marker query and no service call; on again, it publishes', async () => {
    web.switchOn = false;
    const unknown = await shape(await unknownAction());
    expect(unknown).toMatchObject({ status: 404, body: { error: 'Not found' } });
    const routeId = await newRoute();
    const change = settings(routeId, 1, { missionTypes: ['sourcing'] });
    expect(await shape(await send('{not json'))).toEqual(unknown);
    expect(await shape(await send('x'.repeat(200000)))).toEqual(unknown);
    expect(await shape(await publish(change))).toEqual(unknown);
    expect(await shape(await preview(change))).toEqual(unknown);
    const endlessBody = endless();
    expect(await shape(await endlessBody.response)).toEqual(unknown);
    expect(endlessBody.state.pulled).toBe(0);
    expect(web.markerCalls).toBe(0);
    expect(web.contentCalls).toEqual([]);
    expect(web.operationsCalls).toEqual([]);
    expect(await packsOf(routeId)).toEqual([]);
    web.switchOn = true;
    const published = await publish(change);
    expect(published.status).toBe(201);
    expect(await asJson(published)).toMatchObject({ version: 1, duplicate: false });
  });

  test('marker absent: the same answer, no body is read and no service call is made; installed again, it publishes', async () => {
    web.installed = false;
    const unknown = await shape(await unknownAction());
    const routeId = await newRoute();
    const change = settings(routeId, 1, { missionTypes: ['sourcing'] });
    expect(await shape(await send('{not json'))).toEqual(unknown);
    expect(await shape(await publish(change))).toEqual(unknown);
    const endlessBody = endless();
    expect(await shape(await endlessBody.response)).toEqual(unknown);
    expect(endlessBody.state.pulled).toBe(0);
    expect(web.contentCalls).toEqual([]);
    expect(web.operationsCalls).toEqual([]);
    expect(await packsOf(routeId)).toEqual([]);
    web.installed = true;
    expect((await publish(change)).status).toBe(201);
  });

  test('GET, PUT and DELETE answer 404 like an unknown action, with no body read and no service call; POST publishes', async () => {
    const unknown = await shape(await unknownAction());
    const routeId = await newRoute();
    const change = settings(routeId, 1, { missionTypes: ['sourcing'] });
    const read = await GET(new Request(url(action, f.tenantA)), {
      params: Promise.resolve({ action }),
    });
    expect(await shape(read)).toEqual(unknown);
    for (const method of ['PUT', 'DELETE']) {
      expect(
        await shape(await send(JSON.stringify({ mode: 'publish', change }), { method })),
      ).toEqual(unknown);
      const endlessBody = endless({ method });
      expect(await shape(await endlessBody.response)).toEqual(unknown);
      expect(endlessBody.state.pulled).toBe(0);
    }
    expect(web.contentCalls).toEqual([]);
    expect(web.operationsCalls).toEqual([]);
    expect(await packsOf(routeId)).toEqual([]);
    expect((await publish(change)).status).toBe(201);
  });
});

describe('route-pack-publish, who may ask', () => {
  test('signed out is 401 and a tenant that is not a uuid is 400, with nothing written and no service call; signed in, it publishes', async () => {
    const routeId = await newRoute();
    const change = settings(routeId, 1, { missionTypes: ['sourcing'] });
    const before = await counts();
    web.actor = null;
    expect((await publish(change)).status).toBe(401);
    expect((await preview(change)).status).toBe(401);
    web.actor = 'owner';
    expect((await publish(change, { tenant: 'not-a-uuid' })).status).toBe(400);
    expect(web.contentCalls).toEqual([]);
    expect(web.operationsCalls).toEqual([]);
    expect(await counts()).toEqual(before);
    expect((await publish(change)).status).toBe(201);
  });

  test('a member of another workspace posting to this workspace gets 403 with no data and nothing written; the owner publishes', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    const before = await counts();
    web.actor = 'other';
    for (const ask of [preview, publish]) {
      const refused = await ask(change);
      expect(refused.status).toBe(403);
      const text = JSON.stringify(await refused.json());
      expect(text).not.toContain(routeId);
      expect(text).not.toContain('languages');
    }
    expect(web.contentCalls).toEqual(['proposalOf', 'proposalOf']);
    expect(await counts()).toEqual(before);
    web.actor = 'owner';
    expect((await publish(change)).status).toBe(201);
  });

  test('an admin and a viewer are refused a preview with 403 after exactly one content call, the proposal read, whatever the body', async () => {
    const live = await newRoute();
    await appendPack(live, 1, 'ACTIVE');
    const bodies = [
      settings(live, 2, { languages: ['en', 'fr'] }),
      // A body that would be the go-live refusal on a live route.
      settings(live, 2, { languages: [] }),
      // A route that does not exist.
      settings(randomUUID(), 1, { missionTypes: ['sourcing'] }),
    ];
    const before = await counts();
    for (const actor of ['reviewer', 'viewer'])
      for (const body of bodies) {
        web.actor = actor;
        web.contentCalls.length = 0;
        const refused = await preview(body);
        expect(refused.status).toBe(403);
        expect(JSON.stringify(await refused.json())).not.toContain(live);
        expect(web.contentCalls).toEqual(['proposalOf']);
        expect(web.operationsCalls).toEqual([]);
      }
    expect(await counts()).toEqual(before);
    web.actor = 'owner';
    const allowed = await preview(bodies[0]);
    expect(allowed.status).toBe(200);
    expect(await asJson(allowed)).toMatchObject({ changedKeys: ['languages'] });
  });

  test('an admin publish is 403 with nothing written; the owner publishes the same body', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    const before = await counts();
    web.actor = 'reviewer';
    expect((await publish(change)).status).toBe(403);
    expect(await counts()).toEqual(before);
    web.actor = 'owner';
    expect((await publish(change)).status).toBe(201);
  });
});

describe('route-pack-publish, the body', () => {
  const cap = 8192 + 8192;
  const padded = (octets: number) => {
    const shell = '{"pad":""}';
    return `{"pad":"${'a'.repeat(octets - shell.length)}"}`;
  };

  test('one octet over the cap is 413 before anything is parsed; the cap itself reaches the parser', async () => {
    const over = await send(padded(cap + 1));
    expect(over.status).toBe(413);
    expect(await asJson(over)).toMatchObject({ error: 'Request is too large' });
    expect(web.contentCalls).toEqual([]);
    // At the cap the body is read and judged: an extra key is a plain 400, not 413.
    const atCap = await send(padded(cap));
    expect(atCap.status).toBe(400);
    expect(await asJson(atCap)).toMatchObject({ error: 'Check the submitted values' });
    expect(web.contentCalls).toEqual([]);
    // A body larger than the 4096 octets of other actions, and within this cap, is read.
    const routeId = await newRoute();
    const long = JSON.stringify({
      mode: 'publish',
      change: settings(routeId, 1, {
        missionTypes: ['sourcing'],
        localities: Array.from({ length: 50 }, (_, i) => `l${'x'.repeat(75)}_${i}`),
      }),
    });
    expect(Buffer.byteLength(long)).toBeGreaterThan(4096);
    expect((await send(long)).status).toBe(201);
  });

  test('a body that never ends is cancelled soon after the cap, whatever Content-Length says', async () => {
    const lying = endless({ headers: { 'content-length': '20' } });
    const response = await lying.response;
    expect(response.status).toBe(413);
    expect(lying.state.cancelled).toBe(true);
    expect(lying.state.pulled).toBeLessThanOrEqual(2);
    expect(web.contentCalls).toEqual([]);
  });

  test('a body that is not UTF-8 is 400 with nothing written; the same body in UTF-8 publishes', async () => {
    const routeId = await newRoute();
    const good = JSON.stringify({
      mode: 'publish',
      change: settings(routeId, 1, { missionTypes: ['sourcing'] }),
    });
    const bad = Buffer.concat([
      Buffer.from(good.slice(0, -1)),
      Buffer.from([0xff, 0xfe]),
      Buffer.from('}'),
    ]);
    const refused = await send(bad as unknown as BodyInit);
    expect(refused.status).toBe(400);
    expect(await asJson(refused)).toMatchObject({ error: 'Send the request as UTF-8 text' });
    expect(await packsOf(routeId)).toEqual([]);
    expect((await send(good)).status).toBe(201);
  });

  test.each([
    ['an unknown key in the request', (change: object) => ({ mode: 'publish', change, extra: 1 })],
    [
      'an unknown key in the change',
      (change: object) => ({ mode: 'publish', change: { ...change, extra: 1 } }),
    ],
    [
      'a sourcing profile',
      (change: object) => ({
        mode: 'publish',
        change: { ...change, sourcing: bdCnSourcingProfile },
      }),
    ],
    [
      'a status on a settings change',
      (change: object) => ({ mode: 'publish', change: { ...change, status: 'ACTIVE' } }),
    ],
    [
      'an effective date',
      (change: object) => ({
        mode: 'publish',
        change: { ...change, effectiveFrom: new Date().toISOString() },
      }),
    ],
    ['an unknown mode', (change: object) => ({ mode: 'save', change })],
    [
      'an unknown kind',
      (change: object) => ({ mode: 'publish', change: { ...change, kind: 'x' } }),
    ],
    [
      'a command id that is not a uuid',
      (change: object) => ({ mode: 'publish', change: { ...change, commandId: 'x' } }),
    ],
    [
      'a reason of 2 characters',
      (change: object) => ({ mode: 'publish', change: { ...change, reason: 'ab' } }),
    ],
    [
      'an empty mission type list',
      (change: object) => ({ mode: 'publish', change: { ...change, missionTypes: [] } }),
    ],
  ])('%s is 400 with nothing written and the corrected request publishes', async (_name, wrap) => {
    const routeId = await newRoute();
    const change = settings(routeId, 1, { missionTypes: ['sourcing'] });
    const before = await counts();
    const refused = await send(JSON.stringify(wrap(change)));
    expect(refused.status).toBe(400);
    expect(web.contentCalls).toEqual([]);
    expect(await counts()).toEqual(before);
    expect((await publish(change)).status).toBe(201);
  });

  test('a route with no pack and no mission types is 400 ROUTE_PACK_INVALID in plain words; with them it publishes', async () => {
    const routeId = await newRoute();
    const before = await counts();
    for (const ask of [preview, publish]) {
      const refused = await ask(settings(routeId, 1, { languages: ['en'] }));
      expect(refused.status).toBe(400);
      expect(await asJson(refused)).toMatchObject({
        code: 'ROUTE_PACK_INVALID',
        error: 'Choose at least one mission type.',
      });
    }
    expect(await counts()).toEqual(before);
    expect((await publish(settings(routeId, 1, { missionTypes: ['sourcing'] }))).status).toBe(201);
  });

  test('a status change on a route with no pack, or on a route that does not exist, is 404 Route unavailable', async () => {
    const routeId = await newRoute();
    const before = await counts();
    for (const target of [routeId, randomUUID()])
      for (const ask of [preview, publish]) {
        const refused = await ask(statusChange(target, 1, 'TESTING'));
        expect(refused.status).toBe(404);
        expect(await asJson(refused)).toMatchObject({ error: 'Route unavailable' });
      }
    expect(await counts()).toEqual(before);
    // A settings change gives the route its first pack, and then the status change is the next version.
    expect((await publish(settings(routeId, 1, { missionTypes: ['sourcing'] }))).status).toBe(201);
    expect((await publish(statusChange(routeId, 2, 'TESTING'))).status).toBe(201);
  });
});

describe('route-pack-publish, a preview', () => {
  test('the owner previews a settings change: every field, nothing written', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'ACTIVE');
    const before = await counts();
    await fresh();
    const response = await preview(settings(routeId, 2, { languages: ['en', 'fr'] }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const answer = (await response.json()) as PackPreview;
    expect(answer).toEqual({
      kind: 'settings',
      statusFrom: 'ACTIVE',
      statusTo: 'ACTIVE',
      changedKeys: ['languages'],
      baseVersion: 1,
      newVersion: 2,
      duplicate: false,
      historicalAssignmentsPreserved: 0,
      warnings: [],
      blocked: null,
      onePersonPublication: true,
      removedPolicies: [],
    });
    expect(await counts()).toEqual(before);
    expect(web.operationsCalls).toEqual(['preview']);
  });

  test('a preview of the first pack of a route names every key, from no status to Draft at version 1', async () => {
    const routeId = await newRoute();
    const before = await counts();
    const response = await preview(settings(routeId, 1, { missionTypes: ['sourcing'] }));
    expect(response.status).toBe(200);
    const answer = (await response.json()) as PackPreview;
    expect(answer).toMatchObject({
      kind: 'settings',
      statusFrom: null,
      statusTo: 'DRAFT',
      baseVersion: null,
      newVersion: 1,
      blocked: null,
    });
    expect(answer.changedKeys).toEqual(expect.arrayContaining(['missionTypes', 'channels']));
    expect(answer.changedKeys).not.toContain('sourcing');
    expect(await counts()).toEqual(before);
  });

  test('a preview of a status change names the move and no changed key', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const response = await preview(statusChange(routeId, 2, 'LIMITED'));
    expect(response.status).toBe(200);
    expect(await asJson(response)).toMatchObject({
      kind: 'status',
      statusFrom: 'TESTING',
      statusTo: 'LIMITED',
      changedKeys: [],
      baseVersion: 1,
      newVersion: 2,
      blocked: null,
    });
  });
});

describe('route-pack-publish, a settings change', () => {
  test('publishes one new version with the same status, the set key changed and every other key carried exactly', async () => {
    const routeId = await newRoute();
    const configuration = { ...filledConfiguration(), sourcing: bdCnSourcingProfile };
    await appendPack(routeId, 1, 'TESTING', configuration);
    const [first] = await packsOf(routeId);
    const readiness = (await counts()).route_readiness;
    const response = await publish(
      settings(routeId, 2, { languages: ['en', 'fr'], manualChannel: true }),
    );
    expect(response.status).toBe(201);
    const answer = (await response.json()) as PackPublished;
    expect(answer).toEqual({ version: 2, duplicate: false, warnings: [], removedPolicies: [] });
    const packs = await packsOf(routeId);
    expect(packs).toHaveLength(2);
    const second = packs[1]!;
    expect(second.status).toBe('TESTING');
    expect(second.configuration).toEqual({
      ...first!.configuration,
      languages: ['en', 'fr'],
      channels: ['MANUAL'],
    });
    expect(second.configuration.sourcing).toEqual(first!.configuration.sourcing);
    // One proposal and one decision, both by the owner, who also wrote the pack.
    const proposals = await proposalsOf(routeId);
    const decisions = await decisionsOf(routeId);
    expect(proposals).toHaveLength(1);
    expect(decisions).toEqual([{ created_by: f.users.owner.id, published_pack_id: second.id }]);
    expect(proposals[0]!.created_by).toBe(f.users.owner.id);
    expect(second.created_by).toBe(f.users.owner.id);
    expect((await counts()).route_readiness).toBe(readiness);
  });

  test('a route with no pack gets version 1 as a Draft with the form defaults', async () => {
    const routeId = await newRoute();
    const response = await publish(settings(routeId, 1, { missionTypes: ['sourcing'] }));
    expect(response.status).toBe(201);
    const [pack] = await packsOf(routeId);
    expect(pack).toMatchObject({ version: 1, status: 'DRAFT' });
    expect(pack!.configuration).toMatchObject({
      missionTypes: ['sourcing'],
      channels: ['SYNTHETIC'],
      languages: [],
    });
  });
});

describe('route-pack-publish, a status change', () => {
  test('publishes the current configuration exactly with only the new status', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'DRAFT', {
      ...filledConfiguration(),
      sourcing: bdCnSourcingProfile,
    });
    const response = await publish(statusChange(routeId, 2, 'TESTING'));
    expect(response.status).toBe(201);
    const [first, second] = await packsOf(routeId);
    expect(second!.status).toBe('TESTING');
    expect(second!.configuration).toEqual(first!.configuration);
  });

  test('a move to Active with Core fields Pending warns ROUTE_PACK_GO_LIVE_PENDING_CORE with their keys, as the preview said', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = statusChange(routeId, 2, 'ACTIVE');
    const previewed = (await (await preview(change)).json()) as PackPreview;
    const response = await publish(change);
    expect(response.status).toBe(201);
    const answer = (await response.json()) as PackPublished;
    expect(answer.warnings).toHaveLength(1);
    expect(answer.warnings[0]!.code).toBe('ROUTE_PACK_GO_LIVE_PENDING_CORE');
    expect(answer.warnings[0]!.keys.length).toBeGreaterThan(0);
    expect(previewed.warnings).toEqual(answer.warnings);
    expect((await packsOf(routeId))[1]!.status).toBe('ACTIVE');
  });
});

describe('route-pack-publish, a live route keeps its Locked Core', () => {
  test.each(['LIMITED', 'ACTIVE'] as const)(
    'on a %s route, emptying a Locked Core list: the preview names it, the publish is 409 with nothing written',
    async (status) => {
      const routeId = await newRoute();
      await appendPack(routeId, 1, status);
      const change = settings(routeId, 2, { languages: [] });
      const before = await counts();
      const previewed = await preview(change);
      expect(previewed.status).toBe(200);
      expect(await asJson(previewed)).toMatchObject({
        blocked: { code: 'ROUTE_PACK_LOCKED_CORE_EMPTIED', keys: ['pack.languages'] },
        warnings: [],
      });
      const refused = await publish(change);
      expect(refused.status).toBe(409);
      expect(await asJson(refused)).toMatchObject({ code: 'ROUTE_PACK_LOCKED_CORE_EMPTIED' });
      expect(await counts()).toEqual(before);
      // Keeping the list, the same route publishes.
      expect((await publish(settings(routeId, 2, { languages: ['fr'] }))).status).toBe(201);
    },
  );

  test('on a Paused route the same change passes', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'PAUSED');
    const change = settings(routeId, 2, { languages: [] });
    expect(await asJson(await preview(change))).toMatchObject({ blocked: null });
    expect((await publish(change)).status).toBe(201);
    expect((await packsOf(routeId))[1]!.configuration.languages).toEqual([]);
  });

  test('with a stale authenticator check, emptying a Locked Core list is 401 STEP_UP_REQUIRED for the preview and the publish, and writes nothing', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'ACTIVE');
    const change = settings(routeId, 2, { languages: [] });
    const before = await counts();
    await expired();
    // The authenticator check comes with the first read, before the go-live check judges anything.
    for (const ask of [preview, publish]) {
      const refused = await ask(change);
      expect(refused.status).toBe(401);
      expect(await asJson(refused)).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    }
    expect(web.contentCalls).toEqual(['proposalOf', 'proposalOf']);
    expect(await counts()).toEqual(before);
    // After a fresh check the same body meets the go-live refusal.
    await fresh();
    const blocked = await publish(change);
    expect(blocked.status).toBe(409);
    expect(await asJson(blocked)).toMatchObject({ code: 'ROUTE_PACK_LOCKED_CORE_EMPTIED' });
    expect(await counts()).toEqual(before);
  });
});

describe('route-pack-publish, the fresh authenticator', () => {
  test('a stale authenticator check is 401 STEP_UP_REQUIRED with nothing written; after a fresh one the same body publishes', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    const before = await counts();
    await expired();
    const refused = await publish(change);
    expect(refused.status).toBe(401);
    expect(await asJson(refused)).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(await counts()).toEqual(before);
    await fresh();
    const again = await publish(change);
    expect(again.status).toBe(201);
    expect(await asJson(again)).toMatchObject({ version: 2, duplicate: false });
  });

  test('a stale authenticator check is 401 STEP_UP_REQUIRED for a preview too, with nothing written; after a fresh one it previews', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    const before = await counts();
    await expired();
    const refused = await preview(change);
    expect(refused.status).toBe(401);
    expect(await asJson(refused)).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(web.operationsCalls).toEqual([]);
    expect(await counts()).toEqual(before);
    await fresh();
    const again = await preview(change);
    expect(again.status).toBe(200);
    expect(await asJson(again)).toMatchObject({ changedKeys: ['languages'], newVersion: 2 });
    expect(await counts()).toEqual(before);
  });
});

describe('route-pack-publish, one command, one pack', () => {
  test('an exact retry is 200 duplicate with one pack and one proposal; the same id with other values is 409 COMMAND_REUSED', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    expect((await publish(change)).status).toBe(201);
    const retry = await publish(change);
    expect(retry.status).toBe(200);
    expect(await asJson(retry)).toEqual({
      version: 2,
      duplicate: true,
      warnings: [],
      removedPolicies: [],
    });
    expect(await packsOf(routeId)).toHaveLength(2);
    expect(await proposalsOf(routeId)).toHaveLength(1);
    const after = await counts();
    for (const other of [
      { ...change, languages: ['de'] },
      { ...change, reason: 'Synthetic other reason' },
      { ...change, version: 3 },
      { ...change, kind: 'status', status: 'LIMITED', languages: undefined },
    ]) {
      const refused = await publish(other);
      expect(refused.status).toBe(409);
      expect(await asJson(refused)).toMatchObject({
        code: 'ROUTE_PACK_COMMAND_REUSED',
        error: routePackWords.commandReused,
      });
    }
    expect(await counts()).toEqual(after);
    // Recovery: a new id with the next version publishes.
    expect(
      (await publish({ ...change, commandId: randomUUID(), version: 3, languages: ['de'] })).status,
    ).toBe(201);
  });

  test('an exact retry of the first pack of a route and of a status change is a duplicate too', async () => {
    const routeId = await newRoute();
    const first = settings(routeId, 1, { missionTypes: ['sourcing'] });
    expect((await publish(first)).status).toBe(201);
    expect((await publish(first)).status).toBe(200);
    const move = statusChange(routeId, 2, 'TESTING');
    expect((await publish(move)).status).toBe(201);
    expect((await publish(move)).status).toBe(200);
    expect(await packsOf(routeId)).toHaveLength(2);
    expect(await proposalsOf(routeId)).toHaveLength(2);
  });

  test('an exact retry after another version was published since is still the duplicate of its own pack', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const mine = settings(routeId, 2, { languages: ['en', 'fr'] });
    expect((await publish(mine)).status).toBe(201);
    expect((await publish(settings(routeId, 3, { currencies: ['USD'] }))).status).toBe(201);
    const retry = await publish(mine);
    expect(retry.status).toBe(200);
    expect(await asJson(retry)).toMatchObject({ version: 2, duplicate: true });
    expect(await packsOf(routeId)).toHaveLength(3);
  });
});

describe('route-pack-publish, a change that lost a race', () => {
  test('a stale version is 409 ROUTE_PACK_PACK_CHANGED for the preview and the publish, with nothing written; the next version publishes', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    await appendPack(routeId, 2, 'TESTING');
    const stale = settings(routeId, 2, { languages: ['en', 'fr'] });
    const before = await counts();
    for (const ask of [preview, publish]) {
      const refused = await ask(stale);
      expect(refused.status).toBe(409);
      expect(await asJson(refused)).toMatchObject({
        code: 'ROUTE_PACK_PACK_CHANGED',
        error: routePackWords.packChanged,
      });
    }
    expect(await counts()).toEqual(before);
    expect((await publish({ ...stale, version: 3 })).status).toBe(201);
  });
});

describe('route-pack-publish, before the one-person install', () => {
  test('the preview says so; the publish keeps the proposal, publishes nothing and says how to finish; installed, the same body publishes once', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    await beforeTwoA(async () => {
      const previewed = await preview(change);
      expect(previewed.status).toBe(200);
      expect(await asJson(previewed)).toMatchObject({ onePersonPublication: false });
      const refused = await publish(change);
      expect(refused.status).toBe(409);
      expect(await asJson(refused)).toMatchObject({
        code: 'ROUTE_PACK_NOT_PUBLISHED',
        error: `${reviewerWords} ${routePackWords.notPublished}`,
      });
      expect(await proposalsOf(routeId)).toHaveLength(1);
      expect(await packsOf(routeId)).toHaveLength(1);
    });
    const finished = await publish(change);
    expect(finished.status).toBe(201);
    expect(await asJson(finished)).toMatchObject({ version: 2, duplicate: false });
    expect(await packsOf(routeId)).toHaveLength(2);
    expect(await proposalsOf(routeId)).toHaveLength(1);
  });
});

describe('route-pack-publish, a decision refused after the proposal (follow-up per G73)', () => {
  test('with one person publishing, a refused decision is 409 ROUTE_PACK_NOT_PUBLISHED with the proposal kept; the same command id publishes once', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    web.beforeDecide = async () => {
      throw new DomainError('Forced refusal of the decision', 409);
    };
    const refused = await publish(change);
    expect(web.beforeDecide).toBeNull();
    expect(refused.status).toBe(409);
    expect(await asJson(refused)).toMatchObject({
      code: 'ROUTE_PACK_NOT_PUBLISHED',
      error: `Forced refusal of the decision ${routePackWords.notPublished}`,
    });
    expect(await proposalsOf(routeId)).toHaveLength(1);
    expect(await packsOf(routeId)).toHaveLength(1);
    const finished = await publish(change);
    expect(finished.status).toBe(201);
    expect(await asJson(finished)).toMatchObject({ version: 2, duplicate: false });
    expect(await packsOf(routeId)).toHaveLength(2);
    expect(await proposalsOf(routeId)).toHaveLength(1);
    expect(await decisionsOf(routeId)).toHaveLength(1);
  });

  test('a stale authenticator check between the proposal and the decision stays 401 STEP_UP_REQUIRED; after a fresh one the same body publishes once', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    web.beforeDecide = expired;
    const refused = await publish(change);
    expect(web.beforeDecide).toBeNull();
    expect(refused.status).toBe(401);
    expect(await asJson(refused)).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(await packsOf(routeId)).toHaveLength(1);
    await fresh();
    const finished = await publish(change);
    expect(finished.status).toBe(201);
    expect(await asJson(finished)).toMatchObject({ version: 2, duplicate: false });
    expect(await packsOf(routeId)).toHaveLength(2);
    expect(await proposalsOf(routeId)).toHaveLength(1);
  });
});

describe('route-pack-publish, the sourcing block', () => {
  test('Remove sourcing profile drops the block and names it; on a pack without one it is 409 ROUTE_PACK_NO_CHANGE', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING', {
      ...filledConfiguration(),
      sourcing: bdCnSourcingProfile,
    });
    const remove = settings(routeId, 2, { removeSourcingProfile: true });
    const previewed = (await (await preview(remove)).json()) as PackPreview;
    expect(previewed.changedKeys).toEqual(['sourcing']);
    expect((await publish(remove)).status).toBe(201);
    const [first, second] = await packsOf(routeId);
    expect(second!.configuration).not.toHaveProperty('sourcing');
    expect(second!.configuration).toEqual({ ...first!.configuration, sourcing: undefined });
    const before = await counts();
    for (const ask of [preview, publish]) {
      const again = await ask(settings(routeId, 3, { removeSourcingProfile: true }));
      expect(again.status).toBe(409);
      expect(await asJson(again)).toMatchObject({
        code: 'ROUTE_PACK_NO_CHANGE',
        error: noChangeWords,
      });
    }
    expect(await counts()).toEqual(before);
  });
});

describe('route-pack-publish, nothing to change', () => {
  test('settings equal to the current pack and the same status are 409 ROUTE_PACK_NO_CHANGE, preview and publish, with nothing written', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const before = await counts();
    for (const change of [
      settings(routeId, 2, {}),
      settings(routeId, 2, { languages: ['en'], manualChannel: false }),
      statusChange(routeId, 2, 'TESTING'),
    ])
      for (const ask of [preview, publish]) {
        const refused = await ask(change);
        expect(refused.status).toBe(409);
        expect(await asJson(refused)).toMatchObject({
          code: 'ROUTE_PACK_NO_CHANGE',
          error: noChangeWords,
        });
      }
    expect(await counts()).toEqual(before);
    expect((await publish(statusChange(routeId, 2, 'LIMITED'))).status).toBe(201);
  });
});

describe('route-pack-publish, a proposal under a pack that changed', () => {
  test('a proposal saved before the one-person install, then a newer pack: the same body is 409 ROUTE_PACK_PACK_CHANGED for preview and publish, nothing written; a new id publishes', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    await beforeTwoA(async () => {
      expect((await publish(change)).status).toBe(409);
    });
    expect(await proposalsOf(routeId)).toHaveLength(1);
    await appendPack(routeId, 2, 'TESTING');
    const before = await counts();
    for (const ask of [preview, publish]) {
      const refused = await ask(change);
      expect(refused.status).toBe(409);
      expect(await asJson(refused)).toMatchObject({
        code: 'ROUTE_PACK_PACK_CHANGED',
        error: routePackWords.packChanged,
      });
    }
    expect(await counts()).toEqual(before);
    expect((await publish({ ...change, commandId: randomUUID(), version: 3 })).status).toBe(201);
  });

  test('a pack published between the checks and the decision is 409 ROUTE_PACK_PACK_CHANGED, the proposal kept and no pack of its own; a new id publishes', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    web.beforeDecide = () => appendPack(routeId, 2, 'TESTING');
    const refused = await publish(change);
    expect(web.beforeDecide).toBeNull();
    expect(refused.status).toBe(409);
    expect(await asJson(refused)).toMatchObject({
      code: 'ROUTE_PACK_PACK_CHANGED',
      error: routePackWords.packChanged,
    });
    expect(await proposalsOf(routeId)).toHaveLength(1);
    expect(await decisionsOf(routeId)).toEqual([]);
    // The only pack added is the one published in between.
    const packs = await packsOf(routeId);
    expect(packs.map((pack) => pack.version)).toEqual([1, 2]);
    expect(packs[1]!.configuration.languages).toEqual(['en']);
    expect((await publish({ ...change, commandId: randomUUID(), version: 3 })).status).toBe(201);
  });
});

describe('route-pack-publish, one command id, one request', () => {
  test('an unpublished proposal is judged against the pack it stands on: the same id with a list left out, Remove sourcing profile or as a status change is 409 COMMAND_REUSED', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING', {
      ...filledConfiguration(),
      sourcing: bdCnSourcingProfile,
    });
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    await beforeTwoA(async () => {
      expect((await publish(change)).status).toBe(409);
      const before = await counts();
      for (const other of [
        { ...change, languages: undefined },
        { ...change, removeSourcingProfile: true },
        { ...change, languages: undefined, kind: 'status', status: 'TESTING' },
      ])
        for (const ask of [preview, publish]) {
          const refused = await ask(other);
          expect(refused.status).toBe(409);
          expect(await asJson(refused)).toMatchObject({ code: 'ROUTE_PACK_COMMAND_REUSED' });
        }
      expect(await counts()).toEqual(before);
    });
    // The exact body finishes the publish.
    expect((await publish(change)).status).toBe(201);
    expect(await packsOf(routeId)).toHaveLength(2);
  });

  test('a published proposal: the same id sent as the other kind, or to another status, is 409 COMMAND_REUSED; the exact body stays the duplicate', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const settled = settings(routeId, 2, { languages: ['en', 'fr'] });
    expect((await publish(settled)).status).toBe(201);
    const moved = statusChange(routeId, 3, 'LIMITED');
    expect((await publish(moved)).status).toBe(201);
    const before = await counts();
    for (const other of [
      { ...settled, languages: undefined, kind: 'status', status: 'TESTING' },
      { ...settled, languages: undefined, kind: 'status', status: 'LIMITED' },
      { ...moved, status: undefined, kind: 'settings' },
      { ...moved, status: undefined, kind: 'settings', languages: ['en', 'fr'] },
      { ...moved, status: 'ACTIVE' },
    ])
      for (const ask of [preview, publish]) {
        const refused = await ask(other);
        expect(refused.status).toBe(409);
        expect(await asJson(refused)).toMatchObject({ code: 'ROUTE_PACK_COMMAND_REUSED' });
      }
    expect(await counts()).toEqual(before);
    for (const exact of [settled, moved]) {
      const replay = await publish(exact);
      expect(replay.status).toBe(200);
      expect(await asJson(replay)).toMatchObject({ duplicate: true });
    }
    // Follow-up per G73 (F2): the replay is rebuilt on the pack it was proposed on, so the same id with its list left out no
    // longer rebuilds to the published pack and is refused, with nothing written.
    for (const ask of [preview, publish]) {
      const refused = await ask({ ...settled, languages: undefined });
      expect(refused.status).toBe(409);
      expect(await asJson(refused)).toMatchObject({ code: 'ROUTE_PACK_COMMAND_REUSED' });
    }
    expect(await counts()).toEqual(before);
  });
});

describe('route-pack-publish, a replay rebuilt on its base pack (follow-up per G73)', () => {
  test('after publish, the same id with a list left out is 409 COMMAND_REUSED for the preview and the publish, nothing written; the exact body is the duplicate and a new id publishes', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const settled = settings(routeId, 2, { languages: ['en', 'fr'] });
    expect((await publish(settled)).status).toBe(201);
    const before = await counts();
    for (const ask of [preview, publish]) {
      const refused = await ask({ ...settled, languages: undefined });
      expect(refused.status).toBe(409);
      expect(await asJson(refused)).toMatchObject({
        code: 'ROUTE_PACK_COMMAND_REUSED',
        error: routePackWords.commandReused,
      });
    }
    expect(await counts()).toEqual(before);
    const replay = await publish(settled);
    expect(replay.status).toBe(200);
    expect(await asJson(replay)).toMatchObject({ version: 2, duplicate: true });
    expect(await counts()).toEqual(before);
    // Recovery: the next change under a new command id publishes the next version.
    const next = await publish({
      ...settled,
      commandId: randomUUID(),
      version: 3,
      languages: ['en', 'fr', 'de'],
    });
    expect(next.status).toBe(201);
    expect(await asJson(next)).toMatchObject({ version: 3, duplicate: false });
  });

  test('after Remove sourcing profile is published, the same id without it is 409 COMMAND_REUSED; on a base without a block the same pack stays the duplicate', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING', {
      ...filledConfiguration(),
      sourcing: bdCnSourcingProfile,
    });
    const remove = settings(routeId, 2, { languages: ['en', 'fr'], removeSourcingProfile: true });
    expect((await publish(remove)).status).toBe(201);
    const before = await counts();
    for (const ask of [preview, publish]) {
      const refused = await ask({ ...remove, removeSourcingProfile: false });
      expect(refused.status).toBe(409);
      expect(await asJson(refused)).toMatchObject({ code: 'ROUTE_PACK_COMMAND_REUSED' });
    }
    expect(await counts()).toEqual(before);
    expect((await publish(remove)).status).toBe(200);
    // A base with no sourcing block rebuilds to the very pack published: nothing differs, so it is the duplicate it is.
    const bare = await newRoute();
    await appendPack(bare, 1, 'TESTING');
    const plain = settings(bare, 2, { languages: ['en', 'fr'] });
    expect((await publish(plain)).status).toBe(201);
    const same = await publish({ ...plain, removeSourcingProfile: true });
    expect(same.status).toBe(200);
    expect(await asJson(same)).toMatchObject({ version: 2, duplicate: true });
    // A status change replayed after publish still reads its base status and stays the duplicate.
    const move = statusChange(bare, 3, 'LIMITED');
    expect((await publish(move)).status).toBe(201);
    expect(await asJson(await publish(move))).toMatchObject({ version: 3, duplicate: true });
    expect(await packsOf(bare)).toHaveLength(3);
  });
});

describe('route-pack-publish, the size of the proposal', () => {
  test('a change too large to review is 400 ROUTE_PACK_TOO_LARGE in plain words for the preview and the publish, with nothing written', async () => {
    const routeId = await newRoute();
    const long = (prefix: string, count = 50) =>
      Array.from({ length: count }, (_, i) => `${prefix}${'x'.repeat(74)}_${i}`);
    const change = settings(routeId, 1, {
      missionTypes: ['sourcing'],
      localities: long('l'),
      clusters: long('c'),
      coverage: long('v'),
    });
    const body = Buffer.byteLength(JSON.stringify({ mode: 'preview', change }));
    expect(body).toBeGreaterThan(12000);
    expect(body).toBeLessThan(16384);
    const before = await counts();
    for (const ask of [preview, publish]) {
      const refused = await ask(change);
      expect(refused.status).toBe(400);
      expect(await asJson(refused)).toMatchObject({
        code: 'ROUTE_PACK_TOO_LARGE',
        error: routePackWords.proposalTooLarge,
      });
    }
    expect(web.operationsCalls).toEqual([]);
    expect(await counts()).toEqual(before);
    // Shorter lists fit.
    const shorter = { ...change, clusters: long('c', 5), coverage: long('v', 5) };
    expect((await preview(shorter)).status).toBe(200);
    expect((await publish(shorter)).status).toBe(201);
  });
});

describe('route-pack-publish, a preview under a proposal', () => {
  test('after a publish, the preview of the same change answers the duplicate: its own version, the one before, no changed keys, nothing written', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    expect((await publish(change)).status).toBe(201);
    // A newer version published since does not change the answer.
    expect((await publish(settings(routeId, 3, { currencies: ['USD'] }))).status).toBe(201);
    const before = await counts();
    const previewed = await preview(change);
    expect(previewed.status).toBe(200);
    expect(await asJson(previewed)).toEqual({
      kind: 'settings',
      statusFrom: 'TESTING',
      statusTo: 'TESTING',
      changedKeys: [],
      baseVersion: 1,
      newVersion: 2,
      duplicate: true,
      historicalAssignmentsPreserved: 0,
      warnings: [],
      blocked: null,
      onePersonPublication: true,
      removedPolicies: [],
    });
    expect(await counts()).toEqual(before);
    // The first pack of a route has no version before it.
    const other = await newRoute();
    const first = settings(other, 1, { missionTypes: ['sourcing'] });
    expect((await publish(first)).status).toBe(201);
    expect(await asJson(await preview(first))).toMatchObject({
      duplicate: true,
      statusFrom: null,
      statusTo: 'DRAFT',
      baseVersion: null,
      newVersion: 1,
      changedKeys: [],
    });
  });

  test('a proposal saved but not published, on the pack in force: the preview is not a duplicate and names the proposal version', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    await beforeTwoA(async () => {
      expect((await publish(change)).status).toBe(409);
      const before = await counts();
      const previewed = await preview(change);
      expect(previewed.status).toBe(200);
      expect(await asJson(previewed)).toMatchObject({
        duplicate: false,
        newVersion: 2,
        baseVersion: 1,
        changedKeys: ['languages'],
        onePersonPublication: false,
      });
      expect(await counts()).toEqual(before);
    });
  });
});

describe('route-pack-publish, an expired policy', () => {
  test('a Paused route drops an expired policy and names it; any other status is 409 ROUTE_PACK_POLICY_EXPIRED; a move to Paused drops it', async () => {
    const paused = await newRoute();
    const draft = await newRoute();
    const policy = await f.communications.command(
      owner(),
      command('policy', {
        jurisdiction: 'DE',
        channel: 'SYNTHETIC',
        contactPurpose: 'institutional_introduction',
        basis: 'Invented policy that expires during the route pack editor publish test',
        validUntil: new Date(Date.now() + 1500).toISOString(),
        enabled: true,
      }),
    );
    const withPolicy = { ...filledConfiguration(), jurisdictionPolicyRefs: [policy.id] };
    await appendPack(paused, 1, 'PAUSED', withPolicy);
    await appendPack(draft, 1, 'DRAFT', withPolicy);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const label = /^communication policy DE SYNTHETIC institutional_introduction version \d+$/;
    // Settings on a Paused route: the expired reference goes, by name.
    const change = settings(paused, 2, { languages: ['en', 'fr'] });
    const previewed = (await (await preview(change)).json()) as PackPreview;
    expect(previewed.changedKeys).toEqual(
      expect.arrayContaining(['languages', 'jurisdictionPolicyRefs']),
    );
    expect(previewed.removedPolicies).toEqual([expect.stringMatching(label)]);
    const published = await publish(change);
    expect(published.status).toBe(201);
    expect(((await published.json()) as PackPublished).removedPolicies).toEqual([
      expect.stringMatching(label),
    ]);
    expect((await packsOf(paused))[1]!.configuration.jurisdictionPolicyRefs).toEqual([]);
    // Any other status keeps the obligation, so it is refused and nothing is written.
    const before = await counts();
    for (const ask of [preview, publish]) {
      const refused = await ask(statusChange(draft, 2, 'TESTING'));
      expect(refused.status).toBe(409);
      expect(await asJson(refused)).toMatchObject({ code: 'ROUTE_PACK_POLICY_EXPIRED' });
    }
    expect(await counts()).toEqual(before);
    // A move to Paused drops it and names it.
    const move = await publish(statusChange(draft, 2, 'PAUSED'));
    expect(move.status).toBe(201);
    expect(((await move.json()) as PackPublished).removedPolicies).toEqual([
      expect.stringMatching(label),
    ]);
    expect((await packsOf(draft))[1]!.configuration.jurisdictionPolicyRefs).toEqual([]);
  });

  test('a policy named only by its id is left out of the preview and the publish answers', () => {
    const name = 'communication policy DE SYNTHETIC institutional_introduction version 1';
    const id = randomUUID();
    expect(
      packPublishedAnswer({
        version: 2,
        duplicate: false,
        warnings: [],
        removedPolicies: [name, id],
      }).removedPolicies,
    ).toEqual([name]);
    expect(
      packPreviewAnswer({
        kind: 'settings',
        statusFrom: 'PAUSED',
        statusTo: 'PAUSED',
        changedKeys: ['jurisdictionPolicyRefs'],
        baseVersion: 1,
        newVersion: 2,
        duplicate: false,
        historicalAssignmentsPreserved: 0,
        warnings: [],
        blocked: null,
        onePersonPublication: true,
        removedPolicies: [id, name],
      }).removedPolicies,
    ).toEqual([name]);
  });
});

describe('route-pack-publish, what an answer holds', () => {
  test('no answer holds an id, the reason or an actor, and every answer carries the private headers', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING', {
      ...filledConfiguration(),
      sourcing: bdCnSourcingProfile,
    });
    const change = settings(routeId, 2, { languages: ['en', 'fr'] });
    const move = statusChange(routeId, 3, 'ACTIVE');
    const answers = [
      await preview(change),
      await publish(change),
      await publish(change),
      await preview(move),
      await publish(move),
      await publish({ ...move, reason: 'Synthetic other reason' }),
      await publish(settings(routeId, 3, { languages: [] })),
      await preview(settings(routeId, 4, {})),
    ];
    expect(answers.map((answer) => answer.status)).toEqual([
      200, 201, 200, 200, 201, 409, 409, 409,
    ]);
    const packIds = (await packsOf(routeId)).map((pack) => pack.id);
    const proposalIds = (await proposalsOf(routeId)).map((proposal) => proposal.id);
    for (const answer of answers) {
      expect(answer.headers.get('cache-control')).toBe('no-store');
      expect(answer.headers.get('referrer-policy')).toBe('no-referrer');
      expect(answer.headers.get('x-corridra-request-id')).toMatch(uuid);
      const body = await asJson(answer);
      // An error carries the request id, which is the one id an answer may hold.
      if (answer.status >= 400)
        expect(body.correlationId).toBe(answer.headers.get('x-corridra-request-id'));
      delete body.correlationId;
      const text = JSON.stringify(body);
      expect(text).not.toMatch(uuid);
      for (const word of [
        reason,
        f.users.owner.id,
        routeId,
        change.commandId,
        ...packIds,
        ...proposalIds,
        'createdBy',
        'packId',
        'routeId',
        'proposalId',
      ])
        expect(text).not.toContain(word);
    }
  });
});
