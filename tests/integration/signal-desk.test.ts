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
const render = async (
  role: string | null,
  at = '/operator',
  locale = 'en',
  ownerPage = true,
  options: { urls?: boolean; hash?: string } = {},
) => {
  const urls = options.urls ?? true;
  pathname = at;
  vi.resetModules();
  // A static render reads the server snapshot; the address `#` part is read from the client snapshot, so a
  // store that returns a string (the hash) is answered from it and every other store from its server value.
  vi.stubGlobal('window', { location: { hash: options.hash ?? '' } });
  vi.doMock(web.resolve('react'), async (original) => {
    const react = await original<Record<string, unknown>>();
    return {
      ...react,
      useSyncExternalStore: (_subscribe: unknown, get: () => unknown, server: () => unknown) => {
        const value = get();
        return typeof value === 'string' ? value : server();
      },
    };
  });
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
  const markup = {
    sidebar: renderToStaticMarkup(createElement(TeamSidebar, { urls, ownerPage })),
    second: renderToStaticMarkup(createElement(TeamSecondLevel, { urls, ownerPage })),
  };
  vi.unstubAllGlobals();
  return markup;
};
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'];

describe('NAV-04 the sidebar holds the five daily items, and Admin only for owner and admin', () => {
  test('the words in order, and Admin lists its five', async () => {
    const { sidebar } = await render('owner');
    const words = [...sidebar.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(words).toEqual([
      'Search',
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

describe('NAV-05 every address and hash marks its place current, for every role that may open it', () => {
  const currentLink = (html: string, href: string) =>
    new RegExp(
      '<a [^>]*aria-current="page"[^>]*href="' +
        href +
        '"|<a href="' +
        href +
        '"[^>]*aria-current="page"',
    ).test(html);
  for (const [id, slug] of Object.entries(operatorSlugs)) {
    const allowed = roles.filter((role) =>
      (workspaceSections.find((s) => s.id === id)!.roles as readonly string[]).includes(role),
    );
    test(`/operator/${slug} (${id}) for ${allowed.join(', ')}`, async () => {
      for (const role of allowed) {
        const item = itemForPlace(id as TeamPlaceId, role);
        const { sidebar, second } = await render(role, '/operator/' + slug);
        // The place is the page's own link in the sidebar or the second level, and only that link says "page".
        expect(
          [sidebar, second].some((html) => currentLink(html, '/operator/' + slug)),
          `${role} ${slug} current`,
        ).toBe(true);
        // Every link marked "page" leads to the current page itself; a parent is "true", never "page".
        const marked = [...(sidebar + second).matchAll(/<a [^>]*>/g)]
          .map((m) => m[0])
          .filter((tag) => tag.includes('aria-current="page"'));
        expect(marked.length, `${role} ${slug} has a page link`).toBeGreaterThan(0);
        for (const tag of marked)
          expect(tag, `${role} ${slug}`).toContain('href="/operator/' + slug + '"');
        // A hash link names the same item.
        expect(
          itemForPlace(
            currentTeamSection('/operator', '#' + id, sectionForSlug) as TeamPlaceId,
            role,
          ),
        ).toBe(item);
        // With section addresses off the hash still wins and marks the same place.
        const hashed = await render(role, '/operator', 'en', true, { urls: false, hash: '#' + id });
        expect(
          [hashed.sidebar, hashed.second].some((html) => currentLink(html, '/operator#' + id)),
          `${role} #${id} current`,
        ).toBe(true);
      }
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
  test('a parent item says aria-current="true", the page itself says "page"', async () => {
    const { sidebar } = await render('owner', '/operator/operations');
    expect(sidebar).toMatch(/<a [^>]*title="Missions"[^>]*aria-current="true"/);
    expect(sidebar).not.toMatch(/<a [^>]*title="Missions"[^>]*aria-current="page"/);
    const own = await render('owner', '/operator/missions');
    expect(own.sidebar).toMatch(/<a [^>]*title="Missions"[^>]*aria-current="page"/);
  });
  test('every link and summary has a tooltip, in the words shown', async () => {
    const { sidebar } = await render('owner', '/operator', 'bn');
    const items = [...sidebar.matchAll(/<(a|summary)\b[^>]*>/g)].map((m) => m[0]);
    expect(items.length).toBeGreaterThan(0);
    for (const tag of items) expect(tag, tag).toMatch(/title="[^"]+"/);
    expect(sidebar).toContain('title="' + translate('bn', 'wse.team.today') + '"');
  });
});

describe('NAV-06 every role reaches every one of its sections by following links', () => {
  // Start at Today and follow every link that is an operator page, the way a person clicks. With section
  // addresses on the links are /operator/<word>; with them off they are /operator#<id>, and the `#` part
  // of the address is what the next page reads.
  const split = (href: string) => {
    const [base = '', fragment = ''] = href.split('#');
    return { path: base.split('?')[0]!, hash: fragment ? '#' + fragment : '' };
  };
  const idOf = (path: string, hash: string): string => {
    if (hash) return hash.slice(1);
    const word = path.split('/')[2];
    if (!word) return 'home';
    return word === 'owner' ? 'owner' : (sectionForSlug(word) ?? word);
  };
  async function walk(role: string | null, urls: boolean) {
    const seen = new Map<string, string>();
    const queue = ['/operator'];
    let all = '';
    while (queue.length) {
      const href = queue.shift()!;
      const { path, hash } = split(href);
      const key = path + hash;
      if (seen.has(key)) continue;
      seen.set(key, idOf(path, hash));
      const { sidebar, second } = await render(role, path, 'en', true, { urls, hash });
      all += sidebar + second;
      for (const next of hrefs(sidebar + second))
        if (next.startsWith('/operator')) queue.push(next);
    }
    return { ids: new Set(seen.values()), html: all };
  }
  for (const urls of [true, false])
    for (const role of roles)
      test(`${role}, section addresses ${urls ? 'on' : 'off'}`, async () => {
        const { ids } = await walk(role, urls);
        for (const section of workspaceSections.filter((s) =>
          (s.roles as readonly string[]).includes(role),
        ))
          expect(ids.has(section.id), `${role} ${section.id}`).toBe(true);
        expect(ids.has('owner')).toBe(role === 'owner' || role === 'admin');
      });

  test('while the role is unknown only what every role may open is reachable, with no Admin and no owner page', async () => {
    for (const urls of [true, false]) {
      const { ids, html } = await walk(null, urls);
      for (const id of [
        'workspace-missions',
        'workspace-meetings',
        'workspace-commercial',
        'workspace-research',
        'workspace-sources',
        'workspace-evidence',
        'workspace-delivery',
        'workspace-authenticator',
      ])
        expect(ids.has(id), String(urls) + ' ' + id).toBe(true);
      for (const id of [
        'workspace-ai',
        'workspace-network',
        'ops-dashboard',
        'workspace-operations',
        'ops-health',
        'ops-gates',
        'ops-center',
        'workspace-settings',
        'workspace-audit',
        'workspace-controls',
        'owner',
      ])
        expect(ids.has(id), String(urls) + ' not ' + id).toBe(false);
      expect(html).not.toContain('/operator/owner');
      expect(html).not.toContain('>Admin<');
      expect(html).not.toContain('>Outcomes<');
    }
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
