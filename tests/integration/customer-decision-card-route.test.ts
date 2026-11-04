import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';
import { DeliveryService } from '../../packages/delivery/src/index';
import {
  CustomerDecisionCardService,
  DecisionCardReader,
} from '../../packages/auth/src/customer-decision-cards';
import {
  cardOptions,
  cardIssuer,
  cardSecret,
  cardSession,
  cardWorld,
  markers,
  mutate,
  retireCards,
  type CardWorld,
} from './decision-card-world';

// The two decision card routes (ADR-076 item 4), called for real against the real database functions with the
// restricted runtime role. Only the identity provider is replaced: the session is a fixed synthetic one.
const account = vi.hoisted(() => ({ services: null as unknown, who: 'alice' }));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => account.services }));
import * as ownerRoute from '../../apps/web/app/api/customer-decision-cards/route';
import * as publicRoute from '../../apps/web/app/api/decision-card/route';

const origin = 'https://corridra.example.invalid';
let world: CardWorld;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

const switchOn = () => {
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_DELIVERY_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_DECISIONS_ENABLED', 'true');
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('CORRIDRA_SHARE_CARD', 'true');
};
// The limiter is real only where a case needs it, so the many calls of the other cases share no hourly count.
const services = (over: Record<string, unknown> = {}) => {
  account.services = {
    delivery: { budget: async () => {} },
    customerDecisionCards: new CustomerDecisionCardService(
      world.f.runtime,
      world.f.auth,
      cardOptions,
      async () => cardSession(account.who),
      cardSecret,
    ),
    decisionCardReader: new DecisionCardReader(world.f.runtime),
    ready: Promise.resolve(),
    config: { APP_ORIGIN: origin },
    ...over,
  };
};

// A header given as null is left out, so a request with no subject header can be made.
const owner = (
  body: unknown,
  headers: Record<string, string | null> = {},
  raw = typeof body === 'string' ? body : JSON.stringify(body),
) =>
  ownerRoute.POST(
    new Request(origin + '/api/customer-decision-cards', {
      method: 'POST',
      headers: Object.fromEntries(
        Object.entries({
          Origin: origin,
          'Content-Type': 'application/json',
          'x-corridra-customer-subject': cardSession(account.who).subject,
          'x-corridra-customer-issuer': cardIssuer,
          ...headers,
        }).filter((entry): entry is [string, string] => entry[1] !== null),
      ),
      body: raw,
    }),
  );
const open = (
  body: unknown,
  headers: Record<string, string> = {},
  raw = typeof body === 'string' ? body : JSON.stringify(body),
) =>
  publicRoute.POST(
    new Request(origin + '/api/decision-card', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: raw,
    }),
  );
const preview = async (s = world.main) =>
  (await (
    await owner({ action: 'preview', resourceId: s.resourceId, decisionId: s.decisionId })
  ).json()) as {
    digest: string;
    expiresAt: string;
    fields: Record<string, unknown>;
  };
const createBody = (
  p: { digest: string; expiresAt: string },
  s: { resourceId: string; decisionId: string } = world.main,
  over: Record<string, unknown> = {},
) => ({
  action: 'create',
  commandId: randomUUID(),
  resourceId: s.resourceId,
  decisionId: s.decisionId,
  digest: p.digest,
  expiresAt: p.expiresAt,
  acknowledged: true,
  ...over,
});
type Made = { cardId: string; expiresAt: string; state: string; token?: string };
const share = async (s = world.main) => {
  const response = await owner(createBody(await preview(s), s));
  expect(response.status).toBe(200);
  return (await response.json()) as Made;
};
const count = async (sql = 'SELECT count(*)::int n FROM customer_private.decision_card') =>
  (await world.f.owner.query(sql)).rows[0].n as number;
const opens = async (cardId: string) =>
  Number(
    (
      await world.f.owner.query(
        'SELECT coalesce(max(opens),0)::int n FROM customer_private.decision_card_open WHERE card_id=$1',
        [cardId],
      )
    ).rows[0].n,
  );

// The limiter is real in the cases below. Each case gets a client address of its own (random in all four octets),
// so the hourly counts of one case, or of an earlier run on a persistent database, never reach another.
const realDelivery = () => new DeliveryService(world.f.runtime, world.f.mission, cardSecret);
const clientHeaders = () => {
  const address = [1, 2, 3, 4].map(() => randomInt(1, 255)).join('.');
  return { address, headers: { 'x-vercel-forwarded-for': `${address}, 10.0.0.1` } };
};
const limiterRows = async () =>
  (
    await world.f.owner.query(
      'SELECT count(*)::int n, coalesce(sum(count),0)::int total FROM app.intake_rate_limit',
    )
  ).rows[0] as { n: number; total: number };
const signedOut = () =>
  new CustomerDecisionCardService(
    world.f.runtime,
    world.f.auth,
    cardOptions,
    async () => null,
    cardSecret,
  );
const signedIn = (who: string) =>
  new CustomerDecisionCardService(
    world.f.runtime,
    world.f.auth,
    cardOptions,
    async () => cardSession(who),
    cardSecret,
  );

const privateHeaders = (response: Response) => {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(response.headers.get('set-cookie')).toBeNull();
};
const publicHeaders = (response: Response) => {
  privateHeaders(response);
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
};
// A whole answer as bytes, so "identical" means identical.
const wire = async (response: Response) => {
  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => headers.push([name, value]));
  return JSON.stringify({
    status: response.status,
    headers: headers.sort(),
    body: await response.text(),
  });
};

beforeAll(async () => {
  world = await cardWorld();
}, 240000);
afterAll(async () => {
  await world?.f.close();
  vi.unstubAllEnvs();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  account.who = 'alice';
  await retireCards(world.f.owner, world.main.resourceId);
  // Hourly counts are per customer and per address, and persist for the hour: clear them so no case sees another's.
  await world.f.owner.query('DELETE FROM app.intake_rate_limit');
});

describe('the owner route', () => {
  test('with the switch off it answers 503 and writes nothing', async () => {
    services();
    for (const value of [undefined, 'TRUE', '1', 'false']) {
      switchOn();
      vi.stubEnv('CORRIDRA_SHARE_CARD', value ?? '');
      const before = await count();
      const response = await owner({ action: 'state', resourceId: world.main.resourceId });
      expect(response.status).toBe(503);
      privateHeaders(response);
      expect(await count()).toBe(before);
      vi.unstubAllEnvs();
    }
    switchOn();
    vi.stubEnv('CORRIDRA_CUSTOMER_DECISIONS_ENABLED', 'false');
    expect((await owner({ action: 'state', resourceId: world.main.resourceId })).status).toBe(503);
    vi.unstubAllEnvs();
    switchOn();
    vi.stubEnv('VERCEL_ENV', 'production');
    expect((await owner({ action: 'state', resourceId: world.main.resourceId })).status).toBe(503);
  });

  test('has no GET, so a link, a prefetch or a crawler can start nothing', () => {
    expect(Object.keys(ownerRoute).filter((key) => /^[A-Z]+$/.test(key))).toEqual(['POST']);
  });

  test('state, preview, create and withdraw work end to end with the private headers', async () => {
    switchOn();
    services();
    const state = await owner({ action: 'state', resourceId: world.main.resourceId });
    expect(state.status).toBe(200);
    privateHeaders(state);
    expect(await state.json()).toMatchObject({ canShare: true, maxActive: 5 });
    const p = await preview();
    expect(Object.keys(p.fields).sort()).toEqual(
      ['company', 'decision', 'dueAt', 'nextAction', 'provenance', 'rationale'].sort(),
    );
    const created = await owner(createBody(p));
    expect(created.status).toBe(200);
    privateHeaders(created);
    const card = (await created.json()) as Made;
    expect(card.state).toBe('ACTIVE');
    expect(card.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(card.expiresAt).toBe(p.expiresAt);
    const withdrawn = await owner({
      action: 'withdraw',
      commandId: randomUUID(),
      cardId: card.cardId,
    });
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toEqual({ cardId: card.cardId, state: 'WITHDRAWN' });
  });

  test('an exact retry returns the same link; after withdrawal the retry has no link', async () => {
    switchOn();
    services();
    const body = createBody(await preview());
    const first = (await (await owner(body)).json()) as Made;
    const second = (await (await owner(body)).json()) as Made;
    expect(second).toEqual(first);
    await owner({ action: 'withdraw', commandId: randomUUID(), cardId: first.cardId });
    const third = (await (await owner(body)).json()) as Made;
    expect(third.state).toBe('WITHDRAWN');
    expect('token' in third).toBe(false);
  });

  test('a stale digest is 409 with reason CHANGED and writes nothing', async () => {
    switchOn();
    services();
    const s = await world.spare();
    const before = await count();
    const response = await owner(
      createBody({ digest: '0'.repeat(64), expiresAt: (await preview(s)).expiresAt }, s),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: expect.stringMatching(/changed/i),
      reason: 'CHANGED',
    });
    expect(await count()).toBe(before);
  });

  test('the sixth live card is 409 with reason CAP_REACHED, a different reason from a change', async () => {
    switchOn();
    services();
    const s = await world.spare();
    for (let i = 0; i < 5; i++) await share(s);
    const response = await owner(createBody(await preview(s), s));
    expect(response.status).toBe(409);
    const answer = await response.json();
    expect(answer.reason).toBe('CAP_REACHED');
    expect(answer.error).toMatch(/most active links.*Withdraw one/);
  });

  test('the 31st card in an hour is 429 in plain words', async () => {
    switchOn();
    services();
    const s = await world.spare();
    const p = await preview(s);
    await world.f.owner.query(
      `INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,created_at,expires_at)
       SELECT $1,gen_random_uuid(),$2,$3,$4,$5,encode(sha256(gen_random_uuid()::text::bytea),'hex'),now()-interval '10 minutes',now()-interval '5 minutes'
       FROM generate_series(1,30)`,
      [world.principals.alice, s.resourceId, world.workspaceId, s.decisionId, p.digest],
    );
    const response = await owner(createBody(p, s));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toMatch(/Try again/);
  });

  test('every loss of access is the same 403, whatever the cause', async () => {
    switchOn();
    services();
    const p = await preview();
    const before = await count();
    account.who = 'bob';
    const member = await owner(
      createBody(p, { resourceId: world.memberResource, decisionId: world.main.decisionId }),
    );
    const memberPreview = await owner({
      action: 'preview',
      resourceId: world.memberResource,
      decisionId: world.main.decisionId,
    });
    account.who = 'alice';
    const unknownReport = await owner(
      createBody(p, { resourceId: randomUUID(), decisionId: world.main.decisionId }),
    );
    const unknownDecision = await owner(
      createBody(p, { resourceId: world.main.resourceId, decisionId: randomUUID() }),
    );
    const changed = await owner(createBody(p), { 'x-corridra-customer-subject': 'someone-else' });
    const responses = [member, memberPreview, unknownReport, unknownDecision, changed];
    for (const response of responses) expect(response.status).toBe(403);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(await count()).toBe(before);
  });

  test('another customer cannot withdraw a card, and the answer is the same 403 as for a card that does not exist', async () => {
    switchOn();
    services();
    const card = await share();
    account.who = 'bob';
    const foreign = await owner({
      action: 'withdraw',
      commandId: randomUUID(),
      cardId: card.cardId,
    });
    const missing = await owner({
      action: 'withdraw',
      commandId: randomUUID(),
      cardId: randomUUID(),
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  test('a command reused for another card is 400, never a conflict', async () => {
    switchOn();
    services();
    const s = await world.spare();
    const a = await share(s);
    const b = await share(s);
    const commandId = randomUUID();
    await owner({ action: 'withdraw', commandId, cardId: a.cardId });
    const response = await owner({ action: 'withdraw', commandId, cardId: b.cardId });
    expect(response.status).toBe(400);
  });

  test('a signed-out caller gets 401 in plain words and nothing is written', async () => {
    switchOn();
    services({
      customerDecisionCards: new CustomerDecisionCardService(
        world.f.runtime,
        world.f.auth,
        cardOptions,
        async () => null,
        cardSecret,
      ),
    });
    const before = await count();
    const response = await owner(
      createBody(
        await (async () => ({
          digest: '0'.repeat(64),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }))(),
      ),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in to continue' });
    expect(await count()).toBe(before);
  });

  test('refuses a foreign origin, a non-JSON body, an oversized body and bad input before any work', async () => {
    switchOn();
    services();
    const before = await count();
    const good = createBody(await preview());
    expect((await owner(good, { Origin: 'https://elsewhere.invalid' })).status).toBe(403);
    expect((await owner(good, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await owner({ ...good, padding: 'x'.repeat(5000) })).status).toBe(413);
    for (const bad of [
      { ...good, acknowledged: false },
      { ...good, digest: 'xyz' },
      { ...good, tenantId: randomUUID() },
      { action: 'delete' },
      { action: 'state' },
      [],
    ])
      expect((await owner(bad)).status).toBe(400);
    expect((await owner('{not json')).status).toBe(400);
    expect(await count()).toBe(before);
  });

  test('does not spend the limiter on the read-only state and preview', async () => {
    switchOn();
    const budget = vi.fn();
    services({ delivery: { budget } });
    expect((await owner({ action: 'state', resourceId: world.main.resourceId })).status).toBe(200);
    expect(budget).not.toHaveBeenCalled();
  });

  test('the module not installed is 503, not a server error', async () => {
    switchOn();
    services();
    await world.f.owner.query(
      'ALTER FUNCTION customer.decision_card_state(uuid) RENAME TO decision_card_state_hidden',
    );
    try {
      const response = await owner({ action: 'state', resourceId: world.main.resourceId });
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe('Decision cards are unavailable');
    } finally {
      await world.f.owner.query(
        'ALTER FUNCTION customer.decision_card_state_hidden(uuid) RENAME TO decision_card_state',
      );
    }
  });

  test('a retryable failure is a 503 with Retry-After, and an unknown failure is a logged 500 without detail', async () => {
    switchOn();
    services({
      customerDecisionCards: {
        state: async () => {
          throw new DomainError('Busy right now. Try again in a moment.', 503, 'RETRYABLE');
        },
      },
    });
    const busy = await owner({ action: 'state', resourceId: world.main.resourceId });
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('2');
    expect((await busy.json()).error).toMatch(/Try again/);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    services({
      customerDecisionCards: {
        state: async () => {
          throw Object.assign(new Error('internal detail'), { code: 'XX000' });
        },
      },
    });
    const failed = await owner({ action: 'state', resourceId: world.main.resourceId });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain('internal detail');
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain('XX000');
    expect(String(log.mock.calls[0]![0])).not.toContain('internal detail');
  });
});

describe('the public route', () => {
  const unknownWire = async () => wire(await open({ token: newToken() }));

  test('answers GET and HEAD with 405, Allow: POST, no card data and the private headers', async () => {
    switchOn();
    services();
    const card = await share();
    for (const handler of [publicRoute.GET, publicRoute.HEAD] as const) {
      const response = handler();
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      publicHeaders(response);
      const text = await response.text();
      expect(text).not.toContain(card.token!);
      expect(text).not.toContain('company');
    }
    expect(
      Object.keys(publicRoute)
        .filter((key) => /^[A-Z]+$/.test(key))
        .sort(),
    ).toEqual(['GET', 'HEAD', 'POST']);
  });

  test('opens a live card with exactly the allowed fields, the private headers and a counted open', async () => {
    switchOn();
    services();
    const card = await share();
    expect(await opens(card.cardId)).toBe(0);
    const response = await open({ token: card.token });
    expect(response.status).toBe(200);
    publicHeaders(response);
    const answer = await response.json();
    expect(Object.keys(answer).sort()).toEqual(['card', 'expiresAt', 'state', 'synthetic']);
    expect(answer).toMatchObject({ state: 'OPEN', synthetic: true, expiresAt: card.expiresAt });
    expect(Object.keys(answer.card).sort()).toEqual(
      ['company', 'decision', 'dueAt', 'nextAction', 'provenance', 'rationale'].sort(),
    );
    expect(Object.keys(answer.card.provenance).sort()).toEqual(['claimStatus', 'sourceKind']);
    expect(await opens(card.cardId)).toBe(1);
    await open({ token: card.token });
    await open({ token: card.token });
    expect(await opens(card.cardId)).toBe(3);
  });

  test('the answer holds no quotation, price, evidence, other decision, brief, request text or token', async () => {
    switchOn();
    services();
    const card = await share();
    const text = JSON.stringify(await (await open({ token: card.token })).json());
    for (const value of Object.values(markers)) expect(text).not.toContain(value);
    expect(text).not.toContain(card.token!);
    expect(text).not.toContain(sha256(card.token!));
    expect(text).not.toContain(world.main.otherDecisionId!);
    expect(text).not.toContain(world.main.resourceId);
  });

  test('counts the open in a plain statement: not in a read-only transaction and not on a replica', async () => {
    switchOn();
    const queries: string[] = [];
    const pool = {
      query: async (text: string, values: unknown[]) => {
        queries.push(text);
        return world.f.runtime.query(text, values);
      },
    };
    services({ decisionCardReader: new DecisionCardReader(pool as never) });
    const card = await share();
    expect((await (await open({ token: card.token })).json()).state).toBe('OPEN');
    expect(queries).toEqual(['SELECT app.read_decision_card($1) AS result']);
    expect(await opens(card.cardId)).toBe(1);
  });

  test('every answer that is not an open is one identical 200 body, headers and bytes', async () => {
    switchOn();
    services();
    const baseline = await unknownWire();
    expect(JSON.parse(JSON.parse(baseline).body)).toEqual({ state: 'unknown' });
    expect(JSON.parse(baseline).status).toBe(200);
    // A card that is open now, so each refusal below is a change from a working link.
    const same = async (token: string | undefined) =>
      expect(await wire(await open({ token }))).toBe(baseline);

    // Malformed and unknown tokens.
    for (const token of [
      undefined,
      '',
      'short',
      newToken() + 'x',
      newToken().slice(1),
      '!'.repeat(43),
      ' '.repeat(43),
    ])
      await same(token);
    // Malformed bodies answer the same, not an error.
    for (const raw of [
      '{not json',
      '[]',
      'null',
      '"x"',
      '{"token":123}',
      '{"token":null}',
      '{}',
      '{"token":"' + newToken() + '","extra":1}',
    ])
      expect(await wire(await open(undefined, {}, raw))).toBe(baseline);

    // Withdrawn.
    const withdrawn = await share(await world.spare());
    expect((await (await open({ token: withdrawn.token })).json()).state).toBe('OPEN');
    await owner({ action: 'withdraw', commandId: randomUUID(), cardId: withdrawn.cardId });
    await same(withdrawn.token);

    // Expired: a past-dated row, as the owner connection (the product only inserts live rows).
    const p = await preview();
    const past = newToken();
    await world.f.owner.query(
      `INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,created_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,now()-interval '2 days',now()-interval '1 day')`,
      [
        world.principals.alice,
        randomUUID(),
        world.main.resourceId,
        world.workspaceId,
        world.main.decisionId,
        p.digest,
        sha256(past),
      ],
    );
    await same(past);

    // A field changed after the preview.
    const changed = await share(await world.spare());
    const s = changed;
    expect((await (await open({ token: s.token })).json()).state).toBe('OPEN');
    const row = (
      await world.f.owner.query(
        'SELECT m.decision_id FROM (SELECT decision_id FROM customer_private.decision_card WHERE id=$1) m',
        [changed.cardId],
      )
    ).rows[0];
    const old = (
      await world.f.owner.query('SELECT next_action FROM app.mission_selection WHERE id=$1', [
        row.decision_id,
      ])
    ).rows[0].next_action;
    await mutate(
      world.f.owner,
      'app.mission_selection',
      "UPDATE app.mission_selection SET next_action='Changed after the preview' WHERE id=$1",
      [row.decision_id],
    );
    try {
      await same(changed.token);
    } finally {
      await mutate(
        world.f.owner,
        'app.mission_selection',
        'UPDATE app.mission_selection SET next_action=$2 WHERE id=$1',
        [row.decision_id, old],
      );
    }
    expect((await (await open({ token: changed.token })).json()).state).toBe('OPEN');

    // A removed saved report.
    const removed = await share(await world.spare());
    const removedRow = (
      await world.f.owner.query(
        'SELECT saved_mission_id FROM customer_private.decision_card WHERE id=$1',
        [removed.cardId],
      )
    ).rows[0];
    await mutate(
      world.f.owner,
      'customer_private.saved_mission',
      'UPDATE customer_private.saved_mission SET removed_at=now() WHERE id=$1',
      [removedRow.saved_mission_id],
    );
    await same(removed.token);
  });

  test('with the switch off, or the module missing, the answer is the same unknown and nothing is counted', async () => {
    switchOn();
    services();
    const baseline = await unknownWire();
    const card = await share();
    const before = await opens(card.cardId);
    for (const value of [undefined, 'TRUE', '1', 'false']) {
      vi.unstubAllEnvs();
      switchOn();
      vi.stubEnv('CORRIDRA_SHARE_CARD', value ?? '');
      expect(await wire(await open({ token: card.token }))).toBe(baseline);
    }
    vi.unstubAllEnvs();
    switchOn();
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(await wire(await open({ token: card.token }))).toBe(baseline);
    vi.unstubAllEnvs();
    switchOn();
    account.services = null;
    expect(await wire(await open({ token: card.token }))).toBe(baseline);
    services();
    await world.f.owner.query(
      'ALTER FUNCTION app.read_decision_card(text) RENAME TO read_decision_card_hidden',
    );
    try {
      expect(await wire(await open({ token: card.token }))).toBe(baseline);
    } finally {
      await world.f.owner.query(
        'ALTER FUNCTION app.read_decision_card_hidden(text) RENAME TO read_decision_card',
      );
    }
    expect(await opens(card.cardId)).toBe(before);
    expect((await (await open({ token: card.token })).json()).state).toBe('OPEN');
  });

  test('a rate limit is 429, spent before the read, and says nothing about the token', async () => {
    switchOn();
    const card = await share();
    const read = vi.fn(async () => ({ state: 'unknown' }));
    const budget = vi.fn(async () => {
      throw new DomainError('Too many requests. Try again in an hour.', 429);
    });
    services({ delivery: { budget }, decisionCardReader: { read } });
    const live = await open({ token: card.token });
    const random = await open({ token: newToken() });
    const malformed = await open(undefined, {}, '{nope');
    for (const response of [live, random, malformed]) {
      expect(response.status).toBe(429);
      publicHeaders(response);
    }
    const [a, b, c] = [await wire(live), await wire(random), await wire(malformed)];
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(read).not.toHaveBeenCalled();
    const text = JSON.stringify(budget.mock.calls);
    expect(text).not.toContain(card.token!);
  });

  test('the real per-client budget stops repeated guessing with 429 after sixty answers', async () => {
    switchOn();
    vi.stubEnv('VERCEL', '1');
    services({ delivery: new DeliveryService(world.f.runtime, world.f.mission, cardSecret) });
    const { headers } = clientHeaders();
    const token = newToken();
    const answers: number[] = [];
    for (let i = 0; i < 63; i++) answers.push((await open({ token }, headers)).status);
    expect(answers.filter((status) => status === 200)).toHaveLength(60);
    expect(answers.slice(60)).toEqual([429, 429, 429]);
  });

  test('refuses a foreign origin, a non-JSON body and an oversized body without touching the database', async () => {
    switchOn();
    const read = vi.fn(async () => ({ state: 'unknown' }));
    services({ decisionCardReader: { read } });
    expect(
      (await open({ token: newToken() }, { Origin: 'https://elsewhere.invalid' })).status,
    ).toBe(403);
    expect((await open({ token: newToken() }, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await open({ token: newToken(), padding: 'x'.repeat(5000) })).status).toBe(413);
    expect(read).not.toHaveBeenCalled();
  });

  test('logs nothing that holds a token, its hash or the body', async () => {
    switchOn();
    services();
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    const card = await share();
    await open({ token: card.token });
    await open({ token: newToken() });
    await open(undefined, {}, '{nope');
    publicRoute.GET();
    const lines = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(lines).not.toContain(card.token!);
    expect(lines).not.toContain(sha256(card.token!));
  });

  test('an unexpected database failure is a 503 with no detail, logged once with the code only', async () => {
    switchOn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    services({
      decisionCardReader: {
        read: async () => {
          throw Object.assign(new Error('secret detail'), { code: 'XX000' });
        },
      },
    });
    const response = await open({ token: newToken() });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secret detail');
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain('XX000');
    expect(String(log.mock.calls[0]![0])).not.toContain('secret detail');
  });
});

describe('the owner limiter (review fix 1)', () => {
  const victimHeader = () => ({ 'x-corridra-customer-subject': cardSession('alice').subject });

  test('a forged or missing subject header from a signed-out caller touches no limiter row', async () => {
    switchOn();
    vi.stubEnv('VERCEL', '1');
    services({ delivery: realDelivery(), customerDecisionCards: signedOut() });
    const { headers } = clientHeaders();
    const p = { digest: '0'.repeat(64), expiresAt: new Date(Date.now() + 3600000).toISOString() };
    const before = await limiterRows();
    const subjects: Record<string, string | null>[] = [
      victimHeader(),
      { 'x-corridra-customer-subject': null },
      {},
    ];
    for (const subject of subjects) {
      const created = await owner(createBody(p), { ...subject, ...headers });
      const withdrawn = await owner(
        { action: 'withdraw', commandId: randomUUID(), cardId: randomUUID() },
        { ...subject, ...headers },
      );
      expect(created.status).toBe(401);
      expect(withdrawn.status).toBe(401);
    }
    expect(await limiterRows()).toEqual(before);
  });

  test('a signed-in caller whose header names someone else is refused before any limiter row is touched', async () => {
    switchOn();
    vi.stubEnv('VERCEL', '1');
    services({ delivery: realDelivery() });
    const { headers } = clientHeaders();
    const p = await preview();
    const before = await limiterRows();
    account.who = 'bob';
    const response = await owner(createBody(p), { ...victimHeader(), ...headers });
    expect(response.status).toBe(403);
    expect(await limiterRows()).toEqual(before);
  });

  test('a signed-out forged flood cannot lock the victim out of creating or withdrawing', async () => {
    switchOn();
    vi.stubEnv('VERCEL', '1');
    const { headers } = clientHeaders();
    const p = await preview();
    services({ delivery: realDelivery(), customerDecisionCards: signedOut() });
    for (let i = 0; i < 70; i++)
      expect((await owner(createBody(p), { ...victimHeader(), ...headers })).status).toBe(401);
    services({ delivery: realDelivery(), customerDecisionCards: signedIn('alice') });
    const made = await owner(createBody(p), headers);
    expect(made.status).toBe(200);
    const card = (await made.json()) as Made;
    const withdrawn = await owner(
      { action: 'withdraw', commandId: randomUUID(), cardId: card.cardId },
      headers,
    );
    expect(withdrawn.status).toBe(200);
  });

  test('create is limited per verified customer: sixty exact retries pass and the next is 429', async () => {
    switchOn();
    vi.stubEnv('VERCEL', '1');
    services({ delivery: realDelivery() });
    const { headers } = clientHeaders();
    const body = createBody(await preview());
    const answers: number[] = [];
    for (let i = 0; i < 62; i++) answers.push((await owner(body, headers)).status);
    expect(answers.filter((status) => status === 200)).toHaveLength(60);
    expect(answers.slice(60)).toEqual([429, 429]);
    // Retries made one card, not sixty.
    expect(
      await count(
        `SELECT count(*)::int n FROM customer_private.decision_card WHERE command_id='${body.commandId}'`,
      ),
    ).toBe(1);
  });

  test('the allowance is the verified customer, kept apart from every other customer, under the owner prefix', async () => {
    switchOn();
    const calls: string[][] = [];
    const budget = vi.fn(async (client: string, key: string) => {
      calls.push([client, key]);
      if (key.includes(cardSession('alice').subject))
        throw new DomainError('Too many requests. Try again in an hour.', 429);
    });
    services({ delivery: { budget } });
    const p = await preview();
    const alice = await owner(createBody(p));
    expect(alice.status).toBe(429);
    account.who = 'bob';
    const bob = await owner(
      createBody(p, { resourceId: world.memberResource, decisionId: world.main.decisionId }),
    );
    // Bob was not held back by Alice's exhausted allowance: he reached the service and was refused there.
    expect(bob.status).toBe(403);
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toMatch(/^decision-card-owner:/);
    expect(calls[0]![1]).toContain(cardIssuer);
    expect(calls[0]![1]).toContain(cardSession('alice').subject);
    expect(calls[1]![1]).toContain(cardSession('bob').subject);
    expect(calls[1]![1]).not.toBe(calls[0]![1]);
  });

  test('withdraw is never limited, however much create traffic has used the allowance', async () => {
    switchOn();
    services();
    const card = await share();
    const budget = vi.fn(async () => {
      throw new DomainError('Too many requests. Try again in an hour.', 429);
    });
    services({ delivery: { budget } });
    expect((await owner(createBody(await preview()))).status).toBe(429);
    const withdrawn = await owner({
      action: 'withdraw',
      commandId: randomUUID(),
      cardId: card.cardId,
    });
    expect(withdrawn.status).toBe(200);
    expect(budget).toHaveBeenCalledTimes(1);
  });

  test('the limiter is spent only once the session is verified and not for a refused create', async () => {
    switchOn();
    const budget = vi.fn(async () => {});
    services({ delivery: { budget }, customerDecisionCards: signedOut() });
    expect(
      (await owner(createBody({ digest: '0'.repeat(64), expiresAt: new Date().toISOString() })))
        .status,
    ).toBe(401);
    expect(budget).not.toHaveBeenCalled();
  });
});

describe('the public limiter keys (review fixes 2 and 3)', () => {
  test('uses the public prefix, and a malformed request is keyed to its own client, never to a global key', async () => {
    switchOn();
    const calls: string[][] = [];
    services({
      delivery: { budget: async (client: string, key: string) => void calls.push([client, key]) },
    });
    const token = newToken();
    await open({ token });
    await open(undefined, {}, '{nope');
    expect(calls[0]).toEqual(['decision-card-public:local', sha256(token)]);
    expect(calls[1]![0]).toBe('decision-card-public:local');
    expect(calls[1]![1]).toContain('local');
    expect(calls[1]![1]).not.toBe('decision-card-malformed');
  });

  test('recipients opening links cannot use up the owner allowance of the same address', async () => {
    switchOn();
    vi.stubEnv('VERCEL', '1');
    services({ delivery: realDelivery() });
    const { headers } = clientHeaders();
    const answers: number[] = [];
    for (let i = 0; i < 62; i++) answers.push((await open({ token: newToken() }, headers)).status);
    expect(answers.filter((status) => status === 200)).toHaveLength(60);
    expect(answers.slice(60)).toEqual([429, 429]);
    // The owner, from the same address, is unaffected.
    expect(
      (await owner({ action: 'state', resourceId: world.main.resourceId }, headers)).status,
    ).toBe(200);
    expect((await owner(createBody(await preview()), headers)).status).toBe(200);
  });

  test('the owner using up an address does not stop a recipient behind the same address', async () => {
    switchOn();
    services();
    const { headers } = clientHeaders();
    const card = await share();
    vi.stubEnv('VERCEL', '1');
    services({ delivery: realDelivery() });
    const body = createBody(await preview());
    for (let i = 0; i < 62; i++) await owner(body, headers);
    expect((await owner(body, headers)).status).toBe(429);
    expect((await (await open({ token: card.token }, headers)).json()).state).toBe('OPEN');
  });

  test('sixty malformed requests from one client end in 429 for that client only', async () => {
    switchOn();
    vi.stubEnv('VERCEL', '1');
    services({ delivery: realDelivery() });
    const noisy = clientHeaders();
    const quiet = clientHeaders();
    const answers: number[] = [];
    for (let i = 0; i < 62; i++)
      answers.push((await open(undefined, noisy.headers, '{nope')).status);
    expect(answers.filter((status) => status === 200)).toHaveLength(60);
    expect(answers.slice(60)).toEqual([429, 429]);
    const other = await open(undefined, quiet.headers, '{nope');
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ state: 'unknown' });
    const card = await share();
    expect((await (await open({ token: card.token }, quiet.headers)).json()).state).toBe('OPEN');
  });
});

describe('transport checks come first, so the switch cannot be told from outside (review fix 4)', () => {
  const nonConforming = async () => {
    const good = JSON.stringify({ token: newToken() });
    return [
      await wire(await open(undefined, { Origin: 'https://elsewhere.invalid' }, good)),
      await wire(await open(undefined, { 'Content-Type': 'text/plain' }, good)),
      await wire(await open(undefined, {}, ' '.repeat(513))),
    ];
  };

  test('a request that is not well formed gets the same answer with the switch on or off', async () => {
    switchOn();
    services();
    const on = await nonConforming();
    expect(on.map((answer) => JSON.parse(answer).status)).toEqual([403, 415, 413]);
    vi.stubEnv('CORRIDRA_SHARE_CARD', '');
    expect(await nonConforming()).toEqual(on);
    vi.stubEnv('CORRIDRA_SHARE_CARD', 'TRUE');
    expect(await nonConforming()).toEqual(on);
  });

  test('a well formed request with the switch off still gets the one unknown answer', async () => {
    switchOn();
    services();
    const baseline = await wire(await open({ token: newToken() }));
    vi.stubEnv('CORRIDRA_SHARE_CARD', '');
    expect(await wire(await open({ token: newToken() }))).toBe(baseline);
    expect(JSON.parse(baseline)).toMatchObject({ status: 200 });
  });

  test('switching the card off spends no limiter row for a request the transport checks refuse', async () => {
    switchOn();
    vi.stubEnv('VERCEL', '1');
    services({ delivery: realDelivery() });
    const before = await limiterRows();
    await open(
      undefined,
      { Origin: 'https://elsewhere.invalid', ...clientHeaders().headers },
      '{}',
    );
    expect(await limiterRows()).toEqual(before);
  });
});

describe('the public route at its edges (review fix 6)', () => {
  test('a body of exactly 512 bytes is read and one byte more is refused with 413', async () => {
    switchOn();
    services();
    const card = await share();
    const padded = (size: number) => {
      const json = JSON.stringify({ token: card.token });
      return json + ' '.repeat(size - Buffer.byteLength(json));
    };
    const exact = await open(undefined, {}, padded(512));
    expect(exact.status).toBe(200);
    expect((await exact.json()).state).toBe('OPEN');
    const over = await open(undefined, {}, padded(513));
    expect(over.status).toBe(413);
  });

  test('a token in the query string or in a header is ignored, and nothing is counted', async () => {
    switchOn();
    services();
    const baseline = await wire(await open({ token: newToken() }));
    const card = await share();
    const before = await opens(card.cardId);
    const sneaky = await publicRoute.POST(
      new Request(`${origin}/api/decision-card?token=${card.token}&t=${card.token}`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'x-token': card.token!,
          Authorization: `Bearer ${card.token}`,
        },
        body: '{}',
      }),
    );
    expect(await wire(sneaky)).toBe(baseline);
    expect(await opens(card.cardId)).toBe(before);
  });

  test('a POST with no body is the same unknown answer', async () => {
    switchOn();
    services();
    const baseline = await wire(await open({ token: newToken() }));
    const bodyless = await publicRoute.POST(
      new Request(origin + '/api/decision-card', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
      }),
    );
    expect(await wire(bodyless)).toBe(baseline);
  });

  test('answers no method but POST, GET and HEAD itself: OPTIONS, PUT, PATCH and DELETE are left to the framework', () => {
    expect(Object.keys(publicRoute).sort()).toEqual(['GET', 'HEAD', 'POST', 'dynamic', 'runtime']);
  });
});

describe('every authority edge ends the card at the route, in the one unknown answer (review fix 6)', () => {
  async function dies(
    s: Awaited<ReturnType<CardWorld['spare']>>,
    kill: () => Promise<unknown>,
    who = 'alice',
    restore?: () => Promise<unknown>,
  ) {
    account.who = who;
    switchOn();
    services();
    const baseline = await wire(await open({ token: newToken() }));
    const card = await share(s);
    expect((await (await open({ token: card.token })).json()).state).toBe('OPEN');
    const before = await opens(card.cardId);
    await kill();
    try {
      expect(await wire(await open({ token: card.token }))).toBe(baseline);
      expect(await opens(card.cardId)).toBe(before);
    } finally {
      if (restore) await restore();
    }
    if (restore) expect((await (await open({ token: card.token })).json()).state).toBe('OPEN');
  }

  test('a creator demoted from admin to member, and back again when promoted', async () => {
    await world.setBobRole('admin', 'member');
    try {
      const s = await world.build('bob', world.workspaceId);
      await dies(
        s,
        () => world.setBobRole('member', 'admin'),
        'bob',
        () => world.setBobRole('admin', 'member'),
      );
    } finally {
      await world.setBobRole('member', 'admin');
    }
  });

  test('a real (non-sample) workspace and a real publication tenant', async () => {
    const s = await world.spare();
    const tenant = (id: string, synthetic: boolean) =>
      mutate(world.f.owner, 'app.tenant', 'UPDATE app.tenant SET synthetic=$2 WHERE id=$1', [
        id,
        synthetic,
      ]);
    await dies(
      s,
      () => tenant(world.workspaceId, false),
      'alice',
      () => tenant(world.workspaceId, true),
    );
    await dies(
      s,
      () => tenant(world.f.tenantA, false),
      'alice',
      () => tenant(world.f.tenantA, true),
    );
  });

  test('a source past its retention end', async () => {
    const s = await world.spare();
    await dies(s, () =>
      mutate(
        world.f.owner,
        'app.source_record',
        "UPDATE app.source_record SET observed_at=now()-interval '2 days',retention_until=now()-interval '1 minute' WHERE id=$1",
        [s.sourceId],
      ),
    );
  });

  test('a revoked delivery link and a revoked publication', async () => {
    const link = await world.spare();
    await dies(link, () =>
      world.delivery.revoke(world.f.users.owner.ctx, {
        commandId: randomUUID(),
        linkId: link.link.id,
        publicationId: null,
        reason: 'Synthetic revocation',
      }),
    );
    const publication = await world.spare();
    await dies(publication, () =>
      world.delivery.revoke(world.f.users.owner.ctx, {
        commandId: randomUUID(),
        linkId: null,
        publicationId: publication.publicationId,
        reason: 'Synthetic revocation',
      }),
    );
  });

  test('a disabled creator, and the card is open again when they are enabled', async () => {
    const s = await world.spare();
    const setDisabled = (disabled: boolean) =>
      mutate(
        world.f.owner,
        'customer_private.principal',
        `UPDATE customer_private.principal SET disabled_at=${disabled ? 'now()' : 'NULL'} WHERE id=$1`,
        [world.principals.alice],
      );
    await dies(
      s,
      () => setDisabled(true),
      'alice',
      () => setDisabled(false),
    );
  });

  test('another decision of the same disclosure lapsing leaves this card open, by design', async () => {
    switchOn();
    services();
    const s = await world.build('alice', world.workspaceId, { second: true });
    const card = await share(s);
    const before = await opens(card.cardId);
    // A newer disclosure that no longer carries the other decision.
    await s.approve(2, [s.decisionId]);
    const answer = await (await open({ token: card.token })).json();
    expect(answer.state).toBe('OPEN');
    expect(await opens(card.cardId)).toBe(before + 1);
  });
});

describe('database failures that reach the owner route (review fix 6)', () => {
  // A pool whose connections fail one statement with a real PostgreSQL error code, as a deadlock or a lock
  // timeout would, while everything around it (the proof, the transaction, the rollback) runs for real.
  const failing = (code: string) =>
    ({
      query: (...args: Parameters<typeof world.f.runtime.query>) => world.f.runtime.query(...args),
      connect: async () => {
        const client = await world.f.runtime.connect();
        return {
          query: async (text: unknown, ...rest: unknown[]) => {
            if (typeof text === 'string' && text.includes('customer.decision_card_state'))
              throw Object.assign(new Error('could not obtain lock detail'), { code });
            return (client.query as (...args: unknown[]) => Promise<unknown>)(text, ...rest);
          },
          release: () => client.release(),
        };
      },
    }) as never;

  for (const code of ['40P01', '55P03'])
    test(`${code} is a retryable 503 with Retry-After and no database detail`, async () => {
      switchOn();
      services({
        customerDecisionCards: new CustomerDecisionCardService(
          failing(code),
          world.f.auth,
          cardOptions,
          async () => cardSession('alice'),
          cardSecret,
        ),
      });
      const response = await owner({ action: 'state', resourceId: world.main.resourceId });
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('2');
      const text = JSON.stringify(await response.json());
      expect(text).toMatch(/Try again/);
      expect(text).not.toContain('lock detail');
    });
});
