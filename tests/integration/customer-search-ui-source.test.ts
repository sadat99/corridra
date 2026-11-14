import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, test } from 'vitest';
import { titleCaseFindings } from './title-case-scan';

// Source-level guards for the customer search UI (docs/revamp/specs/navigation-v1/customer-search.md, sections 6, 8, 9
// and 10): the stylesheet touches only its own classes and the customer header, the client files use no storage and no
// staff file, the button mounts only in the customer branch of the header, the words are clean, and the browser bundle
// holds no server authority code. The behaviour is in tests/operator/customer-search-ui.spec.ts.
const component = 'apps/web/components/ux/customer-search.tsx';
const stylesheet = 'apps/web/components/ux/customer-search.css';
const pure = [
  'apps/web/lib/ux/customer-search-facts.ts',
  'apps/web/lib/ux/customer-search-pages.ts',
  'apps/web/lib/ux/customer-search-status.ts',
];
const clientFiles = [component, ...pure];
const read = (path: string) => readFileSync(path, 'utf8');
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
const css = stripComments(read(stylesheet));

/** Every rule prelude of a stylesheet with the at-rules it sits in, ignoring keyframe steps. */
function rules(source: string) {
  const found: { selector: string; inside: string[] }[] = [];
  const stack: { prelude: string; keyframes: boolean }[] = [];
  let prelude = '';
  for (const char of source) {
    if (char === '{') {
      const text = prelude.trim();
      const parent = stack[stack.length - 1];
      const keyframes = text.startsWith('@keyframes') || (parent?.keyframes ?? false);
      if (!text.startsWith('@') && !keyframes)
        found.push({
          selector: text,
          inside: stack.filter((item) => item.prelude.startsWith('@')).map((item) => item.prelude),
        });
      stack.push({ prelude: text, keyframes });
      prelude = '';
    } else if (char === '}') {
      stack.pop();
      prelude = '';
    } else if (char === ';') prelude = '';
    else prelude += char;
  }
  return found;
}
const allRules = rules(css);
const selectors = allRules.flatMap((rule) =>
  rule.selector.split(',').map((selector) => ({ selector: selector.trim(), inside: rule.inside })),
);

describe('the stylesheet', () => {
  test('every class is a ux-csearch class, or sits under the customer header or inside a ux-csearch selector', () => {
    expect(selectors.length).toBeGreaterThan(60);
    for (const { selector } of selectors) {
      const classes = [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((match) => match[1]!);
      for (const name of classes) {
        if (name.startsWith('ux-csearch')) continue;
        // Existing classes are named only as the header to scope under, the icon inside the dialog's own classes, or the
        // header's own brand and the left bar that the field aligns to.
        const allowed =
          name === 'ux-customer-header' ||
          (name === 'corridra-icon' && /\.ux-csearch/.test(selector)) ||
          (selector.includes('.ux-customer-header') &&
            ['ux-bar-tools', 'brand', 'site-shell', 'ux-leftnav-frame'].includes(name));
        expect(allowed, `${name} in ${selector}`).toBe(true);
      }
    }
  });

  test('every rule that reaches the tools row or the header is scoped under .ux-customer-header', () => {
    for (const { selector } of selectors) {
      if (/\.ux-bar-tools|\.ux-app-header|\.site-header|\.ux-team-header|\.brand\b/.test(selector))
        expect(selector, selector).toMatch(/\.ux-customer-header[^,]*(\.ux-bar-tools|\.brand|$)/);
      if (/\.ux-bar-tools/.test(selector))
        expect(selector.indexOf('.ux-customer-header'), selector).toBeGreaterThanOrEqual(0);
    }
    // The shared selectors of customer-bar.css and the team header are not written here.
    expect(css).not.toMatch(/:is\(\s*\.ux-customer-header/);
    expect(css).not.toMatch(/ux-team-/);
    expect(css).not.toMatch(/ux-palette/);
  });

  test('tokens only: no colour value, and every var() is defined by the design system', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/);
    const globals = read('apps/web/app/globals.css');
    const used = new Set([...css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((match) => match[1]!));
    expect(used.size).toBeGreaterThan(20);
    for (const name of used)
      expect(globals.includes(`${name}:`) || globals.includes(`${name} :`), name).toBe(true);
    // No raw font family either.
    for (const [, value] of css.matchAll(/font-family\s*:\s*([^;]+);/g))
      expect(value, 'font-family').toMatch(/^var\(/);
  });

  test('KI-53: under 640 px the dialog sets max-width: none and the width of the viewport less 1 rem', () => {
    const phone = allRules.filter((rule) => rule.inside.includes('@media (max-width: 639.98px)'));
    expect(phone.length).toBeGreaterThan(8);
    const panel = phone.find((rule) => rule.selector === '.ux-csearch');
    expect(panel).toBeDefined();
    const block = css.slice(css.indexOf('@media (max-width: 639.98px)'));
    const panelBlock = block.slice(
      block.indexOf('.ux-csearch {'),
      block.indexOf('}', block.indexOf('.ux-csearch {')),
    );
    expect(panelBlock).toContain('width: calc(100vw - 1rem)');
    expect(panelBlock).toContain('max-width: none');
    expect(panelBlock).toContain('overflow-y: auto');
    // The list gives way to at least 8 rem, and the panel scrolls beyond that.
    expect(phone.some((rule) => rule.selector === '.ux-csearch-region')).toBe(true);
    expect(block).toMatch(/\.ux-csearch-region\s*\{\s*min-height:\s*8rem/);
  });

  test('KI-54: the wide field starts at 64em, not at a pixel width, and the narrow default is the icon', () => {
    expect(css).toContain('@media (min-width: 64em)');
    expect(css).not.toMatch(
      /@media[^{]*min-width:\s*1024px[^{]*\{\s*\.ux-customer-header \.ux-csearch-trigger/,
    );
    const wide = allRules.filter(
      (rule) =>
        rule.selector === '.ux-customer-header .ux-csearch-trigger' &&
        /max-width:\s*35rem/.test(css.slice(css.indexOf(rule.selector))),
    );
    expect(wide.length).toBeGreaterThan(0);
    for (const rule of allRules) {
      if (rule.selector !== '.ux-customer-header .ux-csearch-trigger') continue;
      // The first (unconditioned) trigger rule is the icon: 44 px minimum, no border, transparent.
      if (rule.inside.length === 0) {
        const at = css.indexOf(`${rule.selector} {`);
        const body = css.slice(at, css.indexOf('}', at));
        // A fixed target in px, so the text size cannot grow it and push the tools onto another line.
        expect(body).toContain('width: 44px');
        expect(body).toContain('min-width: 44px');
        expect(body).toContain('height: 44px');
        expect(body).toContain('min-height: 44px');
        expect(body).toContain('border: 0');
        expect(body).toContain('background: transparent');
        expect(body).not.toContain('max-width');
        break;
      }
    }
    // The glyph below 64em is 24 px, not rem: the only rem-sized glyph is the field's.
    const glyphs = [...css.matchAll(/\.ux-csearch-trigger \.corridra-icon\s*\{([^}]*)\}/g)].map(
      (m) => m[1]!,
    );
    expect(glyphs).toHaveLength(3);
    expect(
      glyphs.filter((body) => /width:\s*24px/.test(body) && /height:\s*24px/.test(body)),
    ).toHaveLength(2);
    expect(glyphs.filter((body) => /width:\s*1\.25rem/.test(body))).toHaveLength(1);
    expect(css).not.toContain('1.75rem');
    // The tools keep a 4 px gap from 701 to 1023 px at every text size.
    expect(css).toContain('column-gap: min(var(--space-1), 4px)');
    // Every condition the trigger's rules sit in is the em query, the container query on the tools box, or a media
    // feature that is not a width (colour, contrast, motion); none is a pixel or rem width that could stand in for 64em.
    for (const rule of allRules.filter((item) => item.selector.includes('ux-csearch-trigger')))
      for (const condition of rule.inside)
        expect(
          [
            '@media (min-width: 64em)',
            '@media (forced-colors: active)',
            '@media (prefers-contrast: more)',
            '@media (min-width: 701px) and (max-width: 1023.98px) and (max-width: 63.99em)',
            '@container (max-width: 26rem)',
            '@container (width > 26rem)',
          ],
          `${rule.selector} in ${condition}`,
        ).toContain(condition);
    expect(css).toMatch(/@container \(max-width: 26rem\)/);
    // The field's own rules are all inside the 64em query.
    const fieldRules = allRules.filter(
      (rule) =>
        rule.selector === '.ux-customer-header .ux-bar-tools' &&
        rule.inside.some((media) => media === '@media (min-width: 64em)'),
    );
    expect(fieldRules.length).toBeGreaterThan(0);
  });

  test('forced colours, reduced motion and Stronger Colours are covered', () => {
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain("html[data-contrast='more']");
    expect(css).toContain('@media (prefers-contrast: more)');
    expect(css).toContain('border: 1px solid var(--border-strong)');
    expect(css).toContain('Highlight');
    expect(css).toContain('ButtonText');
    expect(css).toContain('MarkText');
    // The visible field carries no border in normal mode (CX-03 fails a header control with text and a border).
    const trigger = css.slice(css.indexOf('.ux-customer-header .ux-csearch-trigger {'));
    expect(trigger.slice(0, trigger.indexOf('}'))).toContain('border: 0');
  });

  test('logical properties only, so the dialog and the field mirror', () => {
    expect(css).not.toMatch(/\b(?:margin|padding)-(?:left|right)\b|\b(?:left|right)\s*:/);
    expect(css).not.toMatch(/text-align:\s*(?:left|right)/);
  });

  test('targets are at least 44 px and text is never below 12 px', () => {
    expect(css).not.toMatch(/font-size:\s*(?:[0-9](?:\.\d+)?|1[01](?:\.\d+)?)px/);
    expect(css).not.toMatch(/font-size:\s*0?\.[0-6]\d*rem/);
    expect(css).toMatch(/\.ux-csearch-row\s*\{[^}]*min-height:\s*56px/);
    expect(css).toMatch(/\.ux-csearch-scopes button\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.ux-csearch-close\s*\{[^}]*min-height:\s*44px/);
  });
});

describe('the client files', () => {
  const importsOf = (source: string) =>
    [...source.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((match) => match[1]!);

  test('no storage, no cookie, no history, no URLSearchParams, no cache API', () => {
    for (const path of clientFiles) {
      const code = stripComments(read(path));
      expect(code, path).not.toMatch(
        /\b(?:localStorage|sessionStorage|indexedDB|BroadcastChannel|navigator\.storage|serviceWorker)\b/,
      );
      expect(code, path).not.toMatch(/document\.cookie|\bcaches\.|\bhistory\.|window\.history/);
      expect(code, path).not.toMatch(/URLSearchParams/);
      expect(code, path).not.toMatch(/location\.(?:hash|href)\s*=|\.pushState|\.replaceState/);
    }
  });

  test('no import of the staff palette, its recents, its search, the team map or any team file', () => {
    for (const path of clientFiles) {
      for (const specifier of importsOf(read(path))) {
        expect(specifier, path).not.toMatch(
          /palette-recents|team-palette|palette-search|palette-status|palette-facts|palette-paths|team-map|team-context|team-nav|\/team-|\/ux\/palette['"]?$|\/palette$/,
        );
        // Only the ranking module of the staff search is shared, and it is pure.
        if (/palette/.test(specifier)) expect(specifier, path).toMatch(/palette-rank$/);
        expect(specifier, path).not.toMatch(/packages\/auth|@corridra\//);
      }
    }
  });

  test('nothing keeps the words: no module-level state in the component', () => {
    const code = stripComments(read(component));
    expect(code).not.toMatch(/^(?:let|var)\s/m);
    expect(code).not.toMatch(/^const\s+\w+\s*=\s*(?:new Map|new Set|\[\]|\{\})/m);
  });

  test('the early Ctrl K module keeps only the opener and a time: no words, no request, no storage, a 5 s hold', () => {
    const path = 'apps/web/lib/ux/customer-search-early-key.ts';
    const code = stripComments(read(path));
    expect(code).not.toMatch(/\bquery\b|\btext\b|\bscope\b|\banswer\b/i);
    expect(code).not.toMatch(
      /\bfetch\b|XMLHttpRequest|sendBeacon|\bstorage\b|sessionStorage|localStorage|indexedDB|document\.cookie/i,
    );
    expect(importsOf(read(path))).toEqual(['./customer-search-status']);
    // The one piece of module state is the opener and the time of the key.
    expect(code.match(/^(?:let|var)\s.*$/gm)).toEqual([
      'let held: { opener: HTMLElement | null; at: number } | null = null;',
    ]);
    expect(code).not.toMatch(/^const\s+\w+\s*=\s*(?:new Map|new Set|\[\]|\{\})/m);
    expect(code).toMatch(/const holdMs = 5000;/);
    // The component imports it and holds no module state of its own for it.
    expect(stripComments(read(component))).toContain("'../../lib/ux/customer-search-early-key'");
  });

  test('the search is a POST of the words in the body: same origin, uncached, no referrer, no address', () => {
    const code = stripComments(read(component));
    expect(code).toContain("fetch('/api/customer-search', {");
    expect(code).toContain("method: 'POST'");
    expect(code).toContain("credentials: 'same-origin'");
    expect(code).toContain("cache: 'no-store'");
    expect(code).toContain("referrerPolicy: 'no-referrer'");
    expect(code).toContain('body: JSON.stringify({ q: text, scope })');
    expect(code).toContain('signal: controller.signal');
    // The sign in address carries the page, never the words.
    expect(code).toContain(
      "'/signin?next=' + encodeURIComponent(window.location.pathname + window.location.search)",
    );
    expect(code).not.toMatch(
      /\/api\/customer-search\?|\/api\/workspace|\/api\/customer-(?:requests|companies)/,
    );
    expect(code).toContain("const openEvent = 'corridra:open-customer-search'");
    expect(code).not.toContain('corridra:open-palette');
  });

  test('the debounce is 350 ms, the key of a search carries the attempt, and a stale answer is dropped', () => {
    const code = stripComments(read(component));
    expect(code).toContain('searchDelay');
    expect(read('apps/web/lib/ux/customer-search-status.ts')).toMatch(/searchDelay = 350\b/);
    expect(code).toContain('`${scope}|${text}|${attempt}`');
    expect(code).toContain('new AbortController()');
    expect(code).toContain('currentOutcome(answer, key)');
    expect(code).toMatch(/if \(controller\.signal\.aborted\) return;\s*setAnswer/);
  });

  test('KI-52: the dialog opens from its own open state and ignores a close event that arrives after a reopen', () => {
    const code = stripComments(read(component));
    expect(code).toMatch(/if \(element\.open\) \{\s*field\.current\?\.focus\(\);\s*return;/);
    expect(code).toMatch(/if \(dialog\.current\?\.open\) return;\s*shut\(\);/);
    expect(code).toContain("document.querySelector('dialog[open]')");
    expect(code).toContain('event.nativeEvent.isComposing');
    expect(code).toContain('event.keyCode !== 229');
  });

  test('cleanup: the session event, pagehide, a persisted pageshow and a hidden page are all handled', () => {
    const code = stripComments(read(component));
    expect(code).toContain("from '../session-events'");
    expect(code).toContain('addEventListener(sessionChanged');
    expect(code).toContain("'pagehide'");
    expect(code).toContain("'pageshow'");
    expect(code).toContain('event.persisted');
    expect(code).toContain("'visibilitychange'");
    expect(code).toContain("document.visibilityState === 'hidden'");
    expect(code).toContain('<SearchDialog key={generation}');
  });

  test('a hit opens by a full page load and a row is a real link', () => {
    const code = stripComments(read(component));
    expect(code).toContain('window.location.assign(row.href)');
    expect(code).toContain('<a {...common} href={row.href}');
    expect(code).not.toMatch(
      /router\.(?:push|replace)|useRouter|dangerouslySetInnerHTML|innerHTML/,
    );
  });
});

describe('the mount', () => {
  const walk = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      if (name === 'node_modules' || name === '.next') return [];
      const path = join(directory, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(?:ts|tsx)$/.test(name) ? [path] : [];
    });
  const sources = ['apps/web/app', 'apps/web/components', 'apps/web/lib'].flatMap(walk);

  test('the button is mounted once, first in the tools row of the customer bar, and nowhere else', () => {
    const users = sources.filter((path) =>
      /\bCustomerSearch\b|ux\/customer-search'|\.\/customer-search'/.test(read(path)),
    );
    expect(users.sort()).toEqual([
      'apps/web/components/ux/customer-header.tsx',
      'apps/web/components/ux/customer-search.tsx',
    ]);
    const header = read('apps/web/components/ux/customer-header.tsx');
    expect(header.match(/<CustomerSearch \/>/g)).toHaveLength(1);
    expect(header).toMatch(
      /<div className="ux-bar-tools">\s*<CustomerSearch \/>\s*<NewRequestLink/,
    );
    // The shared header never names it, so team and contributor markup cannot change.
    const shared = read('apps/web/components/ux/app-header.tsx');
    expect(shared).not.toMatch(/customer-search|CustomerSearch/);
    expect(shared).not.toMatch(/ux-csearch/);
    for (const path of sources.filter((file) => /team-|contributor-/.test(file)))
      expect(read(path), path).not.toMatch(/CustomerSearch|ux-csearch/);
  });

  test('the shell gives the dialog the same two flags that give the tabs their list, computed once', () => {
    const shell = read('apps/web/components/customer-shell.tsx');
    expect(shell.match(/const companies = customerCompaniesEnabled\(\);/g)).toHaveLength(1);
    expect(shell.match(/const homeIsMove = plainNames && move;/g)).toHaveLength(1);
    expect(shell).toContain('customerTabs({ companies, move: homeIsMove })');
    expect(shell).toMatch(/<CustomerBarNote[^>]*companies=\{companies\}[^>]*move=\{homeIsMove\}/s);
    const note = read('apps/web/components/ux/customer-bar-note.tsx');
    expect(note).toContain('companies = false');
    expect(note).toContain('move = false');
    expect(note).toContain('setCustomerCompanies(companies)');
    expect(note).toContain('setCustomerMove(move)');
    const store = read('apps/web/components/ux/customer-bar-store.ts');
    for (const name of ['Companies', 'Move']) {
      expect(store).toContain(`export function setCustomer${name}(`);
      expect(store).toContain(`export function readCustomer${name}()`);
      expect(store).toContain(`export function readServerCustomer${name}()`);
    }
    // The server snapshot is the narrow side.
    expect(store).toMatch(/readServerCustomerCompanies\(\) \{\s*return false;/);
    expect(store).toMatch(/readServerCustomerMove\(\) \{\s*return false;/);
  });
});

describe('the identity the header sends', () => {
  test('the server component loads customerIdentity only dynamically and never throws', () => {
    const source = stripComments(read('apps/web/components/ux/customer-bar-identity.tsx'));
    expect(source).toContain("await import('../../lib/customer-page-session')");
    expect(source).not.toMatch(/^import[^;]*customer-page-session/m);
    expect(source).not.toContain("'use client'");
    expect(source).toMatch(/try \{[\s\S]*await customerIdentity\(\);[\s\S]*\} catch \{/);
    expect(source).toContain(
      '<CustomerBarIdentityNote subject={identity?.subject} issuer={identity?.issuer} />',
    );
  });

  test('the frame mounts it beside the note, always, and carries no server-only import itself', () => {
    const shell = read('apps/web/components/customer-shell.tsx');
    expect(shell).toContain("import { CustomerBarIdentity } from './ux/customer-bar-identity';");
    expect(shell.match(/<CustomerBarIdentity \/>/g)).toHaveLength(1);
    // Inside Suspense, so the frame renders without waiting for the provider read.
    expect(shell).toMatch(/<Suspense fallback=\{null\}>\s*<CustomerBarIdentity \/>\s*<\/Suspense>/);
    expect(shell).not.toMatch(/customer-page-session|server-only/);
  });

  test('the dialog sends the two header names inline from the holder, and the holder is two strings', () => {
    const code = stripComments(read(component));
    expect(code).toContain("'x-corridra-customer-subject': identity.subject");
    expect(code).toContain("'x-corridra-customer-issuer': identity.issuer");
    expect(code).toContain('useFlag(readCustomerIdentity, readServerCustomerIdentity)');
    // The words stay out of the headers: the only header values are the content type and the two identity strings.
    const headers = code.slice(code.indexOf('headers: {'), code.indexOf('body: JSON.stringify'));
    expect(headers).not.toMatch(/\btext\b|\bquery\b/);
    const store = stripComments(read('apps/web/components/ux/customer-bar-store.ts'));
    expect(store).toContain('export type CustomerIdentity = { subject: string; issuer: string };');
    expect(store).toMatch(
      /readServerCustomerIdentity\(\): CustomerIdentity \| null \{\s*return null;/,
    );
    // Cleared when the page goes away and on a change of session.
    const note = stripComments(read('apps/web/components/ux/customer-bar-note.tsx'));
    expect(note).toContain('addEventListener(sessionChanged, clear)');
    expect(note).toMatch(
      /return \(\) => \{\s*window\.removeEventListener\(sessionChanged, clear\);\s*clear\(\);/,
    );
  });

  test('no client file imports a server-only module, the auth package or the page session', () => {
    for (const path of [
      ...clientFiles,
      'apps/web/components/ux/customer-bar-note.tsx',
      'apps/web/components/ux/customer-bar-store.ts',
    ])
      for (const specifier of [...read(path).matchAll(/(?:from|import)\s+'([^']+)'/g)].map(
        (match) => match[1]!,
      ))
        expect(specifier, path).not.toMatch(
          /server-only|packages\/auth|@corridra\/|customer-page-session|neon-auth/,
        );
  });
});

describe('the words on screen', () => {
  const code = stripComments(read(component))
    // Attribute names and roles are not words on screen.
    .replace(/aria-live="polite"/g, '')
    .replace(/^import[\s\S]*?;\n/gm, '');

  test('Title Case buttons, read by the pinned scan', () => {
    expect(titleCaseFindings(component)).toEqual([]);
    expect(titleCaseFindings('apps/web/components/ux/customer-header.tsx')).toEqual([]);
  });

  test('no Mission, no em or en dash, and no word that claims what the search cannot promise', () => {
    expect(code).not.toMatch(/\bmissions?\b/i);
    expect(code).not.toMatch(/[—–]/);
    const claims: [string, RegExp][] = [
      ['verified', /\bverified\b/i],
      ['verify', /\bverify\b/i],
      ['verification', /\bverification\b/i],
      ['enabled', /\benabled\b/i],
      ['live', /\blive\b/i],
      ['total', /\btotal\b/i],
      ['totals', /\btotals\b/i],
      ['evidence', /\bevidence\b/i],
    ];
    for (const [word, pattern] of claims) expect(code, word).not.toMatch(pattern);
    expect(code).not.toMatch(/\bcomplete search\b/i);
    expect(read(stylesheet)).not.toMatch(/[—–]/);
  });

  test('English only: the trigger and the dialog say lang="en", and the words come from the words module', () => {
    expect(code.match(/lang="en"/g)).toHaveLength(2);
    expect(read(component)).toContain('customerSearchWords as words');
    // The fixed strings of the component are the module's, not typed again.
    for (const phrase of [
      'Search Requests, Companies and pages',
      'Search Requests and Companies',
      'Only your own Requests and Companies',
      'Close match',
    ])
      expect(code, phrase).not.toContain(phrase);
  });
});

describe('the bundle', () => {
  test('the browser bundle of the customer search holds no server authority code and no staff palette', async () => {
    const result = await build({
      entryPoints: [resolve(component)],
      bundle: true,
      write: false,
      metafile: true,
      nodePaths: [resolve('apps/web/node_modules')],
      loader: { '.css': 'empty' },
      format: 'esm',
      platform: 'browser',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
      logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((path) => path.includes('customer-search.tsx'))).toBe(true);
    expect(inputs.some((path) => path.includes('customer-search-facts'))).toBe(true);
    for (const forbidden of [
      'packages/auth/src',
      'packages/db',
      'team-palette',
      'palette-recents',
      'palette-search',
      'palette-status',
      'palette-facts',
      'team-map',
      'team-context',
      'ux/palette.ts',
    ])
      expect(
        inputs.filter((path) => path.includes(forbidden)),
        forbidden,
      ).toEqual([]);
    // The only staff-named module it shares is the pure ranking one.
    expect(
      inputs
        .filter((path) => /palette/.test(path))
        .every((path) => path.endsWith('palette-rank.ts')),
    ).toBe(true);
  }, 60000);
});
