import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { harness, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';

// CRUD G5, real database, real restricted roles: a person closes their own account with 30 days to undo and files an
// erasure request; staff read the queue and move a request along the allowed arrows. Closed by default, self only,
// one command id per decision, nothing is deleted, and day 30 is final by the clock on read.
let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
const phrase = 'Close my account';
const message = {
  firstArchive: 'Transfer ownership or archive the workspace first',
  noWorkspace:
    'There is no workspace on this account. Write to the privacy contact on the privacy page.',
  undoEnded: 'The 30 days to undo have ended. Write to the privacy contact on the privacy page.',
};
const account = (
  person: string,
  operation: string,
  input: Record<string, unknown> = {},
  command = randomUUID(),
) =>
  h
    .sql<{ r: Record<string, unknown> }>(
      person,
      'SELECT customer.account_lifecycle_command($1,$2,$3) AS r',
      [command, operation, JSON.stringify(input)],
    )
    .then((row) => row.r);
const close = (person: string, command = randomUUID()) =>
  account(person, 'close', { confirmation: phrase }, command);
const stateOf = (person: string) =>
  h
    .sql<{ r: Record<string, unknown> }>(person, 'SELECT customer.account_lifecycle_state() AS r')
    .then((row) => row.r);
const gate = (person: string) =>
  h.sql<{ r: boolean }>(person, 'SELECT customer.account_closed_gate() AS r').then((row) => row.r);
const setAccountControl = async (enabled: boolean) => {
  const latest = (
    await f.owner.query(
      'SELECT coalesce(max(version),0)::int AS v FROM customer_private.account_lifecycle_control',
    )
  ).rows[0].v as number;
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,$2,$3,$4)',
    [latest + 1, enabled, f.serviceId, 'Fixture control for the account lifecycle tests'],
  );
};
const staff = (who: 'owner' | 'operator' | 'other', text: string, params: unknown[] = []) =>
  rawContext(f.runtime, f.users[who]!.ctx, text, params).then((result) => result.rows[0]);
const queue = (who: 'owner' | 'operator' | 'other', filter: string | null = null) =>
  staff(who, 'SELECT customer.erasure_queue(NULL,25,$1) AS r', [filter]).then(
    (row) => row.r as Record<string, unknown>[],
  );
const transition = (
  request: string,
  expected: string,
  to: string,
  note: string | null,
  command = randomUUID(),
  who: 'owner' | 'operator' | 'other' = 'owner',
) =>
  staff(who, 'SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
    command,
    request,
    expected,
    to,
    note,
  ]).then((row) => row.r as Record<string, unknown>);
const chainCounts = async () =>
  (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_account_lifecycle') events,
 (SELECT count(*)::int FROM app.audit_event a JOIN app.domain_event e ON e.id=a.domain_event_id WHERE e.aggregate_type='customer_account_lifecycle') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_account_lifecycle') outbox,
 (SELECT count(*)::int FROM app.outbox_delivery d JOIN app.domain_event e ON e.id=d.event_id WHERE e.aggregate_type='customer_account_lifecycle') deliveries,
 (SELECT count(*)::int FROM customer_private.account_closure_event) closures,
 (SELECT count(*)::int FROM customer_private.account_lifecycle_request) requests,
 (SELECT count(*)::int FROM customer_private.erasure_request) erasures,
 (SELECT count(*)::int FROM customer_private.erasure_status_event) statuses`)
  ).rows[0] as Record<string, number>;
const archiveOwn = async (person: string) => {
  const [blocker] = (await stateOf(person)).blockers as { workspaceId: string }[];
  await h.lifecycle(person, 'archive', {
    workspaceId: blocker!.workspaceId,
    expectedVersion: 0,
    confirmName: `Synthetic ${person} workspace`,
  });
};
const backdate = (person: string, days: number) =>
  f.owner.query(
    `WITH t AS (SELECT clock_timestamp()-make_interval(days=>$2) AS at)
     INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
     SELECT $1,'closed',t.at,t.at+interval '30 days',$3 FROM t`,
    [ids[person], days, randomUUID()],
  );

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'g5db');
  ids = await h.admit([
    'alice',
    'bob',
    'carol',
    'dave',
    'erin',
    'frank',
    'gina',
    'nina',
    'owen',
    'hana',
    'ivan',
    'jude',
  ]);
  for (const person of [
    'alice',
    'carol',
    'dave',
    'erin',
    'frank',
    'gina',
    'owen',
    'hana',
    'ivan',
    'jude',
  ])
    await h.provision(person, `Synthetic ${person} workspace`);
  await migrateCustomerAccountLifecycle(f.owner);
});
afterAll(async () => {
  await f?.close();
});

describe('a closed control', () => {
  test('refuses close and erasure, writes nothing, and the state says open false', async () => {
    const before = await chainCounts();
    await expect(close('alice')).rejects.toMatchObject({ code: '0A000' });
    await expect(account('alice', 'file_erasure')).rejects.toMatchObject({ code: '0A000' });
    expect(await chainCounts()).toEqual(before);
    expect(await stateOf('alice')).toMatchObject({
      open: false,
      status: 'active',
      closedAt: null,
      undoUntil: null,
      canUndo: false,
      erasure: null,
    });
    expect(await gate('alice')).toBe(false);
    await setAccountControl(true);
  });
});

describe('strict input and a person with no workspace', () => {
  test('rejects a wrong phrase, an unknown operation, and any id or extra key, with zero writes', async () => {
    const before = await chainCounts();
    await expect(
      account('alice', 'close', { confirmation: 'close my account' }),
    ).rejects.toMatchObject({
      code: '22023',
    });
    await expect(account('alice', 'close', {})).rejects.toMatchObject({ code: '22023' });
    await expect(
      account('alice', 'close', { confirmation: phrase, principalId: ids.bob }),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(account('alice', 'undo', { subject: 'x' })).rejects.toMatchObject({
      code: '22023',
    });
    await expect(account('alice', 'file_erasure', { principalId: ids.bob })).rejects.toMatchObject({
      code: '22023',
    });
    await expect(account('alice', 'delete')).rejects.toMatchObject({ code: '22023' });
    expect(await chainCounts()).toEqual(before);
  });

  test('refuses close and erasure with the privacy contact message and creates no system workspace', async () => {
    const tenants = (await f.owner.query('SELECT count(*)::int AS n FROM app.tenant')).rows[0].n;
    const before = await chainCounts();
    await expect(close('nina')).rejects.toMatchObject({
      code: '23514',
      message: message.noWorkspace,
    });
    await expect(account('nina', 'file_erasure')).rejects.toMatchObject({
      code: '23514',
      message: message.noWorkspace,
    });
    expect(await chainCounts()).toEqual(before);
    expect((await f.owner.query('SELECT count(*)::int AS n FROM app.tenant')).rows[0].n).toBe(
      tenants,
    );
  });

  test('refuses a signed-out caller', async () => {
    await expect(
      rawContext(f.runtime, f.users.owner.ctx, 'SELECT customer.account_lifecycle_state()'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      rawContext(
        f.runtime,
        f.users.owner.ctx,
        'SELECT customer.account_lifecycle_command($1,$2,$3)',
        [randomUUID(), 'undo', '{}'],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      (await rawContext(f.runtime, f.users.owner.ctx, 'SELECT customer.account_closed_gate() AS g'))
        .rows[0].g,
    ).toBe(false);
  });
});

describe('owners and the workspace they must hand over or archive', () => {
  test('a sole owner of a live workspace cannot close, and the state names the workspace', async () => {
    const before = await chainCounts();
    await expect(close('carol')).rejects.toMatchObject({
      code: '23514',
      message: message.firstArchive,
    });
    expect(await chainCounts()).toEqual(before);
    expect((await stateOf('carol')).blockers).toEqual([
      { workspaceId: expect.any(String), name: 'Synthetic carol workspace' },
    ]);
  });

  test('a sole owner of an archived workspace may close, and a plain member may close', async () => {
    await h.setControl(true);
    await archiveOwn('carol');
    expect((await stateOf('carol')).blockers).toEqual([]);
    expect(await close('carol')).toMatchObject({
      operation: 'close',
      changed: true,
      status: 'closed',
    });
    const [aliceWorkspace] = (await h.state('alice')) as { workspaceId: string }[];
    await h.join('alice', 'bob', aliceWorkspace!.workspaceId);
    expect(await close('bob')).toMatchObject({ changed: true, status: 'closed' });
  });
});

describe('closing and undoing', () => {
  test('close answers closed until 30 days on, writes one chain, and the gate turns true', async () => {
    await archiveOwn('dave');
    const before = await chainCounts();
    const command = randomUUID();
    const closed = await close('dave', command);
    expect(closed).toMatchObject({ operation: 'close', changed: true, status: 'closed' });
    const days =
      (Date.parse(closed.undoUntil as string) - Date.parse(closed.closedAt as string)) / 86400000;
    expect(days).toBe(30);
    const after = await chainCounts();
    expect(after).toEqual({
      ...before,
      events: before.events! + 1,
      audits: before.audits! + 1,
      outbox: before.outbox! + 1,
      deliveries: before.deliveries! + 1,
      closures: before.closures! + 1,
      requests: before.requests! + 1,
    });
    expect(await gate('dave')).toBe(true);
    expect(await stateOf('dave')).toMatchObject({
      status: 'closed',
      canUndo: true,
      closedAt: expect.any(String),
      undoUntil: expect.any(String),
    });
    const event = (
      await f.owner.query(
        "SELECT type,payload FROM app.domain_event WHERE aggregate_type='customer_account_lifecycle' AND correlation_id=$1",
        [command],
      )
    ).rows[0];
    expect(event.type).toBe('customer.account.closed');
    expect(Object.keys(event.payload).sort()).toEqual([
      'initiator_id',
      'initiator_kind',
      'principal_id',
    ]);
  });

  test('a double submit with another command id adds no row; the same id replays; a different payload conflicts', async () => {
    const before = await chainCounts();
    const again = await close('dave');
    expect(again).toMatchObject({ changed: false, status: 'closed' });
    const command = randomUUID();
    const first = await close('bob', command);
    expect(await close('bob', command)).toEqual(first);
    await expect(account('bob', 'undo', {}, command)).rejects.toMatchObject({ code: '23514' });
    await expect(account('bob', 'file_erasure', {}, command)).rejects.toMatchObject({
      code: '23514',
    });
    const after = await chainCounts();
    expect(after.closures).toBe(before.closures);
    expect(after.events).toBe(before.events);
  });

  test('another closed person cannot be reached: every closed account is its own', async () => {
    expect(await gate('alice')).toBe(false);
    expect(await gate('carol')).toBe(true);
  });

  test('undo within 30 days restores everything, writes one chain, and a second undo is refused', async () => {
    const before = await chainCounts();
    expect(await account('dave', 'undo')).toMatchObject({
      operation: 'undo',
      changed: true,
      status: 'active',
    });
    expect(await gate('dave')).toBe(false);
    expect(await stateOf('dave')).toMatchObject({ status: 'active', canUndo: false });
    const after = await chainCounts();
    expect(after.events).toBe(before.events! + 1);
    expect(after.closures).toBe(before.closures! + 1);
    await expect(account('dave', 'undo')).rejects.toMatchObject({
      code: '23514',
      message: 'Your account is not closed',
    });
    // the person can close again after an undo
    expect(await close('dave')).toMatchObject({ changed: true });
    expect(await account('dave', 'undo')).toMatchObject({ changed: true });
  });

  test('a closure at day 31 is final: undo is refused with the plain ended message, nothing is deleted', async () => {
    await archiveOwn('erin');
    await backdate('erin', 31);
    expect(await stateOf('erin')).toMatchObject({ status: 'final', canUndo: false });
    expect(await gate('erin')).toBe(true);
    await expect(account('erin', 'undo')).rejects.toMatchObject({
      code: '23514',
      message: message.undoEnded,
    });
    // still closed after the refusal, and a new close just reports final
    expect(await close('erin')).toMatchObject({ changed: false, status: 'final' });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer.workspace w JOIN customer.membership m ON m.tenant_id=w.tenant_id WHERE m.principal_id=$1',
          [ids.erin],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  test('at day 29 the undo still works, and final names the erasure reference when one was filed', async () => {
    await archiveOwn('frank');
    await account('frank', 'file_erasure');
    await backdate('frank', 31);
    const reference = (await stateOf('frank')).erasure as { reference: string };
    await expect(account('frank', 'undo')).rejects.toMatchObject({
      code: '23514',
      message: `The 30 days to undo have ended. Your erasure request has the reference ${reference.reference}. Write to the privacy contact on the privacy page.`,
    });
    await archiveOwn('owen');
    await backdate('owen', 29);
    expect(await stateOf('owen')).toMatchObject({ status: 'closed', canUndo: true });
    expect(await account('owen', 'undo')).toMatchObject({ status: 'active' });
  });

  test('undo works while the control is paused, and pausing never reopens a closed account', async () => {
    await close('owen');
    await setAccountControl(false);
    try {
      expect(await gate('owen')).toBe(true);
      await expect(close('alice')).rejects.toMatchObject({ code: '0A000' });
      expect(await account('owen', 'undo')).toMatchObject({ status: 'active' });
    } finally {
      await setAccountControl(true);
    }
  });
});

describe('the undo window edge and the length of 30 days', () => {
  // A closure whose day 30 ends this many seconds from now (negative: already ended).
  const closureEndingIn = (person: string, seconds: number) =>
    f.owner.query(
      `INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
       SELECT $1,'closed',t.at-interval '720 hours',t.at,$3 FROM (SELECT clock_timestamp()+make_interval(secs=>$2) AS at) t`,
      [ids[person], seconds, randomUUID()],
    );

  test('undo works just before final_at and is refused from final_at on', async () => {
    await archiveOwn('hana');
    await closureEndingIn('hana', 4);
    expect(await stateOf('hana')).toMatchObject({ status: 'closed', canUndo: true });
    expect(await account('hana', 'undo')).toMatchObject({ status: 'active' });
    await archiveOwn('ivan');
    await closureEndingIn('ivan', 0.4);
    await new Promise((done) => setTimeout(done, 700));
    expect(await stateOf('ivan')).toMatchObject({ status: 'final', canUndo: false });
    await expect(account('ivan', 'undo')).rejects.toMatchObject({
      code: '23514',
      message: message.undoEnded,
    });
  });

  // Day arithmetic on a timestamptz follows the session time zone, so across a clock change "30 days" is not 720 hours.
  // The stored dates must not depend on the session that wrote them.
  const inNewYork = async (statement: string, params: unknown[]) => {
    const db = await f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL TimeZone='America/New_York'");
      await db.query(statement, params);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  };
  test('a closure and an erasure request are exactly 720 hours long across a clock change', async () => {
    await inNewYork(
      `INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
       VALUES($1,'closed','2026-03-01T12:00:00Z','2026-03-31T12:00:00Z',$2)`,
      [ids.bob, randomUUID()],
    );
    await inNewYork(
      `INSERT INTO customer_private.erasure_request(principal_id,filed_at,due_at,command_id)
       VALUES($1,'2026-03-01T12:00:00Z','2026-03-31T12:00:00Z',$2)`,
      [ids.bob, randomUUID()],
    );
  });

  test('the dates the commands store are 720 hours apart whatever the session time zone', async () => {
    await archiveOwn('jude');
    const closed = await h.as('jude', async (db) => {
      await db.query("SET LOCAL TimeZone='America/New_York'");
      return (
        await db.query<{ r: { closedAt: string; undoUntil: string } }>(
          'SELECT customer.account_lifecycle_command($1,$2,$3) AS r',
          [randomUUID(), 'close', JSON.stringify({ confirmation: phrase })],
        )
      ).rows[0]!.r;
    });
    expect(Date.parse(closed.undoUntil) - Date.parse(closed.closedAt)).toBe(720 * 3600000);
    expect(
      (
        await f.owner.query(
          `SELECT (final_at-occurred_at)=interval '720 hours' AS exact FROM customer_private.account_closure_event
           WHERE principal_id=$1 ORDER BY seq DESC LIMIT 1`,
          [ids.jude],
        )
      ).rows[0].exact,
    ).toBe(true);
    expect(await account('jude', 'undo')).toMatchObject({ status: 'active' });
  });
});

describe('erasure requests', () => {
  test('is filed without closing, with a reference, a due date 30 days on, and one open request at a time', async () => {
    const before = await chainCounts();
    const filed = await account('gina', 'file_erasure');
    expect(filed).toMatchObject({
      operation: 'file_erasure',
      changed: true,
      reference: expect.stringMatching(/^ER-\d{6}$/),
    });
    expect(
      (Date.parse(filed.dueAt as string) - Date.parse(filed.filedAt as string)) / 86400000,
    ).toBe(30);
    const row = (
      await f.owner.query(
        "SELECT due_at=filed_at+interval '30 days' AS ok FROM customer_private.erasure_request WHERE reference=$1",
        [filed.reference],
      )
    ).rows[0];
    expect(row.ok).toBe(true);
    const once = await chainCounts();
    expect(once).toEqual({
      ...before,
      events: before.events! + 1,
      audits: before.audits! + 1,
      outbox: before.outbox! + 1,
      deliveries: before.deliveries! + 1,
      requests: before.requests! + 1,
      erasures: before.erasures! + 1,
      statuses: before.statuses! + 1,
    });
    const second = await account('gina', 'file_erasure');
    expect(second).toMatchObject({ changed: false, reference: filed.reference });
    expect((await chainCounts()).erasures).toBe(once.erasures);
    expect(await stateOf('gina')).toMatchObject({
      status: 'active',
      erasure: { reference: filed.reference, status: 'received', note: null },
    });
  });
});

describe('the staff queue', () => {
  test('a staff owner with a fresh check reads the queue with accountStatus, closedAt and undoUntil', async () => {
    const rows = await queue('owner');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((row) => row.number)).toEqual(
      [...rows.map((row) => row.number as number)].sort((a, b) => a - b),
    );
    const gina = rows.find((row) => row.principalId === ids.gina)!;
    expect(Object.keys(gina).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(gina).toMatchObject({
      accountStatus: 'active',
      closedAt: null,
      undoUntil: null,
      status: 'received',
      daysLeft: 30,
    });
    const frank = rows.find((row) => row.principalId === ids.frank)!;
    expect(frank).toMatchObject({ accountStatus: 'final' });
    expect(frank.undoUntil).toEqual(expect.any(String));
    expect(await queue('owner', 'completed')).toEqual([]);
    expect((await queue('owner', 'received')).length).toBe(rows.length);
  });

  test('a closed account inside its window shows closed with the date it can be undone until', async () => {
    await archiveOwn('alice');
    await close('alice');
    await account('alice', 'file_erasure');
    const alice = (await queue('owner')).find((row) => row.principalId === ids.alice)!;
    expect(alice).toMatchObject({
      accountStatus: 'closed',
      closedAt: expect.any(String),
      undoUntil: expect.any(String),
    });
  });

  test('is denied for an operator, for a staff owner without a fresh check, and for every customer session', async () => {
    await expect(queue('operator')).rejects.toMatchObject({ code: '42501' });
    await f.owner.query(
      "UPDATE identity.assurance SET verified_at=now()-interval '1 hour' WHERE session_id=$1",
      [f.users.other!.sessionId],
    );
    try {
      await expect(queue('other')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
        f.users.other!.sessionId,
      ]);
    }
    await expect(
      h.sql('alice', 'SELECT customer.erasure_queue(NULL,25,NULL) AS r'),
    ).rejects.toMatchObject({ code: '42501' });
    const request = (await queue('owner'))[0]!.id as string;
    const before = await chainCounts();
    await expect(
      h.sql('alice', 'SELECT customer.erasure_transition($1,$2,$3,$4,$5)', [
        randomUUID(),
        request,
        'received',
        'in_progress',
        null,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      transition(request, 'received', 'in_progress', null, randomUUID(), 'operator'),
    ).rejects.toMatchObject({
      code: '42501',
    });
    expect(await chainCounts()).toEqual(before);
  });

  test('is bound to the staff workspace in the session: an owner of another workspace, or of none, is denied', async () => {
    // The owner of South, named in the session as a member of North, which the owner of South is not.
    const crossed = { ...f.users.other!.ctx, tenantId: f.tenantA };
    await expect(
      rawContext(f.runtime, crossed, 'SELECT customer.erasure_queue(NULL,25,NULL) AS r'),
    ).rejects.toMatchObject({ code: '42501' });
    const request = (await queue('owner'))[0]!.id as string;
    const before = await chainCounts();
    await expect(
      rawContext(f.runtime, crossed, 'SELECT customer.erasure_transition($1,$2,$3,$4,$5)', [
        randomUUID(),
        request,
        'received',
        'in_progress',
        null,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await chainCounts()).toEqual(before);
    // A staff owner of a workspace that is not a sample workspace is denied while real use is not open for it.
    await f.owner.query('ALTER TABLE app.tenant DISABLE TRIGGER USER');
    await f.owner.query('UPDATE app.tenant SET synthetic=false WHERE id=$1', [f.tenantB]);
    try {
      await expect(queue('other')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await f.owner.query('UPDATE app.tenant SET synthetic=true WHERE id=$1', [f.tenantB]);
      await f.owner.query('ALTER TABLE app.tenant ENABLE TRIGGER USER');
    }
  });

  test('a staff owner of the workspace named in a fresh session is allowed, and a stale check is denied', async () => {
    expect(Array.isArray(await queue('other'))).toBe(true);
    await f.owner.query(
      "UPDATE identity.assurance SET verified_at=now()-interval '1 hour' WHERE session_id=$1",
      [f.users.owner!.sessionId],
    );
    try {
      await expect(queue('owner')).rejects.toMatchObject({ code: '42501' });
      await expect(transition(randomUUID(), 'received', 'in_progress', null)).rejects.toMatchObject(
        { code: '42501' },
      );
    } finally {
      await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
        f.users.owner!.sessionId,
      ]);
    }
  });

  test('moves only along the allowed arrows, completion needs a note, a stale state is refused', async () => {
    const request = (await queue('owner')).find((row) => row.principalId === ids.gina)!
      .id as string;
    const note = 'Invoices and the audit trail are kept because the law requires them';
    const before = await chainCounts();
    await expect(transition(request, 'received', 'completed', note)).rejects.toMatchObject({
      code: '23514',
    });
    await expect(transition(request, 'in_progress', 'completed', note)).rejects.toMatchObject({
      code: '23514',
    });
    await expect(transition(request, 'received', 'declined', null)).rejects.toMatchObject({
      code: '22023',
    });
    await expect(transition(request, 'received', 'declined', 'too short')).rejects.toMatchObject({
      code: '22023',
    });
    await expect(transition(request, 'completed', 'in_progress', null)).rejects.toMatchObject({
      code: '22023',
    });
    await expect(transition(request, 'received', 'received', null)).rejects.toMatchObject({
      code: '22023',
    });
    expect(await chainCounts()).toEqual(before);
    const command = randomUUID();
    const moved = await transition(request, 'received', 'in_progress', null, command);
    expect(moved).toMatchObject({ status: 'in_progress', changed: true });
    expect(await transition(request, 'received', 'in_progress', null, command)).toMatchObject({
      status: 'in_progress',
      changed: false,
    });
    await expect(
      transition(request, 'received', 'in_progress', null, command, 'owner'),
    ).resolves.toBeDefined();
    await expect(transition(request, 'received', 'declined', note, command)).rejects.toMatchObject({
      code: '23514',
    });
    await expect(transition(request, 'received', 'in_progress', null)).rejects.toMatchObject({
      code: '23514',
    });
    const done = await transition(request, 'in_progress', 'completed', note);
    expect(done).toMatchObject({ status: 'completed', note, changed: true });
    await expect(transition(request, 'in_progress', 'declined', note)).rejects.toMatchObject({
      code: '23514',
    });
    expect(await stateOf('gina')).toMatchObject({
      erasure: { status: 'completed', note },
    });
    // each real transition wrote one staff chain, and the staff note is not in any payload
    const staffEvents = (
      await f.owner.query(
        "SELECT type,payload::text AS payload FROM app.domain_event WHERE aggregate_type='customer_account_lifecycle' AND type LIKE 'customer.account.erasure_%' AND type<>'customer.account.erasure_requested'",
      )
    ).rows;
    expect(staffEvents.map((row) => row.type).sort()).toEqual([
      'customer.account.erasure_completed',
      'customer.account.erasure_in_progress',
    ]);
    for (const row of staffEvents) expect(row.payload).not.toContain('kept because');
    // a completed request lets the person file a new one
    expect(await account('gina', 'file_erasure')).toMatchObject({ changed: true });
  });

  test('a received request can be declined with a note', async () => {
    const request = (await queue('owner')).find((row) => row.principalId === ids.frank)!
      .id as string;
    const declined = await transition(
      request,
      'received',
      'declined',
      'The request came from a different person, so it was declined',
    );
    expect(declined).toMatchObject({ status: 'declined' });
  });

  test('the module tables refuse any rewrite, and the restricted logins cannot touch them', async () => {
    for (const table of [
      'account_closure_event',
      'account_lifecycle_request',
      'erasure_request',
      'erasure_status_event',
      'account_lifecycle_control',
    ]) {
      await expect(
        f.owner.query(`UPDATE customer_private.${table} SET command_id=command_id`),
      ).rejects.toBeDefined();
      await expect(f.owner.query(`DELETE FROM customer_private.${table}`)).rejects.toBeDefined();
      await expect(
        f.runtime.query(`SELECT 1 FROM customer_private.${table}`),
      ).rejects.toMatchObject({
        code: '42501',
      });
    }
  });
});
