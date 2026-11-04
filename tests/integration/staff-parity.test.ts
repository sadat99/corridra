import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  operatorSlugs,
  operatorSectionPath,
  reservedOperatorSegments,
  sectionForSlug,
} from '../../apps/web/lib/operator-urls';
import { operatorReturnTo, workspaceSections } from '../../apps/web/lib/workspace-navigation';
import {
  sectionAllowedFor,
  teamNavigation,
  teamSectionHref,
  teamSettingsSections,
} from '../../apps/web/lib/ux/shells';

// Staff parity (revamp Wave 5, step B1). This freezes what the staff workspace offers today: the 18
// section IDs, their address words, labels and permitted roles, every address form and every
// internal link. Regrouping the navigation (Today, Work, Companies, Delivery, More) may move links
// around; it may not remove, rename or widen anything listed here. A change that must alter this
// table is a product decision and edits the table in the same PR, visibly. Grouping never grants
// access: the server still decides every action.

const all = ['owner', 'admin', 'operator', 'reviewer', 'viewer'];
const noViewer = ['owner', 'admin', 'operator', 'reviewer'];
const staff = ['owner', 'admin', 'operator'];
const frozen: [string, string, string, string[]][] = [
  ['workspace-missions', 'missions', 'Missions and requirements', all],
  ['workspace-research', 'research', 'Companies and research', all],
  ['workspace-meetings', 'meetings', 'Introductions and meetings', all],
  ['workspace-commercial', 'commercial', 'Commercial progress', all],
  ['workspace-delivery', 'delivery', 'Client and institution delivery', all],
  ['workspace-sources', 'sources', 'Sources and claims', all],
  ['workspace-evidence', 'evidence', 'Evidence review', all],
  ['workspace-ai', 'assistance', 'AI assistance', noViewer],
  ['workspace-network', 'network', 'Execution network', noViewer],
  ['workspace-operations', 'operations', 'Global operations', staff],
  ['ops-dashboard', 'dashboard', 'Mission dashboard and economics', staff],
  ['ops-center', 'control-center', 'Corridor Control Center', ['owner', 'admin']],
  ['ops-health', 'health', 'Recovery and health', staff],
  ['ops-gates', 'readiness', 'Production readiness', staff],
  ['workspace-settings', 'settings', 'Corridors and policies', ['owner', 'admin']],
  ['workspace-audit', 'audit', 'Access and audit', ['owner', 'admin']],
  ['workspace-authenticator', 'authenticator', 'Authenticator', all],
  ['workspace-controls', 'controls', 'Workspace controls', ['owner']],
];
const reserved = ['owner', 'setup', 'signin', 'forgot-password', 'reset-password', 'view-as'];
const root = join(__dirname, '../../apps/web');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('the 18 staff sections', () => {
  it('keep their IDs, address words, labels and permitted roles', () => {
    expect(
      workspaceSections.map((s) => [s.id, operatorSlugs[s.id], s.label, [...s.roles]]),
    ).toEqual(frozen);
    expect(workspaceSections).toHaveLength(18);
  });
  it('keep the reserved pages under /operator, each a real page', () => {
    expect([...reservedOperatorSegments]).toEqual(reserved);
    for (const word of reserved) {
      expect(
        existsSync(
          join(root, 'app/operator', word, word === 'view-as' ? '[role]' : '', 'page.tsx'),
        ),
        word,
      ).toBe(true);
    }
  });
});

describe('every address form of every section', () => {
  for (const [id, slug] of frozen) {
    it(`${id}: /operator/${slug}, the # link and the sign-in return`, () => {
      expect(operatorSectionPath(id)).toBe('/operator/' + slug);
      expect(sectionForSlug(slug)).toBe(id);
      expect(teamSectionHref(id, true)).toBe('/operator/' + slug);
      expect(teamSectionHref(id, false)).toBe('/operator#' + id);
      expect(operatorReturnTo('/operator#' + id)).toBe('/operator#' + id);
      const workspace = '12345678-abcd-1234-abcd-123456789abc';
      expect(teamSectionHref(id, true, workspace)).toBe(
        '/operator/' + slug + '?workspace=' + workspace,
      );
      expect(teamSectionHref(id, false, workspace)).toBe(
        '/operator?workspace=' + workspace + '#' + id,
      );
    });
  }
  it('Today is /operator, with or without section addresses', () => {
    expect(teamSectionHref(undefined, true)).toBe('/operator');
    expect(teamSectionHref(undefined, false)).toBe('/operator');
  });
});

describe('navigation reaches every section for exactly the roles that may open it', () => {
  const reachable = (role: string) => {
    const ids = new Set<string>();
    for (const entry of teamNavigation) {
      if (entry.section && sectionAllowedFor(entry.section, role)) ids.add(entry.section);
    }
    for (const id of teamSettingsSections) if (sectionAllowedFor(id, role)) ids.add(id);
    return ids;
  };
  for (const role of all) {
    it(`${role} reaches ${frozen.filter((f) => f[3].includes(role)).length} sections, no more, no fewer`, () => {
      const expected = frozen.filter((f) => f[3].includes(role)).map((f) => f[0]);
      const got = reachable(role);
      expect([...got].sort()).toEqual([...expected].sort());
    });
  }
  it('every section is reachable by at least one role in one or two clicks', () => {
    const ids = new Set([
      ...teamNavigation.flatMap((e) => (e.section ? [e.section] : [])),
      ...teamSettingsSections,
    ]);
    expect([...ids].sort()).toEqual(frozen.map((f) => f[0]).sort());
  });
});

describe('every internal staff link in the web app points at something that exists', () => {
  const ids = new Set(frozen.map((f) => f[0]));
  const slugs = new Set([...frozen.map((f) => f[1]), ...reserved]);
  const files = sourceFiles(root).filter((f) => !/\.next|node_modules/.test(f));
  it('every #workspace-* and #ops-* literal is a section (or the navigation anchor)', () => {
    const bad: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/#((?:workspace|ops)-[a-z]+(?:-[a-z]+)*)/g)) {
        if (m[1] !== 'workspace-navigation' && !ids.has(m[1]!)) bad.push(file + ' ' + m[1]);
      }
    }
    expect(bad).toEqual([]);
  });
  it('every literal /operator/<word> address is a section word or a reserved page', () => {
    const bad: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/['"`]\/operator\/([a-z][a-z-]*)/g)) {
        if (!slugs.has(m[1]!)) bad.push(file + ' ' + m[1]);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the gates that decide access stay where they are', () => {
  it('a section address is not found with the address switch off or for an unknown word', () => {
    const page = read('app/operator/[section]/page.tsx');
    expect(page).toContain("if (!uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS')) notFound();");
    expect(page).toContain('if (!section) notFound();');
  });
  it('a mission address needs the missions word, the switch and a well-formed id', () => {
    const page = read('app/operator/[section]/[missionId]/page.tsx');
    expect(page).toContain("section !== 'missions' || !uxSwitchOn('CORRIDRA_UX_MISSIONS_V2')");
    expect(page).toContain('.test(missionId)');
  });
  it('the workspace opens a section only for a role the table allows, and controls only for owner', () => {
    const workspace = read('app/operator/workspace.tsx');
    expect(workspace).toContain("(section.roles as readonly string[]).includes(currentRole ?? '')");
    expect(workspace).toContain("shown('workspace-controls') && data.role === 'owner'");
  });
  it('the Team shell keeps the in-place authenticator dialog and the role-only sidebar', () => {
    const frame = read('components/ux/team-frame.tsx');
    expect(frame).toContain('StepUpDialog');
    expect(frame).toContain('TeamSidebar');
    expect(read('components/ux/team-sidebar.tsx')).toContain('sectionAllowedFor');
  });
});
