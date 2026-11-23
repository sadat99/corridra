import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { qaDataRetirePlan } from '../../packages/auth/src/customer-qa-data-retire';
import { dataCleanupKeepList } from '../../packages/auth/src/customer-data-cleanup';

// B11b install wiring (owner decision 23 Nov 2026: "dont delete any existing users"). The QA test data retirement step is
// reached only through field_modules_action=qa_data_retire and only reports: every lifecycle that retires this data needs
// a signed-in person as its actor, so no offline step may call one. The behaviour on a database is proven in
// qa-data-retire.test.ts.
describe('the QA data retirement install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');
  const source = readFileSync(resolve('packages/auth/src/customer-qa-data-retire.ts'), 'utf8');
  // The statements the module sends, without its comments.
  const code = source.replace(/\/\*\*.*?\*\//gs, '').replace(/^\s*\/\/.*$/gm, '');

  test('the names are the owner-approved ones and no kept name is a target', () => {
    expect(qaDataRetirePlan).toEqual({
      workspace: 'QA-Organiser Workspace (madeup)',
      workspaceCreatedBefore: '2026-11-24T00:00:00Z',
      programme: 'QA-Test Programme (madeup)',
      problemReport: 'RP-000001',
      request: {
        title: 'Source suppliers in China',
        objective: 'Source suppliers',
        markets: ['CN', 'China'],
      },
      companyProfile: 'QA-Test Co (madeup)',
      keep: ['QA Test (sample) Customer', 'QA Test (sample) Organiser'],
      reason: 'Owner decision of 23 Nov 2026, retire QA test data without deleting any user',
    });
    const kept = [...qaDataRetirePlan.keep, ...dataCleanupKeepList.map((entry) => entry.name)];
    for (const target of [
      qaDataRetirePlan.workspace,
      qaDataRetirePlan.programme,
      qaDataRetirePlan.companyProfile,
    ])
      expect(kept).not.toContain(target);
  });

  test('the module can only read: one read-only transaction, always rolled back, and no writing statement', () => {
    expect(code).toContain("'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'");
    // Rolled back and released on every path; a failed rollback discards the connection instead of reusing it.
    expect(code).toMatch(
      /try \{\s*await db\.query\('BEGIN[^']*READ ONLY'\);\s*return await read\(db, plan\);\s*\} finally \{\s*db\.release\(await rollback\(db\)\);\s*\}/,
    );
    expect(code.split('db.release(').length - 1).toBe(1);
    expect(code).not.toMatch(/'COMMIT'|"COMMIT"/);
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/);
    // No session is made up and no actor is set: nothing here can call a lifecycle as a person.
    expect(code).not.toMatch(/set_config|session_proof|customer_proof_hash|bootstrap_actor/);
    expect(code).not.toMatch(
      /workspace_lifecycle_command|programme_lifecycle\(|programme_participant_command|problem_report_transition|withdraw_request/,
    );
    // People are never read by name or address.
    expect(code).not.toMatch(/identity\.|neon_auth|email/i);
    expect(code).toContain("pg_advisory_xact_lock(hashtext('corridra:qa-data-retire'))");
  });

  test('the script takes a two-valued action with no reason, refuses it together with apply, and adds no registry or migration', () => {
    expect(script).toContain(
      "QA_DATA_RETIRE_ACTION: z.enum(['unchanged', 'report']).default('unchanged')",
    );
    expect(script).not.toMatch(/QA_DATA_RETIRE_REASON/);
    // Refused together with INSTALL_APPLY=yes while the settings are checked: before the first report, before any
    // installer or migration, and before the database is opened.
    const refusal = script.indexOf(
      "if (v.QA_DATA_RETIRE_ACTION !== 'unchanged' && apply)\n  throw new Error(",
    );
    expect(refusal).toBeGreaterThan(script.indexOf("const apply = v.INSTALL_APPLY === 'yes';"));
    expect(script.slice(refusal, refusal + 200)).toContain(
      'The QA data retirement report is read only: run it without INSTALL_APPLY=yes',
    );
    for (const later of [
      'const pool = databasePool',
      "await report(apply ? 'Before install'",
      'await reportQaDataRetire(pool)',
      'if (apply) {',
    ])
      expect(script.indexOf(later), later).toBeGreaterThan(refusal);
    expect(script).not.toMatch(/qa_data_retire_migrations|migrateCustomerQaDataRetire/);
    expect(readdirSync(resolve('packages/db')).filter((name) => /qa/i.test(name))).toEqual([]);
  });

  test('the report prints once, in the read-only phase before the apply path, with the fixed names only', () => {
    const before = script.indexOf("await report(apply ? 'Before install'");
    const apply = script.indexOf('if (apply) {', before);
    // No second argument: the names are fixed in the module and never taken from input.
    const call = 'await reportQaDataRetire(pool)';
    expect(script.split('reportQaDataRetire(').length - 1).toBe(1);
    const at = script.indexOf(call);
    expect(at).toBeGreaterThan(before);
    expect(at).toBeLessThan(apply);
    expect(script.slice(before, at)).toContain("if (v.QA_DATA_RETIRE_ACTION !== 'unchanged')");
    expect(script.slice(at, at + 60)).toContain('.lines.join(');
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/qa/i);
  });

  test('the workflow derives the action from field_modules_action alone and adds no input', () => {
    expect(workflow).toMatch(/^\s{12}qa_data_retire,$/m);
    expect(workflow).not.toMatch(/qa_data_retire_(apply|archive|delete)/);
    expect(workflow).not.toMatch(/^\s{6}qa_data[a-z_]*:/m);
    expect(workflow).toContain('run without apply, it is refused together with apply');
    const lines = workflow.split('\n').filter((line) => line.includes('QA_DATA_RETIRE'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      "QA_DATA_RETIRE_ACTION: ${{ inputs.field_modules_action == 'qa_data_retire' && 'report' || 'unchanged' }}",
    );
    expect(lines[0]!.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
  });
});
