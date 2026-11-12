import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// The staff sidebar's Admin row, the scrolling list and the Admin pages' markers are CSS and one prop. This
// is a source-level check of the rules that make them behave (the measured behaviour is in
// tests/operator/team-sidebar-fit.spec.ts): the Admin row is a two-row grid, the list scrolls with a thin bar
// made for the navy, the WebKit bar exists only as a fallback, and the sub-links carry a dot, not an icon.
const read = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const teamNav = read('apps/web/components/ux/team-nav.css');
const leftNav = read('apps/web/components/ux/left-nav.css');
const globals = readFileSync('apps/web/app/globals.css', 'utf8');
const sidebar = readFileSync('apps/web/components/ux/team-sidebar.tsx', 'utf8');

type Rule = { context: string[]; selector: string; body: string };

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Every style rule, with the at-rule preludes (media, supports) it sits inside, outermost first. */
function rulesOf(source: string, context: string[] = []): Rule[] {
  const out: Rule[] = [];
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
        const prelude = flat(source.slice(head, open));
        const body = source.slice(open + 1, index);
        if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
          out.push(...rulesOf(body, [...context, prelude]));
        } else if (!prelude.startsWith('@')) {
          out.push({ context, selector: prelude, body: flat(body) });
        }
        head = index + 1;
      }
    }
  }
  return out;
}

const teamRules = rulesOf(teamNav);
const leftRules = rulesOf(leftNav);
const find = (rules: Rule[], selector: string, within?: RegExp) =>
  rules.filter(
    (rule) =>
      rule.selector === selector &&
      (within ? rule.context.some((c) => within.test(c)) : rule.context.length === 0),
  );
const declared = (rule: Rule, property: string) =>
  new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+)`).exec(rule.body)?.[1]?.trim();
const only = (rules: Rule[]) => {
  expect(rules).toHaveLength(1);
  return rules[0]!;
};

const summary = 'nav.ux-team-sidebar .ux-team-group > summary';
const caption = 'nav.ux-team-sidebar .ux-team-group > summary > .ux-team-caption';
const scroller = '.ux-leftnav-panel > nav';
const wide = /^@media \(min-width: 1024px\)$/;
const narrow = /^@media \(max-width: 1023\.98px\)$/;
const noScrollbarColor = /^@supports not \(scrollbar-color: auto\)$/;

describe('the Admin row is two rows: its name, then its caption', () => {
  test('the summary is a grid with the icon, name, caption and chevron areas and a 60 px minimum', () => {
    const rule = only(find(teamRules, summary));
    expect(declared(rule, 'display')).toBe('grid');
    expect(declared(rule, 'grid-template-areas')).toBe(
      "'icon label chevron' 'icon caption chevron'",
    );
    expect(declared(rule, 'row-gap')).toBe('0');
    expect(declared(rule, 'min-height')).toBe('60px');
    expect(rule.body).not.toMatch(/(?:^|;|\s)height:/);
  });
  test('each child sits in its own area and the caption may wrap but never break a word mid-letter', () => {
    expect(declared(only(find(teamRules, `${summary} > span`)), 'grid-area')).toBe('label');
    expect(declared(only(find(teamRules, `${summary} > .ux-team-chevron`)), 'grid-area')).toBe(
      'chevron',
    );
    const rule = only(find(teamRules, caption));
    expect(declared(rule, 'grid-area')).toBe('caption');
    expect(declared(rule, 'min-width')).toBe('0');
    expect(declared(rule, 'overflow-wrap')).toBe('break-word');
    expect(declared(rule, 'opacity')).toBe('1');
    expect(declared(rule, 'color')).toBe('var(--ac-paper)');
  });
  test('the collapsed icon rail resets the summary to a 44 px flex row, in the 1024px block that clips the caption', () => {
    const rule = only(find(teamRules, `.ux-leftnav-frame[data-collapsed='true'] ${summary}`, wide));
    expect(declared(rule, 'display')).toBe('flex');
    expect(declared(rule, 'min-height')).toBe('44px');
    expect(declared(rule, 'padding-block')).toBe('0');
    const clip = find(
      teamRules,
      ".ux-leftnav-frame[data-collapsed='true'] nav.ux-team-sidebar .ux-team-caption",
      wide,
    );
    expect(clip).toHaveLength(1);
  });
  test('a hover fills the row and does not underline it', () => {
    expect(
      declared(only(find(teamRules, 'nav.ux-team-sidebar summary:hover')), 'text-decoration'),
    ).toBe('none');
  });
});

describe('the list scrolls on its own, with a thin bar made for the navy', () => {
  test('the list uses the standard scrollbar properties from existing tokens and never scrolls sideways', () => {
    const rule = only(find(leftRules, scroller, wide).filter((r) => /overflow-y/.test(r.body)));
    expect(declared(rule, 'overflow-y')).toBe('auto');
    expect(declared(rule, 'overflow-x')).toBe('hidden');
    expect(declared(rule, 'scrollbar-width')).toBe('thin');
    expect(declared(rule, 'scrollbar-color')).toBe(
      'var(--ac-border-strong) var(--ac-surface-navy)',
    );
    expect(declared(rule, 'overscroll-behavior')).toBe('contain');
    expect(declared(rule, 'scroll-padding-block')).toMatch(/^var\(--space-(?:[2-9]|1\d)\)$/);
  });
  test('the drawer panel is the scroller below 1024 px, on its white ground', () => {
    const rule = only(
      find(leftRules, '.ux-leftnav-panel', narrow).filter((r) => /fixed/.test(r.body)),
    );
    expect(declared(rule, 'overflow-y')).toBe('auto');
    expect(declared(rule, 'scrollbar-width')).toBe('thin');
    expect(declared(rule, 'scrollbar-color')).toBe(
      'var(--ac-text-tertiary) var(--ac-surface-subtle)',
    );
    expect(declared(rule, 'scroll-padding-block')).toMatch(/^var\(--space-(?:[2-9]|1\d)\)$/);
  });
  test('the collapse button never shrinks, and the rail never clips a menu that opens from the bar', () => {
    const button = find(leftRules, '.ux-leftnav-panel .ux-leftnav-collapse', wide);
    expect(button.some((rule) => declared(rule, 'flex') === 'none')).toBe(true);
    for (const rule of find(leftRules, '.ux-leftnav-rail', wide))
      expect(declared(rule, 'overflow')).not.toBe('hidden');
  });
  test('the WebKit bar exists only as a fallback and no gutter is reserved', () => {
    expect(leftNav).not.toContain('scrollbar-gutter');
    const withBar = leftRules.filter((rule) => rule.selector.includes('::-webkit-scrollbar'));
    expect(withBar.length).toBeGreaterThan(0);
    for (const rule of withBar)
      expect(rule.context.some((c) => noScrollbarColor.test(c))).toBe(true);
    expect(teamNav).not.toContain('::-webkit-scrollbar');
  });
  test('forced colours leave the system scrollbar alone', () => {
    const rule = only(
      leftRules.filter(
        (r) =>
          r.selector === '.ux-leftnav-panel > nav, .ux-leftnav-panel' && r.context.length === 1,
      ),
    );
    expect(rule.context[0]).toBe('@media (forced-colors: active)');
    expect(declared(rule, 'scrollbar-color')).toBe('auto');
  });
});

describe('the five Admin pages read as links, not expanders', () => {
  const dot = 'nav.ux-team-sidebar .ux-team-group ul a::before';
  test('each link has a round dot drawn in CSS, in its own colour, in a 20 px cell', () => {
    const rule = only(find(teamRules, dot));
    expect(declared(rule, 'content')).toBe("''");
    expect(declared(rule, 'border-radius')).toBe('50%');
    expect(declared(rule, 'background')).toBe('currentColor');
    expect(declared(rule, 'width')).toBe('var(--space-1)');
    expect(declared(rule, 'margin-inline')).toBe('var(--space-2)');
  });
  test('in forced colours the dot and the focus ring use system colours', () => {
    const forced = /^@media \(forced-colors: active\)$/;
    expect(declared(only(find(teamRules, dot, forced)), 'background')).toBe('LinkText');
    const ring = only(
      find(
        teamRules,
        'nav.ux-team-sidebar a:focus-visible, nav.ux-team-sidebar summary:focus-visible',
        forced,
      ),
    );
    expect(declared(ring, 'outline')).toBe('3px solid Highlight');
  });
  test('the group list keeps the indent from shells.css: no override here', () => {
    expect(teamRules.some((rule) => /\.ux-team-group ul$/.test(rule.selector))).toBe(false);
  });
  test('the link helper takes no icon for a sub-link and the Admin gate, hrefs and caption are as before', () => {
    expect(sidebar).toContain('icon: string | null,');
    expect(sidebar).toContain('{icon ? <OperatorIcon name={icon} /> : null}');
    expect(sidebar).toMatch(/entry\.label,\s*null,\s*placeHref\(entry\.id, urls, tenant\)/);
    expect(sidebar).not.toContain("'chevron',");
    expect(sidebar).toContain('id="workspace-navigation"');
    expect(sidebar).toContain('teamItemsFor(role)');
    expect(sidebar).toContain('{adminItem ? (');
    expect(sidebar).toContain('className="ux-team-caption" aria-hidden="true"');
    expect(sidebar).toContain('<span>{label(adminItem)}</span>');
    expect(sidebar).toContain('title={labelText(adminItem)}');
    expect(sidebar).not.toContain('scrollIntoView');
    expect(sidebar).not.toContain('onToggle');
  });
});

describe('Stronger Colours gives the sidebar scrollbar its white thumb and changes nothing else', () => {
  // The Today fixture does not load comfort.css, so this source check is the only guard for these two rules.
  const comfortRules = rulesOf(read('apps/web/app/comfort.css'));
  const blocks = comfortRules.filter(
    (rule) =>
      rule.selector === "html[data-contrast='more'] nav.ux-team-sidebar" ||
      rule.selector === 'html:root nav.ux-team-sidebar',
  );
  test('both blocks (the chosen setting and the device setting) carry the thumb, the track and the white stripe colour', () => {
    expect(blocks).toHaveLength(2);
    expect(blocks.map((rule) => rule.context.length).sort()).toEqual([0, 1]);
    for (const rule of blocks) {
      expect(declared(rule, 'scrollbar-width')).toBe('auto');
      expect(declared(rule, 'scrollbar-color')).toBe('var(--on-brand) var(--ac-surface-navy)');
      expect(declared(rule, '--selected')).toBe('var(--on-brand)');
    }
  });
  test('the ring and the stripe rules are as W10 pinned them: no scrollbar declaration, no new box-shadow or outline', () => {
    const ringRules = comfortRules.filter((rule) =>
      /nav\.ux-team-sidebar\)? :focus-visible/.test(rule.selector),
    );
    expect(ringRules).toHaveLength(2);
    for (const rule of ringRules) {
      expect(rule.body).toBe(
        'outline-color: var(--on-brand); box-shadow: 0 0 0 2px var(--brand-deep);',
      );
    }
    for (const rule of blocks) expect(rule.body).not.toMatch(/box-shadow|outline/);
  });
});

describe('the header controls beside the left bar keep their 44 px targets', () => {
  test('no rule in left-nav.css shortens a header button or link below 44 px at 1024 px and wider', () => {
    for (const rule of leftRules)
      if (/ux-bar-primary|ux-app-button|ux-app-link/.test(rule.selector))
        expect(declared(rule, 'min-height') ?? '44px').toBe('44px');
    expect(leftNav).not.toMatch(/min-height:\s*40px/);
  });
});

describe('the stylesheets stay within the design system', () => {
  test('every token the two stylesheets use is defined (in globals.css or in the sheet), with no text-transform and no em dash', () => {
    for (const source of [teamNav, leftNav]) {
      const used = new Set([...source.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!));
      const undefinedTokens = [...used].filter(
        (name) => !new RegExp(`^\\s*${name}:`, 'm').test(`${globals}\n${source}`),
      );
      expect(undefinedTokens).toEqual([]);
      expect(source).not.toMatch(/text-transform/);
      expect(source).not.toContain('\u2014');
    }
  });
});
