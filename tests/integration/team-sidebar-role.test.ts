import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) =>
    createElement('a', { href }, children as never),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/operator' }));

// The component is TSX and the package type check has no JSX setting, so it is loaded by path.
const sidebarPath = '../../apps/web/components/ux/team-sidebar';
const load = async () => (await import(/* @vite-ignore */ sidebarPath)).TeamSidebar;

describe('team sidebar before the role is known', () => {
  test('first render (role unknown) offers no owner or admin-only links', async () => {
    const TeamSidebar = await load();
    const html = renderToStaticMarkup(createElement(TeamSidebar, { urls: true, ownerPage: true }));
    expect(html).not.toContain('/operator/owner');
  });
});

describe('team sidebar sections while the role is unknown', () => {
  const link = (html: string, word: string) => html.includes('href="/operator/' + word + '"');
  test('lists only what every role may open, and none of the restricted sections', async () => {
    const TeamSidebar = await load();
    const html = renderToStaticMarkup(createElement(TeamSidebar, { urls: true, ownerPage: true }));
    for (const word of ['missions', 'research', 'meetings', 'commercial'])
      expect(link(html, word), word).toBe(true);
    expect(html).not.toContain('Admin');
    for (const word of [
      'controls',
      'audit',
      'settings',
      'control-center',
      'operations',
      'dashboard',
      'health',
      'readiness',
      'assistance',
      'network',
    ]) {
      expect(link(html, word), word).toBe(false);
    }
  });
});

describe('team sidebar once the role is known', () => {
  const secondPath = '../../apps/web/components/ux/team-second-level';
  const renderAs = async (role: string, at = '/operator/settings') => {
    vi.resetModules();
    vi.doMock('../../apps/web/lib/ux/team-context', () => ({
      subscribeTeamContext: () => () => undefined,
      readTeamContext: () => ({ tenant: '', role }),
      readServerTeamContext: () => ({ tenant: '', role }),
    }));
    vi.doMock(web.resolve('next/navigation'), () => ({ usePathname: () => at }));
    vi.doMock(web.resolve('next/link'), () => ({
      default: ({ children, href }: { children: unknown; href: string }) =>
        createElement('a', { href }, children as never),
    }));
    const TeamSecondLevel = (await import(/* @vite-ignore */ secondPath)).TeamSecondLevel;
    return renderToStaticMarkup(createElement(TeamSecondLevel, { urls: true, ownerPage: true }));
  };
  test('lists the owner page for owner and admin, not for an operator or viewer', async () => {
    expect(await renderAs('owner')).toContain('/operator/owner');
    expect(await renderAs('admin')).toContain('/operator/owner');
    expect(await renderAs('operator')).not.toContain('/operator/owner');
    expect(await renderAs('viewer')).not.toContain('/operator/owner');
  });
  test('the owner page link needs the owner page to be on', async () => {
    vi.resetModules();
    vi.doMock('../../apps/web/lib/ux/team-context', () => ({
      subscribeTeamContext: () => () => undefined,
      readTeamContext: () => ({ tenant: '', role: 'owner' }),
      readServerTeamContext: () => ({ tenant: '', role: 'owner' }),
    }));
    vi.doMock(web.resolve('next/navigation'), () => ({ usePathname: () => '/operator/settings' }));
    const TeamSecondLevel = (await import(/* @vite-ignore */ secondPath)).TeamSecondLevel;
    const html = renderToStaticMarkup(
      createElement(TeamSecondLevel, { urls: true, ownerPage: false }),
    );
    expect(html).not.toContain('/operator/owner');
    expect(html).toContain('/operator/control-center');
  });
});

describe('team pages that do not mount the workspace publish the role from the server', () => {
  const publisherPath = '../../apps/web/components/ux/team-context-publisher';
  const link = (html: string, word: string) => html.includes('href="/operator/' + word + '"');
  // The sidebar reads the published context on the server render too, so the chain is the real one:
  // publisher effect -> context store -> sidebar. Effects do not run in a static render, so the
  // publisher's effect is run at once.
  const withPublisher = async (role: string | null) => {
    vi.resetModules();
    vi.doMock(web.resolve('react'), async (original) => {
      const react = await original<Record<string, unknown>>();
      return { ...react, useEffect: (effect: () => void) => void effect() };
    });
    vi.doMock('../../apps/web/lib/ux/team-context', async (original) => {
      const real = await original<typeof import('../../apps/web/lib/ux/team-context')>();
      return { ...real, readServerTeamContext: real.readTeamContext };
    });
    if (role) {
      const { TeamContextPublisher } = await import(/* @vite-ignore */ publisherPath);
      renderToStaticMarkup(createElement(TeamContextPublisher, { tenant: 't1', role }));
    }
    const TeamSidebar = await load();
    return renderToStaticMarkup(createElement(TeamSidebar, { urls: true, ownerPage: true }));
  };
  test('an owner or admin sees the Admin group once the publisher ran', async () => {
    const owner = await withPublisher('owner');
    for (const word of ['controls', 'settings', 'audit', 'health', 'readiness'])
      expect(link(owner, word), word).toBe(true);
    const admin = await withPublisher('admin');
    expect(link(admin, 'settings')).toBe(true);
    expect(link(admin, 'controls')).toBe(false);
  });
  test('a viewer gets nothing more than the unknown role does', async () => {
    const viewer = await withPublisher('viewer');
    expect(viewer).not.toContain('/operator/owner');
    expect(viewer).not.toContain('Admin');
    for (const word of ['controls', 'network', 'settings', 'audit'])
      expect(link(viewer, word), word).toBe(false);
  });
  test('with no publisher mounted the owner links are absent', async () => {
    vi.resetModules();
    const html = await withPublisher(null);
    expect(html).not.toContain('/operator/owner');
    expect(link(html, 'controls')).toBe(false);
  });
  test('the Owner page and the mission page mount it with the role the server resolved', () => {
    const root = new URL('../../apps/web/app/operator/', import.meta.url);
    const owner = readFileSync(new URL('owner/page.tsx', root), 'utf8');
    const mission = readFileSync(new URL('[section]/[missionId]/page.tsx', root), 'utf8');
    expect(owner).toContain('<TeamContextPublisher tenant={tenant.id} role={tenant.role} />');
    expect(mission).toContain('<TeamContextPublisher tenant={tenant} role={chosen.role} />');
    for (const page of [owner, mission]) expect(page).toContain('s.access.tenants(identity.token)');
  });
});
