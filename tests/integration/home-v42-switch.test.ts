import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Home page v4.2 (owner, 25 Nov 2026: "Add a switch, off by default"; "current footer without redundancy", footer
// "Trim as shown"). CORRIDRA_UX_HOME_V42 is on only when exactly "true"; it is named and described like every other
// switch; the page picks the v4.2 composition only then; and the footer drops exactly the four repeated items (the
// headline, the second Start a Request, the trust labels with How We Label Facts, the routes line) and keeps the rest.
// With the switch off the footer markup is the one it was (the browser check tests/ux/home-v42-off.spec.ts compares
// the whole home page with a copy captured from main).
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
let pathname = '/';
let who: null | 'customer' | 'staff' = null;
vi.doMock(web.resolve('next/navigation'), () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.doMock('../../apps/web/components/use-signed-in', async (original) => ({
  ...(await original<object>()),
  useSignedInSeen: () => who,
  useSignedInSettled: () => true,
}));
afterEach(() => {
  vi.resetModules();
  who = null;
});

const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
async function footer(path: string, props: Record<string, unknown>) {
  pathname = path;
  const { SiteFooterView } = await load('components/site-footer-view.tsx');
  return renderToStaticMarkup(createElement(SiteFooterView, { realUse: true, ...props }));
}

describe('the switch', () => {
  it('is named, described for the owner, and on only when exactly "true"', async () => {
    const { uxSwitchNames, uxSwitchOn } = await load('lib/ux-switches.ts');
    expect(uxSwitchNames).toContain('CORRIDRA_UX_HOME_V42');
    const { switchRegistry } = await load('lib/owner-switches.ts');
    const entry = (switchRegistry as { name: string; line: string; kind: string }[]).find(
      (s) => s.name === 'CORRIDRA_UX_HOME_V42',
    );
    expect(entry?.kind).toBe('flag');
    expect(entry?.line).toContain('Off by default.');
    expect(uxSwitchOn('CORRIDRA_UX_HOME_V42', { CORRIDRA_UX_HOME_V42: 'true' })).toBe(true);
    for (const value of ['TRUE', 'True', '1', 'yes', '', ' true', undefined])
      expect(uxSwitchOn('CORRIDRA_UX_HOME_V42', { CORRIDRA_UX_HOME_V42: value })).toBe(false);
  });

  it('chooses the v4.2 home only while it is on, and loads it only then', async () => {
    // The page stays a plain function (fixtures render it outside Next.js); only the v4.2 branch loads anything new.
    const { default: Home } = await load('app/page.tsx');
    const { HomeRoutes } = await load('components/home-routes.tsx');
    const { HomeV42Page } = await load('components/home-v42-page.tsx');
    const branch = () => {
      const page = Home() as { props: { children: { type: unknown }[] } };
      expect(page).not.toBeInstanceOf(Promise);
      return page.props.children[1]!.type;
    };
    for (const value of [undefined, 'TRUE', '1', 'false']) {
      vi.stubEnv('CORRIDRA_UX_HOME_V42', value as string);
      expect(branch(), String(value)).toBe(HomeRoutes);
    }
    vi.stubEnv('CORRIDRA_UX_HOME_V42', 'true');
    expect(branch()).toBe(HomeV42Page);
    vi.unstubAllEnvs();
    const page = readFileSync(resolve('apps/web/app/page.tsx'), 'utf8');
    expect(page).not.toMatch(/^import .*home-v42'/m);
    expect(page).toContain('<HomeRoutes whatsapp={supportWhatsappHref()} />');
    const server = readFileSync(resolve('apps/web/components/home-v42-page.tsx'), 'utf8');
    expect(server).toContain("await import('./home-v42')");
    expect(server).not.toContain("'use client'");
    expect(readFileSync(resolve('apps/web/components/site-footer.tsx'), 'utf8')).toContain(
      "homeV42={uxSwitchOn('CORRIDRA_UX_HOME_V42')}",
    );
    expect(readFileSync(resolve('apps/web/components/site-footer-place.tsx'), 'utf8')).toContain(
      'trim={homeV42}',
    );
  });
});

const removed = [
  'guide-footer-promise',
  'guide-footer-trust',
  'guide-footer-legend',
  'guide-footer-routes',
  'How We Label Facts',
];

describe('the trimmed footer', () => {
  it.each(['/', '/about', '/plan'])('on %s: trim left out is the footer it was', async (path) => {
    const before = await footer(path, {});
    expect(await footer(path, { trim: false })).toBe(before);
    expect(before).toContain('guide-footer-promise');
    expect(before).toContain('guide-footer-routes');
    expect(before).toContain('How We Label Facts');
  });

  it.each(['/', '/about', '/plan'])(
    'on %s, signed out: the four repeated items go and the rest stays',
    async (path) => {
      const html = await footer(path, { trim: true });
      for (const item of removed) expect(html).not.toContain(item);
      expect(html).not.toContain('<details class="guide-footer-trust');
      // No Start a Request in the footer any more (the page and header keep theirs).
      expect(html).not.toMatch(/class="primary-link"[^>]*href="\/plan"/);
      expect(html).toContain('guide-footer-trim');
      expect(html).toContain('guide-footer-wordmark');
      expect(html).toContain('href="/signin"');
      expect(html).toContain('href="/workspace"');
      for (const href of [
        '/source',
        '/trade-missions',
        '/sell',
        '/how-it-works',
        '/about',
        '/trust',
        '/privacy',
      ])
        expect(html).toContain(`href="${href}"`);
      expect(html).toContain('guide-footer-private');
      expect(html).toContain('© 2026 Corridra');
      // The language switcher stays: it renders only where languages are on, and the trim never touches it.
      expect(readFileSync(resolve('apps/web/components/site-footer-view.tsx'), 'utf8')).toMatch(
        /<span className="guide-footer-private">.*\n.*\n\s*<LanguageSwitcher \/>/,
      );
    },
  );

  it('signed in: the workspace button and never sign-in', async () => {
    who = 'customer';
    const html = await footer('/about', { trim: true });
    expect(html).toContain('href="/account"');
    expect(html).not.toContain('href="/signin"');
    expect(html).not.toContain('guide-footer-promise');
  });

  it('with the access doors: the doors row stays and no empty actions block is left', async () => {
    const html = await footer('/about', { trim: true, accessDoors: true });
    expect(html).toContain('guide-footer-access');
    expect(html).not.toContain('guide-footer-actions');
    expect(html).not.toContain('guide-footer-promise');
  });
});
