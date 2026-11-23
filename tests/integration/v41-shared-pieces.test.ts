import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// UI/UX.v4.1 wave V4.1-0, shared pieces (rollout items 1, 3 and 4). Checked without a browser or a database: the
// choice row gains an optional owned icon tile (L2) and the chosen state (L3) and is otherwise what it was; the
// source stamp (L10) is one small label and never a trust label; neither stylesheet brings a colour of its own.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const noop = () => {};

// The markup the row gave before this unit (main 063b77e), written out so a change to it fails here.
const svg = (path: string) =>
  `<svg class="corridra-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;

describe('the choice row is what it was when the new props are absent', () => {
  it('renders the same markup as before for every existing use', async () => {
    const { ChoiceRow, ChoiceButton } = await loadWeb('components/ux/choice-chip');
    const { iconPaths } = await loadWeb('components/corridra-icon');
    const html = render(
      ce(
        ChoiceRow,
        { labelledBy: 'q' },
        ce(ChoiceButton, { onClick: noop, variant: 'primary', icon: 'check' }, 'Yes, Interested'),
        ce(ChoiceButton, { onClick: noop }, 'I Need More Information'),
        ce(ChoiceButton, { onClick: noop, icon: 'close', disabled: true }, 'Not Relevant'),
      ),
    );
    expect(html).toBe(
      '<div class="ux-choice-row" role="group" aria-labelledby="q">' +
        `<button type="button" class="ux-choice ux-choice-primary">${svg(iconPaths.check)}<span>Yes, Interested</span></button>` +
        '<button type="button" class="ux-choice ux-choice-secondary"><span>I Need More Information</span></button>' +
        `<button type="button" class="ux-choice ux-choice-secondary" disabled="">${svg(iconPaths.close)}<span>Not Relevant</span></button>` +
        '</div>',
    );
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('ux-choice-tile');
    expect(html).not.toContain('ux-choice-radio');
  });

  it('keeps the one caller on the existing props', () => {
    const caller = read('apps/web/app/buyer/reply-journey.tsx');
    expect(caller).toContain('<ChoiceRow labelledBy="reply-h">');
    expect(caller).not.toMatch(/ownedIcon|chosen=/);
  });
});

describe('the owned icon (L2) and the chosen state (L3)', () => {
  it('draws one owned icon in a tile, hidden from a screen reader, beside the words', async () => {
    const { ChoiceButton } = await loadWeb('components/ux/choice-chip');
    const { iconPaths } = await loadWeb('components/corridra-icon');
    const html = render(ce(ChoiceButton, { onClick: noop, ownedIcon: 'sell' }, 'Sell Abroad'));
    expect(html).toBe(
      '<button type="button" class="ux-choice ux-choice-secondary">' +
        `<span class="ux-choice-tile" aria-hidden="true">${svg(iconPaths.sell)}</span>` +
        '<span>Sell Abroad</span></button>',
    );
    // One icon per choice: with both props the owned icon is the one drawn.
    const both = render(
      ce(ChoiceButton, { onClick: noop, ownedIcon: 'sell', icon: 'check' }, 'Sell Abroad'),
    );
    expect(both.match(/<svg/g)).toHaveLength(1);
    expect(both).toContain(iconPaths.sell);
  });

  it('states chosen and not chosen in words a screen reader hears and a shape the eye sees', async () => {
    const { ChoiceButton } = await loadWeb('components/ux/choice-chip');
    const on = render(ce(ChoiceButton, { onClick: noop, chosen: true }, 'Buy From Abroad'));
    const off = render(ce(ChoiceButton, { onClick: noop, chosen: false }, 'Plan a Trip'));
    expect(on).toBe(
      '<button type="button" class="ux-choice ux-choice-secondary" aria-pressed="true">' +
        '<span>Buy From Abroad</span><span class="ux-choice-radio" aria-hidden="true"></span></button>',
    );
    expect(off).toBe(
      '<button type="button" class="ux-choice ux-choice-secondary" aria-pressed="false">' +
        '<span>Plan a Trip</span><span class="ux-choice-radio" aria-hidden="true"></span></button>',
    );
  });

  it('styles the tile at 44 px and the chosen row by edge, fill and a filled radio, from tokens', () => {
    const css = read('apps/web/components/ux/choice-chip.css');
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf('}', at));
    };
    const tile = rule('.ux-choice-row .ux-choice .ux-choice-tile');
    expect(tile).toContain('inline-size: 2.75rem');
    expect(tile).toContain('block-size: 2.75rem');
    expect(tile).toContain('background: var(--surface-subtle)');
    expect(rule(".ux-choice-row .ux-choice[aria-pressed='true'] .ux-choice-tile")).toContain(
      'background: var(--selected-surface)',
    );
    const chosen = rule(".ux-choice-row .ux-choice[aria-pressed='true']");
    expect(chosen).toContain('border-color: var(--selected)');
    expect(chosen).toContain('box-shadow: inset 0 0 0 1px var(--selected)');
    expect(chosen).toContain('background: var(--selected-surface)');
    // Not colour alone: the radio is hollow until chosen, then holds a dot; forced colours keep both.
    expect(rule('.ux-choice-row .ux-choice .ux-choice-radio')).toContain('border: 2px solid');
    expect(
      rule(".ux-choice-row .ux-choice[aria-pressed='true'] .ux-choice-radio::after"),
    ).toContain('background: var(--selected)');
    const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
    expect(forced).toContain('.ux-choice-radio');
    expect(forced).toContain('ButtonText');
  });
});

describe('the source stamp (L10)', () => {
  it('is one label line with a small dot, the source and, when given, the date', async () => {
    const { SourceStamp } = await loadWeb('components/ux/source-stamp');
    expect(
      render(ce(SourceStamp, { source: 'Sample customs table', date: '11 Nov 2026, 09:30 (UTC)' })),
    ).toBe(
      '<span class="ux-source-stamp"><span class="ux-source-stamp-dot" aria-hidden="true"></span>' +
        '<span class="ux-source-stamp-words">Sample customs table · 11 Nov 2026, 09:30 (UTC)</span></span>',
    );
    expect(render(ce(SourceStamp, { source: 'Sample customs table' }))).toBe(
      '<span class="ux-source-stamp"><span class="ux-source-stamp-dot" aria-hidden="true"></span>' +
        '<span class="ux-source-stamp-words">Sample customs table</span></span>',
    );
  });

  it('is 12 px Geist Mono from tokens and never one of the five trust labels', () => {
    const css = read('apps/web/components/ux/source-stamp.css');
    const source = read('apps/web/components/ux/source-stamp.tsx');
    expect(css).toContain('var(--text-xs)');
    expect(css).toContain('var(--font-mono)');
    expect(css).toMatch(/@media \(forced-colors: active\)/);
    // A label, not a trust label: it borrows none of their classes or components.
    for (const text of [css, source])
      expect(text).not.toMatch(/trust-|TrustTag|status-chip|StatusChip|badge/);
    // It formats no date itself: the caller passes the words `formatDateTime` made.
    expect(source).not.toMatch(/Intl\.|toLocale|new Date/);
  });

  it('is in the shared components table and on no screen yet', () => {
    const table = read('docs/agents/ui-direction.md');
    expect(table).toContain('apps/web/components/ux/source-stamp.tsx');
  });
});

describe('rule 4: no colour of its own, no dash, no banned word', () => {
  const files = [
    'apps/web/components/ux/choice-chip.css',
    'apps/web/components/ux/choice-chip.tsx',
    'apps/web/components/ux/source-stamp.css',
    'apps/web/components/ux/source-stamp.tsx',
  ];
  it('uses tokens and system colours only, and defines no token', () => {
    for (const file of files.filter((f) => f.endsWith('.css'))) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, file).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i);
      expect(css, file).not.toMatch(/^\s*--[a-z0-9-]+\s*:/m);
      expect(css, file).not.toMatch(/gradient|backdrop-filter/);
    }
  });
  it('holds no long dash and none of the words the owner retired', () => {
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(dashes);
      expect(text, file).not.toMatch(/synthetic|contributor|operator/i);
    }
  });
});
