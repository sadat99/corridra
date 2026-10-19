import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammeCoordination } from '../../packages/db/src/customer-programme-coordination-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import {
  CustomerProgrammeCoordinationService,
  customerProgrammeCoordinationEnabled,
  recordSubmitInput,
  taskSaveInput,
} from '../../packages/auth/src/customer-programme-coordination';
import { sessionHash } from '../../packages/db/src/index';

// Invented provider-session fixtures exercise the real restricted SQL logins.
// They do not establish private managed-provider/email acceptance.
const issuer = 'https://ep-coord-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'eve', 'outsider'];
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  otherWorkspace: string,
  programmeId: string,
  secondProgramme: string,
  bobReg: string,
  carolReg: string,
  secondReg: string;
let oldSnapshot: Awaited<ReturnType<typeof snapshot>>;
const subject = (p: string) => 'synthetic-coord-' + p;
const session = (p: string): CustomerSession => ({
  subject: subject(p),
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const workspaces = (p = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(p));
const programmes = (p = 'alice') =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(p));
const participants = (p = 'alice') =>
  new CustomerParticipantService(f.runtime, f.auth, options, async () => session(p));
const coord = (p = 'alice') =>
  new CustomerProgrammeCoordinationService(f.runtime, f.auth, options, async () => session(p));
const scope = (target = workspaceId, programme = programmeId) => ({
  workspaceId: target,
  programmeId: programme,
});
const task = (over: Record<string, unknown> = {}) => ({
  taskId: null,
  title: 'Synthetic book the venue for day one',
  detail: null,
  status: 'OPEN',
  dueOn: null,
  assigneeLabel: null,
  ...over,
});
const saveTask = (
  t: Record<string, unknown> = task(),
  expectedVersion = 0,
  p = 'alice',
  commandId = randomUUID(),
  target = workspaceId,
  programme = programmeId,
) => coord(p).saveTask({ commandId, ...scope(target, programme), expectedVersion, task: t });
const attend = (reg: string, state: string, p = 'alice', commandId = randomUUID()) =>
  coord(p).setAttendance({ commandId, ...scope(), registrationId: reg, state });
const feedback = (reg: string, over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  registrationId: reg,
  kind: 'FEEDBACK',
  recordId: null,
  expectedVersion: 0,
  rating: 4,
  outcomeKind: null,
  occurredOn: null,
  note: 'Synthetic the programme was well organised',
  shared: true,
  retracted: false,
  acknowledged: true,
  ...over,
});
const outcome = (reg: string, over: Record<string, unknown> = {}) =>
  feedback(reg, {
    kind: 'OUTCOME',
    rating: null,
    outcomeKind: 'MEETING_HELD',
    occurredOn: '2026-10-02',
    note: 'Synthetic met a buyer on day two',
    ...over,
  });
const submit = (input: Record<string, unknown>, p = 'bob') => coord(p).submitRecord(input);
const report = (p = 'alice', target = workspaceId, programme = programmeId) =>
  coord(p).report(scope(target, programme));

async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.programme_task) tasks,
 (SELECT count(*)::int FROM customer_private.programme_task_revision) task_revisions,
 (SELECT count(*)::int FROM customer_private.programme_capacity_revision) capacity,
 (SELECT count(*)::int FROM customer_private.programme_attendance_revision) attendance,
 (SELECT count(*)::int FROM customer_private.programme_participant_record) records,
 (SELECT count(*)::int FROM customer_private.programme_participant_record_revision) record_revisions,
 (SELECT count(*)::int FROM customer_private.programme_coordination_command) commands,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_programme_coordination') events,
 (SELECT count(*)::int FROM app.audit_event WHERE action LIKE 'customer.programme_coordination.%') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_programme_coordination') outbox,
 (SELECT count(*)::int FROM app.commercial_record) commercial,
 (SELECT count(*)::int FROM app.organisation) organisations,
 (SELECT count(*)::int FROM customer_private.session_proof) proofs`)
  ).rows[0];
}
async function snapshot() {
  const functions = (
    await f.owner.query(
      `SELECT p.oid,p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid`,
    )
  ).rows;
  const tables = (
    await f.owner.query(
      `SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY c.oid`,
    )
  ).rows;
  const digests = [];
  for (const row of tables)
    digests.push(
      (
        await f.owner.query(
          `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) digest FROM "${row.nspname}"."${row.relname}" t`,
        )
      ).rows[0].digest,
    );
  return {
    functions,
    tables,
    digests,
    policies: (
      await f.owner.query(
        "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
      )
    ).rows,
    coreHistory: (await f.owner.query('SELECT * FROM migrations.applied ORDER BY name')).rows,
    customerHistory: (
      await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name')
    ).rows,
  };
}
async function raw(p: string, sql: string, args: unknown[] = [], target = workspaceId) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds')",
    [hash, issuer, subject(p)],
  );
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_hash','',true),set_config('corridra.tenant_id',$2,true)",
      [hash, target],
    );
    const result = await db.query(sql, args);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}
async function rejected(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  throw new Error('Expected the operation to be rejected');
}
async function register(programme: string, who: string, label: string, target = workspaceId) {
  const invitation = await participants().command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: target,
    programmeId: programme,
    label: 'Synthetic invitation for ' + who,
    acknowledged: true,
  });
  return (
    await participants(who).command({
      action: 'accept',
      commandId: randomUUID(),
      programmeId: programme,
      token: invitation.token,
      displayLabel: label,
      consented: true,
    })
  ).id as string;
}

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerParticipants(f.owner);
  for (const p of people)
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: subject(p),
      executorId: f.serviceId,
      reason: 'Explicit invented programme coordination test identity; no real account or email',
    });
  workspaceId = (
    await workspaces().provision({
      commandId: randomUUID(),
      name: 'Synthetic coordination workspace',
    })
  ).id;
  otherWorkspace = (
    await workspaces('eve').provision({
      commandId: randomUUID(),
      name: 'Synthetic other coordination workspace',
    })
  ).id;
  const invitation = await workspaces().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic plain member',
  });
  await workspaces('dave').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  const create = async (name: string) =>
    (
      await programmes().create({
        commandId: randomUUID(),
        workspaceId,
        name,
        reportingPurpose: 'Synthetic participant planning test only',
        acknowledged: true,
      })
    ).id as string;
  programmeId = await create('Synthetic coordination programme');
  secondProgramme = await create('Synthetic second coordination programme');
  bobReg = await register(programmeId, 'bob', 'Synthetic participant Bob');
  carolReg = await register(programmeId, 'carol', 'Synthetic participant Carol');
  secondReg = await register(secondProgramme, 'carol', 'Synthetic Carol second programme');
  oldSnapshot = await snapshot();
  await migrateCustomerProgrammeCoordination(f.owner);
  await migrateCustomerProgrammeCoordination(f.owner);
}, 90000);
afterAll(async () => {
  await f?.close();
});

test('populated additive install preserves every existing row, function, ACL, policy and receipt and is repeatable', async () => {
  const after = await snapshot();
  const knownTables = new Set(oldSnapshot.tables.map((t) => t.oid));
  const knownFunctions = new Set(oldSnapshot.functions.map((p) => p.oid));
  expect(after.functions.filter((p) => knownFunctions.has(p.oid))).toEqual(oldSnapshot.functions);
  expect(after.tables.filter((t) => knownTables.has(t.oid))).toEqual(oldSnapshot.tables);
  expect(
    after.tables
      .filter((t) => !knownTables.has(t.oid))
      .map((t) => t.relname)
      .sort(),
  ).toEqual([
    'programme_attendance_revision',
    'programme_capacity_revision',
    'programme_coordination_command',
    'programme_participant_record',
    'programme_participant_record_revision',
    'programme_task',
    'programme_task_revision',
  ]);
  const keep = after.tables.map((t) => knownTables.has(t.oid));
  expect(after.digests.filter((_, i) => keep[i])).toEqual(oldSnapshot.digests);
  expect(after.policies).toEqual(oldSnapshot.policies);
  expect(after.coreHistory).toEqual(oldSnapshot.coreHistory);
  expect(after.customerHistory).toEqual(oldSnapshot.customerHistory);
  expect(
    (await f.owner.query('SELECT name FROM customer_programme_coordination_migrations.applied'))
      .rows,
  ).toEqual([{ name: '0001_programme_coordination_and_reporting.sql' }]);
});

test('the gate is independent, default-off and needs every earlier flag', () => {
  expect(customerProgrammeCoordinationEnabled({})).toBe(false);
  const all = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
  };
  expect(customerProgrammeCoordinationEnabled(all)).toBe(false);
  const on = { ...all, CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED: 'true' };
  expect(customerProgrammeCoordinationEnabled(on)).toBe(true);
  expect(customerProgrammeCoordinationEnabled({ ...on, VERCEL_ENV: 'production' })).toBe(false);
  expect(
    customerProgrammeCoordinationEnabled({
      CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED: 'true',
    }),
  ).toBe(false);
});

test('an empty programme reports nothing invented and says nothing is verified or sent', async () => {
  const r = await report();
  expect(r).toMatchObject({
    verified: false,
    sendsMessages: false,
    activeParticipants: 2,
    capacity: { capacity: null, version: 0 },
    attendance: { attended: 0, absent: 0, notRecorded: 2, withdrawnOrRemoved: 0 },
    tasks: { open: 0, inProgress: 0, done: 0, cancelled: 0, overdue: 0 },
    feedback: { responses: 0, shared: 0, notShared: 0, ratingCount: 0, ratingSum: 0, comments: [] },
    outcomes: { total: 0, shared: 0, notShared: 0, byKind: {}, items: [] },
    repeat: { returningParticipants: 1 },
  });
  expect(r.participants.map((p) => p.label)).toEqual([
    'Synthetic participant Bob',
    'Synthetic participant Carol',
  ]);
  expect((await coord().tasks(scope())).tasks).toEqual([]);
});

test('a task is created, revised with the expected version and listed with its provenance', async () => {
  const before = await counts();
  const created = await saveTask(task({ detail: 'Synthetic confirm the hall and projector' }));
  expect(created).toMatchObject({
    replayed: false,
    task: { seq: 1, version: 1, status: 'OPEN', provenance: 'ORGANISER_RECORDED', dueOn: null },
  });
  const id = created.task.id;
  const after = await counts();
  expect(after).toEqual({
    ...before,
    tasks: before.tasks + 1,
    task_revisions: before.task_revisions + 1,
    commands: before.commands + 1,
    events: before.events + 1,
    audits: before.audits + 1,
    outbox: before.outbox + 1,
  });
  const revised = await saveTask(
    task({
      taskId: id,
      title: 'Synthetic book the venue for day one',
      status: 'IN_PROGRESS',
      dueOn: '2026-10-05',
      assigneeLabel: 'Synthetic local guide Rahim',
    }),
    1,
  );
  expect(revised.task).toMatchObject({
    id,
    version: 2,
    status: 'IN_PROGRESS',
    dueOn: '2026-10-05',
    assigneeLabel: 'Synthetic local guide Rahim',
  });
  const stale = await rejected(saveTask(task({ taskId: id, status: 'DONE' }), 1));
  expect(stale.code).toBe('23514');
  expect(stale.message).toContain('changed');
  const list = await coord().tasks(scope());
  expect(list.tasks).toHaveLength(1);
  expect(list.tasks[0]).toMatchObject({ id, version: 2, status: 'IN_PROGRESS' });
  expect(list.nextAfter).toBeNull();
  const history = (
    await f.owner.query(
      'SELECT version,status FROM customer_private.programme_task_revision WHERE task_id=$1 ORDER BY version',
      [id],
    )
  ).rows;
  expect(history).toEqual([
    { version: 1, status: 'OPEN' },
    { version: 2, status: 'IN_PROGRESS' },
  ]);
});

test('task input is checked by the application schema and by SQL independently', async () => {
  const call = (t: Record<string, unknown>, expected = 0) =>
    raw('alice', 'SELECT customer.programme_task_save($1,$2,$3,$4,$5)', [
      randomUUID(),
      workspaceId,
      programmeId,
      expected,
      JSON.stringify(t),
    ]);
  const bad: [string, Record<string, unknown>][] = [
    ['not synthetic', task({ title: 'Book the venue for day one' })],
    ['too short', task({ title: 'Synthetic' })],
    ['control character', task({ title: 'Synthetic book\u0007the venue' })],
    ['bad date', task({ dueOn: '2026-02-31' })],
    ['bad status', task({ status: 'LATER' })],
    ['new task not open', task({ status: 'DONE' })],
    ['detail not synthetic', task({ detail: 'a real note about the venue' })],
    ['assignee not synthetic', task({ assigneeLabel: 'Rahim the guide' })],
    ['extra key', { ...task(), priority: 1 }],
  ];
  for (const [name, t] of bad) {
    const parsed = taskSaveInput.safeParse({
      commandId: randomUUID(),
      ...scope(),
      expectedVersion: 0,
      task: t,
    });
    expect(parsed.success, name + ' (schema)').toBe(false);
    expect(await rejected(call(t)), name + ' (sql)').toBeTruthy();
  }
  expect(
    taskSaveInput.safeParse({
      commandId: randomUUID(),
      ...scope(),
      expectedVersion: 3,
      task: task(),
    }).success,
  ).toBe(false);
  expect((await rejected(call(task(), 4))).code).toBe('23514');
  expect((await rejected(call(task({ taskId: randomUUID() }), 1))).code).toBe('42501');
});

test('a programme holds at most 200 tasks', async () => {
  const have = (
    await f.owner.query(
      'SELECT count(*)::int n FROM customer_private.programme_task WHERE programme_id=$1',
      [secondProgramme],
    )
  ).rows[0].n;
  for (let i = have; i < 200; i++)
    await saveTask(
      task({ title: 'Synthetic task number ' + i }),
      0,
      'alice',
      randomUUID(),
      workspaceId,
      secondProgramme,
    );
  expect(
    (
      await rejected(
        saveTask(
          task({ title: 'Synthetic one task too many' }),
          0,
          'alice',
          randomUUID(),
          workspaceId,
          secondProgramme,
        ),
      )
    ).message,
  ).toContain('limit');
}, 120000);

test('capacity is versioned, is a plan not a gate, and the report shows when it is exceeded', async () => {
  const set = await coord().setCapacity({
    commandId: randomUUID(),
    ...scope(),
    expectedVersion: 0,
    capacity: 1,
    reason: 'Synthetic the venue seats one group',
  });
  expect(set).toMatchObject({ capacity: 1, version: 1, replayed: false });
  expect(
    (
      await rejected(
        coord().setCapacity({
          commandId: randomUUID(),
          ...scope(),
          expectedVersion: 0,
          capacity: 5,
          reason: 'Synthetic stale attempt at capacity',
        }),
      )
    ).code,
  ).toBe('23514');
  const r = await report();
  expect(r.capacity).toMatchObject({ capacity: 1, version: 1 });
  expect(r.activeParticipants).toBe(2);
  await coord().setCapacity({
    commandId: randomUUID(),
    ...scope(),
    expectedVersion: 1,
    capacity: 40,
    reason: 'Synthetic larger hall confirmed',
  });
  expect((await report()).capacity).toMatchObject({ capacity: 40, version: 2 });
  for (const capacity of [0, -1, 10001, 1.5])
    expect(
      (
        await rejected(
          raw('alice', 'SELECT customer.programme_capacity_set($1,$2,$3,$4,$5)', [
            randomUUID(),
            workspaceId,
            programmeId,
            2,
            JSON.stringify({ capacity, reason: 'Synthetic invalid capacity' }),
          ]),
        )
      ).code,
    ).toBe('23514');
});

test('attendance is recorded for active registrations only and an unchanged state adds no revision', async () => {
  const before = await counts();
  const first = await attend(bobReg, 'ATTENDED');
  expect(first).toMatchObject({ state: 'ATTENDED', version: 1 });
  const same = await attend(bobReg, 'ATTENDED');
  expect(same.version).toBe(1);
  expect((await counts()).attendance).toBe(before.attendance + 1);
  expect((await attend(bobReg, 'ABSENT')).version).toBe(2);
  expect((await attend(bobReg, 'ATTENDED')).version).toBe(3);
  const r = await report();
  expect(r.attendance).toMatchObject({ attended: 1, absent: 0, notRecorded: 1 });
  expect(r.participants.find((p) => p.registrationId === bobReg)).toMatchObject({
    attendance: 'ATTENDED',
    attendanceVersion: 3,
  });
  expect((await rejected(attend(secondReg, 'ATTENDED'))).code).toBe('42501');
  expect((await rejected(attend(randomUUID(), 'ATTENDED'))).code).toBe('42501');
});

test('feedback and outcomes are written only by the registered participant, as consented revisions', async () => {
  const fb = await submit(feedback(bobReg));
  expect(fb).toMatchObject({
    replayed: false,
    record: {
      kind: 'FEEDBACK',
      version: 1,
      rating: 4,
      shared: true,
      provenance: 'PARTICIPANT_REPORTED',
    },
  });
  expect((await rejected(submit(feedback(bobReg)))).message).toContain('already exists');
  const own = await coord('bob').ownRecords({ registrationId: bobReg });
  expect(own.feedback).toMatchObject({ recordId: fb.record.recordId, rating: 4 });
  const oc = await submit(outcome(bobReg));
  expect(oc.record).toMatchObject({
    kind: 'OUTCOME',
    outcomeKind: 'MEETING_HELD',
    occurredOn: '2026-10-02',
  });
  // Nobody else can write for, or read, Bob's registration.
  for (const p of ['alice', 'carol', 'dave', 'eve', 'outsider']) {
    expect((await rejected(submit(feedback(bobReg), p))).code, p).toBe('42501');
    expect((await rejected(coord(p).ownRecords({ registrationId: bobReg }))).code, p).toBe('42501');
  }
  // A participant cannot reach another record or kind of record.
  expect(
    (
      await rejected(
        submit(feedback(carolReg, { recordId: fb.record.recordId, expectedVersion: 1 }), 'carol'),
      )
    ).code,
  ).toBe('42501');
  expect(
    (await rejected(submit(outcome(bobReg, { recordId: fb.record.recordId, expectedVersion: 1 }))))
      .code,
  ).toBe('42501');
  // Revision with expected version, stale rejection.
  const edited = await submit(
    feedback(bobReg, {
      recordId: fb.record.recordId,
      expectedVersion: 1,
      rating: 5,
      shared: false,
    }),
  );
  expect(edited.record).toMatchObject({ version: 2, rating: 5, shared: false });
  const stale = await rejected(
    submit(feedback(bobReg, { recordId: fb.record.recordId, expectedVersion: 1, rating: 2 })),
  );
  expect(stale.code).toBe('23514');
});

test('the organiser sees only what the participant chose to share, and a retraction removes it', async () => {
  const bobFeedback = (await coord('bob').ownRecords({ registrationId: bobReg })).feedback!;
  let r = await report();
  expect(r.feedback).toMatchObject({
    responses: 1,
    shared: 0,
    notShared: 1,
    ratingCount: 0,
    ratingSum: 0,
    comments: [],
  });
  expect(r.outcomes).toMatchObject({
    total: 1,
    shared: 1,
    notShared: 0,
    byKind: { MEETING_HELD: 1 },
  });
  expect(r.outcomes.items).toEqual([
    {
      label: 'Synthetic participant Bob',
      outcomeKind: 'MEETING_HELD',
      occurredOn: '2026-10-02',
      note: 'Synthetic met a buyer on day two',
    },
  ]);
  // Share the feedback: counted exactly, comment shown without a name.
  await submit(
    feedback(bobReg, {
      recordId: bobFeedback.recordId,
      expectedVersion: 2,
      rating: 5,
      shared: true,
    }),
  );
  await submit(
    feedback(carolReg, { rating: 3, note: 'Synthetic the schedule was too tight' }),
    'carol',
  );
  r = await report();
  expect(r.feedback).toMatchObject({
    responses: 2,
    shared: 2,
    ratingCount: 2,
    ratingSum: 8,
    distribution: { '1': 0, '2': 0, '3': 1, '4': 0, '5': 1 },
  });
  expect(r.feedback.comments).toHaveLength(2);
  expect(JSON.stringify(r.feedback)).not.toMatch(/Bob|Carol/);
  // Withdrawing consent removes the figure again.
  await submit(
    feedback(bobReg, {
      recordId: bobFeedback.recordId,
      expectedVersion: 3,
      rating: 5,
      shared: false,
    }),
  );
  expect((await report()).feedback).toMatchObject({ shared: 1, notShared: 1, ratingSum: 3 });
  // Retraction hides the record entirely and cannot be combined with sharing.
  expect(
    recordSubmitInput.safeParse(
      feedback(bobReg, { recordId: bobFeedback.recordId, expectedVersion: 4, retracted: true }),
    ).success,
  ).toBe(false);
  await submit(
    feedback(bobReg, {
      recordId: bobFeedback.recordId,
      expectedVersion: 4,
      shared: false,
      retracted: true,
    }),
  );
  expect((await report()).feedback).toMatchObject({ responses: 1, shared: 1 });
  expect(
    (
      await rejected(
        raw('bob', 'SELECT customer.programme_record_submit($1,$2)', [
          randomUUID(),
          JSON.stringify({
            ...feedback(bobReg, {
              recordId: bobFeedback.recordId,
              expectedVersion: 5,
              shared: true,
              retracted: true,
            }),
            commandId: undefined,
          }),
        ]),
      )
    ).code,
  ).toBe('23514');
  expect((await coord('bob').ownRecords({ registrationId: bobReg })).feedback).toMatchObject({
    retracted: true,
  });
});

test('outcome and feedback input is validated in the schema and in SQL, and has no money field', async () => {
  // A registrant with no records yet, in another programme, so every rejection is for the input itself.
  const zedReg = await register(secondProgramme, 'outsider', 'Synthetic participant Zed');
  const sql = (input: Record<string, unknown>) => {
    const { commandId, ...rest } = input;
    void commandId;
    return raw('outsider', 'SELECT customer.programme_record_submit($1,$2)', [
      randomUUID(),
      JSON.stringify(rest),
    ]);
  };
  const bad: [string, Record<string, unknown>][] = [
    ['rating too high', feedback(zedReg, { rating: 6 })],
    ['rating zero', feedback(zedReg, { rating: 0 })],
    ['rating missing', feedback(zedReg, { rating: null })],
    ['feedback with an outcome kind', feedback(zedReg, { outcomeKind: 'MEETING_HELD' })],
    ['outcome without kind', outcome(zedReg, { outcomeKind: null })],
    ['outcome without date', outcome(zedReg, { occurredOn: null })],
    ['outcome with rating', outcome(zedReg, { rating: 3 })],
    ['unknown outcome kind', outcome(zedReg, { outcomeKind: 'ORDER_VALUE' })],
    ['future outcome', outcome(zedReg, { occurredOn: '2099-01-01' })],
    ['note not synthetic', outcome(zedReg, { note: 'Order worth a lot of money' })],
    ['no acknowledgement', outcome(zedReg, { acknowledged: false })],
    ['money field', { ...outcome(zedReg), contractValueMinor: '5000' }],
  ];
  for (const [name, input] of bad) {
    expect(recordSubmitInput.safeParse(input).success, name + ' (schema)').toBe(false);
    const error = await rejected(sql(input));
    expect(error.code, name + ' (sql)').toBe('23514');
    expect(error.message, name + ' (sql)').not.toMatch(/already exists|unavailable/);
  }
  // Nothing was stored for the rejected inputs.
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_participant_record WHERE registration_id=$1',
        [zedReg],
      )
    ).rows[0].n,
  ).toBe(0);
});

test('a withdrawn or removed participant can no longer record results and their records leave the report', async () => {
  await submit(outcome(carolReg), 'carol');
  expect((await report()).outcomes.total).toBe(2);
  await participants('carol').command({
    action: 'withdraw',
    commandId: randomUUID(),
    registrationId: carolReg,
    reason: 'Synthetic participant chooses to withdraw',
    acknowledged: true,
  });
  expect(
    (
      await rejected(
        submit(feedback(carolReg, { recordId: randomUUID(), expectedVersion: 1 }), 'carol'),
      )
    ).code,
  ).toBeTruthy();
  expect((await rejected(coord('carol').ownRecords({ registrationId: carolReg }))).code).toBe(
    '42501',
  );
  expect((await rejected(attend(carolReg, 'ATTENDED'))).message).toContain('active');
  const r = await report();
  expect(r.outcomes.total).toBe(1);
  expect(r.attendance).toMatchObject({ withdrawnOrRemoved: 1 });
  expect(r.participants.find((p) => p.registrationId === carolReg)?.state).toBe('WITHDRAWN');
  expect(r.repeat.returningParticipants).toBe(0);
});

test('tasks report counts including overdue and are never visible to anyone but organisers', async () => {
  await saveTask(task({ title: 'Synthetic overdue visit booking', dueOn: '2020-01-01' }));
  const open = await saveTask(
    task({ title: 'Synthetic future visit booking', dueOn: '2099-01-01' }),
  );
  await saveTask(
    task({
      taskId: open.task.id,
      title: 'Synthetic future visit booking',
      status: 'DONE',
      dueOn: '2099-01-01',
    }),
    1,
  );
  const r = await report();
  // The earlier in-progress task was due on 2026-10-05, which is past, plus the 2020 one.
  expect(r.tasks.overdue).toBe(2);
  expect(r.tasks.done).toBe(1);
  expect(r.tasks.inProgress).toBe(1);
  expect(r.tasks.provenance).toBe('ORGANISER_RECORDED');
});

test('only workspace owners and admins of this programme read the report or write plans; participants write only their own records', async () => {
  const before = await counts();
  for (const p of ['bob', 'carol', 'dave', 'eve', 'outsider']) {
    expect((await rejected(report(p))).code, p + ' report').toBe('42501');
    expect((await rejected(coord(p).tasks(scope()))).code, p + ' tasks').toBe('42501');
    expect((await rejected(saveTask(task(), 0, p))).code, p + ' task').toBe('42501');
    expect((await rejected(attend(bobReg, 'ATTENDED', p))).code, p + ' attendance').toBe('42501');
    expect(
      (
        await rejected(
          coord(p).setCapacity({
            commandId: randomUUID(),
            ...scope(),
            expectedVersion: 2,
            capacity: 3,
            reason: 'Synthetic unauthorised capacity change',
          }),
        )
      ).code,
      p + ' capacity',
    ).toBe('42501');
  }
  expect((await rejected(report('alice', otherWorkspace, programmeId))).code).toBe('42501');
  expect((await rejected(report('eve', otherWorkspace, programmeId))).code).toBe('42501');
  expect((await rejected(report('alice', workspaceId, randomUUID()))).code).toBe('42501');
  expect(await counts()).toEqual(before);
});

test('exact retries return the original, a changed payload under the same command is refused, and writers are serialised', async () => {
  const id = randomUUID();
  const t = task({ title: 'Synthetic retry safe task' });
  const first = await saveTask(t, 0, 'alice', id);
  const again = await saveTask(t, 0, 'alice', id);
  expect(again).toMatchObject({ replayed: true });
  expect(again.task).toEqual(first.task);
  const clash = await rejected(
    saveTask(task({ title: 'Synthetic a different task entirely' }), 0, 'alice', id),
  );
  expect(clash.code).toBe('23514');
  expect(clash.message).toContain('conflicts');
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) => saveTask(task({ title: 'Synthetic parallel task ' + i }))),
  );
  const seqs = results.map((r) => r.task.seq).sort((a, b) => a - b);
  expect(new Set(seqs).size).toBe(6);
  expect(seqs[5] - seqs[0]).toBe(5);
});

test('events and audit rows carry identifiers and the kind only, never text, ratings or outcomes', async () => {
  const events = (
    await f.owner.query(
      "SELECT payload FROM app.domain_event WHERE aggregate_type='customer_programme_coordination'",
    )
  ).rows;
  expect(events.length).toBeGreaterThan(5);
  for (const e of events)
    expect(Object.keys(e.payload).sort()).toEqual([
      'initiator_id',
      'initiator_kind',
      'kind',
      'referenceId',
      'synthetic',
    ]);
  expect(JSON.stringify(events)).not.toMatch(/Synthetic|rating|MEETING_HELD|venue/);
  const c = await counts();
  expect(c.events).toBe(c.audits);
  expect(c.events).toBe(c.outbox);
  expect(c.commercial).toBe(0);
});

test('database guards reject skipped versions, foreign registrations and rewrites even for the schema owner', async () => {
  const t = (await coord().tasks(scope())).tasks[0];
  expect(
    await rejected(
      f.owner.query(
        `INSERT INTO customer_private.programme_task_revision(task_id,workspace_id,programme_id,version,title,status,changed_by)
 SELECT id,workspace_id,programme_id,99,'Synthetic skipped a version','OPEN',created_by FROM customer_private.programme_task WHERE id=$1`,
        [t.id],
      ),
    ),
  ).toMatchObject({ message: expect.stringContaining('out of order') });
  expect(
    await rejected(
      f.owner.query(
        `INSERT INTO customer_private.programme_attendance_revision(registration_id,workspace_id,programme_id,version,state,recorded_by)
 SELECT $1,workspace_id,$2,1,'ATTENDED',principal_id FROM customer_private.programme_registration WHERE id=$3`,
        [secondReg, programmeId, bobReg],
      ),
    ),
  ).toBeTruthy();
  for (const sql of [
    "UPDATE customer_private.programme_task_revision SET title='Synthetic rewritten title'",
    'DELETE FROM customer_private.programme_task_revision',
    'DELETE FROM customer_private.programme_attendance_revision',
    'DELETE FROM customer_private.programme_participant_record_revision',
    'DELETE FROM customer_private.programme_capacity_revision',
    'DELETE FROM customer_private.programme_coordination_command',
  ])
    expect(await rejected(f.owner.query(sql)), sql).toBeTruthy();
});

test('runtime and auth roles cannot read or write coordination tables or call private helpers directly', async () => {
  for (const pool of [f.runtime, f.auth])
    for (const sql of [
      'SELECT * FROM customer_private.programme_task',
      'SELECT * FROM customer_private.programme_task_revision',
      'SELECT * FROM customer_private.programme_capacity_revision',
      'SELECT * FROM customer_private.programme_attendance_revision',
      'SELECT * FROM customer_private.programme_participant_record',
      'SELECT * FROM customer_private.programme_participant_record_revision',
      'SELECT * FROM customer_private.programme_coordination_command',
      "UPDATE customer_private.programme_task_revision SET title='Synthetic rewritten'",
      'DELETE FROM customer_private.programme_participant_record_revision',
    ])
      expect((await rejected(pool.query(sql))).code).toBe('42501');
  for (const sql of [
    'SELECT customer_private.coordination_expiry()',
    'SELECT customer_private.coordination_text(\'"Synthetic abcdefgh"\'::jsonb,11,20,true)',
    'SELECT customer_private.coordination_registration_state(gen_random_uuid())',
    'SELECT customer_private.programme_task_json(gen_random_uuid())',
    'SELECT customer_private.participant_record_json(gen_random_uuid())',
    'SELECT customer_private.coordination_event(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),$$x$$,gen_random_uuid())',
  ])
    expect((await rejected(raw('alice', sql))).code, sql).toBe('42501');
  for (const pool of [f.auth, f.runtime])
    expect(
      (
        await rejected(
          pool.query('SELECT customer.programme_report($1,$2)', [workspaceId, programmeId]),
        )
      ).code,
    ).toBe('42501');
});

test('the account-context guard and session checks run before any database work', async () => {
  const before = await counts();
  expect((await rejected(coord().report(scope(), 'someone-else'))).message).toContain(
    'account changed',
  );
  expect(
    (
      await rejected(
        coord().report(
          scope(),
          subject('alice'),
          'https://ep-other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
        ),
      )
    ).message,
  ).toContain('account changed');
  const unverified = new CustomerProgrammeCoordinationService(
    f.runtime,
    f.auth,
    options,
    async () => ({
      ...session('alice'),
      emailVerified: false,
    }),
  );
  expect((await rejected(unverified.report(scope()))).message).toContain('Verify');
  const expired = new CustomerProgrammeCoordinationService(
    f.runtime,
    f.auth,
    options,
    async () => ({
      ...session('alice'),
      expiresAt: new Date(Date.now() - 1000),
    }),
  );
  expect((await rejected(expired.report(scope()))).message).toContain('Sign in');
  const off = new CustomerProgrammeCoordinationService(
    f.runtime,
    f.auth,
    { ...options, enabled: false },
    async () => session('alice'),
  );
  expect((await rejected(off.report(scope()))).message).toContain('unavailable');
  expect(await counts()).toEqual(before);
});
