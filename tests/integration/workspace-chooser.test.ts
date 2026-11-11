import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The workspace chooser and the company profiles entry, written out as HTML with their reads answered by the test,
// so what is asserted is what a person reads: one next action for a person with no workspace, and wording that
// names company links only while they are on.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;

const state = {
  workspaces: [] as { id: string; name: string; role: string; synthetic: boolean }[],
  linksOn: false,
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
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error('redirect:' + to);
  },
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    customerWorkspaces: { list: async () => state.workspaces },
  }),
}));
vi.mock('../../packages/auth/src/customer-organisation-links.ts', () => ({
  customerOrganisationLinksEnabled: () => state.linksOn,
}));
vi.mock('../../packages/auth/src/customer-organisation-profiles.ts', () => ({
  customerOrganisationProfilesEnabled: () => true,
}));
vi.mock('../../packages/auth/src/customer-companies.ts', () => ({
  customerCompaniesEnabled: () => true,
}));
vi.mock('../../packages/auth/src/customer-service-requests.ts', () => ({
  customerServiceRequestsEnabled: () => false,
}));
vi.mock('../../packages/config/src/index.ts', () => ({
  readNeonAuthConfig: () => ({ NEON_AUTH_BASE_URL: 'https://auth.example' }),
}));
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({
    getSession: async () => ({ data: { user: { id: 'user-1', emailVerified: true } } }),
  }),
}));
vi.mock('../../apps/web/app/account/companies/company-portfolio', () => ({
  CompanyPortfolio: () => null,
}));
vi.mock('../../apps/web/components/customer-shell', () => ({
  CustomerShell: ({ children, title }: { children: unknown; title: string }) =>
    createElement('main', { 'data-title': title }, children),
}));

const chooserPath = '../../apps/web/components/workspace-chooser';
const profilePath = '../../apps/web/app/account/profile/page';
const companiesPath = '../../apps/web/app/account/companies/page';
type Kind = 'profile' | 'programmes' | 'services' | 'billing';
async function chooser(kind: Kind, linksEnabled?: boolean) {
  const { WorkspaceChooser } = await import(/* @vite-ignore */ chooserPath);
  return renderToStaticMarkup(
    await WorkspaceChooser({
      kind,
      enabled: true,
      ...(linksEnabled === undefined ? {} : { linksEnabled }),
    }),
  );
}
const anchors = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map((m) => ({
    href: m[1]!.replaceAll('&amp;', '&'),
    name: m[2]!.replace(/<[^>]+>/g, ''),
  }));
const workspace = (id: string, role = 'owner') => ({
  id,
  name: 'Name ' + id,
  role,
  synthetic: false,
});
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  state.workspaces = [];
  state.linksOn = false;
});

describe('a person with no workspace is offered one next action', () => {
  for (const kind of ['profile', 'services', 'billing'] as const)
    it(`${kind}: one sentence and one link, to the create control`, async () => {
      const html = await chooser(kind);
      expect(html).toContain('You do not have a workspace yet. Create one to continue.');
      expect(anchors(html)).toEqual([
        { href: '/account?view=work#customer-workspaces', name: 'Create Your Workspace' },
      ]);
      expect(html).not.toContain('Manage your workspaces');
      expect(html).not.toContain('Start a request');
    });
  it('programmes: the sentence about owners and admins stays, with the workspaces link', async () => {
    state.workspaces = [workspace(a, 'member'), workspace(b, 'member')];
    const html = await chooser('programmes');
    expect(html).toContain('Programme management is available to workspace owners and admins.');
    expect(html).not.toContain('Create Your Workspace');
    expect(anchors(html).map((x) => x.name)).toEqual([
      'Manage your workspaces',
      'Your programme registrations',
    ]);
  });
});

describe('a person with workspaces keeps the link to manage them', () => {
  it('lists each workspace and then the manage link, with no create link', async () => {
    state.workspaces = [workspace(a), workspace(b, 'member')];
    const html = await chooser('profile');
    expect(anchors(html)).toEqual([
      { href: `/account/profile/${a}`, name: 'Name ' + a + 'You own this workspace.' },
      { href: `/account/profile/${b}`, name: 'Name ' + b + 'You are a member of this workspace.' },
      { href: '/account?view=work#customer-workspaces', name: 'Manage your workspaces' },
    ]);
    expect(html).not.toContain('Create Your Workspace');
  });
});

describe('the company profiles wording follows the company links switch', () => {
  const off = 'Your company details and supporting statements.';
  const on = 'Your company details, supporting statements and reviewed company links.';
  it('off: the chooser says only what exists and never mentions links', async () => {
    state.workspaces = [workspace(a), workspace(b)];
    const html = await chooser('profile', false);
    expect(html).toContain(off);
    expect(html.toLowerCase()).not.toContain('company link');
    expect(html).not.toContain('reviewed company links');
  });
  it('off is the default when the chooser is not told', async () => {
    state.workspaces = [workspace(a), workspace(b)];
    expect(await chooser('profile')).toContain(off);
  });
  it('on: the chooser says exactly what it said before', async () => {
    state.workspaces = [workspace(a), workspace(b)];
    expect(await chooser('profile', true)).toContain(on);
  });
  it('the other destinations are the same in both states', async () => {
    state.workspaces = [workspace(a), workspace(b)];
    for (const kind of ['services', 'billing', 'programmes'] as const)
      expect(await chooser(kind, true)).toBe(await chooser(kind, false));
  });
  it('the profile page title, heading and chooser follow the switch', async () => {
    const page = await import(/* @vite-ignore */ profilePath);
    const shell = () =>
      page.default() as {
        props: { title: string; children: { props: { linksEnabled: boolean } } };
      };
    state.linksOn = false;
    expect(shell().props.title).toBe('Company profiles');
    expect(shell().props.children.props.linksEnabled).toBe(false);
    expect((await page.generateMetadata()).title).toBe('Company profiles | Corridra');
    state.linksOn = true;
    expect(shell().props.title).toBe('Company profiles and links');
    expect(shell().props.children.props.linksEnabled).toBe(true);
    expect((await page.generateMetadata()).title).toBe('Company profiles and links | Corridra');
  });
  it('the approved companies page links to the profiles with the same words', async () => {
    const page = await import(/* @vite-ignore */ companiesPath);
    state.linksOn = false;
    expect(anchors(renderToStaticMarkup(await page.default()))).toEqual([
      { href: '/account/profile', name: 'Manage your company profiles' },
    ]);
    state.linksOn = true;
    expect(anchors(renderToStaticMarkup(await page.default()))).toEqual([
      { href: '/account/profile', name: 'Manage your company profiles and links' },
    ]);
  });
  it('the My Work link to the profiles names links only through the switch', () => {
    const source = readFileSync(resolve('apps/web/app/account/page.tsx'), 'utf8');
    expect(source).toContain(
      '<strong>{companyProfilesTitle(customerOrganisationLinksEnabled())}</strong>',
    );
    expect(source).not.toContain('Company profiles and links');
  });
});
