import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Home page v4.3 (owner, 26 Nov 2026, via the Guardian: "update as per attachment 100% correctly"). CORRIDRA_UX_HOME_V43
// is on only when exactly "true"; it is named and described like every other switch; the page picks the v4.3
// composition first, then v4.2, then the legacy home; and the v4.3 chunk is a lazy import, never a static one. The
// footer, header and browser parity cases arrive with the steps that build them.
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
  pathname = '/';
});

const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

describe('the switch', () => {
  it('is named, described for the owner, and on only when exactly "true"', async () => {
    const { uxSwitchNames, uxSwitchOn } = await load('lib/ux-switches.ts');
    expect(uxSwitchNames).toContain('CORRIDRA_UX_HOME_V43');
    const { switchRegistry } = await load('lib/owner-switches.ts');
    const entry = (switchRegistry as { name: string; line: string; kind: string }[]).find(
      (s) => s.name === 'CORRIDRA_UX_HOME_V43',
    );
    expect(entry?.kind).toBe('flag');
    expect(entry?.line).toContain('Off by default.');
    expect(entry?.line).toContain('removing the setting in Vercel and redeploying');
    expect(uxSwitchOn('CORRIDRA_UX_HOME_V43', { CORRIDRA_UX_HOME_V43: 'true' })).toBe(true);
    for (const value of ['TRUE', 'True', '1', 'yes', '', ' true', undefined])
      expect(uxSwitchOn('CORRIDRA_UX_HOME_V43', { CORRIDRA_UX_HOME_V43: value })).toBe(false);
  });

  it('chooses v4.3 first, then v4.2, then the legacy home, and loads v4.3 only when on', async () => {
    // The page stays a plain function (fixtures render it outside Next.js); only the v4.3 branch loads anything new.
    const { default: Home } = await load('app/page.tsx');
    const { HomeRoutes } = await load('components/home-routes.tsx');
    const { HomeV42Page } = await load('components/home-v42-page.tsx');
    const { HomeV43Page } = await load('components/home-v43-page.tsx');
    const branch = () => {
      const page = Home() as { props: { children: { type: unknown }[] } };
      expect(page).not.toBeInstanceOf(Promise);
      return page.props.children[1]!.type;
    };
    for (const v42 of [undefined, 'true']) {
      for (const v43 of [undefined, 'TRUE', 'True', '1', 'yes', '', ' true', 'false']) {
        vi.stubEnv('CORRIDRA_UX_HOME_V42', v42 as string);
        vi.stubEnv('CORRIDRA_UX_HOME_V43', v43 as string);
        expect(branch(), `${String(v42)} ${String(v43)}`).toBe(
          v42 === 'true' ? HomeV42Page : HomeRoutes,
        );
      }
      vi.stubEnv('CORRIDRA_UX_HOME_V42', v42 as string);
      vi.stubEnv('CORRIDRA_UX_HOME_V43', 'true');
      expect(branch(), `${String(v42)} true`).toBe(HomeV43Page);
    }
    vi.unstubAllEnvs();
    const page = readFileSync(resolve('apps/web/app/page.tsx'), 'utf8');
    expect(page).not.toMatch(/^import .*home-v43'/m);
    expect(page).not.toMatch(/^import .*home-v42'/m);
    expect(page).toContain('<HomeRoutes whatsapp={supportWhatsappHref()} />');
    expect(page.indexOf("uxSwitchOn('CORRIDRA_UX_HOME_V43')")).toBeLessThan(
      page.indexOf("uxSwitchOn('CORRIDRA_UX_HOME_V42')"),
    );
    const server = readFileSync(resolve('apps/web/components/home-v43-page.tsx'), 'utf8');
    // A lazy client chunk: a dynamic import from a server component would not be split (Next.js lazy-loading guide).
    expect(server).toContain("dynamic(() => import('./home-v43')");
    expect(server).not.toMatch(/^import .*'\.\/home-v43'/m);
    // The v4.2 boundary and its footer lines are left as they were.
    const v42 = readFileSync(resolve('apps/web/components/home-v42-page.tsx'), 'utf8');
    expect(v42).toContain("dynamic(() => import('./home-v42')");
    expect(readFileSync(resolve('apps/web/components/site-footer.tsx'), 'utf8')).toContain(
      "homeV42={uxSwitchOn('CORRIDRA_UX_HOME_V42')}",
    );
    expect(readFileSync(resolve('apps/web/components/site-footer-place.tsx'), 'utf8')).toContain(
      'trim={homeV42}',
    );
  });
});

// The header and the footer take the v4.3 props only while the switch is on (the `pocket` pattern: the prop is spread
// only when on, so an off build passes exactly what it passed before).
describe('the header and footer props', () => {
  it('are spread only while the switch is on, and the v4.2 lines are kept as they were', () => {
    const read = (path: string) => readFileSync(resolve(`apps/web/${path}`), 'utf8');
    expect(read('app/layout.tsx')).toContain(
      "{...(uxSwitchOn('CORRIDRA_UX_HOME_V43') ? { homeV43: true } : {})}",
    );
    expect(read('components/ux/shell-header.tsx')).toContain('{...(homeV43 ? { homeV43 } : {})}');
    const site = read('components/site-footer.tsx');
    expect(site).toContain("{...(uxSwitchOn('CORRIDRA_UX_HOME_V43') ? { homeV43: true } : {})}");
    expect(site).toContain("homeV42={uxSwitchOn('CORRIDRA_UX_HOME_V42')}");
    expect(read('components/site-footer-place.tsx')).toContain('trim={homeV42}');
    // The Solutions menu and the pack footer are lazy chunks, never static imports of the shared header and footer.
    expect(read('components/site-header.tsx')).toContain("import('./site-header-solutions')");
    expect(read('components/site-header.tsx')).not.toMatch(/^import .*site-header-solutions/m);
    expect(read('components/site-footer-place.tsx')).toContain("import('./site-footer-pack')");
    expect(read('components/site-footer-place.tsx')).not.toMatch(/^import .*site-footer-pack/m);
  });
});

async function view(path: string, props: Record<string, unknown> = {}) {
  pathname = path;
  const { SiteFooterView } = await load('components/site-footer-view.tsx');
  return renderToStaticMarkup(createElement(SiteFooterView, { realUse: true, ...props }));
}
async function pack(path: string, props: Record<string, unknown> = {}) {
  pathname = path;
  const { SiteFooterPack } = await load('components/site-footer-pack.tsx');
  const { LanguageProvider } = await load('components/language-provider.tsx');
  return renderToStaticMarkup(
    createElement(
      LanguageProvider,
      {
        offered: ['en', 'ar', 'bn'].map((code) => ({ code, draft: false })),
        pageLocales: [],
      },
      createElement(SiteFooterPack, { realUse: true, ...props }),
    ),
  );
}
const hrefs = (html: string) => Array.from(html.matchAll(/href="([^"]+)"/g), (m) => m[1]!);
// The sixteen destinations of the Option B footer; the Bangladesh guide link is the legal row's.
const sixteen = [
  '/source',
  '/machinery',
  '/corridors/bangladesh-china',
  '/corridors#mission-example',
  '/trade-missions',
  '/business-trips',
  '/institutions',
  '/network',
  '/sell',
  '/enter-market',
  '/corridors/bangladesh-eu',
  '/corridors',
  '/how-it-works',
  '/about',
  '/trust',
  '/privacy',
];

describe('the footer', () => {
  it('with no V43 prop is the footer it was; V43 only adds the trimmed class where the footer is kept', async () => {
    for (const path of ['/', '/about', '/plan']) {
      const before = await view(path);
      expect(await view(path, { trimV43: false }), path).toBe(before);
      const trimmed = await view(path, { trim: true });
      expect(await view(path, { trimV43: true }), path).toBe(trimmed);
      expect(await view(path, { trim: true, trimV43: true }), path).toBe(trimmed);
    }
  });

  it.each(['/', '/about', '/trust'])(
    'on %s the pack has the groups and each destination once',
    async (path) => {
      const html = await pack(path);
      expect(html).toContain('guide-footer guide-footer-pack');
      for (const title of ['Solutions', 'Explore', 'Already working with us?'])
        expect(html).toContain(title);
      const list = hrefs(html);
      for (const href of sixteen)
        expect(
          list.filter((h) => h === href),
          href,
        ).toHaveLength(1);
      for (const href of [
        '/#service-source',
        '/#service-sell',
        '/#service-delegation',
        '/#inbound',
        '/#questions',
      ])
        expect(
          list.filter((h) => h === href),
          href,
        ).toHaveLength(1);
      // The guide link is in the legal row, once, not also in the Explore group.
      expect(html.indexOf('/corridors/bangladesh-china')).toBeGreaterThan(
        html.indexOf('gfp-legal'),
      );
      for (const href of ['/account', '/operator', '/contributor', '/workspace'])
        expect(list, href).toContain(href);
      expect(html).toContain('lang-switcher');
      // The Bangla entry is the language switcher's own option; no new Bangla words are written.
      expect(html).toContain('lang="bn"');
      expect(html).toContain('Your work stays private');
    },
  );

  it('shows the three access doors in place of the sign-in rows, and the door for the network', async () => {
    const html = await pack('/', { accessDoors: true });
    const list = hrefs(html);
    // The network link goes to the team door as it does in the shipped footer (owner, 14 Nov 2026), so that door shows twice.
    for (const [href, count] of [
      ['/access/customer', 1],
      ['/access/team', 2],
      ['/access/link', 1],
    ] as const)
      expect(
        list.filter((h) => h === href),
        href,
      ).toHaveLength(count);
    expect(list).not.toContain('/network');
    expect(list).not.toContain('/operator');
  });

  it('offers a signed-in person the workspace and never a sign-in row', async () => {
    who = 'customer';
    const customer = await pack('/', { accessDoors: true });
    expect(hrefs(customer)).toContain('/account');
    expect(customer).not.toContain('/access/customer');
    expect(customer).not.toContain('Sign-In');
    who = 'staff';
    expect(hrefs(await pack('/'))).toContain('/operator');
  });

  it('uses the test notice words while real use is off', async () => {
    expect(await pack('/', { realUse: false })).toContain('Test Intake Notice');
    expect(await pack('/')).toContain('Privacy Notice');
  });

  it('names the place through a mark, never a bare name', async () => {
    const html = await pack('/');
    expect(html).toMatch(/ux-flagged[^>]*>.*Bangladesh/s);
    expect(html).not.toMatch(/Bangladesh Guide/);
  });
});
