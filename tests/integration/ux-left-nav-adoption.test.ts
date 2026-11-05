import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { wsE, wsEEn } from '../../apps/web/lib/i18n/ws/ws-e';
import { contributorTasksHref } from '../../apps/web/lib/ux/contributor-nav';

// Team and contributor adoption of the shared left navigation (L-01 reference: tests/ux/left-nav.spec.ts).
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('left navigation adoption', () => {
  it('the team frame holds the Signal Desk sidebar in the shared frame and keeps its names', () => {
    const source = read('apps/web/components/ux/team-frame.tsx');
    expect(source).toContain('<LeftNavFrame');
    expect(source).toContain('navId="workspace-navigation"');
    expect(source).toContain("t('wse.team.nav')");
    expect(source).toContain("t('wse.shell.menu')");
    expect(source).toContain('<TeamSidebar');
    expect(source).toContain('<StepUpDialog');
    expect(source).toContain("'#workspace-navigation'");
    expect(source).not.toContain('ux-team-toggle');
    expect(source).not.toContain('ux-team-frame');
  });

  it('the team sidebar keeps its id, name and nav element', () => {
    const source = read('apps/web/components/ux/team-sidebar.tsx');
    expect(source).toContain('id="workspace-navigation"');
    expect(source).toContain("aria-label={t('wse.team.nav')}");
  });

  it('the contributor layout is behind the shells switch and adds nothing when it is off', () => {
    const source = read('apps/web/app/contributor/layout.tsx');
    expect(source).toContain("uxSwitchOn('CORRIDRA_UX_SHELLS_V2')");
    expect(source).toMatch(/if \(!uxSwitchOn\('CORRIDRA_UX_SHELLS_V2'\)\) return children;/);
    expect(source).toContain('<ContributorFrame>');
  });

  it('the contributor frame lists Your tasks and How assigned work works, with no auth code', () => {
    const source = read('apps/web/components/ux/contributor-frame.tsx');
    expect(source).toContain('href: tasksHref');
    expect(source).toContain("from '../../lib/ux/contributor-nav'");
    expect(source).toContain("href: '/network'");
    expect(source).toContain("t('wse.shell.contributor')");
    expect(source).toContain("word('wse.contributor.how')");
    expect(source).toContain('navId="contributor-navigation"');
    for (const forbidden of ['signOut', 'sign-out', 'signout', 'fetch(', 'cookie', 'getSession'])
      expect(source).not.toContain(forbidden);
  });

  it('Your tasks keeps the workspace of the task board that is open', () => {
    const id = '3f0c9b5e-6a41-4c52-9d0e-7a1b2c3d4e5f';
    expect(contributorTasksHref(id)).toBe(`/contributor?workspace=${id}`);
    expect(contributorTasksHref(id.toUpperCase())).toBe(
      `/contributor?workspace=${id.toUpperCase()}`,
    );
    // Anything that is not an id is dropped, so nothing else can be carried into the link.
    for (const value of [null, undefined, '', 'not-an-id', `${id}&x=1`, `${id}/../`, '<script>'])
      expect(contributorTasksHref(value)).toBe('/contributor');
    const source = read('apps/web/components/ux/contributor-frame.tsx');
    expect(source).toContain('useSearchParams');
    expect(source).toContain('contributorTasksHref(');
    // The address read sits in a Suspense boundary so static pages still build.
    expect(source).toContain('<Suspense');
  });

  it('the old team frame styles are gone and the item styles stay', () => {
    const css = read('apps/web/components/ux/shells.css');
    for (const old of ['.ux-team-frame', '.ux-team-rail', '.ux-team-toggle', '.ux-team-page'])
      expect(css).not.toContain(old);
    expect(css).toContain('.ux-team-sidebar a');
    expect(css).toContain('.ux-team-group');
  });

  it('the five new menu words exist in every language as English placeholders', () => {
    const keys = [
      'wse.shell.closeMenu',
      'wse.shell.collapseMenu',
      'wse.shell.expandMenu',
      'wse.contributor.nav',
      'wse.contributor.how',
    ] as const;
    for (const key of keys) {
      expect(wsEEn[key]).toBeTruthy();
      for (const locale of Object.keys(wsE) as (keyof typeof wsE)[])
        expect(wsE[locale][key], `${locale} ${key}`).toBe(wsEEn[key]);
    }
  });
});
