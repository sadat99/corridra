import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';

// ADR-084 slice S0, the entry link. The organiser entry on /trade-missions must open the organiser route
// (/account/delegations/organise), not the participant page (/account/delegations). The link is followed here the way
// a browser follows it: the href is read from the rendered page, the route file at that address is loaded and what it
// renders is checked for a signed-out visitor, a participant-only account and an organiser.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;

type Workspace = { id: string; name: string; role: string; synthetic: boolean };
const state = {
  // What the workspace list answers: rows, or the refusal a signed-out visitor gets.
  list: (async () => []) as () => Promise<Workspace[]>,
  session: null as null | { data: { user: { id: string; emailVerified: boolean } | null } },
};
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
// Resolved from the web application, where the pages import it; the routes are loaded after this, by dynamic import.
vi.doMock(web.resolve('next/navigation'), () => ({
  redirect: (to: string) => {
    throw new Error('redirect:' + to);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    customerWorkspaces: { list: () => state.list() },
  }),
}));
vi.mock('../../packages/config/src/index.ts', () => ({
  readNeonAuthConfig: () => ({ NEON_AUTH_BASE_URL: 'https://auth.example' }),
}));
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({ getSession: async () => state.session }),
}));
vi.mock('../../apps/web/components/customer-shell', () => ({
  CustomerShell: ({ children, title }: { children: unknown; title: string }) =>
    createElement('main', { 'data-title': title }, children),
}));

const chain = {
  VERCEL_ENV: 'preview',
  DATA_ENVIRONMENT: 'synthetic',
  CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
  CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
  CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
  CORRIDRA_PROGRAMME_PAGES: 'true',
};
const names = Object.keys(chain);
beforeEach(() => {
  Object.assign(process.env, chain);
  state.list = async () => [];
  state.session = null;
});
afterEach(() => {
  for (const key of names) delete process.env[key];
});

const textOf = (html: string) => {
  let out = '';
  let inTag = false;
  for (const char of html) {
    if (char === '<') inTag = true;
    else if (char === '>' && inTag) inTag = false;
    else if (!inTag) out += char;
  }
  return out;
};
const anchors = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map((m) => ({
    href: m[1]!.replaceAll('&amp;', '&'),
    name: textOf(m[2]!),
  }));

type RoutePage = {
  default: (props?: unknown) => unknown;
  metadata: { title: string; robots: { index: boolean; follow: boolean } };
};
// The route file Next serves for a static address: app/<address>/page.tsx.
const routeFile = (href: string) => resolve('apps/web/app', '.' + href, 'page.tsx');
const loadRoute = async (href: string) =>
  (await import(/* @vite-ignore */ routeFile(href))) as RoutePage;

/** The address the entry action on the public trade missions page points at. */
async function entryHref() {
  const file = '../../apps/web/app/trade-missions/page.tsx';
  const page = (await import(/* @vite-ignore */ file)) as { default: () => unknown };
  const action = anchors(renderToStaticMarkup(page.default())).filter(
    (link) => link.name === 'Open Your Programmes',
  );
  expect(action).toHaveLength(1);
  return action[0]!.href;
}
/** What the route at the entry's address renders, with the chooser's own reads answered by the test. */
async function follow() {
  const href = await entryHref();
  // Checked before the route is loaded: a wrong address is the failure, whatever page happens to live there.
  expect(href).toBe('/account/delegations/organise');
  expect(existsSync(routeFile(href))).toBe(true);
  const route = await loadRoute(href);
  const shell = route.default() as {
    props: {
      title: string;
      children: { type: (props: unknown) => Promise<unknown>; props: object };
    };
  };
  const chooser = shell.props.children;
  return {
    href,
    route,
    title: shell.props.title,
    chooserProps: chooser.props as { kind?: string; enabled?: boolean },
    render: async () => renderToStaticMarkup(await chooser.type(chooser.props)),
  };
}
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const workspace = (id: string, role: string): Workspace => ({
  id,
  name: 'Synthetic workspace ' + id.slice(0, 4),
  role,
  synthetic: true,
});

describe('the organiser entry on /trade-missions opens the organiser route', () => {
  it('points at /account/delegations/organise, which is the Programmes chooser', async () => {
    const landed = await follow();
    expect(landed.href).toBe('/account/delegations/organise');
    expect(landed.route.metadata.title).toBe('Programmes | Corridra');
    expect(landed.title).toBe('Programmes');
    expect(landed.chooserProps).toEqual({ kind: 'programmes', enabled: true });
  });

  it('never lands on the participant page', async () => {
    const href = await entryHref();
    expect(href).not.toBe('/account/delegations');
    expect((await loadRoute(href)).metadata.title).not.toBe('Delegation registrations | Corridra');
  });

  it('an organiser with one workspace goes straight to its programmes', async () => {
    state.list = async () => [workspace(a, 'owner')];
    await expect((await follow()).render()).rejects.toThrow(`redirect:/account/delegations/${a}`);
  });

  it('an organiser with several workspaces chooses one', async () => {
    state.list = async () => [workspace(a, 'owner'), workspace(b, 'admin')];
    const html = await (await follow()).render();
    expect(
      anchors(html)
        .slice(0, 2)
        .map((link) => link.href),
    ).toEqual([`/account/delegations/${a}`, `/account/delegations/${b}`]);
  });

  it('a signed-out visitor is sent to sign in, the chooser’s own return path', async () => {
    state.list = async () => {
      throw new DomainError('Sign in to continue', 401);
    };
    await expect((await follow()).render()).rejects.toThrow(/^redirect:\/signin$/);
  });

  it('a participant-only account gets the chooser’s own words and its link to registrations', async () => {
    // A member of a workspace, or a person with no workspace at all, manages no programme.
    for (const rows of [[workspace(a, 'member')], []]) {
      state.list = async () => rows;
      const html = await (await follow()).render();
      expect(html).toContain('Programme management is available to workspace owners and admins.');
      expect(anchors(html)).toEqual([
        { href: '/account?view=work#customer-workspaces', name: 'Manage your workspaces' },
        { href: '/account/delegations', name: 'Your programme registrations' },
      ]);
    }
  });
});

describe('the participant route /account/delegations is unchanged', () => {
  it('is still the registrations page, with its own sign-in return path', async () => {
    const page = await loadRoute('/account/delegations');
    expect(page.metadata).toEqual({
      title: 'Delegation registrations | Corridra',
      robots: { index: false, follow: false },
    });
    state.session = { data: { user: null } };
    await expect(
      (page.default as (props: unknown) => Promise<unknown>)({
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('redirect:/signin?next=%2Faccount%2Fdelegations');
  });

  it('is the same file as on the commit before this change', () => {
    // The link fix touches the entry only. These lines are the participant page's identity and are read from source.
    const source = readFileSync(resolve('apps/web/app/account/delegations/page.tsx'), 'utf8');
    expect(source).toContain("title: 'Delegation registrations | Corridra'");
    expect(source).toContain(
      "redirect(`/signin?next=${encodeURIComponent('/account/delegations')}`)",
    );
    expect(source).toContain('<ParticipantAccount');
    expect(source).not.toContain('WorkspaceChooser');
  });
});
