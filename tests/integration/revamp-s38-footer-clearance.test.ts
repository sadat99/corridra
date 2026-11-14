import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Customer shell, phone: there is no fixed bottom tab bar (owner, 14 November 2026, "B": drawer only, one navigation from
// the hamburger). Before that, the page column and the site footer each kept 4.5 rem free so the last line and the footer
// link were never hidden behind the bar. With no bar those rules must be gone: the page ends where its content ends, and
// the footer keeps its base padding. The user need they protected (the last footer link is visible and not covered)
// is proved in a browser by tests/e2e/verification/revamp-s2/customer-footer-clearance.spec.ts. Nothing here needs a
// browser or a database.
const web = resolve('apps/web');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.next') return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
const files = walk(web);
const css = files.filter((file) => file.endsWith('.css'));
const sources = files.filter((file) => /\.(tsx?|css)$/.test(file));

/** Every rule (selector text and body) of a stylesheet, found by matching braces; at-rule blocks are entered. */
function rules(source: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let from = 0;
  for (let at = 0; at < stripped.length; at += 1) {
    if (stripped[at] === '{') {
      const selector = stripped.slice(from, at).trim();
      const end = stripped.indexOf('}', at);
      const inner = stripped.slice(at + 1, end);
      if (inner.includes('{')) {
        from = at + 1;
        continue;
      }
      out.push({ selector, body: inner });
      at = end;
      from = end + 1;
    } else if (stripped[at] === '}') {
      from = at + 1;
    }
  }
  return out;
}

describe('the phone has no bottom tab bar, so nothing reserves room for one', () => {
  test('the bar, its stylesheet and its property are gone from the app', () => {
    expect(existsSync(resolve('apps/web/components/ux/customer-tabs.tsx'))).toBe(false);
    expect(existsSync(resolve('apps/web/components/ux/customer-tabs.css'))).toBe(false);
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/ux-customer-tabs|--shell-bottom-bar|CustomerTabs/);
    }
  });

  test('the customer shell renders the drawer frame and no tab bar', () => {
    const shell = readFileSync(resolve('apps/web/components/customer-shell.tsx'), 'utf8');
    expect(shell).toContain('<LeftNavFrame');
    expect(shell).not.toMatch(/Customer tabs|customer-tabs/);
  });

  test('no rule gives the page column or the site footer the old 4.5 rem of bottom padding', () => {
    for (const file of css) {
      for (const { selector, body } of rules(readFileSync(file, 'utf8'))) {
        if (!/padding-(?:block-end|bottom)\s*:[^;]*4\.5rem/.test(body)) continue;
        // The only 4.5 rem left is the contributor field tabs' own bar, a different shell.
        expect(selector, `${file}: ${selector}`).toContain('ux-field-tabs');
        expect(selector).not.toMatch(/site-footer|ux-leftnav-page|site-shell/);
      }
    }
  });
});
