import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerParticipantLabels } from '../../packages/db/src/customer-participant-label-migrate';
import { migrateCustomerProgrammePublication } from '../../packages/db/src/customer-programme-publication-migrate';
import { migrateCustomerBilling } from '../../packages/db/src/customer-billing-migrate';

// B7b: a sample workspace may start its free text with "Sample " as well as "Synthetic ". Two files do it: real-use
// file 0022 for what that module owns, and workspace lifecycle file 0010 (_late, repeated on every run) for what later
// modules own or fingerprint. Each database state is first built without the file, exactly as it stands before the
// installer runs, then the file is applied on top. Every definition is compared before and after, so the proof is
// "this one comparison and nothing else", and the later modules are installed in between to show their own guards
// still accept what they find.
const FILE = '0022_sample_first_word.sql';
const LATE = '0010_sample_first_word_late.sql';
vi.hoisted(() => {
  (globalThis as { __sampleWordHide?: boolean }).__sampleWordHide = true;
  (globalThis as { __sampleLateHide?: boolean }).__sampleLateHide = true;
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const gate = globalThis as { __sampleWordHide?: boolean; __sampleLateHide?: boolean };
    if (String(path).includes('customer-real-use-migrations'))
      return names.filter(
        (n) => !(gate.__sampleWordHide === true && String(n) === '0022_sample_first_word.sql'),
      );
    if (String(path).includes('customer-workspace-lifecycle-migrations'))
      return names.filter(
        (n) => !(gate.__sampleLateHide === true && String(n) === '0010_sample_first_word_late.sql'),
      );
    return names;
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

const FUNCTIONS = [
  'customer.organisation_link_command(uuid,text,jsonb)',
  'customer.programme_context_command(uuid,uuid,uuid,integer,jsonb,boolean)',
  'customer.programme_mission_command(uuid,text,jsonb)',
  'customer_private.coordination_text(jsonb,integer,integer,boolean)',
  'customer_private.mission_draft_valid(jsonb,uuid)',
  'customer_private.organisation_profile_valid(jsonb)',
  'customer_private.service_synthetic_ok(text,integer)',
];
// What workspace lifecycle file 0010 changes at once: this module's own three functions.
const OWN = [
  'customer.provision_workspace(uuid,text)',
  'customer.workspace_access_command(uuid,text,jsonb)',
  'customer.workspace_lifecycle_command(uuid,text,jsonb)',
];
// What it changes only once the module that defines each is installed.
const WAITING = [
  'customer.programme_application_command(uuid,text,jsonb)',
  'customer.programme_participant_command(uuid,text,jsonb)',
  'customer.programme_registration_label(uuid,uuid,integer,text)',
  'customer_private.billing_synthetic_ok(text,integer)',
  'customer_private.programme_publication_copy_valid(jsonb,boolean)',
];
// Left by file 0022 to file 0010, because the programme pages module fingerprints them (see both headers).
const LEFT_ALONE = [
  'programme_invitation_label_check',
  'programme_registration_display_label_check',
];
const OLD_CHECK = "~~ 'Synthetic %'::text";
const NEW_CHECK = "~ '^(Synthetic|Sample) '::text";
const widen = (definition: string) =>
  definition
    .split("NOT LIKE 'Synthetic %'")
    .join("!~ '^(Synthetic|Sample) '")
    .split("LIKE 'Synthetic %'")
    .join("~ '^(Synthetic|Sample) '");

type Row = Record<string, string | boolean | null>;
let f: Awaited<ReturnType<typeof fixture>>;
let before: { functions: Row[]; checks: Row[]; applied: string[] };
let after: { functions: Row[]; checks: Row[]; applied: string[] };
type Snapshot = typeof before;
let late: { hidden: Snapshot; own: Snapshot; modules: Snapshot; all: Snapshot; again: Snapshot };
const lateApplied = async () =>
  (
    await f.owner.query(
      'SELECT name FROM customer_workspace_lifecycle_migrations.applied ORDER BY name',
    )
  ).rows.map((r) => r.name as string);
const definitionsChanged = (was: Snapshot, now: Snapshot) =>
  now.functions
    .filter(
      (r) => r.definition !== was.functions.find((o) => o.signature === r.signature)?.definition,
    )
    .map((r) => r.signature as string)
    .sort();
const checksChanged = (was: Snapshot, now: Snapshot) =>
  now.checks.filter((r) => {
    const old = was.checks.find((o) => o.relation === r.relation && o.name === r.name);
    return !old || old.definition !== r.definition || old.validated !== r.validated;
  });
const keptRow = { programme: randomUUID(), workspace: randomUUID(), by: randomUUID() };

async function snapshot() {
  const functions = (
    await f.owner.query(
      `SELECT p.oid::regprocedure::text AS signature,pg_get_functiondef(p.oid) AS definition,
              p.proowner::regrole::text AS owner,coalesce(p.proacl::text,'') AS acl
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('app','customer','customer_private') AND p.prokind='f' ORDER BY 1`,
    )
  ).rows as Row[];
  const checks = (
    await f.owner.query(
      `SELECT c.conrelid::regclass::text AS relation,c.conname AS name,pg_get_constraintdef(c.oid) AS definition,
              c.convalidated AS validated
       FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE c.contype='c' AND c.conrelid<>0 AND n.nspname IN ('app','customer','customer_private') ORDER BY 1,2`,
    )
  ).rows as Row[];
  const applied = (
    await f.owner.query('SELECT name FROM customer_real_use_migrations.applied ORDER BY name')
  ).rows.map((r) => r.name as string);
  return { functions, checks, applied };
}

// A CHECK is tested with a direct insert as the database owner. Triggers and foreign keys are switched off for that
// one transaction only (they guard who may write, which other suites prove); a CHECK constraint still runs.
async function insertCapacityReason(reason: string, ids = { ...keptRow, programme: randomUUID() }) {
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL session_replication_role='replica'");
    await db.query(
      'INSERT INTO customer_private.programme_capacity_revision(programme_id,workspace_id,version,capacity,reason,set_by) VALUES($1,$2,1,5,$3,$4)',
      [ids.programme, ids.workspace, reason, ids.by],
    );
    await db.query('COMMIT');
    return 'saved';
  } catch (error) {
    await db.query('ROLLBACK');
    const e = error as { code?: string; constraint?: string };
    return `${e.code}:${e.constraint}`;
  } finally {
    db.release();
  }
}
const ok = async (call: string, args: unknown[]) =>
  (await f.owner.query(`SELECT ${call} AS ok`, args)).rows[0]!.ok as boolean;

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  expect(await insertCapacityReason('Synthetic capacity kept from before', keptRow)).toBe('saved');
  // Before the file: the word Sample is refused, which is the behaviour being changed.
  expect(await insertCapacityReason('Sample capacity for the fair')).toBe(
    '23514:programme_capacity_revision_reason_check',
  );
  before = await snapshot();
  (globalThis as { __sampleWordHide?: boolean }).__sampleWordHide = false;
  await migrateCustomerRealUse(f.owner);
  after = await snapshot();

  // Workspace lifecycle file 0010. First the module as it stands today, without the file.
  await migrateCustomerWorkspaceLifecycle(f.owner);
  const hidden = await snapshot();
  expect(await lateApplied()).not.toContain(LATE);
  (globalThis as { __sampleLateHide?: boolean }).__sampleLateHide = false;
  await migrateCustomerWorkspaceLifecycle(f.owner);
  const own = await snapshot();
  // The modules it waits for are installed only now, after the file has run once. Each of them checks the exact text
  // or shape of what it replaces, so each install here is itself the proof that the file left their inputs alone.
  await migrateCustomerProgrammeLifecycle(f.owner);
  await migrateCustomerParticipantLabels(f.owner);
  await migrateCustomerBilling(f.owner);
  await migrateCustomerProgrammePublication(f.owner);
  const modules = await snapshot();
  await migrateCustomerWorkspaceLifecycle(f.owner);
  const all = await snapshot();
  await migrateCustomerWorkspaceLifecycle(f.owner);
  late = { hidden, own, modules, all, again: await snapshot() };
}, 600000);
afterAll(async () => {
  await f?.close();
});

test('the file is applied once, on top of the ladder as it stood', async () => {
  expect(before.applied).not.toContain(FILE);
  expect(after.applied).toEqual([...before.applied, FILE]);
  await migrateCustomerRealUse(f.owner);
  expect((await snapshot()).applied).toEqual(after.applied);
});

test('exactly seven functions change, each only in the first-word comparison', () => {
  expect(after.functions.map((r) => r.signature)).toEqual(before.functions.map((r) => r.signature));
  const changed = after.functions.filter(
    (r, i) => r.definition !== before.functions[i]!.definition,
  );
  expect(changed.map((r) => r.signature).sort()).toEqual([...FUNCTIONS].sort());
  for (const now of changed) {
    const was = before.functions.find((r) => r.signature === now.signature)!;
    expect(now.definition).toBe(widen(was.definition as string));
    expect(now.definition).not.toContain('Synthetic %');
    // Who owns it and who may run it are exactly as before.
    expect([now.owner, now.acl]).toEqual([was.owner, was.acl]);
  }
});

test('exactly twenty-seven checks change, each only in the first-word comparison, and none re-reads old rows', () => {
  expect(after.checks.map((r) => `${r.relation}.${r.name}`)).toEqual(
    before.checks.map((r) => `${r.relation}.${r.name}`),
  );
  const changed = after.checks.filter(
    (r, i) =>
      r.definition !== before.checks[i]!.definition || r.validated !== before.checks[i]!.validated,
  );
  expect(changed).toHaveLength(27);
  for (const now of changed) {
    const was = before.checks.find((r) => r.relation === now.relation && r.name === now.name)!;
    expect(was.validated).toBe(true);
    expect((was.definition as string).split(OLD_CHECK)).toHaveLength(2);
    expect(now.definition).toBe(
      `${(was.definition as string).replace(OLD_CHECK, NEW_CHECK)} NOT VALID`,
    );
    expect(now.validated).toBe(false);
    // The branch a real workspace takes is still there, untouched.
    expect(now.definition).toContain('OR (NOT customer_private.synthetic_context())');
  }
  // The two checks another module fingerprints still pin the old word alone; nothing else does.
  const stillOld = after.checks.filter((r) => (r.definition as string).includes('Synthetic %'));
  expect(stillOld.map((r) => r.name).sort()).toEqual(LEFT_ALONE);
});

test('a sample workspace may now start with Sample or Synthetic, and with nothing else', async () => {
  expect(await insertCapacityReason('Sample capacity for the fair')).toBe('saved');
  expect(await insertCapacityReason('Synthetic capacity for the fair')).toBe('saved');
  for (const refused of [
    'Capacity for the fair this year',
    'Samples of capacity for the fair',
    'sample capacity for the fair',
    'A Sample capacity for the fair',
    'Sample  ',
    'Sample abc',
  ])
    expect(await insertCapacityReason(refused)).toBe(
      '23514:programme_capacity_revision_reason_check',
    );
  // Eleven characters is still the least a sample text may have.
  expect(await insertCapacityReason('Sample abcd')).toBe('saved');

  const service = 'customer_private.service_synthetic_ok($1,1000)';
  expect(await ok(service, ['Sample need for a freight quote'])).toBe(true);
  expect(await ok(service, ['Synthetic need for a freight quote'])).toBe(true);
  expect(await ok(service, ['Need for a freight quote'])).toBe(false);
  expect(await ok(service, ['Samplest need for a freight quote'])).toBe(false);
  // This one answers with the text itself and refuses by raising.
  const coordination = (text: string) =>
    f.owner
      .query('SELECT customer_private.coordination_text($1::jsonb,11,300,false) AS text', [
        JSON.stringify(text),
      ])
      .then(
        (r) => r.rows[0]!.text as string,
        (e: { code?: string }) => `refused:${e.code}`,
      );
  expect(await coordination('Sample task for the organiser')).toBe('Sample task for the organiser');
  expect(await coordination('Synthetic task for the organiser')).toBe(
    'Synthetic task for the organiser',
  );
  expect(await coordination('Task for the organiser to do')).toBe('refused:23514');
});

test('the row written before the file is still there, unchanged', async () => {
  const { rows } = await f.owner.query(
    'SELECT reason,capacity,version FROM customer_private.programme_capacity_revision WHERE programme_id=$1',
    [keptRow.programme],
  );
  expect(rows).toEqual([
    { reason: 'Synthetic capacity kept from before', capacity: 5, version: 1 },
  ]);
});

test('workspace lifecycle file 0010 first changes only its own three functions and no check', async () => {
  expect(await lateApplied()).toContain(LATE);
  expect(definitionsChanged(late.hidden, late.own)).toEqual([...OWN].sort());
  for (const signature of OWN) {
    const was = late.hidden.functions.find((r) => r.signature === signature)!;
    const now = late.own.functions.find((r) => r.signature === signature)!;
    expect(now.definition).toBe(widen(was.definition as string));
    expect([now.owner, now.acl]).toEqual([was.owner, was.acl]);
  }
  expect(checksChanged(late.hidden, late.own)).toEqual([]);
  // The participant command exists already, but the programme lifecycle module will replace it after checking its
  // exact text, so it is left for the run after that module.
  expect(
    late.own.functions.find(
      (r) => r.signature === 'customer.programme_participant_command(uuid,text,jsonb)',
    )!.definition,
  ).toContain("NOT LIKE 'Synthetic %'");
});

test('once the later modules are installed, the next run changes their five functions and the two label checks', () => {
  // The same run also lets the module's existing file 0004 gate the programme archive guard, which the programme
  // lifecycle module has just installed. That is file 0004's own change, as before, and not this file's.
  const ARCHIVE_GUARD = 'customer_private.programme_archived_guard(uuid,uuid,boolean,boolean)';
  expect(definitionsChanged(late.modules, late.all)).toEqual([...WAITING, ARCHIVE_GUARD].sort());
  for (const signature of WAITING) {
    const was = late.modules.functions.find((r) => r.signature === signature)!;
    const now = late.all.functions.find((r) => r.signature === signature)!;
    expect(now.definition).toBe(widen(was.definition as string));
    expect(now.definition).not.toContain('Synthetic %');
    expect([now.owner, now.acl]).toEqual([was.owner, was.acl]);
  }
  const changed = checksChanged(late.modules, late.all);
  expect(changed.map((r) => r.name).sort()).toEqual(LEFT_ALONE);
  for (const now of changed) {
    const was = late.modules.checks.find((r) => r.name === now.name)!;
    expect(was.validated).toBe(true);
    expect(now.definition).toBe(
      `${(was.definition as string).replace(OLD_CHECK, NEW_CHECK)} NOT VALID`,
    );
    expect(now.validated).toBe(false);
    expect(now.definition).toContain('OR (NOT customer_private.synthetic_context())');
  }
  // Nothing in the database pins the old word alone any more.
  expect(
    late.all.functions.filter((r) => (r.definition as string).includes('Synthetic %')),
  ).toEqual([]);
  expect(late.all.checks.filter((r) => (r.definition as string).includes('Synthetic %'))).toEqual(
    [],
  );
});

test('a further run changes nothing, and billing notes accept both words', async () => {
  expect(late.again).toEqual(late.all);
  const billing = 'customer_private.billing_synthetic_ok($1,1000)';
  expect(await ok(billing, ['Sample note about the plan'])).toBe(true);
  expect(await ok(billing, ['Synthetic note about the plan'])).toBe(true);
  expect(await ok(billing, ['Note about the plan for you'])).toBe(false);
});
