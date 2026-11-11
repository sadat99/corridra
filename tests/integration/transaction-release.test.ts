import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant, type DatabaseClient, type DatabasePool } from '../../packages/db/src/index';
import { TeamControl } from '../../packages/auth/src/team-control';
import { CustomerSessionBoundary } from '../../packages/auth/src/customer-session';

// CRUD G10 follow-up: a transaction that fails is rolled back, and when the ROLLBACK itself fails the connection is
// released with that error, so the pool discards it instead of handing a connection in an unknown state to the next
// request. Either way the caller sees the error that started the rollback. No database: the pools are fakes.

type FakeClient = { statements: string[]; released: unknown[] };

/**
 * A pool whose single client answers BEGIN, settings and the authority check as an owner with a fresh
 * authenticator check, throws `failure` from the first statement that matches `failAt`, and throws
 * `rollbackFailure` from ROLLBACK when one is given.
 */
function fakePool(failAt: RegExp, failure: Error, rollbackFailure?: Error) {
  const client: FakeClient = { statements: [], released: [] };
  const pool: DatabasePool = {
    // Pool-level statements (the restricted-role checks and session proof of the customer boundary) succeed. A
    // restricted, non-owning role answers member true and every other flag false.
    query: (async () => ({
      command: 'SELECT',
      oid: 0,
      fields: [],
      rows: [{ member: true }],
      rowCount: 1,
    })) as DatabasePool['query'],
    end: () => Promise.resolve(),
    connect: async () =>
      ({
        release: (error?: Error | boolean) => {
          client.released.push(error);
        },
        query: (async (sql: string) => {
          client.statements.push(sql);
          if (sql === 'ROLLBACK') {
            if (rollbackFailure) throw rollbackFailure;
            return { rows: [], rowCount: null };
          }
          if (failAt.test(sql)) throw failure;
          if (sql.includes('app.actor_id()'))
            return { rows: [{ actor_id: randomUUID(), role: 'owner', fresh: true }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        }) as DatabaseClient['query'],
      }) as DatabaseClient,
  };
  return { pool, client };
}

const ctx = { token: 'fake-session', tenantId: randomUUID(), purpose: 'operations' };

describe('withTenant', () => {
  test('a failed ROLLBACK still reports the original error and releases the connection with the rollback error', async () => {
    const original = new Error('work failed');
    const rollbackFailure = new Error('rollback failed');
    const { pool, client } = fakePool(/^$/, original, rollbackFailure);
    await expect(
      withTenant(pool, ctx, 'audit.read', async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(client.statements.at(-1)).toBe('ROLLBACK');
    expect(client.released).toEqual([rollbackFailure]);
  });

  test('a successful ROLLBACK reports the original error and returns the connection to the pool', async () => {
    const original = new Error('work failed');
    const { pool, client } = fakePool(/^$/, original);
    await expect(
      withTenant(pool, ctx, 'audit.read', async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(client.statements.at(-1)).toBe('ROLLBACK');
    expect(client.released).toEqual([undefined]);
  });
});

describe('team control auth transaction', () => {
  const failAt = /FROM identity\.verification/;

  test('a failed ROLLBACK still reports the original error and releases the connection with the rollback error', async () => {
    const original = new Error('invitation read failed');
    const rollbackFailure = new Error('rollback failed');
    const runtime = fakePool(/^$/, new Error('not used'));
    const auth = fakePool(failAt, original, rollbackFailure);
    await expect(
      new TeamControl(runtime.pool, auth.pool).resend(ctx, { invitationId: randomUUID() }),
    ).rejects.toBe(original);
    expect(auth.client.statements).toEqual(['BEGIN', expect.stringMatching(failAt), 'ROLLBACK']);
    expect(auth.client.released).toEqual([rollbackFailure]);
    expect(runtime.client.released).toEqual([undefined]);
  });

  test('a successful ROLLBACK reports the original error and returns the connection to the pool', async () => {
    const original = new Error('invitation read failed');
    const runtime = fakePool(/^$/, new Error('not used'));
    const auth = fakePool(failAt, original);
    await expect(
      new TeamControl(runtime.pool, auth.pool).resend(ctx, { invitationId: randomUUID() }),
    ).rejects.toBe(original);
    expect(auth.client.statements).toEqual(['BEGIN', expect.stringMatching(failAt), 'ROLLBACK']);
    expect(auth.client.released).toEqual([undefined]);
  });
});

describe('customer session transaction', () => {
  class Probe extends CustomerSessionBoundary {
    run<T>(work: () => Promise<T>) {
      return this.transaction(work);
    }
  }
  const probe = (runtime: DatabasePool, auth: DatabasePool) =>
    new Probe(
      runtime,
      auth,
      {
        enabled: true,
        synthetic: true,
        production: false,
        issuer: 'https://ep-release-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
      },
      async () => ({
        subject: 'synthetic-release-fixture',
        emailVerified: true,
        expiresAt: new Date(Date.now() + 3600000),
      }),
    );

  test('a failed ROLLBACK still reports the original error and releases the connection with the rollback error', async () => {
    const original = new Error('work failed');
    const rollbackFailure = new Error('rollback failed');
    const runtime = fakePool(/^$/, new Error('not used'), rollbackFailure);
    const auth = fakePool(/^$/, new Error('not used'));
    await expect(
      probe(runtime.pool, auth.pool).run(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(runtime.client.statements.at(-1)).toBe('ROLLBACK');
    expect(runtime.client.released).toEqual([rollbackFailure]);
  });

  test('a successful ROLLBACK reports the original error and returns the connection to the pool', async () => {
    const original = new Error('work failed');
    const runtime = fakePool(/^$/, new Error('not used'));
    const auth = fakePool(/^$/, new Error('not used'));
    await expect(
      probe(runtime.pool, auth.pool).run(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(runtime.client.statements.at(-1)).toBe('ROLLBACK');
    expect(runtime.client.released).toEqual([undefined]);
  });
});
