import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localeCodes, defaultLocale } from '../../apps/web/lib/i18n/locales';
import {
  isPageKey,
  languagePagesEnabled,
  languagesWithPages,
  localeFor,
  pageKeyPrefixes,
} from '../../apps/web/lib/i18n/pages';
import { catalogs, en, translate } from '../../apps/web/lib/i18n/messages';
import { homeEn, homeWords } from '../../apps/web/lib/i18n/home-words';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// Page words (owner decision of 25 October 2026): pages follow the chosen language behind
// CORRIDRA_LANGUAGES_PAGES. Until the owner records a review of the words and turns the switch on, every page key
// shows its English words in every language, so releasing a language never releases words nobody has reviewed.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const others = localeCodes.filter((code) => code !== defaultLocale);

describe('the page switch', () => {
  it('releases every language for exactly true, only the listed languages for a list, and none for anything else', () => {
    const env = (value?: string) =>
      (value === undefined ? {} : { CORRIDRA_LANGUAGES_PAGES: value }) as NodeJS.ProcessEnv;
    expect(languagesWithPages(env())).toEqual([]);
    for (const value of ['', 'false', 'yes', '1', 'nonsense', 'xx', 'en'])
      expect(languagesWithPages(env(value)), value).toEqual([]);
    expect(languagesWithPages(env('true'))).toEqual(others);
    expect(languagesWithPages(env(' TRUE '))).toEqual(others);
    expect(languagesWithPages(env('es,de'))).toEqual(['es', 'de']);
    expect(languagesWithPages(env(' DE , es,es,en,xx '))).toEqual(['de', 'es']);
    expect(languagePagesEnabled(env())).toBe(false);
    expect(languagePagesEnabled(env('de'))).toBe(true);
  });

  it('keeps page keys in English while it is off, and every other key in the chosen language', () => {
    for (const locale of others) {
      expect(localeFor(locale, 'home.title', false)).toBe(defaultLocale);
      expect(localeFor(locale, 'home.title', true)).toBe(locale);
      expect(localeFor(locale, 'header.menu', false)).toBe(locale);
      expect(localeFor(locale, 'header.menu', true)).toBe(locale);
    }
    expect(localeFor('en', 'home.title', false)).toBe('en');
  });

  it('is in the owner registry as a flag, and the provider and layout use it', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_LANGUAGES_PAGES')?.kind).toBe('flag');
    expect(read('apps/web/components/language-provider.tsx')).toContain(
      'translate(localeFor(locale, key, pages), key)',
    );
    expect(read('apps/web/app/layout.tsx')).toContain('pageLocales={languagesWithPages()}');
    expect(read('apps/web/components/language-provider.tsx')).toContain(
      'const pages = pageLocales.includes(locale);',
    );
  });
});

describe('the home page words', () => {
  const homeKeys = Object.keys(homeEn);

  it('are page keys, and every page key belongs to a listed prefix', () => {
    expect(pageKeyPrefixes).toContain('home.');
    for (const key of homeKeys) expect(isPageKey(key), key).toBe(true);
    for (const key of Object.keys(en))
      if (isPageKey(key)) expect(key.startsWith('home.')).toBe(true);
  });

  it('have the same keys in all six languages, with the same placeholders, and none empty', () => {
    for (const code of others) {
      expect(Object.keys(homeWords[code as keyof typeof homeWords]).sort(), code).toEqual(
        [...homeKeys].sort(),
      );
      for (const key of homeKeys) {
        const words = translate(code, key as keyof typeof en);
        expect(words.trim().length, `${code} ${key}`).toBeGreaterThan(0);
        expect(words.match(/\{\w+\}/g) ?? [], `${code} ${key}`).toEqual(
          homeEn[key as keyof typeof homeEn].match(/\{\w+\}/g) ?? [],
        );
      }
    }
  });

  it('keep the five trust names, company letters, amounts and delivery codes out of the catalog', () => {
    const catalogText = Object.values(homeEn).join('\n');
    for (const name of [
      'Self-declared',
      'Evidence available',
      'Verified',
      'Derived',
      'Outcome observed',
    ])
      expect(catalogText).not.toContain(name);
    for (const code of ['USD 42,000', 'FOB Ningbo', 'CIF Chattogram'])
      expect(catalogText).not.toContain(code);
  });

  it('are not written into the page as literal English any more', () => {
    // Comments may quote the words; only the code counts.
    const source =
      `${read('apps/web/app/page.tsx')}\n${read('apps/web/components/home-example-record.tsx')}`
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    for (const [key, words] of Object.entries(homeEn))
      if (words.length > 14) expect(source, key).not.toContain(words);
  });

  it('use only home keys, so that with the page switch off no word of the page changes language', () => {
    for (const file of ['apps/web/app/page.tsx', 'apps/web/components/home-example-record.tsx']) {
      const keys = [...read(file).matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]);
      expect(keys.length, file).toBeGreaterThan(0);
      for (const key of keys) expect(key.startsWith('home.'), `${file} ${key}`).toBe(true);
      // Keys held in lists and tables count as well: no other message key may be named in these files.
      const source = read(file);
      for (const key of Object.keys(en))
        if (!key.startsWith('home.')) expect(source, `${file} ${key}`).not.toContain(`'${key}'`);
    }
  });

  it('cannot be reached by calling translate directly, which would ignore the switch', () => {
    const walk = (dir: string): string[] =>
      readdirSync(resolve(dir), { withFileTypes: true }).flatMap((entry) =>
        entry.name === 'node_modules' || entry.name === '.next'
          ? []
          : entry.isDirectory()
            ? walk(`${dir}/${entry.name}`)
            : /\.(ts|tsx)$/.test(entry.name)
              ? [`${dir}/${entry.name}`]
              : [],
      );
    for (const file of ['apps/web/app', 'apps/web/components', 'apps/web/lib'].flatMap(walk)) {
      if (file.endsWith('lib/i18n/messages.ts')) continue;
      expect(read(file), file).not.toMatch(/\btranslate\([^)]*['"]home\./);
    }
  });

  it('make the page follow the language only through the translated main region', () => {
    const page = read('apps/web/app/page.tsx');
    expect(page).toContain('<PublicShell className="ux-guide-home ac1-home" translated>');
    const shell = read('apps/web/components/public-shell.tsx');
    // Every other public page is still written in English and says so.
    expect(shell).toContain('lang="en" dir="ltr"');
    const main = read('apps/web/components/translated-main.tsx');
    expect(main).toContain('const meta = pages ? localeMeta[locale] : localeMeta.en;');
  });

  it('are listed in the language review record as drafted, with the review not yet recorded', () => {
    const record = read('docs/product/language-review-record.md');
    expect(record).toContain('Home page words (all six languages)');
    expect(record).toContain('review NOT yet recorded');
    expect(record).toContain('CORRIDRA_LANGUAGES_PAGES=true');
  });

  it('the catalog of each language still holds every English key', () => {
    for (const code of others)
      expect(Object.keys(catalogs[code as keyof typeof catalogs]).sort()).toEqual(
        Object.keys(en).sort(),
      );
  });
});
