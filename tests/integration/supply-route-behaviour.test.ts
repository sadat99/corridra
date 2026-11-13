import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { candidateWorld, refused, type CandidateWorld } from './supply-support';
import { supplyWords } from '../../packages/domain/src/supply-sources';
import { STEP_UP_REQUIRED } from '../../packages/domain/src/index';

// ADR-082 slice S3: the supply API with CORRIDRA_SUPPLY_SOURCES on, over the real service, the real database and the real
// restricted roles. The switch-off answer is in tests/integration/supply-routes.test.ts. What is pinned here is what the route
// itself decides: the origin check, the session check, the step-up answer on a lift, how a refusal becomes a status, and the
// bounded reads of a JSON body and of an uploaded file.
const origin = 'https://app.corridra.test';
const live = vi.hoisted(() => ({ service: null as unknown }));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: origin },
    provider: {
      getSession: async (headers: Headers) => {
        const token = headers.get('x-test-token');
        return token ? { token } : null;
      },
    },
    supplyCandidates: live.service,
  }),
}));

let w: CandidateWorld;
let ids: { missionId: string; profileVersionId: string; sourceVersionId: string };
beforeAll(async () => {
  vi.stubEnv('CORRIDRA_SUPPLY_SOURCES', 'true');
  w = await candidateWorld();
  live.service = w.candidates;
  const source = await w.staffSource();
  ids = {
    missionId: w.missionId,
    profileVersionId: await w.profile(),
    sourceVersionId: source.sourceVersionId,
  };
}, 300000);
afterAll(async () => {
  await w?.close();
});
beforeEach(() => {
  vi.stubEnv('CORRIDRA_SUPPLY_SOURCES', 'true');
});

type Who = 'owner' | 'operator' | 'reviewer' | 'viewer';
type Reply = { status: number; body: Record<string, unknown> };
async function send(
  action: string,
  who: Who | null,
  options: {
    method?: 'GET' | 'POST';
    query?: Record<string, string>;
    body?: unknown;
    raw?: string | Buffer;
    headers?: Record<string, string | null>;
    tenant?: string;
  } = {},
): Promise<Reply> {
  const { GET, POST } = await import('../../apps/web/app/api/supply/[action]/route');
  const method =
    options.method ?? (options.body === undefined && options.raw === undefined ? 'GET' : 'POST');
  const query = new URLSearchParams({
    tenant: options.tenant ?? w.tenantA,
    ...options.query,
  });
  const headers: Record<string, string> = {
    ...(who ? { 'x-test-token': w.users[who].token } : {}),
    ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}),
  };
  for (const [key, value] of Object.entries(options.headers ?? {}))
    if (value === null) delete headers[key];
    else headers[key] = value;
  const request = new Request(`${origin}/api/supply/${action}?${query}`, {
    method,
    headers,
    ...(method === 'POST'
      ? { body: options.raw ?? JSON.stringify(options.body ?? {}), duplex: 'half' }
      : {}),
  } as RequestInit);
  const response = await (method === 'GET' ? GET : POST)(request, {
    params: Promise.resolve({ action }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
const blocks = () =>
  w.owner.query('SELECT count(*)::int n FROM app.supply_do_not_contact').then((r) => r.rows[0].n);
const setMfa = (who: Who, fresh: boolean) =>
  w.owner.query(
    `UPDATE identity.assurance SET verified_at=${fresh ? 'now()' : "now()-interval '1 hour'"} WHERE session_id=$1`,
    [w.users[who].sessionId],
  );
const blockBody = (over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  companyName: 'Route Blocked Trading Ltd',
  country: 'DE',
  reason: 'The company asked to be left alone',
  reference: 'ticket 91',
  ...over,
});

describe('who may call the supply API', () => {
  test('a read answers for a staff session and is refused with no session, and a write needs the application origin', async () => {
    const read = await send('state', 'viewer', { query: { mission: ids.missionId } });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ moduleOpen: true, kinds: ['staff_research'] });
    expect(await send('state', null, { query: { mission: ids.missionId } })).toMatchObject({
      status: 401,
      body: { error: 'Sign in to continue' },
    });
    expect(await send('block', null, { body: blockBody() })).toMatchObject({ status: 401 });
    const before = await blocks();
    expect(
      await send('block', 'operator', {
        body: blockBody(),
        headers: { origin: 'https://evil.example' },
      }),
    ).toMatchObject({ status: 403, body: { error: 'Request origin is not allowed' } });
    expect(
      await send('block', 'operator', { body: blockBody(), headers: { origin: null } }),
    ).toMatchObject({ status: 403 });
    expect(await blocks()).toBe(before);
  });

  test('a role that may not write is refused with Access denied, and the write does not happen', async () => {
    const before = await blocks();
    for (const who of ['reviewer', 'viewer'] as const)
      expect(await send('block', who, { body: blockBody() }), who).toMatchObject({
        status: 403,
        body: { error: 'Access denied' },
      });
    expect(await blocks()).toBe(before);
  });
});

describe('what a refusal looks like to the screen', () => {
  test('a refusal is a conflict, a bad body is a 400, and contact details keep their own sentence', async () => {
    const unknown = await send('block', 'operator', {
      body: blockBody({ companyName: undefined, country: undefined, organisationId: randomUUID() }),
    });
    expect(unknown).toMatchObject({
      status: 409,
      body: { error: supplyWords.organisationUnavailable },
    });
    expect(await send('block', 'operator', { body: { commandId: randomUUID() } })).toMatchObject({
      status: 400,
      body: { error: 'Check the submitted values' },
    });
    expect(
      await send('add-candidate', 'operator', {
        body: {
          commandId: randomUUID(),
          ...ids,
          companyName: 'jane@acme.example',
          country: 'DE',
          observedAt: new Date(Date.now() - 86400000).toISOString(),
          sourceLocator: 'https://registry.example/1',
        },
      }),
    ).toMatchObject({ status: 400, body: { error: supplyWords.contactDetails } });
    expect(await send('nothing-like-this', 'operator', { body: {} })).toMatchObject({
      status: 404,
    });
    expect(await send('candidate', 'viewer', { query: { id: randomUUID() } })).toMatchObject({
      status: 404,
    });
  });

  test('a lift by a person whose authenticator check is old answers STEP_UP_REQUIRED and writes nothing', async () => {
    const put = await send('block', 'operator', { body: blockBody({ reference: 'ticket 92' }) });
    expect(put.status).toBe(201);
    const blockId = (put.body as { blockId: string }).blockId;
    const lift = (who: Who) =>
      send('lift', who, {
        body: {
          commandId: randomUUID(),
          blockId,
          reason: 'The company agreed to be listed',
          reference: 'ticket 93',
        },
      });
    expect(await lift('operator')).toMatchObject({ status: 403, body: { error: 'Access denied' } });
    await setMfa('owner', false);
    const before = await blocks();
    const stale = await lift('owner');
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe(STEP_UP_REQUIRED);
    expect(await blocks()).toBe(before);
    await setMfa('owner', true);
    expect(await lift('owner')).toMatchObject({ status: 201 });
    expect(await blocks()).toBe(before + 1);
  });
});

describe('how much the route reads', () => {
  test('a JSON body over the cap is refused, by its declared length and by what it sends', async () => {
    const big = JSON.stringify(blockBody({ reason: 'x'.repeat(20000) }));
    expect(await send('block', 'operator', { raw: big })).toMatchObject({
      status: 413,
      body: { error: 'Request is too large' },
    });
    expect(
      await send('block', 'operator', {
        raw: big,
        headers: { 'content-length': null },
      }),
    ).toMatchObject({ status: 413 });
    expect(await send('block', 'operator', { raw: '{' })).toMatchObject({ status: 400 });
  });

  test('a file import answers 400 for a body that is not a file upload, and refuses one that declares more than the cap', async () => {
    expect(
      await send('import-file', 'operator', { body: { commandId: randomUUID() } }),
    ).toMatchObject({ status: 400, body: { error: 'Choose a file to import.' } });
    expect(
      await send('import-file', 'operator', {
        raw: 'not a form',
        headers: { 'content-type': 'multipart/form-data; boundary=nothing' },
      }),
    ).toMatchObject({ status: 400, body: { error: 'Choose a file to import.' } });
    expect(
      await send('import-file', 'operator', {
        raw: 'short body with a long story about its size',
        headers: {
          'content-type': 'multipart/form-data; boundary=nothing',
          'content-length': String(8 * 1024 * 1024),
        },
      }),
    ).toMatchObject({
      status: 400,
      body: { error: 'This file is over 1 MiB. Split it and try again.' },
    });
  });
});

describe('what the screens ask the service before they offer a control', () => {
  test('the screen state says whether the module is open and which profile version a mission has', async () => {
    const open = await w.candidates.screenState(w.users.viewer.ctx, ids.missionId);
    expect(open).toMatchObject({
      moduleOpen: true,
      profile: { id: ids.profileVersionId, version: 1, role: 'BUYER' },
    });
    expect(await w.candidates.screenState(w.users.viewer.ctx)).toMatchObject({
      moduleOpen: true,
      profile: null,
    });
    const other = await w.mission(w.tenantA, w.users.operator.id);
    expect((await w.candidates.screenState(w.users.viewer.ctx, other)).profile).toBeNull();
  });

  test('the lift check passes for an owner with a fresh authenticator check, denies another role and asks a stale one to verify', async () => {
    await expect(w.candidates.requireFreshLift(w.users.owner.ctx)).resolves.toBeUndefined();
    for (const who of ['operator', 'reviewer', 'viewer'] as const)
      expect(await refused(w.candidates.requireFreshLift(w.users[who].ctx)), who).toBe(
        'Access denied',
      );
    await setMfa('owner', false);
    try {
      await w.candidates.requireFreshLift(w.users.owner.ctx);
      throw new Error('the stale check was accepted');
    } catch (error) {
      expect(error).toMatchObject({ status: 401, code: STEP_UP_REQUIRED });
    } finally {
      await setMfa('owner', true);
    }
  });
});
