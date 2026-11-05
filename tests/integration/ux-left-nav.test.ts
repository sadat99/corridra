import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  readLeftNav,
  readServerLeftNav,
  registerLeftNav,
  setLeftNavOpen,
} from '../../apps/web/components/ux/left-nav-store';

// The shared left navigation (layout budget section 1): the client-only store, the header slot, and
// what the header must NOT change. The behaviour in a browser is tests/ux/left-nav.spec.ts (L-01).
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
const read = (path: string) => readFileSync(resolve('apps/web', path), 'utf8');

describe('the left navigation store', () => {
  test('starts with no bar, registers one, opens and closes, and is empty again when the bar unmounts', () => {
    expect(readLeftNav()).toEqual({ present: false, open: false, controls: '', label: '' });
    const remove = registerLeftNav('workspace-navigation', 'Sections');
    expect(readLeftNav()).toEqual({
      present: true,
      open: false,
      controls: 'workspace-navigation',
      label: 'Sections',
    });
    setLeftNavOpen(true);
    expect(readLeftNav().open).toBe(true);
    setLeftNavOpen(true);
    expect(readLeftNav().open).toBe(true);
    remove();
    expect(readLeftNav()).toEqual({ present: false, open: false, controls: '', label: '' });
  });
  test('the server always sees no bar, so the first render of every page is the header as it was', () => {
    registerLeftNav('x', 'Sections');
    expect(readServerLeftNav()).toEqual({ present: false, open: false, controls: '', label: '' });
  });
  test('holds only the drawer state: no identity, role, tenant or token, and no session or auth import', () => {
    const source = read('components/ux/left-nav-store.ts');
    expect(source).not.toMatch(/from '@corridra\//);
    expect(source).not.toMatch(/getSession|cookies\(|document\.cookie|localStorage|fetch\(/);
  });
});

describe('the header menu slot', () => {
  test('renders nothing where no left bar is on the page (public and signed-out pages)', async () => {
    const path = '../../apps/web/components/ux/left-nav';
    const { LeftNavMenuButton } = await import(/* @vite-ignore */ path);
    expect(renderToStaticMarkup(createElement(LeftNavMenuButton))).toBe('');
  });
  test('AppHeader gains only the slot: one button before the brand, everything else as it was', () => {
    const header = read('components/ux/app-header.tsx');
    expect(header.match(/<LeftNavMenuButton \/>/g)).toHaveLength(1);
    expect(header.indexOf('<LeftNavMenuButton />')).toBeLessThan(
      header.indexOf('className="brand"'),
    );
    for (const kept of [
      'className="brand"',
      'className="ux-app-name"',
      '<LanguageSwitcher />',
      '<CornerDock variant="header" />',
      'href="/"',
    ])
      expect(header, kept).toContain(kept);
  });
  test('the public site header does not know the left navigation', () => {
    expect(read('components/site-header.tsx')).not.toMatch(/left-nav/);
    expect(read('components/ux/shell-header.tsx')).not.toMatch(/left-nav/);
  });
});
