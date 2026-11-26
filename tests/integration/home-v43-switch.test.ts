import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Home page v4.3 (owner, 26 Nov 2026, via the Guardian: "update as per attachment 100% correctly"). CORRIDRA_UX_HOME_V43
// is on only when exactly "true"; it is named and described like every other switch; the page picks the v4.3
// composition first, then v4.2, then the legacy home; and the v4.3 chunk is a lazy import, never a static one. The
// footer, header and browser parity cases arrive with the steps that build them.
const web = createRequire(resolve('apps/web/package.json'));
vi.doMock(web.resolve('next/navigation'), () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(() => {
  vi.resetModules();
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
