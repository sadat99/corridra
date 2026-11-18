import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { offeredLanguages } from '../../apps/web/lib/i18n/locales';

// RM1 B: the signed-in headers offer Spanish by the same rule as the public header. One list, offeredLanguages(),
// feeds the one LanguageProvider in the root layout; every header reads it with useLanguage(). Spanish appears when
// the owner adds es to CORRIDRA_LANGUAGES_REVIEWED, and never before.
const read = (path: string) => readFileSync(path, 'utf8');

describe('Spanish in the headers', () => {
  it('is offered once es is reviewed, as itself, and not before', () => {
    expect(offeredLanguages({}).map((item) => item.code)).toEqual(['en']);
    const reviewed = offeredLanguages({ CORRIDRA_LANGUAGES_REVIEWED: 'es' });
    expect(reviewed).toEqual([
      { code: 'en', draft: false },
      { code: 'es', draft: false },
    ]);
  });

  it('is read by the public header and both signed-in headers from the same provider list', () => {
    const layout = read('apps/web/app/layout.tsx');
    expect(layout).toContain('const offered = offeredLanguages();');
    expect(layout).toContain('<LanguageProvider offered={offered}');
    for (const file of [
      'apps/web/components/language-switcher.tsx',
      'apps/web/components/ux/language-sheet.tsx',
      'apps/web/components/ux/utility-menus.tsx',
    ])
      expect(read(file), file).toContain('useLanguage()');
    expect(read('apps/web/components/site-header.tsx')).toContain('<TopBarTools />');
    expect(read('apps/web/components/ux/top-bar.tsx')).toContain('<LanguageButton');
    const app = read('apps/web/components/ux/app-header.tsx');
    expect(app).toContain('<LanguageMenu />');
    expect(app).toContain('<LanguageSwitcher />');
  });
});
