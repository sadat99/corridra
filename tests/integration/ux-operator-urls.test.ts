import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fragmentFor,
  operatorSectionPath,
  operatorSlugs,
  reservedOperatorSegments,
  sectionForSlug,
} from '../../apps/web/lib/operator-urls';
import {
  operatorReturnTo,
  operatorSignInPath,
  workspaceSections,
} from '../../apps/web/lib/workspace-navigation';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// Operator section addresses and view as stage 2 (Lane 9 of the UX update): the closed list of
// addresses, the rule that a `#` part wins, and every switch-off path.
const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('the closed list of section addresses', () => {
  it('gives each of the 18 workspace sections exactly one address word', () => {
    expect(workspaceSections).toHaveLength(18);
    expect(Object.keys(operatorSlugs).sort()).toEqual(workspaceSections.map((s) => s.id).sort());
    const words = Object.values(operatorSlugs);
    expect(new Set(words).size).toBe(18);
    for (const word of words) expect(word).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });
  it('never uses a word that is already a page under /operator', () => {
    for (const reserved of reservedOperatorSegments)
      expect(Object.values(operatorSlugs)).not.toContain(reserved);
    // Those pages are real folders, so they are matched before the section address.
    const folders = readdirSync(resolve('apps/web/app/operator'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const reserved of reservedOperatorSegments) {
      expect(folders).toContain(reserved);
      expect(existsSync(resolve(`apps/web/app/operator/${reserved}`))).toBe(true);
    }
    expect(folders).toContain('[section]');
    // Every other folder under /operator is also off limits for a section word.
    for (const folder of folders.filter((name) => !name.startsWith('[')))
      expect(Object.values(operatorSlugs)).not.toContain(folder);
  });
  it('round trips every section and refuses everything else', () => {
    for (const section of workspaceSections) {
      const path = operatorSectionPath(section.id)!;
      expect(path).toMatch(/^\/operator\/[a-z-]+$/);
      expect(sectionForSlug(path.slice('/operator/'.length))).toBe(section.id);
    }
    for (const junk of [
      '',
      'owner',
      'view-as',
      'Missions',
      'missions ',
      'missions/extra',
      '../missions',
      '%6dissions',
      '__proto__',
      'constructor',
      'toString',
      'workspace-missions',
      'ops-gates',
    ])
      expect(sectionForSlug(junk), junk).toBeNull();
    for (const junk of ['', 'main', 'workspace-navigation', '__proto__', 'constructor', 'owner'])
      expect(operatorSectionPath(junk), junk).toBeNull();
  });
});

describe('what the workspace shows for an address', () => {
  it('a # part always wins, so old links keep working', () => {
    expect(fragmentFor('#workspace-research', 'workspace-missions')).toBe('workspace-research');
    expect(fragmentFor('#main', 'workspace-missions')).toBe('main');
  });
  it('with no # part the section of the address shows; with neither it is as before', () => {
    expect(fragmentFor('', 'workspace-missions')).toBe('workspace-missions');
    expect(fragmentFor('#', 'ops-gates')).toBe('ops-gates');
    expect(fragmentFor('', '')).toBe('');
    expect(fragmentFor('#workspace-audit', '')).toBe('workspace-audit');
  });
  it('the sign-in return list is not widened', () => {
    expect(operatorReturnTo('/operator/missions')).toBe('/operator');
    expect(operatorReturnTo('/operator#workspace-missions')).toBe('/operator#workspace-missions');
    expect(
      operatorReturnTo('/operator?workspace=11111111-1111-4111-8111-111111111111#ops-gates'),
    ).toBe('/operator?workspace=11111111-1111-4111-8111-111111111111#ops-gates');
  });
});

describe('every switch-off path', () => {
  it('is a real owner switch', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_UX_OPERATOR_URLS')?.kind).toBe('flag');
  });
  it('the section page answers not found with the switch off, before it reads anything', () => {
    const page = read('apps/web/app/operator/[section]/page.tsx');
    const off = page.indexOf("if (!uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS')) notFound();");
    expect(off).toBeGreaterThan(-1);
    expect(off).toBeLessThan(page.indexOf('(await params)'));
    expect(off).toBeLessThan(page.indexOf('<OperatorEntry'));
    expect(page).toContain('if (!section) notFound();');
  });
  it('the operator page is the same workspace through the same entry, with no section', () => {
    const page = read('apps/web/app/operator/page.tsx');
    expect(page).toContain('<OperatorEntry requested={(await searchParams).workspace} />');
    const entry = read('apps/web/app/operator/operator-entry.tsx');
    // Without a section the sign-in redirect is the address it always was.
    expect(entry).toContain("+ (section ? '#' + section : '')");
    expect(entry).toContain('initialSection={section}');
    // The text of every unavailable state is the text it always was.
    for (const line of [
      'The protected workspace is not configured in this environment.',
      'Your session needs a current authenticator check and an active membership.',
      'Invited contributors use their assigned-task link, which does not grant workspace',
    ])
      expect(entry).toContain(line);
  });
  it('the workspace keeps its tenant switch on /operator unless the address is a section', () => {
    const workspace = read('apps/web/app/operator/workspace.tsx');
    expect(workspace).toContain(
      "(initialSection && operatorSectionPath(initialSection)) || '/operator'",
    );
    expect(workspace).toContain('initialSection = ');
  });
  it('the view-as samples show only with the switch on, and are inside the inert stage', () => {
    const page = read('apps/web/app/operator/view-as/[role]/page.tsx');
    expect(page).toContain("{uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS') && <SampleScreens />}");
    expect(page.indexOf('<SampleScreens />')).toBeGreaterThan(
      page.indexOf('className="view-as-content" inert'),
    );
    expect(page.indexOf('<SampleScreens />')).toBeLessThan(page.indexOf('</main>'));
    const samples = read('apps/web/app/operator/view-as/[role]/sample-screens.tsx');
    // A plain server component with fixed invented data: the preview folder holds no client code.
    expect(samples).not.toMatch(/['"]use (client|server)['"]/);
    expect(samples).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|cookie/);
    // The protected preview rule: nothing that can act, so no link, no button and no form, and no
    // reading of this browser (the real Your Move screen has links and a "forget" button, so it is not used).
    expect(samples).not.toMatch(/<(Link|a|button|form|input)\b|href=|MoveView/);
    expect(samples).toContain('<MoveCard');
  });
  it('the Operations panel loads from the section it is shown for, so a section address loads it as a # part does', () => {
    const operations = read('apps/web/app/operator/operations.tsx');
    expect(operations).toContain('}, [section, load]);');
    expect(operations).not.toMatch(/window\.location\.hash|hashchange/);
    // The workspace hands it the section that follows the # part and, with the switch on, the address.
    expect(read('apps/web/app/operator/workspace.tsx')).toContain('section={fragment}');
  });
});

describe('signing in again from the workspace comes back to the same workspace and section', () => {
  const workspace = '11111111-1111-4111-8111-111111111111';
  const back = (hash: string, initialSection: string) =>
    decodeURIComponent(
      operatorSignInPath(workspace, fragmentFor(hash, initialSection)).split('?next=')[1]!,
    );
  it('a section address with no # part returns to that section as a # part', () => {
    expect(back('', 'workspace-sources')).toBe(
      '/operator?workspace=' + workspace + '#workspace-sources',
    );
  });
  it('a # part on a section address wins, as it does for what the workspace shows', () => {
    expect(back('#workspace-evidence', 'workspace-sources')).toBe(
      '/operator?workspace=' + workspace + '#workspace-evidence',
    );
  });
  it('a # part that is not a section keeps only the workspace, also on a section address', () => {
    for (const hash of [
      '#nonexistent',
      '#main',
      '#workspace-sources?token=x',
      '#//example.invalid',
    ])
      expect(back(hash, 'workspace-sources'), hash).toBe('/operator?workspace=' + workspace);
    expect(back('', '')).toBe('/operator?workspace=' + workspace);
  });
  it('the workspace link follows the # part through a store that reads nothing on the server', () => {
    const workspaceSource = read('apps/web/app/operator/workspace.tsx');
    expect(workspaceSource).toContain(
      'href={operatorSignInPath(tenant, fragmentFor(hash, initialSection))}',
    );
    expect(workspaceSource).toMatch(
      /useSyncExternalStore\(\s*subscribeToHash,\s*\(\) => window\.location\.hash,\s*\(\) => '',\s*\)/,
    );
    expect(workspaceSource).not.toContain('href="/operator/signin"');
    // Signing out still goes to the plain sign-in page, with no address to come back to.
    expect(workspaceSource).toContain("router.replace('/operator/signin');");
    expect(read('apps/web/app/operator/authenticator-check.tsx')).toContain(
      "operatorSignInPath(tenant, 'workspace-authenticator')",
    );
  });
});
