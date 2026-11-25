import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { canReadHelperInterest } from '../../apps/web/lib/helper-interest-client';
import { reservedOperatorSegments, sectionForSlug } from '../../apps/web/lib/operator-urls';
import { canTriage, problemReportQueueFragment } from '../../apps/web/lib/problem-report-queue';
import {
  applicationQueueFragment,
  canReadApplications,
} from '../../apps/web/lib/programme-application-queue';
import {
  deskGroupOf,
  deskGroups,
  deskOwnPages,
  deskPattern,
  deskPlaceAllowed,
  deskPlaceHref,
  deskSegmentsFor,
  deskTabTitle,
  isDeskPlace,
  type DeskOwnPageId,
} from '../../apps/web/lib/ux/page-pattern';
import {
  canOpenInbox,
  inboxHref,
  inboxHrefForOldAddress,
  inboxPath,
  inboxTabIds,
} from '../../apps/web/lib/ux/team-inbox';

// Team desk v4.1, units D17 (Settings), D18 (Inbox) and D19 (Supply), behind CORRIDRA_UX_TEAM_DESK_V41
// (docs/revamp/specs/team-desk-v4-1.md decision 5 and section 5). The Inbox and the Supply pages join the page
// pattern as pages of their own; nothing about the seventeen places, their groups or their role gates changes.
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'] as const;
const workspace = '00000000-0000-4000-8000-0000000000a1';
const read = (path: string) =>
  readFileSync(new URL(`../../apps/web/${path}`, import.meta.url), 'utf8');
const ownPages = Object.keys(deskOwnPages) as DeskOwnPageId[];

describe('the Inbox and the Supply pages in the page pattern', () => {
  test('each has a title and one plain purpose line, and is in no group', () => {
    expect(ownPages).toEqual([
      'inbox',
      'supply',
      'supply-dnc',
      'supply-mission',
      'supply-candidate',
    ]);
    for (const place of ownPages) {
      expect(isDeskPlace(place)).toBe(true);
      const { title, purpose, group } = deskPattern(place);
      expect(group).toBeNull();
      expect(deskGroupOf(place)).toBeNull();
      expect(title.length).toBeGreaterThan(0);
      expect(purpose).toMatch(/^[A-Z][^.!?\n]{10,90}\.$/);
      expect(title + purpose).not.toMatch(/[–—]/);
      expect(deskTabTitle(place)).toBe(title);
      // No segments: a page of its own shows one row at most, its own tabs.
      for (const role of [...roles, null])
        expect(
          deskSegmentsFor(place, role, { urls: true, ownerPage: true, workspace }).segments,
        ).toEqual([]);
    }
    expect(deskPattern('inbox').title).toBe('Inbox');
    // The Supply titles are the ones the pages have today.
    expect(deskPattern('supply').title).toBe('Supply Sources');
    expect(deskPattern('supply-dnc').title).toBe('Do Not Contact');
    expect(deskPattern('supply-mission').title).toBe('Supply Candidates');
    expect(deskPattern('supply-candidate').title).toBe('Candidate');
  });

  test('the Supply purpose line is the intro the hub had, word for word', () => {
    expect(read('app/operator/supply/supply-hub.tsx').replace(/\s+/g, ' ')).toContain(
      deskPattern('supply').purpose,
    );
  });

  test('a page of its own is never offered as a segment and no group gained one', () => {
    for (const place of ownPages)
      for (const role of [...roles, null]) expect(deskPlaceAllowed(place, role)).toBe(false);
    const grouped = Object.values(deskGroups).flatMap((group) =>
      group.segments.map((segment) => segment.id as string),
    );
    for (const place of ownPages) expect(grouped).not.toContain(place);
    // Assistance, Control Center and the owner page stay under Settings, in this order.
    expect(deskGroups.settings.segments.map((segment) => segment.id)).toEqual([
      'workspace-settings',
      'workspace-ai',
      'ops-center',
      'owner',
    ]);
  });

  test('their addresses are their own pages and keep the chosen workspace', () => {
    expect(deskPlaceHref('inbox', true, workspace)).toBe(`/operator/inbox?workspace=${workspace}`);
    expect(deskPlaceHref('inbox', false)).toBe('/operator/inbox');
    expect(deskPlaceHref('supply', true, workspace)).toBe(
      `/operator/supply?workspace=${workspace}`,
    );
    expect(deskPlaceHref('supply-dnc', false, workspace)).toBe(
      `/operator/supply/do-not-contact?workspace=${workspace}`,
    );
    // The Inbox folder is a real page, so no section may ever take its word.
    expect(reservedOperatorSegments).toContain('inbox');
    expect(sectionForSlug('inbox')).toBeNull();
  });
});

describe('the Inbox', () => {
  test('is for the roles that may read every one of its lists, and no other', () => {
    for (const role of [...roles, null, undefined, '']) {
      const every =
        canTriage(role ?? '') && canReadApplications(role ?? '') && canReadHelperInterest(role);
      expect(canOpenInbox(role), String(role)).toBe(every);
    }
    expect(roles.filter((role) => canOpenInbox(role))).toEqual(['owner', 'admin']);
  });

  test('its address keeps the workspace and names a tab only when one is asked for', () => {
    expect(inboxPath).toBe('/operator/inbox');
    expect(inboxHref()).toBe('/operator/inbox');
    expect(inboxHref(workspace)).toBe(`/operator/inbox?workspace=${workspace}`);
    expect(inboxHref(workspace, 'erasure')).toBe(
      `/operator/inbox?workspace=${workspace}&tab=erasure`,
    );
    expect(inboxHref('not-a-workspace', 'reports')).toBe('/operator/inbox?tab=reports');
    expect(inboxTabIds).toEqual(['reports', 'erasure', 'applications', 'helpers']);
  });

  test('every old address of a list inside Settings leads to the tab that holds the list', () => {
    const at = (fragment: string, settingsTab: string | null = null) =>
      inboxHrefForOldAddress({ fragment, settingsTab, workspace });
    const base = `/operator/inbox?workspace=${workspace}`;
    // A `#` link to an element inside a list keeps its `#` part, so the page lands on the element.
    expect(at(problemReportQueueFragment)).toBe(`${base}#problem-report-queue`);
    expect(at('erasure-queue-title')).toBe(`${base}#erasure-queue-title`);
    expect(at(applicationQueueFragment)).toBe(`${base}#programme-application-queue`);
    // A Settings tab, named in the `#` part or in ?tab=.
    expect(at('settings-reports')).toBe(`${base}&tab=reports`);
    expect(at('settings-erasure')).toBe(`${base}&tab=erasure`);
    expect(at('settings-applications')).toBe(`${base}&tab=applications`);
    expect(at('workspace-settings', 'settings-erasure')).toBe(`${base}&tab=erasure`);
    expect(at('workspace-settings', 'settings-reports')).toBe(`${base}&tab=reports`);
    expect(at('workspace-settings', 'settings-applications')).toBe(`${base}&tab=applications`);
  });

  test('every other address is left alone', () => {
    const at = (fragment: string, settingsTab: string | null = null) =>
      inboxHrefForOldAddress({ fragment, settingsTab, workspace });
    for (const fragment of [
      '',
      'main',
      'workspace-settings',
      'workspace-navigation',
      'workspace-network',
      'helper-interest-list',
      'constructor',
      '__proto__',
      'toString',
    ])
      expect(at(fragment), fragment).toBeNull();
    expect(at('workspace-settings', 'settings-policies')).toBeNull();
    expect(at('workspace-settings', 'constructor')).toBeNull();
    expect(at('workspace-settings', '')).toBeNull();
  });

  test('the page does not exist unless the team shell and the switch are both on', () => {
    const page = read('app/operator/inbox/page.tsx');
    const guard = page.indexOf(
      "if (!uxSwitchOn('CORRIDRA_UX_SHELLS_V2') || !uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41')) notFound();",
    );
    expect(guard).toBeGreaterThan(0);
    // Nothing is read before the guard: no session, no workspace.
    expect(page.indexOf('foundations()')).toBeGreaterThan(guard);
    expect(page.indexOf('searchParams).workspace')).toBeGreaterThan(guard);
  });

  test('the page draws the lists the desk already has and adds no read and no count of its own', () => {
    const lists = read('app/operator/inbox/inbox-lists.tsx');
    for (const list of [
      '<ProblemReportQueue tenant={tenant} role={role} tabbed />',
      '<ErasureQueue tenant={tenant} role={role} problemReports={problemReports} tabbed />',
      '<ProgrammeApplicationQueue tenant={tenant} role={role} tabbed />',
      '<HelperInterestList tenant={tenant} role={role} installed tabbed />',
    ])
      expect(lists).toContain(list);
    // The only request the page itself makes asks whether the helper interest register is installed.
    expect(lists).not.toMatch(/\bfetch\(/);
    expect(lists.match(/helperInterestInstalled\(/g)).toHaveLength(1);
    expect(lists).not.toMatch(/total|count|\.length/i);
  });
});

describe('Settings with the switch on', () => {
  test('the route list reads the catalogue the page already loads and sends nothing', () => {
    const source = read('app/operator/review-settings.tsx');
    const list = source.slice(
      source.indexOf('function RouteList('),
      source.indexOf('/**\n * Guided "Add route pack" form'),
    );
    expect(list.length).toBeGreaterThan(200);
    expect(list).not.toMatch(/fetch\(|request\(|withStepUp|onClick|onSubmit|<form|<button/);
    // Decision 3: no line that says qualification needs a route or a pack.
    expect(list.replace(/\/\*\*[\s\S]*?\*\//g, '')).not.toMatch(/qualif/i);
  });

  test('the workspace sends an old list address to the Inbox only with the switch on', () => {
    const source = read('app/operator/workspace.tsx');
    const effect = source.slice(
      source.indexOf('// Team desk v4.1 (unit D18): the lists that sat inside Settings'),
    );
    expect(effect.slice(0, 700)).toContain(
      'if (!deskV41 || !loaded || !canOpenInbox(currentRole)) return;',
    );
    expect(effect.slice(0, 700)).toContain('if (inbox) window.location.replace(inbox);');
  });
});
