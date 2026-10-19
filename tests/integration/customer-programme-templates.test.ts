import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammeTemplates } from '../../packages/db/src/customer-programme-templates-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { migrateCustomerProgrammeCoordination } from '../../packages/db/src/customer-programme-coordination-migrate';
import { migrateCustomerProgrammeEconomics } from '../../packages/db/src/customer-programme-economics-migrate';
import { CustomerProgrammeCoordinationService } from '../../packages/auth/src/customer-programme-coordination';
import { CustomerProgrammeEconomicsService } from '../../packages/auth/src/customer-programme-economics';
import {
  CustomerProgrammeTemplateService,
  customerProgrammeTemplatesEnabled,
  templateSaveInput,
} from '../../packages/auth/src/customer-programme-templates';
import { sessionHash } from '../../packages/db/src/index';

// Invented provider-session fixtures exercise the real restricted SQL logins.
// They do not establish private managed-provider/email acceptance.
const issuer = 'https://ep-template-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'eve', 'outsider'];
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  otherWorkspace: string,
  programmeId: string,
  bobReg: string;
let oldSnapshot: Awaited<ReturnType<typeof snapshot>>;
const subject = (p: string) => 'synthetic-template-' + p;
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
const ledger = (p = 'alice') =>
  new CustomerProgrammeEconomicsService(f.runtime, f.auth, options, async () => session(p));
const templates = (p = 'alice') =>
  new CustomerProgrammeTemplateService(f.runtime, f.auth, options, async () => session(p));
const content = (over: Record<string, unknown> = {}) => ({
  reportingPurpose: 'Synthetic buyer mission to the spring trade fair',
  capacity: 20,
  tasks: [
    {
      title: 'Synthetic book the hotel block',
      detail: 'Synthetic twenty rooms near the venue',
      dueOffsetDays: 0,
      assigneeLabel: null,
    },
    {
      title: 'Synthetic confirm the factory visits',
      detail: null,
      dueOffsetDays: 14,
      assigneeLabel: 'Synthetic local guide Rahim',
    },
    {
      title: 'Synthetic collect participant feedback',
      detail: null,
      dueOffsetDays: null,
      assigneeLabel: null,
    },
  ],
  plannedCosts: [
    {
      kind: 'ORGANISER_EXPENSE',
      description: 'Synthetic venue hire for two days',
      currency: 'BDT',
      amountMinor: '5000000',
    },
    {
      kind: 'ORGANISER_OBLIGATION',
      description: 'Synthetic interpreter fees owed',
      currency: 'USD',
      amountMinor: '120000',
    },
  ],
  ...over,
});
const save = (
  over: Record<string, unknown> = {},
  p = 'alice',
  commandId = randomUUID(),
  target = workspaceId,
) =>
  templates(p).save({
    commandId,
    workspaceId: target,
    expectedVersion: 0,
    templateId: null,
    name: 'Synthetic spring fair delegation',
    description: 'Synthetic a repeatable plan for the spring trade fair',
    content: content(),
    retired: false,
    ...over,
  });
const apply = (
  templateId: string,
  programme: string,
  expectedVersion = 1,
  startDate: string | null = '2026-11-01',
  p = 'alice',
  commandId = randomUUID(),
  target = workspaceId,
) =>
  templates(p).apply({
    commandId,
    workspaceId: target,
    programmeId: programme,
    templateId,
    expectedVersion,
    startDate,
  });
const newProgramme = async (name: string) =>
  (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name,
      reportingPurpose: 'Synthetic participant planning test only',
      acknowledged: true,
    })
  ).id as string;
async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.programme_template) templates,
 (SELECT count(*)::int FROM customer_private.programme_template_revision) revisions,
 (SELECT count(*)::int FROM customer_private.programme_template_application) applications,
 (SELECT count(*)::int FROM customer_private.programme_template_command) commands,
 (SELECT count(*)::int FROM customer_private.programme_task) tasks,
 (SELECT count(*)::int FROM customer_private.programme_task_revision) task_revisions,
 (SELECT count(*)::int FROM customer_private.programme_capacity_revision) capacity,
 (SELECT count(*)::int FROM customer_private.programme_ledger_entry) ledger,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_programme_template') events,
 (SELECT count(*)::int FROM app.audit_event WHERE action LIKE 'customer.programme_template.%') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_programme_template') outbox,
 (SELECT count(*)::int FROM app.commercial_record) commercial,
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

let sourceProgramme: string;
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerParticipants(f.owner);
  for (const p of people)
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: subject(p),
      executorId: f.serviceId,
      reason: 'Explicit invented programme template test identity; no real account or email',
    });
  workspaceId = (
    await workspaces().provision({ commandId: randomUUID(), name: 'Synthetic template workspace' })
  ).id;
  otherWorkspace = (
    await workspaces('eve').provision({
      commandId: randomUUID(),
      name: 'Synthetic other template workspace',
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
  sourceProgramme = await newProgramme('Synthetic source programme');
  programmeId = await newProgramme('Synthetic first target programme');
  bobReg = await register(sourceProgramme, 'bob', 'Synthetic participant Bob');
  // The first target already has a registrant: applying only needs it to be free of tasks, capacity and costs.
  await register(programmeId, 'carol', 'Synthetic participant Carol');
  // The two modules a template seeds are installed first, so the snapshot isolates this module.
  await migrateCustomerProgrammeCoordination(f.owner);
  await migrateCustomerProgrammeEconomics(f.owner);
  oldSnapshot = await snapshot();
  await migrateCustomerProgrammeTemplates(f.owner);
  await migrateCustomerProgrammeTemplates(f.owner);
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
    'programme_template',
    'programme_template_application',
    'programme_template_command',
    'programme_template_revision',
  ]);
  const keep = after.tables.map((t) => knownTables.has(t.oid));
  expect(after.digests.filter((_, i) => keep[i])).toEqual(oldSnapshot.digests);
  expect(after.policies).toEqual(oldSnapshot.policies);
  expect(after.coreHistory).toEqual(oldSnapshot.coreHistory);
  expect(after.customerHistory).toEqual(oldSnapshot.customerHistory);
  expect(
    (await f.owner.query('SELECT name FROM customer_programme_templates_migrations.applied')).rows,
  ).toEqual([{ name: '0001_repeatable_programme_templates.sql' }]);
});

test('the gate needs the coordination and economics flags as well as its own and is off in production', () => {
  expect(customerProgrammeTemplatesEnabled({})).toBe(false);
  const base = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
  };
  const own = { CORRIDRA_CUSTOMER_PROGRAMME_TEMPLATES_ENABLED: 'true' };
  const coordination = { CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED: 'true' };
  const economics = { CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED: 'true' };
  expect(customerProgrammeTemplatesEnabled({ ...base, ...own })).toBe(false);
  expect(customerProgrammeTemplatesEnabled({ ...base, ...own, ...coordination })).toBe(false);
  expect(customerProgrammeTemplatesEnabled({ ...base, ...own, ...economics })).toBe(false);
  expect(customerProgrammeTemplatesEnabled({ ...base, ...coordination, ...economics })).toBe(false);
  expect(
    customerProgrammeTemplatesEnabled({ ...base, ...own, ...coordination, ...economics }),
  ).toBe(true);
  expect(
    customerProgrammeTemplatesEnabled({
      ...base,
      ...own,
      ...coordination,
      ...economics,
      VERCEL_ENV: 'production',
    }),
  ).toBe(false);
});

test('a template is created, revised with the expected version, retired and restored', async () => {
  expect((await templates().list({ workspaceId })).templates).toEqual([]);
  const before = await counts();
  const created = await save();
  expect(created).toMatchObject({
    replayed: false,
    template: {
      seq: 1,
      version: 1,
      retired: false,
      taskCount: 3,
      costCount: 2,
      capacity: 20,
      provenance: 'ORGANISER_RECORDED',
    },
  });
  const after = await counts();
  expect(after).toEqual({
    ...before,
    templates: 1,
    revisions: 1,
    commands: 1,
    events: 1,
    audits: 1,
    outbox: 1,
  });
  const id = created.template.id;
  const revised = await save({
    templateId: id,
    expectedVersion: 1,
    name: 'Synthetic spring fair delegation v2',
    content: content({ capacity: 25 }),
  });
  expect(revised.template).toMatchObject({
    version: 2,
    capacity: 25,
    name: 'Synthetic spring fair delegation v2',
  });
  const stale = await rejected(save({ templateId: id, expectedVersion: 1 }));
  expect(stale.code).toBe('23514');
  expect(stale.message).toContain('changed');
  expect(
    (await save({ templateId: id, expectedVersion: 2, retired: true })).template,
  ).toMatchObject({ version: 3, retired: true });
  expect(
    (await save({ templateId: id, expectedVersion: 3, retired: false })).template,
  ).toMatchObject({ version: 4, retired: false });
  const list = await templates().list({ workspaceId });
  expect(list.templates).toHaveLength(1);
  expect(list.templates[0]).toMatchObject({ id, version: 4 });
  expect(list.nextAfter).toBeNull();
  const history = (
    await f.owner.query(
      'SELECT version,retired FROM customer_private.programme_template_revision WHERE template_id=$1 ORDER BY version',
      [id],
    )
  ).rows;
  expect(history).toEqual([
    { version: 1, retired: false },
    { version: 2, retired: false },
    { version: 3, retired: true },
    { version: 4, retired: false },
  ]);
});

test('template content is checked by the application schema and by SQL independently, and can hold no participant or money-in data', async () => {
  const sql = (c: unknown, name = 'Synthetic invalid content test', retired = false) =>
    raw('alice', 'SELECT customer.programme_template_save($1,$2,$3,$4)', [
      randomUUID(),
      workspaceId,
      0,
      JSON.stringify({ templateId: null, name, description: null, content: c, retired }),
    ]);
  const task = (over: Record<string, unknown> = {}) => ({
    title: 'Synthetic a valid task title',
    detail: null,
    dueOffsetDays: null,
    assigneeLabel: null,
    ...over,
  });
  const cost = (over: Record<string, unknown> = {}) => ({
    kind: 'ORGANISER_EXPENSE',
    description: 'Synthetic a valid cost line',
    currency: 'BDT',
    amountMinor: '100',
    ...over,
  });
  const bad: [string, unknown][] = [
    ['purpose not synthetic', content({ reportingPurpose: 'Buyer mission to the spring fair' })],
    ['extra top-level key', { ...content(), registrations: [] }],
    ['participant data in a task', content({ tasks: [{ ...task(), participant: 'Bob' }] })],
    ['task title not synthetic', content({ tasks: [task({ title: 'Book the hotel block' })] })],
    ['negative offset', content({ tasks: [task({ dueOffsetDays: -1 })] })],
    ['offset beyond 730', content({ tasks: [task({ dueOffsetDays: 731 })] })],
    ['fractional offset', content({ tasks: [task({ dueOffsetDays: 1.5 })] })],
    ['capacity zero', content({ capacity: 0 })],
    ['capacity too large', content({ capacity: 10001 })],
    ['fee due kind', content({ plannedCosts: [cost({ kind: 'PARTICIPANT_FEE' })] })],
    ['payment kind', content({ plannedCosts: [cost({ kind: 'PARTICIPANT_PAYMENT' })] })],
    ['zero amount', content({ plannedCosts: [cost({ amountMinor: '0' })] })],
    ['fractional amount', content({ plannedCosts: [cost({ amountMinor: '1.5' })] })],
    ['too many digits', content({ plannedCosts: [cost({ amountMinor: '1000000000000000000' })] })],
    [
      'cost description not synthetic',
      content({ plannedCosts: [cost({ description: 'Venue hire' })] }),
    ],
    ['actual basis smuggled in', content({ plannedCosts: [{ ...cost(), costBasis: 'ACTUAL' }] })],
    [
      '51 tasks',
      content({
        tasks: Array.from({ length: 51 }, (_, i) => task({ title: 'Synthetic task number ' + i })),
      }),
    ],
    ['31 costs', content({ plannedCosts: Array.from({ length: 31 }, () => cost()) })],
    ['control character', content({ tasks: [task({ title: 'Synthetic bad\u0007title here' })] })],
  ];
  for (const [name, c] of bad) {
    expect(
      templateSaveInput.safeParse({
        commandId: randomUUID(),
        workspaceId,
        expectedVersion: 0,
        templateId: null,
        name: 'Synthetic invalid content test',
        description: null,
        content: c,
        retired: false,
      }).success,
      name + ' (schema)',
    ).toBe(false);
    const error = await rejected(sql(c));
    expect(error.code, name + ' (sql)').toBe('23514');
  }
  expect((await rejected(sql(content({ plannedCosts: [cost({ currency: 'XXX' })] })))).code).toBe(
    '23503',
  );
  expect((await rejected(sql(content(), 'Not synthetic at all'))).code).toBe('23514');
  expect((await rejected(sql(content(), 'Synthetic a retired first version', true))).code).toBe(
    '23514',
  );
  expect(
    templateSaveInput.safeParse({
      commandId: randomUUID(),
      workspaceId,
      expectedVersion: 2,
      templateId: null,
      name: 'Synthetic invalid content test',
      description: null,
      content: content(),
      retired: false,
    }).success,
  ).toBe(false);
});

test('capture reads a programme plan without participants, fees, payments or actual costs, and writes nothing', async () => {
  // Source programme: tasks (one cancelled), capacity, planned costs (one corrected), an actual cost, a fee and a payment.
  const t1 = await coord().saveTask({
    commandId: randomUUID(),
    workspaceId,
    programmeId: sourceProgramme,
    expectedVersion: 0,
    task: {
      taskId: null,
      title: 'Synthetic book the hotel block',
      detail: 'Synthetic twenty rooms',
      status: 'OPEN',
      dueOn: '2026-10-05',
      assigneeLabel: 'Synthetic local guide Rahim',
    },
  });
  const t2 = await coord().saveTask({
    commandId: randomUUID(),
    workspaceId,
    programmeId: sourceProgramme,
    expectedVersion: 0,
    task: {
      taskId: null,
      title: 'Synthetic cancelled idea for later',
      detail: null,
      status: 'OPEN',
      dueOn: null,
      assigneeLabel: null,
    },
  });
  await coord().saveTask({
    commandId: randomUUID(),
    workspaceId,
    programmeId: sourceProgramme,
    expectedVersion: 1,
    task: {
      taskId: t2.task.id,
      title: 'Synthetic cancelled idea for later',
      detail: null,
      status: 'CANCELLED',
      dueOn: null,
      assigneeLabel: null,
    },
  });
  void t1;
  await coord().setCapacity({
    commandId: randomUUID(),
    workspaceId,
    programmeId: sourceProgramme,
    expectedVersion: 0,
    capacity: 30,
    reason: 'Synthetic the hall seats thirty',
  });
  const entry = (over: Record<string, unknown>) => ({
    kind: 'ORGANISER_EXPENSE',
    costBasis: 'PLANNED',
    registrationId: null,
    amountMinor: '5000000',
    currency: 'BDT',
    occurredOn: '2026-10-01',
    description: 'Synthetic venue hire for two days',
    ...over,
  });
  const rec = (e: Record<string, unknown>) =>
    ledger().record({
      commandId: randomUUID(),
      workspaceId,
      programmeId: sourceProgramme,
      entry: e,
      acknowledged: true,
    });
  const kept = await rec(entry({}));
  const dropped = await rec(
    entry({ description: 'Synthetic a cost that was cancelled', amountMinor: '777' }),
  );
  await ledger().record({
    commandId: randomUUID(),
    workspaceId,
    programmeId: sourceProgramme,
    entry: {
      reverseOf: dropped.entry.id,
      occurredOn: '2026-10-02',
      description: 'Synthetic cancelled as entered twice',
    },
    acknowledged: true,
  });
  await rec(
    entry({
      costBasis: 'ACTUAL',
      description: 'Synthetic actual spend so far',
      amountMinor: '4000000',
    }),
  );
  await rec({
    kind: 'PARTICIPANT_FEE',
    costBasis: null,
    registrationId: bobReg,
    amountMinor: '900000',
    currency: 'BDT',
    occurredOn: '2026-10-01',
    description: 'Synthetic participation fee',
  });
  await rec({
    kind: 'PARTICIPANT_PAYMENT',
    costBasis: null,
    registrationId: bobReg,
    amountMinor: '900000',
    currency: 'BDT',
    occurredOn: '2026-10-02',
    description: 'Synthetic payment recorded by the organiser',
  });
  void kept;
  const before = await counts();
  const captured = await templates().capture({ workspaceId, programmeId: sourceProgramme });
  expect(await counts()).toEqual(before);
  expect(captured.content).toEqual({
    reportingPurpose: 'Synthetic participant planning test only',
    capacity: 30,
    tasks: [
      {
        title: 'Synthetic book the hotel block',
        detail: 'Synthetic twenty rooms',
        dueOffsetDays: null,
        assigneeLabel: 'Synthetic local guide Rahim',
      },
    ],
    plannedCosts: [
      {
        kind: 'ORGANISER_EXPENSE',
        description: 'Synthetic venue hire for two days',
        currency: 'BDT',
        amountMinor: '5000000',
      },
    ],
  });
  expect(JSON.stringify(captured)).not.toMatch(
    /Bob|900000|4000000|registration|cancelled|payment/i,
  );
  // A captured plan is valid template content as it stands.
  expect(
    (await save({ name: 'Synthetic captured source plan', content: captured.content })).template,
  ).toMatchObject({ taskCount: 1, costCount: 1, capacity: 30 });
});

test('applying a template seeds capacity, tasks and planned costs into an empty programme exactly, once', async () => {
  const t = (await save({ name: 'Synthetic template to apply' })).template;
  const before = await counts();
  const result = await apply(t.id, programmeId, 1, '2026-11-01');
  expect(result).toMatchObject({
    replayed: false,
    templateId: t.id,
    templateVersion: 1,
    tasksCreated: 3,
    plannedCostsCreated: 2,
    capacity: 20,
    startDate: '2026-11-01',
  });
  const after = await counts();
  expect(after).toEqual({
    ...before,
    applications: before.applications + 1,
    commands: before.commands + 1,
    tasks: before.tasks + 3,
    task_revisions: before.task_revisions + 3,
    capacity: before.capacity + 1,
    ledger: before.ledger + 2,
    events: before.events + 1,
    audits: before.audits + 1,
    outbox: before.outbox + 1,
  });
  const rows = (await coord().tasks({ workspaceId, programmeId })).tasks;
  expect(rows.map((r) => [r.seq, r.title, r.status, r.dueOn, r.assigneeLabel, r.version])).toEqual([
    [1, 'Synthetic book the hotel block', 'OPEN', '2026-11-01', null, 1],
    [
      2,
      'Synthetic confirm the factory visits',
      'OPEN',
      '2026-11-15',
      'Synthetic local guide Rahim',
      1,
    ],
    [3, 'Synthetic collect participant feedback', 'OPEN', null, null, 1],
  ]);
  const report = await coord().report({ workspaceId, programmeId });
  expect(report.capacity).toMatchObject({ capacity: 20, version: 1 });
  const entries = (await ledger().list({ workspaceId, programmeId })).entries.sort(
    (a, b) => a.seq - b.seq,
  );
  expect(
    entries.map((e) => [
      e.seq,
      e.kind,
      e.costBasis,
      e.amountMinor,
      e.currency,
      e.occurredOn,
      e.registrationId,
    ]),
  ).toEqual([
    [1, 'ORGANISER_EXPENSE', 'PLANNED', '5000000', 'BDT', '2026-11-01', null],
    [2, 'ORGANISER_OBLIGATION', 'PLANNED', '120000', 'USD', '2026-11-01', null],
  ]);
  const summary = await ledger().summary({ workspaceId, programmeId });
  expect(summary.currencies.find((c) => c.currency === 'BDT')).toMatchObject({
    plannedCosts: { total: '5000000' },
    feesDue: '0',
    actualCosts: { total: '0' },
  });
  const app = (
    await f.owner.query(
      'SELECT template_id,template_version,task_count,cost_count,capacity FROM customer_private.programme_template_application WHERE programme_id=$1',
      [programmeId],
    )
  ).rows;
  expect(app).toEqual([
    { template_id: t.id, template_version: 1, task_count: 3, cost_count: 2, capacity: 20 },
  ]);
  // The applied tasks are ordinary records: they can be revised with the coordination rules.
  expect(
    (
      await coord().saveTask({
        commandId: randomUUID(),
        workspaceId,
        programmeId,
        expectedVersion: 1,
        task: {
          taskId: rows[0].id,
          title: rows[0].title,
          detail: rows[0].detail,
          status: 'DONE',
          dueOn: rows[0].dueOn,
          assigneeLabel: null,
        },
      })
    ).task.version,
  ).toBe(2);
});

test('no start date leaves tasks undated and dates planned costs on the day of application', async () => {
  const empty = await newProgramme('Synthetic undated target programme');
  const t = (await save({ name: 'Synthetic undated template' })).template;
  await apply(t.id, empty, 1, null);
  expect(
    (await coord().tasks({ workspaceId, programmeId: empty })).tasks.every((r) => r.dueOn === null),
  ).toBe(true);
  const today = (await f.owner.query("SELECT to_char(current_date,'YYYY-MM-DD') d")).rows[0].d;
  expect(
    (await ledger().list({ workspaceId, programmeId: empty })).entries.every(
      (e) => e.occurredOn === today,
    ),
  ).toBe(true);
});

test('application is refused for a programme that already has work, was already seeded, or a template that is stale or retired', async () => {
  const t = (await save({ name: 'Synthetic refusal template' })).template;
  // Already seeded.
  expect((await rejected(apply(t.id, programmeId))).message).toContain('empty programme');
  // Has a task / a capacity / a ledger entry only.
  const withTask = await newProgramme('Synthetic programme with a task');
  await coord().saveTask({
    commandId: randomUUID(),
    workspaceId,
    programmeId: withTask,
    expectedVersion: 0,
    task: {
      taskId: null,
      title: 'Synthetic an existing task',
      detail: null,
      status: 'OPEN',
      dueOn: null,
      assigneeLabel: null,
    },
  });
  const withCapacity = await newProgramme('Synthetic programme with a capacity');
  await coord().setCapacity({
    commandId: randomUUID(),
    workspaceId,
    programmeId: withCapacity,
    expectedVersion: 0,
    capacity: 5,
    reason: 'Synthetic a small room only',
  });
  const withLedger = await newProgramme('Synthetic programme with a cost');
  await ledger().record({
    commandId: randomUUID(),
    workspaceId,
    programmeId: withLedger,
    entry: {
      kind: 'ORGANISER_EXPENSE',
      costBasis: 'ACTUAL',
      registrationId: null,
      amountMinor: '100',
      currency: 'BDT',
      occurredOn: '2026-10-01',
      description: 'Synthetic an existing cost line',
    },
    acknowledged: true,
  });
  const mid = await counts();
  for (const p of [withTask, withCapacity, withLedger]) {
    const error = await rejected(apply(t.id, p));
    expect(error.code).toBe('23514');
    expect(error.message).toContain('empty programme');
  }
  expect(await counts()).toEqual(mid);
  // Stale version, retired, unknown, other workspace.
  const target = await newProgramme('Synthetic refusal target programme');
  expect((await rejected(apply(t.id, target, 5))).message).toContain('changed');
  const retired = (
    await save({
      templateId: t.id,
      expectedVersion: 1,
      name: 'Synthetic refusal template',
      retired: true,
    })
  ).template;
  expect((await rejected(apply(t.id, target, retired.version))).message).toContain('retired');
  expect((await rejected(apply(randomUUID(), target, 1))).code).toBe('42501');
  expect((await coord().tasks({ workspaceId, programmeId: target })).tasks).toEqual([]);
});

test('a failure part-way through application leaves the programme untouched', async () => {
  const t = (
    await save({
      name: 'Synthetic late dated template',
      content: content({
        tasks: [
          {
            title: 'Synthetic first task that is fine',
            detail: null,
            dueOffsetDays: 0,
            assigneeLabel: null,
          },
          {
            title: 'Synthetic second task too far out',
            detail: null,
            dueOffsetDays: 730,
            assigneeLabel: null,
          },
        ],
      }),
    })
  ).template;
  const target = await newProgramme('Synthetic rollback target programme');
  const before = await counts();
  const error = await rejected(apply(t.id, target, 1, '2099-12-30'));
  expect(error.message).toContain('outside the supported range');
  expect(await counts()).toEqual(before);
  expect((await coord().report({ workspaceId, programmeId: target })).capacity.capacity).toBeNull();
  // The same programme can still be seeded afterwards.
  expect((await apply(t.id, target, 1, '2026-11-01')).tasksCreated).toBe(2);
});

test('only workspace owners and admins read or write templates; everyone else is denied without a trace', async () => {
  const t = (await templates().list({ workspaceId })).templates[0];
  const target = await newProgramme('Synthetic denial target programme');
  const before = await counts();
  for (const p of ['bob', 'carol', 'dave', 'eve', 'outsider']) {
    expect((await rejected(templates(p).list({ workspaceId }))).code, p + ' list').toBe('42501');
    expect((await rejected(save({}, p))).code, p + ' save').toBe('42501');
    expect(
      (await rejected(templates(p).capture({ workspaceId, programmeId: sourceProgramme }))).code,
      p + ' capture',
    ).toBe('42501');
    expect((await rejected(apply(t.id, target, t.version, null, p))).code, p + ' apply').toBe(
      '42501',
    );
  }
  expect((await rejected(templates().list({ workspaceId: otherWorkspace }))).code).toBe('42501');
  expect((await rejected(save({}, 'alice', randomUUID(), otherWorkspace))).code).toBe('42501');
  expect(
    (await rejected(apply(t.id, target, t.version, null, 'eve', randomUUID(), otherWorkspace)))
      .code,
  ).toBe('42501');
  // A template from another workspace cannot be used here.
  const foreign = (
    await save({ name: 'Synthetic eve template here' }, 'eve', randomUUID(), otherWorkspace)
  ).template;
  expect((await rejected(apply(foreign.id, target, 1))).code).toBe('42501');
  expect(await counts()).toEqual({
    ...before,
    templates: before.templates + 1,
    revisions: before.revisions + 1,
    commands: before.commands + 1,
    events: before.events + 1,
    audits: before.audits + 1,
    outbox: before.outbox + 1,
  });
});

test('exact retries return the original, a changed payload under the same command is refused, and concurrent applies seed once', async () => {
  const id = randomUUID();
  const first = await save({ name: 'Synthetic retry safe template' }, 'alice', id);
  const again = await save({ name: 'Synthetic retry safe template' }, 'alice', id);
  expect(again).toMatchObject({ replayed: true });
  expect(again.template).toEqual(first.template);
  const clash = await rejected(
    save({ name: 'Synthetic a different template entirely' }, 'alice', id),
  );
  expect(clash.code).toBe('23514');
  expect(clash.message).toContain('conflicts');
  const a = (await save({ name: 'Synthetic race template alpha' })).template;
  const b = (await save({ name: 'Synthetic race template beta' })).template;
  const target = await newProgramme('Synthetic race target programme');
  const outcomes = await Promise.allSettled([
    apply(a.id, target, 1, null),
    apply(b.id, target, 1, null),
  ]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_template_application WHERE programme_id=$1',
        [target],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_task WHERE programme_id=$1',
        [target],
      )
    ).rows[0].n,
  ).toBe(3);
  const cmd = randomUUID();
  const second = await newProgramme('Synthetic retry apply programme');
  const r1 = await apply(a.id, second, 1, '2026-12-01', 'alice', cmd);
  const r2 = await apply(a.id, second, 1, '2026-12-01', 'alice', cmd);
  expect(r2).toMatchObject({ replayed: true, tasksCreated: r1.tasksCreated });
  expect((await rejected(apply(a.id, second, 1, '2026-12-02', 'alice', cmd))).message).toContain(
    'conflicts',
  );
});

test('a workspace holds at most 50 templates', async () => {
  const have = (
    await f.owner.query(
      'SELECT count(*)::int n FROM customer_private.programme_template WHERE workspace_id=$1',
      [workspaceId],
    )
  ).rows[0].n;
  for (let i = have; i < 49; i++)
    await f.owner.query(
      'INSERT INTO customer_private.programme_template(workspace_id,seq,created_by) SELECT $1,$2,created_by FROM customer_private.programme_template WHERE workspace_id=$1 LIMIT 1',
      [workspaceId, i + 1],
    );
  expect((await save({ name: 'Synthetic the fiftieth template' })).template.seq).toBe(50);
  expect((await rejected(save({ name: 'Synthetic one template too many' }))).message).toContain(
    'limit',
  );
});

test('events and audit rows carry identifiers, counts and the kind only, never names, text or amounts', async () => {
  const events = (
    await f.owner.query(
      "SELECT payload FROM app.domain_event WHERE aggregate_type='customer_programme_template'",
    )
  ).rows;
  expect(events.length).toBeGreaterThan(8);
  const allowed = new Set([
    'templateId',
    'version',
    'retired',
    'programmeId',
    'tasks',
    'plannedCosts',
    'kind',
    'synthetic',
    'initiator_id',
    'initiator_kind',
  ]);
  for (const e of events)
    for (const key of Object.keys(e.payload)) expect(allowed.has(key), key).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/Synthetic|BDT|USD|5000000|hotel|venue/);
  const c = await counts();
  expect(c.events).toBe(c.audits);
  expect(c.events).toBe(c.outbox);
  expect(c.commercial).toBe(0);
});

test('database guards reject skipped versions, a second application and rewrites even for the schema owner', async () => {
  const t = (await templates().list({ workspaceId })).templates[0];
  expect(
    await rejected(
      f.owner.query(
        "INSERT INTO customer_private.programme_template_revision(template_id,workspace_id,version,name,content,retired,changed_by) SELECT id,workspace_id,99,'Synthetic skipped a version',$2::jsonb,false,created_by FROM customer_private.programme_template WHERE id=$1",
        [t.id, JSON.stringify(content())],
      ),
    ),
  ).toMatchObject({ message: expect.stringContaining('out of order') });
  expect(
    await rejected(
      f.owner.query(
        'INSERT INTO customer_private.programme_template_application(workspace_id,programme_id,template_id,template_version,task_count,cost_count,applied_by) SELECT workspace_id,programme_id,template_id,template_version,0,0,applied_by FROM customer_private.programme_template_application LIMIT 1',
      ),
    ),
  ).toBeTruthy();
  for (const sql of [
    "UPDATE customer_private.programme_template_revision SET name='Synthetic rewritten name'",
    'DELETE FROM customer_private.programme_template_revision',
    'DELETE FROM customer_private.programme_template_application',
    'DELETE FROM customer_private.programme_template',
    'DELETE FROM customer_private.programme_template_command',
  ])
    expect(await rejected(f.owner.query(sql)), sql).toBeTruthy();
});

test('runtime and auth roles cannot read or write template tables or call private helpers directly', async () => {
  for (const pool of [f.runtime, f.auth])
    for (const sql of [
      'SELECT * FROM customer_private.programme_template',
      'SELECT * FROM customer_private.programme_template_revision',
      'SELECT * FROM customer_private.programme_template_application',
      'SELECT * FROM customer_private.programme_template_command',
      "UPDATE customer_private.programme_template_revision SET name='Synthetic rewritten'",
      'DELETE FROM customer_private.programme_template_application',
    ])
      expect((await rejected(pool.query(sql))).code).toBe('42501');
  for (const sql of [
    "SELECT customer_private.template_content('{}'::jsonb)",
    'SELECT customer_private.template_json(gen_random_uuid())',
    'SELECT customer_private.template_event(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),$$x$$,$${}$$::jsonb)',
  ])
    expect((await rejected(raw('alice', sql))).code, sql).toBe('42501');
  for (const pool of [f.auth, f.runtime])
    expect(
      (await rejected(pool.query('SELECT customer.programme_templates($1)', [workspaceId]))).code,
    ).toBe('42501');
});

test('the account-context guard and session checks run before any database work', async () => {
  const before = await counts();
  expect((await rejected(templates().list({ workspaceId }, 'someone-else'))).message).toContain(
    'account changed',
  );
  expect(
    (
      await rejected(
        templates().list(
          { workspaceId },
          subject('alice'),
          'https://ep-other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
        ),
      )
    ).message,
  ).toContain('account changed');
  const unverified = new CustomerProgrammeTemplateService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    emailVerified: false,
  }));
  expect((await rejected(unverified.list({ workspaceId }))).message).toContain('Verify');
  const expired = new CustomerProgrammeTemplateService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    expiresAt: new Date(Date.now() - 1000),
  }));
  expect((await rejected(expired.list({ workspaceId }))).message).toContain('Sign in');
  const off = new CustomerProgrammeTemplateService(
    f.runtime,
    f.auth,
    { ...options, enabled: false },
    async () => session('alice'),
  );
  expect((await rejected(off.list({ workspaceId }))).message).toContain('unavailable');
  expect(await counts()).toEqual(before);
});
