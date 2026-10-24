import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { sessionHash, type DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  admitSyntheticCustomerRequests,
  revokeSyntheticCustomerRequest,
} from '../../packages/auth/src/customer-request-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerMoveService, customerMovesEnabled } from '../../packages/auth/src/customer-moves';
import { configureMoveRecords } from '../../packages/auth/src/customer-move-configuration';
import { MissionMoveService } from '../../packages/missions/src/moves';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';

// Real database, real roles. Proves Move records (ADR-068): closed by default, written only by the
// Corridra team with a fresh authenticator check, read only by the person who submitted the request,
// exact history, a cap of five, plain words, replay-safe, and nothing in the events but ids.
const issuer = 'https://ep-move-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const reason = 'Owner approved Move records for the local fixture tests';
let f: Awaited<ReturnType<typeof fixture>>;
let moves: MissionMoveService;
let missions: MissionService;
let workspaceId: string;
const requests: Record<string, { requestId: string; missionId: string }> = {};

const session = (person: string): CustomerSession => ({
  subject: 'synthetic-move-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const requestService = (person: string) =>
  new CustomerRequestService(f.runtime, f.auth, options, async () => session(person));
const customer = (person: string) =>
  new CustomerMoveService(f.runtime, f.auth, options, async () => session(person));
const brief = () => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: 'Synthetic hotel towels ' + randomUUID(),
  website: 'https://example.invalid/catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic test only',
  name: 'Test Person',
  company: 'Example Test Company',
  email: 'mission@example.invalid',
  acknowledged: true,
});
async function newRequest(person: string) {
  const result = await requestService(person).submit(
    { commandId: randomUUID(), workspaceId, brief: brief() },
    (context, b) => missions.prepareCustomerIntake(context, b),
  );
  const owned = (
    await f.owner.query('SELECT mission_id FROM customer_private.owned_request WHERE id=$1', [
      result.id,
    ])
  ).rows[0];
  return { requestId: result.id as string, missionId: owned.mission_id as string };
}
const set = (
  missionId: string,
  list: { verb: string; object: string; holder?: string; dueOn?: string | null }[],
  commandId = randomUUID(),
  ctx = f.users.operator.ctx,
) =>
  moves.command(ctx, {
    action: 'set',
    commandId,
    missionId,
    moves: list.map((m) => ({ holder: 'customer', dueOn: null, ...m })),
  });
const mine = async (person: string) =>
  (await customer(person).list()).requests.flatMap(
    (r: { requestId: string; moves: { verb: string; object: string; holder: string }[] }) =>
      r.moves.map((m) => ({ request: r.requestId, ...m })),
  );

// A compromised application: the same restricted role and the same session, straight to the tables.
async function asOperator(work: (db: DatabaseClient) => Promise<void>) {
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose','synthetic_validation',true),set_config('corridra.correlation_id',$3,true),set_config('corridra.causation_id',$3,true)",
      [sessionHash(f.users.operator.token), f.tenantA, randomUUID()],
    );
    await work(db);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}
const rawCommand = async (db: DatabaseClient, missionId: string) => {
  const cmd = randomUUID();
  await db.query(
    "INSERT INTO app.mission_move_command(id,tenant_id,mission_id,kind,input_hash,actor_id) VALUES($1,$2,$3,'SET',repeat('a',64),$4)",
    [cmd, f.tenantA, missionId, f.users.operator.id],
  );
  return cmd;
};
const rawMove = (
  db: DatabaseClient,
  missionId: string,
  cmd: string,
  object: string,
  position = 1,
) =>
  db.query(
    "INSERT INTO app.mission_move(tenant_id,mission_id,command_id,position,verb,object,holder,created_by) VALUES($1,$2,$3,$4,'Read',$5,'customer',$6)",
    [f.tenantA, missionId, cmd, position, object, f.users.operator.id],
  );

// Everything that exists before this module: functions with their ACLs, tables with RLS, ACLs and policies.
async function snapshot(oids?: { fn: number[]; tb: number[] }) {
  const fn = (
    await f.owner.query(
      `SELECT p.oid::int AS oid,pg_get_functiondef(p.oid) AS def,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('app','identity','customer','customer_private') AND ($1::oid[] IS NULL OR p.oid=ANY($1)) ORDER BY p.oid`,
      [oids?.fn ?? null],
    )
  ).rows;
  const tb = (
    await f.owner.query(
      `SELECT c.oid::int AS oid,c.relacl::text AS acl,c.relrowsecurity AS rls,
        (SELECT coalesce(jsonb_agg(pg_get_expr(po.polqual,po.polrelid) || '|' || coalesce(pg_get_expr(po.polwithcheck,po.polrelid),'') || '|' || po.polname ORDER BY po.polname),'[]'::jsonb) FROM pg_policy po WHERE po.polrelid=c.oid) AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') AND ($1::oid[] IS NULL OR c.oid=ANY($1)) ORDER BY c.oid`,
      [oids?.tb ?? null],
    )
  ).rows;
  return { fn, tb };
}
let before: Awaited<ReturnType<typeof snapshot>>;
const setControl = (enabled: boolean) => configureMoveRecords(f.owner, { enabled, reason });
const openMoves = async (missionId: string) =>
  (
    await f.owner.query(
      `SELECT m.* FROM app.mission_move m WHERE m.mission_id=$1
       AND NOT EXISTS(SELECT 1 FROM app.mission_move_close c WHERE c.move_id=m.id) ORDER BY position`,
      [missionId],
    )
  ).rows;

beforeAll(async () => {
  f = await fixture();
  missions = new MissionService(f.runtime, 'move-records-local-secret');
  moves = new MissionMoveService(f.runtime);
  await migrateCustomerRealUse(f.owner);
  before = await snapshot();
  await migrateCustomerMoves(f.owner);
  const principals: Record<string, string> = {};
  for (const person of ['alice', 'bob'])
    principals[person] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(person).subject,
        executorId: f.serviceId,
        reason: 'Explicit fictional Move records test principal, never real provider data',
      })
    ).id;
  workspaceId = (
    await new CustomerWorkspaceService(f.runtime, f.auth, options, async () =>
      session('alice'),
    ).provision({ commandId: randomUUID(), name: 'Synthetic Move records workspace' })
  ).id;
  await new CustomerWorkspaceService(f.runtime, f.auth, options, async () =>
    session('bob'),
  ).provision({ commandId: randomUUID(), name: 'Synthetic second Move workspace' });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  for (const person of ['alice', 'bob'])
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[person],
      reason: 'Explicit invented synthetic request scope, no commercial activation',
    });
  requests.alice = await newRequest('alice');
  // Bob submits from his own workspace.
  const bobWorkspace = (
    await new CustomerWorkspaceService(f.runtime, f.auth, options, async () =>
      session('bob'),
    ).list()
  )[0].id;
  const result = await requestService('bob').submit(
    { commandId: randomUUID(), workspaceId: bobWorkspace, brief: brief() },
    (context, b) => missions.prepareCustomerIntake(context, b),
  );
  requests.bob = {
    requestId: result.id,
    missionId: (
      await f.owner.query('SELECT mission_id FROM customer_private.owned_request WHERE id=$1', [
        result.id,
      ])
    ).rows[0].mission_id,
  };
});
afterAll(async () => {
  await f?.close();
});

describe('installation', () => {
  test('a populated additive upgrade changes no existing function, table, policy or grant', async () => {
    const after = await snapshot({
      fn: before.fn.map((r) => r.oid),
      tb: before.tb.map((r) => r.oid),
    });
    expect(after).toEqual(before);
    // And it really added something: the new tables and functions are not in the earlier snapshot.
    expect((await snapshot()).tb.length - before.tb.length).toBeGreaterThanOrEqual(4);
  });

  test('is idempotent, records one applied file with its hash and refuses a changed history', async () => {
    const before = (await f.owner.query('SELECT * FROM customer_move_migrations.applied')).rows;
    expect(before).toHaveLength(1);
    await migrateCustomerMoves(f.owner);
    expect((await f.owner.query('SELECT * FROM customer_move_migrations.applied')).rows).toEqual(
      before,
    );
    await f.owner.query("UPDATE customer_move_migrations.applied SET sha256=repeat('0',64)");
    await expect(migrateCustomerMoves(f.owner)).rejects.toThrow('history mismatch');
    await f.owner.query('UPDATE customer_move_migrations.applied SET sha256=$1', [
      before[0].sha256,
    ]);
  });

  test('the application switch is separate, default off and needs the request module', () => {
    expect(customerMovesEnabled({})).toBe(false);
    expect(customerMovesEnabled({ CORRIDRA_UX_MOVE_RECORDS: 'true' })).toBe(false);
    expect(
      customerMovesEnabled({
        CORRIDRA_UX_MOVE_RECORDS: 'true',
        CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
        DATA_ENVIRONMENT: 'synthetic',
      }),
    ).toBe(true);
  });

  test('the control starts closed: the team cannot set a Move and the customer reads none', async () => {
    await expect(
      set(requests.alice.missionId, [{ verb: 'Add', object: 'your import licence number' }]),
    ).rejects.toThrow('not open');
    expect(await customer('alice').list()).toMatchObject({ open: false, requests: [] });
    expect((await f.owner.query('SELECT count(*)::int n FROM app.mission_move')).rows[0].n).toBe(0);
  });

  test('runtime and auth cannot touch the control, the internal function or rewrite any history', async () => {
    for (const pool of [f.runtime, f.auth]) {
      await expect(pool.query('SELECT * FROM customer_private.move_control')).rejects.toMatchObject(
        {
          code: '42501',
        },
      );
      await expect(pool.query('SELECT customer_private.move_open()')).rejects.toMatchObject({
        code: '42501',
      });
    }
    await expect(
      f.auth.query('SELECT customer.private_request_moves(NULL,10)'),
    ).rejects.toMatchObject({ code: '42501' });
    for (const table of ['mission_move_command', 'mission_move', 'mission_move_close']) {
      await expect(f.auth.query(`SELECT * FROM app.${table}`)).rejects.toMatchObject({
        code: '42501',
      });
      for (const sql of [`UPDATE app.${table} SET created_at=now()`, `DELETE FROM app.${table}`])
        await expect(f.runtime.query(sql)).rejects.toThrow();
    }
  });
});

describe('setting and reading', () => {
  beforeAll(async () => {
    expect(await setControl(true)).toEqual({ enabled: true, changed: true });
    expect(await setControl(true)).toEqual({ enabled: true, changed: false });
  });

  test('the team sets Moves and only the person who submitted the request reads them', async () => {
    const commandId = randomUUID();
    await set(
      requests.alice.missionId,
      [
        { verb: 'Add', object: 'your import licence number', dueOn: null },
        { verb: 'Confirm', object: 'your visit dates', holder: 'team' },
      ],
      commandId,
    );
    const alice = await mine('alice');
    expect(alice.map((m) => [m.verb, m.object, m.holder])).toEqual([
      ['Add', 'your import licence number', 'customer'],
      ['Confirm', 'your visit dates', 'team'],
    ]);
    expect(alice.every((m) => m.request === requests.alice.requestId)).toBe(true);
    expect(await mine('bob')).toEqual([]);
  });

  test('a signed-out call, an unverified person and an unknown person get nothing', async () => {
    const unknown = new CustomerMoveService(f.runtime, f.auth, options, async () =>
      session('stranger'),
    );
    await expect(unknown.list()).rejects.toThrow();
    const unverified = new CustomerMoveService(f.runtime, f.auth, options, async () => ({
      ...session('alice'),
      emailVerified: false,
    }));
    await expect(unverified.list()).rejects.toThrow('Verify your email');
    const signedOut = new CustomerMoveService(
      f.runtime,
      f.auth,
      options,
      async () => null as never,
    );
    await expect(signedOut.list()).rejects.toThrow();
  });

  test('a new set replaces the open Moves in one step and keeps the old ones in the history', async () => {
    const before = await openMoves(requests.alice.missionId);
    expect(before).toHaveLength(2);
    await set(requests.alice.missionId, [{ verb: 'Read', object: 'the new reply' }]);
    expect((await mine('alice')).map((m) => m.object)).toEqual(['the new reply']);
    const history = await moves.history(f.users.operator.ctx, requests.alice.missionId);
    expect(history).toHaveLength(3);
    expect(history.filter((m) => m.closed?.outcome === 'CLEARED')).toHaveLength(2);
    expect(history.filter((m) => m.closed === null)).toHaveLength(1);
  });

  test('is replay safe: the same command is a replay, a changed one under the same id conflicts', async () => {
    const commandId = randomUUID();
    const list = [{ verb: 'Send', object: 'your packing list' }];
    const first = await set(requests.alice.missionId, list, commandId);
    expect(first).toMatchObject({ replayed: false });
    const second = await set(requests.alice.missionId, list, commandId);
    expect(second).toMatchObject({ replayed: true });
    expect(
      (await openMoves(requests.alice.missionId)).filter((m) => m.command_id === commandId),
    ).toHaveLength(1);
    await expect(
      set(requests.alice.missionId, [{ verb: 'Send', object: 'a different list' }], commandId),
    ).rejects.toThrow('reused');
    await expect(set(requests.alice.missionId, list, commandId, f.users.owner.ctx)).rejects.toThrow(
      'reused',
    );
  });

  test('done closes one Move, and only an open one', async () => {
    const [open] = await openMoves(requests.alice.missionId);
    await moves.command(f.users.operator.ctx, {
      action: 'done',
      commandId: randomUUID(),
      missionId: requests.alice.missionId,
      moveId: open.id,
    });
    expect(await mine('alice')).toEqual([]);
    await expect(
      moves.command(f.users.operator.ctx, {
        action: 'done',
        commandId: randomUUID(),
        missionId: requests.alice.missionId,
        moveId: open.id,
      }),
    ).rejects.toThrow('not open');
    const history = await moves.history(f.users.operator.ctx, requests.alice.missionId);
    expect(history.find((m) => m.id === open.id)?.closed?.outcome).toBe('DONE');
  });

  test('clear withdraws every open Move', async () => {
    await set(requests.bob.missionId, [
      { verb: 'Choose', object: 'a visit week' },
      { verb: 'Add', object: 'your company registration' },
    ]);
    expect(await mine('bob')).toHaveLength(2);
    await moves.command(f.users.operator.ctx, {
      action: 'clear',
      commandId: randomUUID(),
      missionId: requests.bob.missionId,
    });
    expect(await mine('bob')).toEqual([]);
    expect(await openMoves(requests.bob.missionId)).toHaveLength(0);
  });

  test('at most five open Moves: the command refuses six and the database refuses a sixth row', async () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((x) => ({
      verb: 'Read',
      object: `item ${x} to read`,
    }));
    await set(requests.alice.missionId, five);
    expect(await openMoves(requests.alice.missionId)).toHaveLength(5);
    await expect(
      set(requests.alice.missionId, [...five, { verb: 'Read', object: 'a sixth thing' }]),
    ).rejects.toThrow();
    // Straight to the table, as a compromised caller would: the guard still refuses.
    await asOperator(async (db) => {
      const cmd = await rawCommand(db, requests.alice.missionId);
      await expect(rawMove(db, requests.alice.missionId, cmd, 'one more thing')).rejects.toThrow(
        'At most five',
      );
    });
  });
});

describe('who may write', () => {
  test('a viewer, a member of another tenant and a stranger cannot set a Move', async () => {
    const list = [{ verb: 'Read', object: 'the report' }];
    await expect(
      set(requests.alice.missionId, list, randomUUID(), f.users.viewer.ctx),
    ).rejects.toThrow('Access denied');
    await expect(
      set(requests.alice.missionId, list, randomUUID(), f.users.other.ctx),
    ).rejects.toThrow();
    await expect(
      set(requests.alice.missionId, list, randomUUID(), f.users.outsider.ctx),
    ).rejects.toThrow();
  });

  test('a Move needs a fresh authenticator check', async () => {
    const age = (interval: string) =>
      f.owner.query(
        `UPDATE identity.assurance SET verified_at=now()-interval '${interval}' WHERE session_id=$1`,
        [f.users.operator.sessionId],
      );
    // Still a signed-in operator, but the authenticator was last checked an hour ago.
    await age('1 hour');
    try {
      await expect(
        set(requests.bob.missionId, [{ verb: 'Read', object: 'the visit plan' }]),
      ).rejects.toThrow('authenticator');
    } finally {
      await age('0 seconds');
    }
  });
});

describe('the words and the dates', () => {
  test.each([
    ['a link', 'see https://example.com/pay'],
    ['an address', 'write to buyer@example.com'],
    ['markup', 'read <b>this</b> now'],
    ['an amount', 'pay USD 500 first'],
    ['a price', 'confirm the 1,200 total'],
    ['a decimal price', 'accept 12.50 each'],
    ['a currency sign', 'send $300 deposit'],
  ])('refuses %s', async (_name, object) => {
    await expect(set(requests.bob.missionId, [{ verb: 'Send', object }])).rejects.toThrow();
  });

  test('the database refuses the same words even when the check in the application is skipped', async () => {
    await asOperator(async (db) => {
      const cmd = await rawCommand(db, requests.bob.missionId);
      for (const object of [
        'pay USD 500 first',
        'see https://example.com',
        'a <b>tag</b> here',
        'write to buyer@example.com',
        'confirm the 1,200 total',
      ]) {
        await db.query('SAVEPOINT s');
        await expect(rawMove(db, requests.bob.missionId, cmd, object)).rejects.toThrow(
          'violates check',
        );
        await db.query('ROLLBACK TO SAVEPOINT s');
      }
      // Ordinary words with ordinary numbers pass the same check.
      await rawMove(db, requests.bob.missionId, cmd, 'your visit on week 3');
    });
  });

  test('plain words with ordinary numbers are accepted', async () => {
    await set(requests.bob.missionId, [
      { verb: 'Confirm', object: 'your visit on week 3' },
      { verb: 'Add', object: 'passport number for 2 people' },
    ]);
    expect((await mine('bob')).map((m) => m.object)).toEqual([
      'your visit on week 3',
      'passport number for 2 people',
    ]);
  });

  test('a due date is a real date from today to a year ahead', async () => {
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    await expect(
      set(requests.bob.missionId, [{ verb: 'Send', object: 'the form', dueOn: day(-3) }]),
    ).rejects.toThrow();
    await expect(
      set(requests.bob.missionId, [{ verb: 'Send', object: 'the form', dueOn: day(400) }]),
    ).rejects.toThrow();
    await set(requests.bob.missionId, [{ verb: 'Send', object: 'the form', dueOn: day(10) }]);
    const [row] = (await customer('bob').list()).requests[0].moves;
    expect(row.dueOn).toBe(day(10));
  });
});

describe('history, events and closing', () => {
  test('events and audit rows carry ids only, never the words of a Move', async () => {
    const words = await f.owner.query('SELECT object FROM app.mission_move');
    const events = (
      await f.owner.query(
        "SELECT payload::text p FROM app.domain_event WHERE type LIKE 'mission_move%'",
      )
    ).rows;
    expect(events.length).toBeGreaterThan(0);
    for (const { object } of words.rows)
      for (const event of events) expect(event.p).not.toContain(object);
  });

  test('a revoked request shows no Moves to its owner', async () => {
    await set(requests.alice.missionId, [{ verb: 'Read', object: 'the delivered report' }]);
    expect(await mine('alice')).toHaveLength(1);
    await revokeSyntheticCustomerRequest(f.owner, {
      requestId: requests.alice.requestId,
      reason: 'Synthetic independently revoked resource scope',
    });
    expect(await mine('alice')).toEqual([]);
  });

  test('closing the control stops the team and the customer at once and keeps every record', async () => {
    const count = (await f.owner.query('SELECT count(*)::int n FROM app.mission_move')).rows[0].n;
    expect(await setControl(false)).toEqual({ enabled: false, changed: true });
    await expect(
      set(requests.bob.missionId, [{ verb: 'Read', object: 'anything at all' }]),
    ).rejects.toThrow('not open');
    expect(await customer('bob').list()).toMatchObject({ open: false, requests: [] });
    expect((await f.owner.query('SELECT count(*)::int n FROM app.mission_move')).rows[0].n).toBe(
      count,
    );
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM customer_private.move_control')).rows[0].n,
    ).toBe(2);
  });
});
