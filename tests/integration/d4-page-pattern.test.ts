import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { operatorSectionPath } from '../../apps/web/lib/operator-urls';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import {
  deskGroupOf,
  deskGroups,
  deskPattern,
  deskPlaceAllowed,
  deskPlaceHref,
  deskSegmentsFor,
  deskStatusPlace,
  isDeskPlace,
  type DeskPlaceId,
} from '../../apps/web/lib/ux/page-pattern';
import { teamSectionHref } from '../../apps/web/lib/ux/shells';
import { workspaceSections } from '../../apps/web/lib/workspace-navigation';

// Team desk v4.1, unit D4 (docs/revamp/specs/team-desk-v4-1.md section 5): one page pattern behind
// CORRIDRA_UX_TEAM_DESK_V41. The pattern only names and groups places that already exist, so every address and
// every role gate must be exactly what it was.
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'] as const;
const read = (path: string) =>
  readFileSync(new URL(`../../apps/web/${path}`, import.meta.url), 'utf8');
const everyPlace: DeskPlaceId[] = ['home', 'owner', ...workspaceSections.map((s) => s.id)];
const workspace = '00000000-0000-4000-8000-0000000000a1';

describe('the switch', () => {
  test('is registered, described for the owner and off unless exactly "true"', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_UX_TEAM_DESK_V41');
    const entry = switchRegistry.find((item) => item.name === 'CORRIDRA_UX_TEAM_DESK_V41');
    expect(entry).toMatchObject({ label: 'Team desk v4.1', group: 'Team access', kind: 'flag' });
    expect(uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', {} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', {
        CORRIDRA_UX_TEAM_DESK_V41: 'TRUE',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', {
        CORRIDRA_UX_TEAM_DESK_V41: 'true',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});

describe('every place has one title and one purpose line', () => {
  test('all seventeen places and the owner page are covered, with nothing else', () => {
    for (const place of everyPlace) expect(isDeskPlace(place)).toBe(true);
    expect(isDeskPlace('workspace-navigation')).toBe(false);
    expect(isDeskPlace('constructor')).toBe(false);
  });
  for (const place of everyPlace) {
    test(`${place}: a title and a single plain sentence`, () => {
      const { title, purpose } = deskPattern(place);
      expect(title.length).toBeGreaterThan(0);
      expect(purpose).toMatch(/^[A-Z][^.!?\n]{10,90}\.$/);
      // No dash characters in visible words and no label in capitals.
      expect(title + purpose).not.toMatch(/[–—]/);
      expect(title).not.toBe(title.toUpperCase());
    });
  }
  test('the titles are the menu words: Network is Helpers and a grouped page carries its group word', () => {
    expect(deskPattern('home').title).toBe('Today');
    expect(deskPattern('workspace-network').title).toBe('Helpers');
    expect(deskPattern('workspace-missions').title).toBe('Missions');
    expect(deskPattern('workspace-commercial').title).toBe('Money');
    expect(deskPattern('workspace-delivery').title).toBe('Reports');
    expect(deskPattern('workspace-sources').title).toBe('Companies');
    expect(deskPattern('ops-gates').title).toBe('Status');
    expect(deskPattern('workspace-controls').title).toBe('Team and access');
    expect(deskPattern('owner').title).toBe('Settings');
  });
});

describe('where the seventeen places go', () => {
  test('the four groups hold exactly the places the plan names, in order', () => {
    const ids = (key: keyof typeof deskGroups) => deskGroups[key].segments.map((s) => s.id);
    const labels = (key: keyof typeof deskGroups) => deskGroups[key].segments.map((s) => s.label);
    expect(ids('companies')).toEqual([
      'workspace-research',
      'workspace-sources',
      'workspace-evidence',
    ]);
    expect(labels('companies')).toEqual(['Companies', 'Sources and claims', 'Evidence review']);
    expect(ids('status')).toEqual([
      'workspace-operations',
      'ops-dashboard',
      'ops-health',
      'ops-gates',
    ]);
    expect(labels('status')).toEqual(['Operations', 'Dashboard', 'Health', 'Readiness']);
    expect(ids('team')).toEqual(['workspace-audit', 'workspace-controls']);
    expect(labels('team')).toEqual(['Audit', 'People and access']);
    expect(ids('settings')).toEqual(['workspace-settings', 'workspace-ai', 'ops-center', 'owner']);
    expect(labels('settings')).toEqual(['Settings', 'Assistance', 'Control Center', 'Owner page']);
  });
  test('no place sits in two groups and the stand-alone places show no segments', () => {
    const grouped = Object.values(deskGroups).flatMap((group) => group.segments.map((s) => s.id));
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const place of [
      'home',
      'workspace-missions',
      'workspace-meetings',
      'workspace-network',
      'workspace-commercial',
      'workspace-delivery',
      'workspace-authenticator',
    ] as const) {
      expect(deskGroupOf(place)).toBeNull();
      expect(
        deskSegmentsFor(place, 'owner', { urls: true, ownerPage: true }).segments,
      ).toHaveLength(0);
    }
  });
  test('the scanning line belongs to the Status pages only', () => {
    expect(everyPlace.filter(deskStatusPlace)).toEqual([
      'workspace-operations',
      'ops-dashboard',
      'ops-health',
      'ops-gates',
    ]);
  });
});

describe('every address stays', () => {
  for (const urls of [true, false]) {
    test(`a segment opens the address the place always had (section addresses ${urls ? 'on' : 'off'})`, () => {
      for (const section of workspaceSections) {
        expect(deskPlaceHref(section.id, urls, workspace)).toBe(
          teamSectionHref(section.id, urls, workspace),
        );
        if (urls) expect(deskPlaceHref(section.id, true)).toBe(operatorSectionPath(section.id));
        else expect(deskPlaceHref(section.id, false)).toBe('/operator#' + section.id);
      }
      expect(deskPlaceHref('home', urls, workspace)).toBe('/operator?workspace=' + workspace);
      expect(deskPlaceHref('owner', urls, workspace)).toBe('/operator/owner');
    });
  }
  test('the chosen workspace is kept in a segment link and exactly one segment is the current page', () => {
    const { label, segments } = deskSegmentsFor('workspace-sources', 'owner', {
      urls: true,
      ownerPage: true,
      workspace,
    });
    expect(label).toBe('Companies pages');
    expect(segments.map((s) => s.href)).toEqual([
      '/operator/research?workspace=' + workspace,
      '/operator/sources?workspace=' + workspace,
      '/operator/evidence?workspace=' + workspace,
    ]);
    expect(segments.filter((s) => s.current).map((s) => s.id)).toEqual(['workspace-sources']);
  });
});

describe('a segment never shows a place the role may not open', () => {
  for (const role of roles) {
    test(`${role}: each listed segment is in the section's own role list`, () => {
      for (const place of everyPlace) {
        const { segments } = deskSegmentsFor(place, role, { urls: true, ownerPage: true });
        for (const segment of segments) {
          if (segment.id === 'owner') expect(['owner', 'admin']).toContain(role);
          else
            expect(
              workspaceSections.find((s) => s.id === segment.id)!.roles as readonly string[],
            ).toContain(role);
        }
        // Segments are shown only on a page that is one of them, and never as a single link.
        if (segments.length) {
          expect(segments.length).toBeGreaterThan(1);
          expect(segments.filter((s) => s.current)).toHaveLength(1);
        }
      }
    });
  }
  test('the role lists are the workspace rule, unchanged', () => {
    for (const role of roles)
      for (const section of workspaceSections)
        expect(deskPlaceAllowed(section.id, role)).toBe(
          (section.roles as readonly string[]).includes(role),
        );
  });
  test('with the role not yet known only what every role may open is listed', () => {
    expect(
      deskSegmentsFor('workspace-research', null, { urls: true, ownerPage: true }).segments.map(
        (s) => s.id,
      ),
    ).toEqual(['workspace-research', 'workspace-sources', 'workspace-evidence']);
    for (const place of ['workspace-operations', 'workspace-audit', 'workspace-settings'] as const)
      expect(deskSegmentsFor(place, null, { urls: true, ownerPage: true }).segments).toEqual([]);
  });
  test('examples: an operator sees Status but not Team and access; the owner page needs its switch', () => {
    const ids = (place: DeskPlaceId, role: string, ownerPage = true) =>
      deskSegmentsFor(place, role, { urls: true, ownerPage }).segments.map((s) => s.id);
    expect(ids('ops-health', 'operator')).toEqual([
      'workspace-operations',
      'ops-dashboard',
      'ops-health',
      'ops-gates',
    ]);
    expect(ids('workspace-audit', 'admin')).toEqual([]);
    expect(ids('workspace-audit', 'owner')).toEqual(['workspace-audit', 'workspace-controls']);
    expect(ids('workspace-settings', 'admin')).toEqual([
      'workspace-settings',
      'workspace-ai',
      'ops-center',
      'owner',
    ]);
    expect(ids('workspace-settings', 'admin', false)).toEqual([
      'workspace-settings',
      'workspace-ai',
      'ops-center',
    ]);
    // A reviewer may open Assistance but not Settings: one link is no row.
    expect(ids('workspace-ai', 'reviewer')).toEqual([]);
  });
});

describe('switch off, every header is the one it was', () => {
  test('each changed header reads the switch and keeps its old words for the off state', () => {
    const entry = read('app/operator/operator-entry.tsx');
    expect(entry).toContain("uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41')");
    expect(entry).toContain("shellsV2 ? 'TEAM WORKSPACE' : 'OPERATOR WORKSPACE'");
    expect(entry).toContain('<TeamSecondLevel');
    expect(read('app/operator/owner/page.tsx')).toContain("'OWNER PAGE'");
    expect(read('app/operator/owner/page.tsx')).toContain("'What is on and off.'");
    expect(read('app/operator/[section]/[missionId]/page.tsx')).toContain("'MISSION'");
    expect(read('app/operator/missions.tsx')).toContain(
      '{deskV41 ? null : <p className="label">OPS HOME</p>}',
    );
    expect(read('app/operator/access.tsx')).toContain(
      '{deskV41 ? null : <p className="label">CONTROLLED ACCESS</p>}',
    );
  });
  test('the client flag is off by default, so a screen outside the team shell keeps its jump links', () => {
    expect(read('app/operator/operator-flags.tsx')).toContain('deskV41: false');
    expect(read('app/operator/operator-flags.tsx')).toContain('deskV41 = false');
    expect(read('components/operator-workbench.tsx')).toContain('if (deskV41) return null;');
  });
});
