import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerTabs } from '../../apps/web/lib/ux/customer-navigation';
import { customerSearchPages, type PageEntry } from '../../apps/web/lib/ux/customer-search-pages';

// The new designs of claude/home-v44 are live by default and keep an off switch (owner, 28 Nov 2026). Each switch
// set to exactly "false" returns its surface to what main drew before; unset, the new design is drawn.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => createElement('a', { href, className }, children as never),
}));
vi.doMock(web.resolve('next/navigation'), () => ({
  redirect: (to: string) => {
    throw new Error('redirect:' + to);
  },
  notFound: () => {
    throw new Error('notFound');
  },
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/',
}));
vi.mock('../../packages/config/src/index.ts', () => ({
  readNeonAuthConfig: () => ({ NEON_AUTH_BASE_URL: 'https://auth.example' }),
}));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => ({}) }));
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({ getSession: async () => ({ data: { user: { id: 'user-1' } } }) }),
}));
vi.mock('../../apps/web/components/workspace-shell', () => ({
  WorkspaceShell: ({ children, title }: { children: unknown; title: string }) =>
    createElement('main', { 'data-shell': 'workspace', 'data-title': title }, children),
}));
vi.mock('../../apps/web/components/customer-shell', () => ({
  CustomerShell: ({ children, title }: { children: unknown; title: string }) =>
    createElement('main', { 'data-shell': 'customer', 'data-title': title }, children),
}));

const names = [
  'CORRIDRA_UX_ACCOUNT_V18',
  'CORRIDRA_UX_ACCESS_WINDOW_V11',
  'CORRIDRA_UX_WORK_SIGNIN_V12',
  'CORRIDRA_UX_PLAN_V10',
  'CORRIDRA_UX_START_V13',
];
beforeEach(() => {
  for (const key of names) delete process.env[key];
});
afterEach(() => {
  for (const key of names) delete process.env[key];
});

const labels = (pages: PageEntry[]) => pages.map((p) => p.label);
const everything = {
  companies: true,
  move: false,
  billing: true,
  notificationSettings: true,
  organisationProfiles: true,
  workspaces: [{ id: 'w1', name: 'One' }],
};

describe('customer account v18 switch', () => {
  it('unset, the sidebar is Home, My Work, Companies, Delegations, More', () => {
    expect(customerTabs({ companies: true, move: false }).map((t) => t.label)).toEqual([
      'Home',
      'My Work',
      'Companies',
      'Delegations',
      'More',
    ]);
  });
  it('false, the sidebar is the earlier Home, Requests, Companies, Meetings, Reports', () => {
    expect(
      customerTabs({ companies: true, move: false, v18: false }).map((t) => [
        t.key,
        t.label,
        t.href,
        t.icon,
        t.labelKey,
      ]),
    ).toEqual([
      ['home', 'Home', '/account', 'home', 'wse.nav.home'],
      ['requests', 'Requests', '/account?view=work', 'work', 'wse.nav.work'],
      ['companies', 'Companies', '/account/companies', 'company', 'wse.nav.companies'],
      ['meetings', 'Meetings', '/account/meetings', 'calendar', undefined],
      ['reports', 'Reports', '/account?view=results', 'library', 'wse.nav.results'],
    ]);
  });
  it('Search finds Meetings and Results either way, and lists no My Work tab when off', () => {
    const on = labels(customerSearchPages(everything));
    expect(on).toEqual(expect.arrayContaining(['My Work', 'Meetings', 'Results']));
    const off = labels(customerSearchPages({ ...everything, v18: false }));
    expect(off).toEqual(expect.arrayContaining(['Requests', 'Meetings', 'Reports']));
    expect(off).not.toContain('My Work');
    expect(off).not.toContain('Results');
    expect(off).not.toContain('Delegations');
  });
  it('off, the shell has no Acting for, the account has no My Work tabs or More list, and Listen stays', () => {
    const shell = read('apps/web/components/customer-shell.tsx');
    expect(shell).toContain("const v18 = uxSwitchOn('CORRIDRA_UX_ACCOUNT_V18');");
    expect(shell).toContain('{v18 ? <ActingFor /> : null}');
    expect(shell).toContain('accountV18={v18}');
    const account = read('apps/web/app/account/page.tsx');
    expect(account.match(/uxSwitchOn\('CORRIDRA_UX_ACCOUNT_V18'\) && \(/g)).toHaveLength(3);
    expect(read('apps/web/app/account/meetings/page.tsx')).toContain(
      '{uxSwitchOn(\'CORRIDRA_UX_ACCOUNT_V18\') && <MyWorkTabs current="meetings" meetings />}',
    );
  });
  it('off, the Delegations and My Businesses pages do not exist; unset, they do', async () => {
    const { default: hub } = await load('app/account/delegation-hub/page.tsx');
    const { default: businesses } = await load('app/account/businesses/page.tsx');
    process.env.CORRIDRA_UX_ACCOUNT_V18 = 'false';
    expect(() => hub()).toThrow('notFound');
    await expect(businesses()).rejects.toThrow('notFound');
    delete process.env.CORRIDRA_UX_ACCOUNT_V18;
    expect(render(hub())).toContain('data-title="Delegations"');
  });
  it('off, the company list keeps its earlier words and columns', () => {
    const source = read('apps/web/app/account/companies/company-portfolio.tsx');
    expect(source).toContain("${v18 ? '' : 'Your submitted information. '}");
    expect(source).toContain('{v18 && <th scope="col">Fit</th>}');
    expect(read('apps/web/app/account/companies/page.tsx')).toContain(
      "v18={uxSwitchOn('CORRIDRA_UX_ACCOUNT_V18')}",
    );
  });
});

describe('sign-up window switch', () => {
  it('off, /signup is the earlier account page; unset, the window', async () => {
    const { SignupAccess } = await load('app/signup/signup-access.tsx');
    expect(render(createElement(SignupAccess))).toContain('class="operator-page aw"');
    process.env.CORRIDRA_UX_ACCESS_WINDOW_V11 = 'false';
    const before = render(createElement(SignupAccess));
    expect(before).toContain('data-shell="workspace"');
    expect(before).toContain('data-title="Create your account."');
    expect(before).toContain(
      '<section class="ux-account-access" aria-label="Customer account access">',
    );
    expect(before).not.toContain('operator-page aw');
  });
});

describe('work sign-in window switch', () => {
  it('off, /contributor/signin is the earlier workspace page; unset, the window', async () => {
    const { default: page } = await load('app/contributor/signin/page.tsx');
    const on = render(await page({ searchParams: Promise.resolve({}) }));
    expect(on).toContain('class="operator-page aw"');
    expect(on).toContain('Helper sign-in.');
    process.env.CORRIDRA_UX_WORK_SIGNIN_V12 = 'false';
    const before = render(await page({ searchParams: Promise.resolve({}) }));
    expect(before).toContain('data-title="Sign in to your assigned tasks."');
    expect(before).toContain('href="/operator/forgot-password?for=helper"');
    expect(before).not.toContain('operator-page aw');
  });
  it('off, /operator/signin and /access/team draw the earlier pages', () => {
    const operator = read('apps/web/app/operator/signin/page.tsx');
    expect(operator).toContain("if (uxSwitchOn('CORRIDRA_UX_WORK_SIGNIN_V12'))");
    expect(operator).toContain('title="Sign in to your workspace."');
    const team = read('apps/web/app/access/team/page.tsx');
    expect(team).toMatch(
      /if \(!uxSwitchOn\('CORRIDRA_UX_WORK_SIGNIN_V12'\)\)\s+return <TeamDoorBefore offerInterest=\{offerInterest\} \/>;/,
    );
    expect(team).toContain('<AccessPage id="team"');
  });
});

describe('request window switch', () => {
  it('is passed to the form by /plan and the private request page', () => {
    expect(read('apps/web/app/plan/page.tsx')).toContain(
      "windowDesign={uxSwitchOn('CORRIDRA_UX_PLAN_V10')}",
    );
    expect(read('apps/web/app/account/request/[workspaceId]/page.tsx')).toContain(
      "windowDesign={uxSwitchOn('CORRIDRA_UX_PLAN_V10')}",
    );
  });
  it('off, the form has no window panes and keeps the earlier side summary', () => {
    const intake = read('apps/web/app/plan/intake.tsx');
    expect(intake).toContain(
      "className={windowDesign ? 'guide-plan-body pv-window' : 'guide-plan-body'}",
    );
    expect(intake).toContain('{!windowDesign && !finished && (');
    expect(intake).toContain('className="ux-brief-summary"');
    expect(intake).toContain('<h2 id="pending-request-title">{say(\'form.pending.title\')}</h2>');
  });
  it('scopes every window rule, so the stylesheet changes nothing while off', () => {
    const css = read('apps/web/app/plan/plan-v10.css').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{/g)) {
      const selector = match[1]!.trim();
      if (selector.startsWith('@') || /^(from|to|\d+%)$/.test(selector)) continue;
      for (const part of selector.split(','))
        expect(part, part).toMatch(/\.pv-|\[data-plan-v10\]|\.hv7/);
    }
  });
});

describe('start page switch', () => {
  it('unset, /start offers the three choices; off, it does not exist', async () => {
    const { default: page } = await load('app/start/page.tsx');
    const html = render(page());
    expect(html).toContain('How would you like to continue?');
    expect(html).toContain('href="/plan"');
    process.env.CORRIDRA_UX_START_V13 = 'false';
    expect(() => page()).toThrow('notFound');
  });
  it('off, the sign-in window sends No account yet to /plan', () => {
    expect(read('apps/web/components/account-access.tsx')).toContain(
      "href={uxSwitchOn('CORRIDRA_UX_START_V13') ? '/start' : '/plan'}",
    );
  });
});
