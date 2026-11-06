import { describe, expect, test } from 'vitest';
import {
  filterActions,
  isPaletteShortcut,
  moveSelection,
  nextScope,
  paletteActions,
  paletteScopeList,
} from '../../apps/web/lib/ux/palette';
import { operatorSlugs } from '../../apps/web/lib/operator-urls';
import { workspaceSections } from '../../apps/web/lib/workspace-navigation';
import { missionHitHref, missionPath } from '../../apps/web/lib/ux/palette-paths';

// The command palette's pure parts (Navigation v1). What the palette lists as an action is exactly what
// the role could already open; keyboard rules are the board's (Up and Down, Enter, Tab for scope, Esc).
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'] as const;
const tenant = '0b5a0000-0000-4000-8000-000000000001';

describe('Actions are only what the role may open', () => {
  for (const role of roles)
    test(`${role}: every section the role may open is an action, and no other section is`, () => {
      const hrefs = paletteActions(role, true, tenant, true).map((entry) => entry.href);
      for (const section of workspaceSections) {
        const href = `/operator/${operatorSlugs[section.id]}?workspace=${tenant}`;
        expect(hrefs.includes(href), `${role} ${section.id}`).toBe(
          (section.roles as readonly string[]).includes(role),
        );
      }
      expect(hrefs.includes('/operator/owner')).toBe(role === 'owner' || role === 'admin');
    });
  test('an unknown role is offered only what every role may open, and no owner page', () => {
    const hrefs = paletteActions(null, true, '', true).map((entry) => entry.href);
    expect(hrefs).not.toContain('/operator/owner');
    expect(hrefs).not.toContain('/operator/audit');
    expect(hrefs).toContain('/operator/missions');
  });
  test('the owner page is not offered while it is switched off, and each action appears once', () => {
    const off = paletteActions('owner', true, tenant, false).map((entry) => entry.href);
    expect(off).not.toContain('/operator/owner');
    const all = paletteActions('owner', true, tenant, true).map((entry) => entry.key);
    expect(new Set(all).size).toBe(all.length);
  });
  test('words in any order find an action', () => {
    const actions = paletteActions('owner', true, tenant, true);
    expect(filterActions(actions, 'audit open').map((a) => a.label)).toEqual(['Open Audit']);
    expect(filterActions(actions, 'zzz')).toEqual([]);
  });
});

describe('keyboard', () => {
  test('Up and Down move and stop at the ends; an empty list has no selection', () => {
    expect(moveSelection(0, 'ArrowDown', 3)).toBe(1);
    expect(moveSelection(2, 'ArrowDown', 3)).toBe(2);
    expect(moveSelection(0, 'ArrowUp', 3)).toBe(0);
    expect(moveSelection(0, 'ArrowDown', 0)).toBe(-1);
  });
  test('Tab changes scope forwards and Shift Tab backwards, wrapping, over the four scopes', () => {
    expect(paletteScopeList.map((s) => s.label)).toEqual([
      'All',
      'Missions',
      'Companies',
      'Actions',
    ]);
    expect(nextScope('all', false)).toBe('missions');
    expect(nextScope('actions', false)).toBe('all');
    expect(nextScope('all', true)).toBe('actions');
  });
  test('Ctrl K and Command K open it; other combinations do not', () => {
    const base = { key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(isPaletteShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isPaletteShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isPaletteShortcut({ ...base, key: 'K', ctrlKey: true })).toBe(true);
    expect(isPaletteShortcut(base)).toBe(false);
    expect(isPaletteShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isPaletteShortcut({ ...base, key: 'j', ctrlKey: true })).toBe(false);
  });
});

describe('a mission hit never leads to a 404', () => {
  const section = `/operator/missions?workspace=${tenant}`;
  test('with mission pages on it opens the mission page, with them off or unknown it opens the Missions section', () => {
    expect(missionHitHref(true, 'abc', tenant, section)).toBe(
      `/operator/missions/abc?workspace=${tenant}`,
    );
    expect(missionHitHref(false, 'abc', tenant, section)).toBe(section);
  });
});

describe('addresses', () => {
  test('a mission opens its page and keeps the workspace; the id is encoded', () => {
    expect(missionPath('abc', tenant)).toBe(`/operator/missions/abc?workspace=${tenant}`);
    expect(missionPath('a/b', '')).toBe('/operator/missions/a%2Fb');
  });
});
