import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formEn } from '../../apps/web/lib/i18n/form-words/en';
import { languageWords, type OtherLocale } from '../../apps/web/lib/i18n/lang';
import { localeCodes } from '../../apps/web/lib/i18n/locales';
import { catalogs, en } from '../../apps/web/lib/i18n/messages';

// The language base (commercial-ready run, unit L0; owner, 23 November 2026: "Finish all six, keep live", and a
// translated page carries no note at all). Three things are held here for the six language units that follow:
// 1. English is frozen. tests/language-english-freeze.json records every English key with a short hash of its
//    words. A changed, added or removed English line fails here by name, so the six languages never drift from
//    it unseen. After a deliberate English change: LANGUAGE_FREEZE_WRITE=1 pnpm vitest run
//    tests/integration/language-base.test.ts, and say in the PR which keys moved, so each language follows.
// 2. One words file per language (apps/web/lib/i18n/lang/<code>.ts), holding only that language's own words.
// 3. Key parity. `untranslated` is the number of English keys each language has no words for yet. It may only
//    fall: the language's unit lowers its number as it adds words and reaches zero when every key is translated.
const others = localeCodes.filter((code) => code !== 'en') as OtherLocale[];
const keys = Object.keys(en) as (keyof typeof en)[];
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const short = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 10);

const freezePath = resolve('tests/language-english-freeze.json');
const now = {
  messages: Object.fromEntries(
    [...keys].sort().map((key) => [key, short(en[key])] as [string, string]),
  ),
  form: Object.fromEntries(
    (Object.keys(formEn) as (keyof typeof formEn)[])
      .sort()
      .map((key) => [key, short(formEn[key])] as [string, string]),
  ),
};
if (process.env.LANGUAGE_FREEZE_WRITE === '1')
  writeFileSync(freezePath, `${JSON.stringify(now, null, 2)}\n`);

/** English keys each language has no words of its own for yet. Only its own language unit lowers a number. */
const untranslated: Record<OtherLocale, number> = {
  bn: 903, // L1
  zh: 903, // L2
  es: 908, // L3
  ar: 923, // L4
  fr: 929, // L5
  de: 925, // L6
};

describe('English is frozen', () => {
  const frozen = existsSync(freezePath)
    ? (JSON.parse(read('tests/language-english-freeze.json')) as typeof now)
    : { messages: {}, form: {} };

  it.each(['messages', 'form'] as const)('%s: no English line changed, came or went', (part) => {
    const was = frozen[part];
    const is = now[part];
    const changed = Object.keys(is).filter((key) => key in was && was[key] !== is[key]);
    const added = Object.keys(is).filter((key) => !(key in was));
    const removed = Object.keys(was).filter((key) => !(key in is));
    expect({ changed, added, removed }).toEqual({ changed: [], added: [], removed: [] });
  });
});

describe('one words file per language', () => {
  it('has exactly the six language files beside their index, and no language words anywhere else', () => {
    expect(readdirSync(resolve('apps/web/lib/i18n/lang')).sort()).toEqual(
      [...others.map((code) => `${code}.ts`), 'index.ts'].sort(),
    );
    // The English files hold no block of another language any more.
    for (const file of [
      'messages.ts',
      'home-words.ts',
      'top-bar-words.ts',
      'privacy-words.ts',
      'consequence-words.ts',
      'ws/ws-a.ts',
      'ws/ws-b.ts',
      'ws/ws-c.ts',
      'ws/ws-d.ts',
      'ws/ws-e.ts',
    ])
      expect(read(`apps/web/lib/i18n/${file}`), file).not.toMatch(
        /[ঀ-৿؀-ۿ一-鿿]|^\s+(bn|zh|es|ar|fr|de): \{$/m,
      );
    expect(existsSync(resolve('apps/web/lib/i18n/header-footer-words.ts'))).toBe(false);
  });

  it.each(others)(
    '%s holds only English keys, no empty entry and no copy of the English words',
    (code) => {
      const words = languageWords[code] as Record<string, string>;
      for (const [key, text] of Object.entries(words)) {
        expect(keys as string[], `${code}.${key}`).toContain(key);
        expect(text.trim(), `${code}.${key}`).not.toBe('');
        // A line that only repeats English is not a translation: it is left out, and English is shown.
        expect(text, `${code}.${key}`).not.toBe(en[key as keyof typeof en]);
      }
    },
  );

  it.each(others)('%s: the catalogue is English with the language laid over it', (code) => {
    const words = languageWords[code] as Record<string, string | undefined>;
    for (const key of keys)
      expect(catalogs[code][key], `${code}.${key}`).toBe(words[key] ?? en[key]);
  });

  it.each(others)('%s: the number of keys still shown in English only falls', (code) => {
    const missing = keys.filter((key) => !Object.hasOwn(languageWords[code], key)).length;
    expect(
      missing,
      `${code} has ${missing} keys without its own words; lower its number in this test`,
    ).toBe(untranslated[code]);
  });
});

describe('a translated page carries no note', () => {
  it('has no draft or review word in any catalogue key, and the screens draw none', () => {
    expect(keys.filter((key) => /draft|review pending/i.test(en[key]))).toEqual([]);
    expect(keys).not.toContain('language.draft');
    expect(keys).not.toContain('home.b3.draft');
    for (const file of [
      'apps/web/components/ux/language-sheet.tsx',
      'apps/web/components/language-switcher.tsx',
      'apps/web/components/home-routes.tsx',
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/draft translation|Native review pending|\.draft\b/i);
      expect(source, file).not.toMatch(/draft\s*&&|draft\s*\?/);
    }
  });
});
