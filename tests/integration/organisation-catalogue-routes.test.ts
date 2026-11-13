import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { World } from './organisation-link-support';
import { Staff, unavailable, type Side, type Who } from './source-rights-support';
import { sourceRightsHidden } from './source-rights-hide';
import { StaffOrganisationCatalogueService } from '../../packages/auth/src/organisation-source-rights';

// ADR-079 slice B: the staff routes over the 0021 functions, end to end. The real routes run over the real service, the
// real database and the real restricted roles. The customer link switch is never set here, because these routes are not
// behind it. Each denial test first does the same request as an allowed caller, so a route that refuses everything fails.
vi.hoisted(() => {
  (globalThis as { __linkHide?: boolean }).__linkHide = true;
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const base =
      (globalThis as { __linkHide?: boolean }).__linkHide &&
      String(path).includes('customer-real-use-migrations');
    return names.filter(
      (n) =>
        !sourceRightsHidden(String(path), String(n)) &&
        !(
          base &&
          /^(0013_organisation_link_provenance_and_search|0014_|0015_|0016_|0017_|0018_|0019_|0020_|0021_)/.test(
            String(n),
          )
        ),
    );
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});
const origin = 'https://app.corridra.test';
const live = vi.hoisted(() => ({
  service: null as unknown,
  override: null as null | ((name: string) => Promise<unknown>),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    provider: {
      getSession: async (headers: Headers) => {
        const token = headers.get('x-test-token');
        return token ? { token } : null;
      },
    },
    staffOrganisationCatalogue: new Proxy(
      {},
      {
        get:
          (_target, name: string) =>
          async (...args: unknown[]) => {
            if (live.override) return live.override(name);
            const service = live.service as Record<string, (...a: unknown[]) => Promise<unknown>>;
            return service[name]!(...args);
          },
      },
    ),
  }),
}));
const rightsRoute = () =>
  import('../../apps/web/app/api/workspace/organisation-source-rights/route');
const suppressionRoute = () =>
  import('../../apps/web/app/api/workspace/organisation-suppression/route');
const redactionRoute = () =>
  import('../../apps/web/app/api/workspace/organisation-link-redaction/route');
const closedRoute = () =>
  import('../../apps/web/app/api/workspace/organisation-link-closed-claims/route');

let w: World;
let s: Staff;
beforeAll(async () => {
  vi.stubEnv('CORRIDRA_DELIVERY_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED', '');
  w = await World.build('corridra_integration');
  await w.install();
  s = new Staff(w);
  live.service = new StaffOrganisationCatalogueService(w.f.runtime);
}, 300000);
afterAll(async () => {
  await w?.close();
});
beforeEach(() => {
  live.override = null;
  vi.stubEnv('CORRIDRA_DELIVERY_ENABLED', 'true');
});

type Reply = {
  status: number;
  body: { claims?: { redacted: boolean }[] } & Record<string, unknown>;
  headers: Headers;
};
const path = {
  rights: 'organisation-source-rights',
  suppression: 'organisation-suppression',
  redaction: 'organisation-link-redaction',
  closed: 'organisation-link-closed-claims',
};
async function send(
  name: keyof typeof path,
  who: Who | null,
  side: Side,
  options: {
    query?: Record<string, string>;
    body?: unknown;
    raw?: string;
    headers?: Record<string, string | null>;
  } = {},
): Promise<Reply> {
  const mod = await {
    rights: rightsRoute,
    suppression: suppressionRoute,
    redaction: redactionRoute,
    closed: closedRoute,
  }[name]();
  const ctx = who ? s.ctx(who, side) : null;
  const query = new URLSearchParams({ ...(ctx ? { tenant: ctx.tenantId } : {}), ...options.query });
  const get = options.body === undefined && options.raw === undefined;
  const headers: Record<string, string> = {
    ...(ctx ? { 'x-test-token': ctx.token } : {}),
    ...(get ? {} : { origin, 'content-type': 'application/json' }),
  };
  for (const [key, value] of Object.entries(options.headers ?? {}))
    if (value === null) delete headers[key];
    else headers[key] = value;
  const request = new Request(`${origin}/api/workspace/${path[name]}?${query}`, {
    method: get ? 'GET' : 'POST',
    headers,
    ...(get ? {} : { body: options.raw ?? JSON.stringify(options.body) }),
  });
  const handler = get
    ? (mod as { GET: (r: Request) => Promise<Response> }).GET
    : (mod as { POST: (r: Request) => Promise<Response> }).POST;
  const response = await handler(request);
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const organisation = async (side: Side, name: string) =>
  (await s.ingest(side, s.identity(side, name), 'other')).id;
const adjust = (id: string, over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  organisationId: id,
  sourceType: 'government_registry',
  reason: 'Checked against the public register',
  ...over,
});
const hide = (id: string, over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  organisationId: id,
  state: 'hidden',
  reason: 'Takedown requested by the company',
  reference: 'TICKET-7001',
  ...over,
});
async function closedClaim(label: string) {
  const person = await w.freshWriter(label, 'Nonesuch Handel GmbH');
  const claim = (
    await w.link(person.who, 'real').command({
      action: 'file',
      commandId: randomUUID(),
      workspaceId: person.workspaceId,
      expectedProfileVersion: 1,
      kind: 'PROPOSED_NEW',
      organisationId: null,
      note: 'Private note of ' + label,
    })
  ).claim!.id!;
  const review = await w.staff().review(w.rsCtx, claim);
  await w.staff().decide(w.rsCtx, {
    commandId: randomUUID(),
    claimId: claim,
    expectedVersion: review.version,
    decision: 'reject',
    reason: 'Reason text staff wrote',
    internalNote: null,
    organisationId: null,
    shareConfirmed: false,
  });
  return { ...person, claim };
}
const redactBody = (claim: string, over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  claimId: claim,
  confirmClaimId: claim,
  reason: 'Erasure request from the company',
  reference: 'ERASE-7002',
  ...over,
});
const withStaleMfa = async (who: Who, work: () => Promise<void>) => {
  await w.f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
    [w.f.users[who]!.sessionId],
  );
  try {
    await work();
  } finally {
    await w.freshStaff();
  }
};
const refusal = (words: string) => ({ status: 403, body: { error: words } });

describe('permission mapping per route', () => {
  test('rights read and adjust need research.manage: owner and operator pass, reviewer and viewer are refused neutrally', async () => {
    for (const who of ['owner', 'operator'] as const) {
      const id = await organisation('real', `Rights Route ${who} GmbH`);
      const read = await send('rights', who, 'real', { query: { organisation: id } });
      expect(read.status, who).toBe(200);
      expect(read.body).toEqual({
        organisationId: id,
        status: 'recorded',
        current: expect.any(Object),
        history: expect.any(Array),
      });
      const done = await send('rights', who, 'real', { body: adjust(id) });
      expect(done.status, who).toBe(200);
      expect(done.body).toMatchObject({
        organisationId: id,
        version: 2,
        sourceType: 'government_registry',
      });
      expect(done.headers.get('cache-control')).toBe('no-store');
    }
    const id = await organisation('real', 'Rights Route Denied GmbH');
    for (const who of ['reviewer', 'viewer'] as const) {
      expect(await send('rights', who, 'real', { query: { organisation: id } }), who).toMatchObject(
        refusal(unavailable),
      );
      expect(await send('rights', who, 'real', { body: adjust(id) }), who).toMatchObject(
        refusal(unavailable),
      );
    }
    expect(await s.rightsRows(id)).toHaveLength(1);
  });
  test('takedown needs trust.verify: owner and reviewer hide, operator and viewer are refused neutrally', async () => {
    for (const who of ['owner', 'reviewer'] as const) {
      const id = await organisation('real', `Hide Route ${who} GmbH`);
      const done = await send('suppression', who, 'real', { body: hide(id) });
      expect(done, who).toMatchObject({
        status: 200,
        body: { organisationId: id, state: 'hidden', version: 1 },
      });
    }
    const id = await organisation('real', 'Hide Route Denied GmbH');
    for (const who of ['operator', 'viewer'] as const)
      expect(await send('suppression', who, 'real', { body: hide(id) }), who).toMatchObject(
        refusal(unavailable),
      );
    expect(await s.suppressionRows(id)).toHaveLength(0);
  });
  test('showing again needs owner or admin: a reviewer is told so, an owner shows it', async () => {
    const id = await organisation('real', 'Show Route GmbH');
    expect((await send('suppression', 'reviewer', 'real', { body: hide(id) })).status).toBe(200);
    const denied = await send('suppression', 'reviewer', 'real', {
      body: hide(id, { state: 'shown' }),
    });
    expect(denied).toMatchObject({
      status: 403,
      body: { error: 'Owner or admin required to show an organisation again' },
    });
    expect(
      await send('suppression', 'owner', 'real', { body: hide(id, { state: 'shown' }) }),
    ).toMatchObject({
      status: 200,
      body: { state: 'shown', version: 2 },
    });
  });
  test('redaction and the closed-claims lookup: owner passes, reviewer is told owner or admin, operator and viewer are refused neutrally', async () => {
    const c = await closedClaim('route-perm');
    const listed = await send('closed', 'owner', 'real', { query: { workspace: c.workspaceId } });
    expect(listed.status).toBe(200);
    expect(listed.body.claims).toEqual([
      expect.objectContaining({ claimId: c.claim, redacted: false }),
    ]);
    expect(JSON.stringify(listed.body)).not.toContain('Private note');
    const words = 'Company link request unavailable';
    for (const who of ['operator', 'viewer'] as const) {
      expect(
        await send('closed', who, 'real', { query: { workspace: c.workspaceId } }),
        who,
      ).toMatchObject(refusal(words));
      expect(
        await send('redaction', who, 'real', { body: redactBody(c.claim) }),
        who,
      ).toMatchObject(refusal(words));
    }
    expect(
      await send('closed', 'reviewer', 'real', { query: { workspace: c.workspaceId } }),
    ).toMatchObject({
      status: 403,
      body: { error: 'Owner or admin required to look up claims' },
    });
    expect(
      await send('redaction', 'reviewer', 'real', { body: redactBody(c.claim) }),
    ).toMatchObject({
      status: 403,
      body: { error: 'Owner or admin required to redact a claim' },
    });
    const done = await send('redaction', 'owner', 'real', { body: redactBody(c.claim) });
    expect(done).toMatchObject({ status: 200, body: { claimId: c.claim, redacted: true } });
    const after = await send('closed', 'owner', 'real', { query: { workspace: c.workspaceId } });
    expect(after.body.claims).toEqual([
      expect.objectContaining({ claimId: c.claim, redacted: true }),
    ]);
  });
});

describe('neutral denial', () => {
  test('rights: a non-ingest role, another workspace, the other side and an unknown id answer the same status and body', async () => {
    const id = await organisation('real', 'Neutral Rights GmbH');
    expect((await send('rights', 'owner', 'real', { query: { organisation: id } })).status).toBe(
      200,
    );
    const asked = [
      await send('rights', 'reviewer', 'real', { query: { organisation: id } }),
      await send('rights', 'other', 'real', { query: { organisation: id } }),
      await send('rights', 'owner', 'synthetic', { query: { organisation: id } }),
      await send('rights', 'owner', 'real', { query: { organisation: randomUUID() } }),
      await send('rights', 'reviewer', 'real', { body: adjust(id) }),
      await send('rights', 'other', 'real', { body: adjust(id) }),
      await send('rights', 'owner', 'synthetic', { body: adjust(id) }),
      await send('rights', 'owner', 'real', { body: adjust(randomUUID()) }),
    ];
    for (const reply of asked) expect(reply).toMatchObject(refusal(unavailable));
    expect(new Set(asked.map((r) => JSON.stringify([r.status, r.body]))).size).toBe(1);
    expect(await s.rightsRows(id)).toHaveLength(1);
  });
  test('takedown: another workspace, the other side and an unknown id answer the same status and body, even for a reviewer', async () => {
    const id = await organisation('real', 'Neutral Hide GmbH');
    const asked = [
      await send('suppression', 'other', 'real', { body: hide(id) }),
      await send('suppression', 'reviewer', 'synthetic', { body: hide(id) }),
      await send('suppression', 'owner', 'synthetic', { body: hide(id) }),
      await send('suppression', 'reviewer', 'real', { body: hide(randomUUID()) }),
      await send('suppression', 'viewer', 'real', { body: hide(id) }),
    ];
    for (const reply of asked) expect(reply).toMatchObject(refusal(unavailable));
    expect(new Set(asked.map((r) => JSON.stringify([r.status, r.body]))).size).toBe(1);
    expect(await s.suppressionRows(id)).toHaveLength(0);
    expect((await send('suppression', 'reviewer', 'real', { body: hide(id) })).status).toBe(200);
  });
  test('redaction and lookup: a claim or workspace of the other side or an unknown one never says which part failed', async () => {
    const c = await closedClaim('route-neutral');
    const words = 'Company link request unavailable';
    const gone = [
      await send('redaction', 'other', 'real', { body: redactBody(c.claim) }),
      await send('redaction', 'owner', 'real', { body: redactBody(randomUUID()) }),
      await send('redaction', 'owner', 'synthetic', { body: redactBody(c.claim) }),
    ];
    for (const reply of gone) expect(reply).toMatchObject(refusal(words));
    const empty = [
      await send('closed', 'owner', 'real', { query: { workspace: randomUUID() } }),
      await send('closed', 'owner', 'real', { query: { workspace: w.ws['WS1']! } }),
    ];
    for (const reply of empty) expect(reply).toMatchObject({ status: 200, body: { claims: [] } });
    expect(
      await send('closed', 'owner', 'real', { query: { workspace: c.workspaceId } }),
    ).toMatchObject({ status: 200 });
  });
});

describe('the door and strict bodies', () => {
  test('no session is 401, a wrong origin and a non-JSON body are refused, and nothing is written', async () => {
    const id = await organisation('real', 'Door GmbH');
    expect(
      (
        await send('rights', null, 'real', {
          query: { tenant: s.ctx('owner', 'real').tenantId, organisation: id },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await send('suppression', null, 'real', {
          query: { tenant: s.ctx('owner', 'real').tenantId },
          body: hide(id),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await send('suppression', 'reviewer', 'real', {
          body: hide(id),
          headers: { origin: 'https://evil.example.invalid' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await send('suppression', 'reviewer', 'real', { body: hide(id), headers: { origin: null } }))
        .status,
    ).toBe(403);
    expect(
      (
        await send('suppression', 'reviewer', 'real', {
          body: hide(id),
          headers: { 'content-type': 'text/plain' },
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await send('suppression', 'reviewer', 'real', {
          body: hide(id),
          query: { tenant: 'not-a-uuid' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await send('rights', 'owner', 'real', { query: { organisation: 'nope' } })).status,
    ).toBe(400);
    expect((await send('closed', 'owner', 'real', { query: { workspace: 'nope' } })).status).toBe(
      400,
    );
    expect((await send('suppression', 'reviewer', 'real', { raw: 'x'.repeat(9000) })).status).toBe(
      413,
    );
    expect(await s.suppressionRows(id)).toHaveLength(0);
    expect((await send('suppression', 'reviewer', 'real', { body: hide(id) })).status).toBe(200);
  });
  test('every body is strict: unknown keys, missing keys, wrong types and padded text are 400 and write nothing', async () => {
    const id = await organisation('real', 'Strict GmbH');
    const c = await closedClaim('route-strict');
    const cases: [keyof typeof path, Who, Record<string, unknown>, Record<string, unknown>][] = [
      ['rights', 'owner', adjust(id), { extra: true }],
      ['rights', 'owner', adjust(id), { sourceType: 'banana' }],
      ['rights', 'owner', adjust(id), { reason: 'ab' }],
      ['rights', 'owner', adjust(id), { reason: ' padded ' }],
      ['rights', 'owner', adjust(id), { commandId: 'nope' }],
      ['rights', 'owner', adjust(id), { organisationId: undefined }],
      ['suppression', 'reviewer', hide(id), { extra: true }],
      ['suppression', 'reviewer', hide(id), { state: 'banana' }],
      ['suppression', 'reviewer', hide(id), { reference: 'ab' }],
      ['suppression', 'reviewer', hide(id), { reference: 'x'.repeat(121) }],
      ['suppression', 'reviewer', hide(id), { reason: 'Line\nbreak' }],
      ['suppression', 'reviewer', hide(id), { reason: undefined }],
      ['redaction', 'owner', redactBody(c.claim), { extra: true }],
      ['redaction', 'owner', redactBody(c.claim), { confirmClaimId: undefined }],
      ['redaction', 'owner', redactBody(c.claim), { reference: 'ab' }],
    ];
    for (const [name, who, base, over] of cases) {
      const reply = await send(name, who, 'real', { body: { ...base, ...over } });
      expect(reply, JSON.stringify(over)).toMatchObject({
        status: 400,
        body: { error: 'Check the submitted values' },
      });
    }
    for (const raw of ['null', '[]', '"text"', '{', '']) {
      expect((await send('suppression', 'reviewer', 'real', { raw })).status, raw).toBe(400);
      expect((await send('rights', 'owner', 'real', { raw })).status, raw).toBe(400);
      expect((await send('redaction', 'owner', 'real', { raw })).status, raw).toBe(400);
    }
    expect(await s.suppressionRows(id)).toHaveLength(0);
    expect(await s.rightsRows(id)).toHaveLength(1);
    // A typed claim id that differs is the database refusal, a conflict, and nothing is redacted.
    expect(
      await send('redaction', 'owner', 'real', {
        body: redactBody(c.claim, { confirmClaimId: randomUUID() }),
      }),
    ).toMatchObject({ status: 409 });
    expect(
      (await send('closed', 'owner', 'real', { query: { workspace: c.workspaceId } })).body
        .claims![0]!.redacted,
    ).toBe(false);
  });
});

describe('retry and recovery', () => {
  test('the same command replays the original answer and a changed one conflicts, for rights, takedown and redaction', async () => {
    const id = await organisation('real', 'Replay GmbH');
    const rights = adjust(id);
    const first = await send('rights', 'owner', 'real', { body: rights });
    expect(first.status).toBe(200);
    expect(await send('rights', 'owner', 'real', { body: rights })).toMatchObject({
      status: 200,
      body: first.body,
    });
    expect(
      await send('rights', 'owner', 'real', { body: { ...rights, reason: 'A different reason' } }),
    ).toMatchObject({ status: 409 });
    expect(await s.rightsRows(id)).toHaveLength(2);

    const takedown = hide(id);
    const hidden = await send('suppression', 'reviewer', 'real', { body: takedown });
    expect(hidden.status).toBe(200);
    expect(await send('suppression', 'reviewer', 'real', { body: takedown })).toMatchObject({
      status: 200,
      body: hidden.body,
    });
    expect(
      await send('suppression', 'reviewer', 'real', {
        body: { ...takedown, reason: 'Another reason' },
      }),
    ).toMatchObject({ status: 409 });
    expect(await send('suppression', 'reviewer', 'real', { body: hide(id) })).toMatchObject({
      status: 409,
    });
    expect(await s.suppressionRows(id)).toHaveLength(1);

    const c = await closedClaim('route-replay');
    const body = redactBody(c.claim);
    const done = await send('redaction', 'owner', 'real', { body });
    expect(done.status).toBe(200);
    expect(await send('redaction', 'owner', 'real', { body })).toMatchObject({
      status: 200,
      body: done.body,
    });
    expect(
      await send('redaction', 'owner', 'real', { body: { ...body, reason: 'Another reason' } }),
    ).toMatchObject({ status: 409 });
    expect(await send('redaction', 'owner', 'real', { body: redactBody(c.claim) })).toMatchObject({
      status: 409,
    });
  });
  test('a stale authenticator check is a 401 STEP_UP_REQUIRED on takedown, redaction and lookup, writes nothing, and the same request works once re-verified', async () => {
    const id = await organisation('real', 'Stale Mfa GmbH');
    const c = await closedClaim('route-stale');
    await withStaleMfa('owner', async () => {
      for (const reply of [
        await send('suppression', 'owner', 'real', { body: hide(id) }),
        await send('redaction', 'owner', 'real', { body: redactBody(c.claim) }),
        await send('closed', 'owner', 'real', { query: { workspace: c.workspaceId } }),
      ])
        expect(reply).toMatchObject({ status: 401 });
      expect((await send('suppression', 'owner', 'real', { body: hide(id) })).body).toMatchObject({
        error: expect.stringContaining('authenticator'),
      });
      expect(await s.suppressionRows(id)).toHaveLength(0);
    });
    await withStaleMfa('reviewer', async () => {
      expect((await send('suppression', 'reviewer', 'real', { body: hide(id) })).status).toBe(401);
    });
    expect((await send('suppression', 'owner', 'real', { body: hide(id) })).status).toBe(200);
    expect((await send('redaction', 'owner', 'real', { body: redactBody(c.claim) })).status).toBe(
      200,
    );
  });
});

describe('switches', () => {
  test('with delivery off every route answers 503 before reading anything; with it on they answer again', async () => {
    const id = await organisation('real', 'Delivery Switch GmbH');
    vi.stubEnv('CORRIDRA_DELIVERY_ENABLED', 'false');
    for (const reply of [
      await send('rights', 'owner', 'real', { query: { organisation: id } }),
      await send('rights', 'owner', 'real', { body: adjust(id) }),
      await send('suppression', 'reviewer', 'real', { body: hide(id) }),
      await send('redaction', 'owner', 'real', { body: redactBody(randomUUID()) }),
      await send('closed', 'owner', 'real', { query: { workspace: randomUUID() } }),
    ])
      expect(reply).toMatchObject({
        status: 503,
        body: { error: 'Client and programme delivery is unavailable' },
      });
    expect(await s.suppressionRows(id)).toHaveLength(0);
    vi.stubEnv('CORRIDRA_DELIVERY_ENABLED', 'true');
    expect((await send('suppression', 'reviewer', 'real', { body: hide(id) })).status).toBe(200);
  });
  test('the routes do not depend on the customer link switch, which is unset', async () => {
    expect(process.env.CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED || '').toBe('');
    const id = await organisation('real', 'No Link Switch GmbH');
    expect((await send('rights', 'owner', 'real', { query: { organisation: id } })).status).toBe(
      200,
    );
  });
  test('a database without the 0021 functions answers 503 with plain words, never a 500', async () => {
    const id = await organisation('real', 'Not Installed GmbH');
    live.override = async () => {
      throw Object.assign(new Error('function does not exist'), { code: '42883' });
    };
    expect(await send('rights', 'owner', 'real', { query: { organisation: id } })).toMatchObject({
      status: 503,
      body: { error: 'Organisation source rights are unavailable' },
    });
    expect(await send('suppression', 'reviewer', 'real', { body: hide(id) })).toMatchObject({
      status: 503,
      body: { error: 'Organisation takedown is unavailable' },
    });
    expect(
      await send('redaction', 'owner', 'real', { body: redactBody(randomUUID()) }),
    ).toMatchObject({ status: 503, body: { error: 'Company link redaction is unavailable' } });
    expect(
      await send('closed', 'owner', 'real', { query: { workspace: randomUUID() } }),
    ).toMatchObject({ status: 503, body: { error: 'Company link lookup is unavailable' } });
  });
  test('every new route is registered for the private response headers', () => {
    const config = readFileSync('apps/web/next.config.ts', 'utf8');
    for (const name of Object.values(path))
      expect(config, name).toMatch(
        new RegExp(
          `source: '/api/workspace/${name}',\\s*headers: \\[\\s*\\{ key: 'Referrer-Policy', value: 'no-referrer' \\},\\s*\\{ key: 'Cache-Control', value: 'no-store' \\},`,
        ),
      );
  });
});
