import { readFileSync } from 'node:fs';
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
    expect(en['header.howItWorks']).toBe('How it works');
    expect(en['header.start']).toBe('Start a request');
    expect(en['header.signIn']).toBe('Sign in');
    expect(en['footer.tagline']).toBe('Make market entry deliberate.');
  });

  it('falls back to English for an empty entry and never returns an empty string', () => {
    const saved = catalogs.bn['header.routes'];
    catalogs.bn['header.routes'] = '';
    try {
      expect(translate('bn', 'header.routes')).toBe(en['header.routes']);
    } finally {
      catalogs.bn['header.routes'] = saved;
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
    expect(header).toContain("t('header.howItWorks')");
    expect(footer).toContain("t('footer.tagline')");
  });

  it('every message key is used somewhere', () => {
    const sources = [
      'apps/web/components/site-header.tsx',
      'apps/web/components/site-footer-view.tsx',
      'apps/web/components/skip-link.tsx',
      'apps/web/components/language-switcher.tsx',
      'apps/web/components/ways-to-work.ts',
      'apps/web/components/mr/labels.ts',
      'apps/web/app/account/move/move-view.tsx',
      'apps/web/app/account/rooms/[requestId]/room-view.tsx',
      'apps/web/components/compare-lens.tsx',
      'apps/web/components/mr/first-question.tsx',
      'apps/web/app/plan/intake.tsx',
      'apps/web/app/page.tsx',
      'apps/web/components/home-example-record.tsx',
    ]
      .map(read)
      .join('\n');
    for (const key of keys) expect(sources, key).toContain(`'${key}'`);
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
    const text = readFileSync(resolve(root, 'apps/web/components/corner-dock.tsx'), 'utf8');
    expect(text).toContain("document.getElementById('main')?.lang");
    expect(text).not.toMatch(/utterance\.lang = document\.documentElement\.lang/);
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
