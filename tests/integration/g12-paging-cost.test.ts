import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant, type DatabaseClient, type DatabasePool } from '../../packages/db/src/index';
import { MeetingService } from '../../packages/missions/src/meetings';
import { decodeCursor, encodeCursor, keysetPage } from '../../packages/domain/src/paging';
import { accessFixture, command, future } from './access-fixture';

// CRUD G12 follow-up: the meeting read policy (app.meeting_parent_access) is costly per row, so a page
// read must not run it over rows a continuation or a mission filter has already excluded, and must not
// run it twice (once for the page and once more for the total). The policy function is SECURITY DEFINER
// with its own search_path, so it is never inlined and the database counts every call.
let f: Awaited<ReturnType<typeof accessFixture>>;
let seedMissionId: string;
let seedMeetingId: string;
const ROWS = 60;
const POLICY_CALLS =
  "SELECT coalesce(sum(calls),0)::int AS n FROM pg_stat_xact_user_functions WHERE schemaname='app' AND funcname='meeting_parent_access'";

/** The server's track_functions before this file, and whether it came from ALTER SYSTEM. */
let previous: { value: string; fromAlterSystem: boolean } | null = null;

/** Sets track_functions (null: back to the value before this file) and waits until backends see it. */
async function setTrackFunctions(value: 'all' | null) {
  if (value) await f.owner.query(`ALTER SYSTEM SET track_functions = '${value}'`);
  else if (previous?.fromAlterSystem)
    await f.owner.query(`ALTER SYSTEM SET track_functions = '${previous.value}'`);
  else await f.owner.query('ALTER SYSTEM RESET track_functions');
  await f.owner.query('SELECT pg_reload_conf()');
  const want = value ?? previous!.value;
  // A reload reaches every backend at its next command; wait until a fresh one reports it.
  for (let i = 0; i < 50; i++) {
    const c = await f.runtime.connect();
    try {
      if ((await c.query('SHOW track_functions')).rows[0].track_functions === want) return;
    } finally {
      c.release();
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('track_functions did not change');
}

beforeAll(async () => {
  f = await accessFixture();
  const i = await f.introduction();
  const m = await f.meetings.command(
    f.ctx,
    command('propose', {
      messageId: i.id,
      title: 'Synthetic paging cost seed',
      brief: 'Seed meeting for the paging cost tests.',
      participants: ['Synthetic Supplier Person', 'Synthetic Buyer Person'],
      ownerId: f.users.operator.id,
      nextAction: 'Send the agreed synthetic follow-up',
      dueAt: future(),
      reason: 'Seed the synthetic paging cost tests',
    }),
  );
  seedMeetingId = m.id;
  seedMissionId = i.missionId;
  const ids = Array.from({ length: ROWS - 1 }, () => randomUUID());
  const seed = await f.owner.connect();
  try {
    // Volume seeding only: the guards need a live access context, which a raw owner connection lacks.
    await seed.query("SET session_replication_role = 'replica'");
    await seed.query(
      `INSERT INTO app.meeting(id,tenant_id,message_id,mission_id,title,owner_id,next_action,due_at,reason,created_by)
       SELECT g.id,m.tenant_id,m.message_id,m.mission_id,'Synthetic paging cost meeting '||g.k,m.owner_id,m.next_action,
              '2031-01-01T00:00:00Z'::timestamptz + (g.k || ' minutes')::interval,m.reason,m.created_by
       FROM app.meeting m, unnest($1::uuid[]) WITH ORDINALITY AS g(id,k) WHERE m.id=$2`,
      [ids, seedMeetingId],
    );
    await seed.query(
      `INSERT INTO app.meeting_brief(tenant_id,meeting_id,body,created_by)
       SELECT m.tenant_id,m.id,'Brief for the paging cost test',m.created_by FROM app.meeting m WHERE m.id=ANY($1::uuid[])`,
      [ids],
    );
  } finally {
    await seed.query('RESET session_replication_role');
    seed.release();
  }
  previous = {
    value: (await f.owner.query('SHOW track_functions')).rows[0].track_functions,
    fromAlterSystem: !!(
      await f.owner.query(
        "SELECT 1 FROM pg_file_settings WHERE name='track_functions' AND sourcefile LIKE '%postgresql.auto.conf' AND applied",
      )
    ).rowCount,
  };
  await setTrackFunctions('all');
});
afterAll(async () => {
  if (f && previous) await setTrackFunctions(null).catch(() => undefined);
  await f?.close();
});

/**
 * The meetings service on a pool that counts the policy calls of each read transaction: the count is
 * taken right after BEGIN and right before COMMIT on the same connection, so it covers the whole read
 * (page, briefs, participants, outcomes, history and follow-ups).
 */
function measuredService() {
  const last = { calls: -1 };
  const pool: DatabasePool = {
    query: f.runtime.query.bind(f.runtime) as DatabasePool['query'],
    end: () => Promise.resolve(),
    async connect() {
      const client = await f.runtime.connect();
      const count = async () => Number((await client.query(POLICY_CALLS)).rows[0]!.n);
      let before = 0;
      return {
        release: (e?: Error | boolean) => client.release(e),
        query: (async (sql: string, values?: unknown[]) => {
          if (sql === 'COMMIT') last.calls = (await count()) - before;
          const result = await client.query(sql, values);
          // Calls not yet reported by earlier transactions on this connection are still listed.
          if (sql === 'BEGIN') before = await count();
          return result;
        }) as DatabaseClient['query'],
      };
    },
  };
  return { service: new MeetingService(pool), last };
}

/** Reads one meetings page through the service and returns it with the policy calls it cost. */
async function measured(options: { after?: string; missionId?: string; limit?: number }) {
  const { service, last } = measuredService();
  const page = (await service.workspace(f.ctx, { limit: 5, ...options })) as unknown as {
    meetings: { id: string }[];
    meetingsTotal: number | null;
    next: string | null;
  };
  return { page, calls: last.calls };
}

test('the first page runs the read policy once per meeting, not again for the total', async () => {
  const { page, calls } = await measured({});
  expect(page.meetingsTotal).toBe(ROWS);
  expect(page.meetings).toHaveLength(5);
  // One check per meeting of the workspace (the order needs them all; the total is a window over the
  // same scan), plus the page's own reads: each of its 5 briefs, and the seed's participants and
  // follow-up reads. Before the follow-up the brief join made this 1890 for 60 meetings.
  expect(calls).toBeGreaterThanOrEqual(ROWS);
  expect(calls).toBeLessThanOrEqual(ROWS + 10);
});

test('a continuation near the end skips the rows before its cursor and returns no total', async () => {
  // The cursor of the row just before the last five.
  const all = (
    await f.owner.query(
      `SELECT id,to_char((coalesce(starts_at,due_at)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS k
       FROM app.meeting WHERE tenant_id=$1 ORDER BY coalesce(starts_at,due_at),id`,
      [f.ctx.tenantId],
    )
  ).rows as { id: string; k: string }[];
  const at = all[all.length - 6]!;
  const { page, calls } = await measured({ after: encodeCursor({ k: at.k, id: at.id }) });
  expect(page.meetings.map((r) => r.id)).toEqual(all.slice(-5).map((r) => r.id));
  expect(page.next).toBeNull();
  expect(page.meetingsTotal).toBeNull();
  // The five rows after the cursor and their five briefs, not the 55 rows before it.
  expect(calls).toBeLessThanOrEqual(10);
});

test('a mission filter runs before the read policy', async () => {
  const { page, calls } = await measured({ missionId: randomUUID() });
  expect(page.meetings).toHaveLength(0);
  expect(page.meetingsTotal).toBe(0);
  expect(calls).toBe(0);
});

test('a leaky sort expression is refused before it reaches the database', async () => {
  await expect(
    keysetPage(
      { query: () => Promise.reject(new Error('not reached')) },
      {
        select: 'm.*',
        from: 'app.meeting m',
        where: 'true',
        values: [],
        sortExpression: 'coalesce(m.starts_at,m.due_at)',
        direction: 'asc',
        cursor: null,
        limit: 5,
      },
    ),
  ).rejects.toThrow(/leakproof/);
});

test('a recount on a continuation returns the exact total', async () => {
  const first = await measured({ missionId: seedMissionId });
  expect(first.page.meetingsTotal).toBe(ROWS);
  const next = await withTenant(f.runtime, f.ctx, 'meetings.read', ({ db }) =>
    keysetPage(db, {
      select: 'm.*',
      from: 'app.meeting m',
      where: 'm.tenant_id=$1',
      values: [f.ctx.tenantId],
      sortExpression: 'CASE WHEN m.starts_at IS NULL THEN m.due_at ELSE m.starts_at END',
      direction: 'asc',
      cursor: decodeCursor(first.page.next),
      limit: 5,
      count: true,
    }),
  );
  expect(next.total).toBe(ROWS);
  expect(next.rows).toHaveLength(5);
});
