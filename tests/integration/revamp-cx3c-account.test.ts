import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// CX PR 3c, the Account page (docs/revamp/specs/customer-experience.md): a settings layout with sub-tabs Profile,
// Security, Privacy, Preferences and Workspaces (CI-U4). The tools and entry points move to All tools.
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
  profile: createElement('h3', null, 'Ada Lovelace'),
  security: createElement('button', null, 'Sign Out'),
  privacy: createElement('p', null, 'Data export is not available yet.'),
  preferences: createElement('a', { href: '/account/notifications' }, 'Choose what we email you'),
  workspaces: createElement('a', { href: '/account/profile' }, 'Company profiles and links'),
  ...extra,
});

describe('CX-04 the Account settings tabs', () => {
  it('shows the five groups in the locked order, the first chosen, every panel in the page', async () => {
    const { AccountSettings } = await load('app/account/account-settings');
    const html = render(createElement(AccountSettings, panels()));
    const names = [...html.matchAll(/role="tab"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(names).toEqual(['Profile', 'Security', 'Privacy', 'Preferences', 'Workspaces']);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(5);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Profile</);
  });

  it('maps the old tab names and the closure anchor to the new groups', async () => {
    const { accountTabKeys } = await load('app/account/account-settings');
    const { resolveSubTab } = await load('lib/ux/sub-tabs');
    const go = (search: string, hash = '') => resolveSubTab(accountTabKeys, search, hash);
    expect(accountTabKeys.map((t: { id: string }) => t.id)).toEqual([
      'profile',
      'security',
      'privacy',
      'preferences',
      'workspaces',
    ]);
    expect(go('?tab=notifications')).toBe('preferences');
    expect(go('?tab=billing')).toBe('workspaces');
    expect(go('?tab=team')).toBe('workspaces');
    expect(go('?tab=security')).toBe('security');
    expect(go('?tab=privacy')).toBe('privacy');
    expect(go('?tab=workspaces')).toBe('workspaces');
    expect(go('')).toBe('profile');
  });

  it('opens Privacy for #account-closure', async () => {
    const { AccountSettings } = await load('app/account/account-settings');
    const html = render(createElement(AccountSettings, panels()));
    expect(html).toMatch(/id="account-closure"[^>]*role="tabpanel"[^>]*data-subtab="privacy"/);
  });

  it('leaves out a group whose area is off, and keeps every link it is given', async () => {
    const { AccountSettings } = await load('app/account/account-settings');
    const html = render(createElement(AccountSettings, panels({ preferences: undefined })));
    expect(html).not.toContain('>Preferences<');
    expect(html).toContain('href="/account/profile"');
  });
});

describe('CX-04 the five groups in the Account page', () => {
  const page = read('apps/web/app/account/page.tsx');
  const more = page.slice(page.indexOf("{view === 'more' && ("));
  const group = (from: string, to: string) => more.slice(more.indexOf(from), more.indexOf(to));
  const security = group('security={', 'privacy={');
  const privacy = group('privacy={', 'preferences={');
  it('names each panel with its heading', () => {
    for (const h of [
      'Profile and Identity',
      'Sign-in and Security',
      'Privacy and Data',
      'Preferences and Notifications',
      'Workspaces and Billing',
    ])
      expect(more, h).toContain(`<h2>${h}</h2>`);
  });
  it('Privacy holds the closure block and says plainly that data export is not available yet', () => {
    expect(privacy).toContain('<AccountClosure subject');
    expect(privacy).toContain('<AccountClosureComingSoon />');
    expect(privacy).toContain('Data export is not available yet.');
    expect(privacy).toContain('href="/privacy#rights"');
    expect(privacy).toContain('Read the Privacy Notice');
    expect(security).not.toContain('AccountClosure');
  });
  it('Security offers only what exists: no MFA, passkey, session or change-email control', () => {
    expect(security).toContain('<AccountSignout />');
    expect(security).toContain('href="/forgot-password"');
    for (const word of [
      /\bMFA\b/i,
      /two-step|2FA/i,
      /passkey/i,
      /sessions?\b/i,
      /change (your )?email/i,
    ])
      expect(security).not.toMatch(word);
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
