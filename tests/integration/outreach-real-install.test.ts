import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateOutreachReal } from '../../packages/db/src/outreach-real-migrate';

// ADR-090, the database side of the install. Three functions are replaced once, each hash-guarded against the definition
// it names, and one receipt check is widened. Everything else the module adds is new.
let f: Awaited<ReturnType<typeof commercialFixture>>;
const dir = 'packages/db/outreach-real-migrations';
const file = '0001_real_outreach.sql';
const replaced = [
  'app.guard_communication()',
  'app.communication_allowed(uuid,boolean)',
  'app.experience_outreach_rows_for(uuid,uuid[])',
];
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const definition = async (name: string) =>
  (await f.owner.query('SELECT pg_get_functiondef($1::regprocedure) d', [name])).rows[0]
    .d as string;
async function functionHashes() {
  const rows = (
    await f.owner.query(
      `SELECT p.oid::regprocedure::text AS name,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS hash
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.prokind='f' ORDER BY 1`,
    )
  ).rows as { name: string; hash: string }[];
  return new Map(rows.map((row) => [row.name, row.hash]));
}
const marker = async () =>
  (await f.owner.query("SELECT to_regprocedure('app.outreach_real_installed()') r")).rows[0].r;
const providerCheck = async () =>
  (
    await f.owner.query(
      "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='app.communication_receipt'::regclass AND conname='communication_receipt_provider_check'",
    )
  ).rows[0].d as string;
beforeAll(async () => {
  f = await commercialFixture();
}, 120000);
afterAll(async () => {
  await f?.close();
});

test('the module will not install without the real-use modules and records nothing', async () => {
  await expect(migrateOutreachReal(f.owner)).rejects.toThrow(
    'customer real-use modules are not installed',
  );
  expect(
    (await f.owner.query("SELECT to_regclass('outreach_real_migrations.applied') r")).rows[0].r,
  ).toBeNull();
  expect(await marker()).toBeNull();
});

test('a drifted prerequisite function stops the install and changes nothing', async () => {
  await migrateCustomerRealUse(f.owner);
  for (const name of replaced) {
    const original = await definition(name);
    const drifted = original.replace(/\$function\$\s*$/, '/* drift */$function$');
    expect(drifted).not.toBe(original);
    await f.owner.query(drifted);
    try {
      await expect(migrateOutreachReal(f.owner)).rejects.toThrow(
        'Real outreach prerequisite differs',
      );
      expect(await marker()).toBeNull();
    } finally {
      await f.owner.query(original);
    }
  }
});

test('the install replaces exactly three functions, widens one check, and a second run changes nothing', async () => {
  const before = await functionHashes();
  expect(await providerCheck()).not.toContain('email');
  await migrateOutreachReal(f.owner);
  const after = await functionHashes();
  const changed = [...before]
    .filter(([name, hash]) => after.get(name) !== hash)
    .map(([name]) => name);
  expect(changed.sort()).toEqual([...replaced].sort());
  expect([...after.keys()].filter((name) => !before.has(name)).sort()).toEqual([
    'app.deliver_real_email(uuid,text,uuid,text,text)',
    'app.outreach_link_real(text)',
    'app.outreach_rate_take(uuid,text,uuid,integer,integer)',
    'app.outreach_real_installed()',
    'app.outreach_real_payload(uuid,text,uuid)',
    'app.outreach_record_consent(uuid,text,text,text)',
    'app.outreach_record_event(text,uuid,text,boolean)',
    'app.outreach_suppressed(text)',
    'app.outreach_unsubscribe(text)',
  ]);
  expect(await providerCheck()).toContain("'email'");
  expect(await providerCheck()).toContain("'email_test'");
  expect(
    (await f.owner.query('SELECT name,sha256 FROM outreach_real_migrations.applied')).rows,
  ).toEqual([{ name: file, sha256: sha(`${dir}/${file}`) }]);
  await migrateOutreachReal(f.owner);
  expect(await functionHashes()).toEqual(after);
  for (const role of ['PUBLIC', 'corridra_auth'])
    for (const fn of [
      'app.outreach_real_payload(uuid,text,uuid)',
      'app.deliver_real_email(uuid,text,uuid,text,text)',
      'app.outreach_unsubscribe(text)',
    ])
      expect(
        (
          await f.owner.query(
            role === 'PUBLIC'
              ? "SELECT EXISTS(SELECT FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') ok"
              : "SELECT has_function_privilege('corridra_auth',$1,'EXECUTE') ok",
            [fn],
          )
        ).rows[0].ok,
      ).toBe(false);
});

test('the rollback file restores the three functions and the check to their earlier definitions', async () => {
  await f.owner.query(readFileSync(`${dir}/rollback/0001_restore.sql`, 'utf8'));
  expect(await providerCheck()).not.toContain('email');
  const restored = await functionHashes();
  expect(restored.get('app.guard_communication()')).toBe(
    '8cb1b516ee4779bb60d063392963168457b7b4f1cc5c1899216ff17977aa371a',
  );
  expect(restored.get('app.communication_allowed(uuid,boolean)')).toBe(
    'b0bd1d71e29456555852f9d041f377edf41d1f917d006f2ba0ca471678313b1e',
  );
  expect(restored.get('app.experience_outreach_rows_for(uuid,uuid[])')).toBe(
    '2db8a86152ef0bda44a5bc6f1bc31d192a2cf29e741f610a95bd21e653ea438f',
  );
});
