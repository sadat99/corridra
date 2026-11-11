import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The team screens of Report a Problem (ADR-078 decisions 4, 6 and 8, docs/revamp/specs/problem-reports.md sections 3 to
// 6), drawn on the server without a browser or a database: the session and workspace choice, the two probe states, the
// words that name the other reader, and ADR-032 (the team's screens never lead to /account). That a customer session is
// refused by the staff route and the reverse is held at the route, in problem-report-routes.test.ts.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;

type Element = { type: unknown; props: Record<string, unknown> };
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'] as const;

let offered = true;
let configured = true;
let identity: { token: string } | null = { token: 'synthetic-token' };
let tenants: { id: string; name: string; role: string }[] = [];

beforeEach(() => {
  offered = true;
  configured = true;
  identity = { token: 'synthetic-token' };
  tenants = [
    { id: first, name: 'First', role: 'viewer' },
    { id: second, name: 'Second', role: 'owner' },
  ];
  vi.resetModules();
  vi.doMock(web.resolve('next/headers'), () => ({ headers: async () => new Headers() }));
  vi.doMock(web.resolve('next/navigation'), () => ({
    redirect: (to: string) => {
      throw new Error(`REDIRECT ${to}`);
    },
    useRouter: () => ({ push: () => undefined, replace: () => undefined }),
    usePathname: () => '/operator/problem-reports',
    useSearchParams: () => new URLSearchParams(),
  }));
  vi.doMock(web.resolve('next/link'), () => ({
    default: ({ children, href }: Record<string, unknown>) =>
      createElement('a', { href }, children),
  }));
  vi.doMock(resolve('apps/web/lib/problem-reports-offered.ts'), () => ({
    problemReportsOffered: async () => offered,
  }));
  vi.doMock(resolve('apps/web/lib/foundations.ts'), () => ({
    foundations: () =>
      configured
        ? {
            ready: Promise.resolve(),
            provider: { getSession: async () => identity },
            access: { tenants: async () => tenants },
          }
        : null,
  }));
});
afterEach(() => vi.resetModules());

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
/** Draws a team page: the page function, then the shared frame it hands the workspace to. */
async function drawPage(path: string, props: Record<string, unknown>) {
  const { default: Page } = await load(path);
  const element = (await Page(props)) as Element;
  const frame = await (element.type as (p: unknown) => Promise<unknown>)(element.props);
  return renderToStaticMarkup(frame);
}
const pages = [
  {
    name: 'the list',
    path: 'app/operator/problem-reports/page.tsx',
    props: (workspace?: string) => ({ searchParams: Promise.resolve({ workspace }) }),
    filing: false,
  },
  {
    name: 'the form',
    path: 'app/operator/problem-reports/new/page.tsx',
    props: (workspace?: string) => ({
      searchParams: Promise.resolve({ workspace, from: '/operator/missions' }),
    }),
    filing: true,
  },
  {
    name: 'the detail',
    path: 'app/operator/problem-reports/[reference]/page.tsx',
    props: (workspace?: string) => ({
      searchParams: Promise.resolve({ workspace }),
      params: Promise.resolve({ reference: 'RP-000123' }),
    }),
    filing: false,
  },
] as const;

describe('who may open the team pages', () => {
  test.each(pages)(
    '$name: signed out goes to team sign-in, never to the customer one',
    async (p) => {
      identity = null;
      await expect(drawPage(p.path, p.props(second))).rejects.toThrow(
        /^REDIRECT \/operator\/signin\?next=/,
      );
    },
  );
  test.each(pages)('$name: a person with no workspace is told so and sees no screen', async (p) => {
    tenants = [];
    const html = await drawPage(p.path, p.props());
    expect(html).toContain('Workspace access is unavailable.');
    expect(html).toContain('Verify your access');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('Loading');
  });
  test.each(pages)('$name: a deployment without the protected workspace says so', async (p) => {
    configured = false;
    const html = await drawPage(p.path, p.props());
    expect(html).toContain('The protected workspace is not configured in this environment.');
    expect(html).not.toContain('<form');
  });
  test.each(roles)('%s may file and read their own reports: the screen is drawn', async (role) => {
    tenants = [{ id: first, name: 'First', role }];
    for (const p of pages) {
      const html = await drawPage(p.path, p.props(first));
      expect(html, p.name).not.toContain('not available yet');
      expect(html, p.name).not.toContain('Workspace access is unavailable.');
    }
  });
});

/** Every `tenant` prop in the tree a team page drew: the workspace handed to the context and to the screen. */
function tenantsIn(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(tenantsIn);
  if (!node || typeof node !== 'object') return [];
  const { props } = node as Element;
  return [
    ...(typeof props?.tenant === 'string' ? [props.tenant] : []),
    ...tenantsIn(props?.children),
  ];
}
async function tenantOf(path: string, props: Record<string, unknown>) {
  const { default: Page } = await load(path);
  const element = (await Page(props)) as Element;
  const frame = await (element.type as (p: unknown) => Promise<unknown>)(element.props);
  return [...new Set(tenantsIn(frame))];
}

describe('the workspace the screens ask for', () => {
  test('the workspace of the address is the one used, for the screen and for the team shell', async () => {
    for (const p of pages)
      expect(await tenantOf(p.path, p.props(second)), p.name).toEqual([second]);
  });
  test('a workspace that is not the person\u2019s own falls back to their first, never to the one asked for', async () => {
    const stranger = '33333333-3333-4333-8333-333333333333';
    for (const p of pages)
      expect(await tenantOf(p.path, p.props(stranger)), p.name).toEqual([first]);
  });
  test('no workspace in the address means the first of their own', async () => {
    for (const p of pages) expect(await tenantOf(p.path, p.props()), p.name).toEqual([first]);
  });
  test('the links of the screen carry the workspace the way the team shell does', async () => {
    const { teamReportLinks } = await load('lib/problem-report-links.ts');
    expect(teamReportLinks(second).list).toContain(`workspace=${second}`);
    expect(teamReportLinks('not a workspace').list).toBe('/operator/problem-reports');
  });
});

describe('while problem reports are not offered (a probe is false)', () => {
  test.each(pages)(
    '$name says so in the words of the 503 and draws nothing that could send',
    async (p) => {
      offered = false;
      const html = await drawPage(p.path, p.props(first));
      expect(html).toContain('Problem reports are not available yet.');
      expect(html.includes('You cannot report a problem here yet. Nothing was sent.')).toBe(
        p.filing,
      );
      for (const live of ['<form', '<textarea', 'Send Problem Report', 'Loading'])
        expect(html, live).not.toContain(live);
      expect(html).toContain(`href="/operator?workspace=${first}"`);
      expect(html).toContain('Return to Today');
    },
  );
});

describe('while problem reports are offered (both probes hold)', () => {
  test('the form opens on step 1 with "This page" named from a team page, and no customer words', async () => {
    const html = await drawPage(pages[1].path, pages[1].props(first));
    expect(html).toContain('What went wrong?');
    expect(html).toContain('/operator/missions');
    expect(html).toContain('This page');
    expect(html).toContain('>Continue<');
    // Not Now returns to the page they came from, in the workspace they were in.
    expect(html).toContain(`href="/operator/missions?workspace=${first}"`);
    expect(html).not.toContain('Return to Your Account');
  });
  test('a from that is not a team page is dropped, so only the typed page is offered', async () => {
    const { default: Page } = await load(pages[1].path);
    const element = (await Page({
      searchParams: Promise.resolve({ workspace: first, from: '/account/requests' }),
    })) as Element;
    const frame = await (element.type as (p: unknown) => Promise<unknown>)(element.props);
    const html = renderToStaticMarkup(frame);
    expect(html).toContain('Which page or screen?');
    expect(html).not.toContain('/account/requests');
  });
  test('the list draws no removal of words: a team member has no screen for that', async () => {
    const html = await drawPage(pages[0].path, pages[0].props(first));
    expect(html).not.toContain('Remove the');
  });
});

describe('the words that name the other reader', () => {
  test('a team member is told an owner or admin, never the Corridra team', async () => {
    const words = await load('lib/problem-report-words.ts');
    expect(words.reviewSentence('team')).toBe('An owner or admin will review it.');
    expect(words.noteFrom('team')).toBe('Note from an owner or admin');
    expect(words.statusMeaning('in_review', 'team')).toBe('An owner or admin is looking at it.');
    expect(words.reviewSentence('customer')).toBe('The Corridra team will review it.');
    expect(words.noteFrom('customer')).toBe('Note from the Corridra team');
    expect(words.statusMeaning('in_review', 'customer')).toBe(
      'Someone in the Corridra team is looking at it.',
    );
    const { teamReportLinks } = await load('lib/problem-report-links.ts');
    expect(teamReportLinks(first).homeLabel).toBe('Return to Today');
  });
});

describe('ADR-032: the team screens lead only to team addresses', () => {
  test('every link on every team screen, offered or not, stays out of /account', async () => {
    const { teamReportLinks } = await load('lib/problem-report-links.ts');
    const drawn: string[] = [];
    for (const value of [true, false]) {
      offered = value;
      for (const p of pages) {
        drawn.push(...hrefs(await drawPage(p.path, p.props(first))));
        drawn.push(...hrefs(await drawPage(p.path, p.props())));
      }
    }
    for (const empty of [[], [{ id: first, name: 'First', role: 'owner' }]]) {
      tenants = empty;
      for (const p of pages) drawn.push(...hrefs(await drawPage(p.path, p.props(first))));
    }
    configured = false;
    for (const p of pages) drawn.push(...hrefs(await drawPage(p.path, p.props(first))));
    const links = teamReportLinks(first);
    const fixed = [
      links.signIn,
      links.home,
      links.list,
      links.form,
      links.detail('RP-000123'),
      teamReportLinks('').signIn,
      teamReportLinks('').home,
    ];
    for (const href of [...drawn, ...fixed]) expect(href, href).not.toMatch(/account/);
    expect(links.list).toBe(`/operator/problem-reports?workspace=${first}`);
    expect(links.form).toBe(`/operator/problem-reports/new?workspace=${first}`);
    expect(links.home).toBe(`/operator?workspace=${first}`);
    expect(links.detail('RP-000123')).toBe(
      `/operator/problem-reports/RP-000123?workspace=${first}`,
    );
    expect(links.signIn).toMatch(/^\/operator\/signin\?next=/);
  });
  test('no team page names a customer address or route, and none reads a customer session', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const files = [
      'apps/web/components/problem-reports/team-problem-reports.tsx',
      ...readdirSync(resolve('apps/web/app/operator/problem-reports'), { recursive: true })
        .map(String)
        .filter((file) => file.endsWith('.tsx'))
        .map((file) => `apps/web/app/operator/problem-reports/${file}`),
    ];
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const text = readFileSync(resolve(file), 'utf8');
      expect(text, file).not.toMatch(
        /['"`]\/account|customer-problem-reports|customer-page-session/,
      );
    }
  });
});
