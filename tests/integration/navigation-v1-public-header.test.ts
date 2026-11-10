import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { catalogs, en, type MessageKey } from '../../apps/web/lib/i18n/messages';
import { localeCodes } from '../../apps/web/lib/i18n/locales';

// Navigation v1, order 2a (docs/revamp/specs/navigation-v1.md): the public header as built on the server, before any
// session or language is known. Case ids follow the spec's binding conditions (N1 nothing lost, N2 five at most, N3
// honest, N5 words). The browser cases are in tests/browser/public-header-nav.spec.ts.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: unknown; href: string }) =>
    createElement('a', { href, ...rest }, children as never),
}));
vi.doMock(web.resolve('next/navigation'), () => ({
  useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }),
  usePathname: () => '/how-it-works',
}));
const header = async () => {
  const path = 'components/site-header';
  const { SiteHeader } = await import(/* @vite-ignore */ `../../apps/web/${path}`);
  return renderToStaticMarkup(createElement(SiteHeader, { accounts: false }));
};
const read = (path: string) => readFileSync(resolve(path), 'utf8');

// The new header words, written exactly as the boards write them.
const boardWords: Partial<Record<MessageKey, string>> = {
  'header.whatWeDo': 'What we do',
  'header.markets': 'Markets',
  'header.trust': 'Trust',
  'header.jobs': 'What do you need to do?',
  'header.job.sell': 'Sell in a new market',
  'header.job.source': 'Source products and suppliers',
  'header.job.machinery': 'Procure machinery',
  'header.job.tradeMission': 'Run a trade mission',
  'header.job.businessTrip': 'Plan a business trip',
  'header.job.enterMarket': 'Enter a new market',
  'header.menu': 'Menu',
  'header.menuClose': 'Close',
  'header.howItWorks': 'How it works',
  'header.signIn': 'Sign in',
  'header.start': 'Start a Request',
};

describe('the public header on the server (navigation v1)', () => {
  it('N1 keeps every old destination, id and hook, and adds the six jobs and Trust', async () => {
    const html = await header();
    for (const href of ['/', '/how-it-works', '/corridors', '/signin', '/plan'])
      expect(html, href).toContain(`href="${href}"`);
    for (const href of [
      '/sell',
      '/source',
      '/machinery',
      '/trade-missions',
      '/business-trips',
      '/enter-market',
      '/trust',
    ])
      expect(html, href).toContain(`href="${href}"`);
    expect(html).toContain('id="public-navigation"');
    expect(html).toContain('aria-controls="public-navigation"');
    expect(html).toContain('class="menu-toggle"');
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain('class="primary-link nav-cta"');
    // The help dock stays in the header for phones.
    expect(html).toContain('header-help');
    // Every job page the header links to exists.
    for (const page of ['sell', 'source', 'machinery', 'trade-missions', 'business-trips'])
      expect(existsSync(resolve(`apps/web/app/${page}/page.tsx`)), page).toBe(true);
    expect(existsSync(resolve('apps/web/app/enter-market/page.tsx'))).toBe(true);
  });

  it('N2 the top level holds four links and the actions row stays within five', async () => {
    const html = await header();
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    expect(nav.match(/class="public-nav-(what|link)"/g)).toHaveLength(4);
    const actions = nav.slice(nav.indexOf('public-nav-actions'));
    expect((actions.match(/<(a|button|details) /g) ?? []).length).toBeLessThanOrEqual(5);
  });

  it('N3 shows no WhatsApp, Data saver or Español control and no dead link', async () => {
    const html = await header();
    for (const word of ['WhatsApp', 'Data saver', 'Español', 'Listen', 'href="#"'])
      expect(html, word).not.toContain(word);
  });

  it('N5 the menu words are the boards words, English in every catalog, with no em dash', () => {
    for (const [key, words] of Object.entries(boardWords)) {
      expect(en[key as MessageKey], key).toBe(words);
      expect(words).not.toContain('—');
    }
    // New words have no translation yet: every catalog carries the English words and claims nothing.
    const added = Object.keys(en).filter(
      (key) =>
        key.startsWith('header.job') ||
        ['header.whatWeDo', 'header.markets', 'header.trust', 'header.jobs'].includes(key),
    ) as MessageKey[];
    expect(added.length).toBe(14);
    for (const code of localeCodes)
      for (const key of added) expect(catalogs[code][key], `${code}.${key}`).toBe(en[key]);
    // The board's word replaced Routes; the old key is gone, so no unused word is left behind.
    expect(Object.keys(en)).not.toContain('header.routes');
  });

  it('N6 marks the current page and writes no text-transform in the header styles', async () => {
    const html = await header();
    expect(html).toMatch(/aria-current="page" href="\/how-it-works"/);
    expect(read('apps/web/components/site-header.css')).not.toMatch(/text-transform/);
  });

  it('keeps the logo lines and the session and language code it consumes unchanged', () => {
    const source = read('apps/web/components/site-header.tsx');
    expect(source).toContain("import { WORDMARK } from './brand-paths';");
    expect(source).toContain('export function BrandLockup()');
    expect(source).toContain('useSignedIn(accounts)');
    expect(source).toContain('useSignOut()');
    expect(source).toContain('<LanguageSwitcher />');
    expect(source).toContain('<CornerDock variant="header" />');
  });
});
