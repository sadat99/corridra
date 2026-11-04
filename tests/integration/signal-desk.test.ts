import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { translate } from '../../apps/web/lib/i18n/messages';
import { sectionForSlug, operatorSlugs } from '../../apps/web/lib/operator-urls';
import { workspaceSections } from '../../apps/web/lib/workspace-navigation';
import { currentTeamItem, currentTeamSection, teamNavigation } from '../../apps/web/lib/ux/shells';

// Signal Desk (revamp Wave 5, step B2, docs/revamp/specs/signal-desk.md): S-01 to S-04. S-02 (the same
// reachable sections per role as before) is staff-parity.test.ts; S-03 (nothing role-limited and no
// owner link while the role is unknown) is also pinned in team-sidebar-role.test.ts. S-05 (390 and
// wide widths, no sideways scroll, 44 px targets, accessibility) runs in the browser, in
// tests/e2e/verification/ws-e/team-shell.spec.ts.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
let pathname = '/operator';

const sidebarPath = '../../apps/web/components/ux/team-sidebar';
const render = async (role: string | null, at = '/operator', locale = 'en') => {
  pathname = at;
  vi.resetModules();
  // The web app resolves its own copy of next, so the mocks name that copy.
  vi.doMock(web.resolve('next/navigation'), () => ({ usePathname: () => pathname }));
  vi.doMock(web.resolve('next/link'), () => ({
    default: ({ children, href, ...rest }: { children: unknown; href: string }) =>
      createElement('a', { href, ...rest }, children as never),
  }));
  vi.doMock('../../apps/web/lib/ux/team-context', async (original) => {
    const real = await original<Record<string, unknown>>();
    const context = { tenant: '', role };
    return { ...real, readTeamContext: () => context, readServerTeamContext: () => context };
  });
  vi.doMock('../../apps/web/components/language-provider', () => ({
    useLanguage: () => ({
      locale,
      t: (key: Parameters<typeof translate>[1]) => translate(locale as 'en', key),
    }),
  }));
  const { TeamSidebar } = await import(/* @vite-ignore */ sidebarPath);
  return renderToStaticMarkup(createElement(TeamSidebar, { urls: true, ownerPage: true }));
};
const link = (html: string, word: string) => html.includes('href="/operator/' + word + '"');
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'];

describe('S-01 the map places each section exactly once', () => {
  test('every id in workspaceSections is in exactly one group, and no group names an unknown id', () => {
    const placed = teamNavigation.flatMap((group) => group.sections ?? []);
    const ids = workspaceSections.map((section) => section.id);
    expect([...placed].sort()).toEqual([...ids].sort());
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed).toHaveLength(18);
  });
  test('the locked names, in order, with Today first and no group beyond the six', () => {
    expect(teamNavigation.map((group) => translate('en', group.label))).toEqual([
      'Today',
      'Missions',
      'Companies',
      'Delivery',
      'Outcomes',
      'All tools and settings',
    ]);
    expect(teamNavigation[0]?.sections).toBeUndefined();
  });
  test('the map matches the Guardian table', () => {
    const map = Object.fromEntries(
      teamNavigation.filter((g) => g.sections).map((g) => [g.key, g.sections]),
    );
    expect(map).toEqual({
      missions: ['workspace-missions', 'workspace-meetings', 'workspace-commercial'],
      companies: ['workspace-research', 'workspace-sources', 'workspace-evidence'],
      delivery: ['workspace-delivery', 'workspace-network', 'workspace-ai'],
      outcomes: ['ops-dashboard'],
      tools: [
        'workspace-operations',
        'ops-health',
        'ops-gates',
        'ops-center',
        'workspace-settings',
        'workspace-audit',
        'workspace-authenticator',
        'workspace-controls',
      ],
    });
  });
});

describe('S-03 nothing role-limited and no owner link while the role is unknown', () => {
  test('only what every role may open is listed, and Outcomes is hidden', async () => {
    const html = await render(null);
    for (const word of [
      'missions',
      'meetings',
      'commercial',
      'research',
      'sources',
      'evidence',
      'delivery',
      'authenticator',
    ])
      expect(link(html, word), word).toBe(true);
    for (const word of [
      'assistance',
      'network',
      'dashboard',
      'operations',
      'health',
      'readiness',
      'control-center',
      'settings',
      'audit',
      'controls',
    ])
      expect(link(html, word), word).toBe(false);
    expect(html).not.toContain('/operator/owner');
    expect(html).not.toContain('>Outcomes<');
  });
});

describe('a group with no visible section for the role is not rendered', () => {
  test('a viewer has no Outcomes group; an operator has it', async () => {
    expect(await render('viewer')).not.toContain('>Outcomes<');
    expect(link(await render('operator'), 'dashboard')).toBe(true);
  });
  test('a group with one visible section is a plain link, and the tools group is always a list', async () => {
    const viewer = await render('viewer');
    expect(viewer).toContain('<a href="/operator/delivery"');
    expect(viewer).toContain('>All tools and settings<');
    expect(viewer).toContain('<summary');
    expect(link(viewer, 'authenticator')).toBe(true);
  });
});

describe('S-04 every address and hash opens its section, with its group open', () => {
  for (const [id, slug] of Object.entries(operatorSlugs)) {
    test(`/operator/${slug} (${id}) opens its group and marks its link current`, async () => {
      const group = currentTeamItem(currentTeamSection('/operator/' + slug, '', sectionForSlug));
      expect(teamNavigation.find((g) => g.key === group)?.sections).toContain(id);
      expect(currentTeamItem(currentTeamSection('/operator', '#' + id, sectionForSlug))).toBe(
        group,
      );
      const role = workspaceSections.find((s) => s.id === id)!.roles[0];
      const html = await render(role, '/operator/' + slug);
      expect(html).toMatch(
        new RegExp(
          '<a [^>]*aria-current="page"[^>]*href="/operator/' +
            slug +
            '"|<a href="/operator/' +
            slug +
            '"[^>]*aria-current="page"',
        ),
      );
      // The group holding the page is the only one open; Outcomes has one section, so it is a link.
      const open = html.match(/<details[^>]*open=""[^>]*>/g) ?? [];
      expect(open.length, 'open groups').toBe(group === 'outcomes' ? 0 : 1);
    });
  }
  test('the owner page and a mission address open the right group', async () => {
    expect(await render('owner', '/operator/owner')).toMatch(/<details[^>]*open=""/);
    expect(currentTeamItem(currentTeamSection('/operator/missions/abc', '', sectionForSlug))).toBe(
      'missions',
    );
  });
  test('every role keeps every one of its sections reachable from the rendered list', async () => {
    for (const role of roles) {
      const html = await render(role);
      for (const section of workspaceSections.filter((s) =>
        (s.roles as readonly string[]).includes(role),
      ))
        expect(
          link(html, operatorSlugs[section.id]) ||
            (section.id === 'workspace-delivery' && link(html, 'delivery')),
          role + ' ' + section.id,
        ).toBe(true);
    }
  });
});

describe('language: words with no text in the chosen language are marked English', () => {
  test('Delivery, Outcomes and All tools and settings carry lang="en"; translated words do not', async () => {
    const html = await render('owner', '/operator', 'bn');
    for (const word of ['Delivery', 'Outcomes', 'All tools and settings'])
      expect(html, word).toContain('<span lang="en">' + word + '</span>');
    expect(html).toContain(translate('bn', 'wse.team.today'));
    expect(html).not.toContain('<span lang="en">' + translate('bn', 'wse.team.today'));
  });
  test('in English nothing is marked', async () => {
    expect(await render('owner')).not.toContain('lang="en"');
  });
});
