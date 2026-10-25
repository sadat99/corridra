import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  localeCodes,
  localeFromTag,
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

describe('which languages are offered', () => {
  const codes = (env: Record<string, string | undefined>) =>
    offeredLanguages(env).map((item) => item.code);

  it('offers English alone until a language is recorded as reviewed', () => {
    expect(codes({})).toEqual(['en']);
    expect(codes({ CORRIDRA_LANGUAGES_REVIEWED: '' })).toEqual(['en']);
    expect(codes({ CORRIDRA_LANGUAGES_PREVIEW: 'yes' })).toEqual(['en']);
  });

  it('offers exactly the reviewed languages, in the fixed order, ignoring anything unknown', () => {
    expect(codes({ CORRIDRA_LANGUAGES_REVIEWED: 'es, BN ,fr,xx' })).toEqual(['en', 'bn', 'es']);
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
    expect(localeFromTag('fr-FR')).toBeNull();
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
