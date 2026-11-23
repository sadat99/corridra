import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { realIntakeOwnerPlan } from '../../packages/auth/src/customer-real-intake-owner';

// B11a install wiring (owner decision 23 Nov 2026). The real intake owner change is reached only through
// field_modules_action=real_intake_owner_apply. Without INSTALL_APPLY=yes it is a dry run in a read-only transaction; with it
// the module is installed and one transaction makes the change. The behaviour on a database is proven in
// real-intake-owner.test.ts. This file proves the wiring and that the source deletes nothing and rewrites nothing.
describe('the real intake owner install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');
  const source = readFileSync(resolve('packages/auth/src/customer-real-intake-owner.ts'), 'utf8');
  const migrator = readFileSync(
    resolve('packages/db/src/customer-real-intake-owner-migrate.ts'),
    'utf8',
  );
  const family = resolve('packages/db/customer-real-intake-owner-migrations');
  const sql = readFileSync(resolve(family, '0001_real_intake_owner.sql'), 'utf8');
  const realUse = readFileSync(
    resolve('packages/db/customer-real-use-migrations/0002_real_request_authority.sql'),
    'utf8',
  );
  // The text of app.submit_mission in a migration file, from its CREATE line to the end of its body.
  const submitMission = (text: string) => {
    const from = text.indexOf('CREATE OR REPLACE FUNCTION app.submit_mission(');
    const to = text.indexOf('END $function$', from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return text.slice(from, to);
  };

  test('the script takes a two-valued action with a required reason and no apply guard: no apply is the dry run', () => {
    expect(script).toContain(
      "REAL_INTAKE_OWNER_ACTION: z.enum(['unchanged', 'apply']).default('unchanged')",
    );
    expect(script).toMatch(
      /REAL_INTAKE_OWNER_REASON: z\.preprocess\(\s*\(value\) => \(typeof value === 'string' && value\.trim\(\) === '' \? undefined : value\),\s*z\.string\(\)\.trim\(\)\.min\(10\)\.max\(500\)\.optional\(\),\s*\)/,
    );
    expect(script).toMatch(
      /if \(v\.REAL_INTAKE_OWNER_ACTION === 'apply' && !v\.REAL_INTAKE_OWNER_REASON\)\n\s+throw new Error\('The real intake owner change requires an explicit reason'\);/,
    );
    expect(script).not.toMatch(/REAL_INTAKE_OWNER_ACTION !== 'unchanged' && !apply/);
    // The reason guard stands before the first read of the database.
    expect(
      script.indexOf("v.REAL_INTAKE_OWNER_ACTION === 'apply' && !v.REAL_INTAKE_OWNER_REASON"),
    ).toBeLessThan(script.indexOf('const pool = databasePool'));
  });

  test('the dry run reads once before the apply path, and the change runs once inside it, after its module is installed', () => {
    const before = script.indexOf("await report(apply ? 'Before install'");
    const applyAt = script.indexOf('if (apply) {', before);
    const after = script.indexOf("await report('After install')");
    const dry = script.search(/await changeRealIntakeOwner\(pool, \{\s*apply: false/);
    const change = script.search(/await changeRealIntakeOwner\(pool, \{\s*apply: true/);
    expect(script.split('changeRealIntakeOwner(pool').length - 1).toBe(2);
    expect(dry).toBeGreaterThan(before);
    expect(dry).toBeLessThan(applyAt);
    expect(script.slice(before, dry)).toContain(
      "if (v.REAL_INTAKE_OWNER_ACTION === 'apply' && !apply)",
    );
    expect(change).toBeGreaterThan(applyAt);
    expect(change).toBeLessThan(after);
    const install = script.indexOf('await migrateCustomerRealIntakeOwner(pool)');
    expect(script.split('migrateCustomerRealIntakeOwner(pool)').length - 1).toBe(1);
    expect(install).toBeGreaterThan(
      script.lastIndexOf("if (v.REAL_INTAKE_OWNER_ACTION === 'apply') {"),
    );
    expect(install).toBeLessThan(change);
    // Only its safe lines are printed, and both calls pass the reason from the environment.
    expect(script.slice(dry, dry + 400)).toContain(".lines.join('\\n')");
    // The dry run also checks what an apply needs before it writes: the module's own prerequisites.
    const preview = script.indexOf('await previewCustomerRealIntakeOwnerInstall(pool)');
    expect(script.split('previewCustomerRealIntakeOwnerInstall(pool)').length - 1).toBe(1);
    expect(preview).toBeGreaterThan(before);
    expect(preview).toBeLessThan(applyAt);
    expect(script.slice(preview, dry + 400)).toContain('apply would refuse: ');
    expect(source).toContain("await db.query('BEGIN READ ONLY')");
    expect(source).toContain('is not the text this module was written against');
    // The migrator file keeps its one wrapped migrator: the preview lives with the operation.
    expect(migrator).not.toContain('previewCustomerRealIntakeOwnerInstall');
    expect(script.slice(change, change + 200)).toContain("result.lines.join('\\n')");
    expect(script.split('reason: v.REAL_INTAKE_OWNER_REASON').length - 1).toBe(2);
  });

  test('the module is registered like its siblings and is never part of the base run', () => {
    expect(readdirSync(family)).toEqual(['0001_real_intake_owner.sql']);
    const registries = script.slice(
      script.indexOf('const registries = ['),
      script.indexOf('const installers'),
    );
    expect(registries).toContain("'customer_real_intake_owner_migrations',");
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/intake owner|RealIntakeOwner/i);
    expect(migrator).toContain(
      "new URL('../customer-real-intake-owner-migrations/', import.meta.url)",
    );
    expect(migrator).toContain("migrateOnce(pool, 'migrateCustomerRealIntakeOwner'");
    expect(migrator).toContain("pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    expect(migrator).toContain('customer_real_intake_owner_migrations.applied');
    expect(migrator).toContain('The customer real-use schema is not current');
    expect(migrator).toContain("throw new Error('Real intake owner migration history mismatch')");
  });

  test('the workflow derives the action and a fixed reason from field_modules_action alone and adds no input', () => {
    expect(workflow).toMatch(/^\s{12}real_intake_owner_apply,$/m);
    expect(workflow).not.toMatch(/^\s{6}real_intake_owner[a-z_]*:/m);
    const lines = workflow.split('\n').filter((line) => line.includes('REAL_INTAKE_OWNER_'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(
      "REAL_INTAKE_OWNER_ACTION: ${{ inputs.field_modules_action == 'real_intake_owner_apply' && 'apply' || 'unchanged' }}",
    );
    expect(lines[1]).toMatch(
      /REAL_INTAKE_OWNER_REASON: \$\{\{ inputs\.field_modules_action == 'real_intake_owner_apply' && '[^']{10,500}' \|\| '' \}\}/,
    );
    for (const line of lines)
      expect(line.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
  });

  test('the migration adds one append-only table and changes one thing in app.submit_mission, behind a hash check', () => {
    // The table: private, row security on, no grant to the runtime or auth roles, never rewritten.
    expect(sql).toContain('CREATE TABLE customer_private.real_intake_owner_version (');
    expect(sql).toContain(
      'ALTER TABLE customer_private.real_intake_owner_version ENABLE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'REVOKE ALL ON customer_private.real_intake_owner_version FROM PUBLIC,corridra_runtime,corridra_auth;',
    );
    expect(sql).toMatch(
      /CREATE TRIGGER real_intake_owner_version_immutable BEFORE UPDATE OR DELETE ON customer_private\.real_intake_owner_version\s+FOR EACH ROW EXECUTE FUNCTION app\.reject_rewrite\(\);/,
    );
    expect(sql).not.toMatch(/\bGRANT\b/);
    // Additive only: nothing is dropped, deleted, updated, truncated or altered except the row security switch above.
    const statements = sql
      .replace(/^--.*$/gm, '')
      .replace(submitMission(sql), '')
      .replace(/CREATE TRIGGER real_intake_owner_version_immutable[^;]*;/, '');
    expect(statements).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|INSERT)\b/);
    expect(statements.match(/\bALTER\b/g)).toHaveLength(1);
    // The function is replaced only when the installed text is the one this file was written against: the text that
    // customer-real-use 0002 installs. The pinned hash is the hash PostgreSQL reports for it (checked on a database by
    // real-intake-owner.test.ts, where this file installs after the real-use schema).
    const guard = sql.indexOf(
      "DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.submit_mission(uuid,text,text,jsonb,text)'::regprocedure),'UTF8')),'hex')<>'",
    );
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(sql.indexOf('CREATE OR REPLACE FUNCTION app.submit_mission('));
    expect(sql.split('CREATE OR REPLACE FUNCTION').length - 1).toBe(1);
    expect(sql).toContain(
      "THEN RAISE EXCEPTION 'Real intake owner prerequisite function differs: app.submit_mission';END IF;END $guard$;",
    );
    // One change only. Putting the earlier owner line back and removing the added check gives the installed text, byte for byte,
    // so the sample branch and everything after it are unchanged.
    const earlier =
      '  SELECT true,intake_tenant_id,executor_id,owner_id,enabled,notice_version INTO d FROM customer_private.real_use_configuration WHERE enabled;\n';
    const now =
      '  SELECT true,c.intake_tenant_id,c.executor_id,coalesce((SELECT o.owner_id FROM customer_private.real_intake_owner_version o ORDER BY o.id DESC LIMIT 1),c.owner_id),c.enabled,c.notice_version INTO d FROM customer_private.real_use_configuration c WHERE c.enabled;\n';
    const check =
      "  IF EXISTS(SELECT FROM customer_private.real_intake_owner_version) AND NOT EXISTS(SELECT FROM app.membership m JOIN identity.principal p ON p.id=m.user_id WHERE m.tenant_id=d.tenant_id AND m.user_id=d.owner_id AND m.revoked_at IS NULL AND m.role IN ('owner','admin') AND 'commercial_qualification'=ANY(m.allowed_purposes) AND p.disabled_at IS NULL) THEN RAISE EXCEPTION 'Real intake unavailable' USING ERRCODE='42501';END IF;\n";
    const mine = submitMission(sql);
    expect(mine.split(now).length - 1).toBe(1);
    expect(mine.split(check).length - 1).toBe(1);
    const restored = mine.replace(now, earlier).replace(check, '');
    expect(createHash('sha256').update(restored).digest('hex')).toBe(
      createHash('sha256').update(submitMission(realUse)).digest('hex'),
    );
    expect(restored).toBe(submitMission(realUse));
    // Both new lines sit in the real branch, before the sample branch begins.
    const sample = mine.indexOf(
      ' ELSE\n  SELECT * INTO d FROM app.intake_destination WHERE singleton AND enabled;',
    );
    expect(sample).toBeGreaterThan(-1);
    expect(mine.indexOf(now)).toBeLessThan(sample);
    expect(mine.indexOf(check)).toBeLessThan(sample);
  });

  test('the operation names exactly the owner decision, deletes nothing and writes only the owner record and two memberships', () => {
    expect(realIntakeOwnerPlan).toEqual({
      workspace: 'Corridra request operations',
      owner: 'Corridra founder',
      remove: ['Synthetic operator', 'Synthetic reviewer'],
    });
    const code = source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*\*.*?\*\//gs, '');
    expect(code).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i);
    // One INSERT (the owner record) and one UPDATE (a membership's revoked_at, in the real workspace, never a role).
    expect(code.match(/\bINSERT INTO\b/g)).toHaveLength(1);
    expect(code).toContain(
      'INSERT INTO customer_private.real_intake_owner_version(id,owner_id,set_by,reason)',
    );
    expect(code.match(/\bUPDATE app\./g)).toHaveLength(1);
    expect(code).toContain(
      'UPDATE app.membership SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
    );
    expect(code).not.toMatch(
      /intake_destination|neon_auth|identity\."user" SET|identity\.principal SET/,
    );
    expect(code).not.toMatch(/real_use_configuration\s*(SET|\()/);
    // Names and short ids only reach the log: no email column is read.
    expect(code).not.toMatch(/\bemail\b/i);
    // The dry run cannot write: it runs in a read-only transaction, and only the schema owner may run either mode.
    expect(code).toContain("value.apply ? 'BEGIN' : 'BEGIN READ ONLY'");
    expect(code).toContain(
      "throw new Error('Offline customer schema-owner authority is required')",
    );
    // The names come from the fixed plan, never from input.
    expect(code).toMatch(
      /\.object\(\{\s*apply: z\.boolean\(\),\s*reason: z\.string\(\)\.trim\(\)\.min\(10\)\.max\(500\),\s*\}\)\s*\.strict\(\)/,
    );
  });
});
