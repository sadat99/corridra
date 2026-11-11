import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  FILE_KEYS,
  FUNCTION_KEYS,
  NEW_FILES,
  fileFingerprints,
  fileHash,
  fileSignatures,
  fileSql,
  functionState,
  hideNewFiles,
  liveFingerprints,
  stripComments,
  type FileKey,
} from './removed-member-support';
import { fixture } from './support';
import type { PoolClient } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';

// Removed members, the guard of every new file (owner decision, 11 Nov 2026: "No, remove access (Recommended)"). Each file
// compares every function it replaces with an owner-run fingerprint (stored body, settings, security mode, volatility,
// argument types, defaults and EXECUTE grantees; never pg_get_functiondef, because the production PostgreSQL major version is
// not observed). Three states: ABSENT changes and creates nothing, CHANGED refuses and replaces none, MATCHING replaces all
// and leaves owner, settings and grants as they were. The database is built at the exact state before the seven files (they
// are hidden from the migrators), and every case runs in a transaction that is rolled back. Fails on main.
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const { removedFileHidden } = await import('./removed-member-hide');
    return names.filter((n) => !removedFileHidden(String(path), String(n)));
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

let f: Awaited<ReturnType<typeof fixture>>;
const NEW_HELPERS = new Set([
  'customer_private.workspace_member_current',
  'customer_private.workspace_ids_current',
  'customer_private.request_author_current',
  'customer_private.link_workspace_current',
]);

// Runs the work in a transaction on its own connection and always rolls it back, so the pre-state is never lost.
async function rolledBack<T>(work: (db: PoolClient, notices: string[]) => Promise<T>): Promise<T> {
  const db = (await f.owner.connect()) as unknown as PoolClient;
  const notices: string[] = [];
  db.on('notice', (n) => notices.push(String(n.message)));
  try {
    await db.query('BEGIN');
    return await work(db, notices);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}
// The helpers come with the first file; every other file needs them.
const withHelpers = async (db: PoolClient, key: FileKey) => {
  if (key !== 'customer') await db.query(fileSql('customer'));
};
const states = async (db: PoolClient, signatures: string[]) => {
  const out: Record<string, unknown> = {};
  for (const signature of signatures) {
    const state = await db.query(
      `SELECT p.prosrc,p.proconfig,p.prosecdef,p.provolatile,p.proisstrict,p.proretset,p.proparallel,p.proleakproof,
        p.proargtypes::regtype[]::text AS argtypes,p.prorettype::regtype::text AS ret,l.lanname,p.proargnames,p.pronargdefaults,
        pg_get_expr(p.proargdefaults,0) AS defaults,p.proowner::regrole::text AS owner,p.proacl::text AS acl
       FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure($1)`,
      [signature],
    );
    out[signature] = state.rows[0] ?? null;
  }
  return out;
};
const without = (state: unknown) => {
  const copy = { ...(state as Record<string, unknown>) };
  delete copy.prosrc;
  return copy;
};
const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
const mutations: Record<string, (signature: string) => string> = {
  'its body': (s) =>
    `UPDATE pg_proc SET prosrc=prosrc||E'\\n -- changed by hand' WHERE oid=to_regprocedure('${s}')`,
  'its search path': (s) => `ALTER FUNCTION ${s} SET search_path=pg_catalog,public`,
  'its volatility': (s) => `ALTER FUNCTION ${s} IMMUTABLE`,
  'an extra grant to PUBLIC': (s) => `GRANT EXECUTE ON FUNCTION ${s} TO PUBLIC`,
};

beforeAll(async () => {
  // The exact state before the seven files, with every module at the file before its new one.
  hideNewFiles();
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCommercialReadiness(f.owner);
  await migrateCustomerRequestWithdrawal(f.owner);
  await migrateCustomerMoves(f.owner);
  await migrateCustomerMissionMail(f.owner);
  await migrateCustomerNotifications(f.owner);
  await migrateCustomerDecisionCards(f.owner);
}, 600000);
afterAll(async () => {
  await f?.close();
});

describe.each(FUNCTION_KEYS)('%s', (key) => {
  const file = NEW_FILES[key];
  const signatures = () => fileSignatures(key);

  test('the fingerprint block equals a freshly derived one, and the file replaces exactly the functions it lists', async () => {
    const live = await liveFingerprints(f.owner, key);
    expect(live).toEqual(
      fileFingerprints(key).map((r) => ({
        signature: r.signature,
        fingerprint: r.fingerprint,
        grantees: r.grantees,
      })),
    );
    const sql = stripComments(fileSql(key));
    const replaced = [...sql.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_.]+)\(/g)].map(
      (m) => m[1]!,
    );
    const listed = signatures().map((s) => s.split('(')[0]!);
    const created = replaced.filter((name) => !listed.includes(name));
    for (const name of created) expect(NEW_HELPERS.has(name), name).toBe(true);
    for (const name of listed) expect(replaced, name).toContain(name);
    // Never the catalogue text dump: it differs between PostgreSQL major versions.
    expect(sql).not.toMatch(/pg_get_functiondef/);
    // Additive only.
    // Outside the function bodies (which legitimately read and write tables): nothing is dropped, truncated, inserted, updated,
    // deleted or created as a table, and no table is altered.
    const topLevel = sql
      .replace(/\$(fn|q|p)\$[\s\S]*?\$\1\$/g, '')
      .replace(/\$\$[\s\S]*?\$\$/g, '');
    expect(topLevel).not.toMatch(
      /\b(DROP|TRUNCATE|DELETE|INSERT|UPDATE|ALTER TABLE|CREATE TABLE)\b/,
    );
  });

  test('MATCHING: every function is replaced; owner, settings, security mode, volatility, argument types and grants are unchanged', async () => {
    await rolledBack(async (db) => {
      await withHelpers(db, key);
      const before = await states(db, signatures());
      await db.query(fileSql(key));
      const after = await states(db, signatures());
      for (const signature of signatures()) {
        expect(before[signature], signature).not.toBeNull();
        expect(without(after[signature]), signature).toEqual(without(before[signature]));
        expect((after[signature] as { prosrc: string }).prosrc, signature).not.toBe(
          (before[signature] as { prosrc: string }).prosrc,
        );
      }
      // The new helpers are definers that no application login can call.
      if (key === 'customer' || key === 'realUse')
        for (const name of NEW_HELPERS) {
          const row = (
            await db.query(
              `SELECT p.prosecdef,p.proconfig::text AS config,has_function_privilege('corridra_runtime',p.oid,'EXECUTE') AS runtime,
                has_function_privilege('corridra_auth',p.oid,'EXECUTE') AS auth,has_function_privilege('public',p.oid,'EXECUTE') AS pub
               FROM pg_proc p WHERE p.pronamespace='customer_private'::regnamespace AND p.proname=$1`,
              [name.split('.')[1]],
            )
          ).rows[0];
          if (!row) continue;
          expect(row, name).toMatchObject({
            prosecdef: true,
            runtime: false,
            auth: false,
            pub: false,
          });
          expect(row.config).toContain('search_path=pg_catalog');
        }
    });
  });

  test('MATCHING: each new body differs from the body it replaces by a few lines only', async () => {
    await rolledBack(async (db) => {
      await withHelpers(db, key);
      const before = await states(db, signatures());
      await db.query(fileSql(key));
      const after = await states(db, signatures());
      for (const signature of signatures()) {
        const old = lines((before[signature] as { prosrc: string }).prosrc);
        const now = lines((after[signature] as { prosrc: string }).prosrc);
        const removed = old.filter((l) => !now.includes(l)).length;
        const added = now.filter((l) => !old.includes(l)).length;
        expect(removed, `${signature}: lines removed`).toBeLessThanOrEqual(12);
        expect(added, `${signature}: lines added`).toBeLessThanOrEqual(24);
        expect(added + removed, `${signature} changed`).toBeGreaterThan(0);
      }
    });
  });

  test('a second run over the new bodies is refused, because they no longer match the fingerprint (the migrator never repeats a file)', async () => {
    await rolledBack(async (db) => {
      await withHelpers(db, key);
      await db.query(fileSql(key));
      await db.query('SAVEPOINT again');
      await expect(db.query(fileSql(key))).rejects.toThrow(/prerequisite function differs/);
      await db.query('ROLLBACK TO again');
    });
  });

  if (key !== 'customer')
    test('needs customer migration 0004 first, and changes nothing without it', async () => {
      await rolledBack(async (db) => {
        const before = await states(db, signatures());
        await expect(db.query(fileSql(key))).rejects.toThrow(/needs customer migration 0004/);
        await db.query('ROLLBACK');
        await db.query('BEGIN');
        expect(await states(db, signatures())).toEqual(before);
      });
    });

  test('ABSENT: none of its functions exists and the registry has no row for the file before it: a notice, nothing changed or created', async () => {
    await rolledBack(async (db, notices) => {
      await withHelpers(db, key);
      for (const signature of signatures()) await db.query(`DROP FUNCTION ${signature}`);
      await db.query(`DELETE FROM ${file.registry}.applied WHERE name=$1`, [file.previous]);
      const helpersBefore = (
        await db.query(
          "SELECT proname FROM pg_proc WHERE pronamespace='customer_private'::regnamespace AND proname = ANY($1) ORDER BY 1",
          [[...NEW_HELPERS].map((n) => n.split('.')[1])],
        )
      ).rows;
      await db.query(fileSql(key));
      expect(notices.some((n) => /skipped/.test(n))).toBe(true);
      for (const signature of signatures())
        expect((await states(db, [signature]))[signature], signature).toBeNull();
      expect(
        (
          await db.query(
            "SELECT proname FROM pg_proc WHERE pronamespace='customer_private'::regnamespace AND proname = ANY($1) ORDER BY 1",
            [[...NEW_HELPERS].map((n) => n.split('.')[1])],
          )
        ).rows,
      ).toEqual(helpersBefore);
    });
  });

  describe.each(Object.keys(mutations))('CHANGED: %s', (what) => {
    test('is refused and no function of the file is replaced', async () => {
      await rolledBack(async (db) => {
        await withHelpers(db, key);
        const first = signatures()[0]!;
        await db.query(mutations[what]!(first));
        const before = await states(db, signatures());
        await db.query('SAVEPOINT guarded');
        await expect(db.query(fileSql(key))).rejects.toThrow(
          new RegExp(
            `prerequisite function differs: .*${first.split('(')[0]!.replace('.', '\\.')}`,
          ),
        );
        await db.query('ROLLBACK TO guarded');
        expect(await states(db, signatures())).toEqual(before);
      });
    });
  });

  test('CHANGED: a function that is missing while others exist is refused, and the file recorded before it must have its own hash', async () => {
    await rolledBack(async (db) => {
      await withHelpers(db, key);
      if (signatures().length > 1) {
        await db.query(`DROP FUNCTION ${signatures()[signatures().length - 1]}`);
        await db.query('SAVEPOINT partial');
        await expect(db.query(fileSql(key))).rejects.toThrow(/prerequisite function is missing/);
        await db.query('ROLLBACK TO partial');
        await db.query('SELECT 1');
      }
    });
    await rolledBack(async (db) => {
      await withHelpers(db, key);
      await db.query(`UPDATE ${file.registry}.applied SET sha256=repeat('0',64) WHERE name=$1`, [
        file.previous,
      ]);
      const before = await states(db, signatures());
      await db.query('SAVEPOINT recorded');
      await expect(db.query(fileSql(key))).rejects.toThrow(
        new RegExp(`prerequisite file differs: ${file.previous}`),
      );
      await db.query('ROLLBACK TO recorded');
      expect(await states(db, signatures())).toEqual(before);
    });
  });

  test('all functions missing while the registry still holds the file before it is a damaged state, not ABSENT', async () => {
    // The customer and withdrawal and move files list one or three functions; a file with one function that is dropped while
    // its registry row is still there is a damaged state, not an absent one.
    await rolledBack(async (db) => {
      await withHelpers(db, key);
      for (const signature of signatures()) await db.query(`DROP FUNCTION ${signature}`);
      await db.query('SAVEPOINT damaged');
      await expect(db.query(fileSql(key))).rejects.toThrow(/prerequisite function is missing/);
      await db.query('ROLLBACK TO damaged');
    });
  });
});

// The inbox file alters a row level security policy instead of replacing functions: its guard fingerprints the policy.
describe('inbox (the policy inbox_customer_read)', () => {
  const file = NEW_FILES.inbox;
  const policy = async (db: PoolClient) =>
    (
      await db.query(
        `SELECT p.polcmd::text AS cmd,p.polpermissive AS permissive,
          array_to_string(ARRAY(SELECT CASE r WHEN 0 THEN 'PUBLIC' ELSE r::regrole::text END FROM unnest(p.polroles) r ORDER BY 1),',') AS roles,
          pg_get_expr(p.polqual,p.polrelid) AS qual,pg_get_expr(p.polwithcheck,p.polrelid) AS withcheck
         FROM pg_policy p WHERE p.polrelid='app.inbox_notification'::regclass AND p.polname='inbox_customer_read'`,
      )
    ).rows[0] as
      | {
          cmd: string;
          permissive: boolean;
          roles: string;
          qual: string | null;
          withcheck: string | null;
        }
      | undefined;
  const others = async (db: PoolClient) =>
    (
      await db.query(
        `SELECT p.polname,p.polcmd::text AS cmd,pg_get_expr(p.polqual,p.polrelid) AS qual,pg_get_expr(p.polwithcheck,p.polrelid) AS withcheck,
          (SELECT relacl::text FROM pg_class WHERE oid=p.polrelid) AS acl
         FROM pg_policy p WHERE p.polrelid='app.inbox_notification'::regclass AND p.polname<>'inbox_customer_read' ORDER BY 1`,
      )
    ).rows;

  test('the fingerprint block equals the live one, the file only alters that policy, and the function it adds is for the reading role only', async () => {
    expect(await liveFingerprints(f.owner, 'inbox')).toEqual(
      fileFingerprints('inbox').map((r) => ({
        signature: r.signature,
        fingerprint: r.fingerprint,
        grantees: r.grantees,
      })),
    );
    expect(fileFingerprints('inbox')).toHaveLength(1);
    const sql = stripComments(fileSql('inbox'));
    expect(sql).not.toMatch(/pg_get_functiondef|pg_get_policydef/);
    expect([...sql.matchAll(/ALTER POLICY (\w+)/g)].map((m) => m[1])).toEqual([
      'inbox_customer_read',
    ]);
    expect(sql).not.toMatch(
      /\b(DROP|TRUNCATE|DELETE|INSERT|ALTER TABLE|CREATE TABLE|CREATE POLICY)\b/,
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION app.inbox_notice_visible(uuid,text,text,jsonb) FROM PUBLIC,corridra_auth',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION app.inbox_notice_visible(uuid,text,text,jsonb) TO corridra_runtime',
    );
  });

  test('MATCHING: only the expression changes (name, command, roles and kind stay), no other policy or grant moves, and the function is for the reader only', async () => {
    await rolledBack(async (db) => {
      await withHelpers(db, 'inbox');
      const before = await policy(db);
      const otherBefore = await others(db);
      const aclBefore = (
        await db.query(
          "SELECT relacl::text AS a FROM pg_class WHERE oid='app.inbox_notification'::regclass",
        )
      ).rows[0].a;
      await db.query(fileSql('inbox'));
      const after = await policy(db);
      expect(after).toMatchObject({
        cmd: before!.cmd,
        permissive: before!.permissive,
        roles: 'corridra_runtime',
        withcheck: null,
      });
      expect(after!.qual).toContain('inbox_notice_visible');
      expect(after!.qual).not.toBe(before!.qual);
      expect(await others(db)).toEqual(otherBefore);
      expect(
        (
          await db.query(
            "SELECT relacl::text AS a FROM pg_class WHERE oid='app.inbox_notification'::regclass",
          )
        ).rows[0].a,
      ).toBe(aclBefore);
      const grant = (
        await db.query(
          `SELECT has_function_privilege('corridra_runtime',p.oid,'EXECUTE') AS runtime,has_function_privilege('corridra_auth',p.oid,'EXECUTE') AS auth,
            has_function_privilege('public',p.oid,'EXECUTE') AS pub,p.prosecdef,p.proconfig::text AS config
           FROM pg_proc p WHERE p.oid='app.inbox_notice_visible(uuid,text,text,jsonb)'::regprocedure`,
        )
      ).rows[0];
      expect(grant).toMatchObject({ runtime: true, auth: false, pub: false, prosecdef: true });
      expect(grant.config).toContain('search_path=pg_catalog');
    });
  });

  test('ABSENT: no policy and no registry row for the file before it is a notice, and nothing is created', async () => {
    await rolledBack(async (db, notices) => {
      await withHelpers(db, 'inbox');
      await db.query('DROP POLICY inbox_customer_read ON app.inbox_notification');
      await db.query(fileSql('inbox'));
      expect(notices.some((n) => /skipped/.test(n))).toBe(true);
      expect(await policy(db)).toBeUndefined();
      expect(
        (
          await db.query(
            "SELECT to_regprocedure('app.inbox_notice_visible(uuid,text,text,jsonb)') AS f",
          )
        ).rows[0].f,
      ).toBeNull();
    });
  });

  test.each([
    [
      'its expression',
      "ALTER POLICY inbox_customer_read ON app.inbox_notification USING (recipient_kind='customer')",
    ],
    ['its roles', 'ALTER POLICY inbox_customer_read ON app.inbox_notification TO PUBLIC'],
  ])('CHANGED: %s is refused and nothing is altered', async (_what, change) => {
    await rolledBack(async (db) => {
      await withHelpers(db, 'inbox');
      await db.query(change);
      const before = await policy(db);
      await db.query('SAVEPOINT guarded');
      await expect(db.query(fileSql('inbox'))).rejects.toThrow(/prerequisite policy differs/);
      await db.query('ROLLBACK TO guarded');
      expect(await policy(db)).toEqual(before);
      expect(
        (
          await db.query(
            "SELECT to_regprocedure('app.inbox_notice_visible(uuid,text,text,jsonb)') AS f",
          )
        ).rows[0].f,
      ).toBeNull();
    });
  });

  test('CHANGED: a missing policy with the file before it recorded, a different recorded hash, and a missing helper are each refused', async () => {
    await rolledBack(async (db) => {
      await withHelpers(db, 'inbox');
      await db.query('DROP POLICY inbox_customer_read ON app.inbox_notification');
      await db.query(
        'INSERT INTO commercial_readiness_migrations.applied(name,sha256) VALUES($1,$2)',
        [file.previous, 'f'.repeat(64)],
      );
      await db.query('SAVEPOINT a');
      await expect(db.query(fileSql('inbox'))).rejects.toThrow(/prerequisite policy is missing/);
      await db.query('ROLLBACK TO a');
    });
    await rolledBack(async (db) => {
      await withHelpers(db, 'inbox');
      await db.query(
        'INSERT INTO commercial_readiness_migrations.applied(name,sha256) VALUES($1,$2)',
        [file.previous, 'f'.repeat(64)],
      );
      await db.query('SAVEPOINT b');
      await expect(db.query(fileSql('inbox'))).rejects.toThrow(/prerequisite file differs: 0011/);
      await db.query('ROLLBACK TO b');
    });
    await rolledBack(async (db) => {
      await expect(db.query(fileSql('inbox'))).rejects.toThrow(/needs customer migration 0004/);
    });
  });
});

describe('across the files', () => {
  test('there are exactly seven new files, each recorded by its own module migrator and none before it exists', async () => {
    expect(FILE_KEYS).toHaveLength(9);
    for (const key of FUNCTION_KEYS) {
      const names = (
        await f.owner.query(`SELECT name FROM ${NEW_FILES[key].registry}.applied ORDER BY name`)
      ).rows.map((r) => r.name as string);
      expect(names, key).not.toContain(NEW_FILES[key].name);
      expect(names, key).toContain(NEW_FILES[key].previous);
      expect(fileHash(key), key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('every function of a file is currently in the form the file expects (the same query an owner can run)', async () => {
    for (const key of FUNCTION_KEYS) {
      for (const signature of fileSignatures(key))
        expect(await functionState(f.owner, signature), signature).toBeTruthy();
    }
  });
});
