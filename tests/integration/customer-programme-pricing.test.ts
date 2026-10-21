import { beforeAll, afterAll, expect, test } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './support';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammeTemplates } from '../../packages/db/src/customer-programme-templates-migrate';
import { migrateCustomerProgrammePricing } from '../../packages/db/src/customer-programme-pricing-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerProgrammeCoordinationService } from '../../packages/auth/src/customer-programme-coordination';
import { CustomerProgrammeEconomicsService } from '../../packages/auth/src/customer-programme-economics';
import { CustomerProgrammeTemplateService } from '../../packages/auth/src/customer-programme-templates';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import {
  CustomerProgrammePricingService,
  customerProgrammePricingEnabled,
  pricingTemplateSaveInput,
  seriesSaveInput,
  bulkFeesRecordInput,
  editionCreateInput,
} from '../../packages/auth/src/customer-programme-pricing';
import {
  csvCell,
  decimalAmount,
  exportCsv,
  exportFileName,
} from '../../packages/auth/src/customer-programme-export-csv';
import { sessionHash } from '../../packages/db/src/index';

// Invented provider-session fixtures exercise the real restricted SQL logins.
// They do not establish private managed-provider/email acceptance.
const issuer = 'https://ep-pricing-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = [
  'alice',
  'bob',
  'carol',
  'dave',
  'eve',
  'frank',
  'gina',
  'hank',
  'ivan',
  'judy',
  'kim',
  'outsider',
];
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  otherWorkspace: string,
  programmeId: string;
const regs: Record<string, string> = {};
let oldSnapshot: Awaited<ReturnType<typeof snapshot>>;
const subject = (p: string) => 'synthetic-pricing-' + p;
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
const programmeTemplates = (p = 'alice') =>
  new CustomerProgrammeTemplateService(f.runtime, f.auth, options, async () => session(p));
const pricing = (p = 'alice') =>
  new CustomerProgrammePricingService(f.runtime, f.auth, options, async () => session(p));
const roles = (p = 'alice') =>
  new CustomerMemberRoleService(f.runtime, f.auth, options, async () => session(p));

const schedule = (over: Record<string, unknown> = {}) => ({
  currency: 'BDT',
  tiers: [
    { label: 'Synthetic standard delegate fee', amountMinor: '1000000' },
    { label: 'Synthetic student delegate fee', amountMinor: '600000' },
  ],
  earlyBird: [
    {
      label: 'Synthetic early booking discount',
      untilDate: '2026-11-30',
      reductionMinor: '100000',
    },
  ],
  groupDiscounts: [
    { label: 'Synthetic group of four discount', minParticipants: 4, reductionMinor: '50000' },
  ],
  ...over,
});
const saveTemplate = (
  over: Record<string, unknown> = {},
  p = 'alice',
  commandId = randomUUID(),
  target = workspaceId,
) =>
  pricing(p).saveTemplate({
    commandId,
    workspaceId: target,
    expectedVersion: 0,
    templateId: null,
    name: 'Synthetic autumn delegation fees',
    description: 'Synthetic standard and student fees for the autumn fair',
    content: schedule(),
    retired: false,
    ...over,
  });
const applySchedule = (
  templateId: string,
  programme: string,
  templateVersion = 1,
  expectedScheduleVersion = 0,
  p = 'alice',
  commandId = randomUUID(),
  target = workspaceId,
) =>
  pricing(p).applySchedule({
    commandId,
    workspaceId: target,
    programmeId: programme,
    expectedScheduleVersion,
    templateId,
    templateVersion,
  });
const feeRows = (rows: [string, string][]) =>
  rows.map(([who, tier]) => ({ registrationId: regs[who]!, tier }));
const standard = 'Synthetic standard delegate fee';
const student = 'Synthetic student delegate fee';
const bulk = (
  rows: [string, string][],
  over: Record<string, unknown> = {},
  p = 'alice',
  commandId = randomUUID(),
  programme = programmeId,
) =>
  pricing(p).recordFees({
    commandId,
    workspaceId,
    programmeId: programme,
    scheduleVersion: 1,
    feeDate: '2026-11-15',
    rows: feeRows(rows),
    ...over,
  });
const preview = (
  rows: [string, string][],
  over: Record<string, unknown> = {},
  p = 'alice',
  programme = programmeId,
) =>
  pricing(p).previewFees({
    workspaceId,
    programmeId: programme,
    scheduleVersion: 1,
    feeDate: '2026-11-15',
    rows: feeRows(rows),
    ...over,
  });
const newProgramme = async (name: string, p = 'alice', target = workspaceId) =>
  (
    await programmes(p).create({
      commandId: randomUUID(),
      workspaceId: target,
      name,
      reportingPurpose: 'Synthetic participant planning test only',
      acknowledged: true,
    })
  ).id as string;
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
async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.pricing_template) templates,
 (SELECT count(*)::int FROM customer_private.pricing_template_revision) template_revisions,
 (SELECT count(*)::int FROM customer_private.programme_fee_schedule) schedules,
 (SELECT count(*)::int FROM customer_private.programme_fee_batch) batches,
 (SELECT count(*)::int FROM customer_private.programme_fee_batch_line) lines,
 (SELECT count(*)::int FROM customer_private.pricing_command) pricing_commands,
 (SELECT count(*)::int FROM customer_private.programme_series) series,
 (SELECT count(*)::int FROM customer_private.programme_series_revision) series_revisions,
 (SELECT count(*)::int FROM customer_private.programme_series_edition) editions,
 (SELECT count(*)::int FROM customer_private.programme_series_command) series_commands,
 (SELECT count(*)::int FROM customer_private.programme_export_record) exports,
 (SELECT count(*)::int FROM customer_private.programme_ledger_entry) ledger,
 (SELECT count(*)::int FROM customer_private.programme_task) tasks,
 (SELECT count(*)::int FROM customer_private.programme_creation) programmes,
 (SELECT count(*)::int FROM customer_private.programme_registration) registrations,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type IN ('customer_programme_pricing','customer_programme_series','customer_programme_export')) events,
 (SELECT count(*)::int FROM app.audit_event WHERE action LIKE 'customer.programme_pricing.%' OR action LIKE 'customer.programme_series.%' OR action LIKE 'customer.programme_export.%') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type IN ('customer_programme_pricing','customer_programme_series','customer_programme_export')) outbox,
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
const planned = (
  programme: string,
  currency: string,
  amountMinor: string,
  basis: 'PLANNED' | 'ACTUAL' = 'ACTUAL',
) =>
  ledger().record({
    commandId: randomUUID(),
    workspaceId,
    programmeId: programme,
    acknowledged: true,
    entry: {
      kind: 'ORGANISER_EXPENSE',
      costBasis: basis,
      registrationId: null,
      amountMinor,
      currency,
      occurredOn: '2026-11-20',
      description: 'Synthetic venue and interpreter costs',
    },
  });

let sourceProgramme: string;
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerParticipants(f.owner);
  for (const p of people)
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: subject(p),
      executorId: f.serviceId,
      reason: 'Explicit invented pricing test identity; no real account or email',
    });
  workspaceId = (
    await workspaces().provision({ commandId: randomUUID(), name: 'Synthetic pricing workspace' })
  ).id;
  otherWorkspace = (
    await workspaces('eve').provision({
      commandId: randomUUID(),
      name: 'Synthetic other pricing workspace',
    })
  ).id;
  const memberIds: Record<string, string> = {};
  for (const who of ['dave', 'frank', 'judy', 'kim']) {
    const invitation = await workspaces().access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      label: 'Synthetic invited ' + who,
    });
    memberIds[who] = (
      await workspaces(who).access({
        action: 'accept',
        commandId: randomUUID(),
        token: invitation.token,
      })
    ).memberId!;
  }
  await migrateCustomerMemberRoles(f.owner);
  // Frank is made an admin by the owner. Dave stays a plain member.
  await roles('alice').command({
    action: 'set_role',
    commandId: randomUUID(),
    workspaceId,
    memberId: memberIds.frank,
    role: 'admin',
    expectedRole: 'member',
  });
  sourceProgramme = await newProgramme('Synthetic source edition programme');
  programmeId = await newProgramme('Synthetic fees target programme');
  for (const [who, label] of [
    ['bob', 'Synthetic participant Bob'],
    ['carol', 'Synthetic participant Carol'],
    ['gina', 'Synthetic participant Gina'],
    ['hank', 'Synthetic participant Hank'],
    ['ivan', 'Synthetic participant Ivan'],
  ] as const)
    regs[who] = await register(programmeId, who, label);
  // The same module stack that pricing needs is installed first, so the snapshot isolates this module.
  await migrateCustomerProgrammeTemplates(f.owner);
  // Revoke Judy and disable Kim after they were real members.
  await workspaces('alice').access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId,
    kind: 'membership',
    targetId: memberIds.judy,
  });
  await f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject=$1',
    [subject('kim')],
  );
  oldSnapshot = await snapshot();
  await migrateCustomerProgrammePricing(f.owner);
  await migrateCustomerProgrammePricing(f.owner);
}, 120000);
afterAll(async () => {
  await f?.close();
});

test('populated additive install preserves every existing row, function, ACL, policy and receipt, is repeatable and records its exact hash', async () => {
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
    'pricing_command',
    'pricing_template',
    'pricing_template_revision',
    'programme_export_record',
    'programme_fee_batch',
    'programme_fee_batch_line',
    'programme_fee_schedule',
    'programme_series',
    'programme_series_command',
    'programme_series_edition',
    'programme_series_revision',
  ]);
  const keep = after.tables.map((t) => knownTables.has(t.oid));
  expect(after.digests.filter((_, i) => keep[i])).toEqual(oldSnapshot.digests);
  expect(after.policies).toEqual(oldSnapshot.policies);
  expect(after.coreHistory).toEqual(oldSnapshot.coreHistory);
  expect(after.customerHistory).toEqual(oldSnapshot.customerHistory);
  const sql = await readFile(
    'packages/db/customer-programme-pricing-migrations/0001_pricing_series_and_exports.sql',
    'utf8',
  );
  expect(
    (await f.owner.query('SELECT name,sha256 FROM customer_programme_pricing_migrations.applied'))
      .rows,
  ).toEqual([
    {
      name: '0001_pricing_series_and_exports.sql',
      sha256: createHash('sha256').update(sql).digest('hex'),
    },
  ]);
  // A different recorded hash is refused instead of silently re-run.
  await f.owner.query(
    "UPDATE customer_programme_pricing_migrations.applied SET sha256='0000' WHERE true",
  );
  expect((await rejected(migrateCustomerProgrammePricing(f.owner))).message).toContain(
    'history mismatch',
  );
  await f.owner.query(
    'UPDATE customer_programme_pricing_migrations.applied SET sha256=$1 WHERE true',
    [createHash('sha256').update(sql).digest('hex')],
  );
});

test('the gate needs the template chain as well as its own flag and is off in production', () => {
  expect(customerProgrammePricingEnabled({})).toBe(false);
  const base = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
  };
  const own = { CORRIDRA_CUSTOMER_PROGRAMME_PRICING_ENABLED: 'true' };
  const templates = { CORRIDRA_CUSTOMER_PROGRAMME_TEMPLATES_ENABLED: 'true' };
  expect(customerProgrammePricingEnabled({ ...base, ...own })).toBe(false);
  expect(customerProgrammePricingEnabled({ ...base, ...templates })).toBe(false);
  expect(customerProgrammePricingEnabled({ ...base, ...own, ...templates })).toBe(true);
  expect(
    customerProgrammePricingEnabled({ ...base, ...own, ...templates, VERCEL_ENV: 'production' }),
  ).toBe(false);
});

test('a fee schedule is created, revised with the expected version, retired and restored', async () => {
  expect((await pricing().templates({ workspaceId })).templates).toEqual([]);
  const before = await counts();
  const created = await saveTemplate();
  expect(created).toMatchObject({
    replayed: false,
    template: {
      seq: 1,
      version: 1,
      retired: false,
      tierCount: 2,
      currency: 'BDT',
      exponent: 2,
      provenance: 'ORGANISER_RECORDED',
    },
  });
  expect(await counts()).toEqual({
    ...before,
    templates: 1,
    template_revisions: 1,
    pricing_commands: 1,
    events: 1,
    audits: 1,
    outbox: 1,
  });
  const id = created.template.id;
  const revised = await saveTemplate({
    templateId: id,
    expectedVersion: 1,
    name: 'Synthetic autumn delegation fees v2',
    content: schedule({
      tiers: [{ label: standard, amountMinor: '1100000' }],
    }),
  });
  expect(revised.template).toMatchObject({ version: 2, tierCount: 1 });
  const stale = await rejected(saveTemplate({ templateId: id, expectedVersion: 1 }));
  expect(stale.code).toBe('23514');
  expect(stale.message).toContain('changed');
  expect(
    (await saveTemplate({ templateId: id, expectedVersion: 2, retired: true })).template,
  ).toMatchObject({ version: 3, retired: true });
  expect(
    (await saveTemplate({ templateId: id, expectedVersion: 3, retired: false })).template,
  ).toMatchObject({ version: 4, retired: false });
  const history = (
    await f.owner.query(
      'SELECT version,retired FROM customer_private.pricing_template_revision WHERE template_id=$1 ORDER BY version',
      [id],
    )
  ).rows;
  expect(history).toEqual([
    { version: 1, retired: false },
    { version: 2, retired: false },
    { version: 3, retired: true },
    { version: 4, retired: false },
  ]);
  const list = await pricing().templates({ workspaceId });
  expect(list.templates).toHaveLength(1);
  expect(list.templates[0]).toMatchObject({ id, version: 4 });
  expect(list.nextAfter).toBeNull();
});

test('fee schedule content is checked by the application schema and by SQL independently and holds only exact integer minor units', async () => {
  const sql = (c: unknown, name = 'Synthetic invalid content test', retired = false) =>
    raw('alice', 'SELECT customer.pricing_template_save($1,$2,$3,$4)', [
      randomUUID(),
      workspaceId,
      0,
      JSON.stringify({ templateId: null, name, description: null, content: c, retired }),
    ]);
  const tier = (over: Record<string, unknown> = {}) => ({
    label: 'Synthetic a valid tier name',
    amountMinor: '100000',
    ...over,
  });
  const bad: [string, unknown][] = [
    ['tier label not synthetic', schedule({ tiers: [tier({ label: 'Standard tier name' })] })],
    ['no tiers', schedule({ tiers: [] })],
    [
      '13 tiers',
      schedule({
        tiers: Array.from({ length: 13 }, (_, i) => tier({ label: 'Synthetic tier number ' + i })),
      }),
    ],
    ['floating amount', schedule({ tiers: [tier({ amountMinor: '1000.50' })] })],
    ['amount as a number', schedule({ tiers: [tier({ amountMinor: 1000 })] })],
    ['negative amount', schedule({ tiers: [tier({ amountMinor: '-100' })] })],
    ['zero amount', schedule({ tiers: [tier({ amountMinor: '0' })] })],
    ['19 digits', schedule({ tiers: [tier({ amountMinor: '1000000000000000000' })] })],
    ['percentage smuggled in', schedule({ tiers: [{ ...tier(), percent: 10 }] })],
    ['duplicate tier names', schedule({ tiers: [tier(), tier({ amountMinor: '200000' })] })],
    ['conversion rate smuggled in', { ...schedule(), rate: '1.2' }],
    [
      'early-bird reduction equals the cheapest tier',
      schedule({
        tiers: [tier()],
        earlyBird: [
          {
            label: 'Synthetic too generous rule',
            untilDate: '2026-11-30',
            reductionMinor: '100000',
          },
        ],
        groupDiscounts: [],
      }),
    ],
    [
      'early bird and group together reach the cheapest tier',
      schedule({
        tiers: [tier()],
        earlyBird: [
          { label: 'Synthetic early rule one', untilDate: '2026-11-30', reductionMinor: '60000' },
        ],
        groupDiscounts: [
          { label: 'Synthetic group rule one', minParticipants: 3, reductionMinor: '40000' },
        ],
      }),
    ],
    [
      'early-bird date impossible',
      schedule({
        tiers: [tier()],
        earlyBird: [
          {
            label: 'Synthetic impossible date rule',
            untilDate: '2026-02-30',
            reductionMinor: '10',
          },
        ],
      }),
    ],
    [
      'group size of one',
      schedule({
        tiers: [tier()],
        groupDiscounts: [
          { label: 'Synthetic group of one rule', minParticipants: 1, reductionMinor: '10' },
        ],
      }),
    ],
    [
      'group size fractional',
      schedule({
        tiers: [tier()],
        groupDiscounts: [
          { label: 'Synthetic fractional group', minParticipants: 2.5, reductionMinor: '10' },
        ],
      }),
    ],
    [
      'seven early-bird rules',
      schedule({
        tiers: [tier()],
        earlyBird: Array.from({ length: 7 }, (_, i) => ({
          label: 'Synthetic early rule ' + i,
          untilDate: '2026-1' + (i % 3) + '-0' + (i + 1),
          reductionMinor: '1',
        })),
      }),
    ],
  ];
  for (const [name, c] of bad) {
    expect(
      pricingTemplateSaveInput.safeParse({
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
  expect((await rejected(sql(schedule({ currency: 'XXX' })))).code).toBe('23503');
  expect((await rejected(sql(schedule(), 'Not synthetic at all'))).code).toBe('23514');
  expect((await rejected(sql(schedule(), 'Synthetic a retired first version', true))).code).toBe(
    '23514',
  );
  // The largest legal amount round-trips digit for digit.
  const exact = '999999999999999999';
  const t = (
    await saveTemplate({
      name: 'Synthetic exact large amount schedule',
      content: schedule({
        tiers: [{ label: 'Synthetic the largest possible tier', amountMinor: exact }],
        earlyBird: [],
        groupDiscounts: [],
      }),
    })
  ).template;
  expect(t.content.tiers[0].amountMinor).toBe(exact);
});

let feeTemplate: { id: string; version: number };
test('applying a fee schedule records a new version on the programme and records no fee', async () => {
  feeTemplate = (await saveTemplate({ name: 'Synthetic fees to apply to programmes' })).template;
  const before = await counts();
  const result = await applySchedule(feeTemplate.id, programmeId, feeTemplate.version, 0);
  expect(result).toMatchObject({
    replayed: false,
    programmeId,
    schedule: { version: 1, templateId: feeTemplate.id, templateVersion: 1, currency: 'BDT' },
  });
  expect(result.schedule.content.tiers).toHaveLength(2);
  expect(await counts()).toEqual({
    ...before,
    schedules: before.schedules + 1,
    pricing_commands: before.pricing_commands + 1,
    events: before.events + 1,
    audits: before.audits + 1,
    outbox: before.outbox + 1,
  });
  const overview = await pricing().overview({ workspaceId, programmeId });
  expect(overview.schedule).toMatchObject({ version: 1, currency: 'BDT', exponent: 2 });
  expect(overview.history).toHaveLength(1);
  expect(overview.counts).toEqual({ registered: 5, active: 5 });
  expect(overview.participants.every((p) => p.state === 'ACTIVE' && !p.hasFee)).toBe(true);
  // The stored schedule is an exact copy, so a later template edit never changes it.
  await saveTemplate({
    templateId: feeTemplate.id,
    expectedVersion: 1,
    name: 'Synthetic fees to apply, revised',
    content: schedule({ tiers: [{ label: standard, amountMinor: '2000000' }] }),
  });
  // Restore the two-tier content as a third version so later checks keep using it.
  feeTemplate = (
    await saveTemplate({
      templateId: feeTemplate.id,
      expectedVersion: 2,
      name: 'Synthetic fees to apply to programmes',
    })
  ).template;
  expect(feeTemplate.version).toBe(3);
  expect(
    (await pricing().overview({ workspaceId, programmeId })).schedule!.content.tiers,
  ).toHaveLength(2);
});

test('a fee schedule cannot be applied when stale, retired, from another workspace or over a newer version', async () => {
  const t = (await saveTemplate({ name: 'Synthetic fees for refusal checks' })).template;
  const target = await newProgramme('Synthetic refusal target programme');
  const before = await counts();
  expect((await rejected(applySchedule(t.id, target, 7, 0))).message).toContain('changed');
  expect((await rejected(applySchedule(t.id, target, 1, 3))).message).toContain('changed');
  const retired = (await saveTemplate({ templateId: t.id, expectedVersion: 1, retired: true }))
    .template;
  expect((await rejected(applySchedule(t.id, target, retired.version, 0))).message).toContain(
    'retired',
  );
  const foreign = (
    await saveTemplate(
      { name: 'Synthetic eve fees elsewhere' },
      'eve',
      randomUUID(),
      otherWorkspace,
    )
  ).template;
  expect((await rejected(applySchedule(foreign.id, target, 1, 0))).code).toBe('42501');
  expect(await counts()).toEqual({
    ...before,
    template_revisions: before.template_revisions + 2,
    pricing_commands: before.pricing_commands + 2,
    templates: before.templates + 1,
    events: before.events + 2,
    audits: before.audits + 2,
    outbox: before.outbox + 2,
  });
});

test('bulk fees are computed exactly from the schedule, previewed without writing and recorded through the economics ledger', async () => {
  const before = await counts();
  const shown = await preview([
    ['bob', standard],
    ['carol', student],
  ]);
  // 5 active participants reach the group of four; 15 Nov is inside the early-booking window.
  expect(shown).toMatchObject({
    preview: true,
    scheduleVersion: 1,
    currency: 'BDT',
    groupSize: 5,
    rowCount: 2,
    perCurrency: [{ currency: 'BDT', exponent: 2, totalMinor: '1300000' }],
  });
  expect(
    shown.rows.map((r) => [r.tier, r.baseMinor, r.earlyBirdMinor, r.groupMinor, r.amountMinor]),
  ).toEqual([
    [standard, '1000000', '100000', '50000', '850000'],
    [student, '600000', '100000', '50000', '450000'],
  ]);
  expect(await counts()).toEqual(before);
  const commandId = randomUUID();
  const done = await bulk(
    [
      ['bob', standard],
      ['carol', student],
    ],
    {},
    'alice',
    commandId,
  );
  expect(done).toMatchObject({
    replayed: false,
    rowCount: 2,
    perCurrency: [{ currency: 'BDT', totalMinor: '1300000' }],
  });
  expect(done.rows.map((r) => r.entrySeq)).toEqual([1, 2]);
  expect(await counts()).toEqual({
    ...before,
    batches: 1,
    lines: 2,
    pricing_commands: before.pricing_commands + 1,
    ledger: before.ledger + 2,
    events: before.events + 1,
    audits: before.audits + 1,
    outbox: before.outbox + 1,
  });
  const entries = (await ledger().list({ workspaceId, programmeId })).entries.sort(
    (a, b) => a.seq - b.seq,
  );
  expect(
    entries.map((e) => [e.kind, e.registrationId, e.amountMinor, e.currency, e.occurredOn]),
  ).toEqual([
    ['PARTICIPANT_FEE', regs.bob, '850000', 'BDT', '2026-11-15'],
    ['PARTICIPANT_FEE', regs.carol, '450000', 'BDT', '2026-11-15'],
  ]);
  expect(entries[0]!.description).toBe('Synthetic participant fee from fee schedule version 1');
  const summary = await ledger().summary({ workspaceId, programmeId });
  expect(summary.currencies).toHaveLength(1);
  expect(summary.currencies[0]).toMatchObject({ currency: 'BDT', feesDue: '1300000' });
  expect(
    summary.participants.find((p) => p.label === 'Synthetic participant Bob')!.amounts[0],
  ).toMatchObject({ due: '850000', status: 'UNPAID' });
  // Retried exactly: the original answer, no new rows.
  const again = await bulk(
    [
      ['bob', standard],
      ['carol', student],
    ],
    {},
    'alice',
    commandId,
  );
  expect(again).toMatchObject({ replayed: true, batchId: done.batchId });
  expect(again.rows).toEqual(done.rows);
  expect((await counts()).ledger).toBe(before.ledger + 2);
  // Same command id, different content: refused.
  const clash = await rejected(bulk([['gina', standard]], {}, 'alice', commandId));
  expect(clash.code).toBe('23514');
  expect(clash.message).toContain('conflicts');
  // The overview now shows who has a fee.
  const overview = await pricing().overview({ workspaceId, programmeId });
  expect(overview.participants.filter((p) => p.hasFee).length).toBe(2);
});

test('a later date drops the early-booking reduction and an invalid row rejects the whole batch', async () => {
  expect((await preview([['gina', standard]], { feeDate: '2026-12-05' })).rows[0]).toMatchObject({
    earlyBirdMinor: '0',
    groupMinor: '50000',
    amountMinor: '950000',
  });
  await pricing('alice').applySchedule({
    commandId: randomUUID(),
    workspaceId,
    programmeId: sourceProgramme,
    expectedScheduleVersion: 0,
    templateId: feeTemplate.id,
    templateVersion: feeTemplate.version,
  });
  // The source programme has two participants only, so neither reduction applies there.
  for (const who of ['bob', 'carol'])
    regs[who + 'Source'] = await register(sourceProgramme, who, 'Synthetic source ' + who);
  const small = await pricing().previewFees({
    workspaceId,
    programmeId: sourceProgramme,
    scheduleVersion: 1,
    feeDate: '2026-12-05',
    rows: [{ registrationId: regs.bobSource!, tier: standard }],
  });
  expect(small.rows[0]).toMatchObject({
    earlyBirdMinor: '0',
    groupMinor: '0',
    amountMinor: '1000000',
  });

  const before = await counts();
  const other = randomUUID();
  const cases: [string, unknown[]][] = [
    [
      'unknown tier last',
      [
        { registrationId: regs.gina, tier: standard },
        { registrationId: regs.hank, tier: 'Synthetic a tier that does not exist' },
      ],
    ],
    [
      'stranger registration last',
      [
        { registrationId: regs.gina, tier: standard },
        { registrationId: other, tier: standard },
      ],
    ],
    [
      'registration of another programme',
      [
        { registrationId: regs.gina, tier: standard },
        { registrationId: regs.bobSource, tier: standard },
      ],
    ],
    [
      'participant that already has a fee',
      [
        { registrationId: regs.gina, tier: standard },
        { registrationId: regs.bob, tier: standard },
      ],
    ],
    [
      'repeated participant',
      [
        { registrationId: regs.gina, tier: standard },
        { registrationId: regs.gina, tier: student },
      ],
    ],
    ['empty batch', []],
    ['unexpected field', [{ registrationId: regs.gina, tier: standard, amountMinor: '1' }]],
    ['malformed id', [{ registrationId: 'not-an-id', tier: standard }]],
  ];
  for (const [name, rows] of cases) {
    const error = await rejected(
      raw('alice', 'SELECT customer.programme_bulk_fees_record($1,$2,$3,$4,$5)', [
        randomUUID(),
        workspaceId,
        programmeId,
        1,
        JSON.stringify({ feeDate: '2026-11-15', rows }),
      ]),
    );
    expect(error.code, name).toBe('23514');
  }
  expect(await counts()).toEqual(before);
  // Gina, valid in each rejected batch, has no fee.
  expect(
    (await pricing().overview({ workspaceId, programmeId })).participants.find(
      (p) => p.registrationId === regs.gina,
    )!.hasFee,
  ).toBe(false);
  // The application schema refuses the same shapes before any database work.
  for (const rows of [
    [],
    Array.from({ length: 201 }, () => ({ registrationId: randomUUID(), tier: standard })),
    [{ registrationId: regs.gina, tier: standard, amountMinor: '1' }],
    [
      { registrationId: regs.gina, tier: standard },
      { registrationId: regs.gina, tier: standard },
    ],
  ])
    expect(
      bulkFeesRecordInput.safeParse({
        commandId: randomUUID(),
        workspaceId,
        programmeId,
        scheduleVersion: 1,
        feeDate: '2026-11-15',
        rows,
      }).success,
    ).toBe(false);
  // A withdrawn participant is not an active row.
  await participants('hank').command({
    action: 'withdraw',
    commandId: randomUUID(),
    registrationId: regs.hank,
    reason: 'Synthetic participant chooses to withdraw',
    acknowledged: true,
  });
  expect((await rejected(bulk([['hank', standard]]))).message).toContain('active participant');
  // A stale schedule version is refused.
  expect((await rejected(bulk([['gina', standard]], { scheduleVersion: 2 }))).message).toContain(
    'changed',
  );
  // Another command for a participant who already has a fee does not double charge.
  expect((await rejected(bulk([['bob', student]]))).message).toContain('already has a fee');
  expect(await counts()).toEqual(before);
  // A valid batch for the remaining participants still works afterwards, with 4 active the group reduction holds.
  const ok = await bulk(
    [
      ['gina', standard],
      ['ivan', student],
    ],
    { feeDate: '2026-12-05' },
  );
  expect(ok.rows.map((r) => r.amountMinor)).toEqual(['950000', '550000']);
  expect(ok.groupSize).toBe(4);
});

test('amounts above 2^53 are summed digit for digit and never converted between currencies', async () => {
  const big = await newProgramme('Synthetic large amount programme');
  for (const who of ['bob', 'carol'])
    regs[who + 'Big'] = await register(big, who, 'Synthetic large ' + who);
  const t = (
    await saveTemplate({
      name: 'Synthetic very large fee schedule',
      content: {
        currency: 'USD',
        tiers: [{ label: 'Synthetic the large delegate fee', amountMinor: '123456789012345678' }],
        earlyBird: [],
        groupDiscounts: [],
      },
    })
  ).template;
  await applySchedule(t.id, big, 1, 0);
  const rows = [
    { registrationId: regs.bobBig!, tier: 'Synthetic the large delegate fee' },
    { registrationId: regs.carolBig!, tier: 'Synthetic the large delegate fee' },
  ];
  const done = await pricing().recordFees({
    commandId: randomUUID(),
    workspaceId,
    programmeId: big,
    scheduleVersion: 1,
    feeDate: '2026-11-15',
    rows,
  });
  expect(done.perCurrency).toEqual([
    { currency: 'USD', exponent: 2, totalMinor: '246913578024691356' },
  ]);
  const summary = await ledger().summary({ workspaceId, programmeId: big });
  expect(summary.currencies).toEqual([
    expect.objectContaining({ currency: 'USD', feesDue: '246913578024691356' }),
  ]);
  // A BDT cost on the same programme stays in its own currency.
  await planned(big, 'BDT', '777');
  const mixed = await ledger().summary({ workspaceId, programmeId: big });
  expect(mixed.currencies.map((c) => c.currency)).toEqual(['BDT', 'USD']);
  expect(mixed.currencies.find((c) => c.currency === 'USD')!.feesDue).toBe('246913578024691356');
});

test('two simultaneous batches for the same participants record once', async () => {
  const race = await newProgramme('Synthetic fee race programme');
  for (const who of ['bob', 'carol'])
    regs[who + 'Race'] = await register(race, who, 'Synthetic race ' + who);
  await applySchedule(feeTemplate.id, race, feeTemplate.version, 0);
  const rows = [
    { registrationId: regs.bobRace!, tier: standard },
    { registrationId: regs.carolRace!, tier: standard },
  ];
  const run = () =>
    pricing().recordFees({
      commandId: randomUUID(),
      workspaceId,
      programmeId: race,
      scheduleVersion: 1,
      feeDate: '2026-12-05',
      rows,
    });
  const outcomes = await Promise.allSettled([run(), run()]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM customer_private.programme_ledger_entry WHERE programme_id=$1 AND kind='PARTICIPANT_FEE'",
        [race],
      )
    ).rows[0].n,
  ).toBe(2);
});

// Series
const planContent = (over: Record<string, unknown> = {}) => ({
  reportingPurpose: 'Synthetic recurring buyer mission for every edition',
  capacity: 20,
  tasks: [
    {
      title: 'Synthetic book the venue',
      detail: null,
      dueOffsetDays: 0,
      assigneeLabel: null,
    },
    {
      title: 'Synthetic confirm the speakers',
      detail: null,
      dueOffsetDays: 14,
      assigneeLabel: null,
    },
  ],
  plannedCosts: [
    {
      kind: 'ORGANISER_EXPENSE',
      description: 'Synthetic venue hire per edition',
      currency: 'BDT',
      amountMinor: '5000000',
    },
  ],
  ...over,
});
const planTemplate = (over: Record<string, unknown> = {}, p = 'alice', target = workspaceId) =>
  programmeTemplates(p).save({
    commandId: randomUUID(),
    workspaceId: target,
    expectedVersion: 0,
    templateId: null,
    name: 'Synthetic recurring edition plan',
    description: null,
    content: planContent(),
    retired: false,
    ...over,
  });
const saveSeries = (
  over: Record<string, unknown> = {},
  p = 'alice',
  commandId = randomUUID(),
  target = workspaceId,
) =>
  pricing(p).saveSeries({
    commandId,
    workspaceId: target,
    expectedVersion: 0,
    seriesId: null,
    name: 'Synthetic quarterly buyer mission series',
    description: 'Synthetic four editions across the year',
    templateId: seriesTemplate.id,
    startDates: ['2027-01-15', '2027-04-15', '2027-07-15'],
    retired: false,
    ...over,
  });
const nextEdition = (
  seriesId: string,
  expectedVersion: number,
  editionNo: number,
  templateVersion: number,
  p = 'alice',
  commandId = randomUUID(),
  name = 'Synthetic buyer mission edition ' + editionNo,
) =>
  pricing(p).createEdition({
    commandId,
    workspaceId,
    seriesId,
    expectedVersion,
    editionNo,
    templateVersion,
    name,
  });
let seriesTemplate: { id: string; version: number };
let series: { id: string; version: number };
const editions: string[] = [];

test('a series is saved with an explicit increasing list of start dates and versioned append-only', async () => {
  // The plan is captured from a programme that has participants and fees; only the plan itself comes through.
  await coord().saveTask({
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    expectedVersion: 0,
    task: {
      taskId: null,
      title: 'Synthetic book the venue',
      detail: null,
      status: 'OPEN',
      dueOn: null,
      assigneeLabel: null,
    },
  });
  await planned(programmeId, 'BDT', '5000000', 'PLANNED');
  const captured = await programmeTemplates().capture({ workspaceId, programmeId });
  expect(JSON.stringify(captured.content)).not.toMatch(/Bob|Carol|PARTICIPANT|850000/);
  seriesTemplate = (
    await planTemplate({ name: 'Synthetic captured edition plan', content: captured.content })
  ).template;
  const before = await counts();
  const created = await saveSeries();
  expect(created).toMatchObject({
    replayed: false,
    series: {
      seq: 1,
      version: 1,
      retired: false,
      templateId: seriesTemplate.id,
      startDates: ['2027-01-15', '2027-04-15', '2027-07-15'],
      editions: [],
      nextEditionDate: '2027-01-15',
      provenance: 'ORGANISER_RECORDED',
    },
  });
  series = created.series;
  expect(await counts()).toEqual({
    ...before,
    series: 1,
    series_revisions: 1,
    series_commands: before.series_commands + 1,
    events: before.events + 1,
    audits: before.audits + 1,
    outbox: before.outbox + 1,
  });
  const revised = await saveSeries({
    seriesId: series.id,
    expectedVersion: 1,
    description: 'Synthetic four editions across the year, revised',
  });
  expect(revised.series.version).toBe(2);
  series = revised.series;
  expect(
    (await rejected(saveSeries({ seriesId: series.id, expectedVersion: 1 }))).message,
  ).toContain('changed');
  const list = await pricing().seriesList({ workspaceId });
  expect(list.series).toHaveLength(1);
  expect(list.nextAfter).toBeNull();
});

test('series input is checked by the application schema and by SQL independently', async () => {
  const sql = (over: Record<string, unknown>) =>
    raw('alice', 'SELECT customer.programme_series_save($1,$2,$3,$4)', [
      randomUUID(),
      workspaceId,
      0,
      JSON.stringify({
        seriesId: null,
        name: 'Synthetic a valid series name',
        description: null,
        templateId: seriesTemplate.id,
        startDates: ['2027-01-15'],
        retired: false,
        ...over,
      }),
    ]);
  const bad: [string, Record<string, unknown>][] = [
    ['name not synthetic', { name: 'Quarterly buyer mission' }],
    ['description not synthetic', { description: 'Four editions across the year' }],
    ['dates not increasing', { startDates: ['2027-04-15', '2027-01-15'] }],
    ['dates repeated', { startDates: ['2027-01-15', '2027-01-15'] }],
    ['impossible date', { startDates: ['2027-02-30'] }],
    ['date outside the range', { startDates: ['2101-01-01'] }],
    [
      '25 dates',
      {
        startDates: Array.from({ length: 25 }, (_, i) =>
          new Date(Date.UTC(2027, 0, 1 + i * 10)).toISOString().slice(0, 10),
        ),
      },
    ],
    ['no dates', { startDates: [] }],
    ['retired on creation', { retired: true }],
  ];
  for (const [name, over] of bad) {
    const parsed = seriesSaveInput.safeParse({
      commandId: randomUUID(),
      workspaceId,
      expectedVersion: 0,
      seriesId: null,
      name: 'Synthetic a valid series name',
      description: null,
      templateId: seriesTemplate.id,
      startDates: ['2027-01-15'],
      retired: false,
      ...over,
    });
    expect(parsed.success, name + ' (schema)').toBe(false);
    expect((await rejected(sql(over))).code, name + ' (sql)').toBe('23514');
  }
  expect((await rejected(sql({ templateId: randomUUID() }))).code).toBe('42501');
  // A template from another workspace cannot start a series here.
  const foreign = (await planTemplate({}, 'eve', otherWorkspace)).template;
  expect((await rejected(sql({ templateId: foreign.id }))).code).toBe('42501');
  // A retired template cannot start a series.
  const gone = (await planTemplate({ name: 'Synthetic soon retired plan' })).template;
  await programmeTemplates().save({
    commandId: randomUUID(),
    workspaceId,
    expectedVersion: 1,
    templateId: gone.id,
    name: 'Synthetic soon retired plan',
    description: null,
    content: planContent(),
    retired: true,
  });
  expect((await rejected(sql({ templateId: gone.id }))).message).toContain('retired');
});

test('the next edition is created through programme creation and the template, copies no participant, fee or payment, and is idempotent', async () => {
  const before = await counts();
  const commandId = randomUUID();
  const first = await nextEdition(
    series.id,
    series.version,
    1,
    seriesTemplate.version,
    'alice',
    commandId,
  );
  expect(first).toMatchObject({
    replayed: false,
    tasksCreated: 1,
    plannedCostsCreated: 1,
    edition: { editionNo: 1, startDate: '2027-01-15', seriesVersion: 2, templateVersion: 1 },
  });
  const pid = first.edition.programmeId;
  editions.push(pid);
  const after = await counts();
  expect(after).toMatchObject({
    programmes: before.programmes + 1,
    editions: before.editions + 1,
    series_commands: before.series_commands + 1,
    tasks: before.tasks + 1,
    ledger: before.ledger + 1,
    registrations: before.registrations,
    events: before.events + 1,
  });
  // The new programme has the plan, never the source programme's people or money.
  expect(
    (await coord().tasks({ workspaceId, programmeId: pid })).tasks.map((t) => [t.title, t.dueOn]),
  ).toEqual([['Synthetic book the venue', null]]);
  const entries = (await ledger().list({ workspaceId, programmeId: pid })).entries;
  expect(entries.map((e) => [e.kind, e.costBasis, e.amountMinor, e.registrationId])).toEqual([
    ['ORGANISER_EXPENSE', 'PLANNED', '5000000', null],
  ]);
  expect((await ledger().summary({ workspaceId, programmeId: pid })).counts.registered).toBe(0);
  expect(
    (await programmes().list({ workspaceId, pageSize: 25 })).programmes.map(
      (p: { id: string }) => p.id,
    ),
  ).toContain(pid);
  const listed = (await pricing().seriesList({ workspaceId })).series[0]!;
  expect(listed.editions).toHaveLength(1);
  expect(listed.nextEditionDate).toBe('2027-04-15');
  // Exact retry returns the original, with no second programme.
  const again = await nextEdition(
    series.id,
    series.version,
    1,
    seriesTemplate.version,
    'alice',
    commandId,
  );
  expect(again).toMatchObject({ replayed: true });
  expect(again.edition.programmeId).toBe(pid);
  expect((await counts()).programmes).toBe(after.programmes);
  expect(
    (
      await rejected(
        nextEdition(
          series.id,
          series.version,
          1,
          seriesTemplate.version,
          'alice',
          commandId,
          'Synthetic a different edition name',
        ),
      )
    ).message,
  ).toContain('conflicts');
  // Someone who already saw edition one cannot create it a second time.
  expect(
    (await rejected(nextEdition(series.id, series.version, 1, seriesTemplate.version))).message,
  ).toContain('Editions changed');
  const second = await nextEdition(series.id, series.version, 2, seriesTemplate.version);
  expect(second.edition).toMatchObject({ editionNo: 2, startDate: '2027-04-15' });
  editions.push(second.edition.programmeId);
});

test('two simultaneous requests for the same edition create it once, and every scheduled edition can be used only once', async () => {
  const outcomes = await Promise.allSettled([
    nextEdition(series.id, series.version, 3, seriesTemplate.version),
    nextEdition(series.id, series.version, 3, seriesTemplate.version),
  ]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
  const made = outcomes.find((o) => o.status === 'fulfilled') as PromiseFulfilledResult<{
    edition: { programmeId: string };
  }>;
  editions.push(made.value.edition.programmeId);
  expect(
    (await rejected(nextEdition(series.id, series.version, 4, seriesTemplate.version))).message,
  ).toContain('Every scheduled edition');
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_series_edition WHERE series_id=$1',
        [series.id],
      )
    ).rows[0].n,
  ).toBe(3);
});

test('a schedule can grow but cannot change or drop the date of an edition that exists, and stale versions are refused', async () => {
  const sameDates = ['2027-01-15', '2027-04-15', '2027-07-15'];
  expect(
    (
      await rejected(
        saveSeries({
          seriesId: series.id,
          expectedVersion: 2,
          startDates: ['2027-01-16', '2027-04-15', '2027-07-15'],
        }),
      )
    ).message,
  ).toContain('cannot change');
  expect(
    (
      await rejected(
        saveSeries({ seriesId: series.id, expectedVersion: 2, startDates: sameDates.slice(0, 2) }),
      )
    ).message,
  ).toContain('cannot drop');
  const grown = await saveSeries({
    seriesId: series.id,
    expectedVersion: 2,
    startDates: [...sameDates, '2027-10-15'],
  });
  expect(grown.series).toMatchObject({ version: 3, nextEditionDate: '2027-10-15' });
  expect(grown.series.editions).toHaveLength(3);
  // Edition creation must name the version of the series it saw.
  expect((await rejected(nextEdition(series.id, 2, 4, seriesTemplate.version))).message).toContain(
    'Series changed',
  );
  series = grown.series;
  const fourth = await nextEdition(series.id, 3, 4, seriesTemplate.version);
  expect(fourth.edition).toMatchObject({ editionNo: 4, startDate: '2027-10-15', seriesVersion: 3 });
  editions.push(fourth.edition.programmeId);
  // Editions keep the series version they were made under.
  expect(
    (
      await f.owner.query(
        'SELECT edition_no,series_version FROM customer_private.programme_series_edition WHERE series_id=$1 ORDER BY edition_no',
        [series.id],
      )
    ).rows,
  ).toEqual([
    { edition_no: 1, series_version: 2 },
    { edition_no: 2, series_version: 2 },
    { edition_no: 3, series_version: 2 },
    { edition_no: 4, series_version: 3 },
  ]);
});

test('a retired template or series cannot create an edition and a failure part-way leaves nothing behind', async () => {
  const lateTemplate = (
    await planTemplate({
      name: 'Synthetic late dated edition plan',
      content: planContent({
        tasks: [
          {
            title: 'Synthetic task far in the future',
            detail: null,
            dueOffsetDays: 100,
            assigneeLabel: null,
          },
        ],
      }),
    })
  ).template;
  const late = (
    await saveSeries({
      name: 'Synthetic series at the end of time',
      templateId: lateTemplate.id,
      startDates: ['2100-01-01'],
    })
  ).series;
  const before = await counts();
  const error = await rejected(nextEdition(late.id, 1, 1, 1));
  expect(error.message).toContain('outside the supported range');
  expect(await counts()).toEqual(before);

  // Retire the series template: its next edition is refused until it is restored.
  const t = (await planTemplate({ name: 'Synthetic to be retired plan' })).template;
  const s = (await saveSeries({ name: 'Synthetic series on a retiring plan', templateId: t.id }))
    .series;
  const retired = (
    await programmeTemplates().save({
      commandId: randomUUID(),
      workspaceId,
      expectedVersion: 1,
      templateId: t.id,
      name: 'Synthetic to be retired plan',
      description: null,
      content: planContent(),
      retired: true,
    })
  ).template;
  expect((await rejected(nextEdition(s.id, 1, 1, 1))).message).toContain('Template changed');
  expect((await rejected(nextEdition(s.id, 1, 1, retired.version))).message).toContain('retired');
  // A retired series refuses too, and can be restored by a new revision.
  const r = (
    await saveSeries({
      seriesId: s.id,
      expectedVersion: 1,
      name: 'Synthetic series on a retiring plan',
      templateId: t.id,
      retired: true,
    })
  ).series;
  expect(r.retired).toBe(true);
  expect((await rejected(nextEdition(s.id, 2, 1, retired.version))).message).toContain('retired');
});

test('repeat revenue and margin are per currency, exact, read-only and never projected', async () => {
  const [one, two] = editions as [string, string];
  const fee = (programme: string, reg: string, amountMinor: string, kind = 'PARTICIPANT_FEE') =>
    ledger().record({
      commandId: randomUUID(),
      workspaceId,
      programmeId: programme,
      acknowledged: true,
      entry: {
        kind,
        costBasis: null,
        registrationId: reg,
        amountMinor,
        currency: 'BDT',
        occurredOn: '2026-10-01',
        description: 'Synthetic participant money entry',
      },
    });
  const bobOne = await register(one, 'bob', 'Synthetic edition one Bob');
  const carolTwo = await register(two, 'carol', 'Synthetic edition two Carol');
  await fee(one, bobOne, '800000');
  await fee(one, bobOne, '300000', 'PARTICIPANT_PAYMENT');
  await planned(one, 'BDT', '200000');
  await planned(one, 'USD', '5000');
  await fee(two, carolTwo, '900000');
  const spent = await planned(two, 'BDT', '100000');
  await ledger().record({
    commandId: randomUUID(),
    workspaceId,
    programmeId: two,
    acknowledged: true,
    entry: {
      reverseOf: spent.entry.id,
      occurredOn: '2027-04-20',
      description: 'Synthetic cost entered in error',
    },
  });
  const before = await counts();
  const view = await pricing().revenue({ workspaceId, seriesId: series.id });
  expect(await counts()).toEqual(before);
  expect(view).toMatchObject({
    provenance: 'ORGANISER_RECORDED',
    verified: false,
    projection: false,
  });
  expect(view.editions.map((e) => e.editionNo)).toEqual([1, 2, 3, 4]);
  const bdt = (n: number) => view.editions[n]!.figures.find((x) => x.currency === 'BDT')!;
  expect(bdt(0)).toMatchObject({
    feesDue: '800000',
    paymentsRecorded: '300000',
    outstanding: '500000',
    actualCosts: '200000',
    plannedCosts: '5000000',
    marginOnActual: '600000',
    cashMargin: '100000',
    feesDueChange: null,
  });
  expect(bdt(1)).toMatchObject({
    feesDue: '900000',
    actualCosts: '0',
    marginOnActual: '900000',
    feesDueChange: '100000',
  });
  expect(view.editions[0]!.figures.map((x) => x.currency)).toEqual(['BDT', 'USD']);
  expect(view.editions[0]!.figures.find((x) => x.currency === 'USD')).toMatchObject({
    feesDue: '0',
    actualCosts: '5000',
    marginOnActual: '-5000',
  });
  expect(view.editions[0]).toMatchObject({ registered: 1, active: 1 });
  expect(view.editions[2]!.registered).toBe(0);
  const totals = Object.fromEntries(view.totals.map((t) => [t.currency, t]));
  expect(totals.BDT).toMatchObject({
    editions: 4,
    feesDue: '1700000',
    paymentsRecorded: '300000',
    outstanding: '1400000',
    actualCosts: '200000',
    plannedCosts: '20000000',
    marginOnActual: '1500000',
    cashMargin: '100000',
  });
  expect(totals.USD).toMatchObject({ feesDue: '0', actualCosts: '5000', marginOnActual: '-5000' });
  // No figure adds one currency to another.
  expect(view.totals.map((t) => t.currency)).toEqual(['BDT', 'USD']);
  expect(JSON.stringify(view)).not.toMatch(/"total"|forecast|projected|expected/i);
  // A series with no editions has nothing to report, not invented zeros.
  const empty = (await saveSeries({ name: 'Synthetic series with no editions yet' })).series;
  expect(await pricing().revenue({ workspaceId, seriesId: empty.id })).toMatchObject({
    editions: [],
    totals: [],
  });
  expect((await rejected(pricing().revenue({ workspaceId, seriesId: randomUUID() }))).code).toBe(
    '42501',
  );
});

// Exports
let eveProgramme: string;
const exportOf = (
  dataset: 'programmes' | 'ledger',
  p = 'alice',
  programme: string | null = null,
  commandId = randomUUID(),
  target = workspaceId,
) => pricing(p).exportRows({ commandId, workspaceId: target, dataset, programmeId: programme });

test('owners and admins export their own programmes and ledger, bounded, recorded and audited', async () => {
  const hostile = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: '=HYPERLINK("http://example.invalid/leak","click")',
      reportingPurpose: 'Synthetic programme named like a spreadsheet formula',
      acknowledged: true,
    })
  ).id as string;
  eveProgramme = await newProgramme('Synthetic eve only programme', 'eve', otherWorkspace);
  const before = await counts();
  const commandId = randomUUID();
  const out = await exportOf('programmes', 'alice', null, commandId);
  expect(out).toMatchObject({ dataset: 'programmes', replayed: false });
  expect(out.rowCount).toBe(out.rows.length);
  const ids = new Set(out.rows.map((r) => r.programmeId));
  expect(ids.has(programmeId)).toBe(true);
  expect(ids.has(hostile)).toBe(true);
  expect(ids.has(eveProgramme)).toBe(false);
  const row = out.rows.find((r) => r.programmeId === programmeId && r.currency === 'BDT')!;
  expect(row).toMatchObject({ registered: 5, active: 4, feesDueMinor: '2800000' });
  expect(await counts()).toEqual({
    ...before,
    exports: before.exports + 1,
    events: before.events + 1,
    audits: before.audits + 1,
    outbox: before.outbox + 1,
  });
  const record = (
    await f.owner.query(
      'SELECT dataset,row_count,programme_id FROM customer_private.programme_export_record WHERE command_id=$1',
      [commandId],
    )
  ).rows;
  expect(record).toEqual([{ dataset: 'programmes', row_count: out.rowCount, programme_id: null }]);
  // The file: formula-looking names become text, genuine numbers stay numbers, no participant labels.
  const csv = exportCsv('programmes', out.rows);
  expect(csv.startsWith('﻿')).toBe(true);
  expect(csv).toContain('"\'=HYPERLINK(""http://example.invalid/leak"",""click"")"');
  expect(csv).not.toMatch(/Synthetic participant|Synthetic edition one/);
  expect(csv).not.toContain('eve only');
  // An exact retry reads again and records nothing new.
  const again = await exportOf('programmes', 'alice', null, commandId);
  expect(again.replayed).toBe(true);
  expect((await counts()).exports).toBe(before.exports + 1);
  expect((await rejected(exportOf('ledger', 'alice', null, commandId))).message).toContain(
    'conflicts',
  );

  const ledgerOut = await exportOf('ledger', 'frank', programmeId);
  expect(ledgerOut.rows.every((r) => r.programmeId === programmeId)).toBe(true);
  expect(ledgerOut.rows.map((r) => r.seq)).toEqual(
    [...ledgerOut.rows.map((r) => r.seq)].sort((a, b) => Number(a) - Number(b)),
  );
  const lcsv = exportCsv('ledger', ledgerOut.rows);
  expect(lcsv).toContain('PARTICIPANT_FEE');
  expect(lcsv).toContain('850000,8500.00,BDT');
  expect(lcsv).not.toMatch(/Bob|Carol|Gina/);
  // A negative correction is written as a number, not as text.
  const whole = await exportOf('ledger');
  expect(whole.rows.some((r) => String(r.amountMinor).startsWith('-'))).toBe(true);
  expect(exportCsv('ledger', whole.rows)).toMatch(/,-100000,-1000\.00,BDT,/);
  // Eve exports only her own workspace.
  const eve = await exportOf('programmes', 'eve', null, randomUUID(), otherWorkspace);
  expect(eve.rows.map((r) => r.programmeId)).toEqual([eveProgramme]);
  // A programme export cannot be narrowed to one programme and the ledger of someone else's programme is refused.
  expect((await rejected(exportOf('programmes', 'alice', programmeId))).message).toContain(
    'Only the ledger export',
  );
  expect(
    (
      await rejected(
        raw('alice', 'SELECT customer.programme_export($1,$2,$3,$4)', [
          randomUUID(),
          workspaceId,
          'programmes',
          programmeId,
        ]),
      )
    ).code,
  ).toBe('23514');
  expect(
    (
      await rejected(
        raw('alice', 'SELECT customer.programme_export($1,$2,$3)', [
          randomUUID(),
          workspaceId,
          'everything',
        ]),
      )
    ).code,
  ).toBe('23514');
  expect((await rejected(exportOf('ledger', 'alice', eveProgramme))).code).toBe('42501');
});

test('everyone else is denied every pricing, series and export call without a trace', async () => {
  const before = await counts();
  const t = (await pricing().templates({ workspaceId })).templates[0]!;
  const calls = (p: string, target = workspaceId, programme = programmeId) => ({
    templates: () => pricing(p).templates({ workspaceId: target }),
    save: () => saveTemplate({}, p, randomUUID(), target),
    overview: () => pricing(p).overview({ workspaceId: target, programmeId: programme }),
    apply: () => applySchedule(t.id, programme, t.version, 1, p, randomUUID(), target),
    preview: () =>
      pricing(p).previewFees({
        workspaceId: target,
        programmeId: programme,
        scheduleVersion: 1,
        feeDate: '2026-11-15',
        rows: feeRows([['gina', standard]]),
      }),
    record: () =>
      pricing(p).recordFees({
        commandId: randomUUID(),
        workspaceId: target,
        programmeId: programme,
        scheduleVersion: 1,
        feeDate: '2026-11-15',
        rows: feeRows([['gina', standard]]),
      }),
    seriesList: () => pricing(p).seriesList({ workspaceId: target }),
    saveSeries: () => saveSeries({}, p, randomUUID(), target),
    edition: () =>
      pricing(p).createEdition({
        commandId: randomUUID(),
        workspaceId: target,
        seriesId: series.id,
        expectedVersion: series.version,
        editionNo: 5,
        templateVersion: 1,
        name: 'Synthetic denied edition attempt',
      }),
    revenue: () => pricing(p).revenue({ workspaceId: target, seriesId: series.id }),
    exportProgrammes: () => exportOf('programmes', p, null, randomUUID(), target),
    exportLedger: () => exportOf('ledger', p, programme, randomUUID(), target),
  });
  // A participant, a plain member, a revoked member, a disabled account, a stranger and another workspace's owner.
  for (const p of ['bob', 'dave', 'judy', 'kim', 'outsider', 'eve'])
    for (const [name, call] of Object.entries(calls(p)))
      expect((await rejected(call())).code, p + ' ' + name).toBe('42501');
  // The owner of one workspace naming another workspace, or a programme that is not in the workspace named.
  for (const [name, call] of Object.entries(calls('alice', otherWorkspace)))
    expect((await rejected(call())).code, 'forged workspace ' + name).toBe('42501');
  for (const name of ['overview', 'preview', 'record', 'exportLedger'] as const)
    expect(
      (await rejected(calls('alice', workspaceId, eveProgramme)[name]())).code,
      'foreign programme ' + name,
    ).toBe('42501');
  expect(
    (
      await rejected(
        raw('alice', 'SELECT customer.programme_series_revenue($1,$2)', [
          otherWorkspace,
          series.id,
        ]),
      )
    ).code,
  ).toBe('42501');
  const after = await counts();
  expect(after).toEqual({ ...before, proofs: after.proofs });
  // An admin is a writer: frank reads and writes.
  expect((await pricing('frank').templates({ workspaceId })).templates.length).toBeGreaterThan(0);
  expect((await pricing('frank').overview({ workspaceId, programmeId })).participants).toHaveLength(
    5,
  );
  expect(
    (await saveTemplate({ name: 'Synthetic admin written schedule' }, 'frank')).template.version,
  ).toBe(1);
  expect((await pricing('frank').seriesList({ workspaceId })).series.length).toBeGreaterThan(0);
  // A proof that has already run out is no authority.
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 second')",
    [hash, issuer, subject('alice')],
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_hash','',true)",
      [hash],
    );
    const error = await rejected(db.query('SELECT customer.pricing_templates($1)', [workspaceId]));
    expect(error.code).toBe('42501');
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
});

test('revoking an admin stops their pricing access at once', async () => {
  const frankMember = (
    await f.owner.query(
      'SELECT m.id FROM customer_private.workspace_member m JOIN customer_private.principal p ON p.id=m.principal_id WHERE p.subject=$1',
      [subject('frank')],
    )
  ).rows[0].id;
  await roles('alice').command({
    action: 'set_role',
    commandId: randomUUID(),
    workspaceId,
    memberId: frankMember,
    role: 'member',
    expectedRole: 'admin',
  });
  expect((await rejected(pricing('frank').templates({ workspaceId }))).code).toBe('42501');
  expect((await rejected(exportOf('programmes', 'frank'))).code).toBe('42501');
});

test('events and audit rows carry identifiers, versions and counts only, never names, text or amounts', async () => {
  const events = (
    await f.owner.query(
      "SELECT payload FROM app.domain_event WHERE aggregate_type IN ('customer_programme_pricing','customer_programme_series','customer_programme_export')",
    )
  ).rows;
  expect(events.length).toBeGreaterThan(15);
  const allowed = new Set([
    'templateId',
    'templateVersion',
    'version',
    'retired',
    'programmeId',
    'scheduleVersion',
    'batchId',
    'entries',
    'seriesId',
    'seriesVersion',
    'editionNo',
    'dates',
    'exportId',
    'dataset',
    'rows',
    'scoped',
    'kind',
    'synthetic',
    'initiator_id',
    'initiator_kind',
  ]);
  for (const e of events)
    for (const key of Object.keys(e.payload)) expect(allowed.has(key), key).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/Synthetic|BDT|USD|850000|HYPERLINK|venue/);
  const c = await counts();
  expect(c.events).toBe(c.audits);
  expect(c.events).toBe(c.outbox);
  expect(c.commercial).toBe(0);
});

test('free text must be synthetic in the application schema and in SQL', async () => {
  const edition = (name: string) =>
    raw('alice', 'SELECT customer.programme_series_edition_create($1,$2,$3,$4,$5)', [
      randomUUID(),
      workspaceId,
      series.id,
      series.version,
      JSON.stringify({ name, templateVersion: 1, editionNo: 5 }),
    ]);
  expect((await rejected(edition('Buyer mission edition five'))).code).toBe('23514');
  expect(
    editionCreateInput.safeParse({
      commandId: randomUUID(),
      workspaceId,
      seriesId: series.id,
      expectedVersion: series.version,
      editionNo: 5,
      templateVersion: 1,
      name: 'Buyer mission edition five',
    }).success,
  ).toBe(false);
  expect(
    pricingTemplateSaveInput.safeParse({
      commandId: randomUUID(),
      workspaceId,
      expectedVersion: 0,
      templateId: null,
      name: 'Synthetic valid name here',
      description: 'A description that is not synthetic',
      content: schedule(),
      retired: false,
    }).success,
  ).toBe(false);
});

test('database guards reject a fee line that does not match its entry, edition dates off the schedule, skipped versions and every rewrite', async () => {
  const line = (
    await f.owner.query(
      'SELECT batch_id,registration_id,entry_id,tier,base_minor,early_bird_minor,group_minor,amount_minor FROM customer_private.programme_fee_batch_line LIMIT 1',
    )
  ).rows[0];
  expect(
    await rejected(
      f.owner.query(
        "INSERT INTO customer_private.programme_fee_batch_line(batch_id,registration_id,entry_id,tier,base_minor,early_bird_minor,group_minor,amount_minor) SELECT $1,registration_id,id,$2,2000000,0,0,2000000 FROM customer_private.programme_ledger_entry WHERE kind='PARTICIPANT_FEE' AND id<>$3 LIMIT 1",
        [line.batch_id, line.tier, line.entry_id],
      ),
    ),
  ).toMatchObject({ message: expect.stringContaining('does not match') });
  expect(
    await rejected(
      f.owner.query(
        'INSERT INTO customer_private.programme_fee_schedule(workspace_id,programme_id,version,template_id,template_version,currency,content,applied_by) SELECT workspace_id,programme_id,99,template_id,template_version,currency,content,applied_by FROM customer_private.programme_fee_schedule LIMIT 1',
      ),
    ),
  ).toMatchObject({ message: expect.stringContaining('out of order') });
  expect(
    await rejected(
      f.owner.query(
        "INSERT INTO customer_private.programme_series_revision(series_id,workspace_id,version,name,template_id,start_dates,retired,changed_by) SELECT series_id,workspace_id,99,'Synthetic skipped a version',template_id,start_dates,false,changed_by FROM customer_private.programme_series_revision LIMIT 1",
      ),
    ),
  ).toMatchObject({ message: expect.stringContaining('out of order') });
  const edition = (
    await f.owner.query(
      'SELECT series_id,workspace_id,series_version,template_id,template_version,created_by FROM customer_private.programme_series_edition LIMIT 1',
    )
  ).rows[0];
  const spare = await newProgramme('Synthetic spare guard programme');
  expect(
    await rejected(
      f.owner.query(
        "INSERT INTO customer_private.programme_series_edition(series_id,workspace_id,edition_no,programme_id,start_date,series_version,template_id,template_version,created_by) VALUES($1,$2,5,$3,'2030-01-01',$4,$5,$6,$7)",
        [
          edition.series_id,
          edition.workspace_id,
          spare,
          edition.series_version,
          edition.template_id,
          edition.template_version,
          edition.created_by,
        ],
      ),
    ),
  ).toMatchObject({ message: expect.stringContaining('does not match the series schedule') });
  const tables = [
    'pricing_template',
    'pricing_template_revision',
    'programme_fee_schedule',
    'programme_fee_batch',
    'programme_fee_batch_line',
    'pricing_command',
    'programme_series',
    'programme_series_revision',
    'programme_series_edition',
    'programme_series_command',
    'programme_export_record',
  ];
  for (const table of tables) {
    expect(
      await rejected(f.owner.query(`DELETE FROM customer_private.${table}`)),
      'delete ' + table,
    ).toBeTruthy();
    expect(
      await rejected(f.owner.query(`UPDATE customer_private.${table} SET created_at=created_at`)),
      'update ' + table,
    ).toBeTruthy();
  }
});

test('runtime and auth roles cannot read or write module tables or call private helpers or the commands directly', async () => {
  const tables = [
    'pricing_template',
    'pricing_template_revision',
    'programme_fee_schedule',
    'programme_fee_batch',
    'programme_fee_batch_line',
    'pricing_command',
    'programme_series',
    'programme_series_revision',
    'programme_series_edition',
    'programme_series_command',
    'programme_export_record',
  ];
  for (const pool of [f.runtime, f.auth])
    for (const table of tables) {
      expect(
        (await rejected(pool.query(`SELECT * FROM customer_private.${table}`))).code,
        table,
      ).toBe('42501');
      expect(
        (await rejected(pool.query(`DELETE FROM customer_private.${table}`))).code,
        table,
      ).toBe('42501');
    }
  for (const sql of [
    "SELECT customer_private.pricing_content('{}'::jsonb)",
    'SELECT customer_private.pricing_template_json(gen_random_uuid())',
    'SELECT customer_private.fee_schedule_json(gen_random_uuid(),1)',
    'SELECT customer_private.series_json(gen_random_uuid())',
    'SELECT customer_private.pricing_scope(gen_random_uuid(),gen_random_uuid(),NULL)',
    'SELECT customer_private.pricing_compute(gen_random_uuid(),gen_random_uuid(),1,current_date,$$[]$$::jsonb)',
    'SELECT customer_private.pricing_event(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),$$programme_pricing$$,gen_random_uuid(),$$x$$,$${}$$::jsonb)',
  ])
    expect((await rejected(raw('alice', sql))).code, sql).toBe('42501');
  // The auth login holds no execute right on any command.
  for (const sql of [
    'SELECT customer.pricing_templates($1)',
    'SELECT customer.programme_series_list($1)',
    'SELECT customer.programme_series_revenue($1,gen_random_uuid())',
    'SELECT customer.programme_pricing_overview($1,gen_random_uuid())',
    "SELECT customer.programme_export(gen_random_uuid(),$1,'ledger')",
  ])
    expect((await rejected(f.auth.query(sql, [workspaceId]))).code, sql).toBe('42501');
  // The runtime login without a customer proof is no authority either.
  expect(
    (await rejected(f.runtime.query('SELECT customer.pricing_templates($1)', [workspaceId]))).code,
  ).toBe('42501');
});

test('the account-context guard and session checks run before any database work', async () => {
  const before = await counts();
  expect((await rejected(pricing().templates({ workspaceId }, 'someone-else'))).message).toContain(
    'account changed',
  );
  expect(
    (
      await rejected(
        pricing().templates(
          { workspaceId },
          subject('alice'),
          'https://ep-other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
        ),
      )
    ).message,
  ).toContain('account changed');
  const unverified = new CustomerProgrammePricingService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    emailVerified: false,
  }));
  expect((await rejected(unverified.templates({ workspaceId }))).message).toContain('Verify');
  const expired = new CustomerProgrammePricingService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    expiresAt: new Date(Date.now() - 1000),
  }));
  expect(
    (
      await rejected(
        expired.exportRows({ commandId: randomUUID(), workspaceId, dataset: 'programmes' }),
      )
    ).message,
  ).toContain('Sign in');
  const off = new CustomerProgrammePricingService(
    f.runtime,
    f.auth,
    { ...options, enabled: false },
    async () => session('alice'),
  );
  expect((await rejected(off.templates({ workspaceId }))).message).toContain('unavailable');
  expect(await counts()).toEqual(before);
});

test('an export that would exceed the size bound is refused and can be narrowed to one programme', async () => {
  const heavy = await newProgramme('Synthetic very large ledger programme');
  await f.owner.query(
    `INSERT INTO customer_private.programme_ledger_entry(workspace_id,programme_id,seq,kind,cost_basis,amount_minor,currency,occurred_on,description,recorded_by)
     SELECT $1,$2,g,'ORGANISER_EXPENSE','ACTUAL',1,'BDT',DATE '2027-01-01','Synthetic bound test row',(SELECT id FROM customer_private.principal WHERE subject=$3)
     FROM generate_series(1,10001) g`,
    [workspaceId, heavy, subject('alice')],
  );
  const before = await counts();
  const refused = await rejected(exportOf('ledger'));
  expect(refused.code).toBe('23514');
  expect(refused.message).toContain('Too many rows');
  expect(await counts()).toEqual(before);
  expect((await exportOf('ledger', 'alice', programmeId)).rowCount).toBeGreaterThan(0);
  expect((await rejected(exportOf('ledger', 'alice', heavy))).message).toContain('Too many rows');
});

test('csv cells are formula-safe, numbers stay numbers, amounts are exact decimals and the file name carries no personal data', () => {
  for (const hostile of ['=1+1', '+1', '-1+2', '@SUM(A1)', '\tcmd', '\rcmd', '=HYPERLINK("x","y")'])
    expect(csvCell(hostile).replace(/^"/, '').startsWith("'"), hostile).toBe(true);
  expect(csvCell('-500', true)).toBe('-500');
  expect(csvCell('-5oo', true)).toBe("'-5oo");
  expect(csvCell('a,b')).toBe('"a,b"');
  expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  expect(csvCell(null)).toBe('');
  expect(decimalAmount('850000', 2)).toBe('8500.00');
  expect(decimalAmount('5', 2)).toBe('0.05');
  expect(decimalAmount('-100000', 2)).toBe('-1000.00');
  expect(decimalAmount('246913578024691356', 2)).toBe('2469135780246913.56');
  expect(decimalAmount('12', 0)).toBe('12');
  expect(decimalAmount('1.5', 2)).toBe('');
  expect(exportFileName('ledger', new Date('2026-11-02T10:00:00Z'))).toBe(
    'corridra-ledger-2026-11-02.csv',
  );
  const csv = exportCsv('ledger', [
    {
      programmeId: 'p',
      seq: 1,
      kind: 'PARTICIPANT_FEE',
      amountMinor: '100',
      exponent: 2,
      currency: 'BDT',
      description: '=cmd|calc',
    },
  ]);
  expect(csv.split('\r\n')[0]).toContain('participant_reference');
  expect(csv).toContain("'=cmd|calc");
});
