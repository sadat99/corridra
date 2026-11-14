import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Access doors, Unit A. The one registry (apps/web/lib/access-doors.ts) is the only source of the three doors,
// their roles, their pages' words and the help-link lists, and every address in it is a real page.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (t: unknown, p?: unknown, ...c: unknown[]) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const appDir = resolve('apps/web/app');
function pagePatterns(directory: string): RegExp[] {
  const out: RegExp[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry === 'page.tsx') {
        const segments = relative(appDir, dir)
          .split('\\')
          .join('/')
          .split('/')
          .filter((s) => s && !(s.startsWith('(') && s.endsWith(')')));
        const body = segments
          .map((s) => (/^\[\[?\.\.\./.test(s) ? '.+' : /^\[.+\]$/.test(s) ? '[^/]+' : s))
          .join('/');
        out.push(new RegExp(`^/${body}$`));
      }
    }
  };
  walk(directory);
  return out;
}
const routes = pagePatterns(appDir);
const resolves = (href: string) => {
  const path = href.split('#')[0]!.split('?')[0]!;
  return routes.some((pattern) => pattern.test(path === '' ? '/' : path));
};
const hrefsIn = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(hrefsIn);
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, v]) =>
      key === 'href' && typeof v === 'string' ? [v] : hrefsIn(v),
    );
  return [];
};

describe('the access door registry', () => {
  it('maps every role to exactly one door and keeps ids unique', async () => {
    const reg = await load('lib/access-doors.ts');
    const ids = reg.accessDoors.map((d: { id: string }) => d.id);
    expect(ids).toEqual(['customer', 'team', 'link']);
    expect(new Set(ids).size).toBe(ids.length);
    const roles = reg.accessDoors.flatMap((d: { roles: { id: string }[] }) =>
      d.roles.map((r) => r.id),
    );
    expect(roles.sort()).toEqual(
      [
        'owner',
        'teammate',
        'organiser',
        'participant',
        'operator',
        'reviewer',
        'viewer',
        'admin',
        'founder',
        'helper',
        'buyer',
        'supplier',
        'client',
        'institution',
      ].sort(),
    );
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('points every address at a page that exists', async () => {
    const reg = await load('lib/access-doors.ts');
    const everything = [
      reg.accessDoors,
      reg.customerDoorPage,
      reg.teamDoorPage,
      reg.linkDoorPage,
      reg.accessHelp.customerOtherRoutes,
      reg.accessHelp.signInFallback,
      reg.accessHelp.operatorSetup('/operator/signin'),
      reg.accessHelp.operatorForgotPassword('/operator/signin'),
      reg.accessHelp.operatorSignIn('/x'),
      reg.accessHelp.operatorSignIn('/contributor?a=1'),
      reg.accessHelp.operatorError('/operator/signin'),
      reg.accessHelp.contributorSetup,
      reg.accessHelp.contributorError,
      reg.accessHelp.buyer,
    ];
    const hrefs = hrefsIn(everything);
    expect(hrefs.length).toBeGreaterThan(30);
    expect(hrefs.filter((h) => !resolves(h))).toEqual([]);
    expect(resolves('/definitely/not/a/page')).toBe(false);
  });

  it('gives the private link door role cards no link', async () => {
    const reg = await load('lib/access-doors.ts');
    expect(hrefsIn(reg.linkDoorPage)).toEqual([]);
    const link = reg.accessDoors.find((d: { id: string }) => d.id === 'link');
    expect(hrefsIn(link.roles)).toEqual([]);
  });
});

describe('the words on the access pages', () => {
  it('writes every action and door title in Title Case and uses no em dash', async () => {
    const reg = await load('lib/access-doors.ts');
    const { isTitleCase } = await load('lib/ux/title-case.ts');
    const actions: string[] = [
      reg.customerDoorPage.panels.create.primary.text,
      reg.customerDoorPage.panels.create.textLink.text,
      reg.customerDoorPage.panels.signIn.secondary.text,
      ...reg.customerDoorPage.otherWays.cards.map(
        (c: { action: { text: string } }) => c.action.text,
      ),
      ...reg.teamDoorPage.cards.flatMap(
        (c: { action: { text: string }; textLink: { text: string } }) => [
          c.action.text,
          c.textLink.text,
        ],
      ),
      reg.teamDoorPage.steps.more.text,
      ...reg.accessDoors.map((d: { title: string }) => d.title),
    ];
    expect(actions.filter((text) => !isTitleCase(text))).toEqual([]);
    expect(
      JSON.stringify([reg.customerDoorPage, reg.teamDoorPage, reg.linkDoorPage]),
    ).not.toContain('\u2014');
  });
});

describe('the shared access navs', () => {
  const old = JSON.parse(
    readFileSync(resolve('tests/integration/access-options-old-navs.json'), 'utf8'),
  ) as Record<string, string>;

  it('render byte for byte the HTML the nine hand-written navs rendered before', async () => {
    const { AccessOptions } = await load('components/access-options.tsx');
    const { accessHelp } = await load('lib/access-doors.ts');
    const show = (help: object, className?: string) =>
      render(ce(AccessOptions, className ? { ...help, className } : help));
    const signIn = '/operator/signin';
    const got: Record<string, string> = {
      'account-access': show(accessHelp.customerOtherRoutes),
      'operator-signin': show(accessHelp.operatorSignIn('/x')),
      'operator-signin-contributor': show(accessHelp.operatorSignIn('/contributor?a=1')),
      'operator-setup': show(accessHelp.operatorSetup(signIn)),
      'operator-forgot': show(accessHelp.operatorForgotPassword(signIn)),
      'operator-error': show(accessHelp.operatorError(signIn)),
      'operator-error-place': show(accessHelp.operatorError('/operator/signin?w=w&s=s')),
      'contributor-setup': show(accessHelp.contributorSetup),
      'contributor-error': show(accessHelp.contributorError),
      buyer: show(accessHelp.buyer),
      'signin-fallback': show(accessHelp.signInFallback, 'guide-links'),
    };
    expect(Object.keys(got).sort()).toEqual(Object.keys(old).sort());
    for (const key of Object.keys(old)) expect(got[key], key).toBe(old[key]);
  });

  it('renders the "Not what you need?" bar with the other two door titles', async () => {
    const { AccessElsewhere } = await load('components/access-elsewhere.tsx');
    const html = render(ce(AccessElsewhere, { current: 'team' }));
    expect(html).toContain('<nav class="access-elsewhere" aria-label="Not what you need?">');
    expect(html).toContain('<h2>Not what you need?</h2>');
    expect(html).toContain('href="/access/customer">Customer Access</a>');
    expect(html).toContain('href="/access/link">Private Link Access</a>');
    expect(html).not.toContain('Team and Network Access');
  });
});

describe('the access doors switch', () => {
  it('is on only when exactly "true" and decides only the search-engine setting', async () => {
    const { uxSwitchOn } = await load('lib/ux-switches.ts');
    expect(uxSwitchOn('CORRIDRA_UX_ACCESS_DOORS', {})).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_ACCESS_DOORS', { CORRIDRA_UX_ACCESS_DOORS: 'TRUE' })).toBe(
      false,
    );
    expect(uxSwitchOn('CORRIDRA_UX_ACCESS_DOORS', { CORRIDRA_UX_ACCESS_DOORS: 'true' })).toBe(true);
    const { accessDoorMetadata } = await load('components/access-page.tsx');
    const previous = process.env.CORRIDRA_UX_ACCESS_DOORS;
    try {
      delete process.env.CORRIDRA_UX_ACCESS_DOORS;
      const off = accessDoorMetadata('team', 'H', 'L');
      expect(off.robots).toEqual({ index: false, follow: false });
      expect(off).toMatchObject({
        title: 'Team and Network Access | Corridra',
        description: 'L',
        openGraph: { title: 'H', description: 'L' },
      });
      process.env.CORRIDRA_UX_ACCESS_DOORS = 'true';
      expect(accessDoorMetadata('team', 'H', 'L').robots).toEqual({ index: true, follow: true });
    } finally {
      if (previous === undefined) delete process.env.CORRIDRA_UX_ACCESS_DOORS;
      else process.env.CORRIDRA_UX_ACCESS_DOORS = previous;
    }
  });
});
