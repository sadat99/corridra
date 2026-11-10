import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { accessFixture, command, future } from './access-fixture';

// CRUD G12: the meetings workspace pages its lists instead of cutting them at a fixed limit.
let f: Awaited<ReturnType<typeof accessFixture>>;
let seedMissionId: string;
let seedMeetingId: string;
beforeAll(async () => {
  f = await accessFixture();
  const i = await f.introduction();
  const input = command('propose', {
    messageId: i.id,
    title: 'Synthetic paging seed',
    brief: 'Seed meeting for the paging tests.',
    participants: ['Synthetic Supplier Person', 'Synthetic Buyer Person'],
    ownerId: f.users.operator.id,
    nextAction: 'Send the agreed synthetic follow-up',
    dueAt: future(),
    reason: 'Seed the synthetic paging tests',
  });
  const m = await f.meetings.command(f.ctx, input);
  seedMeetingId = m.id;
  seedMissionId = i.missionId;
});
afterAll(async () => {
  await f?.close();
});

/** Clone the seed meeting n times; clones share a due date in groups of 3 so the id tiebreak matters. */
async function cloneMeetings(n: number, dueFrom: string, missionId = seedMissionId) {
  const ids = Array.from({ length: n }, () => randomUUID());
  const seed = await f.owner.connect();
  try {
    // Volume seeding only: the guards need a live access context, which a raw owner connection lacks.
    await seed.query("SET session_replication_role = 'replica'");
    await seed.query(
      `INSERT INTO app.meeting(id,tenant_id,message_id,mission_id,title,owner_id,next_action,due_at,reason,created_by)
       SELECT g.id,m.tenant_id,m.message_id,$2,'Synthetic paging meeting '||g.k,m.owner_id,m.next_action,
              $3::timestamptz + ((g.k / 3) || ' minutes')::interval,m.reason,m.created_by
       FROM app.meeting m, unnest($1::uuid[]) WITH ORDINALITY AS g(id,k) WHERE m.id=$4`,
      [ids, missionId, dueFrom, seedMeetingId],
    );
    await seed.query(
      `INSERT INTO app.meeting_brief(tenant_id,meeting_id,body,created_by)
       SELECT m.tenant_id,m.id,'Brief for the paging test',m.created_by FROM app.meeting m WHERE m.id=ANY($1::uuid[])`,
      [ids],
    );
  } finally {
    await seed.query('RESET session_replication_role');
    seed.release();
  }
  return ids;
}

async function walk(missionId?: string, limit?: number) {
  const pages: string[][] = [];
  let after: string | null = null;
  let total = -1;
  for (let guard = 0; guard < 20; guard++) {
    const page = (await f.meetings.workspace(f.ctx, { after, missionId, limit })) as unknown as {
      meetings: { id: string }[];
      meetingsTotal: number;
      next: string | null;
    };
    pages.push(page.meetings.map((m) => m.id));
    total = page.meetingsTotal;
    if (!page.next) break;
    after = page.next;
  }
  return { pages, total };
}

test(
  'meetings come in pages with an exact total and no loss or duplicate',
  { timeout: 240000 },
  async () => {
    const seeded = await cloneMeetings(10, '2031-01-01T00:00:00Z');
    const { pages, total } = await walk(undefined, 4);
    expect(pages.map((p) => p.length)).toEqual([4, 4, 3]);
    expect(total).toBe(11);
    const all = pages.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set([seedMeetingId, ...seeded]));
  },
);

test(
  'an insert between pages neither duplicates nor loses a row that was already listed',
  { timeout: 240000 },
  async () => {
    const first = (await f.meetings.workspace(f.ctx, { limit: 4 })) as unknown as {
      meetings: { id: string }[];
      next: string;
    };
    const before = (
      await f.owner.query('SELECT id FROM app.meeting WHERE tenant_id=$1', [f.ctx.tenantId])
    ).rows.map((r) => r.id as string);
    const [early] = await cloneMeetings(1, '2000-01-01T00:00:00Z');
    const [late] = await cloneMeetings(1, '2040-01-01T00:00:00Z');
    const seen = new Set(first.meetings.map((m) => m.id));
    let after: string | null = first.next;
    for (let guard = 0; guard < 20 && after; guard++) {
      const page = (await f.meetings.workspace(f.ctx, { after, limit: 4 })) as {
        meetings: { id: string }[];
        next: string | null;
      };
      for (const m of page.meetings) {
        expect(seen.has(m.id)).toBe(false);
        seen.add(m.id);
      }
      after = page.next;
    }
    for (const id of before) expect(seen.has(id)).toBe(true);
    expect(seen.has(late!)).toBe(true);
    // The early row sorts before the cursor, so this walk does not show it; the next fresh read does.
    expect(seen.has(early!)).toBe(false);
  },
);

test('a mission filter is applied on the server before paging', { timeout: 240000 }, async () => {
  const { pages, total } = await walk(seedMissionId, 4);
  const rows = (
    await f.owner.query(
      'SELECT count(*)::int AS n FROM app.meeting WHERE tenant_id=$1 AND mission_id=$2',
      [f.ctx.tenantId, seedMissionId],
    )
  ).rows[0].n;
  expect(total).toBe(rows);
  expect(pages.flat()).toHaveLength(rows);
  const other = await walk(randomUUID(), 4);
  expect(other.total).toBe(0);
  expect(other.pages.flat()).toHaveLength(0);
});

test('a malformed or oversized cursor is refused with 400', async () => {
  for (const bad of ['not-a-cursor', 'x'.repeat(400), Buffer.from('{"k":1}').toString('base64url')])
    await expect(f.meetings.workspace(f.ctx, { after: bad })).rejects.toMatchObject({
      status: 400,
    });
});

test('follow-ups page on their own cursor with an exact total', { timeout: 240000 }, async () => {
  // A follow-up needs its own meeting and held outcome (one each), so give 30 meetings one each.
  const ids = await cloneMeetings(30, '2032-01-01T00:00:00Z');
  const seed = await f.owner.connect();
  try {
    await seed.query("SET session_replication_role = 'replica'");
    await seed.query(
      `INSERT INTO app.meeting_outcome(id,tenant_id,meeting_id,status,summary,created_by)
       SELECT gen_random_uuid(),tenant_id,id,'HELD','Held for the paging test',created_by
       FROM app.meeting WHERE id=ANY($1::uuid[])`,
      [ids],
    );
    await seed.query(
      `INSERT INTO app.follow_up(id,tenant_id,meeting_id,outcome_id,owner_id,next_action,due_at,reason,created_by)
       SELECT gen_random_uuid(),m.tenant_id,m.id,o.id,m.owner_id,'Follow up '||m.title,
              '2031-06-01T00:00:00Z'::timestamptz+((row_number() OVER (ORDER BY m.id)/3)||' minutes')::interval,'Paging test',m.created_by
       FROM app.meeting m JOIN app.meeting_outcome o ON o.meeting_id=m.id WHERE m.id=ANY($1::uuid[])`,
      [ids],
    );
  } finally {
    await seed.query('RESET session_replication_role');
    seed.release();
  }
  const seen: string[] = [];
  let after: string | null = null;
  let total = -1;
  for (let guard = 0; guard < 10; guard++) {
    const page = (await f.meetings.workspace(f.ctx, {
      followupsAfter: after,
      limit: 25,
    })) as unknown as {
      followups: { id: string }[];
      followupsTotal: number;
      followupsNext: string | null;
    };
    seen.push(...page.followups.map((x) => x.id));
    total = page.followupsTotal;
    if (!page.followupsNext) break;
    after = page.followupsNext;
  }
  expect(total).toBe(30);
  expect(seen).toHaveLength(30);
  expect(new Set(seen).size).toBe(30);
});

test('the default page holds 50 meetings', { timeout: 240000 }, async () => {
  await cloneMeetings(42, '2033-01-01T00:00:00Z');
  const page = (await f.meetings.workspace(f.ctx, {})) as unknown as {
    meetings: { id: string }[];
    meetingsTotal: number;
    next: string | null;
  };
  expect(page.meetings).toHaveLength(50);
  expect(page.next).toEqual(expect.any(String));
  expect(page.meetingsTotal).toBeGreaterThan(50);
});
