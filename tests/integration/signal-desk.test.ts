import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { translate } from '../../apps/web/lib/i18n/messages';
import { operatorSlugs, sectionForSlug } from '../../apps/web/lib/operator-urls';
import { workspaceSections } from '../../apps/web/lib/workspace-navigation';
import { currentTeamSection } from '../../apps/web/lib/ux/shells';
import { itemForPlace, type TeamPlaceId } from '../../apps/web/lib/ux/team-map';

// Team navigation as rendered (Navigation v1, docs/revamp/specs/navigation-v1.md; it replaced the
// Signal Desk map S-01 to S-04). The map and its rules are in team-navigation-map.test.ts; this file
// renders the sidebar and the second level and walks the links the way a person would. S-05 (widths,
// targets, accessibility) runs in the browser, tests/e2e/verification/ws-e/team-shell.spec.ts.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
let pathname = '/operator';

const sidebarPath = '../../apps/web/components/ux/team-sidebar';
const secondPath = '../../apps/web/components/ux/team-second-level';
const render = async (role: string | null, at = '/operator', locale = 'en', ownerPage = true) => {
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
  const { TeamSecondLevel } = await import(/* @vite-ignore */ secondPath);
  return {
    sidebar: renderToStaticMarkup(createElement(TeamSidebar, { urls: true, ownerPage })),
    second: renderToStaticMarkup(createElement(TeamSecondLevel, { urls: true, ownerPage })),
  };
};
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'];

describe('NAV-04 the sidebar holds the five daily items, and Admin only for owner and admin', () => {
  test('the words in order, and Admin lists its five', async () => {
    const { sidebar } = await render('owner');
    const words = [...sidebar.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(words).toEqual([
      'Today',
      'Missions',
      'Companies',
      'Meetings',
      'Money',
      'Admin',
      'Health',
      'Readiness',
      'Audit',
      'People and access',
      'Settings',
      'Account',
      'Authenticator',
    ]);
  });
  test('no other role sees Admin or its pages; an operator keeps the daily items and Account', async () => {
    for (const role of ['operator', 'reviewer', 'viewer', null]) {
      const { sidebar } = await render(role);
      expect(sidebar, String(role)).not.toContain('Admin');
      // Account is the only group: Authenticator for everyone, Health and Readiness for an operator.
      expect(sidebar.match(/<details/g)?.length).toBe(1);
      expect(hrefs(sidebar)).not.toContain('/operator/audit');
    }
    expect((await render('admin')).sidebar).toContain('Admin');
  });
});

describe('NAV-05 every address and hash marks its place current, in an item that holds it', () => {
  for (const [id, slug] of Object.entries(operatorSlugs)) {
    test(`/operator/${slug} (${id})`, async () => {
      const role = workspaceSections.find((s) => s.id === id)!.roles[0];
      const item = itemForPlace(id as TeamPlaceId, role);
      const { sidebar, second } = await render(role, '/operator/' + slug);
      // The place is current in the sidebar (its item's first place or Admin) or in the second level.
      const current = [sidebar, second].some((html) =>
        new RegExp(
          '<a [^>]*aria-current="page"[^>]*href="/operator/' +
            slug +
            '"|<a href="/operator/' +
            slug +
            '"[^>]*aria-current="page"',
        ).test(html),
      );
      expect(current, `${slug} current`).toBe(true);
      // A hash link names the same item.
      expect(
        itemForPlace(
          currentTeamSection('/operator', '#' + id, sectionForSlug) as TeamPlaceId,
          role,
        ),
      ).toBe(item);
    });
  }
  test('a mission address belongs to Missions, and the owner page to Admin', async () => {
    expect(
      itemForPlace(
        currentTeamSection('/operator/missions/abc', '', sectionForSlug) as TeamPlaceId,
        'operator',
      ),
    ).toBe('missions');
    const { sidebar } = await render('owner', '/operator/owner');
    expect(sidebar).toMatch(/<details[^>]*open=""/);
  });
});

describe('NAV-06 every role reaches every one of its sections by following links', () => {
  // Start at Today and follow every link that is an operator page, the way a person clicks.
  async function walk(role: string) {
    const seen = new Set<string>();
    const queue = ['/operator'];
    while (queue.length) {
      const at = queue.shift()!;
      if (seen.has(at)) continue;
      seen.add(at);
      const { sidebar, second } = await render(role, at);
      for (const href of hrefs(sidebar + second))
        if (href.startsWith('/operator') && !seen.has(href)) queue.push(href);
    }
    return seen;
  }
  for (const role of roles)
    test(role, async () => {
      const seen = await walk(role);
      for (const section of workspaceSections.filter((s) =>
        (s.roles as readonly string[]).includes(role),
      ))
        expect(seen.has('/operator/' + operatorSlugs[section.id]), `${role} ${section.id}`).toBe(
          true,
        );
      expect(seen.has('/operator/owner')).toBe(role === 'owner' || role === 'admin');
    });
});

describe('language: words with no text in the chosen language are marked English', () => {
  test('Money, Admin and the places carry lang="en"; translated words do not', async () => {
    const { sidebar } = await render('owner', '/operator', 'bn');
    for (const word of ['Money', 'Admin'])
      expect(sidebar, word).toContain('<span lang="en">' + word + '</span>');
    expect(sidebar).toContain(translate('bn', 'wse.team.today'));
    expect(sidebar).not.toContain('<span lang="en">' + translate('bn', 'wse.team.today'));
  });
  test('in English nothing is marked', async () => {
    const { sidebar, second } = await render('owner');
    expect(sidebar + second).not.toContain('lang="en"');
  });
});
