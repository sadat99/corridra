import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// R2-2: the wide Search field starts at 64em, not 1024px. A media query in em follows the browser's own default font
// size, so a person who has set a large default font falls back to the unchanged icon button. This is a source-level
// check only: an emulated root font size does not move an em query, so the behaviour itself is measured with a
// Chromium profile whose default font size is 32 px (owed to the verifier). The checks say what must hold, not how
// the rules are split into blocks, so a harmless regrouping of the stylesheet does not fail them.
const css = readFileSync('apps/web/components/ux/team-nav.css', 'utf8');

type Block = { query: string | null; prelude: string; body: string; at: number };

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The top-level rules and media blocks of the stylesheet, in source order, with where each starts. */
function topLevel(source: string): Block[] {
  const out: Block[] = [];
  let depth = 0;
  let head = 0;
  let open = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '{') {
      if (depth === 0) open = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const prelude = flat(source.slice(head, open).replace(/\/\*[\s\S]*?\*\//g, ''));
        const media = /^@media\s+(.+)$/.exec(prelude);
        out.push({
          query: media ? media[1]! : null,
          prelude,
          body: flat(source.slice(open + 1, index)),
          at: source.indexOf(prelude, head),
        });
        head = index + 1;
      }
    }
  }
  return out;
}

const blocks = topLevel(css);
const trigger = '.ux-team-header .ux-palette-trigger';
const wide = (block: Block) => block.query !== null && /\(min-width:\s*64em\)/.test(block.query);
const withRule = (block: Block, selector: string) => block.body.includes(`${selector} {`);

describe('R2-2 the wide field follows the browser font size', () => {
  test('the wide-field rule and its hover rule are inside a 64em block', () => {
    expect(
      blocks.some(
        (block) =>
          wide(block) &&
          block.body.includes(`${trigger} { flex: 1 1 0; min-width: 11rem; max-width: 35rem;`),
      ),
    ).toBe(true);
    expect(blocks.some((block) => wide(block) && withRule(block, `${trigger}:hover`))).toBe(true);
  });

  test('no wide-field trigger rule remains in a 1024px block', () => {
    const pixel = blocks.filter((block) => block.query !== null && /1024px/.test(block.query));
    for (const block of pixel) expect(block.body).not.toContain('ux-palette-trigger');
    // The pixel block that is left is the collapsed rail caption, which is not part of the field.
    expect(pixel.some((block) => block.body.includes('ux-team-caption'))).toBe(true);
  });

  test('the pressed rule exists in a 64em block and sits after the hover rule', () => {
    const pressed = blocks.filter((block) => wide(block) && withRule(block, `${trigger}:active`));
    const hover = blocks.filter((block) => wide(block) && withRule(block, `${trigger}:hover`));
    expect(pressed.length).toBeGreaterThanOrEqual(1);
    expect(hover.length).toBeGreaterThanOrEqual(1);
    // Every pressed rule comes after the last hover rule, so a pressed button wins at equal weight.
    const lastHover = Math.max(...hover.map((block) => block.at));
    for (const block of pressed) expect(block.at).toBeGreaterThan(lastHover);
    expect(pressed.some((block) => block.body.includes('border-color: var(--selected)'))).toBe(
      true,
    );
  });

  test('the button from 900 to 1023 px is unchanged: the base trigger rules stay as they were', () => {
    const base = blocks.find((block) => block.query === null && block.prelude === trigger);
    expect(base?.body).toBe(
      'display: inline-flex; align-items: center; gap: var(--space-2); min-height: 44px; min-width: 44px; padding: 0 var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-1); color: var(--ink); font: inherit; font-weight: 600; cursor: pointer;',
    );
    const hover = blocks.find(
      (block) => block.query === null && block.prelude === `${trigger}:hover`,
    );
    expect(hover?.body).toBe('background: var(--surface-2);');
    const phone = blocks.find(
      (block) =>
        block.query === '(max-width: 899.98px)' && block.body.includes('ux-palette-trigger'),
    );
    expect(phone?.body).toContain(`${trigger} span, ${trigger} kbd { position: absolute;`);
  });
});
