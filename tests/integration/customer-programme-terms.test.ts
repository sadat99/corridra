import { beforeAll, afterAll, expect, test } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './support';
import { migrateCustomerProgrammeEconomics } from '../../packages/db/src/customer-programme-economics-migrate';
import { migrateCustomerProgrammeCoordination } from '../../packages/db/src/customer-programme-coordination-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerProgrammeTerms } from '../../packages/db/src/customer-programme-terms-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerOrganisationProfileService } from '../../packages/auth/src/customer-organisation-profiles';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import { CustomerProgrammeEconomicsService } from '../../packages/auth/src/customer-programme-economics';
import { CustomerProgrammeCoordinationService } from '../../packages/auth/src/customer-programme-coordination';
import {
  CustomerProgrammeTermsService,
  customerProgrammeTermsEnabled,
  eligibilitySetInput,
  enrolmentInput,
  placesSetInput,
  termsPublishInput,
} from '../../packages/auth/src/customer-programme-terms';
import { sessionHash } from '../../packages/db/src/index';

// Invented provider-session fixtures exercise the real restricted SQL logins.
// They do not establish private managed-provider/email acceptance.
const issuer = 'https://ep-terms-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = [
  'alice',
  'gina',
  'harry',
  'ivy',
  'olga',
  'bob',
  'carol',
  'dave',
  'erin',
  'finn',
  'gwen',
  'x1',
  'x2',
  'x3',
  'x4',
  'x5',
  'x6',
];
const ASOF = '2026-10-20';
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  otherWorkspace: string,
  programmeId: string,
  fullProgramme: string,
  raceProgramme: string,
  noWaitProgramme: string;
const reg: Record<string, string> = {};
const own: Record<string, string> = {};
let oldSnapshot: Awaited<ReturnType<typeof snapshot>>;
const subject = (p: string) => 'synthetic-terms-' + p;
const session = (p: string): CustomerSession => ({
  subject: subject(p),
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const make =
  <T>(Service: new (...a: never[]) => T) =>
  (p = 'alice') =>
    new (Service as unknown as new (...a: unknown[]) => T)(f.runtime, f.auth, options, async () =>
      session(p),
    );
const workspaces = make(CustomerWorkspaceService);
const programmes = make(CustomerProgrammeService);
const participants = make(CustomerParticipantService);
const profiles = make(CustomerOrganisationProfileService);
const roles = make(CustomerMemberRoleService);
const ledger = make(CustomerProgrammeEconomicsService);
const coord = make(CustomerProgrammeCoordinationService);
const terms = make(CustomerProgrammeTermsService);
const scope = (target = workspaceId, programme = programmeId) => ({
  workspaceId: target,
  programmeId: programme,
});
const termsIn = (over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  ...scope(),
  expectedVersion: 0,
  included: 'Synthetic ground transport and two hotel nights',
  excluded: 'Synthetic flights and personal expenses',
  cancellationTerms: 'Synthetic cancel up to fourteen days before for a full place back',
  changeTerms: 'Synthetic the organiser may adjust the agenda with notice',
  feesApply: true,
  feeNote: 'Synthetic any fee is recorded by the organiser in the fees section',
  reason: 'Synthetic first version of the terms',
  ...over,
});
const criteria = (over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  ...scope(),
  expectedVersion: 0,
  roles: ['SELLER'],
  sectors: [],
  countries: ['BD'],
  sizeBands: [],
  minProfileFields: 6,
  reason: 'Synthetic only Bangladeshi sellers with a fuller profile',
  ...over,
});
const placesIn = (over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  ...scope(),
  expectedVersion: 0,
  minimum: 1,
  maximum: 2,
  waitlist: true,
  reason: 'Synthetic two places and a waiting list',
  ...over,
});
const apply = (p: string, over: Record<string, unknown> = {}, registration = reg[p]) =>
  terms(p).enrol({
    action: 'apply',
    commandId: randomUUID(),
    registrationId: registration,
    termsVersion: 1,
    profileWorkspaceId: own[p] ?? null,
    acknowledged: true,
    ...over,
  });
const cancel = (p: string, registration = reg[p]) =>
  terms(p).enrol({
    action: 'cancel',
    commandId: randomUUID(),
    registrationId: registration,
    acknowledged: true,
  });
const acceptTerms = (p: string, version: number) =>
  terms(p).enrol({
    action: 'accept_terms',
    commandId: randomUUID(),
    registrationId: reg[p],
    termsVersion: version,
    acknowledged: true,
  });
const place = (p: string, registration = reg[p]) =>
  terms(p).ownPlace({ registrationId: registration });
const report = (p = 'alice', programme = programmeId) =>
  terms(p).report(scope(workspaceId, programme));
const state = (p = 'alice') => terms(p).state(scope());
const profileDetails = (over: Record<string, unknown> = {}) => ({
  legalName: 'Synthetic Dhaka Garments Limited',
  countryCode: 'BD',
  website: 'https://garments.example',
  commercialRoles: ['SELLER', 'MANUFACTURER'],
  sectors: ['Knitwear', 'Denim'],
  sizeBand: '201-1000',
  summary: 'Synthetic exporter of knit and denim garments for European buyers',
  ...over,
});
const saveProfile = (p: string, over: Record<string, unknown> = {}, expectedVersion = 0) =>
  profiles(p).command({
    commandId: randomUUID(),
    workspaceId: own[p],
    expectedVersion,
    reason: 'Synthetic profile for the terms test',
    acknowledged: true,
    ...profileDetails(over),
  });

async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.programme_terms_revision) terms,
 (SELECT count(*)::int FROM customer_private.programme_eligibility_revision) criteria,
 (SELECT count(*)::int FROM customer_private.programme_places_revision) places,
 (SELECT count(*)::int FROM customer_private.programme_terms_acceptance) acceptances,
 (SELECT count(*)::int FROM customer_private.programme_enrolment) enrolments,
 (SELECT count(*)::int FROM customer_private.programme_enrolment_revision) enrolment_revisions,
 (SELECT count(*)::int FROM customer_private.programme_task_plan_revision) plans,
 (SELECT count(*)::int FROM customer_private.programme_terms_command) commands,
 (SELECT count(*)::int FROM customer_private.programme_capacity_revision) capacity,
 (SELECT count(*)::int FROM customer_private.programme_task_revision) task_revisions,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_programme_terms') events,
 (SELECT count(*)::int FROM app.audit_event WHERE action LIKE 'customer.programme_terms.%') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_programme_terms') outbox,
 (SELECT count(*)::int FROM app.commercial_record) commercial,
 (SELECT count(*)::int FROM app.organisation) organisations,
 (SELECT count(*)::int FROM customer_private.programme_ledger_entry) ledger,
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
  const triggers = (
    await f.owner.query(
      `SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) def FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1,2`,
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
    triggers,
    digests,
    policies: (
      await f.owner.query(
        "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
      )
    ).rows,
    coreHistory: (await f.owner.query('SELECT * FROM migrations.applied ORDER BY name')).rows,
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
async function join(person: string, target = workspaceId) {
  const invited = await workspaces('alice').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: target,
    label: 'Synthetic invited ' + person,
  });
  return (
    await workspaces(person).access({
      action: 'accept',
      commandId: randomUUID(),
      token: invited.token!,
    })
  ).memberId as string;
}
const createProgramme = async (name: string) =>
  (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name,
      reportingPurpose: 'Synthetic participant planning test only',
      acknowledged: true,
    })
  ).id as string;
const memberKeyFor = async (label: string) =>
  (await state()).members.find((m) => m.label.includes(label))!.key;
const saveTask = (title: string, dueOn: string | null, programme = programmeId) =>
  coord().saveTask({
    commandId: randomUUID(),
    ...scope(workspaceId, programme),
    expectedVersion: 0,
    task: {
      taskId: null,
      title,
      detail: null,
      status: 'OPEN',
      dueOn,
      assigneeLabel: null,
    },
  });
const assign = (
  taskId: string,
  key: string | null,
  visible: boolean,
  expectedVersion = 0,
  p = 'alice',
  target = workspaceId,
) =>
  terms(p).assignTask({
    commandId: randomUUID(),
    ...scope(target),
    taskId,
    expectedVersion,
    assigneeKey: key,
    participantVisible: visible,
  });
const done = (p: string, taskId: string, expectedVersion: number) =>
  terms(p).finishTask({ commandId: randomUUID(), ...scope(), taskId, expectedVersion });

beforeAll(async () => {
  f = await fixture();
  // Stage everything this module reads, populated, before the module exists.
  await migrateCustomerProgrammeEconomics(f.owner);
  await migrateCustomerProgrammeCoordination(f.owner);
  await migrateCustomerMemberRoles(f.owner);
  for (const p of people)
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: subject(p),
      executorId: f.serviceId,
      reason: 'Explicit invented programme terms test identity; no real account or email',
    });
  workspaceId = (
    await workspaces().provision({ commandId: randomUUID(), name: 'Synthetic terms workspace' })
  ).id;
  otherWorkspace = (
    await workspaces('olga').provision({
      commandId: randomUUID(),
      name: 'Synthetic other terms workspace',
    })
  ).id;
  const ginaMember = await join('gina');
  await roles().command({
    action: 'set_role',
    commandId: randomUUID(),
    workspaceId,
    memberId: ginaMember,
    role: 'admin',
    expectedRole: 'member',
  });
  await join('harry');
  const ivyMember = await join('ivy');
  for (const p of [
    'bob',
    'carol',
    'dave',
    'erin',
    'finn',
    'gwen',
    'x1',
    'x2',
    'x3',
    'x4',
    'x5',
    'x6',
  ])
    own[p] = (
      await workspaces(p).provision({
        commandId: randomUUID(),
        name: 'Synthetic ' + p + ' company workspace',
      })
    ).id;
  for (const p of ['bob', 'erin', 'finn', 'gwen']) await saveProfile(p);
  await saveProfile('carol', {
    commercialRoles: ['BUYER'],
    countryCode: 'DE',
    website: null,
    sectors: [],
    sizeBand: '11-50',
  });
  programmeId = await createProgramme('Synthetic terms programme');
  fullProgramme = await createProgramme('Synthetic second terms programme');
  raceProgramme = await createProgramme('Synthetic race programme');
  noWaitProgramme = await createProgramme('Synthetic no waiting list programme');
  for (const p of ['bob', 'carol', 'dave', 'erin', 'finn', 'gwen'])
    reg[p] = await register(programmeId, p, 'Synthetic participant ' + p);
  oldSnapshot = await snapshot();
  await migrateCustomerProgrammeTerms(f.owner);
  await migrateCustomerProgrammeTerms(f.owner);
  void ivyMember;
}, 180000);
afterAll(async () => {
  await f?.close();
});

test('populated additive install preserves every existing row, function, ACL, trigger, policy and receipt and is repeatable with an exact hash', async () => {
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
    'programme_eligibility_revision',
    'programme_enrolment',
    'programme_enrolment_revision',
    'programme_places_revision',
    'programme_task_plan_revision',
    'programme_terms_acceptance',
    'programme_terms_command',
    'programme_terms_revision',
  ]);
  const keep = after.tables.map((t) => knownTables.has(t.oid));
  expect(after.digests.filter((_, i) => keep[i])).toEqual(oldSnapshot.digests);
  expect(after.policies).toEqual(oldSnapshot.policies);
  expect(after.coreHistory).toEqual(oldSnapshot.coreHistory);
  // The only changed triggers are the new ones on the new tables.
  const oldTriggers = new Set(oldSnapshot.triggers.map((t) => t.relname + '.' + t.tgname));
  for (const t of oldSnapshot.triggers)
    expect(after.triggers.find((x) => x.relname === t.relname && x.tgname === t.tgname)).toEqual(t);
  expect(
    after.triggers
      .filter((t) => !oldTriggers.has(t.relname + '.' + t.tgname))
      .every((t) => t.relname.startsWith('programme_')),
  ).toBe(true);
  const sql = await readFile(
    new URL(
      '../../packages/db/customer-programme-terms-migrations/0001_programme_terms_eligibility_and_places.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const rows = (await f.owner.query('SELECT * FROM customer_programme_terms_migrations.applied'))
    .rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe('0001_programme_terms_eligibility_and_places.sql');
  expect(rows[0].sha256).toBe(createHash('sha256').update(sql).digest('hex'));
  await migrateCustomerProgrammeTerms(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM customer_programme_terms_migrations.applied')).rows,
  ).toEqual(rows);
  await f.owner.query('UPDATE customer_programme_terms_migrations.applied SET sha256=$1', [
    randomBytes(32).toString('hex'),
  ]);
  await expect(migrateCustomerProgrammeTerms(f.owner)).rejects.toThrow(/history mismatch/i);
  await f.owner.query('UPDATE customer_programme_terms_migrations.applied SET sha256=$1', [
    rows[0].sha256,
  ]);
});

test('the gate is independent, default-off and needs the earlier flags; the schemas reject unknown or unsafe input', () => {
  expect(customerProgrammeTermsEnabled({})).toBe(false);
  const base = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
  };
  expect(customerProgrammeTermsEnabled(base)).toBe(false);
  const on = { ...base, CORRIDRA_CUSTOMER_PROGRAMME_TERMS_ENABLED: 'true' };
  expect(customerProgrammeTermsEnabled(on)).toBe(true);
  expect(customerProgrammeTermsEnabled({ ...on, VERCEL_ENV: 'production' })).toBe(false);
  expect(customerProgrammeTermsEnabled({ ...on, DATA_ENVIRONMENT: 'real' })).toBe(false);
  expect(
    customerProgrammeTermsEnabled({
      ...on,
      CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED: 'false',
    }),
  ).toBe(false);
  expect(termsPublishInput.safeParse(termsIn()).success).toBe(true);
  for (const bad of [
    termsIn({ included: 'Ground transport and hotel nights' }),
    termsIn({ included: 'Synthetic\u0007 ground transport and nights' }),
    termsIn({ feesApply: false }),
    termsIn({ extra: 1 }),
    termsIn({ reason: 'Synthetic' }),
  ])
    expect(termsPublishInput.safeParse(bad).success).toBe(false);
  expect(eligibilitySetInput.safeParse(criteria()).success).toBe(true);
  for (const bad of [
    criteria({ roles: ['REGULATOR'] }),
    criteria({ sizeBands: ['huge'] }),
    criteria({ minProfileFields: 8 }),
    criteria({ sectors: ['Denim', 'denim'] }),
  ])
    expect(eligibilitySetInput.safeParse(bad).success).toBe(false);
  expect(placesSetInput.safeParse(placesIn()).success).toBe(true);
  expect(placesSetInput.safeParse(placesIn({ minimum: 5, maximum: 2 })).success).toBe(false);
  expect(
    enrolmentInput.safeParse({
      action: 'apply',
      commandId: randomUUID(),
      registrationId: randomUUID(),
      termsVersion: null,
      profileWorkspaceId: null,
      acknowledged: false,
    }).success,
  ).toBe(false);
});

test('the runtime and auth logins cannot read, write or rewrite any private table or call a private helper', async () => {
  const tables = [
    'programme_terms_revision',
    'programme_eligibility_revision',
    'programme_places_revision',
    'programme_terms_acceptance',
    'programme_enrolment',
    'programme_enrolment_revision',
    'programme_task_plan_revision',
    'programme_terms_command',
  ];
  for (const pool of [f.runtime, f.auth])
    for (const t of tables) {
      expect((await rejected(pool.query(`SELECT * FROM customer_private.${t}`))).code, t).toBe(
        '42501',
      );
      expect((await rejected(pool.query(`DELETE FROM customer_private.${t}`))).code, t).toBe(
        '42501',
      );
      expect(
        (await rejected(pool.query(`UPDATE customer_private.${t} SET workspace_id=workspace_id`)))
          .code,
        t,
      ).toBe('42501');
    }
  for (const sql of [
    'SELECT customer_private.terms_maximum(gen_random_uuid())',
    'SELECT customer_private.terms_taken(gen_random_uuid())',
    'SELECT customer_private.terms_directory(gen_random_uuid())',
    'SELECT customer_private.terms_queue_position(gen_random_uuid())',
    'SELECT customer_private.terms_reconcile(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid())',
    'SELECT customer_private.terms_event(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),$$x$$,gen_random_uuid())',
    'SELECT customer_private.terms_json(gen_random_uuid(),1)',
  ])
    expect((await rejected(raw('alice', sql))).code, sql).toBe('42501');
  // Without a signed-in customer proof every public function is refused.
  for (const pool of [f.auth, f.runtime])
    expect(
      (
        await rejected(
          pool.query('SELECT customer.programme_terms_state($1,$2)', [workspaceId, programmeId]),
        )
      ).code,
    ).toBe('42501');
  expect(
    (await rejected(f.runtime.query('SELECT customer.my_programme_reminders(NULL)'))).code,
  ).toBe('42501');
});

test('an empty programme reports nothing invented', async () => {
  const s = await state();
  expect(s).toMatchObject({
    sendsMessages: false,
    terms: { current: null, history: [] },
    eligibility: { current: null, history: [] },
    places: { version: 0, minimum: null, maximum: null, waitlist: false, placed: 0 },
    tasks: [],
  });
  expect(s.members.map((m) => m.label).sort()).toEqual(
    [
      'Synthetic invited gina',
      'Synthetic invited harry',
      'Synthetic invited ivy',
      'Workspace owner',
    ].sort(),
  );
  const r = await report();
  expect(r).toMatchObject({
    verified: false,
    sendsMessages: false,
    places: {
      maximum: null,
      free: null,
      fillPermille: null,
      minimumMet: null,
      placed: 0,
      waiting: 0,
    },
    funnel: {
      registered: 6,
      notApplied: 6,
      placed: 0,
      waitlisted: 0,
      notEligible: 0,
      cancelled: 0,
    },
    terms: { version: 0, acceptedCurrent: 0, acceptanceRatePermille: null },
    satisfaction: { responses: 0, ratingCount: 0, ratingSum: 0 },
    outcomes: { shared: 0, byKind: {} },
  });
  expect(r.roster).toHaveLength(6);
  const p = await place('bob');
  expect(p).toMatchObject({
    terms: null,
    criteria: null,
    enrolment: { status: 'NOT_APPLIED', position: null, reasons: [] },
    placesAvailable: true,
    fees: [],
    tasks: [],
  });
});

test('terms are published as immutable versions by an owner or admin only, with exact replay and conflict', async () => {
  const start = await counts();
  const command = termsIn();
  const first = await terms().publishTerms(command);
  expect(first).toMatchObject({ replayed: false, terms: { version: 1, feesApply: true } });
  const retry = await terms().publishTerms(command);
  expect(retry).toMatchObject({ replayed: true, terms: { version: 1 } });
  const mid = await counts();
  expect(mid).toEqual({
    ...start,
    terms: start.terms + 1,
    commands: start.commands + 1,
    events: start.events + 1,
    audits: start.audits + 1,
    outbox: start.outbox + 1,
  });
  expect(
    (
      await rejected(
        terms().publishTerms({ ...command, included: 'Synthetic different inclusion text' }),
      )
    ).code,
  ).toBe('23514');
  expect(await counts()).toEqual(mid);
  // An admin member writes the next version; the first stays exactly as published.
  const v2 = await terms('gina').publishTerms(
    termsIn({
      expectedVersion: 1,
      included: 'Synthetic ground transport, two hotel nights and breakfast',
      reason: 'Synthetic breakfast added to the package',
    }),
  );
  expect(v2.terms.version).toBe(2);
  const history = (
    await f.owner.query(
      'SELECT version,included FROM customer_private.programme_terms_revision WHERE programme_id=$1 ORDER BY version',
      [programmeId],
    )
  ).rows;
  expect(history.map((h) => h.version)).toEqual([1, 2]);
  expect(history[0].included).toBe('Synthetic ground transport and two hotel nights');
  const s = await state();
  expect(s.terms.current?.version).toBe(2);
  expect(s.terms.history.map((h) => h.version)).toEqual([2, 1]);
  // Stale, repeated, nothing-changed and bad text are refused and write nothing.
  const end = await counts();
  const stale = await rejected(terms().publishTerms(termsIn({ expectedVersion: 1 })));
  expect(stale.code).toBe('23514');
  expect(stale.message).toMatch(/changed/i);
  expect(
    (
      await rejected(
        terms().publishTerms(
          termsIn({
            expectedVersion: 2,
            included: 'Synthetic ground transport, two hotel nights and breakfast',
            reason: 'Synthetic nothing new',
          }),
        ),
      )
    ).message,
  ).toMatch(/nothing changed/i);
  for (const sqlInput of [
    { ...termsIn({ expectedVersion: 2 }), included: 'plain text that is not synthetic' },
    { ...termsIn({ expectedVersion: 2 }), feesApply: false },
    { ...termsIn({ expectedVersion: 2 }), extra: 1 },
  ]) {
    const { commandId, ...payload } = sqlInput;
    expect(
      (
        await rejected(
          raw('alice', 'SELECT customer.programme_terms_publish($1,$2)', [
            commandId,
            JSON.stringify(payload),
          ]),
        )
      ).code,
    ).toBe('23514');
  }
  expect(await counts()).toEqual(end);
  // Republishing version 1 content later is a new version, never a rewrite.
  for (const sql of [
    "UPDATE customer_private.programme_terms_revision SET included='Synthetic rewritten text here'",
    'DELETE FROM customer_private.programme_terms_revision',
    'DELETE FROM customer_private.programme_terms_command',
  ])
    expect((await rejected(f.owner.query(sql))).message).toMatch(/immutable|rewrit|append|reject/i);
});

test('only an owner or admin may change terms, criteria, places or task owners: members, outsiders, forged scopes and disabled accounts are denied', async () => {
  const start = await counts();
  const attempts = (who: string, target = workspaceId) => [
    () =>
      terms(who).publishTerms(
        termsIn({ expectedVersion: 2, ...scope(target), reason: 'Synthetic attempt by ' + who }),
      ),
    () => terms(who).setEligibility(criteria({ ...scope(target) })),
    () => terms(who).setPlaces(placesIn({ ...scope(target) })),
    () => terms(who).refreshPlaces({ commandId: randomUUID(), ...scope(target) }),
    () => terms(who).state(scope(target)),
    () => terms(who).report(scope(target)),
  ];
  for (const who of ['harry', 'olga', 'bob'])
    for (const attempt of attempts(who))
      expect((await rejected(attempt())).code, who).toBe('42501');
  // A forged workspace: alice owns workspaceId, not otherWorkspace, and the programme is not in otherWorkspace.
  for (const attempt of attempts('alice', otherWorkspace))
    expect((await rejected(attempt())).code).toBe('42501');
  for (const attempt of attempts('olga', otherWorkspace))
    expect((await rejected(attempt())).code).toBe('42501');
  expect(await counts()).toEqual(start);
  // A revoked member reads as no access at all.
  const ivyKey = await memberKeyFor('ivy');
  await f.owner.query(
    `INSERT INTO customer_private.workspace_access_revocation(tenant_id,member_id,actor_id)
 SELECT wm.tenant_id,wm.id,wm.principal_id FROM customer_private.workspace_member wm JOIN customer_private.principal p ON p.id=wm.principal_id WHERE p.subject=$1`,
    [subject('ivy')],
  );
  for (const attempt of attempts('ivy')) expect((await rejected(attempt())).code).toBe('42501');
  expect((await state()).members.some((m) => m.key === ivyKey)).toBe(false);
  // A disabled account is refused by the shared admission check.
  await f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject=$1',
    [subject('gina')],
  );
  for (const attempt of attempts('gina')) expect((await rejected(attempt())).code).toBe('42501');
  await f.owner.query('UPDATE customer_private.principal SET disabled_at=NULL WHERE subject=$1', [
    subject('gina'),
  ]);
  expect((await terms('gina').state(scope())).terms.current?.version).toBe(2);
  expect(await counts()).toEqual(start);
});

test('eligibility criteria are versioned, checked in the database, and a change never rewrites an earlier version', async () => {
  const first = await terms().setEligibility(criteria());
  expect(first.eligibility).toMatchObject({
    version: 1,
    roles: ['SELLER'],
    countries: ['BD'],
    minProfileFields: 6,
  });
  expect(
    (await terms().setEligibility(criteria({ expectedVersion: 0, commandId: first.commandId })))
      .replayed,
  ).toBe(true);
  const stale = await rejected(
    terms().setEligibility(criteria({ expectedVersion: 0, minProfileFields: 5 })),
  );
  expect(stale.message).toMatch(/changed/i);
  expect(
    (await rejected(terms().setEligibility(criteria({ expectedVersion: 1 })))).message,
  ).toMatch(/nothing changed/i);
  for (const bad of [
    { roles: ['REGULATOR'] },
    { countries: ['ZZ'] },
    { sizeBands: ['huge'] },
    { sectors: ['Denim', 'denim'] },
    { minProfileFields: 9 },
    { reason: 'not synthetic at all here' },
  ]) {
    const { commandId, ...payload } = criteria({ expectedVersion: 1, ...bad });
    expect(
      (
        await rejected(
          raw('alice', 'SELECT customer.programme_eligibility_set($1,$2)', [
            commandId,
            JSON.stringify(payload),
          ]),
        )
      ).code,
      JSON.stringify(bad),
    ).toBe('23514');
  }
  expect((await state()).eligibility.current?.version).toBe(1);
  expect(
    (
      await rejected(
        f.owner.query(
          'UPDATE customer_private.programme_eligibility_revision SET min_profile_fields=0',
        ),
      )
    ).message,
  ).toMatch(/immutable|rewrit|append|reject/i);
});

test('minimum, maximum and the waiting list are set together; the maximum is the existing capacity record', async () => {
  const start = await counts();
  const set = await terms().setPlaces(placesIn());
  expect(set).toMatchObject({ version: 1, minimum: 1, maximum: 2, waitlist: true, promoted: 0 });
  const end = await counts();
  expect(end.places).toBe(start.places + 1);
  expect(end.capacity).toBe(start.capacity + 1);
  expect((await coord().report(scope())).capacity).toMatchObject({ capacity: 2 });
  expect((await rejected(terms().setPlaces(placesIn({ expectedVersion: 1 })))).message).toMatch(
    /nothing changed/i,
  );
  expect(
    (await rejected(terms().setPlaces(placesIn({ expectedVersion: 0, maximum: 3 })))).message,
  ).toMatch(/changed/i);
  for (const bad of [
    { minimum: 5, maximum: 2 },
    { minimum: 0 },
    { maximum: 10001 },
    { maximum: 2.5 },
    { reason: 'not synthetic at all here' },
  ]) {
    const { commandId, ...payload } = placesIn({ expectedVersion: 1, ...bad });
    expect(
      (
        await rejected(
          raw('alice', 'SELECT customer.programme_places_set($1,$2)', [
            commandId,
            JSON.stringify(payload),
          ]),
        )
      ).code,
      JSON.stringify(bad),
    ).toBe('23514');
  }
  expect((await state()).places).toMatchObject({
    version: 1,
    minimum: 1,
    maximum: 2,
    waitlist: true,
  });
});

test('applying checks terms, eligibility and places together; an ineligible person gets coded reasons and nothing is accepted', async () => {
  // The latest terms version must be named.
  expect((await rejected(apply('bob', { termsVersion: 1 }))).message).toMatch(/terms changed/i);
  expect((await rejected(apply('bob', { termsVersion: null }))).message).toMatch(/terms changed/i);
  // A workspace the person does not belong to is a forged choice.
  expect(
    (await rejected(apply('bob', { profileWorkspaceId: own.erin, termsVersion: 2 }))).code,
  ).toBe('42501');
  expect(
    (await rejected(apply('bob', { profileWorkspaceId: otherWorkspace, termsVersion: 2 }))).code,
  ).toBe('42501');
  // Somebody else's registration is not theirs to use.
  expect((await rejected(apply('erin', { termsVersion: 2 }, reg.bob))).code).toBe('42501');
  const start = await counts();
  const carol = await apply('carol', { termsVersion: 2 });
  expect(carol).toMatchObject({ status: 'NOT_ELIGIBLE', termsVersion: null });
  expect([...carol.reasons!].sort()).toEqual(['COMPLETENESS', 'COUNTRY', 'ROLE']);
  const dave = await apply('dave', { termsVersion: 2, profileWorkspaceId: null });
  expect(dave).toMatchObject({ status: 'NOT_ELIGIBLE', reasons: ['NO_PROFILE'] });
  const mid = await counts();
  expect(mid.enrolments).toBe(start.enrolments + 2);
  expect(mid.enrolment_revisions).toBe(start.enrolment_revisions + 2);
  expect(mid.acceptances).toBe(start.acceptances);
  expect(mid.events).toBe(start.events + 2);
  const carolView = await place('carol');
  expect(carolView.enrolment).toMatchObject({ status: 'NOT_ELIGIBLE' });
  expect(carolView.criteria).toMatchObject({ roles: ['SELLER'], countries: ['BD'] });
  // The organiser sees why, as codes, and never the content of the profile.
  const r = await report();
  expect(r.eligibility.notEligibleByReason).toEqual({
    COMPLETENESS: 1,
    COUNTRY: 1,
    ROLE: 1,
    NO_PROFILE: 1,
  });
  expect(JSON.stringify(r)).not.toMatch(/Knitwear|Denim|garments|Dhaka/i);
  expect(r.roster.find((x) => x.registrationId === reg.carol)).toMatchObject({
    status: 'NOT_ELIGIBLE',
    reasons: expect.arrayContaining(['ROLE']),
  });
  // Eligible people take the two places, then the waiting list in order.
  const bob = await apply('bob', { termsVersion: 2 });
  expect(bob).toMatchObject({ status: 'PLACED', termsVersion: 2, position: null });
  expect(await apply('erin', { termsVersion: 2 })).toMatchObject({ status: 'PLACED' });
  expect(await apply('finn', { termsVersion: 2 })).toMatchObject({
    status: 'WAITLISTED',
    position: 1,
  });
  expect(await apply('gwen', { termsVersion: 2 })).toMatchObject({
    status: 'WAITLISTED',
    position: 2,
  });
  expect((await rejected(apply('bob', { termsVersion: 2 }))).message).toMatch(
    /already have a place/i,
  );
  const accepted = (
    await f.owner.query(
      'SELECT registration_id,terms_version FROM customer_private.programme_terms_acceptance ORDER BY accepted_at',
    )
  ).rows;
  expect(accepted.map((a) => a.terms_version)).toEqual([2, 2, 2, 2]);
  expect(new Set(accepted.map((a) => a.registration_id))).toEqual(
    new Set([reg.bob, reg.erin, reg.finn, reg.gwen]),
  );
  expect((await place('bob')).enrolment.status).toBe('PLACED');
  expect((await place('gwen')).enrolment).toMatchObject({ status: 'WAITLISTED', position: 2 });
  // Replays return the first answer and write nothing more.
  const before = await counts();
  const command = {
    action: 'cancel' as const,
    commandId: randomUUID(),
    registrationId: reg.bob,
    acknowledged: true as const,
  };
  const c1 = await terms('bob').enrol(command);
  const c2 = await terms('bob').enrol(command);
  expect(c1.status).toBe('CANCELLED');
  expect(c2).toMatchObject({ replayed: true, status: 'CANCELLED' });
  const after = await counts();
  expect(after.enrolment_revisions).toBe(before.enrolment_revisions + 2);
  expect(
    (await rejected(terms('bob').enrol({ ...command, action: 'accept_terms', termsVersion: 2 })))
      .code,
  ).toBeTruthy();
  expect(
    (await rejected(terms('bob').enrol({ ...command, registrationId: reg.erin }))).code,
  ).toBeTruthy();
});

test('giving up a place promotes the waiting list in order; a registration ended elsewhere frees a place that the organiser fills', async () => {
  // bob cancelled above: finn (queue 1) moved up, gwen is now first in line.
  expect((await place('finn')).enrolment).toMatchObject({ status: 'PLACED', position: null });
  expect((await place('gwen')).enrolment).toMatchObject({ status: 'WAITLISTED', position: 1 });
  expect((await place('bob')).enrolment.status).toBe('CANCELLED');
  const promoted = (
    await f.owner.query(
      "SELECT cause FROM customer_private.programme_enrolment_revision WHERE cause='PROMOTED'",
    )
  ).rows;
  expect(promoted).toHaveLength(1);
  // erin's registration is withdrawn through the existing participant module; the place frees, nobody moves yet.
  await participants('erin').command({
    action: 'withdraw',
    commandId: randomUUID(),
    registrationId: reg.erin,
    reason: 'Synthetic withdrawal for the terms test',
    acknowledged: true,
  });
  const r = await report();
  expect(r.places).toMatchObject({ placed: 1, free: 1, waiting: 1, promotable: 1 });
  const refreshed = await terms().refreshPlaces({ commandId: randomUUID(), ...scope() });
  expect(refreshed.promoted).toBe(1);
  expect((await place('gwen')).enrolment.status).toBe('PLACED');
  expect((await report()).places).toMatchObject({ placed: 2, free: 0, waiting: 0, promotable: 0 });
  // A refresh with nothing to do is harmless.
  expect((await terms().refreshPlaces({ commandId: randomUUID(), ...scope() })).promoted).toBe(0);
});

test('a person who fixes their profile applies again and the earlier answers stay in the history', async () => {
  const before = await counts();
  expect((await place('carol')).enrolment).toMatchObject({ status: 'NOT_ELIGIBLE' });
  // A profile that now says seller in Bangladesh, but still has no website or sector (five of seven details).
  await saveProfile(
    'carol',
    { commercialRoles: ['SELLER'], countryCode: 'BD', website: null, sectors: [] },
    1,
  );
  const retry = await apply('carol', { termsVersion: 2 });
  expect(retry).toMatchObject({ status: 'NOT_ELIGIBLE', reasons: ['COMPLETENESS'] });
  // The criteria change too: a new version, the old one stays.
  const c2 = await terms().setEligibility(
    criteria({
      expectedVersion: 1,
      minProfileFields: 5,
      reason: 'Synthetic relaxed the profile bar a little',
    }),
  );
  expect(c2.eligibility.version).toBe(2);
  const again = await apply('carol', { termsVersion: 2 });
  expect(again).toMatchObject({ status: 'WAITLISTED', position: 1 });
  const history = (
    await f.owner.query(
      `SELECT v.version,v.status,v.eligibility_version FROM customer_private.programme_enrolment_revision v
 JOIN customer_private.programme_enrolment e ON e.id=v.enrolment_id WHERE e.registration_id=$1 ORDER BY v.version`,
      [reg.carol],
    )
  ).rows;
  expect(history.map((h) => h.status)).toEqual(['NOT_ELIGIBLE', 'NOT_ELIGIBLE', 'WAITLISTED']);
  expect(history.map((h) => h.eligibility_version)).toEqual([1, 1, 2]);
  expect((await counts()).enrolment_revisions).toBe(before.enrolment_revisions + 2);
  expect((await state()).eligibility.history.map((h) => h.version)).toEqual([2, 1]);
});

test('a new terms version needs fresh acceptance and the old acceptance stays on record', async () => {
  const v3 = await terms().publishTerms(
    termsIn({
      expectedVersion: 2,
      cancellationTerms: 'Synthetic cancel up to twenty one days before for a full place back',
      reason: 'Synthetic longer cancellation window',
    }),
  );
  expect(v3.terms.version).toBe(3);
  const finn = await place('finn');
  expect(finn).toMatchObject({ acceptedVersion: 2, termsCurrent: false, terms: { version: 3 } });
  const reminders = await terms('finn').reminders({ asOf: ASOF });
  expect(reminders.termsToAccept.map((t) => [t.registrationId, t.version])).toContainEqual([
    reg.finn,
    3,
  ]);
  expect((await report()).terms).toMatchObject({
    version: 3,
    acceptedCurrent: 0,
    pendingAcceptance: 3,
  });
  expect((await rejected(acceptTerms('finn', 2))).message).toMatch(/terms changed/i);
  expect((await rejected(acceptTerms('dave', 3))).message).toMatch(/apply for a place first/i);
  expect(await acceptTerms('finn', 3)).toMatchObject({ status: 'PLACED', termsVersion: 3 });
  const again = await acceptTerms('finn', 3);
  expect(again.status).toBe('PLACED');
  expect((await place('finn')).termsCurrent).toBe(true);
  const accepted = (
    await f.owner.query(
      'SELECT terms_version FROM customer_private.programme_terms_acceptance WHERE registration_id=$1 ORDER BY terms_version',
      [reg.finn],
    )
  ).rows;
  expect(accepted.map((a) => a.terms_version)).toEqual([2, 3]);
  expect((await report()).terms).toMatchObject({
    acceptedCurrent: 1,
    pendingAcceptance: 2,
    acceptanceRatePermille: 200,
  });
  expect(
    (await terms('finn').reminders({ asOf: ASOF })).termsToAccept.some(
      (t) => t.registrationId === reg.finn,
    ),
  ).toBe(false);
  expect(
    (
      await rejected(
        f.owner.query('UPDATE customer_private.programme_terms_acceptance SET terms_version=1'),
      )
    ).message,
  ).toMatch(/immutable|rewrit|append|reject/i);
  // Only the registered person can accept: a direct insert for someone else is refused.
  expect(
    (
      await rejected(
        f.owner.query(
          `INSERT INTO customer_private.programme_terms_acceptance(registration_id,workspace_id,programme_id,terms_version,accepted_by)
 SELECT $1,$2,$3,3,p.id FROM customer_private.principal p WHERE p.subject=$4`,
          [reg.gwen, workspaceId, programmeId, subject('alice')],
        ),
      )
    ).message,
  ).toMatch(/registered participant/i);
});

test('fees are read from the economics ledger and never copied', async () => {
  const fee = await ledger().record({
    commandId: randomUUID(),
    ...scope(),
    entry: {
      kind: 'PARTICIPANT_FEE',
      costBasis: null,
      registrationId: reg.finn,
      amountMinor: '120000',
      currency: 'BDT',
      occurredOn: '2026-10-01',
      description: 'Synthetic participation fee',
    },
    acknowledged: true,
  });
  expect(fee).toBeTruthy();
  const view = await place('finn');
  expect(view.fees).toEqual([
    { currency: 'BDT', exponent: expect.any(Number), dueMinor: '120000' },
  ]);
  expect((await place('gwen')).fees).toEqual([]);
  // The module stores no amount of its own.
  const cols = (
    await f.owner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='customer_private'
 AND table_name IN ('programme_terms_revision','programme_enrolment_revision','programme_terms_acceptance','programme_places_revision')`,
    )
  ).rows.map((r) => r.column_name);
  expect(cols.some((c) => /amount|currency|price|fee_minor|total/.test(c))).toBe(false);
  expect((await counts()).ledger).toBe(1);
});

test('tasks can be given to workspace members; the owner of a task finishes only their own, and the title reaches placed participants only', async () => {
  const harryKey = await memberKeyFor('harry');
  const ginaKey = await memberKeyFor('gina');
  const ivyAsKey = (await state()).members.length; // ivy has left the directory
  expect(ivyAsKey).toBe(3);
  const overdue = (await saveTask('Synthetic send the visa checklist', '2026-10-18')).task;
  const soon = (await saveTask('Synthetic confirm the hotel list', '2026-10-23')).task;
  const later = (await saveTask('Synthetic print the badges', '2026-10-24')).task;
  const own = (await saveTask('Synthetic hire the interpreter', '2026-10-19')).task;
  const start = await counts();
  const a1 = await assign(overdue.id, harryKey, true);
  expect(a1).toMatchObject({
    planVersion: 1,
    participantVisible: true,
    assigned: true,
    replayed: false,
  });
  await assign(soon.id, harryKey, false);
  await assign(later.id, harryKey, true);
  await assign(own.id, ginaKey, true);
  const mid = await counts();
  expect(mid.plans).toBe(start.plans + 4);
  expect(mid.events).toBe(start.events + 4);
  // Stale, nothing-changed, unknown task, non-member and forged assignee are refused.
  expect((await rejected(assign(overdue.id, harryKey, true, 0))).message).toMatch(/changed/i);
  expect((await rejected(assign(overdue.id, harryKey, true, 1))).message).toMatch(
    /nothing changed/i,
  );
  expect((await rejected(assign(randomUUID(), harryKey, true))).code).toBe('42501');
  expect((await rejected(assign(overdue.id, randomUUID(), true, 1))).code).toBe('42501');
  expect((await rejected(assign(overdue.id, harryKey, true, 1, 'harry'))).code).toBe('42501');
  expect((await rejected(assign(overdue.id, harryKey, true, 1, 'olga'))).code).toBe('42501');
  // A member who left cannot be given a task.
  expect(
    (
      await rejected(
        raw('alice', 'SELECT customer.programme_task_assign($1,$2)', [
          randomUUID(),
          JSON.stringify({
            ...scope(),
            taskId: later.id,
            expectedVersion: 1,
            assigneeKey: randomUUID(),
            participantVisible: false,
          }),
        ]),
      )
    ).code,
  ).toBe('42501');
  // Reminders: a fixed window, today and the next three days, deterministic for a given date.
  const harry = await terms('harry').reminders({ asOf: ASOF });
  expect(harry.windowDays).toBe(3);
  expect(harry.sendsMessages).toBe(false);
  expect(harry.assignedToYou.map((t) => [t.title, t.state, t.dueOn])).toEqual([
    ['Synthetic send the visa checklist', 'OVERDUE', '2026-10-18'],
    ['Synthetic confirm the hotel list', 'DUE_SOON', '2026-10-23'],
  ]);
  expect({ ...(await terms('harry').reminders({ asOf: ASOF })), expiresAt: '' }).toEqual({
    ...harry,
    expiresAt: '',
  });
  expect(
    (await terms('harry').reminders({ asOf: '2026-10-25' })).assignedToYou.map((t) => t.state),
  ).toEqual(['OVERDUE', 'OVERDUE', 'OVERDUE']);
  expect((await terms('alice').reminders({ asOf: ASOF })).assignedToYou).toEqual([]);
  expect((await rejected(terms('harry').reminders({ asOf: '1999-01-01' }))).code).toBe('23514');
  // Placed participants read titles and due dates only; others read nothing.
  const finn = await place('finn');
  expect(finn.tasks).toEqual(
    [
      { title: 'Synthetic hire the interpreter', dueOn: '2026-10-19' },
      { title: 'Synthetic send the visa checklist', dueOn: '2026-10-18' },
      { title: 'Synthetic print the badges', dueOn: '2026-10-24' },
    ].sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
  );
  expect(Object.keys(finn.tasks[0]).sort()).toEqual(['dueOn', 'title']);
  expect((await place('carol')).tasks).toEqual([]);
  const finnReminders = await terms('finn').reminders({ asOf: ASOF });
  expect(finnReminders.forParticipant.map((t) => t.state)).toEqual(['OVERDUE', 'OVERDUE']);
  expect(finnReminders.forParticipant.every((t) => !('taskId' in t))).toBe(true);
  expect((await terms('carol').reminders({ asOf: ASOF })).forParticipant).toEqual([]);
  // Finishing: only the owner of the task, with the version they saw.
  const current = (await state()).tasks.find((t) => t.id === overdue.id)!;
  expect(current.plan).toMatchObject({
    assigneeKey: harryKey,
    participantVisible: true,
    version: 1,
  });
  expect((await rejected(done('gina', overdue.id, current.version))).message).toMatch(
    /not assigned to you/i,
  );
  expect((await rejected(done('alice', overdue.id, current.version))).code).toBe('42501');
  expect((await rejected(done('olga', overdue.id, current.version))).code).toBe('42501');
  expect((await rejected(done('bob', overdue.id, current.version))).code).toBe('42501');
  expect((await rejected(done('harry', overdue.id, current.version + 1))).message).toMatch(
    /changed/i,
  );
  const finished = await done('harry', overdue.id, current.version);
  expect(finished).toMatchObject({ status: 'DONE', version: current.version + 1, replayed: false });
  expect((await rejected(done('harry', overdue.id, current.version + 1))).message).toMatch(
    /already finished/i,
  );
  const list = await coord().tasks(scope());
  expect(list.tasks.find((t) => t.id === overdue.id)).toMatchObject({
    status: 'DONE',
    title: 'Synthetic send the visa checklist',
  });
  // The organiser's older copy of the task is now stale in the existing task port.
  expect(
    (
      await rejected(
        coord().saveTask({
          commandId: randomUUID(),
          ...scope(),
          expectedVersion: current.version,
          task: {
            taskId: overdue.id,
            title: 'Synthetic send the visa checklist',
            detail: null,
            status: 'OPEN',
            dueOn: null,
            assigneeLabel: null,
          },
        }),
      )
    ).message,
  ).toMatch(/changed/i);
  // A finished task leaves every reminder list.
  expect(
    (await terms('harry').reminders({ asOf: ASOF })).assignedToYou.map((t) => t.title),
  ).toEqual(['Synthetic confirm the hotel list']);
  expect((await place('finn')).tasks.map((t) => t.title)).not.toContain(
    'Synthetic send the visa checklist',
  );
  // A revoked member loses the ability to finish their task, and an exact retry returns the first answer.
  const retryCommand = { commandId: randomUUID(), ...scope(), taskId: own.id, expectedVersion: 1 };
  const g1 = await terms('gina').finishTask(retryCommand);
  const g2 = await terms('gina').finishTask(retryCommand);
  expect(g2).toMatchObject({ replayed: true, status: 'DONE' });
  expect(g1.version).toBe(g2.version);
  expect(
    (await rejected(terms('gina').finishTask({ ...retryCommand, taskId: later.id }))).message,
  ).toMatch(/conflicts/i);
  await f.owner.query(
    `INSERT INTO customer_private.workspace_access_revocation(tenant_id,member_id,actor_id)
 SELECT wm.tenant_id,wm.id,wm.principal_id FROM customer_private.workspace_member wm JOIN customer_private.principal p ON p.id=wm.principal_id WHERE p.subject=$1`,
    [subject('harry')],
  );
  expect((await rejected(done('harry', soon.id, 1))).code).toBe('42501');
  expect((await terms('harry').reminders({ asOf: ASOF })).assignedToYou).toEqual([]);
  // The existing task record kept its own history rows.
  const hist = (
    await f.owner.query(
      'SELECT version,status,changed_by IS NOT NULL ok FROM customer_private.programme_task_revision WHERE task_id=$1 ORDER BY version',
      [overdue.id],
    )
  ).rows;
  expect(hist.map((h) => h.status)).toEqual(['OPEN', 'DONE']);
  expect(
    (
      await rejected(
        f.owner.query(
          `INSERT INTO customer_private.programme_task_plan_revision(task_id,workspace_id,programme_id,version,assignee_principal,participant_visible,set_by)
 SELECT $1,$2,$3,9,p.id,false,p.id FROM customer_private.principal p WHERE p.subject=$4`,
          [later.id, workspaceId, programmeId, subject('olga')],
        ),
      )
    ).message,
  ).toMatch(/out of order|current workspace member/i);
});

test('the report is computed only from this programme data and says who reported each figure', async () => {
  // finn rates the programme; the report shows it only because it was shared.
  await coord('finn').submitRecord({
    commandId: randomUUID(),
    registrationId: reg.finn,
    kind: 'FEEDBACK',
    recordId: null,
    expectedVersion: 0,
    rating: 4,
    outcomeKind: null,
    occurredOn: null,
    note: 'Synthetic well organised and clear',
    shared: true,
    retracted: false,
    acknowledged: true,
  });
  const r = await report();
  expect(r).toMatchObject({
    verified: false,
    sendsMessages: false,
    places: {
      minimum: 1,
      maximum: 2,
      waitlist: true,
      placed: 2,
      free: 0,
      fillPermille: 1000,
      minimumMet: true,
      waiting: 1,
    },
    funnel: { registered: 5, placed: 2, waitlisted: 1, notEligible: 1, cancelled: 1 },
    terms: { version: 3, acceptedCurrent: 1, pendingAcceptance: 2 },
    satisfaction: {
      responses: 1,
      ratingCount: 1,
      ratingSum: 4,
      notShared: 0,
      responsesFromPlaced: 1,
    },
  });
  expect(r.roster.map((x) => x.status).sort()).toEqual([
    'CANCELLED',
    'NOT_ELIGIBLE',
    'PLACED',
    'PLACED',
    'WAITLISTED',
  ]);
  expect(r.roster.find((x) => x.registrationId === reg.carol)).toMatchObject({
    status: 'WAITLISTED',
    position: 1,
    termsAcceptedVersion: 2,
    termsCurrent: false,
  });
  expect(r.roster.some((x) => x.registrationId === reg.erin)).toBe(false);
  // Another programme in the same workspace is untouched.
  const other = await report('alice', fullProgramme);
  expect(other.funnel).toMatchObject({ registered: 0, placed: 0 });
  expect((await rejected(report('alice', randomUUID()))).code).toBe('42501');
  expect((await rejected(report('harry'))).code).toBe('42501');
});

test('places never overbook under concurrent applications, and the waiting list keeps a strict order', async () => {
  const people6 = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'];
  await terms().setPlaces({
    ...placesIn(),
    ...scope(workspaceId, raceProgramme),
    maximum: 2,
    minimum: 1,
  });
  for (const p of people6) reg[p + 'r'] = await register(raceProgramme, p, 'Synthetic racer ' + p);
  const results = await Promise.allSettled(
    people6.map((p) =>
      terms(p).enrol({
        action: 'apply',
        commandId: randomUUID(),
        registrationId: reg[p + 'r'],
        termsVersion: null,
        profileWorkspaceId: null,
        acknowledged: true,
      }),
    ),
  );
  expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  const statuses = results.map(
    (r) => (r as PromiseFulfilledResult<{ status: string }>).value.status,
  );
  expect(statuses.filter((s) => s === 'PLACED')).toHaveLength(2);
  expect(statuses.filter((s) => s === 'WAITLISTED')).toHaveLength(4);
  const live = (
    await f.owner.query(
      `SELECT count(*)::int n FROM customer_private.programme_enrolment e WHERE e.programme_id=$1
 AND (SELECT status FROM customer_private.programme_enrolment_revision r WHERE r.enrolment_id=e.id ORDER BY version DESC LIMIT 1)='PLACED'`,
      [raceProgramme],
    )
  ).rows[0].n;
  expect(live).toBe(2);
  const queue = (
    await f.owner.query(
      'SELECT queue_no FROM customer_private.programme_enrolment_revision WHERE programme_id=$1 AND queue_no IS NOT NULL ORDER BY queue_no',
      [raceProgramme],
    )
  ).rows.map((r) => r.queue_no);
  expect(queue).toEqual([1, 2, 3, 4]);
  // Two people give up at the same moment: exactly two of the waiting move up, in queue order.
  const placed = people6.filter((_, i) => statuses[i] === 'PLACED');
  await Promise.all(placed.map((p) => cancel(p, reg[p + 'r'])));
  const after = await Promise.all(
    people6.map((p) => place(p, reg[p + 'r']).then((v) => v.enrolment)),
  );
  expect(after.filter((e) => e.status === 'PLACED')).toHaveLength(2);
  expect(
    after
      .filter((e) => e.status === 'WAITLISTED')
      .map((e) => e.position)
      .sort(),
  ).toEqual([1, 2]);
  const promotedQueue = (
    await f.owner.query(
      `SELECT v.queue_no FROM customer_private.programme_enrolment_revision v WHERE v.programme_id=$1 AND v.version=1 AND v.status='WAITLISTED'
 AND EXISTS(SELECT 1 FROM customer_private.programme_enrolment_revision w WHERE w.enrolment_id=v.enrolment_id AND w.cause='PROMOTED') ORDER BY v.queue_no`,
      [raceProgramme],
    )
  ).rows.map((r) => r.queue_no);
  expect(promotedQueue).toEqual([1, 2]);
  // Without a waiting list the surplus is refused and records nothing.
  await terms().setPlaces({
    ...placesIn(),
    ...scope(workspaceId, noWaitProgramme),
    maximum: 1,
    minimum: 1,
    waitlist: false,
  });
  for (const p of ['x1', 'x2', 'x3'])
    reg[p + 'n'] = await register(noWaitProgramme, p, 'Synthetic no wait ' + p);
  const start = await counts();
  const race = await Promise.allSettled(
    ['x1', 'x2', 'x3'].map((p) =>
      terms(p).enrol({
        action: 'apply',
        commandId: randomUUID(),
        registrationId: reg[p + 'n'],
        termsVersion: null,
        profileWorkspaceId: null,
        acknowledged: true,
      }),
    ),
  );
  expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const failures = race.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  expect(failures).toHaveLength(2);
  for (const e of failures) expect(String(e.reason.message)).toMatch(/programme is full/i);
  const end = await counts();
  expect(end.enrolments).toBe(start.enrolments + 1);
  expect(end.events).toBe(start.events + 1);
  // The same applications racing under one command id write once.
  reg.daver = await register(raceProgramme, 'dave', 'Synthetic late racer dave');
  const command = {
    action: 'apply' as const,
    commandId: randomUUID(),
    registrationId: reg.daver,
    termsVersion: null,
    profileWorkspaceId: null,
    acknowledged: true as const,
  };
  const same = await Promise.allSettled([
    terms('dave').enrol(command),
    terms('dave').enrol(command),
    terms('dave').enrol(command),
  ]);
  const rows = same.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
    replayed: boolean;
  }>[];
  expect(rows.length).toBeGreaterThanOrEqual(1);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_terms_command WHERE command_id=$1',
        [command.commandId],
      )
    ).rows[0].n,
  ).toBe(1);
});

test('the database itself refuses an overbooked place, an unlawful transition and out-of-order versions', async () => {
  const enrolment = (
    await f.owner.query(
      `SELECT e.id,e.workspace_id,e.programme_id,e.registration_id,p.id principal FROM customer_private.programme_enrolment e
 JOIN customer_private.programme_registration r ON r.id=e.registration_id JOIN customer_private.principal p ON p.id=r.principal_id
 WHERE e.registration_id=$1`,
      [reg.carol],
    )
  ).rows[0];
  const head = (
    await f.owner.query(
      'SELECT max(version)::int v FROM customer_private.programme_enrolment_revision WHERE enrolment_id=$1',
      [enrolment.id],
    )
  ).rows[0].v;
  const insert = (status: string, version: number, extra = 'NULL') =>
    f.owner.query(
      `INSERT INTO customer_private.programme_enrolment_revision(enrolment_id,workspace_id,programme_id,registration_id,version,status,queue_no,reasons,cause,changed_by)
 VALUES($1,$2,$3,$4,$5,$6,${extra},ARRAY[]::text[],'PROMOTED',$7)`,
      [
        enrolment.id,
        enrolment.workspace_id,
        enrolment.programme_id,
        enrolment.registration_id,
        version,
        status,
        enrolment.principal,
      ],
    );
  // carol is waiting while both places are taken: placing her would overbook.
  expect((await rejected(insert('PLACED', head + 1))).message).toMatch(/no place available/i);
  expect((await rejected(insert('PLACED', head + 5))).message).toMatch(/out of order/i);
  expect((await rejected(insert('NOT_ELIGIBLE', head + 1))).message).toBeTruthy();
  expect((await rejected(insert('WAITLISTED', head + 1, '99'))).message).toMatch(/not allowed/i);
  // A waiting person must have a queue number and a not-eligible person at least one reason.
  expect(
    (
      await rejected(
        f.owner.query(
          `INSERT INTO customer_private.programme_enrolment_revision(enrolment_id,workspace_id,programme_id,registration_id,version,status,reasons,cause,changed_by)
 VALUES($1,$2,$3,$4,$5,'NOT_ELIGIBLE',ARRAY[]::text[],'APPLIED',$6)`,
          [
            enrolment.id,
            enrolment.workspace_id,
            enrolment.programme_id,
            enrolment.registration_id,
            head + 1,
            enrolment.principal,
          ],
        ),
      )
    ).code,
  ).toBe('23514');
  for (const sql of [
    "UPDATE customer_private.programme_enrolment_revision SET status='PLACED'",
    'DELETE FROM customer_private.programme_enrolment_revision',
    'DELETE FROM customer_private.programme_enrolment',
    'DELETE FROM customer_private.programme_task_plan_revision',
    'UPDATE customer_private.programme_places_revision SET minimum_participants=5',
  ])
    expect((await rejected(f.owner.query(sql))).message, sql).toMatch(
      /immutable|rewrit|append|reject/i,
    );
});

test('event payloads carry identifiers only, with one audit and outbox row per event', async () => {
  const events = (
    await f.owner.query(
      "SELECT type,payload FROM app.domain_event WHERE aggregate_type='customer_programme_terms'",
    )
  ).rows;
  expect(events.length).toBeGreaterThan(15);
  const allowed = new Set(['referenceId', 'kind', 'synthetic', 'initiator_kind', 'initiator_id']);
  for (const e of events) {
    expect(
      Object.keys(e.payload).every((k) => allowed.has(k)),
      e.type,
    ).toBe(true);
    expect(e.payload.initiator_kind).toBe('customer');
    expect(e.type).toMatch(/^customer\.programme_terms\./);
  }
  const text = JSON.stringify(events);
  expect(text).not.toMatch(
    /Synthetic ground|Synthetic cancel|Synthetic participant|BDT|120000|SELLER/,
  );
  const c = await counts();
  expect(c.audits).toBe(c.events);
  expect(c.outbox).toBe(c.events);
  const versions = (
    await f.owner.query(
      "SELECT aggregate_id,aggregate_version FROM app.domain_event WHERE aggregate_type='customer_programme_terms' ORDER BY aggregate_id,aggregate_version",
    )
  ).rows;
  const seen = new Map<string, number>();
  for (const v of versions) {
    expect(v.aggregate_version).toBe((seen.get(v.aggregate_id) ?? 0) + 1);
    seen.set(v.aggregate_id, v.aggregate_version);
  }
  // Nothing outside this module moved: no money, no commercial records, no outreach.
  expect(c.commercial).toBe(0);
  expect(c.organisations).toBe(0);
  expect(c.ledger).toBe(1);
  expect(c.proofs).toBe(0);
});

test('the account-context guard, an unverified or expired session and a disabled flag stop work before the database', async () => {
  const before = await counts();
  expect((await rejected(terms().state(scope(), 'someone-else'))).message).toContain(
    'account changed',
  );
  expect(
    (
      await rejected(
        terms().state(
          scope(),
          subject('alice'),
          'https://ep-other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
        ),
      )
    ).message,
  ).toContain('account changed');
  const variant = (over: Partial<CustomerSession>, enabled = true) =>
    new CustomerProgrammeTermsService(f.runtime, f.auth, { ...options, enabled }, async () => ({
      ...session('alice'),
      ...over,
    }));
  expect((await rejected(variant({ emailVerified: false }).state(scope()))).message).toContain(
    'Verify',
  );
  expect(
    (await rejected(variant({ expiresAt: new Date(Date.now() - 1000) }).state(scope()))).message,
  ).toContain('Sign in');
  expect((await rejected(variant({}, false).state(scope()))).message).toContain('unavailable');
  // A proof that expired inside the database is refused by the database itself.
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 second')",
    [hash, issuer, subject('alice')],
  );
  await new Promise((r) => setTimeout(r, 1500));
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_hash','',true)",
      [hash],
    );
    expect(
      (
        await rejected(
          db.query('SELECT customer.programme_terms_state($1,$2)', [workspaceId, programmeId]),
        )
      ).code,
    ).toBe('42501');
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
  expect(await counts()).toEqual(before);
});
