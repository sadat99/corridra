import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { founderDoor, helperDoor, withWorkspace } from '../../apps/web/lib/front-doors';
import { operatorReturnTo, workspaceSections } from '../../apps/web/lib/workspace-navigation';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchNames } from '../../apps/web/lib/ux-switches';

// Founder and helper front doors (Lane 13 of the UX update): plain cards that link to pages that
// already exist, stating no number, behind one switch that is off by default.
const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('the founder door', () => {
  it('uses the five words of the locked founder navigation, in order', () => {
    expect(founderDoor.map((item) => item.title)).toEqual([
      'Business',
      'Operations',
      'Routes and settings',
      'People and access',
      'Ready to start?',
    ]);
  });
  it('opens the workspace the page is showing, not the first one, and keeps the section', () => {
    const id = '3f2b8c1e-6a4d-4c0e-9b7a-1d2e3f4a5b6c';
    const items = withWorkspace(founderDoor, id);
    expect(items).toHaveLength(founderDoor.length);
    items.forEach((item, index) => {
      const base = founderDoor[index];
      expect(item.href).toBe(`/operator?workspace=${id}#${base.href.split('#')[1]}`);
      expect({ ...item, href: '' }).toEqual({ ...base, href: '' });
    });
    // Anything that is not a workspace id leaves the links as they were.
    expect(withWorkspace(founderDoor, 'not-an-id')).toBe(founderDoor);
    expect(withWorkspace(founderDoor, `${id}&x=1`)).toBe(founderDoor);
    // Links that are not workspace sections are untouched.
    expect(withWorkspace(helperDoor, id)).toEqual(helperDoor);
    expect(read('apps/web/app/operator/owner/page.tsx')).toContain(
      'items={withWorkspace(founderDoor, tenant.id)}',
    );
  });
  it('links only to real workspace sections that an owner and an admin can open', () => {
    for (const item of founderDoor) {
      const id = item.href.replace('/operator#', '');
      const section = workspaceSections.find((s) => s.id === id);
      expect(section, item.href).toBeTruthy();
      expect(section!.roles, item.href).toEqual(expect.arrayContaining(['owner', 'admin']));
      // The same short list the sign-in return accepts, so the link survives a sign-in.
      expect(operatorReturnTo(item.href)).toBe(item.href);
    }
  });
  it('names one primary way in', () => {
    expect(founderDoor.filter((item) => item.primary)).toHaveLength(1);
    expect(founderDoor.find((item) => item.primary)!.title).toBe('Ready to start?');
  });
});

describe('the helper door', () => {
  it('links only to pages that exist', () => {
    const pages: Record<string, string> = {
      '/contributor/setup': 'apps/web/app/contributor/setup/page.tsx',
      '/network': 'apps/web/app/network/page.tsx',
      '/signin': 'apps/web/app/signin/page.tsx',
    };
    for (const item of helperDoor) {
      expect(pages[item.href], item.href).toBeTruthy();
      expect(existsSync(resolve(pages[item.href])), item.href).toBe(true);
    }
    expect(helperDoor.filter((item) => item.primary)).toHaveLength(1);
  });
});

describe('both doors', () => {
  it('state no number and no promise, and every card has a title and one plain line', () => {
    for (const item of [...founderDoor, ...helperDoor]) {
      expect(item.title.length).toBeGreaterThan(2);
      expect(item.line.length).toBeGreaterThan(10);
      expect(item.line).not.toMatch(/\d/);
      expect(item.line).not.toMatch(/guarantee|earn|payment is|free/i);
      expect(item.line + item.title).not.toMatch(/[—–]/);
    }
    const ids = [...founderDoor, ...helperDoor].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('the stylesheet uses tokens only and no inline drawing', () => {
    const css = read('apps/web/components/front-door.css');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(read('apps/web/components/front-door.tsx')).not.toContain('<svg');
  });
});

describe('the switch and every switch-off path', () => {
  it('is a real owner switch, read through the shared list', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_UX_FRONT_DOORS')?.kind).toBe('flag');
    expect(uxSwitchNames).toContain('CORRIDRA_UX_FRONT_DOORS');
  });
  it('the founder page shows the door only with the switch on, above everything else', () => {
    const page = read('apps/web/app/operator/owner/page.tsx');
    expect(page).toContain("{uxSwitchOn('CORRIDRA_UX_FRONT_DOORS') && (");
    expect(page.indexOf('<FrontDoor')).toBeGreaterThan(page.indexOf('className="ux-owner"'));
    expect(page.indexOf('<FrontDoor')).toBeLessThan(page.indexOf('className="owner-lede"'));
  });
  it('the helper page keeps its three links word for word with the switch off', () => {
    const page = read('apps/web/app/contributor/page.tsx');
    expect(page).toContain("uxSwitchOn('CORRIDRA_UX_FRONT_DOORS') ? (");
    for (const line of [
      'Accept a reviewed contributor invitation',
      'How assigned work works',
      'Choose your sign-in route',
      'Back to Corridra',
    ])
      expect(page).toContain(line);
    // The door only replaces the no-workspace links; the signed-in page and sign-in redirects are untouched.
    expect(page).toContain("redirect(\n      '/operator/signin?next='");
    expect(page.match(/<FrontDoor/g)).toHaveLength(1);
  });
});
