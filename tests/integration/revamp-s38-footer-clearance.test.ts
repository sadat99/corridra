import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Customer shell: below 1024 px the site footer clears the fixed phone tab bar, as the page column already does.
// The footer sits below the page column, so the page's own bottom padding does not cover it. Browser proof is
// tests/e2e/verification/revamp-s2/customer-footer-clearance.spec.ts. Nothing here needs a browser or a database.
const css = readFileSync(resolve('apps/web/components/ux/customer-tabs.css'), 'utf8');

/** The text of the `@media` block that starts at `header`, found by matching braces. */
function block(source: string, header: string) {
  const start = source.indexOf(header);
  expect(start, header).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let at = open; at < source.length; at += 1) {
    if (source[at] === '{') depth += 1;
    if (source[at] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, at);
    }
  }
  throw new Error(`Unclosed block: ${header}`);
}

const narrow = block(css, '@media (max-width: 1023.98px)');
const footerSelector = ".site-shell:has(.ux-leftnav-frame[data-narrow='tabs']) > .site-footer";
const rule = (source: string, selector: string) => {
  const start = source.indexOf(selector);
  expect(start, selector).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('}', start));
};

describe('the site footer clears the phone tab bar', () => {
  test('the rule is inside the below 1024 px block and in no min-width block', () => {
    expect(narrow).toContain(footerSelector);
    expect(css.split(footerSelector)).toHaveLength(2);
    expect(css).not.toMatch(/@media\s*\(min-width/);
    // Everything outside the narrow block is the plain "display: none" default for the bar.
    expect(css.replace(narrow, '')).not.toContain('.site-footer');
  });
  test('it leaves the same room as the page column, plus the safe area, with a logical property', () => {
    const page = rule(narrow, ".ux-leftnav-frame[data-narrow='tabs'] .ux-leftnav-page");
    expect(page).toContain('padding-block-end: 4.5rem');
    const footer = rule(narrow, footerSelector);
    expect(footer).toContain('padding-block-end: calc(4.5rem + env(safe-area-inset-bottom, 0px))');
    expect(footer).not.toMatch(/padding-bottom/);
  });
  test('the selector is scoped to the tabs frame, so the team shell, drawer frames and public pages cannot match', () => {
    expect(footerSelector).toContain("[data-narrow='tabs']");
    expect(footerSelector).toContain(':has(.ux-leftnav-frame');
    expect(footerSelector).toContain('> .site-footer');
    expect(footerSelector).not.toContain("data-narrow='drawer'");
  });
  test('the tab bar is displayed only below 1024 px, the same breakpoint as the footer rule', () => {
    expect(css.slice(0, css.indexOf('@media'))).toMatch(/\.ux-customer-tabs \{\s*display: none;/);
    expect(rule(narrow, '.ux-customer-tabs {')).toContain('display: block');
    expect(rule(narrow, '.ux-customer-tabs {')).toContain('position: fixed');
  });
});
