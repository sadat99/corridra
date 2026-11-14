import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// W10 Stronger Colours: the colours it puts on the page are computed here from the real stylesheets (app/globals.css
// for the default tokens, app/comfort.css for the override), with no browser, and every text role must reach 7 to 1
// (WCAG 2.2 AAA, "enhanced") and every line or focus mark 3 to 1. The browser specs then check the pages with axe.
const web = resolve('apps/web');
const read = (file: string) => readFileSync(resolve(web, file), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------------------------
// A small reader for the stylesheets (they use no nesting).
type Rule = { selector: string; declarations: Map<string, string>; media?: undefined };
type MediaRule = { media: string; rules: Rule[] };

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of splitTopLevel(body, ';')) {
    const colon = part.indexOf(':');
    if (colon > 0) declarations.set(part.slice(0, colon).trim(), squash(part.slice(colon + 1)));
  }
  return declarations;
}

/** The top-level rules and the rules inside each @media block. */
function parseSheet(css: string): { rules: Rule[]; media: MediaRule[] } {
  const text = stripComments(css);
  const rules: Rule[] = [];
  const media: MediaRule[] = [];
  const walk = (source: string, into: Rule[], mediaInto: MediaRule[] | null) => {
    let i = 0;
    while (i < source.length) {
      const open = source.indexOf('{', i);
      if (open < 0) break;
      const head = squash(source.slice(i, open));
      let depth = 1;
      let j = open + 1;
      for (; j < source.length && depth > 0; j++) {
        if (source[j] === '{') depth++;
        else if (source[j] === '}') depth--;
      }
      const body = source.slice(open + 1, j - 1);
      if (head.startsWith('@media')) {
        const inner: Rule[] = [];
        walk(body, inner, null);
        mediaInto?.push({ media: head, rules: inner });
      } else if (!head.startsWith('@')) {
        into.push({ selector: head, declarations: parseDeclarations(body) });
      }
      i = j;
    }
  };
  walk(text, rules, media);
  return { rules, media };
}

// ---------------------------------------------------------------------------------------------------------------
// Colours: hex, transparent, var(), and color-mix(in srgb, ...) with a premultiplied mix, as browsers compute it.
type Rgba = { r: number; g: number; b: number; a: number };
type Env = Map<string, string>;

function evaluate(value: string, env: Env, seen: string[] = []): Rgba {
  const text = value.trim();
  const hex = text.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const variable = text.match(/^var\((--[\w-]+)\)$/);
  if (variable) {
    const name = variable[1];
    if (seen.includes(name)) throw new Error(`circular token ${name}`);
    const next = env.get(name);
    if (next === undefined) throw new Error(`token ${name} is not declared`);
    return evaluate(next, env, [...seen, name]);
  }
  const mix = text.match(/^color-mix\(in srgb,(.*)\)$/s);
  if (mix) {
    const [first, second] = splitTopLevel(mix[1], ',').map((part) => {
      const share = part.match(/^(.*\S)\s+(\d+(?:\.\d+)?)%$/s);
      return {
        colour: evaluate(share ? share[1] : part, env, seen),
        share: share ? Number(share[2]) : null,
      };
    });
    const firstShare = first.share ?? (second.share === null ? 50 : 100 - second.share);
    const secondShare = second.share ?? 100 - firstShare;
    const alpha = (firstShare * first.colour.a + secondShare * second.colour.a) / 100;
    const channel = (key: 'r' | 'g' | 'b') =>
      alpha === 0
        ? 0
        : (firstShare * first.colour.a * first.colour[key] +
            secondShare * second.colour.a * second.colour[key]) /
          (100 * alpha);
    return { r: channel('r'), g: channel('g'), b: channel('b'), a: alpha };
  }
  throw new Error(`cannot read the colour ${text}`);
}

const luminance = ({ r, g, b }: Rgba) => {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const over = (top: Rgba, below: Rgba): Rgba => ({
  r: top.r * top.a + below.r * (1 - top.a),
  g: top.g * top.a + below.g * (1 - top.a),
  b: top.b * top.a + below.b * (1 - top.a),
  a: 1,
});
function ratio(foreground: Rgba, background: Rgba): number {
  const front = foreground.a < 1 ? over(foreground, background) : foreground;
  const [lighter, darker] = [luminance(front), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Every custom property a token depends on, itself included. */
function reach(name: string, env: Env, found = new Set<string>()): Set<string> {
  if (found.has(name)) return found;
  found.add(name);
  for (const [, next] of (env.get(name) ?? '').matchAll(/var\((--[\w-]+)\)/g))
    reach(next, env, found);
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// The tokens as the page has them: default, and with Stronger Colours.
const globals = parseSheet(read('app/globals.css'));
const comfort = parseSheet(read('app/comfort.css'));
const attributeScope = "html[data-contrast='more']";
const mediaScope = 'html:root';
const mediaQuery = '@media (prefers-contrast: more)';

const merge = (into: Env, from: Map<string, string>) => from.forEach((v, k) => into.set(k, v));
const rootsOf = (rules: Rule[]) => rules.filter((rule) => rule.selector === ':root');
const ruleFor = (rules: Rule[], selector: string) => {
  const rule = rules.find((candidate) => candidate.selector === selector);
  if (!rule) throw new Error(`no rule for ${selector}`);
  return rule;
};

const defaultTokens: Env = new Map();
rootsOf(globals.rules).forEach((rule) => merge(defaultTokens, rule.declarations));
const footerRule = parseSheet(read('components/site-footer.css')).rules.find((rule) =>
  rule.declarations.has('--footer-text'),
);
if (!footerRule) throw new Error('the footer text tokens are declared on .guide-footer');
const defaultFooter: Env = new Map(defaultTokens);
merge(defaultFooter, footerRule.declarations);

const modeTokens: Env = new Map(defaultTokens);
const modeDeclarations = ruleFor(comfort.rules, attributeScope).declarations;
merge(modeTokens, modeDeclarations);
const modeFooter: Env = new Map(modeTokens);
merge(modeFooter, footerRule.declarations);
merge(modeFooter, ruleFor(comfort.rules, `${attributeScope} .guide-footer`).declarations);

const copperRule = comfort.rules.find((rule) => rule.selector.includes('.ac1-hook'));
if (!copperRule) throw new Error('the copper ink text rule is in comfort.css');
const copperInkMode = copperRule.declarations.get('color') ?? '';

// ---------------------------------------------------------------------------------------------------------------
// The pair table. fg and bg are tokens (or, for fg, a colour expression); min is the least ratio.
type Pair = { fg: string; bg: string; min: number; scope?: 'footer'; defaultFg?: string };
// Every light surface a text colour can sit on, and every text colour: the table is their product, so the claim that
// every text role reaches 7 to 1 on every surface is true by construction, not by a hand-picked list.
const lights = [
  '--paper',
  '--surface-0',
  '--surface-1',
  '--surface-2',
  '--surface-raised',
  '--surface-subtle',
  '--selected-surface',
  '--info-surface',
  '--positive-surface',
  '--caution-surface',
  '--critical-surface',
  '--unknown-surface',
];
const textColours = [
  '--ink',
  '--text-2',
  '--text-3',
  '--muted',
  '--brand',
  '--action',
  '--info',
  '--selected',
  '--accent',
  '--positive',
  '--caution',
  '--critical',
  '--unknown',
  '--caution-text',
  '--brand-deep',
];
const text = (fg: string, backgrounds: string[]): Pair[] =>
  backgrounds.map((bg) => ({ fg, bg, min: 7 }));
const pairs: Pair[] = [
  ...textColours.flatMap((fg) => text(fg, lights)),
  ...text('--on-action', ['--action', '--action-hover', '--action-pressed']),
  ...text('--on-brand', ['--brand', '--brand-hover', '--brand-deep']),
  ...text('--paper', ['--accent', '--brand-hover']),
  // The selected tab's text is the pressed cobalt, which Stronger Colours does not change.
  { fg: '--ac-cobalt-pressed', bg: '--ac-surface-selected', min: 7 },
  // The copper ink text (home hook and number, the organise tags) is mixed toward Ink.
  ...['--paper', '--surface-1', '--caution-surface'].map((bg) => ({
    fg: copperInkMode,
    defaultFg: 'var(--ac-copper-ink)',
    bg,
    min: 7,
  })),
  // The footer's own text on the navy band.
  { fg: '--footer-text', bg: '--brand-deep', min: 7, scope: 'footer' },
  { fg: '--footer-quiet', bg: '--brand-deep', min: 7, scope: 'footer' },
  // Lines, focus and other marks that carry meaning: 3 to 1, and 4.5 to 1 for the edge of a field.
  { fg: '--line', bg: '--paper', min: 3 },
  { fg: '--line', bg: '--surface-1', min: 3 },
  { fg: '--line', bg: '--surface-2', min: 3 },
  { fg: '--line', bg: '--selected-surface', min: 3 },
  { fg: '--border-strong', bg: '--paper', min: 4.5 },
  { fg: '--border-strong', bg: '--surface-1', min: 4.5 },
  { fg: '--border-strong', bg: '--surface-2', min: 4.5 },
  { fg: '--border-strong', bg: '--caution-surface', min: 4.5 },
  { fg: '--focus', bg: '--paper', min: 7 },
  { fg: '--focus', bg: '--surface-1', min: 7 },
  { fg: '--selected', bg: '--paper', min: 3 },
  { fg: '--selected', bg: '--selected-surface', min: 3 },
  { fg: '--action', bg: '--paper', min: 3 },
  // On the navy regions the focus ring is white (comfort.css), not cobalt.
  { fg: '--on-brand', bg: '--brand-deep', min: 7 },
  // The ring inside the white selected tab of the player is navy; the stripe of the selected sidebar item is white.
  { fg: '--brand-deep', bg: '--on-brand', min: 7 },
  { fg: '--on-brand', bg: '--ac-surface-navy', min: 3 },
  { fg: '--footer-line', bg: '--brand-deep', min: 3, scope: 'footer' },
  // A soft glow that only supports the focus outline: it must only get stronger than the default.
  { fg: '--ring', bg: '--surface-1', min: 1.1 },
];

const tokensFor = (pair: Pair, mode: boolean) =>
  pair.scope === 'footer' ? (mode ? modeFooter : defaultFooter) : mode ? modeTokens : defaultTokens;
const valueOf = (expression: string, env: Env) =>
  evaluate(expression.startsWith('--') ? `var(${expression})` : expression, env);
const ratioOf = (pair: Pair, mode: boolean) => {
  const env = tokensFor(pair, mode);
  const background = valueOf(pair.bg, env);
  return ratio(valueOf(!mode && pair.defaultFg ? pair.defaultFg : pair.fg, env), background);
};
const failures = (list: Pair[], mode: boolean) =>
  list
    .filter((pair) => ratioOf(pair, mode) < pair.min)
    .map((pair) => `${pair.fg} on ${pair.bg}: ${ratioOf(pair, mode).toFixed(2)} < ${pair.min}`);

const modeNames = [...modeDeclarations.keys()];

describe('the colours with Stronger Colours on', () => {
  test('every text role reaches 7 to 1 and every line or focus mark 3 to 1 on every surface it sits on', () => {
    expect(failures(pairs, true)).toEqual([]);
  });

  test('the table is the full product of the text colours and the light surfaces, so nothing in it is hand-picked', () => {
    for (const fg of textColours)
      for (const bg of lights)
        expect(
          pairs.some((pair) => pair.fg === fg && pair.bg === bg && pair.min === 7),
          `${fg} on ${bg}`,
        ).toBe(true);
    expect(textColours.length * lights.length).toBeGreaterThanOrEqual(180);
  });

  test('the lowest text ratio is the unknown colour on the selected tint, 7.03 to 1, still above 7 to 1', () => {
    const text7 = pairs.filter((pair) => pair.min === 7);
    const lowest = Math.min(...text7.map((pair) => ratioOf(pair, true)));
    expect(lowest).toBeGreaterThan(7);
    expect(lowest).toBeCloseTo(
      ratioOf({ fg: '--unknown', bg: '--selected-surface', min: 7 }, true),
      5,
    );
    expect(lowest).toBeCloseTo(7.03, 2);
  });

  test('the status colours reach 7 to 1 on the tints they were once just under (6.86 to 6.99 before)', () => {
    for (const [fg, bg] of [
      ['--positive', '--selected-surface'],
      ['--positive', '--info-surface'],
      ['--caution', '--selected-surface'],
      ['--caution', '--info-surface'],
      ['--caution', '--critical-surface'],
    ])
      expect(ratioOf({ fg, bg, min: 7 }, true), `${fg} on ${bg}`).toBeGreaterThanOrEqual(7.1);
  });

  test('the designer table is reproduced from the stylesheets', () => {
    const expected: [string, string, number][] = [
      ['--text-2', '--paper', 9.05],
      ['--text-3', '--paper', 7.85],
      ['--brand', '--paper', 7.67],
      ['--on-action', '--action', 8.16],
      ['--positive', '--paper', 7.89],
      ['--critical', '--paper', 7.79],
      ['--caution', '--paper', 7.77],
      ['--unknown', '--paper', 7.7],
      ['--brand', '--critical-surface', 7.13],
      ['--line', '--paper', 3.33],
    ];
    for (const [fg, bg, value] of expected)
      // The designer rounded each mix to a hex colour; this reads the mixes unrounded, so allow a rounding difference. The two status rows follow the status colours set to 76 percent.
      expect(Math.abs(ratioOf({ fg, bg, min: 0 }, true) - value), `${fg} on ${bg}`).toBeLessThan(
        0.08,
      );
  });

  test('every ratio that Stronger Colours touches is strictly higher than the default, and none is lower', () => {
    for (const pair of pairs) {
      const env = tokensFor(pair, true);
      const reached = new Set<string>();
      for (const name of [pair.bg, ...(pair.fg.startsWith('--') ? [pair.fg] : [])])
        reach(name, env).forEach((found) => reached.add(found));
      const touched =
        modeNames.some((name) => reached.has(name)) ||
        (pair.scope === 'footer' && pair.fg.startsWith('--footer')) ||
        pair.fg !== (pair.defaultFg ?? pair.fg);
      const before = ratioOf(pair, false);
      const after = ratioOf(pair, true);
      if (touched) expect(after, `${pair.fg} on ${pair.bg}`).toBeGreaterThan(before);
      else expect(after, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(before - 1e-9);
    }
  });

  test('the default page fails the same table, so the check can fail (negative control)', () => {
    const defaults = failures(pairs, false);
    expect(defaults).toContain('--text-2 on --paper: 6.63 < 7');
    expect(defaults.length).toBeGreaterThan(20);
    expect(failures([{ fg: '--line', bg: '--paper', min: 3 }], false)).toHaveLength(1);
  });
});

describe('what Stronger Colours overrides is covered by the table', () => {
  test('every token the block sets is reached by a pair of the table (coverage denial)', () => {
    const reached = new Set<string>();
    for (const pair of pairs.filter((candidate) => !candidate.scope)) {
      reach(pair.bg, modeTokens).forEach((name) => reached.add(name));
      if (pair.fg.startsWith('--')) reach(pair.fg, modeTokens).forEach((name) => reached.add(name));
    }
    expect(modeNames.filter((name) => !reached.has(name))).toEqual([]);
  });

  test('a token set but missing from the table would be found', () => {
    const reached = reach('--ink', modeTokens);
    expect(modeNames.filter((name) => !reached.has(name)).length).toBeGreaterThan(5);
  });

  test('the footer tokens the block sets are in the table', () => {
    const footerNames = [
      ...ruleFor(comfort.rules, `${attributeScope} .guide-footer`).declarations.keys(),
    ];
    const inTable = new Set(pairs.filter((pair) => pair.scope === 'footer').map((pair) => pair.fg));
    expect(footerNames.filter((name) => !inTable.has(name))).toEqual([]);
  });
});

describe('the stylesheet keeps to its own scope', () => {
  const scoped = (selector: string) =>
    selector.startsWith(attributeScope) || selector.startsWith(mediaScope);

  test('it declares only the four neutral colour names of the design system, never a new one', () => {
    const declared = (rules: Rule[]) =>
      rules.flatMap((rule) =>
        [...rule.declarations.keys()].filter((name) => name.startsWith('--ac-')),
      );
    const expected = [
      '--ac-border',
      '--ac-border-strong',
      '--ac-text-secondary',
      '--ac-text-tertiary',
    ];
    const media = comfort.media.flatMap((block) => block.rules);
    expect(declared(comfort.rules).sort()).toEqual(expected);
    expect(declared(media).sort()).toEqual(expected);
    // Those names exist, once each, in the design system.
    for (const name of expected) expect(defaultTokens.has(name), name).toBe(true);
  });

  test('the cobalt, navy, ink, paper and copper primitives are never re-assigned', () => {
    const everything = [...comfort.rules, ...comfort.media.flatMap((block) => block.rules)];
    const all = new Set(everything.flatMap((rule) => [...rule.declarations.keys()]));
    for (const name of [
      '--ac-cobalt',
      '--ac-cobalt-hover',
      '--ac-cobalt-pressed',
      '--ac-navy',
      '--ac-ink',
      '--ac-paper',
      '--ac-porcelain',
      '--ac-copper',
      '--ac-copper-ink',
    ])
      expect(all.has(name), name).toBe(false);
  });

  test('the device setting block holds the same rules as the saved choice, word for word', () => {
    expect(comfort.media.map((block) => block.media)).toEqual([mediaQuery]);
    const media = comfort.media[0].rules;
    const attribute = comfort.rules.filter((rule) => rule.selector.startsWith(attributeScope));
    expect(attribute.length).toBeGreaterThan(8);
    expect(media.every((rule) => rule.selector.startsWith(mediaScope))).toBe(true);
    const normal = (rules: Rule[], scope: string) =>
      rules.map((rule) => ({
        selector: rule.selector.replace(scope, 'SCOPE'),
        declarations: [...rule.declarations.entries()],
      }));
    expect(normal(media, mediaScope)).toEqual(normal(attribute, attributeScope));
  });

  test('outside those two scopes comfort.css sets no colour, so the default page is untouched', () => {
    const outside = comfort.rules.filter((rule) => !scoped(rule.selector));
    expect(outside.length).toBeGreaterThan(0);
    const allowed = new Set([
      'font-size',
      'transition-duration',
      'animation-duration',
      'animation-iteration-count',
      'scroll-behavior',
      'transform',
    ]);
    for (const rule of outside)
      for (const property of rule.declarations.keys())
        expect(allowed.has(property), `${rule.selector} { ${property} }`).toBe(true);
    expect(comfort.media.every((block) => block.media === mediaQuery)).toBe(true);
  });

  test('the override uses only color-mix in srgb and existing tokens: no hex and no colour function', () => {
    const source = stripComments(read('app/comfort.css'));
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch|hwb)\(/);
    for (const [, space] of source.matchAll(/color-mix\(in ([\w-]+)/g)) expect(space).toBe('srgb');
  });
});

describe('colours that components take straight from the palette', () => {
  const families = [
    'cobalt',
    'cobalt-hover',
    'cobalt-pressed',
    'critical',
    'warning',
    'positive',
    'unknown',
    'copper',
    'copper-ink',
  ];
  // file | property | primitive. Each is either not text (a mark, a dot, a rule) or covered by a pair above.
  const allowed = new Set([
    'app/account/move/move-view.css|background|--ac-warning',
    'app/account/move/move-view.css|color|--ac-copper-ink',
    'app/account/rooms/[requestId]/room-frame.css|color|--ac-copper-ink',
    'app/account/delegations/programme-room.css|color|--ac-copper-ink',
    'components/home-landing.css|color|--ac-copper-ink',
    'components/ux/field-tabs.css|color|--ac-cobalt-pressed',
    'components/ux/field-tabs.css|box-shadow|--ac-cobalt',
    'components/ux/utility-menus.css|background|--ac-cobalt',
    'app/globals.css|background|--ac-copper',
    'app/globals.css|border-top|--ac-copper',
  ]);

  const used = () => {
    const found = new Set<string>();
    const files = (readdirSync(web, { recursive: true }) as string[]).filter(
      (file) =>
        file.endsWith('.css') &&
        !/(?:^|\/)(?:node_modules|\.next)\//.test(file) &&
        file !== 'app/comfort.css',
    );
    expect(files.length).toBeGreaterThan(20);
    const pattern = new RegExp(
      `([a-z-]+)\\s*:\\s*[^;{}]*var\\((--ac-(?:${families.join('|')}))\\)`,
      'g',
    );
    for (const file of files) {
      // The token layer's own :root blocks are where the palette is declared and mapped.
      const source = stripComments(read(file)).replace(/:root\s*\{[^}]*\}/g, '');
      for (const match of source.matchAll(pattern))
        found.add(`${relative(web, resolve(web, file))}|${match[1]}|${match[2]}`);
    }
    return found;
  };

  test('only the listed uses bypass the semantic tokens, so Stronger Colours reaches every text colour', () => {
    expect([...used()].filter((entry) => !allowed.has(entry))).toEqual([]);
  });

  test('the list holds no use that is gone', () => {
    const found = used();
    expect([...allowed].filter((entry) => !found.has(entry))).toEqual([]);
  });

  test('the colours that are text through the tokens are not the primitives: critical, warning and cobalt text', () => {
    // The remapped uses now name the token that Stronger Colours changes.
    expect(read('components/source-ledger.css')).not.toMatch(/color:\s*var\(--ac-warning\)/);
    expect(read('components/ux/ux-kit.css')).not.toMatch(/var\(--ac-(?:critical|cobalt)\)/);
  });
});
