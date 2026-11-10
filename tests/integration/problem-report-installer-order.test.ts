import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture } from './support';
import { digest, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerProblemReports } from '../../packages/db/src/customer-problem-report-migrate';

// Report a Problem, the install order. The problem report module is optional: nothing installs it unless it is asked
// for. It never applies the real-use schema itself, installs the account lifecycle module first (which stays closed),
// has no control and no application switch of its own, is repeatable, and refuses to run over changed files. Its second
// file replaces the word removal function behind a guard that has three states: absent, matching and changed.
const schema = 'customer_problem_report_migrations';
const file = '0001_problem_reports.sql';
const bounds = '0002_word_removal_bounds.sql';
const removeWords = 'customer.problem_report_remove_words(uuid,uuid)';
// What 0001 created: the SHA-256 of the stored function body (pg_proc.prosrc, read from a database that applied 0001
// alone) and of the 0001 file text, the same method the migrator uses.
const firstBodyHash = '582ab8289185d2bbeefb5bbba84ecb14a536274db2fd9c8e90b30dfa8a2267df';
const firstFileHash = '52d32043f9b8138b78e11114d3683fd5ff385d4a498d35689e1f0fa5dedb88cc';
const directory = resolve('packages/db/customer-problem-report-migrations');
const source = (name: string) => readFileSync(join(directory, name), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const differs =
  'Problem report prerequisite function differs: customer.problem_report_remove_words';
const fileDiffers = 'Problem report prerequisite file differs: 0001_problem_reports.sql';
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
const liveBodyHash = async (pool: Fixture) =>
  (
    await pool.owner.query(
      `SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS hash FROM pg_proc WHERE oid=to_regprocedure('${removeWords}')`,
    )
  ).rows[0]?.hash as string | undefined;
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
    // both files are in the registry, each with the hash of its own text, and the second ran over the first
    expect(await applied(f)).toEqual([
      { name: file, sha256: sha256(source(file)) },
      { name: bounds, sha256: sha256(source(bounds)) },
    ]);
    expect(sha256(source(file))).toBe(firstFileHash);
    const live = await liveBodyHash(f);
    expect(live).toBeDefined();
    expect(live).not.toBe(firstBodyHash);
    expect(
      (
        await f.owner.query(
          `SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('${removeWords}')`,
        )
      ).rows[0].prosrc,
    ).toContain(
      "cutoff:=CASE WHEN current_state='completed' THEN stamped ELSE transaction_timestamp() END",
    );
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

  test.each([file, bounds])('refuses to run over a changed applied file %s', async (name) => {
    const row = (await applied(f)).find((item) => item.name === name)!;
    await f.owner.query(`UPDATE ${schema}.applied SET sha256=$2 WHERE name=$1`, [
      name,
      'f'.repeat(64),
    ]);
    try {
      await expect(migrateCustomerProblemReports(f.owner)).rejects.toThrow(
        'Problem report migration history mismatch',
      );
    } finally {
      await f.owner.query(`UPDATE ${schema}.applied SET sha256=$2 WHERE name=$1`, [
        name,
        row.sha256,
      ]);
    }
    await expect(migrateCustomerProblemReports(f.owner)).resolves.toBeUndefined();
  });

  test('refuses, replacing nothing, when the second file has lost its registry row while the function is already replaced', async () => {
    const row = (await applied(f)).find((item) => item.name === bounds)!;
    const before = await liveBodyHash(f);
    await f.owner.query(`DELETE FROM ${schema}.applied WHERE name=$1`, [bounds]);
    try {
      await expect(migrateCustomerProblemReports(f.owner)).rejects.toThrow(differs);
      expect(await liveBodyHash(f)).toBe(before);
      expect((await applied(f)).map((item) => item.name)).toEqual([file]);
    } finally {
      await f.owner.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
        bounds,
        row.sha256,
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
  const names = readdirSync(directory).filter((name) => name.endsWith('.sql'));
  const strip = (text: string) => text.replace(/--[^\n]*/g, '');
  const first = strip(source(file));
  const second = strip(source(bounds));
  const pattern = /^customer_private\.problem_report(_[a-z_]+)?$/;

  test('is exactly the two expected files', () => {
    expect(names).toEqual([file, bounds]);
  });
  test('the first file never replaces, drops or alters an existing object, and has no em dash', () => {
    expect(first).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
    expect(first).not.toMatch(/\bDROP\s/i);
    expect(first).not.toMatch(/\bTRUNCATE\b/i);
    for (const match of first.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?([\w.]+)/gi))
      expect(match[1]).toMatch(pattern);
    expect(source(file)).not.toContain('—');
  });
  test('the first file has exactly one delete, from its own words table, and changes no other table', () => {
    const deletes = [...first.matchAll(/\bDELETE\s+FROM\s+([\w.]+)/gi)];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]![1]).toBe('customer_private.problem_report_words');
    for (const match of first.matchAll(/\bINSERT\s+INTO\s+([\w.]+)/gi))
      expect(match[1]).toMatch(pattern);
    for (const match of first.matchAll(/\bUPDATE\s+([\w.]+)\s+SET\b/gi))
      expect(match[1]).toMatch(pattern);
  });
  test('the second file replaces exactly one function, the word removal one, and drops and alters nothing', () => {
    const replaced = [...second.matchAll(/CREATE\s+OR\s+REPLACE\s+(\w+)\s+([\w.]+)/gi)];
    expect(replaced).toHaveLength(1);
    expect(replaced[0]![1]!.toUpperCase()).toBe('FUNCTION');
    expect(replaced[0]![2]).toBe('customer.problem_report_remove_words');
    expect(second).not.toMatch(
      /\bCREATE\s+(?!OR\s+REPLACE\s+FUNCTION\s+customer\.problem_report_remove_words)/i,
    );
    expect(second).not.toMatch(/\bDROP\s/i);
    expect(second).not.toMatch(/\bTRUNCATE\b/i);
    expect(second).not.toMatch(/\bALTER\s/i);
    expect(second).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(source(bounds)).not.toContain('—');
  });
  test('the second file has exactly one delete, from the words table, and inserts only erasure rows', () => {
    const deletes = [...second.matchAll(/\bDELETE\s+FROM\s+([\w.]+)/gi)];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]![1]).toBe('customer_private.problem_report_words');
    const inserts = [...second.matchAll(/\bINSERT\s+INTO\s+([\w.]+)/gi)];
    expect(inserts).toHaveLength(1);
    expect(inserts[0]![1]).toBe('customer_private.problem_report_erasure');
    expect(second).not.toMatch(/\bUPDATE\s+[\w.]+\s+SET\b/i);
  });
  test('neither file writes an event, an audit row or an outbox row', () => {
    expect(first).not.toMatch(/app\.domain_event|app\.audit_event|outbox/i);
    expect(second).not.toMatch(/app\.domain_event|app\.audit_event|outbox/i);
  });
  test('the second file compares the function by body hash, security, search path and argument types, never by its definition text', () => {
    expect(second).not.toMatch(/pg_get_functiondef/i);
    expect(second).toContain(`'${firstBodyHash}'`);
    expect(second).toContain(`'${firstFileHash}'`);
    expect(second).toMatch(/prosecdef/);
    expect(second).toContain("proconfig=ARRAY['search_path=pg_catalog']");
    expect(second).toContain("proargtypes::text='2950 2950'");
  });
});

// The guard of the second file has three states. Each runs against a database that has the prerequisites and the first
// file applied by hand, so the second file's SQL text can be run on its own, alone, and every refusal is undone.
describe('the second file guard: absent, matching and changed', () => {
  let t: Fixture;
  const notices: string[] = [];
  const text = () => source(bounds);
  // run the second file alone in one transaction that is always rolled back, and say what it did
  const attempt = async (
    prepare: (db: {
      query: (sql: string, values?: unknown[]) => Promise<unknown>;
    }) => Promise<void>,
  ) => {
    const db = await t.owner.connect();
    notices.length = 0;
    db.on('notice', (notice) => notices.push(notice.message ?? ''));
    try {
      await db.query('BEGIN');
      await prepare(db);
      try {
        await db.query(text());
        const after = await db.query(
          `SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS hash FROM pg_proc WHERE oid=to_regprocedure('${removeWords}')`,
        );
        return { error: undefined, hash: after.rows[0]?.hash as string | undefined };
      } catch (error) {
        return { error: (error as Error).message, hash: undefined };
      }
    } finally {
      await db.query('ROLLBACK');
      db.removeAllListeners('notice');
      db.release();
    }
  };
  const registry = async (db: { query: (sql: string, values?: unknown[]) => Promise<unknown> }) => {
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await db.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
    );
  };

  beforeAll(async () => {
    t = await fixture('corridra_upgrade_third');
  });
  afterAll(async () => {
    await t?.close();
  });

  test('ABSENT: with the first file not applied it changes nothing, raises no error and creates no function', async () => {
    const outcome = await attempt(async () => undefined);
    expect(outcome.error).toBeUndefined();
    expect(outcome.hash).toBeUndefined();
    expect(notices).toEqual([
      'Problem report word removal bounds skipped: 0001_problem_reports.sql is not applied',
    ]);
    expect(await liveBodyHash(t)).toBeUndefined();
    // a registry that exists but holds no row for the first file is the same state
    const withRegistry = await attempt(registry);
    expect(withRegistry.error).toBeUndefined();
    expect(withRegistry.hash).toBeUndefined();
    expect(notices).toHaveLength(1);
    // a registry that records the first file while the function is missing is not absent: it is refused
    const lost = await attempt(async (db) => {
      await registry(db);
      await db.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
        file,
        firstFileHash,
      ]);
    });
    expect(lost.error).toBe(differs);
    expect(await liveBodyHash(t)).toBeUndefined();
    expect(
      (await t.owner.query(`SELECT to_regclass('${schema}.applied') IS NOT NULL AS present`))
        .rows[0].present,
    ).toBe(false);
  });

  describe('with the first file applied', () => {
    beforeAll(async () => {
      await migrateCustomerRealUse(t.owner);
      await migrateCustomerAccountLifecycle(t.owner);
      await t.owner.query(source(file));
    });

    test('the first file created the function the guard fingerprints', async () => {
      expect(sha256(source(file))).toBe(firstFileHash);
      expect(await liveBodyHash(t)).toBe(firstBodyHash);
      const shape = (
        await t.owner.query(
          `SELECT prosecdef,proconfig,proargtypes::text AS args FROM pg_proc WHERE oid=to_regprocedure('${removeWords}')`,
        )
      ).rows[0];
      expect(shape).toEqual({
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
        args: '2950 2950',
      });
    });

    test.each([
      [
        'a changed body',
        async (db: { query: (sql: string) => Promise<unknown> }) => {
          await db.query(
            `CREATE OR REPLACE FUNCTION customer.problem_report_remove_words(command uuid,erasure_request uuid) RETURNS jsonb
             LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RETURN '{}'::jsonb; END $$`,
          );
        },
      ],
      [
        'a changed security setting',
        async (db: { query: (sql: string) => Promise<unknown> }) => {
          await db.query(`ALTER FUNCTION ${removeWords} SECURITY INVOKER`);
        },
      ],
      [
        'a changed search path',
        async (db: { query: (sql: string) => Promise<unknown> }) => {
          await db.query(`ALTER FUNCTION ${removeWords} SET search_path=pg_catalog,public`);
        },
      ],
      [
        'a removed search path',
        async (db: { query: (sql: string) => Promise<unknown> }) => {
          await db.query(`ALTER FUNCTION ${removeWords} RESET search_path`);
        },
      ],
    ])(
      'CHANGED: refuses %s, even with the first file recorded, and replaces nothing',
      async (_name, change) => {
        for (const recorded of [false, true]) {
          const outcome = await attempt(async (db) => {
            if (recorded) {
              await registry(db);
              await db.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
                file,
                firstFileHash,
              ]);
            }
            await change(db);
          });
          expect(outcome.error).toBe(differs);
        }
        expect(await liveBodyHash(t)).toBe(firstBodyHash);
      },
    );

    test('CHANGED: refuses a registry row for the first file with another hash, or none, and replaces nothing', async () => {
      const tampered = await attempt(async (db) => {
        await registry(db);
        await db.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
          file,
          'f'.repeat(64),
        ]);
      });
      expect(tampered.error).toBe(fileDiffers);
      const missing = await attempt(registry);
      expect(missing.error).toBe(fileDiffers);
      expect(await liveBodyHash(t)).toBe(firstBodyHash);
    });

    test('MATCHING: replaces the function with the registry absent or recording the first file, and keeps its grants', async () => {
      const unregistered = await attempt(async () => undefined);
      expect(unregistered.error).toBeUndefined();
      expect(unregistered.hash).toBeDefined();
      expect(unregistered.hash).not.toBe(firstBodyHash);
      const registered = await attempt(async (db) => {
        await registry(db);
        await db.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
          file,
          sha256(source(file)),
        ]);
      });
      expect(registered.error).toBeUndefined();
      expect(registered.hash).toBe(unregistered.hash);
      expect(notices).toEqual([]);
      expect(await liveBodyHash(t)).toBe(firstBodyHash);
      // committed: the new body is live, still SECURITY DEFINER with the same search path, and the grants are unchanged
      await t.owner.query(text());
      expect(await liveBodyHash(t)).toBe(unregistered.hash);
      const state = (
        await t.owner.query(
          `SELECT prosecdef,proconfig,proargtypes::text AS args,
            has_function_privilege('corridra_runtime',oid,'EXECUTE') AS runtime,
            has_function_privilege('corridra_auth',oid,'EXECUTE') AS auth,
            has_function_privilege('public',oid,'EXECUTE') AS public
           FROM pg_proc WHERE oid=to_regprocedure('${removeWords}')`,
        )
      ).rows[0];
      expect(state).toEqual({
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
        args: '2950 2950',
        runtime: true,
        auth: false,
        public: false,
      });
    });

    test('a second run of the second file over the replaced function is refused, so it can only be applied once', async () => {
      const outcome = await attempt(async () => undefined);
      expect(outcome.error).toBe(differs);
    });
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
