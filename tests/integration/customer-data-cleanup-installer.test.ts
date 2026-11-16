import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { dataCleanupKeepList } from '../../packages/auth/src/customer-data-cleanup';

// U2 install wiring. The data cleanup is reached only through field_modules_action (data_cleanup_inventory,
// data_cleanup_archive, data_cleanup_restore), never by a base run. The inventory only reads, so it also runs on a dry
// run; archive and restore need apply and a reason. The behaviour on a database is proven in customer-data-cleanup.test.ts.
describe('the data cleanup install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');

  test('the script takes a four-valued action and a reason; archive and restore need apply and the reason', () => {
    expect(script).toContain(
      "DATA_CLEANUP_ACTION: z\n      .enum(['unchanged', 'inventory', 'archive', 'restore'])\n      .default('unchanged')",
    );
    expect(script).toMatch(/DATA_CLEANUP_REASON: z\.preprocess\(/);
    expect(script).toContain(
      "if (['archive', 'restore'].includes(v.DATA_CLEANUP_ACTION) && !apply)\n  throw new Error('Data cleanup archive and restore require INSTALL_APPLY=yes');",
    );
    expect(script).toContain(
      "if (['archive', 'restore'].includes(v.DATA_CLEANUP_ACTION) && !v.DATA_CLEANUP_REASON)\n  throw new Error('Data cleanup archive and restore require an explicit reason');",
    );
    // The inventory is not refused on a dry run.
    expect(script).not.toMatch(/DATA_CLEANUP_ACTION !== 'unchanged' && !apply/);
    expect(script).toContain("'customer_data_cleanup_migrations'");
  });

  test('the inventory prints in the read-only phase; archive and restore run only inside their own block of the apply path', () => {
    const before = script.indexOf("await report(apply ? 'Before install'");
    const apply = script.indexOf('if (apply) {', before);
    const inventory = script.indexOf('await inventoryDataCleanup(pool)');
    expect(inventory).toBeGreaterThan(before);
    expect(inventory).toBeLessThan(apply);
    expect(script.slice(before, inventory)).toContain("if (v.DATA_CLEANUP_ACTION !== 'unchanged')");
    for (const call of ['migrateCustomerDataCleanup(pool)', 'configureDataCleanup(pool,']) {
      expect(script.split(call).length - 1).toBe(1);
      const at = script.indexOf(call);
      expect(at).toBeGreaterThan(script.indexOf('View-as audit function: installed'));
      expect(at).toBeLessThan(script.indexOf("await report('After install');"));
      expect(script.slice(at - 400, at)).toContain(
        "if (v.DATA_CLEANUP_ACTION === 'archive' || v.DATA_CLEANUP_ACTION === 'restore') {",
      );
    }
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/cleanup/i);
  });

  test('the workflow derives the action and a fixed reason from field_modules_action alone and adds no input', () => {
    for (const choice of ['data_cleanup_inventory', 'data_cleanup_archive', 'data_cleanup_restore'])
      expect(workflow).toMatch(new RegExp(`^\\s{12}${choice},$`, 'm'));
    expect(workflow).not.toMatch(/^\s{6}data_cleanup[a-z_]*:/m);
    for (const name of ['DATA_CLEANUP_ACTION', 'DATA_CLEANUP_REASON']) {
      const lines = workflow.split('\n').filter((line) => line.includes(`${name}:`));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
    }
    expect(workflow).toContain(
      "'Owner archived made-up, demo and QA test workspaces from the install workflow'",
    );
    expect(workflow).toContain(
      "'Owner restored workspaces archived by the data cleanup from the install workflow'",
    );
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
