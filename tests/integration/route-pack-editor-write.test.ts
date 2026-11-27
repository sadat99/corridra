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
  routePackContentOctetBudget,
  routePackSections,
  routePackWords,
  standardFieldsV1,
  type ContentDocument,
  type ContentFact,
  type PackStatus,
} from '../../packages/domain/src/route-pack-standard';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { OperationsService } from '../../packages/missions/src/operations';
import { RoutePackContentService } from '../../packages/missions/src/route-pack-content';
import { RoutePackSheetService } from '../../packages/missions/src/route-pack-sheet';
import type { FactsSaved } from '../../apps/web/lib/route-pack-editor-write';
import type { OverviewRoute } from '../../apps/web/lib/route-pack-editor-read';

// ADR-093 Phase 3, PR 2a: the one write behind the route pack editor, the team-control action route-pack-facts. The real
// handler, services and an isolated PostgreSQL with the route pack module installed; only the session provider, the switch
// reader and (for the module absent case) the marker answer are replaced. Red on the code before PR 2a: the action did not
// exist and answered 404 to every request below that expects a save or a refusal of its own.
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
// Counts every call into the content service and can fail the next one: a refused request must never reach it, and a failed
// save must recover on the same request.
const watched = () =>
  new Proxy(content, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        web.contentCalls++;
        if (web.failOnce) {
          web.failOnce = false;
          throw new Error('Synthetic save failure');
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
    // The authenticator reset is only reached to show that its 4096 octet cap is unchanged.
    access: { team: () => ({ resetAuthenticator: async () => ({}) }) },
  }),
}));
vi.mock('../../apps/web/lib/ux-switches', () => ({ uxSwitchOn: () => web.switchOn }));
vi.mock('../../apps/web/lib/notify', () => ({ notify: vi.fn() }));
import { GET, POST } from '../../apps/web/app/api/team-control/[action]/route';

const reason = 'Synthetic route pack editor write test';
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const owner = () => f.users.owner.ctx;
const origin = 'http://localhost:3300';
const base = `${origin}/api/team-control`;
const draftConfiguration = (): RouteConfiguration => initialRouteConfiguration(initialRoutes[2]);
let pairs = 0;
async function newRoute() {
  const id = randomUUID();
  const [from, to] = [countryCodes[2 * pairs]!, countryCodes[2 * pairs + 1]!];
  pairs++;
  await corridors.createRoute(owner(), { id, origin: from, destination: to, reason });
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
const optionalTextField = standardFieldsV1.find(
  (field) => field.part === 'Content' && !field.core && field.type === 'text',
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
const document = (facts: ContentFact[] = [], sectionMarks: ContentDocument['sectionMarks'] = []) =>
  ({ standardVersion: 1, sectionMarks, facts }) as ContentDocument;
const customFact = (key: string, extra: Partial<ContentFact> = {}) =>
  fact(key, { label: 'Dock rules', section: 9, type: 'text', ...extra });

type Item = { id: string; routeId: string; version: number; document: unknown; reason: string };
const item = (routeId: string, version: number, doc: unknown = document([fact('notes.general')])) =>
  ({ id: randomUUID(), routeId, version, document: doc, reason }) as Item;
type Options = {
  action?: string;
  method?: string;
  origin?: string | null;
  tenant?: string;
  headers?: Record<string, string>;
};
const url = (action: string, tenant: string) => `${base}/${action}?tenant=${tenant}`;
const send = (body: BodyInit | null, options: Options = {}) => {
  const action = options.action ?? 'route-pack-facts';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers,
  };
  if (options.origin !== null) headers.origin = options.origin ?? origin;
  return POST(
    new Request(url(action, options.tenant ?? f.tenantA), {
      method: options.method ?? 'POST',
      headers,
      body,
    }),
    { params: Promise.resolve({ action }) },
  );
};
const save = (value: unknown, options: Options = {}) => send(JSON.stringify(value), options);
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
  const action = options.action ?? 'route-pack-facts';
  const response = POST(
    new Request(url(action, options.tenant ?? f.tenantA), {
      method: options.method ?? 'POST',
      headers: { origin, 'content-type': 'application/json', ...options.headers },
      body: stream,
      duplex: 'half',
    } as RequestInit),
    { params: Promise.resolve({ action }) },
  );
  return { state, response };
}
// The answer of an unknown action, which the gate must match byte for byte (but for the request id).
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
const rows = async (routeId: string) =>
  Number(
    (
      await f.owner.query('SELECT count(*) FROM app.route_pack_content WHERE route_id=$1', [
        routeId,
      ])
    ).rows[0].count,
  );
const counts = async (routeId: string) => ({
  packs: Number(
    (
      await f.owner.query('SELECT count(*) FROM app.corridor_pack_version WHERE route_id=$1', [
        routeId,
      ])
    ).rows[0].count,
  ),
  readiness: Number(
    (await f.owner.query('SELECT count(*) FROM app.route_readiness WHERE route_id=$1', [routeId]))
      .rows[0].count,
  ),
});
const viewOf = async (routeId: string) =>
  (await content.overview(owner(), { routeIds: [routeId] })).routes[0]!;
const expired = () =>
  f.owner.query("UPDATE identity.assurance SET verified_at=now()-interval '10 minutes'");
const fresh = () => f.owner.query('UPDATE identity.assurance SET verified_at=now()');
const asJson = async (response: Response) => (await response.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.CORRIDRA_ROUTE_PACK_FORM = 'true';
  f = await commercialFixture();
  await migrateCustomerRealUse(f.owner);
  await migrateSourcingWorkflow(f.owner);
  await configureSourcingWorkflow(f.owner, {
    enabled: true,
    reason: 'Synthetic sourcing control open for the route pack editor write test',
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
  web.failOnce = false;
  web.contentCalls = 0;
  web.markerCalls = 0;
  await fresh();
});

describe('route-pack-facts, a save', () => {
  test('the owner saves the first version: 201 with version, duplicate and warnings only, nothing else changes', async () => {
    const routeId = await newRoute();
    const before = await counts(routeId);
    const body = item(routeId, 1);
    const response = await save(body);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-corridra-request-id')).toBeTruthy();
    const answer = (await response.json()) as FactsSaved;
    expect(answer).toEqual({ version: 1, duplicate: false, warnings: [] });
    // No id of any kind, no reason and no actor in the answer.
    const text = JSON.stringify(answer);
    const packId = (await viewOf(routeId)).pack?.id;
    for (const word of [
      f.users.owner.id,
      routeId,
      body.id,
      reason,
      'createdBy',
      'packId',
      'routeId',
      ...(packId ? [packId] : []),
    ])
      expect(text).not.toContain(word);
    expect(Object.keys(answer).sort()).toEqual(['duplicate', 'version', 'warnings']);
    // The record exists, is owned by the owner, and the only event carries its id and version.
    const saved = (
      await f.owner.query(
        'SELECT version,reason,created_by,pack_id FROM app.route_pack_content WHERE id=$1',
        [body.id],
      )
    ).rows;
    expect(saved).toEqual([{ version: 1, reason, created_by: f.users.owner.id, pack_id: null }]);
    const events = (
      await f.owner.query('SELECT payload FROM app.domain_event WHERE aggregate_id=$1', [body.id])
    ).rows;
    expect(events).toEqual([{ payload: { id: body.id, version: 1, revoked: false } }]);
    // Saving facts never writes a pack or a readiness row.
    expect(await counts(routeId)).toEqual(before);
  });

  test('a route with a pack saves facts and its pack version and readiness stay exactly as they were', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING');
    const before = { counts: await counts(routeId), pack: (await viewOf(routeId)).pack };
    const first = item(routeId, 1);
    expect((await save(first)).status).toBe(201);
    expect(
      (await save(item(routeId, 2, document([fact('notes.general', { value: 'Changed' })]))))
        .status,
    ).toBe(201);
    expect(await counts(routeId)).toEqual(before.counts);
    const after = await viewOf(routeId);
    expect(after.pack).toEqual(before.pack);
    expect(after.content?.version).toBe(2);
    // The saved row names the pack in force.
    const row = (
      await f.owner.query('SELECT pack_id FROM app.route_pack_content WHERE id=$1', [first.id])
    ).rows[0];
    expect(row.pack_id).toBe(before.pack?.id);
  });

  test('warn only: a save that turns a Filled Core fact Pending on a live route is saved with a warning, a save that does not has none', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'ACTIVE');
    const core = fact(coreContentField.key);
    const first = await save(item(routeId, 1, document([core])));
    expect(first.status).toBe(201);
    // Changing an optional field leaves Core as it was: no warning.
    const quiet = await save(item(routeId, 2, document([core, fact(optionalTextField.key)])));
    expect(await asJson(quiet)).toEqual({ version: 2, duplicate: false, warnings: [] });
    // Dropping the Core fact turns it Pending on a live route: saved, with the warning and its key.
    const dropped = item(routeId, 3, document([fact(optionalTextField.key)]));
    const warned = await save(dropped);
    expect(warned.status).toBe(201);
    expect(await asJson(warned)).toEqual({
      version: 3,
      duplicate: false,
      warnings: [{ code: 'ROUTE_PACK_CORE_TURNS_PENDING', keys: [coreContentField.key] }],
    });
    expect(await rows(routeId)).toBe(3);
  });
});

describe('route-pack-facts, denial', () => {
  test('signed out is 401 with no row, and the same request succeeds once signed in', async () => {
    const routeId = await newRoute();
    const body = item(routeId, 1);
    web.actor = null;
    expect((await save(body)).status).toBe(401);
    expect(await rows(routeId)).toBe(0);
    expect(web.contentCalls).toBe(0);
    web.actor = 'owner';
    expect((await save(body)).status).toBe(201);
    expect(await rows(routeId)).toBe(1);
  });

  test('an admin and a viewer are refused with 403 and no row; the owner then saves', async () => {
    const routeId = await newRoute();
    const body = item(routeId, 1);
    for (const actor of ['reviewer', 'viewer']) {
      web.actor = actor;
      const refused = await save(body);
      expect(refused.status).toBe(403);
      expect(JSON.stringify(await refused.json())).not.toContain(routeId);
      expect(await rows(routeId)).toBe(0);
    }
    web.actor = 'owner';
    expect((await save(body)).status).toBe(201);
  });

  test('a member of another workspace posting to this workspace gets 403, no row and no data', async () => {
    const routeId = await newRoute();
    const body = item(routeId, 1);
    web.actor = 'other';
    const refused = await save(body);
    expect(refused.status).toBe(403);
    const text = JSON.stringify(await refused.json());
    expect(text).not.toContain(routeId);
    expect(text).not.toContain('notes.general');
    expect(await rows(routeId)).toBe(0);
    web.actor = 'owner';
    expect((await save(body)).status).toBe(201);
  });

  test('a wrong or missing origin is refused before anything is read, and the right origin saves', async () => {
    const routeId = await newRoute();
    const body = item(routeId, 1);
    const wrong = await save(body, { origin: 'https://elsewhere.example' });
    const missing = await save(body, { origin: null });
    for (const refused of [wrong, missing]) expect(refused.status).toBeGreaterThanOrEqual(400);
    expect([wrong.status, missing.status]).not.toContain(404);
    expect(await rows(routeId)).toBe(0);
    expect(web.contentCalls).toBe(0);
    expect((await save(body)).status).toBe(201);
  });
});

describe('route-pack-facts, the fresh authenticator', () => {
  test('a stale authenticator check is 401 STEP_UP_REQUIRED with nothing written; after a fresh one the same id saves', async () => {
    const routeId = await newRoute();
    const body = item(routeId, 1);
    await expired();
    const refused = await save(body);
    expect(refused.status).toBe(401);
    expect(await asJson(refused)).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(await rows(routeId)).toBe(0);
    await fresh();
    const again = await save(body);
    expect(again.status).toBe(201);
    expect(await asJson(again)).toEqual({ version: 1, duplicate: false, warnings: [] });
    expect(await rows(routeId)).toBe(1);
  });

  test('a stale authenticator check is refused for a replay too: no answer about a save without it', async () => {
    const routeId = await newRoute();
    const body = item(routeId, 1);
    expect((await save(body)).status).toBe(201);
    await expired();
    const replay = await save(body);
    expect(replay.status).toBe(401);
    expect(await asJson(replay)).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await fresh();
    expect((await save(body)).status).toBe(200);
    expect(await rows(routeId)).toBe(1);
  });
});

describe('route-pack-facts, the gate', () => {
  test('switch off: the answer of an unknown action, before any body is read, with no marker query and no service call', async () => {
    web.switchOn = false;
    const unknown = await shape(await unknownAction());
    expect(unknown).toMatchObject({ status: 404, body: { error: 'Not found' } });
    const routeId = await newRoute();
    // A malformed body, an oversized body and a valid body all answer the same, and a body that never ends is never pulled.
    expect(await shape(await send('{not json'))).toEqual(unknown);
    expect(await shape(await send('x'.repeat(200000)))).toEqual(unknown);
    expect(await shape(await save(item(routeId, 1)))).toEqual(unknown);
    const endlessBody = endless();
    expect(await shape(await endlessBody.response)).toEqual(unknown);
    expect(endlessBody.state.pulled).toBe(0);
    expect(web.markerCalls).toBe(0);
    expect(web.contentCalls).toBe(0);
    expect(await rows(routeId)).toBe(0);
    // Recovery: switched on again, the same request saves.
    web.switchOn = true;
    expect((await save(item(routeId, 1))).status).toBe(201);
  });

  test('marker absent: the same answer, no body is read and no service call is made; installed again, it saves', async () => {
    web.installed = false;
    const unknown = await shape(await unknownAction());
    const routeId = await newRoute();
    expect(await shape(await send('{not json'))).toEqual(unknown);
    expect(await shape(await save(item(routeId, 1)))).toEqual(unknown);
    const endlessBody = endless();
    expect(await shape(await endlessBody.response)).toEqual(unknown);
    expect(endlessBody.state.pulled).toBe(0);
    expect(web.contentCalls).toBe(0);
    expect(await rows(routeId)).toBe(0);
    web.installed = true;
    expect((await save(item(routeId, 1))).status).toBe(201);
  });

  test('GET and PUT answer 404 like an unknown action, with a valid body, no body read and no service call', async () => {
    const unknown = await shape(await unknownAction());
    const routeId = await newRoute();
    const read = await GET(new Request(url('route-pack-facts', f.tenantA)), {
      params: Promise.resolve({ action: 'route-pack-facts' }),
    });
    expect(await shape(read)).toEqual(unknown);
    const put = await save(item(routeId, 1), { method: 'PUT' });
    expect(await shape(put)).toEqual(unknown);
    const endlessPut = endless({ method: 'PUT' });
    expect(await shape(await endlessPut.response)).toEqual(unknown);
    expect(endlessPut.state.pulled).toBe(0);
    expect(web.contentCalls).toBe(0);
    expect(await rows(routeId)).toBe(0);
    // The method POST on the same request saves, so the 404 was the method.
    expect((await save(item(routeId, 1))).status).toBe(201);
  });
});

describe('route-pack-facts, a save that lost a race', () => {
  test('a stale version is 409 ROUTE_PACK_CONTENT_CHANGED with the domain words and nothing written; the next version saves', async () => {
    const routeId = await newRoute();
    expect((await save(item(routeId, 1))).status).toBe(201);
    const stale = item(routeId, 1, document([fact('notes.general', { value: 'Mine' })]));
    const refused = await save(stale);
    expect(refused.status).toBe(409);
    expect(await asJson(refused)).toMatchObject({
      code: 'ROUTE_PACK_CONTENT_CHANGED',
      error: routePackWords.contentChanged,
    });
    expect(await rows(routeId)).toBe(1);
    // Recovery: read the version again and send the next one.
    const next = (await viewOf(routeId)).content!.version + 1;
    const merged = await save({ ...stale, id: randomUUID(), version: next });
    expect(merged.status).toBe(201);
    expect(await asJson(merged)).toMatchObject({ version: 2 });
    expect(await rows(routeId)).toBe(2);
  });

  test('a version that skips ahead is 409 as well', async () => {
    const routeId = await newRoute();
    const refused = await save(item(routeId, 3));
    expect(refused.status).toBe(409);
    expect(await asJson(refused)).toMatchObject({ code: 'ROUTE_PACK_CONTENT_CHANGED' });
    expect(await rows(routeId)).toBe(0);
  });

  test('a custom key that means something else on another route is 409 ROUTE_PACK_CUSTOM_KEY_CONFLICT; a new key saves', async () => {
    const first = await newRoute();
    const second = await newRoute();
    expect((await save(item(first, 1, document([customFact('custom.dock_rules')])))).status).toBe(
      201,
    );
    const other = item(
      second,
      1,
      document([customFact('custom.dock_rules', { type: 'list', value: ['One'] })]),
    );
    const refused = await save(other);
    expect(refused.status).toBe(409);
    expect(await asJson(refused)).toMatchObject({
      code: 'ROUTE_PACK_CUSTOM_KEY_CONFLICT',
      error: routePackWords.customKeyConflict('custom.dock_rules'),
    });
    expect(await rows(second)).toBe(0);
    // The words name the key and no route.
    expect(JSON.stringify(await asJson(await save(other)))).not.toContain(first);
    const renamed = item(
      second,
      1,
      document([customFact('custom.dock_rules_list', { type: 'list', value: ['One'] })]),
    );
    expect((await save(renamed)).status).toBe(201);
    // The same meaning on a second route is not a conflict.
    const third = await newRoute();
    expect((await save(item(third, 1, document([customFact('custom.dock_rules')])))).status).toBe(
      201,
    );
  });
});

describe('route-pack-facts, one command, one record', () => {
  test('an exact replay is 200 duplicate true with no warnings and no new row; other uses of the id are 409', async () => {
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'ACTIVE');
    // A save that warns: its replay does not repeat the warning.
    const core = fact(coreContentField.key);
    expect((await save(item(routeId, 1, document([core])))).status).toBe(201);
    const body = item(routeId, 2, document([fact(optionalTextField.key)]));
    const first = await save(body);
    expect(first.status).toBe(201);
    expect((await asJson(first)).warnings).toHaveLength(1);
    const replay = await save(body);
    expect(replay.status).toBe(200);
    expect(await asJson(replay)).toEqual({ version: 2, duplicate: true, warnings: [] });
    expect(await rows(routeId)).toBe(2);
    // The same id with another document, or another reason, is refused and nothing changes.
    const otherDocument = await save({ ...body, document: document([fact('notes.general')]) });
    expect(otherDocument.status).toBe(409);
    expect(await asJson(otherDocument)).toMatchObject({ code: 'ROUTE_PACK_COMMAND_REUSED' });
    const otherReason = await save({ ...body, reason: 'Synthetic other reason' });
    expect(otherReason.status).toBe(409);
    expect(await asJson(otherReason)).toMatchObject({ code: 'ROUTE_PACK_COMMAND_REUSED' });
    expect(await rows(routeId)).toBe(2);
    // The id belongs to another route's record too.
    const elsewhere = await newRoute();
    const stolen = await save({ ...body, routeId: elsewhere, version: 1 });
    expect(stolen.status).toBe(409);
    expect(await rows(elsewhere)).toBe(0);
    // Recovery: a new id with the same document and reason is the next version.
    const next = await save({ ...body, id: randomUUID(), version: 3 });
    expect(next.status).toBe(201);
  });

  test('the same save retried after a failure on the server writes one record', async () => {
    const routeId = await newRoute();
    const body = item(routeId, 1);
    web.failOnce = true;
    const failed = await save(body);
    expect(failed.status).toBe(500);
    const text = JSON.stringify(await failed.json());
    expect(text).not.toContain('Synthetic save failure');
    expect(text).not.toContain(routeId);
    expect(await rows(routeId)).toBe(0);
    expect((await save(body)).status).toBe(201);
    expect((await save(body)).status).toBe(200);
    expect(await rows(routeId)).toBe(1);
  });
});

describe('route-pack-facts, the size of the body', () => {
  test('one octet over the cap is 413 before anything is parsed; the cap itself reaches the parser; no service call, no row', async () => {
    const cap = routePackContentOctetBudget + 8192;
    expect(cap).toBe(139264);
    const routeId = await newRoute();
    const padded = (octets: number) => {
      const shell = '{"pad":""}';
      return `{"pad":"${'a'.repeat(octets - shell.length)}"}`;
    };
    const over = await send(padded(cap + 1));
    expect(over.status).toBe(413);
    expect(await asJson(over)).toMatchObject({ error: 'Request is too large' });
    expect(web.contentCalls).toBe(0);
    // At the cap the body is read and judged: an extra key is a plain 400, not 413.
    const atCap = await send(padded(cap));
    expect(atCap.status).toBe(400);
    expect(web.contentCalls).toBe(0);
    // Octets, not characters: a body of 3 octet characters that is within the cap in characters but over it in octets.
    const wide = `{"pad":"${'€'.repeat(Math.ceil(cap / 3))}"}`;
    expect(wide.length).toBeLessThan(cap);
    expect((await send(wide)).status).toBe(413);
    expect(await rows(routeId)).toBe(0);
  });

  test('a body that never ends is cancelled soon after the cap, whatever Content-Length says', async () => {
    const lying = endless({ headers: { 'content-length': '20' } });
    const response = await lying.response;
    expect(response.status).toBe(413);
    expect(lying.state.cancelled).toBe(true);
    // 139264 octets is three chunks of 65536 and a little: it stops there, it does not read on.
    expect(lying.state.pulled).toBeLessThanOrEqual(4);
    expect(web.contentCalls).toBe(0);
  });

  test('a valid document much larger than 4096 octets saves, so the cap of this action is not the 4096 of the others', async () => {
    const routeId = await newRoute();
    const facts = Array.from({ length: 60 }, (_, index) =>
      customFact(`custom.bulk_${index}`, {
        section: 17,
        label: `Bulk ${index}`,
        value: 'v'.repeat(1000),
      }),
    );
    const body = item(routeId, 1, document(facts));
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(60000);
    const response = await save(body);
    expect(response.status).toBe(201);
    expect((await viewOf(routeId)).content?.document.facts).toHaveLength(60);
  });

  test('every other action keeps its 4096 cap: a 5000 octet body to the authenticator reset is still 413', async () => {
    const response = await send(`{"pad":"${'a'.repeat(5000)}"}`, { action: 'authenticator-reset' });
    expect(response.status).toBe(413);
    expect(await asJson(response)).toMatchObject({ error: 'Request is too large' });
    // Within 4096 octets the same action is not refused for size.
    expect((await send('{}', { action: 'authenticator-reset' })).status).toBe(201);
  });

  test('a body that is not UTF-8 is 400 with no row', async () => {
    const routeId = await newRoute();
    const good = JSON.stringify(item(routeId, 1));
    const bad = Buffer.concat([
      Buffer.from(good.slice(0, -1)),
      Buffer.from([0xff, 0xfe]),
      Buffer.from('}'),
    ]);
    const response = await send(bad as unknown as BodyInit);
    expect(response.status).toBe(400);
    expect(await rows(routeId)).toBe(0);
    expect((await save(JSON.parse(good))).status).toBe(201);
  });
});

describe('route-pack-facts, a body the server refuses', () => {
  test.each([
    ['an extra key', (body: Item) => ({ ...body, extra: 1 })],
    ['an id that is not a uuid', (body: Item) => ({ ...body, id: 'not-a-uuid' })],
    ['a routeId that is not a uuid', (body: Item) => ({ ...body, routeId: 'not-a-uuid' })],
    ['version 0', (body: Item) => ({ ...body, version: 0 })],
    ['a version that is not a whole number', (body: Item) => ({ ...body, version: 1.5 })],
    ['a reason of 2 characters', (body: Item) => ({ ...body, reason: 'ab' })],
    ['a reason of 501 characters', (body: Item) => ({ ...body, reason: 'a'.repeat(501) })],
    ['a missing document', (body: Item) => ({ ...body, document: undefined })],
    ['a document that is not an object', (body: Item) => ({ ...body, document: 'text' })],
  ])('%s is 400 with no row and the corrected request saves', async (_name, change) => {
    const routeId = await newRoute();
    const body = item(routeId, 1);
    const refused = await save(change(body));
    expect(refused.status).toBe(400);
    expect(await rows(routeId)).toBe(0);
    expect((await save(body)).status).toBe(201);
  });

  test('a reason of 3 and of 500 characters is accepted', async () => {
    const routeId = await newRoute();
    expect((await save({ ...item(routeId, 1), reason: 'abc' })).status).toBe(201);
    expect((await save({ ...item(routeId, 2), reason: 'a'.repeat(500) })).status).toBe(201);
  });

  test('invalid JSON is 400 with no row', async () => {
    const routeId = await newRoute();
    expect((await send('{"id":')).status).toBe(400);
    expect((await send('')).status).toBe(400);
    expect(await rows(routeId)).toBe(0);
  });

  test('a document with an email address is 400 ROUTE_PACK_INVALID in the domain words, and without it the save goes through', async () => {
    const routeId = await newRoute();
    const refused = await save(
      item(
        routeId,
        1,
        document([fact('notes.general', { value: 'Write to someone@example.com' })]),
      ),
    );
    expect(refused.status).toBe(400);
    expect(await asJson(refused)).toMatchObject({
      code: 'ROUTE_PACK_INVALID',
      error: routePackWords.email,
    });
    expect(await rows(routeId)).toBe(0);
    expect((await save(item(routeId, 1))).status).toBe(201);
  });

  test('a document that is not of standard version 1 and a fact with an unknown key are 400 ROUTE_PACK_INVALID', async () => {
    const routeId = await newRoute();
    const wrongVersion = await save(
      item(routeId, 1, { standardVersion: 2, sectionMarks: [], facts: [] }),
    );
    expect(wrongVersion.status).toBe(400);
    expect(await asJson(wrongVersion)).toMatchObject({ code: 'ROUTE_PACK_INVALID' });
    const unknown = await save(item(routeId, 1, document([fact('nothing.here')])));
    expect(unknown.status).toBe(400);
    expect(await asJson(unknown)).toMatchObject({ code: 'ROUTE_PACK_INVALID' });
    expect(await rows(routeId)).toBe(0);
  });
});

describe('route-pack-facts, section marks and the readiness line', () => {
  test('a mark saves with the facts and shows in the overview; the next version without it restores the section', async () => {
    const routeId = await newRoute();
    const section = routePackSections.find(
      (candidate) =>
        !standardFieldsV1.some(
          (field) => field.section === candidate.number && field.part === 'Locked' && field.core,
        ),
    )!;
    const marked = await save(
      item(routeId, 1, document([], [{ section: section.number, note: 'Not part of this route' }])),
    );
    expect(marked.status).toBe(201);
    const stateOf = async () =>
      (await viewOf(routeId)).completeness.sections.find((row) => row.section === section.number)!
        .state;
    expect(await stateOf()).toBe('NOT_APPLICABLE');
    expect((await save(item(routeId, 2, document()))).status).toBe(201);
    expect(await stateOf()).toBe('PENDING');
  });

  test('the editor read still answers the saved document after a save, with no actor id and no reason', async () => {
    const routeId = await newRoute();
    expect((await save(item(routeId, 1))).status).toBe(201);
    const read = await GET(
      new Request(url('route-pack-overview', f.tenantA) + `&routeId=${routeId}`),
      {
        params: Promise.resolve({ action: 'route-pack-overview' }),
      },
    );
    const answer = (await read.json()) as OverviewRoute;
    expect(answer.route?.content).toMatchObject({ version: 1 });
    expect(JSON.stringify(answer)).not.toContain(reason);
    expect(JSON.stringify(answer)).not.toContain(f.users.owner.id);
  });
});
