import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture } from './support';
import { digest, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProblemReports } from '../../packages/db/src/customer-problem-report-migrate';

// Report a Problem, the install order. The problem report module is optional: nothing installs it unless it is asked
// for. It never applies the real-use schema itself, installs the account lifecycle module first (which stays closed),
// has no control and no application switch of its own, is repeatable, and refuses to run over changed files.
const schema = 'customer_problem_report_migrations';
const file = '0001_problem_reports.sql';
const ownTables = [
  'customer_private.problem_report',
  'customer_private.problem_report_words',
  'customer_private.problem_report_status_event',
  'customer_private.problem_report_erasure',
];
let f: Fixture;
let g: Fixture;

const installed = async (pool: Fixture) =>
  (
    await pool.owner.query(
      "SELECT to_regclass('customer_private.problem_report') IS NOT NULL AS present",
    )
  ).rows[0].present as boolean;
const registryPresent = async (pool: Fixture) =>
  (await pool.owner.query(`SELECT to_regclass('${schema}.applied') IS NOT NULL AS present`)).rows[0]
    .present as boolean;
const applied = async (pool: Fixture) =>
  (await pool.owner.query(`SELECT name,sha256 FROM ${schema}.applied ORDER BY name`)).rows as {
    name: string;
    sha256: string;
  }[];
const accountModule = async (pool: Fixture) =>
  (
    await pool.owner.query(
      "SELECT to_regclass('customer_private.account_lifecycle_control') IS NOT NULL AS present",
    )
  ).rows[0].present as boolean;
const accountOpen = async (pool: Fixture) =>
  (await pool.owner.query('SELECT customer_private.account_lifecycle_open() AS open')).rows[0]
    .open as boolean;

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  g = await fixture('corridra_upgrade');
});
afterAll(async () => {
  await f?.close();
  await g?.close();
});

describe('installing the problem report module', () => {
  test('refuses, writing nothing, when the real-use schema is absent or not current: it never applies that schema itself', async () => {
    await expect(migrateCustomerProblemReports(g.owner)).rejects.toThrow(
      'The customer real-use schema is not current',
    );
    expect(await installed(g)).toBe(false);
    expect(await accountModule(g)).toBe(false);
    expect(await registryPresent(g)).toBe(false);
    const last = (
      await f.owner.query(
        'SELECT name,sha256,applied_at FROM customer_real_use_migrations.applied ORDER BY name DESC LIMIT 1',
      )
    ).rows[0];
    await f.owner.query('DELETE FROM customer_real_use_migrations.applied WHERE name=$1', [
      last.name,
    ]);
    try {
      await expect(migrateCustomerProblemReports(f.owner)).rejects.toThrow(
        'The customer real-use schema is not current',
      );
      expect(await installed(f)).toBe(false);
      expect(await accountModule(f)).toBe(false);
      expect(await registryPresent(f)).toBe(false);
    } finally {
      await f.owner.query(
        'INSERT INTO customer_real_use_migrations.applied(name,sha256,applied_at) VALUES($1,$2,$3)',
        [last.name, last.sha256, last.applied_at],
      );
    }
  });

  test('installs with the account lifecycle left closed, changes no existing row, adds no control, and is repeatable', async () => {
    const tables = [
      'customer.workspace',
      'customer.membership',
      'customer_private.principal',
      'app.tenant',
      'app.domain_event',
      'app.audit_event',
    ];
    const before = await digest(f, tables);
    await migrateCustomerProblemReports(f.owner);
    expect(await installed(f)).toBe(true);
    for (const table of ownTables)
      expect(
        (await f.owner.query(`SELECT to_regclass('${table}') IS NOT NULL AS present`)).rows[0]
          .present,
      ).toBe(true);
    expect((await applied(f)).map((row) => row.name)).toContain(file);
    // the account lifecycle module is installed first, and left closed
    expect(await accountModule(f)).toBe(true);
    expect(await accountOpen(f)).toBe(false);
    // no control table of its own: installing is the whole activation
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='customer_private' AND c.relkind='r' AND c.relname LIKE 'problem_report%' AND c.relname LIKE '%control%'",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(await digest(f, tables)).toEqual(before);
    for (const table of ownTables)
      expect((await f.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    const once = await applied(f);
    await migrateCustomerProblemReports(f.owner);
    expect(await applied(f)).toEqual(once);
    expect(await digest(f, tables)).toEqual(before);
  });

  test('refuses to run over a changed applied file', async () => {
    const [first] = await applied(f);
    await f.owner.query(`UPDATE ${schema}.applied SET sha256=$2 WHERE name=$1`, [
      first!.name,
      'f'.repeat(64),
    ]);
    try {
      await expect(migrateCustomerProblemReports(f.owner)).rejects.toThrow(
        'Problem report migration history mismatch',
      );
    } finally {
      await f.owner.query(`UPDATE ${schema}.applied SET sha256=$2 WHERE name=$1`, [
        first!.name,
        first!.sha256,
      ]);
    }
    await expect(migrateCustomerProblemReports(f.owner)).resolves.toBeUndefined();
  });

  test('refuses to run when an applied file has no source any more', async () => {
    await f.owner.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
      '9999_removed.sql',
      'a'.repeat(64),
    ]);
    try {
      await expect(migrateCustomerProblemReports(f.owner)).rejects.toThrow(
        'Problem report migration history mismatch',
      );
    } finally {
      await f.owner.query(`DELETE FROM ${schema}.applied WHERE name=$1`, ['9999_removed.sql']);
    }
    await expect(migrateCustomerProblemReports(f.owner)).resolves.toBeUndefined();
  });
});

describe('the migration source is additive', () => {
  const directory = resolve('packages/db/customer-problem-report-migrations');
  const names = readdirSync(directory).filter((name) => name.endsWith('.sql'));
  const sql = names.map((name) => readFileSync(join(directory, name), 'utf8')).join('\n');
  const code = sql.replace(/--[^\n]*/g, '');

  test('is the one expected file', () => {
    expect(names).toEqual([file]);
  });
  test('never replaces, drops or alters an existing object, and has no em dash', () => {
    expect(code).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
    expect(code).not.toMatch(/\bDROP\s/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    for (const match of code.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?([\w.]+)/gi))
      expect(match[1]).toMatch(/^customer_private\.problem_report(_[a-z_]+)?$/);
    expect(sql).not.toContain('—');
  });
  test('has exactly one delete, from its own words table, and changes no other table', () => {
    const deletes = [...code.matchAll(/\bDELETE\s+FROM\s+([\w.]+)/gi)];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]![1]).toBe('customer_private.problem_report_words');
    for (const match of code.matchAll(/\bINSERT\s+INTO\s+([\w.]+)/gi))
      expect(match[1]).toMatch(/^customer_private\.problem_report(_[a-z_]+)?$/);
    for (const match of code.matchAll(/\bUPDATE\s+([\w.]+)\s+SET\b/gi))
      expect(match[1]).toMatch(/^customer_private\.problem_report(_[a-z_]+)?$/);
  });
  test('writes no event and no outbox row', () => {
    expect(code).not.toMatch(/app\.domain_event|app\.audit_event|outbox/i);
  });
});

describe('the install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const installWorkflow = 'install-customer-modules.yml';
  const workflows = resolve('.github/workflows');
  const text = readFileSync(join(workflows, installWorkflow), 'utf8');

  test('the script takes a two-valued action that needs apply, and lists the registry', () => {
    expect(script).toContain(
      "PROBLEM_REPORTS_ACTION: z.enum(['unchanged', 'install']).default('unchanged')",
    );
    expect(script).toMatch(/PROBLEM_REPORTS_ACTION !== 'unchanged' && !apply/);
    expect(script).toContain('Problem report installation requires INSTALL_APPLY=yes');
    expect(script).toContain("'customer_problem_report_migrations'");
  });
  test('the script calls the installer once, only inside its own install block, and never in a base run', () => {
    const call = 'migrateCustomerProblemReports(pool)';
    expect(script.split(call).length - 1).toBe(1);
    const at = script.indexOf(call + ';');
    expect(at).toBeGreaterThan(-1);
    expect(script.slice(at - 80, at)).toContain("v.PROBLEM_REPORTS_ACTION === 'install'");
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/problem/i);
    // the lifecycle installer is still called only from its own guard: this module reaches it through the migration
    expect(script.split('migrateCustomerAccountLifecycle(pool)').length - 1).toBe(1);
  });
  test('the workflow derives the line from field_modules_action alone and adds no input', () => {
    expect(text).not.toMatch(/^\s{6}problem_reports?[a-z_]*:/m);
    const lines = text.split('\n').filter((line) => /PROBLEM_REPORTS_ACTION/.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("inputs.field_modules_action == 'problem_reports' && 'install'");
    expect(lines[0]!.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
    expect(text).toContain("inputs.field_modules_action != 'unchanged'");
  });
  test('no other workflow carries the action', () => {
    for (const name of readdirSync(workflows).filter(
      (n) => /\.ya?ml$/.test(n) && n !== installWorkflow,
    ))
      expect(readFileSync(join(workflows, name), 'utf8')).not.toMatch(/PROBLEM_REPORTS/);
  });
});
