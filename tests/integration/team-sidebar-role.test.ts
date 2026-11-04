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

describe('team sidebar once the role is known', () => {
  const renderAs = async (role: string) => {
    vi.resetModules();
    vi.doMock('../../apps/web/lib/ux/team-context', () => ({
      subscribeTeamContext: () => () => undefined,
      readTeamContext: () => ({ tenant: '', role }),
      readServerTeamContext: () => ({ tenant: '', role }),
    }));
    const TeamSidebar = await load();
    return renderToStaticMarkup(createElement(TeamSidebar, { urls: true, ownerPage: true }));
  };
  test('lists the owner page for owner and admin, not for an operator or viewer', async () => {
    expect(await renderAs('owner')).toContain('/operator/owner');
    expect(await renderAs('admin')).toContain('/operator/owner');
    expect(await renderAs('operator')).not.toContain('/operator/owner');
    expect(await renderAs('viewer')).not.toContain('/operator/owner');
  });
});
