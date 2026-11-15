import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { uxSwitchNames } from '../../apps/web/lib/ux-switches';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// ADR-085 install wiring. The helper interest module is reached only through field_modules_action=helper_interest, never by
// a base run, and installing it exposes nothing: both application switches stay separate and the owner's. The module's own
// behaviour on a database is proven in helper-interest.test.ts.
describe('the helper interest install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');

  test('the script takes a two-valued action that needs apply, and lists the registry', () => {
    expect(script).toContain(
      "HELPER_INTEREST_ACTION: z.enum(['unchanged', 'install']).default('unchanged')",
    );
    expect(script).toMatch(/HELPER_INTEREST_ACTION !== 'unchanged' && !apply/);
    expect(script).toContain('Helper interest installation requires INSTALL_APPLY=yes');
    expect(script).toContain("'helper_interest_migrations'");
  });

  test('the script calls the installer once, only inside its own install block, and never in a base run', () => {
    const call = 'migrateHelperInterest(pool)';
    expect(script.split(call).length - 1).toBe(1);
    const at = script.indexOf(call + ';');
    expect(at).toBeGreaterThan(-1);
    expect(script.slice(at - 80, at)).toContain("v.HELPER_INTEREST_ACTION === 'install'");
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/helper/i);
    expect(at).toBeGreaterThan(script.indexOf("await report(apply ? 'Before install'"));
    expect(at).toBeLessThan(script.indexOf("await report('After install');"));
    // Installing never touches an application switch.
    expect(script).not.toMatch(/CORRIDRA_HELPER_INTEREST\s*=/);
    expect(script).not.toMatch(/CORRIDRA_NETWORK_ENABLED\s*=/);
  });

  test('the workflow derives the line from field_modules_action alone and adds no input', () => {
    expect(workflow).toMatch(/^\s{12}helper_interest,$/m);
    expect(workflow).not.toMatch(/^\s{6}helper_interest[a-z_]*:/m);
    const lines = workflow.split('\n').filter((line) => /HELPER_INTEREST_ACTION/.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("inputs.field_modules_action == 'helper_interest' && 'install'");
    expect(lines[0]!.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
  });

  test('the new switch is registered and described for the owner, off unless exactly "true"', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_HELPER_INTEREST');
    const entry = switchRegistry.find((item) => item.name === 'CORRIDRA_HELPER_INTEREST');
    expect(entry).toBeDefined();
    expect(entry!.group).toBe('Network');
    expect(entry!.kind).toBe('flag');
    expect(entry!.line).not.toMatch(/—|–/);
  });
});
