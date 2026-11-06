import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// CX PR 3c, the Account page (docs/revamp/specs/customer-experience.md): a settings layout with sub-tabs Profile,
// Workspaces and Team, Notifications, Plan and Billing, and Security. The tools and entry points move to All tools.
// Case ids: CX-01 (page length), CX-02 (action parity: nothing is lost) and CX-04 (tabs keep ?tab=).
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
vi.doMock(web.resolve('next/navigation'), () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams('view=more'),
}));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const read = (path: string) => readFileSync(resolve(path), 'utf8');

const panels = (extra: Record<string, unknown> = {}) => ({
  profile: createElement('h2', null, 'Ada Lovelace'),
  workspaces: createElement('a', { href: '/account/profile' }, 'Company profiles and links'),
  notifications: createElement('a', { href: '/account/notifications' }, 'Choose what we email you'),
  billing: createElement('a', { href: '/account/billing' }, 'Plan and billing'),
  security: createElement('button', null, 'Sign Out'),
  ...extra,
});

describe('CX-04 the Account settings tabs', () => {
  it('shows the five tabs in the locked order, the first chosen, every panel in the page', async () => {
    const { AccountSettings } = await load('app/account/account-settings');
    const html = render(createElement(AccountSettings, panels()));
    const names = [...html.matchAll(/role="tab"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(names).toEqual([
      'Profile',
      'Workspaces and Team',
      'Notifications',
      'Plan and Billing',
      'Security',
    ]);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(5);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Profile</);
  });

  it('leaves out a tab whose area is off, and keeps every link it is given', async () => {
    const { AccountSettings } = await load('app/account/account-settings');
    const html = render(
      createElement(AccountSettings, panels({ billing: undefined, notifications: undefined })),
    );
    expect(html).not.toContain('>Plan and Billing<');
    expect(html).not.toContain('>Notifications<');
    expect(html).toContain('href="/account/profile"');
  });
});

describe('CX-02 the tools and entry points moved to All tools; nothing is lost', () => {
  const page = read('apps/web/app/account/page.tsx');
  const more = page.slice(page.indexOf("{view === 'more' && ("));
  it('the Account view no longer repeats the tools and entry points while All tools exists', () => {
    // With the new navigation off there is no All tools page, so those entry points stay on Account (WaysIn).
    expect(more).toContain("{uxSwitchOn('CORRIDRA_UX_NAV') ? (");
    expect(more).toContain('<WaysIn />');
    const ways = page.slice(page.indexOf('function WaysIn()'));
    for (const href of [
      '/plan"',
      '/plan#receipt-check',
      '/operator/setup',
      '/workspace"',
      '/contributor"',
    ])
      expect(ways, href).toContain(`href="${href.replace(/"$/, '')}"`);
    const shown = more.slice(0, more.indexOf('function WaysIn()'));
    for (const gone of [
      'Start something',
      'Other ways in',
      'Check a request receipt',
      'Local helper tasks',
      'Start page',
      'Accept a team invitation',
    ])
      expect(shown, gone).not.toContain(gone);
  });
  it('All tools lists the two entry points the Account page used to hold', async () => {
    const { tools } = await load('lib/all-tools');
    const byLabel = new Map(
      (tools as { label: string; href: string }[]).map((t) => [t.label, t.href]),
    );
    expect(byLabel.get('Accept a team invitation')).toBe('/operator/setup');
    expect(byLabel.get('Open your local helper tasks')).toBe('/contributor');
  });
  it('Manage your work now lives on Account only, not on the Requests workspaces tab', () => {
    const work = page.slice(
      page.indexOf("{view === 'work' && ("),
      page.indexOf("{view === 'results' && ("),
    );
    expect(work).not.toContain('aria-label="Manage your work"');
    expect(work).toContain('Delegation registrations');
    expect(more).toContain('aria-label="Manage your work"');
  });
});
