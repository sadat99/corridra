import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ERASURE_FILE,
  HISTORY_TABLES,
  bodyHash,
  buildWorld,
  bulkOwnedRequests,
  digest,
  erasureFingerprints,
  erasureSql,
  functionState,
  hideErasureFile,
  liveErasureFingerprints,
  openErasureFile,
  setAccountLifecycleControl,
  sha,
  stripComments,
  type Outcome,
  type Row,
  type World,
} from './removed-member-support';
import { fixture, rawContext } from './support';
import type { PoolClient } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';

// Removed members and erasure (owner decisions, 11 Nov 2026: "Yes, add an erasure path (Recommended)", "Staff by hand, tracked
// (Recommended)", "One team only (Recommended)" and "No, workspace decides (Recommended)", after "No, remove access
// (Recommended)"; ADR-078 decision 6 and its erasure amendment; ADR-033 amendment). The last two decisions of the four are cited
// as relayed by the orchestrating session. Two later answers of the owner, 11 Nov 2026, relayed by Guardian S40: "Owning team
// sees all ids (Recommended)" (the team that owns an erasure request lists every request id of that person, in every workspace and
// on both sides, a page of 100 at a time) and "Allow self-close (Recommended)" (a removed, revoked-only or left person may close
// and undo their own account like anyone else). The erasure file (account lifecycle 0005) does three things and only these:
//  1. a person who left every workspace can hold an erasure request (the chain falls back to the earliest workspace they ever held),
//  2. one team handles the whole request, the real team when the person wrote any request in a real workspace,
//  3. the owning team gets a read-only list of every request that person wrote, found by author and not by membership, in pages
//     of at most 100 by a (created_at, id) cursor, without any word.
// Nothing is erased, withdrawn, restored or revoked by it, and the customer gains no read path and no new copy: the removed member
// still cannot list, open, withdraw or restore the requests ("No, workspace decides"). Removing request words stays a manual step
// for staff (removalIsManual).
//
// The suite is built at the state of main (the ten files of removed member access in place, the erasure file hidden), then the
// real migrator applies the erasure file. ERASURE_BASE_CHECK=1 keeps the file hidden for the whole run: every case that proves the
// new behaviour fails and every case titled CONTROL passes, which is how the suite is shown to fail on main. The cases are written
// for a real database; nothing here is a real person, request or workspace.
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

const noWorkspace =
  'There is no workspace on this account. Write to the privacy contact on the privacy page.';
const notFound = { code: '23514', message: 'Erasure request not found' };
const denied = { code: '42501', message: 'Privacy queue access denied' };
const reason = 'A reason that is long enough to be accepted';
const registry = ERASURE_FILE.registry;
const REACH = 'customer.erasure_request_reach(uuid,timestamptz,uuid)';
const REPLACED = [
  'customer_private.account_chain_tenant(uuid)',
  'customer_private.erasure_in_scope(uuid)',
];
const LIFECYCLE_FILES = [
  '0001_account_closure_and_erasure.sql',
  '0002_account_chain_and_undo_words.sql',
  '0003_erasure_queue_scope.sql',
  '0004_erasure_scope_by_workspaces.sql',
];
// Tables the erasure file must leave byte for byte as they were, on top of the history tables.
const ERASURE_TABLES = [
  'customer_private.erasure_request',
  'customer_private.erasure_status_event',
  'customer_private.account_chain',
  'customer_private.account_lifecycle_control',
  'customer_private.account_lifecycle_request',
  'customer_private.account_closure_event',
  'app.tenant',
];

type ReachRequest = {
  id: string;
  workspaceId: string;
  side: string;
  missionId: string;
  status: string;
  createdAt: string;
  retentionUntil: string | null;
  authorStillMember: boolean;
  revoked: boolean;
  withdrawn: boolean;
};
type Cursor = { createdAt: string; id: string };
type Reach = {
  reference: string;
  removalIsManual: boolean;
  total: number;
  requests: ReachRequest[];
  nextAfter: Cursor | null;
};
type Staff = 'sample' | 'real' | 'operator';

let w: World;
let g: Awaited<ReturnType<typeof fixture>>;
// Requests by person, in the order they were written. Gone, back and redo wrote theirs in the shared workspace W and left it.
const written: Record<string, string[]> = {};
let sampleOwn: string;
let realWorkspace: string;
let realSideRequest: string;
let heavyWorkspace: string;
let pagerWorkspace: string;
let blendWorkspace: string;
let soloWorkspace: string;
let readsBefore: Awaited<ReturnType<typeof readsOf>>;
let before: {
  chain: string | null;
  scope: string | null;
  history: Record<string, string>;
  erasure: Record<string, string>;
};
const goneCommand = randomUUID();
let goneFiled: Row;

// ---- customers
const account = (
  person: string,
  operation: string,
  input: Record<string, unknown> = {},
  command = randomUUID(),
) =>
  w
    .row(person, 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
      command,
      operation,
      JSON.stringify(input),
    ])
    .then((row) => row.r as Row);
const accountAttempt = (person: string, operation: string, input: Record<string, unknown> = {}) =>
  w.attempt(person, 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
    randomUUID(),
    operation,
    JSON.stringify(input),
  ]);
const requestOf = async (person: string) =>
  (
    await w.f.owner.query(
      'SELECT id FROM customer_private.erasure_request WHERE principal_id=$1 ORDER BY number DESC LIMIT 1',
      [w.principals[person]],
    )
  ).rows[0]?.id as string | undefined;
const erasureCount = async (person: string) =>
  (
    await w.f.owner.query(
      'SELECT count(*)::int AS n FROM customer_private.erasure_request WHERE principal_id=$1',
      [w.principals[person]],
    )
  ).rows[0].n as number;
const chainOf = async (person: string) =>
  (
    await w.f.owner.query(
      'SELECT tenant_id FROM customer_private.account_chain WHERE principal_id=$1',
      [w.principals[person]],
    )
  ).rows.map((row) => row.tenant_id as string);
const text = (outcome: Outcome) => (outcome.ok ? 'ok' : `${outcome.code} ${outcome.message}`);
const shape = (outcome: Outcome) => (outcome.ok ? JSON.stringify(outcome.row) : text(outcome));
// What a person can do with a request they wrote in a workspace they left, and what they see of it.
const readsOf = async (person: string, request: string) => ({
  list: shape(await w.attempt(person, 'SELECT customer.private_requests(NULL,25) AS r')),
  detail: shape(
    await w.attempt(person, 'SELECT customer.private_request_detail($1) AS r', [request]),
  ),
  withdraw: shape(
    await w.attempt(person, 'SELECT customer.withdraw_request($1,$2,$3) AS r', [
      request,
      randomUUID(),
      reason,
    ]),
  ),
  restore: shape(
    await w.attempt(person, 'SELECT customer.restore_request($1,$2) AS r', [request, randomUUID()]),
  ),
  withdrawals: shape(await w.attempt(person, 'SELECT customer.my_request_withdrawals() AS r')),
});
const leaver = async (person: string, count: number) => {
  await w.join('olive', person, w.W);
  const made: string[] = [];
  for (let i = 0; i < count; i++) made.push(await w.submit(person, w.W));
  return made;
};

// ---- staff
const staffUser = (who: Staff) =>
  who === 'sample' ? w.f.users.owner! : who === 'real' ? w.f.users.other! : w.f.users.operator!;
const staffContext = (who: Staff) =>
  who === 'real'
    ? { ...staffUser(who).ctx, purpose: 'commercial_qualification' }
    : staffUser(who).ctx;
// The authenticator check lasts five minutes and the world takes longer to build, so each call renews it first.
const freshSession = async (who: Staff) => {
  await w.f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
    staffUser(who).sessionId,
  ]);
  await w.f.owner.query(
    `UPDATE identity.session SET "expiresAt"=now()+interval '1 hour' WHERE id=$1`,
    [staffUser(who).sessionId],
  );
};
const staff = async (who: Staff, sql: string, params: unknown[] = []) => {
  await freshSession(who);
  return (await rawContext(w.f.runtime, staffContext(who), sql, params)).rows[0] as Row;
};
const refused = (work: Promise<unknown>) =>
  work.then(
    () => {
      throw new Error('Expected a refusal');
    },
    (error: { code?: string; message: string }) => ({ code: error.code, message: error.message }),
  );
const queue = (who: Staff) =>
  staff(who, 'SELECT customer.erasure_queue(NULL,100,NULL) AS r').then(
    (row) => row.r as { id: string; principalId: string; status: string }[],
  );
const queued = async (who: Staff, person: string) =>
  (await queue(who)).some((item) => item.principalId === w.principals[person]);
// The cursor is passed on exactly as the function returned it: createdAt keeps its microseconds only as text.
const reach = (who: Staff, request: string, after: Cursor | null = null) =>
  (after
    ? staff(who, 'SELECT customer.erasure_request_reach($1,$2,$3) AS r', [
        request,
        after.createdAt,
        after.id,
      ])
    : staff(who, 'SELECT customer.erasure_request_reach($1) AS r', [request])
  ).then((row) => row.r as Reach);
// Every page of one erasure request, from the first to the page whose nextAfter is null.
const reachPages = async (who: Staff, request: string) => {
  const pages: Reach[] = [];
  let after: Cursor | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const page: Reach = await reach(who, request, after);
    pages.push(page);
    if (!page.nextAfter) return pages;
    after = page.nextAfter;
  }
  throw new Error('The reach list did not end');
};
// The requests a person wrote, oldest first, as the database orders them: the order every page must follow.
const writtenInOrder = async (person: string) =>
  (
    await w.f.owner.query(
      'SELECT id FROM customer_private.owned_request WHERE principal_id=$1 ORDER BY created_at,id',
      [w.principals[person]],
    )
  ).rows.map((row) => row.id as string);
const transition = (
  who: Staff,
  request: string,
  expected: string,
  to: string,
  note: string | null = null,
) =>
  staff(who, 'SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
    randomUUID(),
    request,
    expected,
    to,
    note,
  ]).then((row) => row.r as Row);

// ---- the real side: a real staff workspace and a real customer workspace, flipped on the tenant table as other suites do
const flip = async (tenant: string, synthetic: boolean) => {
  await w.f.owner.query('ALTER TABLE app.tenant DISABLE TRIGGER USER');
  try {
    await w.f.owner.query('UPDATE app.tenant SET synthetic=$2 WHERE id=$1', [tenant, synthetic]);
  } finally {
    await w.f.owner.query('ALTER TABLE app.tenant ENABLE TRIGGER USER');
  }
};
const realStaffPurpose = async (on: boolean) => {
  await w.f.owner.query('ALTER TABLE app.membership DISABLE TRIGGER USER');
  try {
    await w.f.owner.query(
      on
        ? `UPDATE app.membership SET allowed_purposes=allowed_purposes||ARRAY['commercial_qualification']
           WHERE tenant_id=$1 AND NOT 'commercial_qualification'=ANY(allowed_purposes)`
        : `UPDATE app.membership SET allowed_purposes=array_remove(allowed_purposes,'commercial_qualification') WHERE tenant_id=$1`,
      [w.f.tenantB],
    );
  } finally {
    await w.f.owner.query('ALTER TABLE app.membership ENABLE TRIGGER USER');
  }
};

// ---- the guard database: the state production is in (account lifecycle 0001 to 0004), one transaction per case, always rolled back
async function rolledBack<T>(work: (db: PoolClient, notices: string[]) => Promise<T>): Promise<T> {
  const db = (await g.owner.connect()) as unknown as PoolClient;
  const notices: string[] = [];
  db.on('notice', (n) => notices.push(String(n.message)));
  try {
    await db.query('BEGIN');
    return await work(db, notices);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}
const states = async (db: PoolClient, signatures: string[]) => {
  const out: Record<string, unknown> = {};
  for (const signature of signatures) {
    const state = await db.query(
      `SELECT p.prosrc,p.proconfig,p.prosecdef,p.provolatile,p.proisstrict,p.proretset,p.proparallel,p.proleakproof,
        p.proargtypes::regtype[]::text AS argtypes,p.prorettype::regtype::text AS ret,l.lanname,p.proargnames,p.pronargdefaults,
        pg_get_expr(p.proargdefaults,0) AS defaults,p.proowner::regrole::text AS owner,p.proacl::text AS acl
       FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure($1)`,
      [signature],
    );
    out[signature] = state.rows[0] ?? null;
  }
  return out;
};
const without = (state: unknown) => {
  const copy = { ...(state as Record<string, unknown>) };
  delete copy.prosrc;
  return copy;
};
const lines = (body: string) =>
  body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
const mutations: Record<string, (signature: string) => string> = {
  'its body': (s) =>
    `UPDATE pg_proc SET prosrc=prosrc||E'\\n -- changed by hand' WHERE oid=to_regprocedure('${s}')`,
  'its search path': (s) => `ALTER FUNCTION ${s} SET search_path=pg_catalog,public`,
  'its volatility': (s) => `ALTER FUNCTION ${s} IMMUTABLE`,
  'an extra grant to PUBLIC': (s) => `GRANT EXECUTE ON FUNCTION ${s} TO PUBLIC`,
};
const reachExists = async (db: PoolClient) =>
  (await db.query(`SELECT to_regprocedure('${REACH}') IS NOT NULL AS present`)).rows[0]
    .present as boolean;

beforeAll(async () => {
  // Main: the ten files in place, the erasure file not yet there.
  hideErasureFile();
  w = await buildWorld({
    requestsPerPerson: 1,
    extraPeople: ['gone', 'mover', 'back', 'redo', 'heavy', 'pager', 'blend', 'solo'],
  });

  // Three people who wrote requests in the shared workspace and left it, and have no workspace of their own: no account chain row.
  const [, withdrawnByGone, revokedForGone] = (written.gone = await leaver('gone', 3));
  await w.row('gone', 'SELECT customer.withdraw_request($1,$2,$3) AS r', [
    withdrawnByGone,
    randomUUID(),
    reason,
  ]);
  await w.f.owner.query(
    "INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,'Revoked for the removed member erasure test')",
    [revokedForGone],
  );
  await w.leave('gone', w.W);
  written.back = await leaver('back', 1);
  await w.leave('back', w.W);
  written.redo = await leaver('redo', 1);
  await w.leave('redo', w.W);

  // Mover: a sample workspace of their own (so the account chain will be a sample one), and a request in another workspace that
  // they are removed from. That workspace is made real below, after its requests were written.
  sampleOwn = await w.provision('mover', 'Synthetic own workspace of mover');
  realWorkspace = await w.provision('olive', 'Synthetic real erasure workspace');
  const moverMember = await w.join('olive', 'mover', realWorkspace);
  written.mover = [await w.submit('mover', realWorkspace), await w.submit('mover', sampleOwn)];
  await w.revoke('olive', realWorkspace, moverMember);

  // Heavy: many requests, for the cost cases.
  heavyWorkspace = await w.provision('heavy', 'Synthetic own workspace of heavy');
  // Pager, blend and solo: the paging, mixed person and sample-only cases of the reach list.
  pagerWorkspace = await w.provision('pager', 'Synthetic own workspace of pager');
  blendWorkspace = await w.provision('blend', 'Synthetic own workspace of blend');
  soloWorkspace = await w.provision('solo', 'Synthetic own workspace of solo');

  // The account lifecycle module as production has it: files 0001 to 0004, the control open.
  await migrateCustomerAccountLifecycle(w.f.owner);
  await setAccountLifecycleControl(w, true, 'removed member erasure');
  // Mover files before the erasure file exists: the account chain is their sample workspace, and the request is a sample one.
  await account('mover', 'file_erasure');

  // The real side: a real staff workspace, a real customer workspace, and a request of mover in the real staff workspace.
  await flip(w.f.tenantB, false);
  await realStaffPurpose(true);
  await flip(realWorkspace, false);
  await bulkOwnedRequests(w, {
    person: 'mover',
    workspace: realWorkspace,
    count: 1,
    missionTenant: w.f.tenantB,
  });
  realSideRequest = (
    await w.f.owner.query(
      'SELECT id FROM customer_private.owned_request WHERE principal_id=$1 AND mission_tenant_id=$2',
      [w.principals.mover, w.f.tenantB],
    )
  ).rows[0].id as string;

  before = {
    chain: await bodyHash(w.f.owner, REPLACED[0]!),
    scope: await bodyHash(w.f.owner, REPLACED[1]!),
    history: await digest(w.f.owner, HISTORY_TABLES),
    erasure: await digest(w.f.owner, ERASURE_TABLES),
  };

  // The guard database: the same state, built by the real migrators and kept away from the erasure file.
  g = await fixture('corridra_upgrade');
  await migrateCustomerRealUse(g.owner);
  await migrateCustomerAccountLifecycle(g.owner);
}, 1800000);
afterAll(async () => {
  openErasureFile();
  if (w) {
    await realStaffPurpose(false);
    await flip(w.f.tenantB, true);
    if (realWorkspace) await flip(realWorkspace, true);
  }
  await w?.f.close();
  await g?.close();
});

describe('CONTROL (holds on main too): the state before the erasure file', () => {
  test('a person who left every workspace is refused with the privacy contact text, and nothing is written for them', async () => {
    const outcome = await accountAttempt('gone', 'file_erasure');
    expect(outcome).toMatchObject({ ok: false, code: '23514', message: noWorkspace });
    expect(await erasureCount('gone')).toBe(0);
    expect(await chainOf('gone')).toEqual([]);
  });

  test('the staff reach function does not exist yet', async () => {
    expect(
      (await w.f.owner.query(`SELECT to_regprocedure('${REACH}') IS NULL AS absent`)).rows[0]
        .absent,
    ).toBe(true);
  });

  test('a person with a sample account chain who was removed from a real workspace is routed to sample staff, and real staff do not see it', async () => {
    expect(await queued('sample', 'mover')).toBe(true);
    expect(await queued('real', 'mover')).toBe(false);
  });

  test('the removed member cannot list, open, withdraw or restore what they wrote: the answers the erasure file must not change', async () => {
    const reads = await readsOf('gone', written.gone![0]!);
    expect(reads.list).toContain('"requests":[]');
    expect(reads.detail).toContain('Private request unavailable');
    expect(reads.withdraw).toContain('Request is not available');
    expect(reads.restore).toContain('Request is not available');
    readsBefore = reads;
  });
});

describe('the real migrator applies the erasure file over account lifecycle 0001 to 0004', () => {
  test('it is recorded with its own hash after the four, says how many open requests move, and writes no row anywhere else', async () => {
    openErasureFile();
    const notices: string[] = [];
    // The pool announces every checkout, so a client is given its listener once and the listener is taken off afterwards.
    const listening = new Map<PoolClient, (notice: { message?: string }) => void>();
    const listen = (client: PoolClient) => {
      if (listening.has(client)) return;
      const onNotice = (notice: { message?: string }) => notices.push(String(notice.message));
      listening.set(client, onNotice);
      client.on('notice', onNotice);
    };
    w.f.owner.on('acquire', listen);
    try {
      await migrateCustomerAccountLifecycle(w.f.owner);
    } finally {
      w.f.owner.off('acquire', listen);
      for (const [client, onNotice] of listening) client.off('notice', onNotice);
    }
    const applied = (
      await w.f.owner.query(`SELECT name,sha256 FROM ${registry}.applied ORDER BY name`)
    ).rows as { name: string; sha256: string }[];
    expect(applied.map((row) => row.name)).toEqual([...LIFECYCLE_FILES, ERASURE_FILE.name]);
    expect(applied[4]!.sha256).toBe(sha(erasureSql()));
    // mover is the one open sample request whose person wrote a request in a real workspace and holds no real workspace now
    expect(notices.filter((notice) => /^Removed member erasure:/.test(notice))).toEqual([
      'Removed member erasure: 1 open erasure request(s) move from sample staff to real staff',
    ]);
    expect(await digest(w.f.owner, HISTORY_TABLES)).toEqual(before.history);
    expect(await digest(w.f.owner, ERASURE_TABLES)).toEqual(before.erasure);
  });

  test('both functions are replaced in place and the new one is for the application login only', async () => {
    expect(await bodyHash(w.f.owner, REPLACED[0]!)).not.toBe(before.chain);
    expect(await bodyHash(w.f.owner, REPLACED[1]!)).not.toBe(before.scope);
    for (const signature of REPLACED) {
      const state = await functionState(w.f.owner, signature);
      expect(state).toMatchObject({ prosecdef: true, lanname: expect.any(String) });
      expect(String(state!.proconfig)).toContain('search_path=pg_catalog');
    }
    const grants = (
      await w.f.owner.query(
        `SELECT has_function_privilege('corridra_runtime',p.oid,'EXECUTE') AS runtime,
          has_function_privilege('corridra_auth',p.oid,'EXECUTE') AS auth,has_function_privilege('public',p.oid,'EXECUTE') AS pub,
          p.prosecdef,p.proconfig::text AS config,p.provolatile
         FROM pg_proc p WHERE p.oid=to_regprocedure($1)`,
        [REACH],
      )
    ).rows[0];
    expect(grants).toMatchObject({
      runtime: true,
      auth: false,
      pub: false,
      prosecdef: true,
      provolatile: 'v',
    });
    expect(grants.config).toContain('search_path=pg_catalog');
    for (const signature of REPLACED)
      expect(
        (
          await w.f.owner.query(
            `SELECT has_function_privilege('corridra_runtime',$1::regprocedure,'EXECUTE') AS runtime,
              has_function_privilege('corridra_auth',$1::regprocedure,'EXECUTE') AS auth,has_function_privilege('public',$1::regprocedure,'EXECUTE') AS pub`,
            [signature],
          )
        ).rows[0],
        signature,
      ).toEqual({ runtime: false, auth: false, pub: false });
  });

  test('running the migrator again is a no-op, with the erasure file in the registry', async () => {
    const rows = async () =>
      (
        await w.f.owner.query(
          `SELECT name,sha256,applied_at::text AS at FROM ${registry}.applied ORDER BY name`,
        )
      ).rows as { name: string; sha256: string; at: string }[];
    const once = await rows();
    expect(once.map((row) => row.name)).toContain(ERASURE_FILE.name);
    await migrateCustomerAccountLifecycle(w.f.owner);
    expect(await rows()).toEqual(once);
  });

  test('applying the file by hand a second time is refused, and replaces and creates nothing', async () => {
    const signatures = [...REPLACED, REACH];
    const read = async () => {
      const db = (await w.f.owner.connect()) as unknown as PoolClient;
      try {
        return await states(db, signatures);
      } finally {
        db.release();
      }
    };
    const first = await read();
    await expect(w.f.owner.query(erasureSql())).rejects.toThrow(/prerequisite function differs/);
    expect(await read()).toEqual(first);
  });
});

describe('a person who left every workspace files an erasure request', () => {
  test('gone files through the account command and gets a reference and a due date', async () => {
    goneFiled = await account('gone', 'file_erasure', {}, goneCommand);
    expect(goneFiled).toMatchObject({ operation: 'file_erasure', changed: true });
    expect(goneFiled.reference).toMatch(/^ER-\d{6}$/);
    expect(Date.parse(String(goneFiled.dueAt))).toBeGreaterThan(
      Date.parse(String(goneFiled.filedAt)),
    );
    expect(await erasureCount('gone')).toBe(1);
  });

  test('the chain is the earliest workspace they ever held, written once, and the events land there with ids and a type only', async () => {
    expect(await chainOf('gone')).toEqual([w.W]);
    const events = (
      await w.f.owner.query(
        `SELECT tenant_id,type,payload FROM app.domain_event
         WHERE aggregate_type='customer_account_lifecycle' AND aggregate_id=$1 ORDER BY occurred_at,id`,
        [w.principals.gone],
      )
    ).rows as { tenant_id: string; type: string; payload: Record<string, unknown> }[];
    expect(events.map((event) => event.type)).toEqual(['customer.account.erasure_requested']);
    expect(events[0]!.tenant_id).toBe(w.W);
    expect(Object.keys(events[0]!.payload).sort()).toEqual(
      Object.keys(events[0]!.payload)
        .filter((key) => /id$|_kind$|^request_id$/.test(key))
        .sort(),
    );
  });

  test('the sample staff team sees it in the existing queue, as received', async () => {
    const item = (await queue('sample')).find((entry) => entry.principalId === w.principals.gone);
    expect(item).toMatchObject({ status: 'received' });
    expect(await queued('real', 'gone')).toBe(false);
  });

  test('the person sees only the existing state: reference, dates, status and the staff note, with no id and no list', async () => {
    const state = (await w.row('gone', 'SELECT customer.account_lifecycle_state() AS r')).r as {
      erasure: Row;
    };
    expect(Object.keys(state.erasure).sort()).toEqual([
      'dueAt',
      'filedAt',
      'note',
      'reference',
      'status',
    ]);
    expect(state.erasure).toMatchObject({
      reference: goneFiled.reference,
      status: 'received',
      note: null,
    });
    const request = await requestOf('gone');
    expect(JSON.stringify(state)).not.toContain(request);
    for (const id of written.gone!) expect(JSON.stringify(state)).not.toContain(id);
  });

  test('CONTROL (holds on main too): a person who never had a workspace is still refused with the same text, and nothing is written', async () => {
    const counts = async () =>
      (
        await w.f.owner.query(
          'SELECT (SELECT count(*) FROM customer_private.erasure_request)::int AS n,(SELECT count(*) FROM customer_private.account_chain)::int AS c',
        )
      ).rows[0] as { n: number; c: number };
    const tenants = (await w.f.owner.query('SELECT count(*)::int AS n FROM app.tenant')).rows[0].n;
    const was = await counts();
    expect(await accountAttempt('stranger', 'file_erasure')).toMatchObject({
      ok: false,
      code: '23514',
      message: noWorkspace,
    });
    expect(await counts()).toEqual(was);
    expect((await w.f.owner.query('SELECT count(*)::int AS n FROM app.tenant')).rows[0].n).toBe(
      tenants,
    );
  });

  test('CONTROL (holds on main too): any input key is refused, so the person can name no request, no person and no workspace', async () => {
    const was = await erasureCount('gone');
    for (const input of [
      { principalId: w.principals.olive },
      { workspaceId: w.W },
      { requestIds: written.gone },
      { reference: 'ER-000001' },
    ])
      expect(await accountAttempt('gone', 'file_erasure', input)).toMatchObject({
        ok: false,
        code: '22023',
        message: 'Invalid account command',
      });
    expect(await erasureCount('gone')).toBe(was);
  });
});

describe('replay, reuse and filing again', () => {
  test('the same command answers with the first result and writes nothing more', async () => {
    const counts = async () =>
      (
        await w.f.owner.query(
          `SELECT (SELECT count(*) FROM customer_private.account_lifecycle_request)::int AS requests,
           (SELECT count(*) FROM app.domain_event)::int AS events`,
        )
      ).rows[0];
    const was = await counts();
    expect(await account('gone', 'file_erasure', {}, goneCommand)).toEqual(goneFiled);
    expect(await counts()).toEqual(was);
  });

  test('an open request is reused by a new command, and the person still has one request', async () => {
    const again = await account('gone', 'file_erasure');
    expect(again).toMatchObject({ changed: false, reference: goneFiled.reference });
    expect(await erasureCount('gone')).toBe(1);
  });

  test('after staff complete a request a new one can be filed, for a person who left every workspace', async () => {
    const first = await account('redo', 'file_erasure');
    expect(first.changed).toBe(true);
    const request = (await requestOf('redo'))!;
    await transition('sample', request, 'received', 'in_progress');
    const done = await transition(
      'sample',
      request,
      'in_progress',
      'completed',
      'Words removed by hand from the request and the withdrawal reason; the request row, ids and times are kept',
    );
    expect(done).toMatchObject({ status: 'completed', changed: true });
    const second = await account('redo', 'file_erasure');
    expect(second.changed).toBe(true);
    expect(second.reference).not.toBe(first.reference);
    expect(await erasureCount('redo')).toBe(2);
    expect(await chainOf('redo')).toEqual([w.W]);
  });
});

// Closing an account uses the same account chain, so the same fallback applies. Closing deletes nothing and the undo window is
// unchanged. This is a consequence of the owner's decision to let a removed member hold an erasure request, recorded here.
describe('a person who left every workspace can also close the account and undo it', () => {
  test('both work, use the former workspace as the chain, and no record anywhere is changed', async () => {
    const records = HISTORY_TABLES.filter(
      (table) => !['app.domain_event', 'app.audit_event', 'app.outbox'].includes(table),
    );
    const was = await digest(w.f.owner, records);
    expect(await account('back', 'close', { confirmation: 'Close my account' })).toMatchObject({
      changed: true,
      status: 'closed',
    });
    expect(await account('back', 'undo')).toMatchObject({ changed: true, status: 'active' });
    expect(await chainOf('back')).toEqual([w.W]);
    expect(await digest(w.f.owner, records)).toEqual(was);
  });

  // Owner decision, 11 Nov 2026, relayed by Guardian S40: "Allow self-close (Recommended)". A person removed by the workspace owner,
  // and a person whose only access was revoked before they wrote anything, close and undo themselves like a person who left.
  // Before the erasure file both are refused with the privacy contact text, so these two fail on main like the case above.
  const lifecycleEvents = async (person: string) =>
    (
      await w.f.owner.query(
        `SELECT tenant_id FROM app.domain_event WHERE aggregate_type='customer_account_lifecycle' AND aggregate_id=$1`,
        [w.principals[person]],
      )
    ).rows.map((row) => row.tenant_id as string);

  test('a person the workspace owner removed can close and undo too, repeatedly, and every event lands in the workspace they left', async () => {
    await w.revoke('olive', w.W, w.members.rita!);
    expect((await w.listRequests('rita')).ids).toEqual([]);
    const records = HISTORY_TABLES.filter(
      (table) => !['app.domain_event', 'app.audit_event', 'app.outbox'].includes(table),
    );
    const was = await digest(w.f.owner, records);
    for (let round = 0; round < 2; round++) {
      expect(await account('rita', 'close', { confirmation: 'Close my account' })).toMatchObject({
        changed: true,
        status: 'closed',
      });
      expect(await account('rita', 'undo')).toMatchObject({ changed: true, status: 'active' });
    }
    expect(await chainOf('rita')).toEqual([w.W]);
    const events = await lifecycleEvents('rita');
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(new Set(events)).toEqual(new Set([w.W]));
    expect(await digest(w.f.owner, records)).toEqual(was);
  });

  test('a person whose only access was revoked before they wrote any request can close and undo too', async () => {
    const memberId = await w.join('olive', 'bea', w.W);
    await w.revoke('olive', w.W, memberId);
    expect(
      (
        await w.f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.owned_request WHERE principal_id=$1',
          [w.principals.bea],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(await account('bea', 'close', { confirmation: 'Close my account' })).toMatchObject({
      changed: true,
      status: 'closed',
    });
    expect(await account('bea', 'undo')).toMatchObject({ changed: true, status: 'active' });
    expect(await chainOf('bea')).toEqual([w.W]);
    expect(new Set(await lifecycleEvents('bea'))).toEqual(new Set([w.W]));
  });

  test('back then files an erasure request, which the reach cases below use', async () => {
    expect(await account('back', 'file_erasure')).toMatchObject({ changed: true });
  });
});

describe('the removed member is not given access back by filing (owner decision: "No, workspace decides (Recommended)")', () => {
  test('list, detail, withdraw, restore and withdrawals answer exactly as before the person filed', async () => {
    expect(await erasureCount('gone')).toBe(1);
    expect(readsBefore).toBeDefined();
    expect(await readsOf('gone', written.gone![0]!)).toEqual(readsBefore);
    // the same for the request that was withdrawn and the one that staff revoked
    for (const id of [written.gone![1]!, written.gone![2]!]) {
      const now = await readsOf('gone', id);
      expect(now.detail).toContain('Private request unavailable');
      expect(now.withdraw).toContain('Request is not available');
      expect(now.restore).toContain('Request is not available');
    }
  });

  test('filing writes no withdrawal, no revocation and no request row, and changes no member row', async () => {
    const tables = [
      'customer_private.owned_request',
      'customer_private.request_revocation',
      'customer_private.request_withdrawal_event',
      'customer_private.workspace_member',
      'customer_private.workspace_access_revocation',
      'customer.membership',
    ];
    const was = await digest(w.f.owner, tables);
    await account('gone', 'file_erasure');
    expect(await digest(w.f.owner, tables)).toEqual(was);
  });
});

describe('the staff reach list', () => {
  test('lists every request the person wrote, found by author, including those whose author is no longer a member, with the flags', async () => {
    const result = await reach('sample', (await requestOf('gone'))!);
    expect(result).toMatchObject({
      reference: goneFiled.reference,
      removalIsManual: true,
      total: 3,
      // Owner decision, 11 Nov 2026, relayed by Guardian S40: "Owning team sees all ids (Recommended)". The count of other
      // tenants is gone from the answer; every id is listed. Three requests fit one page, so there is no next page.
      nextAfter: null,
    });
    expect(result).not.toHaveProperty('otherTenants');
    expect(result.requests.map((item) => item.id)).toEqual(written.gone);
    const order = (
      await w.f.owner.query(
        'SELECT id FROM customer_private.owned_request WHERE principal_id=$1 ORDER BY created_at,id',
        [w.principals.gone],
      )
    ).rows.map((row) => row.id);
    expect(result.requests.map((item) => item.id)).toEqual(order);
    const [plain, withdrawn, revoked] = result.requests;
    for (const item of result.requests) {
      expect(Object.keys(item).sort()).toEqual([
        'authorStillMember',
        'createdAt',
        'id',
        'missionId',
        'retentionUntil',
        'revoked',
        'side',
        'status',
        'withdrawn',
        'workspaceId',
      ]);
      expect(item).toMatchObject({ workspaceId: w.W, side: 'sample', authorStillMember: false });
      expect(item.missionId).toBe(await w.missionOf(item.id));
      expect(item.status).toBe(
        (await w.f.owner.query('SELECT status FROM app.mission WHERE id=$1', [item.missionId]))
          .rows[0].status,
      );
      const retention = Date.parse(String(item.retentionUntil));
      expect(retention).toBeGreaterThan(Date.now());
      expect(retention).toBeLessThan(Date.now() + 31 * 86400000);
    }
    expect(plain).toMatchObject({ revoked: false, withdrawn: false });
    expect(withdrawn).toMatchObject({ revoked: false, withdrawn: true });
    expect(revoked).toMatchObject({ revoked: true, withdrawn: false });
  });

  test('never lists another person: back and redo each get only their own, and gone gets none of theirs', async () => {
    const mine = new Set(written.gone);
    const backList = await reach('sample', (await requestOf('back'))!);
    expect(backList.requests.map((item) => item.id)).toEqual(written.back);
    const redoList = await reach('sample', (await requestOf('redo'))!);
    expect(redoList.requests.map((item) => item.id)).toEqual(written.redo);
    for (const item of [...backList.requests, ...redoList.requests])
      expect(mine.has(item.id)).toBe(false);
    for (const item of (await reach('sample', (await requestOf('gone'))!)).requests)
      expect([...(written.back ?? []), ...(written.redo ?? [])]).not.toContain(item.id);
  });

  test('carries no word the person wrote and no person id', async () => {
    const result = await reach('sample', (await requestOf('gone'))!);
    const body = JSON.stringify(result);
    for (const forbidden of [
      w.principals.gone!,
      'principalId',
      'principal_id',
      'Synthetic hotel towels',
      'Test Person',
      'mission@example.invalid',
      'Example Test Company',
      'Sell in a new market',
      reason,
    ])
      expect(body).not.toContain(forbidden);
  });

  test('reads only: no row anywhere changes', async () => {
    const was = {
      history: await digest(w.f.owner, HISTORY_TABLES),
      erasure: await digest(w.f.owner, ERASURE_TABLES),
    };
    await reach('sample', (await requestOf('gone'))!);
    expect({
      history: await digest(w.f.owner, HISTORY_TABLES),
      erasure: await digest(w.f.owner, ERASURE_TABLES),
    }).toEqual(was);
  });

  test('re-admission: a request whose author is invited again shows authorStillMember true, and the person reads it again', async () => {
    const request = (await requestOf('back'))!;
    expect((await reach('sample', request)).requests[0]).toMatchObject({
      authorStillMember: false,
    });
    expect((await w.listRequests('back')).ids).toEqual([]);
    await w.join('olive', 'back', w.W);
    expect((await reach('sample', request)).requests[0]).toMatchObject({ authorStillMember: true });
    expect((await w.listRequests('back')).ids).toEqual(written.back);
    // the erasure request itself did not change, and the old member row is still there beside the new one
    expect(await erasureCount('back')).toBe(1);
    expect(
      (
        await w.f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.workspace_member WHERE principal_id=$1 AND tenant_id=$2',
          [w.principals.back, w.W],
        )
      ).rows[0].n,
    ).toBe(2);
  });

  test('without the withdrawal module nothing is reported withdrawn and the list still works', async () => {
    await w.f.owner.query(
      'ALTER TABLE customer_private.request_withdrawal_event RENAME TO request_withdrawal_event_away',
    );
    try {
      const result = await reach('sample', (await requestOf('gone'))!);
      expect(result.requests).toHaveLength(3);
      expect(result.requests.map((item) => item.withdrawn)).toEqual([false, false, false]);
    } finally {
      await w.f.owner.query(
        'ALTER TABLE customer_private.request_withdrawal_event_away RENAME TO request_withdrawal_event',
      );
    }
    expect((await reach('sample', (await requestOf('gone'))!)).requests[1]).toMatchObject({
      withdrawn: true,
    });
  });
});

describe('who may use the reach list, and what a refusal says', () => {
  test('a customer session cannot execute it, for a removed member and for a current member alike', async () => {
    const request = (await requestOf('gone'))!;
    for (const person of ['gone', 'olive', 'lena']) {
      const outcome = await w.attempt(person, 'SELECT customer.erasure_request_reach($1) AS r', [
        request,
      ]);
      const queueRefusal = await w.attempt(
        person,
        'SELECT customer.erasure_queue(NULL,25,NULL) AS r',
      );
      expect(outcome, person).toMatchObject({ ok: false, code: '42501' });
      expect(text(outcome), person).toBe(text(queueRefusal));
    }
  });

  test('only the application login holds the right: not the auth login, not PUBLIC', async () => {
    const request = (await requestOf('gone'))!;
    await expect(
      w.f.auth.query('SELECT customer.erasure_request_reach($1)', [request]),
    ).rejects.toMatchObject({ code: '42501' });
    const rights = (
      await w.f.owner.query(
        `SELECT has_function_privilege('corridra_runtime',$1::regprocedure,'EXECUTE') AS runtime,
          has_function_privilege('corridra_auth',$1::regprocedure,'EXECUTE') AS auth,has_function_privilege('public',$1::regprocedure,'EXECUTE') AS pub`,
        [REACH],
      )
    ).rows[0];
    expect(rights).toEqual({ runtime: true, auth: false, pub: false });
  });

  test('staff without a fresh authenticator check are refused, as the queue refuses them', async () => {
    const request = (await requestOf('gone'))!;
    const user = staffUser('sample');
    await w.f.owner.query(
      `UPDATE identity.assurance SET verified_at=now()-interval '1 hour' WHERE session_id=$1`,
      [user.sessionId],
    );
    try {
      const asked = await refused(
        rawContext(w.f.runtime, user.ctx, 'SELECT customer.erasure_request_reach($1)', [request]),
      );
      const queueRefusal = await refused(
        rawContext(w.f.runtime, user.ctx, 'SELECT customer.erasure_queue(NULL,100,NULL)'),
      );
      expect(asked).toEqual(denied);
      expect(asked).toEqual(queueRefusal);
    } finally {
      await freshSession('sample');
    }
  });

  test('staff who are not owner or admin are refused with the same words', async () => {
    const request = (await requestOf('gone'))!;
    expect(await refused(reach('operator', request))).toEqual(denied);
  });

  test('an unknown id, the id of a person, and an id on the other side all answer exactly as erasure_transition does', async () => {
    const unknown = await refused(reach('sample', randomUUID()));
    const viaTransition = await refused(
      transition('sample', randomUUID(), 'received', 'in_progress'),
    );
    expect(unknown).toEqual(notFound);
    expect(unknown).toEqual(viaTransition);
    // a person id is not an erasure request id: it is not found, so it is no way to learn anything about a person
    expect(await refused(reach('sample', w.principals.gone!))).toEqual(notFound);
    // the other side: real staff asking for a sample request
    const wrongSide = await refused(reach('real', (await requestOf('gone'))!));
    expect(wrongSide).toEqual(notFound);
    expect(Buffer.from(wrongSide.message)).toEqual(Buffer.from(unknown.message));
    // no id at all
    expect(await refused(staff('sample', 'SELECT customer.erasure_request_reach(NULL)'))).toEqual(
      notFound,
    );
  });
});

describe('one team handles the whole request (owner decision: "One team only (Recommended)")', () => {
  test('a person with a sample chain who wrote a request in a real workspace is handled by real staff only', async () => {
    expect(await queued('real', 'mover')).toBe(true);
    expect(await queued('sample', 'mover')).toBe(false);
    const request = (await requestOf('mover'))!;
    expect(await refused(transition('sample', request, 'received', 'in_progress'))).toEqual(
      notFound,
    );
    expect(await refused(reach('sample', request))).toEqual(notFound);
    expect(
      (
        await w.f.owner.query(
          'SELECT state FROM customer_private.erasure_status_event WHERE request_id=$1 ORDER BY seq',
          [request],
        )
      ).rows.map((row) => row.state),
    ).toEqual(['received']);
  });

  // Owner decision, 11 Nov 2026, relayed by Guardian S40: "Owning team sees all ids (Recommended)". This case used to expect
  // total 1 with the other two requests only counted in otherTenants, and the two ids absent from the answer. It now expects all
  // three ids, each with its own workspace and side.
  test('real staff list every request of the person in every workspace and both sides, with the side of each', async () => {
    const result = await reach('real', (await requestOf('mover'))!);
    expect(result).toMatchObject({ removalIsManual: true, total: 3, nextAfter: null });
    expect(result).not.toHaveProperty('otherTenants');
    expect(result.requests.map((item) => item.id)).toEqual(await writtenInOrder('mover'));
    expect(result.requests.map((item) => item.id).sort()).toEqual(
      [written.mover![0]!, written.mover![1]!, realSideRequest].sort(),
    );
    const byId = Object.fromEntries(result.requests.map((item) => [item.id, item]));
    expect(byId[realSideRequest]).toMatchObject({
      workspaceId: realWorkspace,
      side: 'real',
      authorStillMember: false,
      revoked: false,
      withdrawn: false,
    });
    // written in the workspace they were later removed from, which is real now, with its mission in the sample staff workspace
    expect(byId[written.mover![0]!]).toMatchObject({
      workspaceId: realWorkspace,
      side: 'real',
      authorStillMember: false,
    });
    expect(byId[written.mover![1]!]).toMatchObject({ workspaceId: sampleOwn, side: 'sample' });
  });

  test('real staff move it along, and it stays with them', async () => {
    const request = (await requestOf('mover'))!;
    expect(await transition('real', request, 'received', 'in_progress')).toMatchObject({
      status: 'in_progress',
      changed: true,
    });
    expect(await queued('real', 'mover')).toBe(true);
    expect(await queued('sample', 'mover')).toBe(false);
  });

  test('no request is ever in both queues, and a sample-only person stays with sample staff', async () => {
    for (const person of ['gone', 'back', 'redo', 'mover'] as const) {
      const sample = await queued('sample', person);
      const real = await queued('real', person);
      expect(sample !== real, person).toBe(true);
    }
    expect(await queued('sample', 'gone')).toBe(true);
    expect(await queued('real', 'gone')).toBe(false);
  });

  test('the scope rule, asked directly for each side and each person', async () => {
    const ask = async (person: string, tenant: string) => {
      const db = await w.f.owner.connect();
      try {
        await db.query('BEGIN');
        await db.query("SELECT set_config('corridra.tenant_id',$1,true)", [tenant]);
        const yes = (
          await db.query('SELECT customer_private.erasure_in_scope($1) AS yes', [
            w.principals[person],
          ])
        ).rows[0].yes as boolean;
        await db.query('ROLLBACK');
        return yes;
      } finally {
        db.release();
      }
    };
    expect(await ask('mover', w.f.tenantA)).toBe(false);
    expect(await ask('mover', w.f.tenantB)).toBe(true);
    expect(await ask('gone', w.f.tenantA)).toBe(true);
    expect(await ask('gone', w.f.tenantB)).toBe(false);
    // a person with no chain row is in no queue at all
    expect(await ask('stranger', w.f.tenantA)).toBe(false);
    expect(await ask('stranger', w.f.tenantB)).toBe(false);
  });
});

// Owner decision, 11 Nov 2026, relayed by Guardian S40: "Owning team sees all ids (Recommended)". The team that owns an erasure
// request lists every request id of that person, whatever the workspace, side or mission tenant, a page of 100 at a time by a
// (created_at, id) cursor, so erasure can be complete. Every case here calls the new function, so every case fails on main.
describe('the owning team reaches every request id of the person, in pages', () => {
  const REACH_KEYS = ['nextAfter', 'reference', 'removalIsManual', 'requests', 'total'];
  const ITEM_KEYS = [
    'authorStillMember',
    'createdAt',
    'id',
    'missionId',
    'retentionUntil',
    'revoked',
    'side',
    'status',
    'withdrawn',
    'workspaceId',
  ];
  let pagerRequest: string;
  let blendRequest: string;
  let soloRequest: string;

  beforeAll(async () => {
    // Pager: 230 requests, so the pages are 100, 100 and 30. Seven of them, the 98th to the 104th, share one created_at, so the
    // tie straddles the end of the first page. The rows are rewritten the way the fixture wrote them, with the guards off.
    await bulkOwnedRequests(w, { person: 'pager', workspace: pagerWorkspace, count: 230 });
    const db = await w.f.owner.connect();
    try {
      await db.query('SET session_replication_role = replica');
      await db.query(
        `WITH ranked AS (SELECT id,created_at,row_number() OVER (ORDER BY created_at,id) AS n
          FROM customer_private.owned_request WHERE principal_id=$1)
         UPDATE customer_private.owned_request o SET created_at=(SELECT r.created_at FROM ranked r WHERE r.n=98)
         WHERE o.id IN (SELECT r.id FROM ranked r WHERE r.n BETWEEN 98 AND 104)`,
        [w.principals.pager],
      );
    } finally {
      await db.query('RESET session_replication_role').catch(() => undefined);
      db.release();
    }
    // Blend: the mixed person. One request in the real customer workspace, with its mission in the real staff workspace, and
    // three in their own sample workspace. Their first workspace is a sample one, so the real request is what makes the real
    // team the owner of the erasure request.
    await bulkOwnedRequests(w, {
      person: 'blend',
      workspace: realWorkspace,
      count: 1,
      missionTenant: w.f.tenantB,
    });
    await bulkOwnedRequests(w, { person: 'blend', workspace: blendWorkspace, count: 3 });
    // Solo: sample requests only, one with its mission in each staff workspace.
    await bulkOwnedRequests(w, { person: 'solo', workspace: soloWorkspace, count: 1 });
    await bulkOwnedRequests(w, {
      person: 'solo',
      workspace: soloWorkspace,
      count: 1,
      missionTenant: w.f.tenantB,
    });
    for (const person of ['pager', 'blend', 'solo']) await account(person, 'file_erasure');
    pagerRequest = (await requestOf('pager'))!;
    blendRequest = (await requestOf('blend'))!;
    soloRequest = (await requestOf('solo'))!;
  }, 600000);

  test('230 requests come in pages of 100, 100 and 30, with no id repeated or lost, the total on every page and nextAfter null on the last', async () => {
    const pages = await reachPages('sample', pagerRequest);
    expect(pages.map((page) => page.requests.length)).toEqual([100, 100, 30]);
    expect(pages.map((page) => page.total)).toEqual([230, 230, 230]);
    const ids = pages.flatMap((page) => page.requests.map((item) => item.id));
    expect(new Set(ids).size).toBe(230);
    expect(ids).toEqual(await writtenInOrder('pager'));
    for (const page of pages) {
      expect(Object.keys(page).sort()).toEqual(REACH_KEYS);
      for (const item of page.requests) {
        expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
        expect(item).toMatchObject({ workspaceId: pagerWorkspace, side: 'sample' });
      }
    }
    // nextAfter is the (createdAt, id) of the last row of the page, and null, not absent, after the last page
    for (const page of pages.slice(0, 2)) {
      const last = page.requests[99]!;
      expect(page.nextAfter).toEqual({ createdAt: last.createdAt, id: last.id });
    }
    expect(pages[2]).toHaveProperty('nextAfter', null);
  });

  test('seven requests that share one created_at across the end of a page are neither repeated nor skipped', async () => {
    const tied = (
      await w.f.owner.query(
        `WITH ranked AS (SELECT id,created_at,row_number() OVER (ORDER BY created_at,id) AS n
          FROM customer_private.owned_request WHERE principal_id=$1)
         SELECT count(DISTINCT created_at)::int AS stamps,array_agg(id::text ORDER BY id) AS ids,
          (SELECT r.id FROM ranked r WHERE r.n=100) AS last_of_first,(SELECT r.id FROM ranked r WHERE r.n=101) AS first_of_second
         FROM ranked WHERE n BETWEEN 98 AND 104`,
        [w.principals.pager],
      )
    ).rows[0] as { stamps: number; ids: string[]; last_of_first: string; first_of_second: string };
    expect(tied.stamps).toBe(1);
    const [first, second] = await reachPages('sample', pagerRequest);
    // the cursor falls inside the tie: both sides of the page end carry the same time, and the id breaks it
    expect(first!.requests[99]!.id).toBe(tied.last_of_first);
    expect(second!.requests[0]!.id).toBe(tied.first_of_second);
    expect(second!.requests[0]!.createdAt).toBe(first!.requests[99]!.createdAt);
    expect(second!.requests[0]!.id > first!.requests[99]!.id).toBe(true);
    const listedTie = [...first!.requests, ...second!.requests]
      .filter((item) => tied.ids.includes(item.id))
      .map((item) => item.id);
    expect(listedTie).toEqual(tied.ids);
  });

  test('a cursor on the 130th row leaves exactly 100, with no next page, and one on the last row leaves none', async () => {
    const cursorAt = async (position: number) =>
      (
        await w.f.owner.query(
          `SELECT to_jsonb(x) AS c FROM (SELECT created_at AS "createdAt",id FROM customer_private.owned_request
            WHERE principal_id=$1 ORDER BY created_at,id OFFSET $2 LIMIT 1) x`,
          [w.principals.pager, position - 1],
        )
      ).rows[0].c as Cursor;
    const exactly = await reach('sample', pagerRequest, await cursorAt(130));
    expect(exactly.requests).toHaveLength(100);
    expect(exactly).toMatchObject({ total: 230, nextAfter: null });
    const past = await reach('sample', pagerRequest, await cursorAt(230));
    expect(past).toMatchObject({ total: 230, requests: [], nextAfter: null });
  });

  test('a cursor with only one of its two parts is refused, whichever part is missing, and says so in plain words', async () => {
    const cursor = (await reach('sample', pagerRequest)).nextAfter!;
    for (const params of [
      [pagerRequest, cursor.createdAt, null],
      [pagerRequest, null, cursor.id],
    ])
      expect(
        await refused(staff('sample', 'SELECT customer.erasure_request_reach($1,$2,$3)', params)),
      ).toEqual({
        code: '22023',
        message: 'Give both parts of the cursor, or neither',
      });
    // Authority is checked before the cursor: an unknown id with half a cursor is still just not found
    expect(
      await refused(
        staff('sample', 'SELECT customer.erasure_request_reach($1,$2,$3)', [
          randomUUID(),
          cursor.createdAt,
          null,
        ]),
      ),
    ).toEqual(notFound);
  });

  test('a mixed person, one real request and three sample ones, has all four ids reachable by the owning real team, each with its side', async () => {
    expect(await queued('real', 'blend')).toBe(true);
    expect(await queued('sample', 'blend')).toBe(false);
    const [realId] = (
      await w.f.owner.query(
        'SELECT id FROM customer_private.owned_request WHERE principal_id=$1 AND workspace_id=$2',
        [w.principals.blend, realWorkspace],
      )
    ).rows.map((row) => row.id as string);
    const all = await writtenInOrder('blend');
    expect(all).toHaveLength(4);
    const result = await reach('real', blendRequest);
    expect(result).toMatchObject({ removalIsManual: true, total: 4, nextAfter: null });
    expect(result.requests.map((item) => item.id)).toEqual(all);
    expect(Object.fromEntries(result.requests.map((item) => [item.id, item.side]))).toEqual(
      Object.fromEntries(all.map((id) => [id, id === realId ? 'real' : 'sample'])),
    );
    expect(result.requests.filter((item) => item.workspaceId === blendWorkspace)).toHaveLength(3);
    expect(result.requests.find((item) => item.id === realId)).toMatchObject({
      workspaceId: realWorkspace,
      side: 'real',
    });
    // the listed side follows the workspace of the request, never the staff workspace that asked
    for (const item of result.requests.filter((entry) => entry.id !== realId))
      expect(item).toMatchObject({ workspaceId: blendWorkspace, side: 'sample' });
  });

  test('the mixed person carries exactly the allowed keys: no word, name, email, company, objective, reason, person id or tenant id', async () => {
    const result = await reach('real', blendRequest);
    expect(Object.keys(result).sort()).toEqual(REACH_KEYS);
    for (const item of result.requests) expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
    const body = JSON.stringify(result);
    for (const forbidden of [
      w.principals.blend!,
      'principalId',
      'principal_id',
      'tenant',
      'Synthetic hotel towels',
      'Test Person',
      'mission@example.invalid',
      'Example Test Company',
      'Sell in a new market',
      reason,
    ])
      expect(body).not.toContain(forbidden);
    // no staff workspace appears: the only workspace ids are the two customer workspaces of the person
    for (const item of result.requests)
      expect([realWorkspace, blendWorkspace]).toContain(item.workspaceId);
    expect(body).not.toContain(w.f.tenantA);
    expect(body).not.toContain(w.f.tenantB);
  });

  test('sample staff still cannot open the erasure request of the mixed person, and the refusal is the one an unknown id gets', async () => {
    const refusedForSample = await refused(reach('sample', blendRequest));
    expect(refusedForSample).toEqual(notFound);
    const unknown = await refused(reach('sample', randomUUID()));
    expect(Buffer.from(refusedForSample.message)).toEqual(Buffer.from(unknown.message));
    expect(refusedForSample.code).toBe(unknown.code);
    expect(await refused(transition('sample', blendRequest, 'received', 'in_progress'))).toEqual(
      notFound,
    );
    // nor can it page: a cursor changes nothing about who may ask
    const first = await reach('real', blendRequest);
    expect(first.requests.length).toBeGreaterThan(0);
    expect(
      await refused(
        reach('sample', blendRequest, { createdAt: '2000-01-01T00:00:00+00:00', id: randomUUID() }),
      ),
    ).toEqual(notFound);
  });

  test('a person with only sample requests, routed to sample staff, still has every request listed, whichever staff workspace holds its mission', async () => {
    expect(await queued('sample', 'solo')).toBe(true);
    expect(await queued('real', 'solo')).toBe(false);
    const result = await reach('sample', soloRequest);
    expect(result).toMatchObject({ total: 2, nextAfter: null });
    expect(result.requests.map((item) => item.id)).toEqual(await writtenInOrder('solo'));
    for (const item of result.requests)
      expect(item).toMatchObject({ workspaceId: soloWorkspace, side: 'sample' });
    expect(await refused(reach('real', soloRequest))).toEqual(notFound);
  });
});

describe('CONTROL (holds on main too): the erasure file and the other lifecycle files', () => {
  test('the staff erasure functions, the queue output and the account command keep their signatures, owner and grants', async () => {
    for (const signature of [
      'customer.erasure_queue(bigint,integer,text)',
      'customer.erasure_transition(uuid,uuid,text,text,text)',
      'customer.account_lifecycle_command(uuid,text,jsonb)',
      'customer.account_lifecycle_state()',
    ]) {
      const state = await functionState(w.f.owner, signature);
      expect(state, signature).toBeTruthy();
      expect(state!.acl, signature).toContain('corridra_runtime=X');
      expect(state!.acl, signature).not.toContain('corridra_auth');
    }
  });

  test('the queue still returns exactly the staff fields', async () => {
    const items = await queue('sample');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items)
      expect(Object.keys(item).sort()).toEqual([
        'accountStatus',
        'closedAt',
        'daysLeft',
        'dueAt',
        'filedAt',
        'id',
        'note',
        'number',
        'principalId',
        'reference',
        'status',
        'undoUntil',
      ]);
  });
});

describe('guard of the erasure file: the same three states as the other files', () => {
  test('the fingerprint block equals the live one, and the file replaces exactly the two functions it lists', async () => {
    const live = await liveErasureFingerprints(g.owner);
    expect(live).toEqual(
      erasureFingerprints().map((row) => ({
        signature: row.signature,
        fingerprint: row.fingerprint,
        grantees: row.grantees,
      })),
    );
    expect(erasureFingerprints().map((row) => row.signature)).toEqual(REPLACED);
    const sql = stripComments(erasureSql());
    expect([...sql.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_.]+)\(/g)].map((m) => m[1])).toEqual(
      REPLACED.map((s) => s.split('(')[0]),
    );
    expect([...sql.matchAll(/CREATE FUNCTION ([a-z_.]+)\(/g)].map((m) => m[1])).toEqual([
      'customer.erasure_request_reach',
    ]);
    expect(sql).not.toMatch(/pg_get_functiondef/);
    // Outside the function bodies nothing is dropped, truncated, inserted, updated or deleted, and no table is created or altered.
    const topLevel = sql.replace(/\$(fn)\$[\s\S]*?\$\1\$/g, '');
    expect(topLevel).not.toMatch(
      /\b(DROP|TRUNCATE|DELETE|INSERT|UPDATE|ALTER TABLE|CREATE TABLE|CREATE POLICY)\b/,
    );
    // The pieces of the guard: the registry check of the file before it, and the three states.
    expect(sql).toContain(ERASURE_FILE.previous);
    expect(sql).toContain('Removed member erasure skipped');
    expect(sql).toContain('prerequisite function is missing');
    expect(sql).toContain('prerequisite function differs');
    expect(sql).toContain('prerequisite file differs');
    expect(sql).toContain('changed more than function bodies');
  });

  test('MATCHING: both functions are replaced, the new one is created for the application login only, and owner, settings and grants of the two are unchanged', async () => {
    await rolledBack(async (db, notices) => {
      const was = await states(db, REPLACED);
      expect(await reachExists(db)).toBe(false);
      await db.query(erasureSql());
      const now = await states(db, REPLACED);
      for (const signature of REPLACED) {
        expect(without(now[signature]), signature).toEqual(without(was[signature]));
        expect((now[signature] as { prosrc: string }).prosrc, signature).not.toBe(
          (was[signature] as { prosrc: string }).prosrc,
        );
      }
      expect(await reachExists(db)).toBe(true);
      expect(notices).toContain(
        'Removed member erasure: 0 open erasure request(s) move from sample staff to real staff',
      );
      const grants = (
        await db.query(
          `SELECT has_function_privilege('corridra_runtime',$1::regprocedure,'EXECUTE') AS runtime,
            has_function_privilege('corridra_auth',$1::regprocedure,'EXECUTE') AS auth,has_function_privilege('public',$1::regprocedure,'EXECUTE') AS pub`,
          [REACH],
        )
      ).rows[0];
      expect(grants).toEqual({ runtime: true, auth: false, pub: false });
    });
  });

  test('MATCHING: each new body differs from the body it replaces by a few lines only', async () => {
    await rolledBack(async (db) => {
      const was = await states(db, REPLACED);
      await db.query(erasureSql());
      const now = await states(db, REPLACED);
      for (const signature of REPLACED) {
        const old = lines((was[signature] as { prosrc: string }).prosrc);
        const next = lines((now[signature] as { prosrc: string }).prosrc);
        const removed = old.filter((l) => !next.includes(l)).length;
        const added = next.filter((l) => !old.includes(l)).length;
        expect(removed, `${signature}: lines removed`).toBeLessThanOrEqual(4);
        expect(added, `${signature}: lines added`).toBeLessThanOrEqual(12);
        expect(added + removed, `${signature} changed`).toBeGreaterThan(0);
      }
    });
  });

  test('a second run over the new bodies is refused, because they no longer match the fingerprint', async () => {
    await rolledBack(async (db) => {
      await db.query(erasureSql());
      const once = await states(db, [...REPLACED, REACH]);
      await db.query('SAVEPOINT again');
      await expect(db.query(erasureSql())).rejects.toThrow(/prerequisite function differs/);
      await db.query('ROLLBACK TO again');
      expect(await states(db, [...REPLACED, REACH])).toEqual(once);
    });
  });

  test('ABSENT: neither function exists and the registry has no row for the file before it: a notice, nothing changed or created', async () => {
    await rolledBack(async (db, notices) => {
      for (const signature of REPLACED) await db.query(`DROP FUNCTION ${signature}`);
      await db.query(`DELETE FROM ${registry}.applied WHERE name=$1`, [ERASURE_FILE.previous]);
      await db.query(erasureSql());
      expect(notices.some((n) => /skipped/.test(n))).toBe(true);
      for (const signature of REPLACED)
        expect((await states(db, [signature]))[signature], signature).toBeNull();
      expect(await reachExists(db)).toBe(false);
    });
  });

  describe.each(REPLACED)('CHANGED: %s', (signature) => {
    test.each(Object.keys(mutations))(
      '%s is refused and nothing is replaced or created',
      async (what) => {
        await rolledBack(async (db) => {
          await db.query(mutations[what]!(signature));
          const was = await states(db, REPLACED);
          await db.query('SAVEPOINT guarded');
          await expect(db.query(erasureSql())).rejects.toThrow(
            new RegExp(
              `prerequisite function differs: .*${signature.split('(')[0]!.replace('.', '\\.')}`,
            ),
          );
          await db.query('ROLLBACK TO guarded');
          expect(await states(db, REPLACED)).toEqual(was);
          expect(await reachExists(db)).toBe(false);
        });
      },
    );
  });

  test('CHANGED: a function missing while the other exists, all missing while the registry holds the file before it, and another recorded hash are each refused', async () => {
    await rolledBack(async (db) => {
      await db.query(`DROP FUNCTION ${REPLACED[1]}`);
      await db.query('SAVEPOINT partial');
      await expect(db.query(erasureSql())).rejects.toThrow(
        /prerequisite function is missing \(1 of 2 present\)/,
      );
      await db.query('ROLLBACK TO partial');
      expect(await reachExists(db)).toBe(false);
    });
    await rolledBack(async (db) => {
      for (const signature of REPLACED) await db.query(`DROP FUNCTION ${signature}`);
      await db.query('SAVEPOINT damaged');
      await expect(db.query(erasureSql())).rejects.toThrow(
        /prerequisite function is missing \(0 of 2 present\)/,
      );
      await db.query('ROLLBACK TO damaged');
    });
    await rolledBack(async (db) => {
      await db.query(`UPDATE ${registry}.applied SET sha256=repeat('0',64) WHERE name=$1`, [
        ERASURE_FILE.previous,
      ]);
      const was = await states(db, REPLACED);
      await db.query('SAVEPOINT recorded');
      await expect(db.query(erasureSql())).rejects.toThrow(
        new RegExp(`prerequisite file differs: ${ERASURE_FILE.previous}`),
      );
      await db.query('ROLLBACK TO recorded');
      expect(await states(db, REPLACED)).toEqual(was);
      expect(await reachExists(db)).toBe(false);
    });
  });

  test('it needs customer migration 0004 and changes nothing without it', async () => {
    await rolledBack(async (db) => {
      await db.query('DROP FUNCTION customer_private.workspace_member_current(uuid,uuid)');
      const was = await states(db, REPLACED);
      await db.query('SAVEPOINT helper');
      await expect(db.query(erasureSql())).rejects.toThrow(/needs customer migration 0004/);
      await db.query('ROLLBACK TO helper');
      expect(await states(db, REPLACED)).toEqual(was);
      expect(await reachExists(db)).toBe(false);
    });
  });

  test('upgrade from the shipped state: the migrator applies only the new file, records it, and leaves every earlier record, row and control as it was', async () => {
    openErasureFile();
    const tables = [
      'customer_private.owned_request',
      'customer.membership',
      'customer_private.workspace_member',
      'customer_private.workspace_access_revocation',
      'customer_private.erasure_request',
      'customer_private.erasure_status_event',
      'customer_private.account_chain',
      'customer_private.account_lifecycle_control',
      'app.domain_event',
      'app.audit_event',
      'app.outbox',
    ];
    const rows = async () =>
      (
        await g.owner.query(
          `SELECT name,sha256,applied_at::text AS at FROM ${registry}.applied ORDER BY name`,
        )
      ).rows as {
        name: string;
        sha256: string;
        at: string;
      }[];
    const was = { rows: await rows(), tables: await digest(g.owner, tables) };
    expect(was.rows.map((row) => row.name)).toEqual(LIFECYCLE_FILES);
    await migrateCustomerAccountLifecycle(g.owner);
    const now = await rows();
    expect(now.slice(0, 4)).toEqual(was.rows);
    expect(now.map((row) => row.name)).toEqual([...LIFECYCLE_FILES, ERASURE_FILE.name]);
    expect(now[4]!.sha256).toBe(sha(erasureSql()));
    expect(await digest(g.owner, tables)).toEqual(was.tables);
    expect(
      (await g.owner.query(`SELECT to_regprocedure('${REACH}') IS NOT NULL AS present`)).rows[0]
        .present,
    ).toBe(true);
    // the module control row count is the same: installing opens and closes nothing
    expect(
      (
        await g.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.account_lifecycle_control',
        )
      ).rows[0].n,
    ).toBe(0);
  }, 600000);
});

describe('cost: the scope rule and the reach list on a large database', () => {
  const percentile = (values: number[], p: number) =>
    [...values].sort((a, b) => a - b)[
      Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
    ]!;
  type Plan = Record<string, unknown> & { Plans?: Plan[] };
  const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];
  const LARGE = [
    'customer_private.owned_request',
    'customer.membership',
    'customer_private.workspace_member',
    'customer_private.workspace_access_revocation',
  ];

  beforeAll(async () => {
    await account('heavy', 'file_erasure');
    await bulkOwnedRequests(w, { person: 'heavy', workspace: heavyWorkspace, count: 3000 });
    // 20,000 requests of other people, and 3,000 memberships and members with 1,000 revocations elsewhere: only weight.
    const db = await w.f.owner.connect();
    try {
      await db.query('SET session_replication_role = replica');
      await db.query(
        `INSERT INTO customer_private.owned_request(principal_id,command_id,workspace_id,mission_tenant_id,mission_id,request_key,brief_digest,receipt_hash)
         SELECT gen_random_uuid(),gen_random_uuid(),$1,$2,gen_random_uuid(),gen_random_uuid(),
          encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex')
         FROM generate_series(1,20000)`,
        [w.W, w.f.tenantA],
      );
      await db.query(
        `INSERT INTO customer.membership(tenant_id,principal_id,role) SELECT $1,gen_random_uuid(),'member' FROM generate_series(1,3000)`,
        [w.W],
      );
      await db.query(
        `CREATE TEMP TABLE m AS SELECT gen_random_uuid() AS id,gen_random_uuid() AS iid,gen_random_uuid() AS person FROM generate_series(1,3000)`,
      );
      await db.query(
        'INSERT INTO customer_private.workspace_member(id,tenant_id,principal_id,source_invitation_id) SELECT id,$1,person,iid FROM m',
        [w.W],
      );
      await db.query(
        'INSERT INTO customer_private.workspace_access_revocation(tenant_id,member_id,actor_id) SELECT $1,id,$2 FROM (SELECT id FROM m LIMIT 1000) x',
        [w.W, w.principals.olive],
      );
      await db.query('DROP TABLE m');
    } finally {
      await db.query('RESET session_replication_role').catch(() => undefined);
      db.release();
    }
    for (const table of LARGE) await w.f.owner.query(`ANALYZE ${table}`);
  }, 600000);

  // The body of the scope rule as it is stored, with the person as a parameter, planned in the staff workspace's own session.
  async function explainScope(person: string) {
    const body = String((await functionState(w.f.owner, REPLACED[1]!))!.prosrc);
    expect(body.match(/\bperson\b/g)?.length).toBeGreaterThanOrEqual(4);
    const db = await w.f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('corridra.tenant_id',$1,true)", [w.f.tenantA]);
      const result = await db.query(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${body.replace(/\bperson\b/g, () => '$1::uuid')}`,
        [w.principals[person]],
      );
      await db.query('ROLLBACK');
      const plan = (result.rows[0]['QUERY PLAN'] as { Plan: Plan }[])[0]!.Plan;
      return nodes(plan);
    } finally {
      db.release();
    }
  }

  test('the scope rule reads the request, member and revocation tables by index, never by scanning them', async () => {
    const all = await explainScope('gone');
    const scanned = all
      .filter((n) => n['Node Type'] === 'Seq Scan')
      .map((n) => String(n['Relation Name']));
    for (const table of [
      'owned_request',
      'membership',
      'workspace_member',
      'workspace_access_revocation',
    ])
      expect(scanned, `sequential scan of ${table}`).not.toContain(table);
    const touched = all.map((n) => String(n['Relation Name'])).filter(Boolean);
    expect(touched).toContain('owned_request');
  });

  test('the scope rule answers in a few milliseconds, and still gives the same answers on the large database', async () => {
    const db = await w.f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('corridra.tenant_id',$1,true)", [w.f.tenantA]);
      const run = async () => {
        const start = performance.now();
        const answer = (
          await db.query('SELECT customer_private.erasure_in_scope($1) AS yes', [w.principals.gone])
        ).rows[0].yes;
        return { answer, ms: performance.now() - start };
      };
      await run();
      const times: number[] = [];
      for (let i = 0; i < 30; i++) {
        const { answer, ms } = await run();
        expect(answer).toBe(true);
        times.push(ms);
      }
      expect(percentile(times, 0.95)).toBeLessThan(100);
      await db.query('ROLLBACK');
    } finally {
      db.release();
    }
  });

  // This case used to say that the first 100 were all the list gave, with no second page. The cap of 100 a page stays; the owner
  // decision of 11 Nov 2026, relayed by Guardian S40 ("Owning team sees all ids (Recommended)"), adds the cursor that pages onward.
  test('the reach list for a person with 3,000 requests returns 100 a page, says how many there are, pages onward, and answers fast', async () => {
    const request = (await requestOf('heavy'))!;
    const result = await reach('sample', request);
    expect(result.total).toBe(3000);
    expect(result.requests).toHaveLength(100);
    expect(new Set(result.requests.map((item) => item.id)).size).toBe(100);
    for (const item of result.requests)
      expect(item).toMatchObject({
        workspaceId: heavyWorkspace,
        side: 'sample',
        authorStillMember: true,
      });
    expect(result.nextAfter).toEqual({
      createdAt: result.requests[99]!.createdAt,
      id: result.requests[99]!.id,
    });
    const second = await reach('sample', request, result.nextAfter);
    expect(second.total).toBe(3000);
    expect(second.requests).toHaveLength(100);
    expect(new Set([...result.requests, ...second.requests].map((item) => item.id)).size).toBe(200);
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      await reach('sample', request);
      await reach('sample', request, result.nextAfter);
      times.push((performance.now() - start) / 2);
    }
    expect(percentile(times, 0.95)).toBeLessThan(500);
  });
});
