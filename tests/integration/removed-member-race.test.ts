import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildWorld, sha, type Row, type World } from './removed-member-support';
import type { DatabaseClient } from '../../packages/db/src/index';

// Removed members, races (owner decision, 11 Nov 2026: "No, remove access (Recommended)"). Leaving and submitting take the
// same workspace lock, so a request is never created after the revocation has committed. Every other write by a person who
// leaves at the same moment either succeeds before the revocation or is refused after it, never deadlocks, and afterwards the
// item is hidden. A list that started before the revocation committed answers from its own snapshot; the next call sees none.
// Fails on main: there, leaving never hides anything.
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const { removedFileHidden } = await import('./removed-member-hide');
    return names.filter((n) => !removedFileHidden(String(path), String(n)));
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

const racers = Array.from({ length: 6 }, (_, i) => `racer${i}`);
let w: World;
const reason = 'A reason that is long enough to be accepted';
const leaveSql = 'SELECT customer.workspace_member_command($1,$2,$3) AS r';
const leaveArgs = () => [randomUUID(), 'leave', JSON.stringify({ workspaceId: w.W })];

// Runs `first` inside the person's transaction, starts `second` while that transaction is open, proves the second one waited
// on a lock (or says that it did not), then lets the first commit. The answer is what the second one returned or raised.
async function overlap(
  person: string,
  first: (db: DatabaseClient) => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  type Answer = { ok?: unknown; error?: { code?: string; message: string } };
  let racing: Promise<Answer> | undefined;
  let waited = false;
  let settled = false;
  await w.as(person, async (db) => {
    await first(db);
    racing = second().then(
      (ok): Answer => ({ ok }),
      (error: { code?: string; message: string }): Answer => ({ error }),
    );
    void racing.then(() => {
      settled = true;
    });
    for (let attempt = 0; attempt < 40 && !waited && !settled; attempt++) {
      const waiting = await w.f.owner.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND datname=current_database()",
      );
      waited = waiting.rows[0].n > 0;
      if (!waited) await new Promise((done) => setTimeout(done, 100));
    }
  });
  return { waited, answer: await racing! };
}
const rowsAfterRevocation = async (person: string) =>
  (
    await w.f.owner.query(
      `SELECT count(*)::int AS n FROM customer_private.owned_request r
       JOIN customer_private.workspace_member m ON m.principal_id=r.principal_id AND m.tenant_id=r.workspace_id
       JOIN customer_private.workspace_access_revocation v ON v.member_id=m.id
       WHERE r.principal_id=$1 AND r.workspace_id=$2 AND r.created_at>v.created_at`,
      [w.principals[person], w.W],
    )
  ).rows[0].n as number;

beforeAll(async () => {
  w = await buildWorld({ requestsPerPerson: 1, extraPeople: racers });
  for (const person of racers) await w.join('olive', person, w.W);
}, 900000);
afterAll(async () => {
  await w?.f.close();
});

describe('leaving and submitting', () => {
  test('CONTROL (the old behaviour, holds on main too): a leave that commits first makes the waiting submit fail with the workspace text, and nothing is created', async () => {
    const person = 'racer0';
    const input = w.submitInput(w.W);
    const result = await overlap(
      person,
      async (db) => {
        await db.query(leaveSql, leaveArgs());
      },
      () => w.requestService(person).submit(input, w.prepare),
    );
    expect(result.waited).toBe(true);
    expect(result.answer.error?.message).toBe('Workspace access denied');
    expect(
      (
        await w.f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.owned_request WHERE command_id=$1',
          [input.commandId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(await rowsAfterRevocation(person)).toBe(0);
  });

  test('a submit that holds the workspace lock first is committed before the leave, and the leave then hides it', async () => {
    const person = 'racer1';
    const key = (
      await w.f.owner.query(
        "SELECT hashtextextended('customer.access.workspace:'||$1::text,0) AS k",
        [w.W],
      )
    ).rows[0].k as string;
    const gate = await w.f.owner.connect();
    let submit: Promise<unknown> | undefined;
    let leave: Promise<unknown> | undefined;
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT pg_advisory_xact_lock($1::bigint)', [key]);
      submit = w.requestService(person).submit(w.submitInput(w.W), w.prepare);
      submit.catch(() => undefined);
      const waiting = async (n: number) => {
        for (let i = 0; i < 60; i++) {
          const r = await w.f.owner.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND datname=current_database()",
          );
          if (r.rows[0].n >= n) return true;
          await new Promise((done) => setTimeout(done, 100));
        }
        return false;
      };
      expect(await waiting(1)).toBe(true);
      leave = w.row(person, leaveSql, leaveArgs());
      leave.catch(() => undefined);
      expect(await waiting(2)).toBe(true);
    } finally {
      await gate.query('COMMIT');
      gate.release();
    }
    const [made, left] = await Promise.allSettled([submit!, leave!]);
    expect(left.status).toBe('fulfilled');
    // Either order is valid, but never a request created after the revocation committed.
    if (made.status === 'rejected')
      expect((made.reason as { message: string }).message).toBe('Workspace access denied');
    expect(await rowsAfterRevocation(person)).toBe(0);
    expect((await w.listRequests(person)).ids).toEqual([]);
  });
});

describe('leaving while writing', () => {
  test.each(Array.from({ length: 25 }, (_, i) => i))(
    'interleaving %i: the write succeeds before the revocation or is refused after it, nothing deadlocks, and the item ends hidden',
    async (i) => {
      const person = 'racer2';
      const request = await w.submit(person, w.W);
      const op = i % 5;
      let linkToken: string | undefined;
      if (op === 4) {
        const made = await w.publish(request);
        await w.assign(request, made.link.id);
        linkToken = made.link.token;
      }
      const run = async () => {
        if (op === 0)
          return w.row(person, 'SELECT customer.withdraw_request($1,$2,$3) AS r', [
            request,
            randomUUID(),
            reason,
          ]);
        if (op === 1)
          return w.row(person, 'SELECT customer.restore_request($1,$2) AS r', [
            request,
            randomUUID(),
          ]);
        if (op === 2)
          return w.row(person, 'SELECT customer.set_mission_mail_mute($1,$2,true) AS r', [
            request,
            randomUUID(),
          ]);
        if (op === 3)
          return w.row(person, 'SELECT customer.set_notification_mute($1,$2,true) AS r', [
            request,
            randomUUID(),
          ]);
        return w.row(person, 'SELECT customer.save_mission_invitation($1,$2) AS r', [
          randomUUID(),
          sha(linkToken!),
        ]);
      };
      const delay = (i % 5) * 6;
      const [leaving, writing] = await Promise.allSettled([
        w.row(person, leaveSql, leaveArgs()),
        new Promise((done) => setTimeout(done, delay)).then(run),
      ]);
      expect(leaving.status).toBe('fulfilled');
      if (writing.status === 'rejected') {
        const error = writing.reason as { code?: string; message: string };
        // Never a deadlock or a serialisation failure: only the refusal a removed person gets.
        expect(['42501'], `${error.code} ${error.message}`).toContain(error.code);
        expect(error.message).toMatch(/^(Request is not available|Link unavailable or expired)$/);
      }
      // Afterwards the request is hidden whichever happened first.
      const detail = await w.attempt(person, 'SELECT customer.private_request_detail($1) AS r', [
        request,
      ]);
      expect(detail.ok).toBe(false);
      expect((await w.listRequests(person)).ids).not.toContain(request);
      if (op === 4) expect(await w.savedIds(person)).toEqual([]);
      // The person is let back in for the next round.
      await w.join('olive', person, w.W);
    },
    120000,
  );
});

describe('a revocation against a list', () => {
  test('a list that started before the revocation committed answers from its own snapshot, and the next call sees none', async () => {
    const person = 'racer3';
    const request = await w.submit(person, w.W);
    const member = (
      await w.f.owner.query(
        `SELECT m.id FROM customer_private.workspace_member m WHERE m.principal_id=$1 AND m.tenant_id=$2
         AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id)`,
        [w.principals[person], w.W],
      )
    ).rows[0].id as string;
    let during: string[] = [];
    await w.as('olive', async (db) => {
      await db.query('SELECT customer.workspace_access_command($1,$2,$3) AS r', [
        randomUUID(),
        'revoke',
        JSON.stringify({ workspaceId: w.W, kind: 'membership', targetId: member }),
      ]);
      // The revocation is not committed yet: the list is answered from what is committed.
      during = (await w.listRequests(person)).ids;
    });
    expect(during).toContain(request);
    expect((await w.listRequests(person)).ids).not.toContain(request);
    expect(
      (await w.attempt(person, 'SELECT customer.private_request_detail($1) AS r', [request])).ok,
    ).toBe(false);
  });

  test('a list, a detail and a move list taken after the revocation all agree', async () => {
    const person = 'racer4';
    const request = await w.submit(person, w.W);
    await w.leave(person, w.W);
    const detail = await w.attempt(person, 'SELECT customer.private_request_detail($1) AS r', [
      request,
    ]);
    const moves = (await w.row(person, 'SELECT customer.private_request_moves(NULL,25) AS r'))
      .r as Row;
    expect(detail.ok).toBe(false);
    expect((await w.listRequests(person)).ids).toEqual([]);
    expect((moves.requests as unknown[]).length).toBe(0);
  });
});
