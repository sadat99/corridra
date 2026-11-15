import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';

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
  workspaces: [] as {
    id: string;
    name: string;
    role: string;
    synthetic: boolean;
    archived?: boolean;
  }[],
  linksOn: false,
  fail: null as Error | null,
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
// Resolved from the web application, where the chooser imports it; the chooser is loaded after this.
vi.doMock(web.resolve('next/navigation'), () => ({
  redirect: (to: string) => {
    throw new Error('redirect:' + to);
  },
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    customerWorkspaces: {
      list: async () => {
        if (state.fail) throw state.fail;
        return state.workspaces;
      },
    },
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
  // The real shell draws the page frame's helper line under the title, before the page body.
  CustomerShell: ({
    children,
    title,
    frame,
  }: {
    children: unknown;
    title: string;
    frame?: { helper?: unknown };
  }) => createElement('main', { 'data-title': title }, frame?.helper, children),
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
// The words between tags, read one character at a time so no tag text can survive a partial match.
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
const headingOf = (html: string) => /<h2[^>]*>(.*?)<\/h2>/.exec(html)?.[1];
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
  state.fail = null;
});

describe('a person with no workspace is offered one next action', () => {
  for (const kind of ['profile', 'services', 'billing'] as const)
    it(`${kind}: one sentence and one link, to the create control`, async () => {
      const html = await chooser(kind);
      expect(html).toContain('You do not have a workspace yet. Create one to continue.');
      expect(headingOf(html)).toBe('Create a workspace');
      expect(anchors(html)).toEqual([
        { href: '/account?view=work#customer-workspaces', name: 'Create a Workspace' },
      ]);
      expect(html).not.toContain('Manage your workspaces');
      expect(html).not.toContain('Start a request');
    });
  it('programmes with no workspace: why a workspace is needed, one primary action, registrations kept', async () => {
    const html = await chooser('programmes');
    expect(html).toContain('Organising a programme needs a workspace. Create one to continue.');
    expect(headingOf(html)).toBe('Create a workspace');
    expect(html).toContain('class="primary-link"');
    expect(anchors(html)).toEqual([
      { href: '/account?view=work#customer-workspaces', name: 'Create a Workspace' },
      { href: '/account/delegations', name: 'Your programme registrations' },
    ]);
    expect(html).not.toContain('Manage your workspaces');
  });
  it('programmes with member-only workspaces: says only owners and admins organise, still offers Create a Workspace', async () => {
    state.workspaces = [workspace(a, 'member'), workspace(b, 'member')];
    const html = await chooser('programmes');
    expect(html).toContain('Only workspace owners and admins can organise programmes.');
    expect(html).not.toContain('Organising a programme needs a workspace.');
    expect(headingOf(html)).toBe('Create a workspace');
    expect(anchors(html)).toEqual([
      { href: '/account?view=work#customer-workspaces', name: 'Create a Workspace' },
      { href: '/account/delegations', name: 'Your programme registrations' },
    ]);
  });
  it('programmes copy has no em dash and the action is Title Case', async () => {
    for (const rows of [[], [workspace(a, 'member')]]) {
      state.workspaces = rows;
      const html = await chooser('programmes');
      expect(html).not.toContain('\u2014');
      expect(html).not.toContain('<button');
      expect(html).not.toContain('<form');
    }
  });
});

describe('archived workspaces are not offered to start new work', () => {
  const archived = (id: string, role = 'owner') => ({ ...workspace(id, role), archived: true });
  const manage = { href: '/account?view=work#customer-workspaces', name: 'Manage your workspaces' };
  const create = { href: '/account?view=work#customer-workspaces', name: 'Create a Workspace' };
  it('programmes with only an archived owned workspace: no active workspace, never membership alone, no redirect', async () => {
    state.workspaces = [archived(a), workspace(b, 'member')];
    const html = await chooser('programmes');
    expect(headingOf(html)).toBe('No active workspace');
    expect(html).toContain(
      'Your workspaces that can organise programmes are archived. The owner can restore one from your workspaces, or you can create a new one.',
    );
    expect(html).not.toContain('Only workspace owners and admins can organise programmes.');
    expect(html).not.toContain('/account/delegations/' + a);
    expect(anchors(html)).toEqual([
      create,
      manage,
      { href: '/account/delegations', name: 'Your programme registrations' },
    ]);
    expect(html).not.toContain('\u2014');
  });
  it('help requests with every workspace archived: no active workspace and a way to restore', async () => {
    state.workspaces = [archived(a), archived(b, 'member')];
    const html = await chooser('services');
    expect(headingOf(html)).toBe('No active workspace');
    expect(html).toContain(
      'Your workspaces are archived. The owner can restore one from your workspaces, or you can create a new one.',
    );
    expect(anchors(html)).toEqual([create, manage]);
  });
  it('one active and one archived workspace: help requests open the active one directly', async () => {
    state.workspaces = [archived(a), workspace(b)];
    await expect(chooser('services')).rejects.toThrow('redirect:/account/service-requests/' + b);
    await expect(chooser('programmes')).rejects.toThrow('redirect:/account/delegations/' + b);
  });
  it('billing and the profile keep archived workspaces, labelled and after the active ones', async () => {
    state.workspaces = [archived(a), workspace(b)];
    for (const kind of ['billing', 'profile'] as const) {
      const html = await chooser(kind);
      expect(headingOf(html)).toBe('Choose a workspace');
      expect(anchors(html).map((link) => link.href)).toEqual([
        '/account/' + kind + '/' + b,
        '/account/' + kind + '/' + a,
        '/account?view=work#customer-workspaces',
      ]);
      expect(anchors(html)[1]!.name).toBe('Name ' + a + ' ArchivedYou own this workspace.');
      expect(html).toContain('<span class="ux-badge">Archived</span>');
      expect(html.match(/ux-badge/g)).toHaveLength(1);
    }
  });
  it('billing with only an archived workspace still opens it, so money stays reachable', async () => {
    state.workspaces = [archived(a)];
    await expect(chooser('billing')).rejects.toThrow('redirect:/account/billing/' + a);
  });
});

describe('only the programmes chooser carries the person back after sign-in', () => {
  const failWith = (error: Error) => {
    state.fail = error;
  };
  it('programmes: 401 goes to sign-in with returnTo, unverified email to verify-email with returnTo', async () => {
    failWith(new DomainError('Sign in to continue', 401));
    await expect(chooser('programmes')).rejects.toThrow(
      'redirect:/signin?returnTo=%2Faccount%2Fdelegations%2Forganise',
    );
    failWith(new DomainError('Verify your email to continue', 403));
    await expect(chooser('programmes')).rejects.toThrow(
      'redirect:/verify-email?returnTo=%2Faccount%2Fdelegations%2Forganise',
    );
  });
  it('the other kinds keep their plain redirects', async () => {
    for (const kind of ['profile', 'services', 'billing'] as const) {
      failWith(new DomainError('Sign in to continue', 401));
      await expect(chooser(kind)).rejects.toThrow(/^redirect:\/signin$/);
      failWith(new DomainError('Verify your email to continue', 403));
      await expect(chooser(kind)).rejects.toThrow(/^redirect:\/verify-email$/);
    }
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
    expect(html).not.toContain('Create a Workspace');
    expect(headingOf(html)).toBe('Choose a workspace');
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
