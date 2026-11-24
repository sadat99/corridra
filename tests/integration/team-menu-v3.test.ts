import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { canTriage, problemReportQueueFragment } from '../../apps/web/lib/problem-report-queue';
import { operatorSlugs } from '../../apps/web/lib/operator-urls';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import {
  inboxLeadTab,
  inboxTabs,
  menuGroupsFor,
  menuItemForAddress,
  menuItemHref,
  menuPlacesFor,
  menuV3,
  placeHref,
  settingsLevel,
  teamAccountPlaces,
  teamItemsFor,
  teamMap,
  teamPins,
  teamPlacesFor,
  type MenuItem,
  type MenuItemKey,
  type TeamPlaceId,
} from '../../apps/web/lib/ux/team-map';

// Menu v3 (team desk v4.1 unit D3, Class A; docs/revamp/specs/team-desk-v4-1.md decision 1): navigation only regroups
// the same seventeen places, so no role gains or loses a place and no address moves.
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer', null] as const;
const workspace = '123e4567-e89b-42d3-a456-426614174000';
const read = (path: string) =>
  readFileSync(new URL(`../../apps/web/${path}`, import.meta.url), 'utf8');
const item = (key: MenuItemKey): MenuItem =>
  menuV3.flatMap((group) => group.items).find((entry) => entry.key === key)!;

/** What a role reaches before menu v3: the sidebar groups, the Settings level and the avatar menu. */
function reachableBefore(role: string | null): Set<TeamPlaceId> {
  const found = new Set<TeamPlaceId>();
  for (const entry of teamItemsFor(role, false))
    for (const place of teamPlacesFor(entry, role)) found.add(place.id);
  for (const place of settingsLevel(role)) found.add(place.id);
  for (const place of teamAccountPlaces(role)) found.add(place.id);
  return found;
}
/** What a role reaches with menu v3: the places of the items it sees, and the avatar menu (unchanged). */
function reachableV3(role: string | null, supply = false): Set<TeamPlaceId> {
  const found = new Set<TeamPlaceId>();
  for (const group of menuGroupsFor(role, { supply }))
    for (const entry of group.items)
      for (const place of menuPlacesFor(entry, role)) found.add(place.id);
  for (const place of teamAccountPlaces(role)) found.add(place.id);
  return found;
}

describe('menu v3 keeps every place and every role gate', () => {
  for (const role of roles)
    test(`${role ?? 'unknown role'}: the union of places equals the places before the change`, () => {
      expect([...reachableV3(role)].sort()).toEqual([...reachableBefore(role)].sort());
      // Supply is a page of its own, not one of the places: listing it changes no place a role reaches.
      expect([...reachableV3(role, true)].sort()).toEqual([...reachableBefore(role)].sort());
    });
  test('the seventeen places of the old map plus Control Center and the owner page, none dropped, none twice', () => {
    const ids = menuV3
      .flatMap((group) => group.items.flatMap((entry) => entry.places))
      .map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(
      [
        ...teamMap.flatMap((entry) => entry.places.map((place) => place.id)),
        'ops-center',
        'owner',
      ].sort(),
    );
    expect(teamMap.flatMap((entry) => entry.places)).toHaveLength(17);
    // Every section with an address is in the menu or (the Authenticator) in the avatar menu.
    for (const id of Object.keys(operatorSlugs))
      expect(ids.includes(id as TeamPlaceId) || id === 'workspace-authenticator').toBe(true);
    for (const role of roles)
      expect(teamAccountPlaces(role).some((place) => place.id === 'workspace-authenticator')).toBe(
        true,
      );
  });
});

describe('four visible groups, one click to every item, no second level', () => {
  test('the groups and their items, in the order of decision 1', () => {
    expect(menuV3.map((group) => [group.label, group.items.map((entry) => entry.label)])).toEqual([
      ['Work', ['Today', 'Missions', 'Meetings', 'Inbox']],
      ['People and companies', ['Companies', 'Helpers', 'Supply']],
      ['Results', ['Money', 'Reports']],
      ['Admin', ['Team and Access', 'Settings', 'Status']],
    ]);
    expect(menuGroupsFor('owner', { supply: true }).map((group) => group.items.length)).toEqual([
      4, 3, 2, 3,
    ]);
  });
  test('where the places that are no longer menu items go', () => {
    const labels = (key: MenuItemKey) => item(key).places.map((place) => place.label);
    expect(labels('companies')).toEqual(['Companies', 'Sources and claims', 'Evidence review']);
    expect(labels('status')).toEqual(['Operations', 'Dashboard', 'Health', 'Readiness']);
    expect(labels('team')).toEqual(['People and access', 'Audit']);
    expect(labels('settings')).toEqual([
      'Routes and settings',
      'Assistance',
      'Control Center',
      'Owner page',
    ]);
    // Network is shown as Helpers; its address is unchanged.
    expect(item('helpers').places).toEqual([{ id: 'workspace-network', label: 'Helpers' }]);
    expect(menuItemHref(item('helpers'), 'operator', true)).toBe('/operator/network');
  });
  test('every icon is one of the owned family', () => {
    // Read as text: the icon file is a component, and these tests are compiled without JSX.
    const icons = read('components/corridra-icon.tsx');
    const paths = icons.slice(icons.indexOf('export const iconPaths'), icons.indexOf('} as const'));
    for (const entry of menuV3.flatMap((group) => group.items))
      expect(paths).toMatch(new RegExp(`\\n  ${entry.icon}:`));
    expect(read('components/operator-icon.tsx')).toContain('<CorridraIcon name={name}');
  });
  test('each role sees only items it may open, and each item leads to a place it may open', () => {
    const seen = (role: string | null) =>
      menuGroupsFor(role, { supply: true }).flatMap((group) => group.items.map((e) => e.key));
    expect(seen('owner')).toEqual([
      'today',
      'missions',
      'meetings',
      'inbox',
      'companies',
      'helpers',
      'supply',
      'money',
      'reports',
      'team',
      'settings',
      'status',
    ]);
    expect(seen('admin')).toEqual(seen('owner'));
    expect(seen('operator')).toEqual([
      'today',
      'missions',
      'meetings',
      'companies',
      'helpers',
      'supply',
      'money',
      'reports',
      'settings',
      'status',
    ]);
    expect(seen('reviewer')).toEqual([
      'today',
      'missions',
      'meetings',
      'companies',
      'helpers',
      'supply',
      'money',
      'reports',
      'settings',
    ]);
    expect(seen('viewer')).toEqual([
      'today',
      'missions',
      'meetings',
      'companies',
      'supply',
      'money',
      'reports',
    ]);
    expect(seen(null)).toEqual(['today', 'missions', 'meetings', 'companies', 'money', 'reports']);
    // An item never leads to a place its role may not open: an operator's Settings is Assistance, an admin's
    // Team and access is Audit (People and access is the owner's).
    expect(menuItemHref(item('settings'), 'operator', true)).toBe('/operator/assistance');
    expect(menuItemHref(item('settings'), 'owner', true)).toBe('/operator/settings');
    expect(menuItemHref(item('team'), 'admin', true)).toBe('/operator/audit');
    expect(menuItemHref(item('team'), 'owner', true)).toBe('/operator/controls');
    expect(menuItemHref(item('status'), 'operator', true)).toBe('/operator/operations');
  });
  test('addresses are the ones every earlier link used, with the chosen workspace kept', () => {
    for (const urls of [true, false])
      for (const entry of menuV3.flatMap((group) => group.items).filter((e) => !e.special))
        expect(menuItemHref(entry, 'owner', urls, workspace)).toBe(
          placeHref(entry.places[0]!.id, urls, workspace),
        );
    expect(menuItemHref(item('today'), 'viewer', true, workspace)).toBe(
      `/operator?workspace=${workspace}`,
    );
    expect(menuItemHref(item('supply'), 'owner', true, workspace)).toBe(
      `/operator/supply?workspace=${workspace}`,
    );
  });
  test('Supply is listed only while its pages exist', () => {
    for (const role of roles)
      expect(
        menuGroupsFor(role, {}).some((group) => group.items.some((e) => e.key === 'supply')),
      ).toBe(false);
    expect(read('app/operator/supply/supply-page.tsx')).toContain(
      "if (!uxSwitchOn('CORRIDRA_SUPPLY_SOURCES')) notFound();",
    );
    expect(read('app/operator/layout.tsx')).toContain(
      "supply={uxSwitchOn('CORRIDRA_SUPPLY_SOURCES')}",
    );
  });
});

describe('Inbox (decision 5)', () => {
  test('only the roles that triage, at the address of the Inbox page (unit D18)', () => {
    for (const role of roles)
      expect(menuGroupsFor(role).some((group) => group.items.some((e) => e.key === 'inbox'))).toBe(
        canTriage(role),
      );
    // One address, whatever the section addresses and whatever is offered: the page opens on its first list.
    for (const urls of [true, false])
      for (const options of [{}, { problemReports: true }, { problemReports: false }]) {
        expect(menuItemHref(item('inbox'), 'owner', urls, workspace, options)).toBe(
          `/operator/inbox?workspace=${workspace}`,
        );
        expect(menuItemHref(item('inbox'), 'admin', urls, '', options)).toBe('/operator/inbox');
      }
    // The tab that led the queues inside Settings is still named, so an old link to it lights Inbox.
    expect(inboxLeadTab({ problemReports: true })).toBe('settings-reports');
    expect(inboxLeadTab()).toBe('settings-erasure');
    // The frame hands the menu what the server decided.
    expect(read('components/ux/team-sidebar.tsx')).toContain(
      'problemReports={!!legacy.problemReports}',
    );
    // With the switch off the queues stay inside Settings, under the same tab words.
    const tabs = read('app/operator/workspace.tsx');
    for (const tab of inboxTabs) expect(tabs).toContain(`id: '${tab}'`);
  });
  test('no count in the menu: menu v3 reads no queue and draws no number', () => {
    const sidebar = read('components/ux/team-sidebar.tsx');
    const menu = sidebar.slice(
      sidebar.indexOf('function TeamMenuV3'),
      sidebar.indexOf('function TeamSidebarV1'),
    );
    expect(menu.length).toBeGreaterThan(500);
    expect(menu).not.toMatch(/count|PinCounts|teamPins/i);
    expect(menu).not.toContain('<details');
    expect(menu).not.toContain('<summary');
  });
});

describe('which item is lit for each address', () => {
  const lit = (
    place: TeamPlaceId,
    role: string | null,
    more: { pathname?: string; search?: string; hash?: string; supply?: boolean } = {},
  ) =>
    menuItemForAddress(
      { place, pathname: more.pathname ?? '/operator', search: more.search, hash: more.hash },
      role,
      { supply: more.supply ?? true },
    );
  test('every place lights the item that holds it', () => {
    const expected: Record<string, MenuItemKey> = {
      home: 'today',
      'workspace-missions': 'missions',
      'workspace-meetings': 'meetings',
      'workspace-research': 'companies',
      'workspace-sources': 'companies',
      'workspace-evidence': 'companies',
      'workspace-network': 'helpers',
      'workspace-commercial': 'money',
      'workspace-delivery': 'reports',
      'workspace-controls': 'team',
      'workspace-audit': 'team',
      'workspace-settings': 'settings',
      'workspace-ai': 'settings',
      'ops-center': 'settings',
      owner: 'settings',
      'workspace-operations': 'status',
      'ops-dashboard': 'status',
      'ops-health': 'status',
      'ops-gates': 'status',
    };
    for (const [place, key] of Object.entries(expected))
      expect(lit(place as TeamPlaceId, 'owner')).toBe(key);
    expect(Object.keys(expected)).toHaveLength(19);
  });
  test('a mission page is inside Missions; the Authenticator and avatar menu pages light nothing', () => {
    expect(lit('workspace-missions', 'operator', { pathname: '/operator/missions/abc' })).toBe(
      'missions',
    );
    expect(lit('workspace-authenticator', 'owner')).toBe('none');
    expect(lit('home', 'owner', { pathname: '/operator/problem-reports' })).toBe('none');
    expect(lit('home', 'owner', { pathname: '/operator/invoice-issuer' })).toBe('none');
  });
  test('Supply pages light Supply, never Today or Missions', () => {
    expect(lit('home', 'operator', { pathname: '/operator/supply' })).toBe('supply');
    expect(
      lit('workspace-missions', 'operator', { pathname: '/operator/supply/missions/abc' }),
    ).toBe('supply');
    expect(lit('home', 'operator', { pathname: '/operator/supply', supply: false })).toBe('none');
  });
  test('the Inbox page lights Inbox for the roles that have it, and nothing for the others', () => {
    for (const role of ['owner', 'admin'])
      expect(lit('home', role, { pathname: '/operator/inbox' })).toBe('inbox');
    for (const role of ['operator', 'reviewer', 'viewer'])
      expect(lit('home', role, { pathname: '/operator/inbox' })).toBe('none');
    expect(lit('home', 'owner', { pathname: '/operator/inbox', search: '?tab=erasure' })).toBe(
      'inbox',
    );
  });
  test('Settings on a queue tab lights Inbox for the roles that have it; otherwise Settings', () => {
    for (const tab of inboxTabs)
      expect(lit('workspace-settings', 'owner', { search: `?tab=${tab}` })).toBe('inbox');
    expect(lit('workspace-settings', 'owner', { search: '?tab=settings-policies' })).toBe(
      'settings',
    );
    expect(lit('workspace-settings', 'owner')).toBe('settings');
    expect(lit('home', 'admin', { hash: `#${problemReportQueueFragment}` })).toBe('inbox');
    expect(lit('home', 'admin', { hash: '#erasure-queue-title' })).toBe('inbox');
    // A queue tab word on another page, or for a role with no Inbox, lights nothing extra.
    expect(lit('workspace-missions', 'owner', { search: '?tab=settings-erasure' })).toBe(
      'missions',
    );
    expect(lit('home', 'operator', { hash: `#${problemReportQueueFragment}` })).toBe('today');
  });
  test('a place a role may not open lights nothing it does not see', () => {
    expect(lit('workspace-settings', 'viewer')).toBe('none');
    expect(lit('workspace-operations', 'reviewer')).toBe('none');
    expect(lit('workspace-ai', 'reviewer')).toBe('settings');
  });
});

describe('the switch', () => {
  test('is named, described for the owner, and off unless exactly "true"', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_UX_TEAM_DESK_V41');
    const entry = switchRegistry.find((e) => e.name === 'CORRIDRA_UX_TEAM_DESK_V41');
    expect(entry?.label).toBe('Team desk v4.1');
    expect(entry?.group).toBe('Team access');
    expect(uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', {})).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', { CORRIDRA_UX_TEAM_DESK_V41: '1' })).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', { CORRIDRA_UX_TEAM_DESK_V41: 'true' })).toBe(
      true,
    );
  });
  test('off, the sidebar is the one before it: the frame and the sidebar default to off', () => {
    expect(read('app/operator/layout.tsx')).toContain(
      "deskV41={uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41')}",
    );
    expect(read('components/ux/team-frame.tsx')).toContain('deskV41 = false');
    const sidebar = read('components/ux/team-sidebar.tsx');
    expect(sidebar).toContain('deskV41 = false');
    expect(sidebar).toMatch(
      /deskV41 \? \(\s*<TeamMenuV3[^:]+: \(\s*<TeamSidebarV1 \{\.\.\.legacy\} \/>/,
    );
    // The second tab bar and the workspace toolbar go only under the value the frame provides (false by default).
    expect(read('lib/ux/team-desk-v41.ts')).toContain(
      'export const TeamDeskV41Context = createContext(false);',
    );
    expect(read('components/ux/team-frame.tsx')).toContain(
      '<TeamDeskV41Context.Provider value={deskV41}>',
    );
    expect(read('components/ux/team-second-level.tsx')).toContain('if (deskV41) return null;');
    const workspace = read('app/operator/workspace.tsx');
    expect(workspace).toMatch(/\{menuV3 \? null : \(\s*<div className="operator-toolbar">/);
    // One guarded change of workspace, shared by the toolbar select and the one in the menu; one id.
    expect(workspace).toContain('onChange={(e) => chooseTenant(e.target.value)}');
    expect(workspace).toContain('choose: (next) => chooseRef.current(next),');
    expect(workspace.match(/Switch workspace\? Unsaved entries/g)).toHaveLength(1);
    expect(workspace.match(/id="operator-workspace-select"/g)).toHaveLength(1);
    expect(sidebar.match(/id="operator-workspace-select"/g)).toHaveLength(1);
    expect(sidebar).toContain('onChange={(event) => switcher.choose(event.target.value)}');
    // The legacy maps are the objects they were.
    expect(teamMap.map((entry) => entry.label)).toEqual([
      'Today',
      'Missions',
      'Companies',
      'Meetings',
      'Money',
      'Admin',
    ]);
  });
});
