import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Installer run time (KI-51), the parts that need no database: the script starts and ends the run, the workflow gained no
// input, every migrator is wrapped the same way and the two that are re-run on purpose are not.
const source = (path: string) => readFileSync(resolve(path), 'utf8');
const script = source('scripts/install-customer-modules.ts');
const workflow = source('.github/workflows/install-customer-modules.yml');
const refresh = source('packages/db/src/customer-optional-refresh.ts');
const directory = 'packages/db/src';
const migratorFiles = readdirSync(resolve(directory)).filter((name) =>
  name.endsWith('-migrate.ts'),
);
// Re-run on purpose in one installer run: the programme lifecycle install re-runs the workspace lifecycle so its programme
// guard gets the archive gate, and its _late files repeat on every call. Memoising either would skip that.
const rerunOnPurpose = ['customer-workspace-lifecycle-migrate.ts'];

describe('the install script', () => {
  test('starts the run at the beginning of the apply path and ends it in the finally, before the pool closes', () => {
    expect([...script.matchAll(/startMigrationRun\(pool\)/g)]).toHaveLength(1);
    expect([...script.matchAll(/endMigrationRun\(pool\)/g)]).toHaveLength(1);
    const apply = script.indexOf('if (apply) {');
    const start = script.indexOf('startMigrationRun(pool)');
    const firstMigrator = script.indexOf('await migrateCustomerRealUse(pool)', apply);
    expect(apply).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(apply);
    expect(start).toBeLessThan(firstMigrator);
    expect(start).toBeLessThan(script.indexOf('for (const [name, install] of installers)'));
    const finallyAt = script.lastIndexOf('} finally {');
    expect(script.indexOf('endMigrationRun(pool)')).toBeGreaterThan(finallyAt);
    expect(script.indexOf('endMigrationRun(pool)')).toBeLessThan(
      script.indexOf('await pool.end()'),
    );
    expect(script).toContain("from '../packages/db/src/migration-run'");
  });

  test('the dry run starts no run, because the start sits inside the apply branch', () => {
    const apply = script.indexOf('if (apply) {');
    const dryRun = script.indexOf('Dry run only');
    const start = script.indexOf('startMigrationRun(pool)');
    expect(start).toBeGreaterThan(apply);
    expect(start).toBeLessThan(dryRun);
  });

  test('keeps both refreshes and the final refusal check', () => {
    expect([...script.matchAll(/refreshInstalledOptionalModules\(pool\)/g)]).toHaveLength(2);
    expect(script).toContain('assertNoneBehind(await refreshInstalledOptionalModules(pool))');
  });

  test('adds no workflow input and does not touch the workflow', () => {
    expect([...workflow.matchAll(/^ {6}[a-z0-9_]+:\n {8}description:/gm)]).toHaveLength(25);
    expect(workflow).not.toMatch(/migration[_-]run|memo/i);
    expect(script).not.toMatch(/MIGRATION_RUN|MEMO/);
  });
});

describe('the migrators', () => {
  test('every migrator file except the one re-run on purpose is wrapped the same way, under its own name', () => {
    expect(migratorFiles.length).toBeGreaterThanOrEqual(48);
    for (const file of migratorFiles) {
      const text = source(`${directory}/${file}`);
      if (rerunOnPurpose.includes(file)) continue;
      const exported = [...text.matchAll(/^export (?:async )?function (\w+)\(/gm)].map(
        (m) => m[1]!,
      );
      expect(exported, file).toHaveLength(1);
      const name = exported[0]!;
      expect(name, file).toMatch(/^migrate[A-Z]/);
      expect(text, file).toContain(`export function ${name}(pool: DatabasePool) {`);
      expect(text, file).toContain(`migrateOnce(pool, '${name}', () =>`);
      expect(text, file).toContain(`async function ${name}Run(pool: DatabasePool) {`);
      expect(text, file).toContain("import { migrateOnce } from './migration-run';");
      // The body is called once, from the wrapper, and nowhere else.
      expect([...text.matchAll(new RegExp(`${name}Run\\(`, 'g'))]).toHaveLength(2);
    }
  });

  test('the workspace lifecycle installer and its refresh stay un-memoised', () => {
    const text = source(`${directory}/customer-workspace-lifecycle-migrate.ts`);
    expect(text).not.toContain('migrateOnce');
    expect(text).not.toContain('migration-run');
    expect(text).toContain(
      'export async function migrateCustomerWorkspaceLifecycle(pool: DatabasePool)',
    );
    expect(text).toContain(
      'export async function refreshCustomerWorkspaceLifecycle(pool: DatabasePool)',
    );
  });

  test('no refresh or configure function is wrapped anywhere', () => {
    for (const file of migratorFiles) {
      const text = source(`${directory}/${file}`);
      expect(text, file).not.toMatch(/migrateOnce\(pool, '(refresh|configure)/);
    }
    for (const file of readdirSync(resolve('packages/auth/src')).filter((name) =>
      name.endsWith('.ts'),
    ))
      expect(source(`packages/auth/src/${file}`), file).not.toContain('migrateOnce');
  });

  test('the memory is used by the migrators and the script only, never by application code', () => {
    for (const root of [
      'apps/web',
      'packages/auth/src',
      'packages/delivery/src',
      'packages/missions/src',
    ]) {
      const walk = (dir: string): string[] =>
        readdirSync(resolve(dir), { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? entry.name === 'node_modules' || entry.name === '.next'
              ? []
              : walk(`${dir}/${entry.name}`)
            : /\.(ts|tsx)$/.test(entry.name)
              ? [`${dir}/${entry.name}`]
              : [],
        );
      for (const file of walk(root))
        expect(source(file), file).not.toMatch(/startMigrationRun|migration-run/);
    }
  });
});

describe('the optional-module refresh', () => {
  test('compares the registry with the module files by name and sha256 and still calls all four migrators', () => {
    expect(refresh).toContain('SELECT name,sha256 FROM ${registries[module]}.applied');
    expect(refresh).toContain("createHash('sha256')");
    expect([...refresh.matchAll(/\.sql'\)/g)].length).toBeGreaterThan(0);
    for (const name of [
      'migrateCustomerRequestWithdrawal',
      'migrateCustomerMoves',
      'migrateCustomerMissionMail',
      'migrateCustomerNotifications',
    ])
      expect(refresh).toContain(`() => ${name}(pool)`);
  });

  test('keeps its guarantees: it installs nothing absent, calls no configure step and writes no row', () => {
    expect(refresh).not.toMatch(/configure[A-Z]/);
    expect(refresh).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/);
    expect(refresh).toContain("state: 'not installed'");
    expect(refresh).not.toContain('migration-run');
  });
});
