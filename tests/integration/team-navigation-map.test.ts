import { describe, expect, test } from 'vitest';
import { operatorSlugs } from '../../apps/web/lib/operator-urls';
import { workspaceSections } from '../../apps/web/lib/workspace-navigation';
import {
  itemForPlace,
  settingsLevel,
  teamItemsFor,
  teamMap,
  teamPlacesFor,
  type TeamPlaceId,
} from '../../apps/web/lib/ux/team-map';

// Navigation v1, team shell (docs/revamp/specs/navigation-v1.md): nothing is lost, five at most per
// level, same access. Every old route stays reachable from the new navigation for every role that
// could open it before, and no role is shown a place it cannot open.
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'] as const;

function reachable(role: string | null): Set<TeamPlaceId> {
  const found = new Set<TeamPlaceId>();
  for (const item of teamItemsFor(role))
    for (const place of teamPlacesFor(item, role)) found.add(place.id);
  for (const place of settingsLevel(role)) found.add(place.id);
  return found;
}

describe('NAV-01 every old route is still reachable for each role that could open it', () => {
  for (const role of roles) {
    test(`${role}: every section it may open, plus the owner page for owner and admin`, () => {
      const found = reachable(role);
      for (const section of workspaceSections)
        if ((section.roles as readonly string[]).includes(role))
          expect(found.has(section.id), `${role} lost ${section.id}`).toBe(true);
      expect(found.has('owner')).toBe(role === 'owner' || role === 'admin');
    });
  }
  test('every one of the 18 sections is placed somewhere and has an address', () => {
    const placed = new Set(teamMap.flatMap((item) => item.places.map((place) => place.id)));
    for (const place of settingsLevel('owner')) placed.add(place.id);
    for (const section of workspaceSections) {
      expect(placed.has(section.id), section.id).toBe(true);
      expect(Object.hasOwn(operatorSlugs, section.id)).toBe(true);
    }
  });
});

describe('NAV-02 five at most per level, and the right words', () => {
  test('at most five daily items plus the Admin and Account groups, and five places each, for every role', () => {
    for (const role of [...roles, null]) {
      const items = teamItemsFor(role);
      expect(
        items.filter((item) => item.key !== 'admin' && item.key !== 'account').length,
      ).toBeLessThanOrEqual(5);
      for (const item of items) expect(teamPlacesFor(item, role).length).toBeLessThanOrEqual(5);
      expect(settingsLevel(role).length).toBeLessThanOrEqual(5);
    }
  });
  test('the board order and words', () => {
    expect(teamMap.map((item) => item.label)).toEqual([
      'Today',
      'Missions',
      'Companies',
      'Meetings',
      'Money',
      'Admin',
      'Account',
    ]);
    expect(teamMap.find((item) => item.key === 'admin')?.places.map((p) => p.label)).toEqual([
      'Health',
      'Readiness',
      'Audit',
      'People and access',
      'Settings',
    ]);
  });
});

describe('NAV-03 same access: nothing is shown to a role that cannot open it', () => {
  test('Admin renders only for owner and admin', () => {
    for (const role of roles)
      expect(teamItemsFor(role).some((item) => item.key === 'admin')).toBe(
        role === 'owner' || role === 'admin',
      );
    expect(teamItemsFor(null).some((item) => item.key === 'admin')).toBe(false);
  });
  test('no listed section is outside the role, and an unknown role lists only what every role may open', () => {
    for (const role of [...roles, null]) {
      for (const id of reachable(role)) {
        if (id === 'home') continue;
        if (id === 'owner') {
          expect(role === 'owner' || role === 'admin').toBe(true);
          continue;
        }
        const section = workspaceSections.find((entry) => entry.id === id);
        const allowed = (section?.roles as readonly string[]).includes(role ?? 'viewer');
        expect(allowed, `${role} shown ${id}`).toBe(true);
      }
    }
  });
  test('an operator keeps Health and Readiness in Account, where Admin is not shown; owner and admin find them in Admin', () => {
    const account = (role: string) =>
      teamPlacesFor(
        teamItemsFor(role).find((item) => item.key === 'account')!,
        role,
      ).map((p) => p.id);
    expect(account('operator')).toEqual(['workspace-authenticator', 'ops-health', 'ops-gates']);
    expect(account('viewer')).toEqual(['workspace-authenticator']);
    expect(account('owner')).toEqual(['workspace-authenticator']);
  });
  test('a place belongs to Admin for owner and admin and to its own item for others', () => {
    expect(itemForPlace('ops-health', 'owner')).toBe('admin');
    expect(itemForPlace('ops-health', 'operator')).toBe('account');
    expect(itemForPlace('workspace-authenticator', 'viewer')).toBe('account');
    expect(itemForPlace('workspace-missions', 'owner')).toBe('missions');
    expect(itemForPlace('workspace-delivery', 'viewer')).toBe('meetings');
    expect(itemForPlace('owner', 'owner')).toBe('admin');
  });
});
