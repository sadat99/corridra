import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// ADR-080 install wiring. The programme pages module is reached only through field_modules_action=programme_pages, never
// by a base run, and installing it exposes nothing: the application switch CORRIDRA_PROGRAMME_PAGES stays separate.
// The module's own behaviour on a database is proven in customer-programme-publication and real-programme-pages.
describe('the programme pages install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');

  test('the script takes a two-valued action that needs apply, and lists the registry', () => {
    expect(script).toContain(
      "PROGRAMME_PAGES_ACTION: z.enum(['unchanged', 'install']).default('unchanged')",
    );
    expect(script).toMatch(/PROGRAMME_PAGES_ACTION !== 'unchanged' && !apply/);
    expect(script).toContain('Programme page installation requires INSTALL_APPLY=yes');
    expect(script).toContain("'customer_programme_publication_migrations'");
  });

  test('the script calls the installer once, only inside its own install block, and never in a base run', () => {
    const call = 'migrateCustomerProgrammePublication(pool)';
    expect(script.split(call).length - 1).toBe(1);
    const at = script.indexOf(call + ';');
    expect(at).toBeGreaterThan(-1);
    expect(script.slice(at - 80, at)).toContain("v.PROGRAMME_PAGES_ACTION === 'install'");
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/publication/i);
    // It runs after the report of what is installed, so the log shows the state it was installed on.
    expect(at).toBeGreaterThan(script.indexOf("await report(apply ? 'Before install'"));
    expect(at).toBeLessThan(script.indexOf("await report('After install');"));
    // Installing never touches the application switch.
    expect(script).not.toContain('CORRIDRA_PROGRAMME_PAGES=');
  });

  test('the workflow derives the line from field_modules_action alone and adds no input', () => {
    expect(workflow).toMatch(/^\s{12}programme_pages,$/m);
    expect(workflow).not.toMatch(/^\s{6}programme_pages[a-z_]*:/m);
    const lines = workflow.split('\n').filter((line) => /PROGRAMME_PAGES_ACTION/.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("inputs.field_modules_action == 'programme_pages' && 'install'");
    expect(lines[0]!.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
  });
});
