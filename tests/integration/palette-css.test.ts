import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// R2-2: the wide Search field starts at 64em, not 1024px. A media query in em follows the browser's own default font
// size, so a person who has set a large default font falls back to the unchanged icon button. This is a source-level
// check only: an emulated root font size does not move an em query, so the behaviour itself is measured with a
// Chromium profile whose default font size is 32 px (owed to the verifier).
const css = readFileSync('apps/web/components/ux/team-nav.css', 'utf8');
const blocks = (query: string) =>
  [...css.matchAll(/@media ([^{]+)\{/g)].filter((match) => match[1]!.trim() === query).length;

describe('R2-2 the wide field follows the browser font size', () => {
  test('both wide-field media queries are in em', () => {
    expect(blocks('(min-width: 64em)')).toBe(2);
    expect(blocks('(min-width: 64em) and (hover: hover)')).toBe(1);
  });
  test('the only pixel query at 1024 left is the collapsed rail caption', () => {
    const left = [...css.matchAll(/@media \(min-width: 1024px\) \{([\s\S]*?)\n\}/g)];
    expect(left).toHaveLength(1);
    expect(left[0]![1]).toContain('ux-team-caption');
    expect(left[0]![1]).not.toContain('ux-palette-trigger');
  });
  test('the pressed rule comes after the hover rule', () => {
    expect(css.lastIndexOf('.ux-palette-trigger:active')).toBeGreaterThan(
      css.lastIndexOf('.ux-palette-trigger:hover'),
    );
  });
});
