import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  localeCodes,
  localeFromTag,
  localeMeta,
  negotiate,
  offeredLanguages,
  type Locale,
} from '../../apps/web/lib/i18n/locales';
import { catalogs, en, translate, type MessageKey } from '../../apps/web/lib/i18n/messages';
import {
  buyerRows,
  faqIds,
  intentKeys,
  offerIds,
  phaseIds,
  questionIds,
  roleIds,
  stageIds,
} from '../../apps/web/lib/home-v43-data';
import { briefGoals } from '../../apps/web/lib/home-routes-data';

// The language chip, its text files and the rules for offering a language. A language reaches the
// public only when its reviewer is recorded; English is always there.
const keys = Object.keys(en) as MessageKey[];
const others = localeCodes.filter((code) => code !== 'en');

describe('message files', () => {
  it.each(localeCodes)('%s has every key English has, and nothing else', (code) => {
    expect(Object.keys(catalogs[code]).sort()).toEqual([...keys].sort());
  });

  it.each(others)('%s has no empty entry and no dash used as punctuation', (code) => {
    for (const key of keys) {
      const text = catalogs[code][key];
      expect(text.trim(), `${code}.${key}`).not.toBe('');
      expect(text, `${code}.${key}`).not.toMatch(/[—–]| - /);
    }
  });

  it.each(others)('%s keeps the brand name as written wherever English has it', (code) => {
    for (const key of keys) {
      if (/corridra/i.test(en[key]))
        expect(catalogs[code][key], `${code}.${key}`).toMatch(/corridra/i);
    }
  });

  it('English has no dashes either, and keeps the exact words the pages and tests use', () => {
    for (const key of keys) expect(en[key]).not.toMatch(/[—–]| - /);
    expect(en['header.howItWorks']).toBe('How It Works');
    expect(en['header.start']).toBe('Start a Request');
    expect(en['header.signIn']).toBe('Sign In');
    expect(en['footer.tagline']).toBe('Make market entry deliberate.');
  });

  it('has translated Ledger footer words in every language, and English keeps its own', () => {
    const footerOnly = [
      'footer.signIn',
      'footer.already',
      'footer.openWorkspace',
      'footer.nav',
      'footer.group.buy',
      'footer.group.sell',
      'footer.group.trips',
      'footer.link.china',
      'footer.link.spain',
      'footer.link.sample',
      'footer.link.network',
      'footer.link.routes',
      'footer.link.howItWorks',
      'footer.link.privacy',
      'footer.link.privacyTest',
      'footer.facts',
      'footer.factsMore',
      'footer.private',
      'footer.routes',
    ] as const satisfies readonly MessageKey[];
    for (const key of footerOnly)
      for (const code of others) expect(catalogs[code][key], `${code}.${key}`).not.toBe(en[key]);
    expect(en['footer.signIn']).toBe('Sign In');
    expect(en['footer.link.privacyTest']).toBe('Test Intake Notice');
  });

  it('has a non-English value for every header menu key and footer key in all six languages', () => {
    const chrome = keys.filter((key) =>
      /^(header\.(whatWeDo|markets|trust|jobs|job\.)|footer\.(signIn|already|openWorkspace|nav|group\.|link\.|facts|factsMore|private|routes))/.test(
        key,
      ),
    );
    expect(chrome.length).toBe(33);
    for (const code of others)
      for (const key of chrome) expect(catalogs[code][key], `${code}.${key}`).not.toBe(en[key]);
  });

  it.each(others)(
    '%s names each header job exactly as its way word, so the two never drift',
    (code) => {
      const pairs = [
        ['header.job.sell', 'way.sell'],
        ['header.job.source', 'way.source'],
        ['header.job.machinery', 'way.machinery'],
        ['header.job.tradeMission', 'way.tradeMissions'],
        ['header.job.businessTrip', 'way.businessTrips'],
        ['header.job.enterMarket', 'way.enterMarket'],
      ] as const satisfies readonly (readonly [MessageKey, MessageKey])[];
      for (const [header, way] of pairs) {
        const word = catalogs[code][header];
        const wayWord = catalogs[code][way];
        // One named exception: the full French word is one character over the header budget (32 for the
        // English "Run a trade mission"), so the header shows its word-boundary prefix; the line below
        // carries "commerciale" as context.
        if (code === 'fr' && header === 'header.job.tradeMission')
          expect(`${wayWord} `.startsWith(`${word} `), `${code}.${header}`).toBe(true);
        else expect(word, `${code}.${header}`).toBe(wayWord);
      }
    },
  );

  it('keeps Arabic header and footer words in Arabic script and the brand name as written', () => {
    for (const key of keys.filter((k) =>
      /^(header\.job|footer\.(group|link\.(china|spain|routes)))/.test(k),
    ))
      expect(catalogs.ar[key], key).toMatch(/[\u0600-\u06FF]/);
    expect(catalogs.ar['footer.link.network']).toContain('Corridra');
  });

  it('falls back to English for an empty entry and never returns an empty string', () => {
    const saved = catalogs.bn['header.howItWorks'];
    catalogs.bn['header.howItWorks'] = '';
    try {
      expect(translate('bn', 'header.howItWorks')).toBe(en['header.howItWorks']);
    } finally {
      catalogs.bn['header.howItWorks'] = saved;
    }
    for (const code of localeCodes)
      for (const key of keys) expect(translate(code, key).length).toBeGreaterThan(0);
  });
});

describe('French and German drafts (Lane 11)', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{[a-z]+\}/g)].map((m) => m[0]).sort();

  it.each(localeCodes)('%s keeps every placeholder of the English text, exactly', (code) => {
    for (const key of keys)
      expect(placeholders(catalogs[code][key]), `${code}.${key}`).toEqual(placeholders(en[key]));
  });

  it.each(['fr', 'de'] as const)(
    '%s is a labelled draft until a reviewer is recorded, and sets its own language tag',
    (code) => {
      expect(offeredLanguages({}).map((item) => item.code)).not.toContain(code);
      expect(
        offeredLanguages({ CORRIDRA_LANGUAGES_PREVIEW: 'true' }).find((item) => item.code === code)
          ?.draft,
      ).toBe(true);
      expect(localeMeta[code]).toMatchObject({ html: code, dir: 'ltr' });
    },
  );

  it.each(['fr', 'de'] as const)(
    '%s keeps the header and button words short enough for a phone',
    (code) => {
      // Longer than English is normal (German and French run 20 to 40 percent longer); a label that
      // runs past 1.7 times the English text or 30 characters is the one that breaks a tab or a button.
      for (const key of keys.filter((k) => /^(header|move\.(card|start|wait\.open))/.test(k)))
        expect(catalogs[code][key].length, `${code}.${key}`).toBeLessThanOrEqual(
          Math.max(30, Math.round(en[key].length * 1.7)),
        );
    },
  );

  it('uses the formal address in French and German where a person is addressed', () => {
    expect(catalogs.fr['header.account']).toBe('Votre compte');
    expect(catalogs.de['header.account']).toBe('Ihr Konto');
    expect(catalogs.fr['room.failed']).toMatch(/Réessayez/);
    expect(catalogs.de['room.failed']).toMatch(/Versuchen Sie/);
    for (const key of keys)
      expect(catalogs.de[key], `de.${key}`).not.toMatch(/\b(du|dein|deine)\b/i);
    for (const key of keys)
      expect(catalogs.fr[key], `fr.${key}`).not.toMatch(/\b(tu|ton|ta|tes)\b/i);
  });

  it('explains the Move in plain words and does not replace it with a loan word', () => {
    // The Move is explained in words, never replaced by a loan word that has another meaning.
    expect(catalogs.fr['mr.move.explainer']).toMatch(/étape/);
    expect(catalogs.de['mr.move.explainer']).toMatch(/Schritt/);
  });
});

describe('which languages are offered', () => {
  const codes = (env: Record<string, string | undefined>) =>
    offeredLanguages(env).map((item) => item.code);

  it('offers English alone until a language is recorded as reviewed', () => {
    expect(codes({})).toEqual(['en']);
    expect(codes({ CORRIDRA_LANGUAGES_REVIEWED: '' })).toEqual(['en']);
    expect(codes({ CORRIDRA_LANGUAGES_PREVIEW: 'yes' })).toEqual(['en']);
  });

  it('offers exactly the reviewed languages, in the fixed order, ignoring anything unknown', () => {
    expect(codes({ CORRIDRA_LANGUAGES_REVIEWED: 'es, BN ,it,xx' })).toEqual(['en', 'bn', 'es']);
    expect(
      offeredLanguages({ CORRIDRA_LANGUAGES_REVIEWED: 'bn' }).every((item) => !item.draft),
    ).toBe(true);
  });

  it('shows every language as a labelled draft only in preview, and keeps reviewed ones unlabelled', () => {
    const offered = offeredLanguages({
      CORRIDRA_LANGUAGES_PREVIEW: 'true',
      CORRIDRA_LANGUAGES_REVIEWED: 'zh',
    });
    expect(offered.map((item) => item.code)).toEqual([...localeCodes]);
    expect(offered.find((item) => item.code === 'zh')?.draft).toBe(false);
    expect(offered.find((item) => item.code === 'en')?.draft).toBe(false);
    expect(offered.filter((item) => item.draft).map((item) => item.code)).toEqual([
      'bn',
      'es',
      'ar',
      'fr',
      'de',
    ]);
  });
});

describe('browser language matching', () => {
  it('maps regional tags and does not claim Traditional Chinese', () => {
    expect(localeFromTag('es-419')).toBe('es');
    expect(localeFromTag('bn-BD')).toBe('bn');
    expect(localeFromTag('zh')).toBe('zh');
    expect(localeFromTag('zh-CN')).toBe('zh');
    expect(localeFromTag('zh-Hans-SG')).toBe('zh');
    expect(localeFromTag('zh-TW')).toBeNull();
    expect(localeFromTag('zh-Hant')).toBeNull();
    expect(localeFromTag('fr-FR')).toBe('fr');
    expect(localeFromTag('fr-CA')).toBe('fr');
    expect(localeFromTag('de-AT')).toBe('de');
    expect(localeFromTag('it-IT')).toBeNull();
    expect(localeFromTag('')).toBeNull();
  });

  it('takes the first preferred language that is offered, and null when none is', () => {
    const offered: Locale[] = ['en', 'es'];
    expect(negotiate(['fr-FR', 'es-MX', 'en'], offered)).toBe('es');
    expect(negotiate(['bn-BD', 'en-GB'], offered)).toBe('en');
    expect(negotiate(['bn-BD', 'zh-CN'], offered)).toBeNull();
    expect(negotiate([], offered)).toBeNull();
  });
});

describe('where the words come from', () => {
  const read = (path: string) => readFileSync(resolve(path), 'utf8');

  it('the header and footer take their words from the message files', () => {
    const header = read('apps/web/components/site-header.tsx');
    const footer = read('apps/web/components/site-footer-view.tsx');
    for (const literal of ['>Sign in<', 'How it works\n', "'Sign out'", "'Close menu'"])
      expect(header, literal).not.toContain(literal);
    expect(footer).not.toContain('WAYS TO WORK');
    // Navigation v1 lists the section links in a table of message keys, each shown with t(key).
    expect(header).toContain("{ href: '/how-it-works', key: 'header.howItWorks' }");
    expect(header).toContain('{t(key)}');
    expect(footer).toContain("t('footer.tagline')");
  });

  it('every message key is used somewhere', () => {
    // Every source file of the web app except the message catalogues themselves (the commercial
    // readiness streams added keys across many components, so a fixed list would miss real uses).
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!['node_modules', '.next', 'i18n'].includes(entry.name)) walk(path);
        } else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
      }
    };
    for (const dir of ['apps/web/app', 'apps/web/components', 'apps/web/lib']) walk(dir);
    const sources = files.map(read).join('\n');
    // The home page v4.3 words are read through `v43('suffix')`, so their whole names never appear in the source; the
    // reverse reader check below covers them.
    for (const key of keys.filter((name) => !name.startsWith('home.v43.')))
      expect(sources, key).toContain(`'${key}'`);
  });

  it('every home.v43 key has a reader: a literal v43(...) read or a declared computed family', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!['node_modules', '.next', 'i18n'].includes(entry.name)) walk(path);
        } else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
      }
    };
    for (const dir of ['apps/web/app', 'apps/web/components', 'apps/web/lib']) walk(dir);
    const sources = files.map(read).join('\n');

    // Every argument of every `v43(` call, balanced over parentheses, then each string or template literal in it.
    const placeholder = /\$\{(?:[^{}]|\{[^{}]*\})*\}/g;
    const literals: string[] = [];
    for (const start of sources.matchAll(/\bv43\(/g)) {
      const from = start.index! + start[0].length;
      let at = from;
      let depth = 1;
      while (at < sources.length && depth > 0) {
        const ch = sources[at]!;
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        else if (ch === "'" || ch === '"') at = sources.indexOf(ch, at + 1);
        else if (ch === '`') {
          // a template: on to its closing backtick, past any ${...} (which may hold a call with parentheses)
          let braces = 0;
          at += 1;
          while (at < sources.length && !(sources[at] === '`' && braces === 0)) {
            if (sources[at] === '$' && sources[at + 1] === '{') braces += 1;
            else if (sources[at] === '}' && braces > 0) braces -= 1;
            at += 1;
          }
        }
        at += 1;
      }
      const arg = sources.slice(from, at - 1);
      const quoted = /'([^']*)'|"([^"]*)"|`((?:[^`$]|\$(?!\{)|\$\{(?:[^{}]|\{[^{}]*\})*\})*)`/g;
      for (const piece of arg.matchAll(quoted))
        literals.push((piece[1] ?? piece[2] ?? piece[3] ?? '').replace(placeholder, '${}'));
    }
    // The other way a key is named: its whole name, as a plain string.
    const whole = [...sources.matchAll(/'home\.v43\.([^']+)'/g)].map((match) => match[1]!);

    // The computed families: a pattern as the source writes it (one `${}` per placeholder) and the values each
    // placeholder takes, from the data tables. A computed read in the source with no family here fails, a family that
    // no computed read matches fails, and a key in no family and no literal read fails by name.
    const some = (values: readonly (string | number)[]) => values.map(String);
    const goals = some(briefGoals);
    const intents = some(intentKeys);
    const stages = some(stageIds);
    const roles = some(roleIds);
    const offers = some(offerIds);
    const buyers = buyerRows.map((row) => String(row.id));
    const views = ['fair', 'short'];
    const solutions = ['source', 'sell', 'delegation'];
    const menuRows = ['source', 'sell', 'delegation', 'inbound'];
    const faqs = some(faqIds);
    const declared: Array<[string, string[][]]> = [
      ['brief.job.${}.label', [goals]],
      ['brief.job.${}.hint', [goals]],
      ['brief.fit.${}', [['selective', 'sourcing', 'sales', 'ask']]],
      ['process.step.${}', [stages]],
      ['process.rec.${}.${}.title', [intents, stages]],
      ['process.rec.${}.${}.line', [intents, stages]],
      ...['name', 'bring', 'get'].map((part): [string, string[][]] => [
        `people.role.\${}.${part}`,
        [roles],
      ]),
      ['door.${}.title', [intents]],
      ['door.${}.line', [intents]],
      ['ex.${}.title', [intents]],
      ['ex.${}.desc', [intents]],
      ['ex.${}.console', [intents]],
      ...['name', 'terms', 'detail'].map((part): [string, string[][]] => [
        `ex.china.offer.\${}.${part}`,
        [offers],
      ]),
      ...['name', 'status', 'line'].map((part): [string, string[][]] => [
        `ex.sell.row.\${}.${part}`,
        [buyers],
      ]),
      ['ex.sell.res.${}.title', [views]],
      ['ex.sell.res.${}.line', [views]],
      ['ex.sell.view.${}', [views]],
      ['ex.${}.group', [['dl', 'other']]],
      ...['label', 'title', 'line'].map((part): [string, string[][]] => [
        `ex.dl.phase.\${}.${part}`,
        [some(phaseIds)],
      ]),
      ...['label', 'title', 'line'].map((part): [string, string[][]] => [
        `ex.other.q.\${}.${part}`,
        [some(questionIds)],
      ]),
      ['sol.${}.text', [solutions]],
      ['sol.${}.get', [solutions]],
      ['sol.${}.go', [solutions]],
      ['mk.dir.${}', [['out', 'in']]],
      ['mk.status.${}', [['selective', 'sourcing', 'sales']]],
      ['mk.detail.${}', [['sell', 'cn', 'region', 'inRegion', 'inOther']]],
      ['faq.${}.q', [faqs]],
      ['faq.${}.a', [faqs]],
      ['trust.line.${}', [['self', 'evidence', 'verified', 'derived', 'outcome']]],
      ['menu.sol.${}.title', [menuRows]],
      ['menu.sol.${}.line', [menuRows]],
    ];
    const expand = (pattern: string, slots: string[][]) => {
      let out = [pattern];
      for (const values of slots)
        out = out.flatMap((text) => values.map((value) => text.replace('${}', value)));
      return out;
    };
    // A read such as `ex.${}.${}.${}.${}` (the two sequence consoles) is one pattern in the source that two of the
    // families above carry the ids for.
    const covers = (read: string, family: string) => {
      const escaped = read
        .split('${}')
        .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
        .join('[^.]+');
      return new RegExp(`^${escaped}$`).test(family.replace(/\$\{\}/g, 'x'));
    };
    const computed = [...new Set(literals.filter((text) => text.includes('${}')))];
    for (const read of computed)
      expect(
        declared.some(([family]) => covers(read, family)),
        `a computed v43 read with no declared family: ${read}`,
      ).toBe(true);
    for (const [family] of declared)
      expect(
        computed.some((read) => covers(read, family)),
        `a declared family that no source reads: ${family}`,
      ).toBe(true);
    const declaredKeys = declared.flatMap(([pattern, slots]) => expand(pattern, slots));
    const named = new Set([
      ...literals.filter((text) => !text.includes('${}')),
      ...whole,
      ...declaredKeys,
    ]);
    const catalogue = new Set(
      keys
        .filter((name) => name.startsWith('home.v43.'))
        .map((name) => name.slice('home.v43.'.length)),
    );
    const dead = [...catalogue].filter((key) => !named.has(key));
    expect(dead.map((key) => `home.v43.${key} has no reader`)).toEqual([]);
    const missing = declaredKeys.filter((key) => !catalogue.has(key));
    expect(missing.map((key) => `home.v43.${key} is read but has no words`)).toEqual([]);
  });

  it('the page is built in English and the language is applied after load', () => {
    expect(read('apps/web/app/layout.tsx')).toContain('<html lang="en"');
    const provider = read('apps/web/components/language-provider.tsx');
    // The first render and the server snapshot are English, so the built page and the first paint match.
    expect(provider).toContain('useSyncExternalStore');
    expect(provider).toMatch(/\(\) => defaultLocale,?\s*\)/);
    expect(provider).toContain('document.documentElement.lang');
    expect(provider).toContain('document.documentElement.dir');
  });
});

// Until a page is on message files its main content is English, so the chosen language must not be put on it, and
// Listen must read it in the language it is actually written in.
describe('main content keeps its own language', () => {
  const root = resolve(__dirname, '../..');
  const mains = [
    'apps/web/components/public-shell.tsx',
    'apps/web/components/workspace-shell.tsx',
    'apps/web/app/mute/[requestId]/page.tsx',
    'apps/web/app/operator/view-as/[role]/page.tsx',
    'apps/web/app/not-found.tsx',
  ];
  it.each(mains)('%s marks its main region lang="en" dir="ltr"', (file) => {
    const text = readFileSync(resolve(root, file), 'utf8');
    const open = text.slice(text.indexOf('<main'), text.indexOf('>', text.indexOf('<main')));
    expect(open).toContain('id="main"');
    expect(open).toContain('lang="en"');
    expect(open).toContain('dir="ltr"');
  });
  it('Listen takes its language from the main region, not the chrome around it', () => {
    // The reading logic lives in the shared Listen store; the dock, the top bar and the menus only call it.
    const store = readFileSync(resolve(root, 'apps/web/lib/ux/listen-store.ts'), 'utf8');
    expect(store).toContain("document.getElementById('main')?.lang");
    expect(store).toContain('utterance.lang = contentLanguage()');
    expect(store).not.toMatch(/utterance\.lang = document\.documentElement\.lang/);
    const dock = readFileSync(resolve(root, 'apps/web/components/corner-dock.tsx'), 'utf8');
    expect(dock).toContain("from '../lib/ux/listen-store'");
    expect(dock).not.toMatch(/utterance\.lang = document\.documentElement\.lang/);
  });
});

describe('the trips choice keeps its own drafted words', () => {
  it.each([
    ['bn', 'ব্যবসায়িক সফর, পরিদর্শন বা মেলা', 'অথবা অন্য কোনো আন্তর্জাতিক ব্যবসার লক্ষ্য।'],
    ['zh', '商务旅行、参观或展会', '或其他国际业务目标。'],
    ['es', 'Viajes, visitas o ferias', 'U otro objetivo de negocio internacional.'],
    ['ar', 'رحلات أو زيارات أو معارض', 'أو هدف آخر للأعمال الدولية.'],
    ['fr', 'Voyages, visites ou salons', 'Ou un autre objectif commercial international.'],
    ['de', 'Reisen, Besuche oder Messen', 'Oder ein anderes internationales Geschäftsziel.'],
  ] as const)('%s shows the new label and hint in that language', (code, label, hint) => {
    expect(catalogs[code]['fq.visits.label']).toBe(label);
    expect(catalogs[code]['fq.visits.hint']).toBe(hint);
    expect(catalogs[code]['fq.visits.label']).not.toBe(en['fq.visits.label']);
    expect(catalogs[code]['fq.visits.hint']).not.toBe(en['fq.visits.hint']);
  });
});
