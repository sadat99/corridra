import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { excludedPages, groupLabel, toolGroups, tools } from '../../apps/web/lib/all-tools';

// All Tools shows "Requests" where the internal group key stays "Missions" (customers say Request). The key is
// kept so every existing test and link keeps working; only what a person reads changes.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('All Tools words for customers', () => {
  it('keeps the internal group key and shows Requests', () => {
    expect(toolGroups).toContain('Missions');
    expect(groupLabel('Missions')).toBe('Requests');
    for (const group of toolGroups.filter((g) => g !== 'Missions'))
      expect(groupLabel(group)).toBe(group);
  });

  it('draws the heading through the display label', () => {
    const page = read('apps/web/app/account/all-tools/page.tsx');
    expect(page).toContain('groupLabel(group)');
    expect(page).not.toMatch(/<h2 id=\{id\}>\{group\}<\/h2>/);
  });

  it('no line or reason a customer can read says mission or missions as a word of the product', () => {
    for (const tool of tools) expect(tool.line, tool.href).not.toMatch(/\bmissions?\b/i);
    for (const page of excludedPages) {
      // The route address of a shared resource is not shown to a customer; the reason sentence is.
      expect(page.why, page.route).not.toMatch(/\bmissions?\b/i);
    }
  });

  it('the Account page companies line says the same', () => {
    expect(read('apps/web/app/account/page.tsx')).not.toContain('take part in missions');
  });
});
