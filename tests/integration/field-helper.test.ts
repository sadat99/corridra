import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  currentFieldTab,
  dueToday,
  fieldTabs,
  fieldTabsShown,
  fieldWorkspace,
} from '../../apps/web/lib/ux/field-helper';

// The field helper's phone navigation (Navigation v1, FieldHelper board). Navigation only: what a helper may see is
// still decided by the page and the server. Nothing the helper reached before is lost, and nothing is faked.
const workspace = '0b5a0000-0000-4000-8000-000000000001';

describe('the four tabs', () => {
  test('Today, Tasks, Messages, Me, in order, each with its words', () => {
    const tabs = fieldTabs(workspace);
    expect(tabs.map((tab) => tab.label)).toEqual(['Today', 'Tasks', 'Messages', 'Me']);
    expect(tabs).toHaveLength(4);
  });
  test('Messages is Coming soon: it has no address, so it can never be a link', () => {
    const messages = fieldTabs(workspace).find((tab) => tab.key === 'messages')!;
    expect(messages.href).toBeUndefined();
    for (const tab of fieldTabs(workspace).filter((t) => t.key !== 'messages'))
      expect(tab.href, tab.key).toBeTruthy();
  });
  test('every address keeps the workspace and stays under /contributor', () => {
    for (const tab of fieldTabs(workspace)) {
      if (!tab.href) continue;
      expect(tab.href.startsWith('/contributor')).toBe(true);
      expect(tab.href).toContain('workspace=' + workspace);
    }
    expect(fieldTabs(workspace)[0]!.href).toContain('view=today');
    expect(fieldTabs(workspace)[1]!.href).toBe('/contributor?workspace=' + workspace);
    expect(fieldTabs(workspace)[3]!.href).toBe('/contributor/me?workspace=' + workspace);
  });
});

describe('which tab is current, and where the tabs show', () => {
  test('the task page is Tasks, with view=today it is Today, the Me page is Me, anything else none', () => {
    expect(currentFieldTab('/contributor', null)).toBe('tasks');
    expect(currentFieldTab('/contributor', 'today')).toBe('today');
    expect(currentFieldTab('/contributor', 'anything')).toBe('tasks');
    expect(currentFieldTab('/contributor/me', null)).toBe('me');
    expect(currentFieldTab('/contributor/setup', null)).toBeNull();
    expect(currentFieldTab('/operator', null)).toBeNull();
  });
  test('the tabs show on the task page and the Me page only, and only with a valid workspace id', () => {
    expect(fieldTabsShown('/contributor')).toBe(true);
    expect(fieldTabsShown('/contributor/me')).toBe(true);
    expect(fieldTabsShown('/contributor/setup')).toBe(false);
    expect(fieldTabsShown('/network')).toBe(false);
    expect(fieldWorkspace(workspace)).toBe(workspace);
    for (const bad of ['', 'abc', null, undefined, workspace + 'x', '../' + workspace])
      expect(fieldWorkspace(bad as string), String(bad)).toBeNull();
  });
});

describe("Today is the same list narrowed to the person's current day", () => {
  const now = new Date(2026, 10, 6, 14, 30);
  test('a deadline on the same calendar day is today, another day or an unreadable date is not', () => {
    expect(dueToday(new Date(2026, 10, 6, 9, 0).toISOString(), now)).toBe(true);
    expect(dueToday(new Date(2026, 10, 6, 23, 59).toISOString(), now)).toBe(true);
    expect(dueToday(new Date(2026, 10, 7, 0, 1).toISOString(), now)).toBe(false);
    expect(dueToday(new Date(2026, 10, 5, 23, 59).toISOString(), now)).toBe(false);
    expect(dueToday('not a date', now)).toBe(false);
    expect(dueToday('', now)).toBe(false);
  });
});

describe('nothing a helper reached before is lost', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  test('the task page keeps its links and sign out, and the Me page offers them too', () => {
    const page = read('apps/web/app/contributor/page.tsx');
    expect(page).toContain('Verify your authenticator again');
    expect(page).toContain('About assigned work');
    expect(page).toContain('ContributorSignout');
    expect(page).toContain('/contributor/setup');
    const me =
      read('apps/web/app/contributor/me/page.tsx') +
      read('apps/web/app/contributor/me/helper-me.tsx');
    expect(me).toContain('ContributorSignout');
    expect(me).toContain('/network');
    expect(me).toContain('Verify your authenticator again');
  });
  test('the wide-screen left bar still has Your tasks and How assigned work works', () => {
    const frame = read('apps/web/components/ux/contributor-frame.tsx');
    expect(frame).toContain("key: 'tasks'");
    expect(frame).toContain("href: '/network'");
  });
  test('Me says Coming soon for what is not built, and builds no control for it', () => {
    const me = read('apps/web/app/contributor/me/helper-me.tsx');
    expect(me).toMatch(/Text Size[\s\S]{0,80}Coming soon/);
    expect(me).toMatch(/Data Saver[\s\S]{0,80}Coming soon/);
  });
});
