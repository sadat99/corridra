import { createHash, randomBytes, randomUUID } from 'node:crypto';
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

const owner = (
  body: unknown,
  headers: Record<string, string> = {},
  raw = typeof body === 'string' ? body : JSON.stringify(body),
) =>
  ownerRoute.POST(
    new Request(origin + '/api/customer-decision-cards', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'x-corridra-customer-subject': cardSession(account.who).subject,
        'x-corridra-customer-issuer': cardIssuer,
        ...headers,
      },
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

  test('spends the limiter before it calls the service on create and withdraw, keyed to the customer', async () => {
    switchOn();
    const budget = vi.fn<(client: string, key: string) => Promise<void>>(async () => {
      throw new DomainError('Too many requests. Try again in an hour.', 429);
    });
    const create = vi.fn();
    const withdraw = vi.fn();
    services({ delivery: { budget }, customerDecisionCards: { create, withdraw } });
    const created = await owner(
      createBody({ digest: '0'.repeat(64), expiresAt: new Date().toISOString() }),
    );
    const withdrawn = await owner({
      action: 'withdraw',
      commandId: randomUUID(),
      cardId: randomUUID(),
    });
    expect(created.status).toBe(429);
    expect(withdrawn.status).toBe(429);
    expect(budget).toHaveBeenCalledTimes(2);
    expect(String(budget.mock.calls[0]![1])).toContain(cardSession('alice').subject);
    expect(create).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
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
    const headers = {
      'x-vercel-forwarded-for': `203.0.113.${Math.floor(Math.random() * 250)}, 10.0.0.1`,
    };
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
