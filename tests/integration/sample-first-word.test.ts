import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';

// B7b: real-use file 0022 lets a sample workspace start its free text with "Sample " as well as "Synthetic ". The
// database is first built without the file, exactly as it stands before the installer runs, then the file is applied
// on top. Every definition is compared before and after, so the proof is "this one comparison and nothing else".
const FILE = '0022_sample_first_word.sql';
vi.hoisted(() => {
  (globalThis as { __sampleWordHide?: boolean }).__sampleWordHide = true;
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    if (!String(path).includes('customer-real-use-migrations')) return names;
    const hide = (globalThis as { __sampleWordHide?: boolean }).__sampleWordHide === true;
    return names.filter((n) => !(hide && String(n) === '0022_sample_first_word.sql'));
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
// Left to their own modules, which own or fingerprint them (see the file's header).
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
