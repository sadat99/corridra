import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// Staff shell, AC/1 Signal Desk (lane 7): source-level guards for the rules the browser spec measures
// (tests/operator/team-shell-ac1.spec.ts). Team rules stay scoped to the team sidebar, colours are tokens,
// the 44 px target floor stays, and forced colours keep the current item visible.
const strip = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const teamNav = strip('apps/web/components/ux/team-nav.css');
const overview = strip('apps/web/app/operator/operator-overview.css');
const flat = (text: string) => text.replace(/\s+/g, ' ');
const block = (source: string, selector: string) => {
  const at = source.indexOf(selector);
  expect(at, selector).toBeGreaterThan(-1);
  return flat(source.slice(at, source.indexOf('}', at)));
};

describe('team sidebar look', () => {
  test('the current item is the lighter navy and the hover the quieter one', () => {
    expect(block(teamNav, '\nnav.ux-team-sidebar a[aria-current],')).toContain(
      'background: var(--ac-surface-navy-hover)',
    );
    expect(block(teamNav, '\nnav.ux-team-sidebar a:hover,')).toContain(
      'background: var(--ac-surface-navy)',
    );
  });
  test('no sidebar or second-level row goes below the 44 px target', () => {
    expect(teamNav).not.toMatch(/min-height:\s*(?:3\d|2\d)px/);
    expect(block(teamNav, '.ux-team-second a {')).toContain('min-height: 44px');
  });
  test('the second level is a segmented control and forced colours keep its current segment outlined', () => {
    expect(block(teamNav, '.ux-team-second ul {')).toContain(
      'background: var(--ac-surface-subtle)',
    );
    expect(block(teamNav, ".ux-team-second a[aria-current='page'] {")).toContain(
      'background: var(--ac-paper)',
    );
    expect(teamNav).toMatch(
      /forced-colors: active\)\s*\{\s*\.ux-team-second a\[aria-current='page'\]\s*\{\s*outline: 2px solid Highlight/,
    );
  });
  test('no raw colour in the team stylesheet or the delivery density block', () => {
    const delivery = overview.slice(
      overview.indexOf('.ux-workspace-body #workspace-delivery .delivery-table {'),
    );
    for (const css of [teamNav, delivery]) {
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/\brgba?\(/);
    }
  });
  test('the delivery density rules are scoped to the workspace delivery table and keep its columns', () => {
    const at = overview.indexOf('.ux-workspace-body #workspace-delivery .delivery-table {');
    const tail = overview.slice(at);
    for (const selector of tail.match(/^[^{}]+(?=\{)/gm) ?? []) {
      expect(selector.trim()).toMatch(
        /^(\.ux-workspace-body #workspace-delivery \.delivery-table|\.ux-operator-home \.ux-today-tiles strong)/,
      );
    }
    expect(tail).not.toMatch(/display:\s*none|visibility:\s*hidden|(?<![-\w])order:/);
  });
});
