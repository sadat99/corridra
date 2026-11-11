import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture, rawContext } from './support';
import { digest, harness, type Fixture, type Row } from './revamp-g4-support';
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
const selfRemoval = '0003_problem_report_self_removal.sql';
const removeWords = 'customer.problem_report_remove_words(uuid,uuid)';
const plainText = 'customer_private.problem_report_plain(text,integer,integer)';
// What 0001 created: the SHA-256 of the stored function body (pg_proc.prosrc, read from a database that applied 0001
// alone) and of the 0001 file text, the same method the migrator uses.
const firstBodyHash = '582ab8289185d2bbeefb5bbba84ecb14a536274db2fd9c8e90b30dfa8a2267df';
const firstPlainHash = '67f5be7abee4ff564d1bd83cac2bc30bc5b090da8f068bb5699bc196f9f4961d';
const firstFileHash = '52d32043f9b8138b78e11114d3683fd5ff385d4a498d35689e1f0fa5dedb88cc';
const boundsFileHash = '74603ba692aca8b9108ffb72ce10ef8742a93a0ecebf1aaefb262e5efa2e8707';
// What 0001 and 0002 left: the SHA-256 of the stored body (pg_proc.prosrc) of the five functions 0003 replaces, with the
// argument types the guard compares. Read from a database that applied both files by the migrator; the word removal is the
// 0002 form, the other four are still the 0001 form.
const boundsBodyHash = 'f27a8f09f4c98c526b11a2f49929829bfc67802f1f172a8738d4c72dad3c4777';
const guardFunction = 'customer_private.problem_report_words_guard()';
const listFunction = 'customer.problem_report_list(bigint,integer)';
const getFunction = 'customer.problem_report_get(text)';
const queueFunction = 'customer.problem_report_queue(bigint,integer,text)';
const ownWords = 'customer.problem_report_remove_own_words(uuid)';
const replacedBySelfRemoval = [
  {
    name: 'staff word removal',
    signature: removeWords,
    hash: boundsBodyHash,
    args: '2950 2950',
    params: 'command uuid,erasure_request uuid',
    returns: 'jsonb',
    language: 'plpgsql VOLATILE SECURITY DEFINER',
  },
  {
    name: 'words guard',
    signature: guardFunction,
    hash: 'c684a2835e16949c509e8dd03316088ce9a42a5fedeeb9335edb446e7a32cc06',
    args: '',
    params: '',
    returns: 'trigger',
    language: 'plpgsql VOLATILE SECURITY DEFINER',
  },
  {
    name: 'list',
    signature: listFunction,
    hash: 'e11fcea3a92ed45bd0497d6f7b10ec7363391ef51322907aa1029bb16ddf5aea',
    args: '20 23',
    params: 'before_number bigint DEFAULT NULL,page_size integer DEFAULT 25',
    returns: 'jsonb',
    language: 'plpgsql VOLATILE SECURITY DEFINER',
  },
  {
    name: 'get',
    signature: getFunction,
    hash: 'f6bc8bb6376f39d0824fbc55f4c29529481456cc808eb284f62a3a46909a7bb0',
    args: '25',
    params: 'ref text',
    returns: 'jsonb',
    language: 'plpgsql VOLATILE SECURITY DEFINER',
  },
  {
    name: 'staff queue',
    signature: queueFunction,
    hash: '0df0814aa8f4cd9264cae20e2724a35b01d8938e6ef0be3620bf5c71d339007b',
    args: '20 23 25',
    params:
      'after_number bigint DEFAULT NULL,page_size integer DEFAULT 25,state_filter text DEFAULT NULL',
    returns: 'jsonb',
    language: 'plpgsql VOLATILE SECURITY DEFINER',
  },
] as const;
const directory = resolve('packages/db/customer-problem-report-migrations');
const source = (name: string) => readFileSync(join(directory, name), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const differs =
  'Problem report prerequisite function differs: customer.problem_report_remove_words';
const plainDiffers =
  'Problem report prerequisite function differs: customer_private.problem_report_plain';
const fileDiffers = 'Problem report prerequisite file differs: 0001_problem_reports.sql';
const ownTables = [
  'customer_private.problem_report',
  'customer_private.problem_report_words',
  'customer_private.problem_report_status_event',
  'customer_private.problem_report_erasure',
  'customer_private.problem_report_self_removal',
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
const liveBodyHash = async (pool: Fixture, signature = removeWords) =>
  (
    await pool.owner.query(
      `SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS hash FROM pg_proc WHERE oid=to_regprocedure('${signature}')`,
    )
  ).rows[0]?.hash as string | undefined;
// whether the plain text rule accepts a value, asked of the live function (a new class character is refused, its neighbours are not)
const plainAccepts = async (pool: Fixture, value: string) =>
  (await pool.owner.query('SELECT customer_private.problem_report_plain($1,1,100) AS ok', [value]))
    .rows[0].ok as boolean;
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
    // all three files are in the registry, each with the hash of its own text, and each ran over the one before
    expect(await applied(f)).toEqual([
      { name: file, sha256: sha256(source(file)) },
      { name: bounds, sha256: sha256(source(bounds)) },
      { name: selfRemoval, sha256: sha256(source(selfRemoval)) },
    ]);
    expect(sha256(source(file))).toBe(firstFileHash);
    const live = await liveBodyHash(f);
    expect(live).toBeDefined();
    expect(live).not.toBe(firstBodyHash);
    expect(live).not.toBe(boundsBodyHash);
    // the plain text rule is replaced too: it refuses a C1 control now and still accepts its neighbour
    expect(await liveBodyHash(f, plainText)).not.toBe(firstPlainHash);
    expect(await plainAccepts(f, 'a\u0085b')).toBe(false);
    expect(await plainAccepts(f, 'a\u00a0b')).toBe(true);
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

  test.each([file, bounds, selfRemoval])(
    'refuses to run over a changed applied file %s',
    async (name) => {
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
    },
  );

  test('refuses, replacing nothing, when the second file has lost its registry row while the function is already replaced', async () => {
    const row = (await applied(f)).find((item) => item.name === bounds)!;
    const before = await liveBodyHash(f);
    await f.owner.query(`DELETE FROM ${schema}.applied WHERE name=$1`, [bounds]);
    try {
      await expect(migrateCustomerProblemReports(f.owner)).rejects.toThrow(differs);
      expect(await liveBodyHash(f)).toBe(before);
      expect((await applied(f)).map((item) => item.name)).toEqual([file, selfRemoval]);
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

  test('is exactly the three expected files', () => {
    expect(names).toEqual([file, bounds, selfRemoval]);
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
  test('the second file replaces exactly two functions, the word removal one and the plain text rule, and drops and alters nothing', () => {
    const replaced = [...second.matchAll(/CREATE\s+OR\s+REPLACE\s+(\w+)\s+([\w.]+)/gi)];
    expect(replaced.map((match) => [match[1]!.toUpperCase(), match[2]])).toEqual([
      ['FUNCTION', 'customer.problem_report_remove_words'],
      ['FUNCTION', 'customer_private.problem_report_plain'],
    ]);
    expect(second).not.toMatch(
      /\bCREATE\s+(?!OR\s+REPLACE\s+FUNCTION\s+customer(_private)?\.problem_report_(remove_words|plain)\()/i,
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
  test('the second file compares each function by body hash, security, volatility, search path and argument types, never by its definition text', () => {
    expect(second).not.toMatch(/pg_get_functiondef/i);
    expect(second).toContain(`'${firstBodyHash}'`);
    expect(second).toContain(`'${firstPlainHash}'`);
    expect(second).toContain(`'${firstFileHash}'`);
    expect(second).toContain('prosecdef=f.secdef');
    expect(second).toContain('provolatile=f.volatility');
    expect(second).toContain("proconfig=ARRAY['search_path=pg_catalog']");
    expect(second).toContain('proargtypes::text=f.argument_types');
    expect(second).toContain("'2950 2950'");
    expect(second).toContain("'25 23 23'");
  });

  describe('the third file', () => {
    const third = strip(source(selfRemoval));
    const body = (text: string, tag: string) =>
      new RegExp(`\\$${tag}\\$\\n([\\s\\S]*?)\\n\\$${tag}\\$;`).exec(text)![1]!;
    // the text of a function in an earlier file, cut from its CREATE to the end of its body
    const earlier = (text: string, start: string, end: string) => {
      const from = text.indexOf(start);
      expect(from, start).toBeGreaterThanOrEqual(0);
      return text.slice(from, text.indexOf(end, from) + end.length);
    };
    const once = (text: string, from: string, to: string) => {
      expect(text.split(from).length - 1, from).toBe(1);
      return text.replace(from, () => to);
    };
    const replace = (text: string) => once(text, 'CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
    const erased = (alias: string, report: string) =>
      `EXISTS(SELECT FROM customer_private.problem_report_erasure ${alias} WHERE ${alias}.report_id=${report})`;
    const selfRemoved = (alias: string, report: string) =>
      `EXISTS(SELECT FROM customer_private.problem_report_self_removal ${alias} WHERE ${alias}.report_id=${report})`;

    test('replaces exactly the five functions and creates only its own table, index, trigger function, triggers and function', () => {
      const replaced = [...third.matchAll(/CREATE\s+OR\s+REPLACE\s+(\w+)\s+([\w.]+)/gi)];
      expect(replaced.map((match) => [match[1]!.toUpperCase(), match[2]])).toEqual([
        ['FUNCTION', 'customer_private.problem_report_words_guard'],
        ['FUNCTION', 'customer.problem_report_list'],
        ['FUNCTION', 'customer.problem_report_get'],
        ['FUNCTION', 'customer.problem_report_queue'],
        ['FUNCTION', 'customer.problem_report_remove_words'],
      ]);
      const created = [...third.matchAll(/\bCREATE\s+(?!OR\s+REPLACE)(\w+)\s+([\w.]+)/gi)];
      expect(created.map((match) => [match[1]!.toUpperCase(), match[2]])).toEqual([
        ['TABLE', 'customer_private.problem_report_self_removal'],
        ['INDEX', 'problem_report_self_removal_command'],
        ['FUNCTION', 'customer_private.problem_report_self_removal_check'],
        ['TRIGGER', 'problem_report_self_removal_check'],
        ['TRIGGER', 'problem_report_self_removal_immutable'],
        ['FUNCTION', 'customer.problem_report_remove_own_words'],
      ]);
    });
    test('drops, truncates and updates nothing, alters only its own table, and grants only its own function', () => {
      expect(third).not.toMatch(/\bDROP\s/i);
      expect(third).not.toMatch(/\bTRUNCATE\b/i);
      expect(third).not.toMatch(/\bUPDATE\s+[\w.]+\s+SET\b/i);
      const alters = [...third.matchAll(/\bALTER\s+(\w+)\s+([\w.]+)\s+([A-Z ]+)/g)];
      expect(alters.map((match) => [match[1], match[2], match[3]!.trim()])).toEqual([
        ['TABLE', 'customer_private.problem_report_self_removal', 'ENABLE ROW LEVEL SECURITY'],
      ]);
      const privileges = [
        ...third.matchAll(
          /\b(GRANT|REVOKE)\b[^;]*?\bON\s+(?:FUNCTION\s+)?([\w.]+(?:\(uuid\)|\(\))?)/g,
        ),
      ];
      expect(privileges.map((match) => [match[1], match[2]])).toEqual([
        ['REVOKE', 'customer_private.problem_report_self_removal'],
        ['REVOKE', 'customer_private.problem_report_self_removal_check()'],
        ['REVOKE', 'customer.problem_report_remove_own_words(uuid)'],
        ['GRANT', 'customer.problem_report_remove_own_words(uuid)'],
      ]);
    });
    test('has one delete, from the words table, and its inserts are the staff erasure row and its own row, with no event, audit, outbox or definition text', () => {
      const deletes = [...third.matchAll(/\bDELETE\s+FROM\s+([\w.]+)/gi)];
      expect(deletes.map((match) => match[1])).toEqual([
        'customer_private.problem_report_words',
        'customer_private.problem_report_words',
      ]);
      const inserts = [...third.matchAll(/\bINSERT\s+INTO\s+([\w.]+)/gi)];
      expect(inserts.map((match) => match[1])).toEqual([
        'customer_private.problem_report_erasure',
        'customer_private.problem_report_self_removal',
      ]);
      expect(third).not.toMatch(/app\.domain_event|app\.audit_event|outbox/i);
      expect(third).not.toMatch(/pg_get_functiondef/i);
      expect(source(selfRemoval)).not.toContain('\u2014');
    });
    test('compares each of the five by body hash, security, volatility, search path and argument types, and pins both earlier files', () => {
      const text = source(selfRemoval);
      for (const entry of replacedBySelfRemoval)
        expect(text).toContain(`'${entry.signature}','${entry.hash}',true,'v','${entry.args}'`);
      expect(text).toContain(`'${firstFileHash}'`);
      expect(text).toContain(`'${boundsFileHash}'`);
      expect(sha256(source(file))).toBe(firstFileHash);
      expect(sha256(source(bounds))).toBe(boundsFileHash);
      expect(text).toContain('prosecdef=f.secdef');
      expect(text).toContain('provolatile=f.volatility');
      expect(text).toContain("proconfig=ARRAY['search_path=pg_catalog']");
      expect(text).toContain('proargtypes::text=f.argument_types');
    });
    test('the list, get and queue bodies differ from the first file in the words removed expression alone', () => {
      const first = source(file);
      const list = once(
        replace(earlier(first, 'CREATE FUNCTION customer.problem_report_list(', 'END $$;')).slice(
          0,
          -1,
        ),
        `'wordsRemoved',${erased('e', 'r.id')}`,
        `'wordsRemoved',(${erased('e', 'r.id')} OR ${selfRemoved('q', 'r.id')})`,
      );
      const get = once(
        replace(earlier(first, 'CREATE FUNCTION customer.problem_report_get(', 'END $$;')).slice(
          0,
          -1,
        ),
        `CASE WHEN ${erased('e', 'r.id')} THEN`,
        `CASE WHEN ${erased('e', 'r.id')} OR ${selfRemoved('q', 'r.id')} THEN`,
      );
      const queue = once(
        replace(earlier(first, 'CREATE FUNCTION customer.problem_report_queue(', 'END $$;')).slice(
          0,
          -1,
        ),
        `'wordsRemoved',${erased('e', 'p.id')},`,
        `'wordsRemoved',(${erased('e', 'p.id')} OR ${selfRemoved('q', 'p.id')}),`,
      );
      expect(body(source(selfRemoval), 'listfn')).toBe(list);
      expect(body(source(selfRemoval), 'getfn')).toBe(get);
      expect(body(source(selfRemoval), 'queuefn')).toBe(queue);
    });
    test('the words guard allows a delete for an erasure row or a self-removal row, and the staff removal differs from the second file by the lock and the skip alone', () => {
      const guard = once(
        replace(
          earlier(
            source(file),
            'CREATE FUNCTION customer_private.problem_report_words_guard(',
            'END $$;',
          ),
        ).slice(0, -1),
        "IF TG_OP='DELETE' AND EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=OLD.report_id) THEN RETURN OLD; END IF;",
        "IF TG_OP='DELETE' AND (EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=OLD.report_id)\n  OR EXISTS(SELECT FROM customer_private.problem_report_self_removal s WHERE s.report_id=OLD.report_id)) THEN RETURN OLD; END IF;",
      );
      expect(body(source(selfRemoval), 'guardfn')).toBe(guard);
      const lifecycle =
        " PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||filed.principal_id::text,0));\n";
      const removal = once(
        once(
          body(source(bounds), 'fn'),
          lifecycle,
          lifecycle +
            " PERFORM pg_advisory_xact_lock(hashtextextended('customer.problem_report:'||filed.principal_id::text,0));\n",
        ),
        '  AND NOT EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=r.id) ORDER BY r.number LOOP',
        '  AND NOT EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=r.id)\n  AND NOT EXISTS(SELECT FROM customer_private.problem_report_self_removal s WHERE s.report_id=r.id) ORDER BY r.number LOOP',
      );
      expect(body(source(selfRemoval), 'removefn')).toBe(removal);
      // the probe marker of the first availability check stays, and the lock order is the lifecycle lock, then the report lock
      expect(removal).toContain('cutoff');
      expect(removal.indexOf('customer.account.lifecycle:')).toBeLessThan(
        removal.indexOf('customer.problem_report:'),
      );
    });
  });
});

// The guard of the second file has three states for each of the two functions it replaces. Each runs against a database
// that has the prerequisites and the first file applied by hand, so the second file's SQL text can be run on its own,
// alone, and every attempt is undone. The table names every (function, state) pair.
type Db = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};
const registrySql = [
  `CREATE SCHEMA IF NOT EXISTS ${schema}`,
  `CREATE TABLE IF NOT EXISTS ${schema}.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
];
const recordFirstFile = async (db: Db, hash: string = firstFileHash) => {
  for (const statement of registrySql) await db.query(statement);
  await db.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [file, hash]);
};
const bodyHashIn = async (db: Db, signature: string) =>
  (
    await db.query(
      `SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS hash FROM pg_proc WHERE oid=to_regprocedure('${signature}')`,
    )
  ).rows[0]?.hash as string | undefined;
const replaceBody = (signature: string, returns: string, language: string, body: string) =>
  `CREATE OR REPLACE FUNCTION ${signature} RETURNS ${returns} LANGUAGE ${language} SET search_path=pg_catalog AS $$ ${body} $$`;

const guarded = [
  {
    name: 'word removal function',
    signature: removeWords,
    firstHash: firstBodyHash,
    other: plainText,
    otherFirstHash: firstPlainHash,
    message: differs,
    changes: [
      [
        'a changed body',
        replaceBody(
          'customer.problem_report_remove_words(command uuid,erasure_request uuid)',
          'jsonb',
          'plpgsql VOLATILE SECURITY DEFINER',
          "BEGIN RETURN '{}'::jsonb; END",
        ),
      ],
      ['a changed security setting', `ALTER FUNCTION ${removeWords} SECURITY INVOKER`],
      ['a changed volatility', `ALTER FUNCTION ${removeWords} STABLE`],
      ['a changed search path', `ALTER FUNCTION ${removeWords} SET search_path=pg_catalog,public`],
      ['a removed search path', `ALTER FUNCTION ${removeWords} RESET search_path`],
      [
        'a missing function while the other one is there',
        'ALTER FUNCTION customer.problem_report_remove_words(uuid,uuid) RENAME TO elsewhere',
      ],
    ],
    live: async (db: Db) =>
      (
        (await db.query(`SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('${removeWords}')`))
          .rows[0]!.prosrc as string
      ).includes('cutoff:=CASE WHEN current_state='),
  },
  {
    name: 'plain text rule function',
    signature: plainText,
    firstHash: firstPlainHash,
    other: removeWords,
    otherFirstHash: firstBodyHash,
    message: plainDiffers,
    changes: [
      [
        'a changed body',
        replaceBody(
          'customer_private.problem_report_plain(value text,min_length integer,max_length integer)',
          'boolean',
          'sql IMMUTABLE',
          'SELECT true',
        ),
      ],
      ['a changed security setting', `ALTER FUNCTION ${plainText} SECURITY DEFINER`],
      ['a changed volatility', `ALTER FUNCTION ${plainText} STABLE`],
      ['a changed search path', `ALTER FUNCTION ${plainText} SET search_path=pg_catalog,public`],
      ['a removed search path', `ALTER FUNCTION ${plainText} RESET search_path`],
      [
        'a missing function while the other one is there',
        'ALTER FUNCTION customer_private.problem_report_plain(text,integer,integer) RENAME TO elsewhere',
      ],
    ],
    live: async (db: Db) =>
      (await db.query("SELECT customer_private.problem_report_plain(E'a\\u0085b',1,10) AS ok"))
        .rows[0]!.ok === false &&
      (await db.query("SELECT customer_private.problem_report_plain(E'a\\u00a0b',1,10) AS ok"))
        .rows[0]!.ok === true,
  },
] as const;

describe('the second file guard: absent, matching and changed, for each function it replaces', () => {
  let t: Fixture;
  const notices: string[] = [];
  const text = () => source(bounds);
  let second: { removeWords?: string; plain?: string };
  // Run the second file alone in a transaction that is always rolled back, and say what it did and what both functions
  // are afterwards (after a refusal, read behind a savepoint, so a half-done replacement would show).
  const attempt = async (
    prepare: (db: Db) => Promise<void>,
    probe?: (db: Db) => Promise<boolean>,
  ) => {
    const db = await t.owner.connect();
    notices.length = 0;
    db.on('notice', (notice) => notices.push(notice.message ?? ''));
    try {
      await db.query('BEGIN');
      await prepare(db);
      await db.query('SAVEPOINT guarded');
      let error: string | undefined;
      try {
        await db.query(text());
      } catch (caught) {
        error = (caught as Error).message;
        await db.query('ROLLBACK TO SAVEPOINT guarded');
      }
      return {
        error,
        removeWords: await bodyHashIn(db, removeWords),
        plain: await bodyHashIn(db, plainText),
        probed: error === undefined && probe ? await probe(db) : undefined,
      };
    } finally {
      await db.query('ROLLBACK');
      db.removeAllListeners('notice');
      db.release();
    }
  };

  beforeAll(async () => {
    t = await fixture('corridra_upgrade_third');
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('ABSENT: the first file is not applied', () => {
    test.each(guarded)(
      '$name: ABSENT skips with a notice, raises no error and creates nothing',
      async ({ signature }) => {
        const outcome = await attempt(async () => undefined);
        expect(outcome.error).toBeUndefined();
        expect(outcome.removeWords).toBeUndefined();
        expect(outcome.plain).toBeUndefined();
        expect(notices).toEqual([
          'Problem report word removal bounds skipped: 0001_problem_reports.sql is not applied',
        ]);
        expect(await liveBodyHash(t, signature)).toBeUndefined();
        // a registry that exists but holds no row for the first file is the same state
        const withRegistry = await attempt(async (db) => {
          for (const statement of registrySql) await db.query(statement);
        });
        expect(withRegistry.error).toBeUndefined();
        expect(withRegistry.removeWords).toBeUndefined();
        expect(withRegistry.plain).toBeUndefined();
        expect(notices).toHaveLength(1);
        expect(await liveBodyHash(t, signature)).toBeUndefined();
        expect(
          (await t.owner.query(`SELECT to_regclass('${schema}.applied') IS NOT NULL AS present`))
            .rows[0].present,
        ).toBe(false);
      },
    );

    test('a registry that records the first file while the functions are missing is not absent: it is refused', async () => {
      const lost = await attempt((db) => recordFirstFile(db));
      expect(lost.error).toBe(differs);
      expect(await liveBodyHash(t)).toBeUndefined();
      expect(await liveBodyHash(t, plainText)).toBeUndefined();
    });
  });

  describe('with the first file applied', () => {
    beforeAll(async () => {
      await migrateCustomerRealUse(t.owner);
      await migrateCustomerAccountLifecycle(t.owner);
      await t.owner.query(source(file));
      second = await attempt(async () => undefined);
    });

    test('the first file created the functions the guard fingerprints', async () => {
      expect(sha256(source(file))).toBe(firstFileHash);
      expect(await liveBodyHash(t)).toBe(firstBodyHash);
      expect(await liveBodyHash(t, plainText)).toBe(firstPlainHash);
      const shape = async (signature: string) =>
        (
          await t.owner.query(
            `SELECT prosecdef,provolatile,proconfig,proargtypes::text AS args FROM pg_proc WHERE oid=to_regprocedure('${signature}')`,
          )
        ).rows[0];
      expect(await shape(removeWords)).toEqual({
        prosecdef: true,
        provolatile: 'v',
        proconfig: ['search_path=pg_catalog'],
        args: '2950 2950',
      });
      expect(await shape(plainText)).toEqual({
        prosecdef: false,
        provolatile: 'i',
        proconfig: ['search_path=pg_catalog'],
        args: '25 23 23',
      });
      // the rule before the second file: a C1 control, a line separator and a bidirectional override are still accepted
      for (const value of ['a\u0085b', 'a\u2028b', 'a\u202eb', 'a\u0080b'])
        expect(await plainAccepts(t, value)).toBe(true);
    });

    const changed = guarded.flatMap((entry) =>
      entry.changes.map(([change, statement]) => ({ ...entry, change, statement })),
    );
    test.each(changed)(
      '$name: CHANGED by $change refuses, with the first file recorded or not, and replaces neither function',
      async ({ statement, message, firstHash, otherFirstHash, signature, other }) => {
        for (const recorded of [false, true]) {
          const outcome = await attempt(async (db) => {
            if (recorded) await recordFirstFile(db);
            await db.query(statement);
          });
          expect(outcome.error).toBe(message);
          // read behind the savepoint: the function that was not changed is still the first file's, and the changed one
          // is not the second file's either
          const hashes = { [removeWords]: outcome.removeWords, [plainText]: outcome.plain };
          if (!statement.includes('RENAME')) expect(hashes[signature]).not.toBe(undefined);
          expect(hashes[other]).toBe(otherFirstHash);
          expect(hashes[signature]).not.toBe(
            signature === removeWords ? second.removeWords : second.plain,
          );
        }
        expect(await liveBodyHash(t, signature)).toBe(firstHash);
        expect(await liveBodyHash(t, other)).toBe(otherFirstHash);
      },
    );

    test.each(guarded)(
      '$name: CHANGED, the registry row of the first file with another hash or none refuses and replaces nothing',
      async ({ signature, firstHash }) => {
        const tampered = await attempt((db) => recordFirstFile(db, 'f'.repeat(64)));
        expect(tampered.error).toBe(fileDiffers);
        const missing = await attempt(async (db) => {
          for (const statement of registrySql) await db.query(statement);
        });
        expect(missing.error).toBe(fileDiffers);
        expect(tampered.removeWords).toBe(firstBodyHash);
        expect(tampered.plain).toBe(firstPlainHash);
        expect(await liveBodyHash(t, signature)).toBe(firstHash);
      },
    );

    test.each(guarded)(
      '$name: EXACT MATCH replaces it, with the registry absent or recording the first file, and the new behaviour is live',
      async ({ signature, firstHash, live }) => {
        const unregistered = await attempt(async () => undefined, live);
        expect(unregistered.error).toBeUndefined();
        expect(unregistered.probed).toBe(true);
        const registered = await attempt((db) => recordFirstFile(db, sha256(source(file))), live);
        expect(registered.error).toBeUndefined();
        expect(registered.probed).toBe(true);
        expect(notices).toEqual([]);
        expect(registered.removeWords).toBe(unregistered.removeWords);
        expect(registered.plain).toBe(unregistered.plain);
        expect(unregistered.removeWords).not.toBe(firstBodyHash);
        expect(unregistered.plain).not.toBe(firstPlainHash);
        // and the attempt was undone
        expect(await liveBodyHash(t, signature)).toBe(firstHash);
      },
    );

    test('committed, the second file leaves security, volatility, search path and grants as they were, and a second run is refused', async () => {
      const unregistered = await attempt(async () => undefined);
      await t.owner.query(text());
      expect(await liveBodyHash(t)).toBe(unregistered.removeWords);
      expect(await liveBodyHash(t, plainText)).toBe(unregistered.plain);
      const state = async (signature: string) =>
        (
          await t.owner.query(
            `SELECT prosecdef,provolatile,proconfig,proargtypes::text AS args,
              has_function_privilege('corridra_runtime',oid,'EXECUTE') AS runtime,
              has_function_privilege('corridra_auth',oid,'EXECUTE') AS auth,
              has_function_privilege('public',oid,'EXECUTE') AS public
             FROM pg_proc WHERE oid=to_regprocedure('${signature}')`,
          )
        ).rows[0];
      expect(await state(removeWords)).toEqual({
        prosecdef: true,
        provolatile: 'v',
        proconfig: ['search_path=pg_catalog'],
        args: '2950 2950',
        runtime: true,
        auth: false,
        public: false,
      });
      expect(await state(plainText)).toEqual({
        prosecdef: false,
        provolatile: 'i',
        proconfig: ['search_path=pg_catalog'],
        args: '25 23 23',
        runtime: false,
        auth: false,
        public: false,
      });
      expect(await plainAccepts(t, 'a\u0085b')).toBe(false);
      const again = await attempt(async () => undefined);
      expect(again.error).toBe(differs);
    });
  });
});

// The production upgrade path: a database that already has the first file and its registry row (as the merged
// installer left it) is brought up by the migrator, which applies the second file and then the third.
describe('upgrading a database that has only the first file through the migrator', () => {
  let t: Fixture;
  const grants = async () =>
    (
      await t.owner.query(
        `SELECT prosecdef,proconfig,proargtypes::text AS args,
          has_function_privilege('corridra_runtime',oid,'EXECUTE') AS runtime,
          has_function_privilege('corridra_auth',oid,'EXECUTE') AS auth,
          has_function_privilege('public',oid,'EXECUTE') AS public
         FROM pg_proc WHERE oid=to_regprocedure('${removeWords}')`,
      )
    ).rows[0];
  const settled = {
    prosecdef: true,
    proconfig: ['search_path=pg_catalog'],
    args: '2950 2950',
    runtime: true,
    auth: false,
    public: false,
  };
  // a team report with words that the rule of the first file accepted: a C1 control in the detail
  const oldDetail = 'stored under the older\u0085 rule';
  const teamReport = async () =>
    (
      await t.owner.query(
        `INSERT INTO customer_private.problem_report(reporter_kind,staff_principal_id,staff_tenant_id,side,category,command_id)
         VALUES('team',$1,$2,'sample','did_not_work',$3) RETURNING id`,
        [t.users.operator!.id, t.tenantA, randomUUID()],
      )
    ).rows[0].id as string;
  const addWords = (report: string, detail: string) =>
    t.owner.query(
      `INSERT INTO customer_private.problem_report_words(report_id,reporter_kind,category,page_kind,page_text,detail)
       VALUES($1,'team','did_not_work','this_page','/operator/x',$2)`,
      [report, detail],
    );
  let oldReport: string;
  // reports filed through the real functions under the rule of the first file, with characters the second file refuses
  const filed: { reference: string; detail: string }[] = [];
  let teamFiled: { reference: string; detail: string };
  let noted: string;
  const note = 'We are reading what\u0085 you wrote.';
  const storedTables = [
    'customer_private.problem_report',
    'customer_private.problem_report_words',
    'customer_private.problem_report_status_event',
    'customer_private.problem_report_erasure',
  ];
  let filenodes: Record<string, unknown>[];
  let h: ReturnType<typeof harness>;
  const input = (over: Record<string, unknown>) => ({
    category: 'did_not_work',
    pageKind: 'this_page',
    page: '/account/requests',
    ...over,
  });
  const customerFiles = (body: Record<string, unknown>) =>
    h
      .sql<{ r: Row }>('olga', 'SELECT customer.problem_report_command($1,$2) AS r', [
        randomUUID(),
        JSON.stringify(body),
      ])
      .then((row) => row.r);
  const teamFiles = (body: Record<string, unknown>) =>
    rawContext(t.runtime, t.users.operator!.ctx, 'SELECT app.problem_report_command($1,$2) AS r', [
      randomUUID(),
      JSON.stringify(body),
    ]).then((result) => result.rows[0].r as Row);
  const staffAs = (text: string, params: unknown[]) =>
    rawContext(t.runtime, t.users.owner!.ctx, text, params).then((result) => result.rows[0]);
  const filenodesNow = async () =>
    (
      await t.owner.query(
        `SELECT c.relname,c.relfilenode::text AS filenode,
          (SELECT count(*)::int FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='c' AND NOT k.convalidated) AS unvalidated
         FROM pg_class c WHERE c.oid=ANY($1::regclass[]) ORDER BY c.relname`,
        [storedTables],
      )
    ).rows;

  beforeAll(async () => {
    t = await fixture('corridra_upgrade_third');
    await migrateCustomerRealUse(t.owner);
    await migrateCustomerAccountLifecycle(t.owner);
    await t.owner.query(source(file));
    await t.owner.query(`CREATE SCHEMA ${schema}`);
    await t.owner.query(
      `REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC,corridra_runtime,corridra_auth`,
    );
    await t.owner.query(
      `CREATE TABLE ${schema}.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    await t.owner.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
      file,
      sha256(source(file)),
    ]);
    oldReport = await teamReport();
    await addWords(oldReport, oldDetail);
    // a customer files three reports whose detail the first rule accepts and the second refuses, and one with such a
    // character in the other page text; a team member files one; staff write a note with a C1 control
    h = harness(t, 'prup');
    await h.admit(['olga']);
    await h.provision('olga', 'Synthetic olga workspace');
    for (const detail of [
      'a long enough\u0085 detail',
      'a long enough\u2028 detail',
      'a long enough\u202e detail',
    ]) {
      const made = await customerFiles(input({ detail }));
      filed.push({ reference: made.reference as string, detail });
    }
    const other = await customerFiles(input({ pageKind: 'another_page', page: 'Meet\u0085ings' }));
    filed.push({ reference: other.reference as string, detail: '' });
    const teamDetail = 'a team detail with\u0085 a control';
    teamFiled = {
      reference: (await teamFiles(input({ page: '/operator/requests', detail: teamDetail })))
        .reference as string,
      detail: teamDetail,
    };
    noted = (
      await t.owner.query('SELECT id FROM customer_private.problem_report WHERE reference=$1', [
        filed[0]!.reference,
      ])
    ).rows[0].id as string;
    await staffAs('SELECT customer.problem_report_transition($1,$2,$3,$4,$5) AS r', [
      randomUUID(),
      noted,
      'received',
      'in_review',
      note,
    ]);
    filenodes = await filenodesNow();
  });
  afterAll(async () => {
    await t?.close();
  });

  test('applies the second and the third file, replaces the functions, keeps the grants and the older rows, and a second run changes nothing', async () => {
    expect(await liveBodyHash(t)).toBe(firstBodyHash);
    expect(await liveBodyHash(t, plainText)).toBe(firstPlainHash);
    expect(await grants()).toEqual(settled);
    await migrateCustomerProblemReports(t.owner);
    expect(
      (await t.owner.query(`SELECT name,sha256 FROM ${schema}.applied ORDER BY name`)).rows,
    ).toEqual([
      { name: file, sha256: sha256(source(file)) },
      { name: bounds, sha256: sha256(source(bounds)) },
      { name: selfRemoval, sha256: sha256(source(selfRemoval)) },
    ]);
    const live = await liveBodyHash(t);
    expect(live).toBeDefined();
    expect(live).not.toBe(firstBodyHash);
    const body = (
      await t.owner.query(`SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('${removeWords}')`)
    ).rows[0].prosrc as string;
    expect(body).toContain('transaction_timestamp()');
    expect(body).toContain('Command conflicts with original request');
    expect(body).toContain('problem_report_self_removal');
    expect(await grants()).toEqual(settled);
    // the plain text rule is replaced: a new class character is refused, its neighbour and old rules are not changed
    const plain = await liveBodyHash(t, plainText);
    expect(plain).toBeDefined();
    expect(plain).not.toBe(firstPlainHash);
    expect(await plainAccepts(t, 'a\u0085b')).toBe(false);
    expect(await plainAccepts(t, 'a\u00a0b')).toBe(true);
    expect(await plainAccepts(t, 'a@b')).toBe(false);
    // the row stored under the older rule is untouched, and the same text is refused for a new row
    expect(
      (
        await t.owner.query(
          'SELECT detail FROM customer_private.problem_report_words WHERE report_id=$1',
          [oldReport],
        )
      ).rows,
    ).toEqual([{ detail: oldDetail }]);
    await expect(addWords(await teamReport(), oldDetail)).rejects.toMatchObject({ code: '23514' });
    const once = (
      await t.owner.query(`SELECT name,sha256,applied_at FROM ${schema}.applied ORDER BY name`)
    ).rows;
    await migrateCustomerProblemReports(t.owner);
    expect(
      (await t.owner.query(`SELECT name,sha256,applied_at FROM ${schema}.applied ORDER BY name`))
        .rows,
    ).toEqual(once);
    expect(await liveBodyHash(t)).toBe(live);
    expect(await liveBodyHash(t, plainText)).toBe(plain);
    expect(await grants()).toEqual(settled);
  });

  test('rows stored under the older rule stay as they are: reads, the queue and word removal keep working, and only new writes are refused', async () => {
    await migrateCustomerProblemReports(t.owner);
    expect(await liveBodyHash(t, plainText)).not.toBe(firstPlainHash);
    // replacing a function used by a CHECK constraint checks no stored row again and rewrites no table: every stored table
    // keeps its file node and every check constraint is still validated
    expect(await filenodesNow()).toEqual(filenodes);
    for (const row of await filenodesNow()) expect(row.unvalidated).toBe(0);
    // the customer reads their reports with the original characters, and the note on the status row
    for (const { reference, detail } of filed.slice(0, 3)) {
      const read = (
        await h.sql<{ r: Row }>('olga', 'SELECT customer.problem_report_get($1) AS r', [reference])
      ).r;
      expect(read.words).toMatchObject({ detail });
    }
    const other = (
      await h.sql<{ r: Row }>('olga', 'SELECT customer.problem_report_get($1) AS r', [
        filed[3]!.reference,
      ])
    ).r;
    expect(other.words).toMatchObject({ page: 'Meet\u0085ings' });
    const reviewed = (
      await h.sql<{ r: Row }>('olga', 'SELECT customer.problem_report_get($1) AS r', [
        filed[0]!.reference,
      ])
    ).r;
    expect((reviewed.history as Row[]).map((row) => [row.state, row.note])).toEqual([
      ['received', null],
      ['in_review', note],
    ]);
    // the team member reads theirs, and staff see all of them in the queue
    const teamRead = (
      await rawContext(t.runtime, t.users.operator!.ctx, 'SELECT app.problem_report_get($1) AS r', [
        teamFiled.reference,
      ])
    ).rows[0].r as Row;
    expect(teamRead.words).toMatchObject({ detail: teamFiled.detail });
    const queue = (await staffAs('SELECT customer.problem_report_queue(NULL,100,NULL) AS r', []))
      .r as { items: Row[] };
    for (const { reference, detail } of filed.slice(0, 3))
      expect(queue.items.find((item) => item.reference === reference)).toMatchObject({ detail });
    // staff remove the words of the customer's reports under an erasure request, and the team report is not touched
    const control = (
      await t.owner.query(
        'SELECT coalesce(max(version),0)::int AS v FROM customer_private.account_lifecycle_control',
      )
    ).rows[0].v as number;
    await t.owner.query(
      'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,true,$2,$3)',
      [control + 1, t.serviceId, 'Fixture control for the problem report upgrade test'],
    );
    expect(
      (
        await h.sql<{ r: Row }>(
          'olga',
          'SELECT customer.account_lifecycle_command($1,$2,$3) AS r',
          [randomUUID(), 'file_erasure', '{}'],
        )
      ).r.changed,
    ).toBe(true);
    const requests = (await staffAs('SELECT customer.erasure_queue(NULL,100,NULL) AS r', [])).r as {
      id: string;
      principalId: string;
    }[];
    expect(requests).toHaveLength(1);
    await staffAs('SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
      randomUUID(),
      requests[0]!.id,
      'received',
      'in_progress',
      null,
    ]);
    expect(
      (
        await staffAs('SELECT customer.problem_report_remove_words($1,$2) AS r', [
          randomUUID(),
          requests[0]!.id,
        ])
      ).r,
    ).toMatchObject({ removed: 4 });
    for (const { reference } of filed)
      expect(
        (
          await h.sql<{ r: Row }>('olga', 'SELECT customer.problem_report_get($1) AS r', [
            reference,
          ])
        ).r.words,
      ).toEqual({ removed: true });
    expect(
      (
        await rawContext(
          t.runtime,
          t.users.operator!.ctx,
          'SELECT app.problem_report_get($1) AS r',
          [teamFiled.reference],
        )
      ).rows[0].r.words,
    ).toMatchObject({ detail: teamFiled.detail });
    // new writes with the same characters are refused, by the functions and by the table checks
    await expect(
      customerFiles(input({ detail: 'a long enough\u0085 detail' })),
    ).rejects.toMatchObject({
      code: '22023',
    });
    await expect(
      teamFiles(input({ page: '/operator/requests', detail: 'a long enough\u2028 detail' })),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(addWords(await teamReport(), oldDetail)).rejects.toMatchObject({ code: '23514' });
  });
});

// The guard of the third file, like the second one's: absent, matching and changed, for each of the five functions it
// replaces. Each attempt runs the third file's SQL text on its own in a transaction that is always rolled back, and says
// what it did and what the five functions and the new objects are afterwards (after a refusal, read behind a savepoint, so
// a half-done replacement would show).
describe('the third file guard: absent, matching and changed, for each function it replaces', () => {
  let t: Fixture;
  const notices: string[] = [];
  const text = () => source(selfRemoval);
  const differsFor = (signature: string) =>
    `Problem report prerequisite function differs: ${signature.split('(')[0]}`;
  const secondFileDiffers =
    'Problem report prerequisite file differs: 0002_word_removal_bounds.sql';
  const recordBoth = async (
    db: Db,
    first: string = firstFileHash,
    second: string = boundsFileHash,
  ) => {
    await recordFirstFile(db, first);
    await db.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [bounds, second]);
  };
  const objects = async (db: Db) =>
    (
      await db.query(
        `SELECT to_regprocedure('${ownWords}') IS NOT NULL AS function,
          to_regclass('customer_private.problem_report_self_removal') IS NOT NULL AS "table",
          to_regprocedure('customer_private.problem_report_self_removal_check()') IS NOT NULL AS trigger_function`,
      )
    ).rows[0] as { function: boolean; table: boolean; trigger_function: boolean };
  const attempt = async (
    prepare: (db: Db) => Promise<void>,
    probe?: (db: Db) => Promise<boolean>,
  ) => {
    const db = await t.owner.connect();
    notices.length = 0;
    db.on('notice', (notice) => notices.push(notice.message ?? ''));
    try {
      await db.query('BEGIN');
      await prepare(db);
      await db.query('SAVEPOINT guarded');
      let error: string | undefined;
      try {
        await db.query(text());
      } catch (caught) {
        error = (caught as Error).message;
        await db.query('ROLLBACK TO SAVEPOINT guarded');
      }
      const hashes: Record<string, string | undefined> = {};
      for (const entry of replacedBySelfRemoval)
        hashes[entry.signature] = await bodyHashIn(db, entry.signature);
      return {
        error,
        hashes,
        created: await objects(db),
        probed: error === undefined && probe ? await probe(db) : undefined,
      };
    } finally {
      await db.query('ROLLBACK');
      db.removeAllListeners('notice');
      db.release();
    }
  };
  const nothingCreated = { function: false, table: false, trigger_function: false };

  beforeAll(async () => {
    t = await fixture('corridra_upgrade_third');
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('ABSENT: the first file is not applied', () => {
    test('skips with a notice, raises no error and creates nothing, with no registry or an empty one', async () => {
      const bare = await attempt(async () => undefined);
      expect(bare.error).toBeUndefined();
      expect(notices).toEqual([
        'Problem report self-removal skipped: 0001_problem_reports.sql is not applied',
      ]);
      expect(bare.created).toEqual(nothingCreated);
      for (const entry of replacedBySelfRemoval)
        expect(bare.hashes[entry.signature]).toBeUndefined();
      const withRegistry = await attempt(async (db) => {
        for (const statement of registrySql) await db.query(statement);
      });
      expect(withRegistry.error).toBeUndefined();
      expect(notices).toHaveLength(1);
      expect(withRegistry.created).toEqual(nothingCreated);
      for (const entry of replacedBySelfRemoval)
        expect(await liveBodyHash(t, entry.signature)).toBeUndefined();
      expect(
        (await t.owner.query(`SELECT to_regclass('${schema}.applied') IS NOT NULL AS present`))
          .rows[0].present,
      ).toBe(false);
    });

    test('a registry that records both files while the functions are missing is not absent: it is refused', async () => {
      const lost = await attempt((db) => recordBoth(db));
      expect(lost.error).toBe(differsFor(removeWords));
      expect(lost.created).toEqual(nothingCreated);
    });

    test('a new table or function with nothing else is not absent: it is refused, and nothing is created', async () => {
      // the schemas are not there before the prerequisites, so each attempt makes its own (undone with the attempt)
      const table = await attempt(async (db) => {
        await db.query('CREATE SCHEMA customer_private');
        await db.query('CREATE TABLE customer_private.problem_report_self_removal(id int)');
      });
      expect(table.error).toBe(differsFor(removeWords));
      const fn = await attempt(async (db) => {
        await db.query('CREATE SCHEMA customer');
        await db.query(
          `CREATE FUNCTION ${ownWords.replace('(uuid)', '(command uuid)')} RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb'`,
        );
      });
      expect(fn.error).toBe(differsFor(removeWords));
    });
  });

  describe('with the prerequisites applied', () => {
    let third: Awaited<ReturnType<typeof attempt>>;

    beforeAll(async () => {
      await migrateCustomerRealUse(t.owner);
      await migrateCustomerAccountLifecycle(t.owner);
      await t.owner.query(source(file));
    });

    test('CHANGED: a database with the first file alone, where the word removal is still its first form, is refused and nothing is created', async () => {
      expect(await liveBodyHash(t)).toBe(firstBodyHash);
      for (const recorded of [false, true]) {
        const outcome = await attempt(async (db) => {
          if (recorded) await recordFirstFile(db);
        });
        expect(outcome.error).toBe(differsFor(removeWords));
        expect(outcome.created).toEqual(nothingCreated);
        expect(outcome.hashes[removeWords]).toBe(firstBodyHash);
      }
    });

    test('the second file created the forms the guard fingerprints, read live', async () => {
      await t.owner.query(source(bounds));
      expect(sha256(source(file))).toBe(firstFileHash);
      expect(sha256(source(bounds))).toBe(boundsFileHash);
      for (const entry of replacedBySelfRemoval) {
        expect(await liveBodyHash(t, entry.signature), entry.signature).toBe(entry.hash);
        expect(
          (
            await t.owner.query(
              `SELECT prosecdef,provolatile,proconfig,proargtypes::text AS args FROM pg_proc WHERE oid=to_regprocedure('${entry.signature}')`,
            )
          ).rows[0],
          entry.signature,
        ).toEqual({
          prosecdef: true,
          provolatile: 'v',
          proconfig: ['search_path=pg_catalog'],
          args: entry.args,
        });
      }
      third = await attempt(async () => undefined);
      expect(third.error).toBeUndefined();
    });

    const changes = (entry: (typeof replacedBySelfRemoval)[number]) =>
      [
        [
          'a changed body',
          replaceBody(
            `${entry.signature.split('(')[0]}(${entry.params})`,
            entry.returns,
            entry.language,
            entry.returns === 'trigger'
              ? 'BEGIN RETURN NULL; END'
              : "BEGIN RETURN '{}'::jsonb; END",
          ),
        ],
        ['a changed security setting', `ALTER FUNCTION ${entry.signature} SECURITY INVOKER`],
        ['a changed volatility', `ALTER FUNCTION ${entry.signature} STABLE`],
        [
          'a changed search path',
          `ALTER FUNCTION ${entry.signature} SET search_path=pg_catalog,public`,
        ],
        ['a removed search path', `ALTER FUNCTION ${entry.signature} RESET search_path`],
        [
          'a missing function while the others are there',
          `ALTER FUNCTION ${entry.signature} RENAME TO elsewhere`,
        ],
      ] as const;
    const changed = replacedBySelfRemoval.flatMap((entry) =>
      changes(entry).map(([change, statement]) => ({ ...entry, change, statement })),
    );

    test.each(changed)(
      '$name function: CHANGED by $change refuses, with the earlier files recorded or not, and replaces none of the five',
      async ({ statement, signature, change }) => {
        for (const recorded of [false, true]) {
          const outcome = await attempt(async (db) => {
            if (recorded) await recordBoth(db);
            await db.query(statement);
          });
          expect(outcome.error, change).toBe(differsFor(signature));
          expect(outcome.created).toEqual(nothingCreated);
          for (const entry of replacedBySelfRemoval) {
            if (entry.signature === signature) {
              // the changed one is not the third file's either (a renamed one is not there at all)
              if (!change.includes('missing'))
                expect(outcome.hashes[signature]).not.toBe(third.hashes[signature]);
            } else expect(outcome.hashes[entry.signature]).toBe(entry.hash);
          }
        }
        for (const entry of replacedBySelfRemoval)
          expect(await liveBodyHash(t, entry.signature)).toBe(entry.hash);
      },
    );

    test('CHANGED: a registry row of the first or second file with another hash or none refuses, and creates and replaces nothing', async () => {
      const cases: [string, (db: Db) => Promise<void>, string][] = [
        ['the first file with another hash', (db) => recordBoth(db, 'f'.repeat(64)), fileDiffers],
        [
          'the second file with another hash',
          (db) => recordBoth(db, firstFileHash, 'f'.repeat(64)),
          secondFileDiffers,
        ],
        [
          'no row for the first file',
          async (db) => {
            for (const statement of registrySql) await db.query(statement);
            await db.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
              bounds,
              boundsFileHash,
            ]);
          },
          fileDiffers,
        ],
        ['no row for the second file', (db) => recordFirstFile(db), secondFileDiffers],
        [
          'no rows at all in a registry that exists',
          async (db) => {
            for (const statement of registrySql) await db.query(statement);
          },
          fileDiffers,
        ],
      ];
      for (const [name, prepare, message] of cases) {
        const outcome = await attempt(prepare);
        expect(outcome.error, name).toBe(message);
        expect(outcome.created, name).toEqual(nothingCreated);
        for (const entry of replacedBySelfRemoval)
          expect(outcome.hashes[entry.signature], name).toBe(entry.hash);
      }
    });

    test('CHANGED: the new function or the new table already there refuses, and nothing is replaced', async () => {
      const fn = await attempt(async (db) => {
        await db.query(
          `CREATE FUNCTION ${ownWords.replace('(uuid)', '(command uuid)')} RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb'`,
        );
      });
      expect(fn.error).toBe(
        'Problem report self-removal already exists: customer.problem_report_remove_own_words',
      );
      const table = await attempt(async (db) => {
        await db.query('CREATE TABLE customer_private.problem_report_self_removal(id int)');
      });
      expect(table.error).toBe(
        'Problem report self-removal already exists: customer_private.problem_report_self_removal',
      );
      for (const outcome of [fn, table])
        for (const entry of replacedBySelfRemoval)
          expect(outcome.hashes[entry.signature]).toBe(entry.hash);
    });

    test('a statement that fails half way leaves nothing behind: the table made before the failure is rolled back with the rest', async () => {
      // the index name is taken, so the second statement fails after the table was created
      const outcome = await attempt(async (db) => {
        await db.query('CREATE TABLE customer_private.problem_report_self_removal_command(id int)');
      });
      expect(outcome.error).toContain('problem_report_self_removal_command');
      expect(outcome.error).toContain('already exists');
      expect(outcome.created).toEqual(nothingCreated);
      for (const entry of replacedBySelfRemoval)
        expect(outcome.hashes[entry.signature]).toBe(entry.hash);
    });

    test.each(replacedBySelfRemoval)(
      '$name function: EXACT MATCH replaces it, with the registry absent or recording both files, and it now names the self-removal table',
      async ({ signature, hash }) => {
        const named = async (db: Db) =>
          (
            (await db.query(`SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('${signature}')`))
              .rows[0]!.prosrc as string
          ).includes('problem_report_self_removal');
        const unregistered = await attempt(async () => undefined, named);
        expect(unregistered.error).toBeUndefined();
        expect(unregistered.probed).toBe(true);
        const registered = await attempt((db) => recordBoth(db), named);
        expect(registered.error).toBeUndefined();
        expect(registered.probed).toBe(true);
        expect(notices).toEqual([]);
        expect(registered.hashes).toEqual(unregistered.hashes);
        expect(unregistered.hashes[signature]).not.toBe(hash);
        expect(unregistered.created).toEqual({
          function: true,
          table: true,
          trigger_function: true,
        });
        // and the attempt was undone
        expect(await liveBodyHash(t, signature)).toBe(hash);
        expect((await objects(t.owner)).table).toBe(false);
      },
    );

    test('committed, the third file leaves security, volatility, search path and grants as they were, gives the runtime the new function alone, and a second run is refused', async () => {
      await t.owner.query(text());
      const state = async (signature: string) =>
        (
          await t.owner.query(
            `SELECT prosecdef,provolatile,proconfig,proargtypes::text AS args,
              has_function_privilege('corridra_runtime',oid,'EXECUTE') AS runtime,
              has_function_privilege('corridra_auth',oid,'EXECUTE') AS auth,
              has_function_privilege('public',oid,'EXECUTE') AS public
             FROM pg_proc WHERE oid=to_regprocedure('${signature}')`,
          )
        ).rows[0];
      for (const entry of replacedBySelfRemoval)
        expect(await state(entry.signature), entry.signature).toEqual({
          prosecdef: true,
          provolatile: 'v',
          proconfig: ['search_path=pg_catalog'],
          args: entry.args,
          runtime: entry.signature !== guardFunction,
          auth: false,
          public: false,
        });
      expect(await state(ownWords)).toEqual({
        prosecdef: true,
        provolatile: 'v',
        proconfig: ['search_path=pg_catalog'],
        args: '2950',
        runtime: true,
        auth: false,
        public: false,
      });
      for (const entry of replacedBySelfRemoval)
        expect(await liveBodyHash(t, entry.signature)).toBe(third.hashes[entry.signature]);
      const again = await attempt(async () => undefined);
      expect(again.error).toBe(differsFor(removeWords));
    });
  });
});

// The upgrade of a database that has the first two files and their registry rows (production after install 42835562806):
// the migrator applies only the third file.
describe('upgrading a database that has the first two files through the migrator', () => {
  let t: Fixture;
  let h: ReturnType<typeof harness>;
  const storedTables = [
    'customer_private.problem_report',
    'customer_private.problem_report_words',
    'customer_private.problem_report_status_event',
    'customer_private.problem_report_erasure',
  ];
  const state = async () =>
    (
      await t.owner.query(
        `SELECT p.oid::regprocedure::text AS signature,p.prosecdef,p.provolatile,p.proconfig,
          has_function_privilege('corridra_runtime',p.oid,'EXECUTE') AS runtime,
          has_function_privilege('corridra_auth',p.oid,'EXECUTE') AS auth,
          has_function_privilege('public',p.oid,'EXECUTE') AS public,
          encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS hash
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname IN ('app','customer','customer_private') AND (p.proname LIKE 'problem_report%' OR p.proname='staff_problem_actor')
         ORDER BY 1`,
      )
    ).rows as { signature: string; hash: string }[];
  const filenodes = async () =>
    (
      await t.owner.query(
        `SELECT c.relname,c.relfilenode::text AS filenode,
          (SELECT count(*)::int FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='c' AND NOT k.convalidated) AS unvalidated
         FROM pg_class c WHERE c.oid=ANY($1::regclass[]) ORDER BY c.relname`,
        [storedTables],
      )
    ).rows;
  const registry = async () =>
    (await t.owner.query(`SELECT name,sha256,applied_at FROM ${schema}.applied ORDER BY name`))
      .rows as { name: string; sha256: string; applied_at: Date }[];
  const personRow = (reference: string) =>
    h
      .sql<{ r: Row }>('upa', 'SELECT customer.problem_report_get($1) AS r', [reference])
      .then((row) => row.r);
  const staffAs = (statement: string, params: unknown[]) =>
    rawContext(t.runtime, t.users.owner!.ctx, statement, params).then((result) => result.rows[0]);
  const references: string[] = [];
  let before: { signature: string; hash: string }[];
  let stored: Awaited<ReturnType<typeof filenodes>>;
  let first: Awaited<ReturnType<typeof registry>>;

  beforeAll(async () => {
    t = await fixture('corridra_upgrade_third');
    await migrateCustomerRealUse(t.owner);
    await migrateCustomerAccountLifecycle(t.owner);
    await t.owner.query(source(file));
    await t.owner.query(source(bounds));
    for (const statement of registrySql) await t.owner.query(statement);
    for (const name of [file, bounds])
      await t.owner.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
        name,
        sha256(source(name)),
      ]);
    h = harness(t, 'prup3');
    await h.admit(['upa']);
    // no workspace: a person the staff erasure path cannot reach
    for (const detail of ['first words of upa', 'second words of upa'])
      references.push(
        (
          await h.sql<{ r: Row }>('upa', 'SELECT customer.problem_report_command($1,$2) AS r', [
            randomUUID(),
            JSON.stringify({
              category: 'did_not_work',
              pageKind: 'this_page',
              page: '/account/x',
              detail,
            }),
          ])
        ).r.reference as string,
      );
    const id = (
      await t.owner.query('SELECT id FROM customer_private.problem_report WHERE reference=$1', [
        references[0],
      ])
    ).rows[0].id as string;
    await staffAs('SELECT customer.problem_report_transition($1,$2,$3,$4,$5) AS r', [
      randomUUID(),
      id,
      'received',
      'in_review',
      'We are reading what you wrote.',
    ]);
    before = await state();
    stored = await filenodes();
    first = await registry();
  });
  afterAll(async () => {
    await t?.close();
  });

  test('is in the state the guard expects before the migrator runs', async () => {
    expect(first.map((row) => row.name)).toEqual([file, bounds]);
    expect(before.find((row) => row.signature === removeWords)?.hash).toBe(boundsBodyHash);
    expect(
      (
        await t.owner.query(
          `SELECT to_regclass('customer_private.problem_report_self_removal') IS NOT NULL AS made`,
        )
      ).rows[0].made,
    ).toBe(false);
  });

  test('applies only the third file, keeps every grant, security and search path, and leaves the first two rows as they were', async () => {
    await migrateCustomerProblemReports(t.owner);
    const rows = await registry();
    expect(rows.map((row) => row.name)).toEqual([file, bounds, selfRemoval]);
    expect(rows.map((row) => row.sha256)).toEqual([
      sha256(source(file)),
      sha256(source(bounds)),
      sha256(source(selfRemoval)),
    ]);
    expect(rows.slice(0, 2)).toEqual(first);
    const after = await state();
    const key = (row: Record<string, unknown>) => JSON.stringify({ ...row, hash: undefined });
    const was = new Map(before.map((row) => [row.signature, row]));
    const added = after.filter((row) => !was.has(row.signature));
    expect(added.map((row) => row.signature).sort()).toEqual(
      [ownWords, 'customer_private.problem_report_self_removal_check()'].sort(),
    );
    const replaced: string[] = [];
    for (const row of after.filter((entry) => was.has(entry.signature))) {
      // security, volatility, search path and grants are exactly as they were
      expect(key(row), row.signature).toBe(key(was.get(row.signature)!));
      if (row.hash !== was.get(row.signature)!.hash) replaced.push(row.signature);
    }
    expect(replaced.sort()).toEqual(replacedBySelfRemoval.map((entry) => entry.signature).sort());
  });

  test('older rows still read the same, no stored table was rewritten, and a second run changes nothing', async () => {
    expect(await filenodes()).toEqual(stored);
    for (const row of await filenodes()) expect(row.unvalidated).toBe(0);
    for (const [index, detail] of ['first words of upa', 'second words of upa'].entries())
      expect((await personRow(references[index]!)).words).toMatchObject({ detail });
    const reviewed = (await personRow(references[0]!)).history as Row[];
    expect(reviewed.map((row) => [row.state, row.note])).toEqual([
      ['received', null],
      ['in_review', 'We are reading what you wrote.'],
    ]);
    const queue = (await staffAs('SELECT customer.problem_report_queue(NULL,100,NULL) AS r', []))
      .r as {
      items: Row[];
    };
    for (const reference of references)
      expect(queue.items.find((item) => item.reference === reference)).toMatchObject({
        wordsRemoved: false,
      });
    const once = await registry();
    const hashes = await state();
    await migrateCustomerProblemReports(t.owner);
    expect(await registry()).toEqual(once);
    expect(await state()).toEqual(hashes);
  });

  test('the new function works on the older reports, and every read says the words were removed', async () => {
    const done = (
      await h.sql<{ r: Row }>('upa', 'SELECT customer.problem_report_remove_own_words($1) AS r', [
        randomUUID(),
      ])
    ).r;
    expect(done).toEqual({ removed: 2, changed: true });
    for (const reference of references)
      expect((await personRow(reference)).words).toEqual({ removed: true });
    const list = (
      await h.sql<{ r: Row[] }>('upa', 'SELECT customer.problem_report_list(NULL,25) AS r')
    ).r;
    expect(list.map((row) => row.wordsRemoved)).toEqual([true, true]);
    const queue = (await staffAs('SELECT customer.problem_report_queue(NULL,100,NULL) AS r', []))
      .r as {
      items: Row[];
    };
    for (const reference of references)
      expect(queue.items.find((item) => item.reference === reference)).toMatchObject({
        wordsRemoved: true,
        page: null,
        detail: null,
        pageKind: null,
      });
    // and the history, reference, category and filing time are as they were
    expect(((await personRow(references[0]!)).history as Row[]).map((row) => row.note)).toEqual([
      null,
      'We are reading what you wrote.',
    ]);
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
