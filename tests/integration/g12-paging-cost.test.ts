import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../packages/db/src/index';
import { keysetPage } from '../../packages/domain/src/paging';
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

async function setTrackFunctions(value: 'all' | 'none') {
  await f.owner.query(`ALTER SYSTEM SET track_functions = '${value}'`);
  await f.owner.query('SELECT pg_reload_conf()');
  // A reload reaches every backend at its next command; wait until a fresh one reports it.
  for (let i = 0; i < 50; i++) {
    const c = await f.runtime.connect();
    try {
      const v = (await c.query('SHOW track_functions')).rows[0].track_functions;
      if (v === value) return;
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
  await setTrackFunctions('all');
});
afterAll(async () => {
  if (f) await setTrackFunctions('none').catch(() => undefined);
  await f?.close();
});

/** Reads one meetings page as the service does and returns it with the policy calls it cost. */
function measured(cursor: { k: string; id: string } | null, missionId: string | null, limit = 5) {
  return withTenant(f.runtime, f.ctx, 'meetings.read', async ({ db }) => {
    // Calls not yet reported by earlier transactions on this connection are still listed: take a delta.
    const policyCalls = async () => Number((await db.query(POLICY_CALLS)).rows[0]!.n);
    const before = await policyCalls();
    const page = await keysetPage(db, {
      select: 'm.*',
      from: 'app.meeting m',
      where: 'm.tenant_id=$1 AND ($2::uuid IS NULL OR m.mission_id=$2)',
      values: [f.ctx.tenantId, missionId],
      sortExpression: 'CASE WHEN m.starts_at IS NULL THEN m.due_at ELSE m.starts_at END',
      direction: 'asc',
      cursor,
      limit,
    });
    const calls = (await policyCalls()) - before;
    return { page, calls };
  });
}

test('the first page runs the read policy once per row, not again for the total', async () => {
  const { page, calls } = await measured(null, null);
  expect(page.total).toBe(ROWS);
  expect(page.rows).toHaveLength(5);
  // One check per meeting of the workspace: the order needs them all, and the total is a window over the
  // same scan. Before the follow-up the brief join made this 1890 for 60 meetings.
  expect(calls).toBe(ROWS);
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
  const { page, calls } = await measured({ k: at.k, id: at.id }, null);
  expect(page.rows.map((r: { id: string }) => r.id)).toEqual(all.slice(-5).map((r) => r.id));
  expect(page.next).toBeNull();
  expect(page.total).toBeNull();
  // Only the five rows after the cursor reach the policy, not the 55 before it.
  expect(calls).toBe(5);
});

test('a mission filter runs before the read policy', async () => {
  const { page, calls } = await measured(null, randomUUID());
  expect(page.rows).toHaveLength(0);
  expect(page.total).toBe(0);
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
  const first = await measured(null, seedMissionId, 5);
  expect(first.page.total).toBe(ROWS);
  const next = await withTenant(f.runtime, f.ctx, 'meetings.read', ({ db }) =>
    keysetPage(db, {
      select: 'm.*',
      from: 'app.meeting m',
      where: 'm.tenant_id=$1',
      values: [f.ctx.tenantId],
      sortExpression: 'CASE WHEN m.starts_at IS NULL THEN m.due_at ELSE m.starts_at END',
      direction: 'asc',
      cursor: JSON.parse(Buffer.from(first.page.next!, 'base64url').toString('utf8')),
      limit: 5,
      count: true,
    }),
  );
  expect(next.total).toBe(ROWS);
  expect(next.rows).toHaveLength(5);
});
