import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { dataCleanupKeepList } from '../../packages/auth/src/customer-data-cleanup';

// U2 install wiring. The data cleanup inventory is reached only through field_modules_action=data_cleanup_inventory. It
// only reads, so it runs on a dry run too and needs no reason. Nothing archives or restores: no stored fact proves that a
// production workspace was made up by us. The behaviour on a database is proven in customer-data-cleanup.test.ts.
describe('the data cleanup install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');

  test('the script takes a two-valued action with no reason and no apply guard, and adds no registry', () => {
    expect(script).toContain(
      "DATA_CLEANUP_ACTION: z.enum(['unchanged', 'inventory']).default('unchanged')",
    );
    expect(script).not.toMatch(/DATA_CLEANUP_REASON|DATA_CLEANUP_ACTION !== 'unchanged' && !apply/);
    expect(script).not.toMatch(
      /data_cleanup_migrations|configureDataCleanup|migrateCustomerDataCleanup/,
    );
    expect(readdirSync(resolve('packages/db'))).not.toContain('customer-data-cleanup-migrations');
  });

  test('the inventory prints once, in the read-only phase before the apply path, and only its safe lines', () => {
    const before = script.indexOf("await report(apply ? 'Before install'");
    const apply = script.indexOf('if (apply) {', before);
    const call = 'await inventoryDataCleanup(pool)';
    expect(script.split(call).length - 1).toBe(1);
    const at = script.indexOf(call);
    expect(at).toBeGreaterThan(before);
    expect(at).toBeLessThan(apply);
    expect(script.slice(before, at)).toContain("if (v.DATA_CLEANUP_ACTION !== 'unchanged')");
    expect(script.slice(at, at + 60)).toContain('.lines.join(');
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/cleanup/i);
  });

  test('the workflow derives the action from field_modules_action alone and adds no input', () => {
    expect(workflow).toMatch(/^\s{12}data_cleanup_inventory,$/m);
    expect(workflow).not.toMatch(/data_cleanup_(archive|restore)/);
    expect(workflow).not.toMatch(/^\s{6}data_cleanup[a-z_]*:/m);
    const lines = workflow.split('\n').filter((line) => line.includes('DATA_CLEANUP_'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      "inputs.field_modules_action == 'data_cleanup_inventory' && 'inventory'",
    );
    expect(lines[0]!.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
  });

  test('every kept workspace names a file that really uses that exact name', () => {
    expect(dataCleanupKeepList.length).toBeGreaterThan(0);
    for (const entry of dataCleanupKeepList)
      expect(readFileSync(resolve(entry.usedBy), 'utf8'), entry.name).toContain(`'${entry.name}'`);
    // The workspaces the signed-in sweep creates are all kept.
    const sweep = readFileSync(resolve('scripts/qa/signed-in-sweep.ts'), 'utf8');
    const created = [...sweep.matchAll(/await workspace\(by\('[a-z]+'\), '([^']+)'\)/g)].map(
      (match) => match[1],
    );
    expect(created).toHaveLength(4);
    for (const name of created)
      expect(dataCleanupKeepList.map((entry) => entry.name)).toContain(name);
  });
});
