import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';
import { Pool } from '../../packages/db/src/index';
import { connection, sandbox } from './support';
import {
  CustomerDecisionCardService,
  cardToken,
} from '../../packages/auth/src/customer-decision-cards';
import {
  cardOptions,
  cardSecret,
  cardSession,
  cardWorld,
  mutate,
  retireCards,
  type CardWorld,
} from './decision-card-world';

// ADR-076 item 4 through the service, against the real database as the restricted runtime role. The database
// module itself is proved in customer-decision-cards.test.ts; these cases prove what the service adds: the link
// secret is derived and never stored, the link is shown only for an active card, the same command gives the
// same link, and every database answer becomes the right plain refusal.
let world: CardWorld;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const service = (who: string, signedIn = true, secret = cardSecret) =>
  new CustomerDecisionCardService(
    world.f.runtime,
    world.f.auth,
    cardOptions,
    async () => (signedIn ? cardSession(who) : null),
    secret,
  );
const one = async (sql: string, args: unknown[] = []) =>
  (await world.f.owner.query(sql, args)).rows[0];
const createInput = (
  p: { digest: string; expiresAt: string },
  s: { resourceId: string; decisionId: string },
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
const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('Expected a refusal');
};

beforeAll(async () => {
  world = await cardWorld();
}, 240000);
afterAll(async () => {
  await world?.f.close();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await retireCards(world.f.owner, world.main.resourceId);
});

describe('state and preview', () => {
  test('the owner can share, sees the limit of five and no cards yet', async () => {
    const state = await service('alice').state(world.main.resourceId);
    expect(state).toMatchObject({
      resourceId: world.main.resourceId,
      canShare: true,
      maxActive: 5,
    });
    expect(state.cards).toEqual([]);
  });

  test('a plain member who holds the same report cannot share and sees no cards', async () => {
    const state = await service('bob').state(world.memberResource);
    expect(state).toMatchObject({ canShare: false, cards: [] });
  });

  test('the preview is exactly the six fields, a digest and the expiry, and writes nothing', async () => {
    const before = Number((await one('SELECT count(*) n FROM customer_private.decision_card')).n);
    const p = await service('alice').preview(world.main.resourceId, world.main.decisionId);
    expect(Object.keys(p).sort()).toEqual(
      ['decisionId', 'digest', 'expiresAt', 'fields', 'maxActive', 'resourceId'].sort(),
    );
    expect(Object.keys(p.fields).sort()).toEqual(
      ['company', 'decision', 'dueAt', 'nextAction', 'provenance', 'rationale'].sort(),
    );
    expect(Object.keys(p.fields.provenance).sort()).toEqual(['claimStatus', 'sourceKind']);
    expect(p.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(p)).not.toContain('MARKER-');
    expect(Number((await one('SELECT count(*) n FROM customer_private.decision_card')).n)).toBe(
      before,
    );
  });

  test("a decision that was not reviewed for this report, or a report that is not the caller's, is the one refusal", async () => {
    const wrongDecision = await refusal(
      service('alice').preview(world.main.resourceId, randomUUID()),
    );
    const wrongReport = await refusal(
      service('alice').preview(randomUUID(), world.main.decisionId),
    );
    const plainMember = await refusal(
      service('bob').preview(world.memberResource, world.main.decisionId),
    );
    for (const error of [wrongDecision, wrongReport, plainMember]) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({ status: 403, message: 'Access denied or link unavailable' });
    }
  });

  test('a malformed id is a validation error before the database is touched', async () => {
    await expect(service('alice').state('not-a-uuid')).rejects.toThrow();
    await expect(service('alice').preview(world.main.resourceId, 'x')).rejects.toThrow();
  });
});

describe('creating a card', () => {
  test('returns the derived link secret for an active card; the database holds only its SHA-256', async () => {
    const s = world.main;
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const input = createInput(p, s);
    const card = await service('alice').create(input);
    expect(card.state).toBe('ACTIVE');
    const expected = cardToken(
      cardSecret,
      cardOptions.issuer,
      cardSession('alice').subject,
      input.commandId,
    );
    expect(card.token).toBe(expected);
    expect(card.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await one('SELECT * FROM customer_private.decision_card WHERE id=$1', [
      card.cardId,
    ]);
    expect(row.token_hash).toBe(sha256(card.token!));
    expect(row.field_digest).toBe(p.digest);
    expect(row.principal_id).toBe(world.principals.alice);
  });

  test('the plaintext secret appears in no row, event, outbox entry or log line', async () => {
    const log = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
    ];
    const s = world.main;
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const card = await service('alice').create(createInput(p, s));
    await service('alice').state(s.resourceId);
    await service('alice').withdraw({
      action: 'withdraw',
      commandId: randomUUID(),
      cardId: card.cardId,
    });
    const token = card.token!;
    const dump = JSON.stringify(
      (
        await world.f.owner.query(
          `SELECT 'card' k, to_jsonb(c) v FROM customer_private.decision_card c
           UNION ALL SELECT 'withdrawal', to_jsonb(w) FROM customer_private.decision_card_withdrawal w
           UNION ALL SELECT 'open', to_jsonb(o) FROM customer_private.decision_card_open o
           UNION ALL SELECT 'event', to_jsonb(e) FROM app.domain_event e WHERE e.type LIKE 'customer.decision_card.%'
           UNION ALL SELECT 'outbox', to_jsonb(b) FROM app.outbox b
           UNION ALL SELECT 'audit', to_jsonb(a) FROM app.audit_event a
           UNION ALL SELECT 'command', to_jsonb(m) FROM customer_private.saved_mission_command m`,
        )
      ).rows,
    );
    expect(dump).not.toContain(token);
    expect(JSON.stringify(log.flatMap((spy) => spy.mock.calls))).not.toContain(token);
    expect(dump).toContain(sha256(token));
  });

  test('an exact retry returns the same card and the same link', async () => {
    const s = world.main;
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const input = createInput(p, s);
    const first = await service('alice').create(input);
    const again = await service('alice').create(input);
    expect(again).toEqual(first);
    expect(again.token).toBe(first.token);
    expect(
      Number(
        (
          await one('SELECT count(*) n FROM customer_private.decision_card WHERE command_id=$1', [
            input.commandId,
          ])
        ).n,
      ),
    ).toBe(1);
  });

  test('a retry after the card was withdrawn returns the card as withdrawn and no link', async () => {
    const s = world.main;
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const input = createInput(p, s);
    const first = await service('alice').create(input);
    expect(first.token).toBeDefined();
    await service('alice').withdraw({
      action: 'withdraw',
      commandId: randomUUID(),
      cardId: first.cardId,
    });
    const again = await service('alice').create(input);
    expect(again).toMatchObject({ cardId: first.cardId, state: 'WITHDRAWN' });
    expect('token' in again).toBe(false);
  });

  test('a retry while the card is unavailable returns no link', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const input = createInput(p, s);
    const first = await service('alice').create(input);
    expect(first.state).toBe('ACTIVE');
    const old = (
      await one('SELECT next_action FROM app.mission_selection WHERE id=$1', [s.decisionId])
    ).next_action;
    await mutate(
      world.f.owner,
      'app.mission_selection',
      "UPDATE app.mission_selection SET next_action='Changed after the preview' WHERE id=$1",
      [s.decisionId],
    );
    try {
      const again = await service('alice').create(input);
      expect(again).toMatchObject({ cardId: first.cardId, state: 'UNAVAILABLE' });
      expect('token' in again).toBe(false);
    } finally {
      await mutate(
        world.f.owner,
        'app.mission_selection',
        'UPDATE app.mission_selection SET next_action=$2 WHERE id=$1',
        [s.decisionId, old],
      );
    }
  });

  test('the card gets exactly the expiry the preview showed, to the microsecond', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const card = await service('alice').create(createInput(p, s));
    const stored = await one(
      'SELECT customer_private.decision_card_iso(expires_at) AS expires FROM customer_private.decision_card WHERE id=$1',
      [card.cardId],
    );
    expect(stored.expires).toBe(p.expiresAt);
    expect(card.expiresAt).toBe(p.expiresAt);
  });

  test('an expiry later than the preview allowed is refused as changed', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const later = new Date(Date.parse(p.expiresAt) + 3600000).toISOString();
    const error = await refusal(service('alice').create(createInput(p, s, { expiresAt: later })));
    expect(error).toMatchObject({ status: 409, code: 'CHANGED' });
  });

  test('a stale digest is 409 CHANGED and creates nothing', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const error = await refusal(
      service('alice').create(createInput(p, s, { digest: '0'.repeat(64) })),
    );
    expect(error).toMatchObject({ status: 409, code: 'CHANGED' });
    expect(
      Number(
        (
          await one(
            'SELECT count(*) n FROM customer_private.decision_card WHERE saved_mission_id=$1',
            [s.resourceId],
          )
        ).n,
      ),
    ).toBe(0);
  });

  test('the same command used for a different digest is 409 CHANGED', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const input = createInput(p, s);
    await service('alice').create(input);
    const error = await refusal(service('alice').create({ ...input, digest: '1'.repeat(64) }));
    expect(error).toMatchObject({ status: 409, code: 'CHANGED' });
  });

  test('the sixth live card for one report is 409 CAP_REACHED, and a withdrawal makes room', async () => {
    const s = await world.spare();
    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = await service('alice').preview(s.resourceId, s.decisionId);
      made.push((await service('alice').create(createInput(p, s))).cardId);
    }
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const error = await refusal(service('alice').create(createInput(p, s)));
    expect(error).toMatchObject({ status: 409, code: 'CAP_REACHED' });
    await service('alice').withdraw({
      action: 'withdraw',
      commandId: randomUUID(),
      cardId: made[0]!,
    });
    const room = await service('alice').create(createInput(p, s));
    expect(room.state).toBe('ACTIVE');
  });

  test('the 31st new card in an hour is 429 in plain words', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    await world.f.owner.query(
      `WITH made AS (
         INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,created_at,expires_at)
         SELECT $1,gen_random_uuid(),$2,$3,$4,$5,encode(sha256(gen_random_uuid()::text::bytea),'hex'),now()-interval '10 minutes',now()-interval '5 minutes'
         FROM generate_series(1,30) RETURNING id)
       SELECT count(*) FROM made`,
      [world.principals.alice, s.resourceId, world.workspaceId, s.decisionId, p.digest],
    );
    const error = await refusal(service('alice').create(createInput(p, s)));
    expect(error).toMatchObject({ status: 429 });
    expect(error.message).toMatch(/Try again/);
  });

  test('a plain member, a stranger and an unknown report all get the same 403', async () => {
    const p = await service('alice').preview(world.main.resourceId, world.main.decisionId);
    const attempts = [
      service('bob').create(
        createInput(p, { resourceId: world.memberResource, decisionId: world.main.decisionId }),
      ),
      service('alice').create(
        createInput(p, { resourceId: randomUUID(), decisionId: world.main.decisionId }),
      ),
      service('alice').create(
        createInput(p, { resourceId: world.main.resourceId, decisionId: randomUUID() }),
      ),
    ];
    const errors = await Promise.all(attempts.map(refusal));
    for (const error of errors)
      expect(error).toMatchObject({ status: 403, message: 'Access denied or link unavailable' });
  });

  test('a saved report that was removed is refused as access lost', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    await mutate(
      world.f.owner,
      'customer_private.saved_mission',
      'UPDATE customer_private.saved_mission SET removed_at=now() WHERE id=$1',
      [s.resourceId],
    );
    const error = await refusal(service('alice').create(createInput(p, s)));
    expect(error).toMatchObject({ status: 403 });
  });

  test('input outside the agreed shape is refused before the database', async () => {
    const s = world.main;
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const good = createInput(p, s);
    for (const bad of [
      { ...good, acknowledged: false },
      { ...good, acknowledged: undefined },
      { ...good, digest: 'xyz' },
      { ...good, expiresAt: 'tomorrow' },
      { ...good, extra: 1 },
      { ...good, commandId: 'nope' },
      { ...good, action: 'withdraw' },
    ])
      await expect(service('alice').create(bad)).rejects.toThrow();
  });
});

describe('withdrawing a card', () => {
  test('the creator withdraws, a repeat is the same answer, and the public link stops', async () => {
    const s = world.main;
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const card = await service('alice').create(createInput(p, s));
    const command = randomUUID();
    const first = await service('alice').withdraw({
      action: 'withdraw',
      commandId: command,
      cardId: card.cardId,
    });
    const again = await service('alice').withdraw({
      action: 'withdraw',
      commandId: command,
      cardId: card.cardId,
    });
    const other = await service('alice').withdraw({
      action: 'withdraw',
      commandId: randomUUID(),
      cardId: card.cardId,
    });
    expect(first).toEqual({ cardId: card.cardId, state: 'WITHDRAWN' });
    expect(again).toEqual(first);
    expect(other).toEqual(first);
    const listed = (await service('alice').state(s.resourceId)).cards.find(
      (c) => c.id === card.cardId,
    );
    expect(listed?.state).toBe('WITHDRAWN');
  });

  test('another customer cannot withdraw it, and cannot tell it exists', async () => {
    const s = world.main;
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const card = await service('alice').create(createInput(p, s));
    const foreign = await refusal(
      service('bob').withdraw({ action: 'withdraw', commandId: randomUUID(), cardId: card.cardId }),
    );
    const missing = await refusal(
      service('bob').withdraw({
        action: 'withdraw',
        commandId: randomUUID(),
        cardId: randomUUID(),
      }),
    );
    expect(foreign).toMatchObject({ status: 403, message: 'Access denied or link unavailable' });
    expect(missing.message).toBe(foreign.message);
    expect(missing.status).toBe(foreign.status);
  });

  test('one command reused for another card is a validation error (400), not a conflict', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const a = await service('alice').create(createInput(p, s));
    const b = await service('alice').create(createInput(p, s));
    const command = randomUUID();
    await service('alice').withdraw({ action: 'withdraw', commandId: command, cardId: a.cardId });
    const error = await refusal(
      service('alice').withdraw({ action: 'withdraw', commandId: command, cardId: b.cardId }),
    );
    expect(error).toMatchObject({ status: 400 });
  });
});

describe('the session and the installation', () => {
  test('a signed-out caller is 401 in plain words', async () => {
    const error = await refusal(service('alice', false).state(world.main.resourceId));
    expect(error).toMatchObject({ status: 401, message: 'Sign in to continue' });
  });

  test('a browser that still shows another account is refused as the same 403', async () => {
    const error = await refusal(service('alice').state(world.main.resourceId, 'someone-else'));
    expect(error).toMatchObject({ status: 403, message: 'Access denied or link unavailable' });
  });

  test('installed() is true with the five functions and false when one is missing', async () => {
    expect(await service('alice').installed()).toBe(true);
    await world.f.owner.query(
      'ALTER FUNCTION app.read_decision_card(text) RENAME TO read_decision_card_hidden',
    );
    try {
      expect(await service('alice').installed()).toBe(false);
    } finally {
      await world.f.owner.query(
        'ALTER FUNCTION app.read_decision_card_hidden(text) RENAME TO read_decision_card',
      );
    }
    expect(await service('alice').installed()).toBe(true);
  });

  test('a missing database module surfaces as a catalogue error code for the route to map to 503', async () => {
    await world.f.owner.query(
      'ALTER FUNCTION customer.decision_card_state(uuid) RENAME TO decision_card_state_hidden',
    );
    try {
      const error = await refusal(service('alice').state(world.main.resourceId));
      expect(['42883', '42P01', '3F000']).toContain((error as unknown as { code: string }).code);
    } finally {
      await world.f.owner.query(
        'ALTER FUNCTION customer.decision_card_state_hidden(uuid) RENAME TO decision_card_state',
      );
    }
  });
});

describe('the limiter hook of create (review fix 1)', () => {
  test('is called once, with the verified issuer and subject, only after the session is verified', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const limit = vi.fn(async () => {});
    await service('alice').create(createInput(p, s), undefined, undefined, limit);
    expect(limit).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith({
      issuer: cardOptions.issuer,
      subject: cardSession('alice').subject,
    });
    const signedOut = vi.fn(async () => {});
    await refusal(
      service('alice', false).create(createInput(p, s), 'forged', undefined, signedOut),
    );
    await refusal(service('alice').create(createInput(p, s), 'someone-else', undefined, signedOut));
    expect(signedOut).not.toHaveBeenCalled();
  });

  test('a refusal from the hook stops the create and writes nothing', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const error = await refusal(
      service('alice').create(createInput(p, s), undefined, undefined, async () => {
        throw new DomainError('Too many requests. Try again in an hour.', 429);
      }),
    );
    expect(error).toMatchObject({ status: 429 });
    expect(
      Number(
        (
          await one(
            'SELECT count(*) n FROM customer_private.decision_card WHERE saved_mission_id=$1',
            [s.resourceId],
          )
        ).n,
      ),
    ).toBe(0);
  });
});

describe('ids made by the database are accepted whatever their version (review fix 5)', () => {
  test('a card and a decision with ids that are not RFC 4122 are listed and withdrawn, not a server error', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const odd = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const oddDecision = '00000000-0000-0000-0000-000000000001';
    await world.f.owner.query(
      `INSERT INTO customer_private.decision_card(id,principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '1 day')`,
      [
        odd,
        world.principals.alice,
        randomUUID(),
        s.resourceId,
        world.workspaceId,
        oddDecision,
        p.digest,
        sha256(randomUUID()),
      ],
    );
    const state = await service('alice').state(s.resourceId);
    expect(state.cards.map((card) => card.id)).toContain(odd);
    expect(state.cards.find((card) => card.id === odd)?.decisionId).toBe(oddDecision);
    const withdrawn = await service('alice').withdraw({
      action: 'withdraw',
      commandId: randomUUID(),
      cardId: odd,
    });
    expect(withdrawn).toEqual({ cardId: odd, state: 'WITHDRAWN' });
  });
});

describe('the create limiter runs before any pool connection is held', () => {
  // The limiter spends its count through the same runtime pool the request uses (the runtime pool is small, and
  // the real limiter checks out its own connection). A hook that ran while the request already held a connection
  // would wait for another one: with every connection held by a waiting request, nothing could finish.
  const small = (max: number) =>
    new Pool({
      ...connection('corridra_integration', 'corridra_runtime_local', sandbox.runtimePassword),
      max,
      connectionTimeoutMillis: 1500,
    });
  const through = (pool: Pool, who = 'alice') =>
    new CustomerDecisionCardService(
      pool,
      world.f.auth,
      cardOptions,
      async () => cardSession(who),
      cardSecret,
    );

  test('a create whose limiter uses the same one-connection pool succeeds', async () => {
    const pool = small(1);
    try {
      const s = await world.spare();
      const p = await service('alice').preview(s.resourceId, s.decisionId);
      const limit = vi.fn(async () => {
        await pool.query('SELECT 1');
      });
      const card = await through(pool).create(createInput(p, s), undefined, undefined, limit);
      expect(card.state).toBe('ACTIVE');
      expect(limit).toHaveBeenCalledTimes(1);
    } finally {
      await pool.end();
    }
  });

  test('the request holds no connection at all while the limiter runs', async () => {
    const pool = small(2);
    try {
      const s = await world.spare();
      const p = await service('alice').preview(s.resourceId, s.decisionId);
      let held = -1;
      await through(pool).create(createInput(p, s), undefined, undefined, async () => {
        held = pool.totalCount - pool.idleCount;
      });
      expect(held).toBe(0);
    } finally {
      await pool.end();
    }
  });

  test('concurrent creates all succeed when the pool is as small as the number of requests', async () => {
    const pool = small(2);
    try {
      const s = await world.spare();
      const p = await service('alice').preview(s.resourceId, s.decisionId);
      const limit = async () => {
        await pool.query('SELECT 1');
      };
      const cards = await Promise.all(
        [1, 2, 3, 4].map(() =>
          through(pool).create(createInput(p, s), undefined, undefined, limit),
        ),
      );
      expect(cards.map((card) => card.state)).toEqual(['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE']);
    } finally {
      await pool.end();
    }
  });

  test('a refusal from the limiter still stops the create and writes nothing', async () => {
    const pool = small(1);
    try {
      const s = await world.spare();
      const p = await service('alice').preview(s.resourceId, s.decisionId);
      const error = await refusal(
        through(pool).create(createInput(p, s), undefined, undefined, async () => {
          throw new DomainError('Too many requests. Try again in an hour.', 429);
        }),
      );
      expect(error).toMatchObject({ status: 429 });
      expect(
        Number(
          (
            await one(
              'SELECT count(*) n FROM customer_private.decision_card WHERE saved_mission_id=$1',
              [s.resourceId],
            )
          ).n,
        ),
      ).toBe(0);
    } finally {
      await pool.end();
    }
  });

  test('the limiter is not run for a signed-out request, a header that names someone else, or a wrong issuer', async () => {
    const s = await world.spare();
    const p = await service('alice').preview(s.resourceId, s.decisionId);
    const limit = vi.fn(async () => {});
    const signedOut = service('alice', false);
    await refusal(
      signedOut.create(createInput(p, s), cardSession('alice').subject, undefined, limit),
    );
    await refusal(service('alice').create(createInput(p, s), 'someone-else', undefined, limit));
    await refusal(
      service('alice').create(
        createInput(p, s),
        undefined,
        'https://other.example.invalid/auth',
        limit,
      ),
    );
    expect(limit).not.toHaveBeenCalled();
  });
});
