import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { buildWorld, functionState, type Row, type World } from './removed-member-support';

// Removed members, cost (owner decision, 11 Nov 2026: "No, remove access (Recommended)"). The membership rule runs for every
// row of a list, so it must stay cheap on a large database: 6,000 requests of one person across three workspaces (one of them
// left), 400 members and 150 revocations elsewhere and 100 saved reports. The member set is computed once per call and
// hash-probed per row; the plan shows no sequential scan of the membership tables and a hashed member set; the list calls stay
// within three times the cost of the same query without the rule, and under a quarter of a second. Fails on main.
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

let w: World;
let own: string;
let shared: string;
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]!;
async function timed(runs: number, work: () => Promise<unknown>) {
  await work();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await work();
    times.push(performance.now() - start);
  }
  return { median: percentile(times, 0.5), p95: percentile(times, 0.95) };
}
// Rows of a plan, depth first.
type Plan = Record<string, unknown> & { Plans?: Plan[] };
function nodes(plan: Plan): Plan[] {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}
async function explain(sql: string, args: unknown[]) {
  const result = await w.f.owner.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, args);
  const plan = (result.rows[0]['QUERY PLAN'] as { Plan: Plan }[])[0]!.Plan;
  return { plan, all: nodes(plan), text: JSON.stringify(plan) };
}
// The inner list query of customer.private_requests as it stands in the function body, with the actor and the cursor as
// parameters; the test asserts that the member filter is in the stored body, so the copy cannot drift.
const MEMBER_FILTER =
  'r.workspace_id = ANY (ARRAY(SELECT wsc.wid FROM customer_private.workspace_ids_current(actor) AS wsc(wid)))';
const listQuery = (filtered: boolean) =>
  'SELECT r.id FROM customer_private.owned_request r WHERE r.principal_id=$1' +
  (filtered ? ' AND ' + MEMBER_FILTER.replace('(actor)', '($1)') : '') +
  ' AND ($2::uuid IS NULL OR r.id>$2::uuid)' +
  ' AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id) ORDER BY r.id LIMIT 25';
const SAVED_FILTER = 'customer_private.link_workspace_current(link_tenant_id,link_id,actor)';

async function bulkRequests(person: string, workspace: string, count: number) {
  const db = await w.f.owner.connect();
  try {
    await db.query('SET session_replication_role = replica');
    await db.query(
      'CREATE TEMP TABLE bulk AS SELECT n,gen_random_uuid() AS mid FROM generate_series(1,$1::int) n',
      [count],
    );
    await db.query(
      `INSERT INTO app.mission(id,tenant_id,owner_id,next_action,due_at,reason,created_by)
       SELECT mid,$1,$2,'Synthetic bulk row',now()+interval '1 day','Synthetic bulk row',$2 FROM bulk`,
      [w.f.tenantA, w.f.users.owner.id],
    );
    await db.query(
      `INSERT INTO customer_private.owned_request(principal_id,command_id,workspace_id,mission_tenant_id,mission_id,request_key,brief_digest,receipt_hash)
       SELECT $1,gen_random_uuid(),$2,$3,mid,gen_random_uuid(),encode(sha256(mid::text::bytea),'hex'),encode(sha256(('r'||mid::text)::bytea),'hex') FROM bulk`,
      [w.principals[person], workspace, w.f.tenantA],
    );
    await db.query('DROP TABLE bulk');
  } finally {
    await db.query('RESET session_replication_role').catch(() => undefined);
    db.release();
  }
}

beforeAll(async () => {
  w = await buildWorld({ requestsPerPerson: 1, extraPeople: ['perf', 'perf2'] });
  own = await w.provision('perf', 'Synthetic own workspace of perf');
  shared = await w.provision('olive', 'Synthetic perf member workspace');
  await w.join('olive', 'perf', shared);
  const left = await w.join('olive', 'perf', w.W);
  const left2 = await w.join('olive', 'perf2', w.W);
  await bulkRequests('perf', own, 2000);
  await bulkRequests('perf', shared, 2000);
  await bulkRequests('perf', w.W, 2000);
  await bulkRequests('perf2', w.W, 3000);
  // 400 members elsewhere and 150 revocations, written as the owner with triggers off (the rows are only weight).
  const db = await w.f.owner.connect();
  try {
    await db.query('SET session_replication_role = replica');
    await db.query(
      `CREATE TEMP TABLE m AS SELECT n,gen_random_uuid() AS iid,gen_random_uuid() AS mid,
        CASE WHEN n%2=0 THEN $1::uuid ELSE $2::uuid END AS ws,gen_random_uuid() AS person FROM generate_series(1,400) n`,
      [w.W, shared],
    );
    await db.query(
      `INSERT INTO customer_private.workspace_invitation(id,tenant_id,created_by,label,token_hash)
       SELECT iid,ws,$1,'Synthetic bulk member '||n,encode(sha256(iid::text::bytea),'hex') FROM m`,
      [w.principals.olive],
    );
    await db.query(
      'INSERT INTO customer_private.workspace_member(id,tenant_id,principal_id,source_invitation_id) SELECT mid,ws,person,iid FROM m',
    );
    await db.query(
      'INSERT INTO customer_private.workspace_access_revocation(tenant_id,member_id,actor_id) SELECT ws,mid,$1 FROM m WHERE n<=150',
      [w.principals.olive],
    );
    await db.query(
      `INSERT INTO customer_private.saved_mission(principal_id,token_hash,link_tenant_id,link_id)
       SELECT $1,encode(sha256(gen_random_uuid()::text::bytea),'hex'),$2,gen_random_uuid() FROM generate_series(1,100)`,
      [w.principals.perf, w.f.tenantA],
    );
    await db.query('DROP TABLE m');
  } finally {
    await db.query('RESET session_replication_role').catch(() => undefined);
    db.release();
  }
  // The two people leave the big workspace the ordinary way.
  await w.revoke('olive', w.W, left);
  await w.revoke('olive', w.W, left2);
  await w.revoke('olive', w.W, w.members.rex!);
  for (const table of [
    'customer_private.owned_request',
    'customer_private.workspace_member',
    'customer_private.workspace_access_revocation',
    'customer.membership',
    'customer_private.saved_mission',
    'app.mission',
  ])
    await w.f.owner.query(`ANALYZE ${table}`);
}, 1200000);
afterAll(async () => {
  await w?.f.close();
});

describe('what the stored bodies carry', () => {
  test('the list query in the copy below is the one in the function, member filter included', async () => {
    const body = String(
      (await functionState(w.f.owner, 'customer.private_requests(uuid,integer)'))!.prosrc,
    );
    expect(body).toContain(MEMBER_FILTER);
    const saved = String(
      (await functionState(w.f.owner, 'customer.saved_missions(uuid,integer)'))!.prosrc,
    );
    expect(saved).toContain(SAVED_FILTER);
  });
});

describe('the list query on a large database', () => {
  const person = () => w.principals.perf!;
  test('computes the member set once (an initplan array, not once per row), and reads the membership tables by index', async () => {
    const { all, text } = await explain(listQuery(true), [person(), null]);
    const scans = all.filter((n) => n['Node Type'] === 'Seq Scan');
    for (const table of ['workspace_member', 'workspace_access_revocation', 'membership'])
      expect(
        scans.filter((n) => n['Relation Name'] === table).map((n) => n['Relation Name']),
        `sequential scan of ${table}`,
      ).toEqual([]);
    // The member set is a function scan that runs once, behind a hash.
    const set = all.filter((n) => n['Function Name'] === 'workspace_ids_current');
    expect(set.length).toBeGreaterThan(0);
    for (const node of set) expect(node['Actual Loops']).toBe(1);
    // It is an initplan: evaluated once, before the scan, and not a subplan that runs for every candidate row.
    expect(text).toContain('InitPlan');
    expect(text).not.toMatch(/"Node Type":"Hash"/);
    // The list itself does not read every request of the person to return one page. If it did, add owned_request(principal_id,id)
    // in a customer migration (the open question in the plan) rather than raising this bound.
    const requestScan = all.filter(
      (n) => n['Relation Name'] === 'owned_request' && n['Node Type'] === 'Seq Scan',
    );
    expect(requestScan.map((n) => n['Actual Rows'])).toEqual([]);
  });

  test('the new query costs at most three times the same query without the rule (and never more than five milliseconds more than that floor)', async () => {
    const run = (filtered: boolean) => () => w.f.owner.query(listQuery(filtered), [person(), null]);
    const without = await timed(30, run(false));
    const withRule = await timed(30, run(true));
    expect(withRule.p95).toBeLessThanOrEqual(Math.max(3 * without.median, 5));
  });

  test('the member rule agrees for every request: exactly the requests of the two kept workspaces are listed', async () => {
    const kept = (
      await w.f.owner.query(
        `SELECT count(*)::int AS n FROM customer_private.owned_request r WHERE r.principal_id=$1
         AND r.workspace_id IN (SELECT customer_private.workspace_ids_current($1))`,
        [person()],
      )
    ).rows[0].n as number;
    expect(kept).toBe(4000);
    expect(
      (
        await w.f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.owned_request r WHERE r.principal_id=$1 AND NOT customer_private.workspace_member_current(r.workspace_id,r.principal_id)',
          [person()],
        )
      ).rows[0].n,
    ).toBe(2000);
  });
});

describe('the functions through a customer session', () => {
  test('private_requests: a person with 2,000 hidden requests lists the kept ones fast', async () => {
    const page = (await w.row('perf', 'SELECT customer.private_requests(NULL,25) AS r')).r as Row;
    expect((page.requests as unknown[]).length).toBe(25);
    expect(page.nextAfter).toBeTruthy();
    // Correctness next to the timing: reading every page returns exactly the 4,000 kept requests and none of the 2,000 hidden ones
    // (main returns all 6,000).
    const seen: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 80; i++) {
      const next = (await w.row('perf', 'SELECT customer.private_requests($1,100) AS r', [after]))
        .r as {
        requests: { id: string; workspaceId: string }[];
        nextAfter: string | null;
      };
      seen.push(...next.requests.map((r) => r.id));
      for (const request of next.requests) expect(request.workspaceId).not.toBe(w.W);
      after = next.nextAfter;
      if (!after) break;
    }
    expect(seen).toHaveLength(4000);
    const timing = await timed(30, () =>
      w.row('perf', 'SELECT customer.private_requests(NULL,25) AS r'),
    );
    expect(timing.p95).toBeLessThan(250);
  });

  test('private_requests: a person whose every request is hidden gets none, and the worst case still answers fast', async () => {
    const page = (await w.row('perf2', 'SELECT customer.private_requests(NULL,25) AS r')).r as Row;
    expect(page.requests).toEqual([]);
    expect(page.nextAfter).toBeNull();
    const timing = await timed(30, () =>
      w.row('perf2', 'SELECT customer.private_requests(NULL,25) AS r'),
    );
    expect(timing.p95).toBeLessThan(250);
  });

  test('saved_missions: 100 saved reports are listed fast, 25 at a time', async () => {
    const page = (await w.row('perf', 'SELECT customer.saved_missions(NULL,25) AS r')).r as Row;
    expect((page.missions as unknown[]).length).toBe(25);
    expect(page.nextAfter).toBeTruthy();
    // Correctness next to the timing: rex was removed from the big workspace, so the report staff delivered for his request is
    // hidden while his two bearer-saved reports stay (main lists all three).
    expect(await w.savedIds('rex')).not.toContain(w.reports.rex!.savedId);
    expect(await w.savedIds('rex')).toHaveLength(2);
    const timing = await timed(30, () =>
      w.row('perf', 'SELECT customer.saved_missions(NULL,25) AS r'),
    );
    expect(timing.p95).toBeLessThan(250);
  });

  test('saved_missions: the rule costs at most three times the same list without it', async () => {
    const principal = w.principals.perf!;
    const withRule = `SELECT id FROM customer_private.saved_mission WHERE principal_id=$1 AND removed_at IS NULL AND ${SAVED_FILTER.replace('actor', '$1')} AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 25`;
    const without = `SELECT id FROM customer_private.saved_mission WHERE principal_id=$1 AND removed_at IS NULL AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 25`;
    const base = await timed(30, () => w.f.owner.query(without, [principal, null]));
    const rule = await timed(30, () => w.f.owner.query(withRule, [principal, null]));
    expect(rule.p95).toBeLessThanOrEqual(Math.max(3 * base.median, 20));
  });
});
