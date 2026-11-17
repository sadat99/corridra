import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// ADR-087 U2 and U3 install wiring. Each module is reached only through its own field_modules_action value, never by a base
// run, and needs apply. U2's answer-correction file waits for that module, whose install re-runs U2. The modules' behaviour
// on a database (guard, idempotence, viewer reads, rollback) is proven in adr087-viewer-policies.test.ts.
describe('the ADR-087 viewer module install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');
  const modules = [
    [
      'VIEWER_REPLY_METADATA_ACTION',
      'viewer_reply_metadata',
      'migrateViewerReplyMetadata',
      'Viewer reply metadata installation requires INSTALL_APPLY=yes',
    ],
    [
      'VIEWER_EXPORT_ACCESS_ACTION',
      'viewer_export_access',
      'migrateViewerExportAccess',
      'Viewer export access installation requires INSTALL_APPLY=yes',
    ],
  ] as const;

  test('the script takes a two-valued action per module that needs apply, and lists both registries', () => {
    for (const [line, , , refusal] of modules) {
      expect(script).toContain(`${line}: z.enum(['unchanged', 'install']).default('unchanged')`);
      expect(script).toMatch(new RegExp(`${line} !== 'unchanged' && !apply`));
      expect(script).toContain(refusal);
    }
    expect(script).toContain("'viewer_reply_metadata_migrations'");
    expect(script).toContain("'viewer_export_access_migrations'");
  });

  test('each installer runs only inside its own block (U2 also after answer correction), never in a base run', () => {
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/viewer/i);
    for (const [line, , call] of modules) {
      const at = script.indexOf(`const result = await ${call}(pool);`);
      expect(at).toBeGreaterThan(script.indexOf("await report(apply ? 'Before install'"));
      expect(at).toBeLessThan(script.indexOf("await report('After install');"));
      expect(script.slice(at - 120, at)).toContain(`v.${line} === 'install'`);
    }
    expect(script.split('migrateViewerExportAccess(pool)').length - 1).toBe(1);
    // U2 runs in its own block, and is refreshed (only where already installed) right after the answer-correction module.
    expect(script.split('migrateViewerReplyMetadata(pool)').length - 1).toBe(1);
    expect(script.split('refreshViewerReplyMetadata(pool)').length - 1).toBe(1);
    const revision = script.indexOf('await migrateRecipientResponseRevision(pool);');
    const rerun = script.indexOf(
      'const viewer = await refreshViewerReplyMetadata(pool);',
      revision,
    );
    expect(rerun).toBeGreaterThan(revision);
    expect(rerun - revision).toBeLessThan(300);
  });

  test('the workflow derives each line from field_modules_action alone and adds no input', () => {
    for (const [line, choice] of modules) {
      expect(workflow).toMatch(new RegExp(`^\\s{12}${choice},$`, 'm'));
      expect(workflow).not.toMatch(new RegExp(`^\\s{6}${choice}[a-z_]*:`, 'm'));
      const lines = workflow.split('\n').filter((text) => text.includes(line));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(
        `inputs.field_modules_action == '${choice}' && 'install' || 'unchanged'`,
      );
      expect(lines[0]!.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
    }
  });

  test('the migrators read only the .sql files directly in each module folder, so the rollback text is never applied', () => {
    for (const folder of ['viewer-reply-metadata-migrations', 'viewer-export-access-migrations']) {
      const top = readdirSync(resolve('packages/db', folder)).filter((name) =>
        name.endsWith('.sql'),
      );
      const rollback = readdirSync(resolve('packages/db', folder, 'rollback'));
      expect(top.length).toBeGreaterThan(0);
      expect(rollback.length).toBeGreaterThan(0);
      for (const name of rollback) expect(top).not.toContain(name);
    }
    const migrator = readFileSync(resolve('packages/db/src/viewer-module-run.ts'), 'utf8');
    expect(migrator).toMatch(
      /readdir\(module\.directory\)\)\s*\.filter\(\(name\) => name\.endsWith\('\.sql'\)\)/,
    );
    expect(migrator).not.toMatch(/recursive/);
  });
});
