import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextTabIndex, resolveSubTab, safeDecode, withTab } from '../../apps/web/lib/ux/sub-tabs';

const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToString = web('react-dom/server').renderToString as (element: unknown) => string;
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

// L-03 reference for the shared sub-tabs (docs/revamp/specs/layout-budget.md): ?tab= state, an old #id
// resolving to its tab, arrow keys with Home and End, and hidden panels kept in the server HTML.
// The browser behaviour is in tests/ux/sub-tabs.spec.ts.
const tabs = [
  { id: 'people', aliases: ['workspace-people'] },
  { id: 'tools' },
  { id: 'invite', aliases: ['workspace-invite', 'invite-form'] },
];

describe('which tab an address points at', () => {
  it('is the first tab with nothing in the address', () => {
    expect(resolveSubTab(tabs, '', '')).toBe('people');
  });

  it('follows ?tab= and ignores a word that is not a tab', () => {
    expect(resolveSubTab(tabs, '?tab=tools', '')).toBe('tools');
    expect(resolveSubTab(tabs, '?workspace=abc&tab=invite', '')).toBe('invite');
    expect(resolveSubTab(tabs, '?tab=nope', '')).toBe('people');
    expect(resolveSubTab(tabs, '?tab=', '')).toBe('people');
  });

  it('resolves an old #id that is a tab id or an alias', () => {
    expect(resolveSubTab(tabs, '', '#tools')).toBe('tools');
    expect(resolveSubTab(tabs, '', '#workspace-invite')).toBe('invite');
    expect(resolveSubTab(tabs, '', '#invite-form')).toBe('invite');
  });

  it('resolves an old #id that sits inside a panel, by asking where the element is', () => {
    const panelOf = (id: string) => (id === 'some-heading' ? 'tools' : null);
    expect(resolveSubTab(tabs, '', '#some-heading', panelOf)).toBe('tools');
    expect(resolveSubTab(tabs, '', '#unknown', panelOf)).toBe('people');
  });

  it('lets the old #id win over ?tab=, because an old link names a place', () => {
    expect(resolveSubTab(tabs, '?tab=people', '#workspace-invite')).toBe('invite');
  });

  it('survives an encoded hash and a hash with no word', () => {
    expect(resolveSubTab(tabs, '', '#')).toBe('people');
    expect(resolveSubTab(tabs, '', '#%74ools')).toBe('tools');
    expect(resolveSubTab(tabs, '', '#%E0%A4%A')).toBe('people');
  });
});

describe('reading a hash', () => {
  it('drops the # and decodes it', () => {
    expect(safeDecode('#tools')).toBe('tools');
    expect(safeDecode('tools')).toBe('tools');
    expect(safeDecode('#%74ools')).toBe('tools');
    expect(safeDecode('#a%20b')).toBe('a b');
  });

  it('never throws on a hash that cannot be decoded, and reads it as no word', () => {
    for (const bad of ['#%E0%A4%A', '#%', '#%zz', '%E0%A4%A', '#%C0%AF'])
      expect(() => safeDecode(bad)).not.toThrow();
    expect(safeDecode('#%E0%A4%A')).toBe('');
    expect(safeDecode('')).toBe('');
    expect(safeDecode('#')).toBe('');
  });
});

describe('keyboard', () => {
  it('moves with the arrows, wraps, and jumps with Home and End', () => {
    expect(nextTabIndex(3, 0, 'ArrowRight', false)).toBe(1);
    expect(nextTabIndex(3, 2, 'ArrowRight', false)).toBe(0);
    expect(nextTabIndex(3, 0, 'ArrowLeft', false)).toBe(2);
    expect(nextTabIndex(3, 1, 'Home', false)).toBe(0);
    expect(nextTabIndex(3, 0, 'End', false)).toBe(2);
  });

  it('mirrors the arrows in a right-to-left page', () => {
    expect(nextTabIndex(3, 0, 'ArrowLeft', true)).toBe(1);
    expect(nextTabIndex(3, 0, 'ArrowRight', true)).toBe(2);
  });

  it('ignores every other key', () => {
    for (const key of ['Enter', ' ', 'Tab', 'ArrowDown', 'a'])
      expect(nextTabIndex(3, 1, key, false)).toBeNull();
  });
});

describe('the address a selected tab writes', () => {
  it('sets ?tab= and keeps the other words', () => {
    expect(withTab('', 'tools')).toBe('?tab=tools');
    expect(withTab('?workspace=abc', 'tools')).toBe('?workspace=abc&tab=tools');
    expect(withTab('?tab=people&workspace=abc', 'invite')).toBe('?tab=invite&workspace=abc');
  });
});

describe('the server HTML', async () => {
  const { SubTabs } = await loadWeb('components/ux/sub-tabs');
  const html = renderToString(
    createElement(SubTabs, {
      label: 'Controls',
      tabs: [
        { id: 'people', label: 'People', panel: createElement('p', { id: 'inside-people' }, 'P') },
        { id: 'tools', label: 'Tools', panel: createElement('p', { id: 'inside-tools' }, 'T') },
        {
          id: 'invite',
          label: 'Invite',
          anchor: 'workspace-invite',
          panel: createElement('p', null, 'I'),
        },
      ],
    }),
  );

  it('keeps every panel in the HTML and hides all but the first', () => {
    expect(html).toContain('inside-people');
    expect(html).toContain('inside-tools');
    expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
    expect(html.match(/ hidden=""/g)).toHaveLength(2);
  });

  it('is a labelled tablist of tabs with the first selected and the others out of the tab order', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Controls"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('points every tab at its panel and every panel back at its tab', () => {
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
    expect(controls).toHaveLength(3);
    for (const id of controls) expect(html).toContain(`id="${id}"`);
    const labelled = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    for (const id of labelled) expect(html).toContain(`id="${id}"`);
  });

  it('lets a panel keep an old anchor as its own id', () => {
    expect(html).toContain('id="workspace-invite"');
  });
});
