import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scoped } from '../../apps/web/components/ux/customer-bar';

// Owner review, 6 Nov 2026: the customer header showed a second, unsized workspace switcher beside the
// brand (a large bare arrow on a phone) while the left bar's workspace card already switches workspace.
// One switcher stays, in the left bar, and it keeps the person in the same section of the chosen workspace.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('one workspace switcher', () => {
  it('the customer header carries no workspace switcher and no chevron', () => {
    const bar = read('apps/web/components/ux/customer-bar.tsx');
    expect(bar).not.toContain('WorkspaceSwitcher');
    expect(bar).not.toContain('Switch workspace');
    expect(bar).not.toContain('name="chevron"');
    const css = read('apps/web/components/ux/customer-bar.css');
    expect(css).not.toContain('ux-bar-switcher');
    expect(css).not.toContain('ux-bar-chevron');
  });

  it('every page that belongs to one workspace is recognised, with its section and id', () => {
    for (const section of [
      'request',
      'drafts',
      'billing',
      'profile',
      'delegations',
      'service-requests',
    ]) {
      const match = scoped.exec(`/account/${section}/${id}`);
      expect(match?.[1]).toBe(section);
      expect(match?.[2]).toBe(id);
      // Every one of these pages draws the left bar, so the card is always there to switch from.
      expect(read(`apps/web/app/account/${section}/[workspaceId]/page.tsx`)).toContain(
        'CustomerShell',
      );
    }
    expect(scoped.exec('/account')).toBeNull();
    expect(scoped.exec('/account/move')).toBeNull();
    expect(scoped.exec('/account/delegations/not-a-workspace')).toBeNull();
  });

  it('the left bar card names the current workspace and switches within the same section', () => {
    const rail = read('apps/web/components/ux/customer-rail.tsx');
    expect(rail).toContain('scoped.exec(pathname)');
    expect(rail).toContain("label={current ? 'Switch workspace' : 'Your workspaces'}");
    expect(rail).toContain('router.push(`/account/${section}/${w.id}`)');
    expect(rail).toContain('<MenuRadio');
    expect(rail).toContain('Manage Workspaces');
    // The card's arrow keeps its fixed 16 px size.
    expect(read('apps/web/components/ux/customer-rail.css')).toMatch(
      /\.ux-rail-chevron \{\s*width: 16px;\s*height: 16px;/,
    );
  });
});
