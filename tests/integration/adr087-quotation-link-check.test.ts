import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fixture, rawContext } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateQuotationLinkCheck } from '../../packages/db/src/quotation-link-check-migrate';
import {
  forgetQuotationLinkCheck,
  quotationLinkCheckInstalled,
  quotationLinkedClaimSql,
} from '../../packages/domain/src/commercial-missions';

// ADR-087 quotation link check on a real PostgreSQL database. The tests run in order: the module refuses before the customer
// real-use modules, the link check works without it (today's row-security check), then the module installs once, its function
// is exactly the boolean the ADR asks for, and its rollback text drops it and lets the check fall back. What a staff viewer
// reads before, with and after the module is proven on a populated tenant in commercial-missions.test.ts.
let f: Awaited<ReturnType<typeof fixture>>;
const fn = 'app.quotation_linked_claim(uuid,uuid)';
const moduleFile = (name: string) =>
  readFileSync(resolve('packages/db/quotation-link-check-migrations', name), 'utf8');
const linkCheck = (claim: string, installed: boolean, tenant = f.tenantA) =>
  rawContext(
    f.runtime,
    f.users.viewer!.ctx,
    `SELECT ${quotationLinkedClaimSql('$1::uuid', '$2::uuid', installed)} AS v`,
    [tenant, claim],
  ).then((r) => r.rows);
const present = async () =>
  (
    await f.owner.query(
      `SELECT to_regprocedure('${fn}') IS NOT NULL AS fn,
        to_regclass('app.mission_quotation_tenant_claim_link') IS NOT NULL AS claim_index,
        to_regclass('app.mission_quotation_tenant_source_link') IS NOT NULL AS source_index,
        to_regclass('quotation_link_check_migrations.applied') IS NOT NULL AS registry`,
    )
  ).rows[0];

beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.close();
});

describe('before the module', () => {
  test('the install refuses without the customer real-use modules and leaves nothing behind', async () => {
    await expect(migrateQuotationLinkCheck(f.owner)).rejects.toThrow(
      'The customer real-use modules are not installed, so quotation link check was not installed. Run the real-use install first.',
    );
    expect(await present()).toEqual({
      fn: false,
      claim_index: false,
      source_index: false,
      registry: false,
    });
  });
  test('the link check is the row-security check alone and answers false for an unlinked claim', async () => {
    forgetQuotationLinkCheck();
    expect(await quotationLinkCheckInstalled(f.owner)).toBe(false);
    expect(quotationLinkedClaimSql('a', 'b', false)).not.toContain('quotation_linked_claim');
    expect(await linkCheck(randomUUID(), false)).toEqual([{ v: false }]);
    expect(await linkCheck(randomUUID(), false, f.tenantB)).toEqual([{ v: false }]);
  });
});

describe('the module installed', () => {
  test('installs its one file once, after the real-use modules, and a second run applies nothing', async () => {
    await migrateCustomerRealUse(f.owner);
    expect(await migrateQuotationLinkCheck(f.owner)).toEqual({
      applied: ['0001_quotation_linked_claim.sql'],
      waiting: [],
    });
    expect(await migrateQuotationLinkCheck(f.owner)).toEqual({ applied: [], waiting: [] });
    // The process keeps its earlier answer for a minute, then asks again and sees the function.
    expect(await quotationLinkCheckInstalled(f.owner)).toBe(false);
    expect(await quotationLinkCheckInstalled(f.owner, Date.now() + 60_000)).toBe(true);
    forgetQuotationLinkCheck();
    expect(await quotationLinkCheckInstalled(f.owner)).toBe(true);
    expect(await present()).toEqual({
      fn: true,
      claim_index: true,
      source_index: true,
      registry: true,
    });
  });
  test('the function is SECURITY DEFINER, STABLE, boolean, with a fixed search_path, executed by the runtime role only', async () => {
    const r = await f.owner.query(
      `SELECT p.prosecdef,p.provolatile,p.proconfig,p.prorettype::regtype::text AS ret,(SELECT lanname FROM pg_language WHERE oid=p.prolang) AS lang,
        pg_get_userbyid(p.proowner)=current_user AS owned,
        has_function_privilege('public',p.oid,'EXECUTE') AS public_exec,
        has_function_privilege('corridra_runtime',p.oid,'EXECUTE') AS runtime_exec,
        has_function_privilege('corridra_auth',p.oid,'EXECUTE') AS auth_exec,
        EXISTS(SELECT FROM aclexplode(p.proacl) a WHERE a.grantee=0) AS public_acl
       FROM pg_proc p WHERE p.oid=to_regprocedure('${fn}')`,
    );
    expect(r.rows).toEqual([
      {
        prosecdef: true,
        provolatile: 's',
        proconfig: ['search_path=pg_catalog, app'],
        ret: 'boolean',
        lang: 'sql',
        owned: true,
        public_exec: false,
        runtime_exec: true,
        auth_exec: false,
        public_acl: false,
      },
    ]);
    // Every name in the body is schema-qualified or a parameter, so the fixed path is the only path it uses.
    const body = (
      await f.owner.query(`SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('${fn}')`)
    ).rows[0].prosrc as string;
    expect(body).toContain('app.claim');
    expect(body).toContain('app.mission_quotation');
    expect(body).toContain("pg_catalog.current_setting('corridra.tenant_id', true)");
  });
  test('it answers one plain boolean, false for another tenant, for no tenant setting and for an unknown claim', async () => {
    const ask = (tenant: string, claim: string) =>
      rawContext(f.runtime, f.users.viewer!.ctx, `SELECT app.quotation_linked_claim($1,$2) AS v`, [
        tenant,
        claim,
      ]).then((r) => r.rows);
    expect(await ask(f.tenantA, randomUUID())).toEqual([{ v: false }]);
    expect(await ask(f.tenantB, randomUUID())).toEqual([{ v: false }]);
    expect(
      (
        await f.owner.query(`SELECT app.quotation_linked_claim($1,$2) AS v`, [
          f.tenantA,
          randomUUID(),
        ])
      ).rows,
    ).toEqual([{ v: false }]);
    // The link check reaches the function and still answers false, with no error, for an unlinked claim in either tenant.
    expect(await linkCheck(randomUUID(), true)).toEqual([{ v: false }]);
    expect(await linkCheck(randomUUID(), true, f.tenantB)).toEqual([{ v: false }]);
  });
  test('the proof refuses an owner held to row security, and either table forcing row security', async () => {
    const source = moduleFile('0001_quotation_linked_claim.sql');
    const proof = source.slice(source.indexOf('DO $proof$'), source.lastIndexOf('$proof$;') + 8);
    expect(proof).toContain('relforcerowsecurity');
    const refusal =
      'the function owner must own app.claim and app.mission_quotation or bypass row security, and neither may force row security';
    const db = await f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query(proof);
      await db.query('SAVEPOINT owner');
      // An owner that owns neither table and does not bypass row security.
      await db.query(`ALTER FUNCTION ${fn} OWNER TO corridra_auth`);
      expect(
        (
          await db.query(
            "SELECT rolbypassrls OR rolsuper AS bypass FROM pg_roles WHERE rolname='corridra_auth'",
          )
        ).rows,
      ).toEqual([{ bypass: false }]);
      await expect(db.query(proof)).rejects.toThrow(refusal);
      await db.query('ROLLBACK TO SAVEPOINT owner');
      for (const table of ['app.claim', 'app.mission_quotation']) {
        await db.query('SAVEPOINT force');
        await db.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
        await db.query('SAVEPOINT proof');
        await expect(db.query(proof)).rejects.toThrow(refusal);
        await db.query('ROLLBACK TO SAVEPOINT proof');
        // The whole file refuses the same way, so an install on such a database changes nothing.
        await db.query(moduleFile('rollback/0001_drop_quotation_linked_claim.sql'));
        await expect(db.query(source)).rejects.toThrow(refusal);
        await db.query('ROLLBACK TO SAVEPOINT force');
      }
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
    expect(await present()).toEqual({
      fn: true,
      claim_index: true,
      source_index: true,
      registry: true,
    });
  });
  test('a stale "installed" answer after a rollback fails the read with an error, never a fallback', async () => {
    forgetQuotationLinkCheck();
    expect(await quotationLinkCheckInstalled(f.owner)).toBe(true);
    const db = await f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query(moduleFile('rollback/0001_drop_quotation_linked_claim.sql'));
      // The cached answer is still true: the expression names the dropped function and the statement fails.
      expect(await quotationLinkCheckInstalled(db)).toBe(true);
      await expect(
        db.query(`SELECT ${quotationLinkedClaimSql('$1::uuid', '$2::uuid', true)} AS v`, [
          f.tenantA,
          randomUUID(),
        ]),
      ).rejects.toThrow(/function app\.quotation_linked_claim\(uuid, uuid\) does not exist/);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });
  test('each lookup the function makes has its own module index, and the planner uses an index for it', async () => {
    const indexes = await f.owner.query(
      `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='app' AND indexname IN ('mission_quotation_tenant_claim_link','mission_quotation_tenant_source_link') ORDER BY indexname`,
    );
    expect(indexes.rows).toEqual([
      {
        indexname: 'mission_quotation_tenant_claim_link',
        indexdef:
          'CREATE INDEX mission_quotation_tenant_claim_link ON app.mission_quotation USING btree (tenant_id, claim_id)',
      },
      {
        indexname: 'mission_quotation_tenant_source_link',
        indexdef:
          'CREATE INDEX mission_quotation_tenant_source_link ON app.mission_quotation USING btree (tenant_id, source_id)',
      },
    ]);
    const db = await f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query('SET LOCAL enable_seqscan=off');
      for (const column of ['claim_id', 'source_id']) {
        const plan = (
          await db.query(
            `EXPLAIN SELECT EXISTS(SELECT FROM app.mission_quotation q WHERE q.tenant_id=$1 AND q.${column}=$2)`,
            [f.tenantA, randomUUID()],
          )
        ).rows
          .map((row) => row['QUERY PLAN'])
          .join('\n');
        expect(plan).toMatch(
          /Index (Only )?Scan using mission_quotation_tenant_(claim|source)_link/,
        );
        expect(plan).not.toContain('Seq Scan');
      }
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });
  test('the rollback text drops the function and both indexes, the check falls back, and the file applies again', async () => {
    const db = await f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query(moduleFile('rollback/0001_drop_quotation_linked_claim.sql'));
      const gone = await db.query(
        `SELECT to_regprocedure('${fn}') IS NULL AS fn,
          to_regclass('app.mission_quotation_tenant_claim_link') IS NULL AS claim_index,
          to_regclass('app.mission_quotation_tenant_source_link') IS NULL AS source_index`,
      );
      expect(gone.rows).toEqual([{ fn: true, claim_index: true, source_index: true }]);
      // Without the function the same expression is the row-security check alone and still parses and runs.
      const fallback = await db.query(
        `SELECT ${quotationLinkedClaimSql('$1::uuid', '$2::uuid', false)} AS v`,
        [f.tenantA, randomUUID()],
      );
      expect(fallback.rows).toEqual([{ v: false }]);
      // Reinstalling after a rollback is the same file again, and it applies cleanly.
      await db.query(moduleFile('0001_quotation_linked_claim.sql'));
      expect((await db.query(`SELECT to_regprocedure('${fn}') IS NOT NULL AS fn`)).rows).toEqual([
        { fn: true },
      ]);
      // A second copy of 0001 over an installed function refuses rather than replace it.
      await db.query('SAVEPOINT twice');
      await expect(db.query(moduleFile('0001_quotation_linked_claim.sql'))).rejects.toThrow(
        'app.quotation_linked_claim already exists outside this module',
      );
      await db.query('ROLLBACK TO SAVEPOINT twice');
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
    expect(await present()).toEqual({
      fn: true,
      claim_index: true,
      source_index: true,
      registry: true,
    });
  });
  test('the rollback folder is never read by the migrator, and the module writes no customer row', () => {
    // Same filter as viewer-module-run.ts: only the .sql files directly in the module folder.
    const top = readdirSync(resolve('packages/db/quotation-link-check-migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(top).toEqual(['0001_quotation_linked_claim.sql']);
    for (const name of [
      '0001_quotation_linked_claim.sql',
      'rollback/0001_drop_quotation_linked_claim.sql',
    ])
      expect(moduleFile(name)).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
  });
});
