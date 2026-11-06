import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  customerAvatarItems,
  customerHelpGroups,
  customerNavigation,
  customerTabs,
  type MenuEntry,
} from '../../apps/web/lib/ux/customer-navigation';

// Navigation v1 (docs/revamp/specs/navigation-v1.md), the customer shell. One model feeds the sidebar, the phone
// tabs and the menus. Binding conditions tested here: nothing is lost (every destination the old customer menus
// reached is still reachable), five at most per level, and no fake control (a feature that is not real yet is plain
// text tagged Coming soon, never a link).
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const workspace = '0f8fad5b-d9cb-469f-a165-70867728950e';
const all = {
  companies: true,
  move: true,
  billing: true,
  notificationSettings: true,
  workspaces: [
    { id: workspace, name: 'Aurora Textiles' },
    { id: '1f8fad5b-d9cb-469f-a165-70867728950e', name: 'Second Mill' },
  ],
  currentWorkspaceId: workspace,
};

// Every destination the customer menus reached before this change (left bar, workspace card, account menu, the
// rail's Help sheet and the header's New Request), as the old code wrote the address.
const oldDestinations = [
  '/account/move', // Home with Your Move on
  '/account?view=work', // Requests
  '/account/companies', // Companies (module on)
  '/account?view=results', // Reports
  '/account?view=more', // Account
  '/account?view=work#customer-workspaces', // Manage Workspaces and New Request
  `/account/profile/${workspace}`, // the workspace card, one workspace
  '/', // Corridra Website
  '/privacy', // Privacy Notice
  '/how-it-works', // Help: See How It Works
];

const hrefs = (entries: readonly MenuEntry[]) =>
  entries.flatMap((entry) => (entry.kind === 'link' ? [entry.href] : []));

describe('the customer navigation model', () => {
  it('the tabs are exactly Home, Requests, Companies, Meetings, Reports, in that order', () => {
    expect(customerTabs({ companies: true, move: true }).map((tab) => tab.label)).toEqual([
      'Home',
      'Requests',
      'Companies',
      'Meetings',
      'Reports',
    ]);
  });

  it('Companies appears only where the approved-companies module is on, and Home follows Your Move', () => {
    const off = customerTabs({ companies: false, move: false });
    expect(off.map((tab) => tab.label)).toEqual(['Home', 'Requests', 'Meetings', 'Reports']);
    expect(off[0]!.href).toBe('/account');
    expect(customerTabs({ companies: true, move: true })[0]!.href).toBe('/account/move');
  });

  it('every old destination is still reachable from the new navigation', () => {
    const model = customerNavigation(all);
    const reachable = new Set(model.reachable);
    for (const old of oldDestinations)
      expect(reachable.has(old), `${old} is no longer reachable`).toBe(true);
  });

  it('the Account page still links to All tools, and the All tools route and list stay', () => {
    expect(read('apps/web/app/account/page.tsx')).toContain('/account/all-tools');
    expect(read('apps/web/app/account/all-tools/page.tsx').length).toBeGreaterThan(0);
  });

  it('holds five items at most at every level', () => {
    const model = customerNavigation(all);
    expect(model.tabs.length).toBeLessThanOrEqual(5);
    expect(model.avatar.length).toBeLessThanOrEqual(5);
    for (const group of model.help) expect(group.items.length).toBeLessThanOrEqual(5);
    expect(model.help.length).toBeLessThanOrEqual(5);
  });

  it('the avatar menu is Account, Company profile, Plan and billing, Notification settings, Sign out', () => {
    const items = customerAvatarItems(all);
    expect(items.map((entry) => entry.label)).toEqual([
      'Account',
      'Company Profile',
      'Plan and Billing',
      'Notification Settings',
      'Sign Out',
    ]);
    expect(hrefs(items)).toEqual([
      '/account?view=more',
      `/account/profile/${workspace}`,
      '/account/billing',
      '/account/notifications',
    ]);
  });

  it('Plan and Billing is a link only when billing is on, otherwise plain text tagged Coming soon', () => {
    const off = customerAvatarItems({ ...all, billing: false });
    const entry = off.find((item) => item.label === 'Plan and Billing')!;
    expect(entry.kind).toBe('soon');
    expect(hrefs(off)).not.toContain('/account/billing');
  });

  it('Notification Settings is a link only where its page exists, otherwise plain text tagged Coming soon', () => {
    const off = customerAvatarItems({ ...all, notificationSettings: false });
    const entry = off.find((item) => item.label === 'Notification Settings')!;
    expect(entry.kind).toBe('soon');
    expect(hrefs(off)).not.toContain('/account/notifications');
    expect(hrefs(customerAvatarItems(all))).toContain('/account/notifications');
  });

  it('the four named tabs carry the message key the sidebar always used, and Meetings, a new word, has none', () => {
    const tabs = customerTabs({ companies: true, move: false });
    const keys = Object.fromEntries(tabs.map((tab) => [tab.key, tab.labelKey]));
    expect(keys).toEqual({
      home: 'wse.nav.home',
      requests: 'wse.nav.work',
      companies: 'wse.nav.companies',
      meetings: undefined,
      reports: 'wse.nav.results',
    });
  });

  it('Company Profile follows the chosen workspace, and is Coming soon with no workspace', () => {
    const second = '1f8fad5b-d9cb-469f-a165-70867728950e';
    const other = customerAvatarItems({ ...all, currentWorkspaceId: second });
    expect(hrefs(other)).toContain(`/account/profile/${second}`);
    const none = customerAvatarItems({ ...all, workspaces: [], currentWorkspaceId: undefined });
    expect(none.find((item) => item.label === 'Company Profile')!.kind).toBe('soon');
  });

  it('the help menu is honest: only real things are links, the rest is Coming soon', () => {
    const help = customerHelpGroups();
    const flat = help.flatMap((group) => group.items);
    const link = (label: string) => flat.find((item) => item.label === label)!;
    expect(link('See How It Works')).toMatchObject({ kind: 'link', href: '/how-it-works' });
    expect(link('How We Label Facts')).toMatchObject({ kind: 'link', href: '/trust' });
    expect(link('Corridra Website')).toMatchObject({ kind: 'link', href: '/' });
    expect(link('Privacy Notice')).toMatchObject({ kind: 'link', href: '/privacy' });
    expect(link('Listen to This Page').kind).toBe('listen');
    // There is no owner-configured WhatsApp number, so it says Coming soon and is not a link.
    for (const label of [
      'Chat on WhatsApp',
      'Report a Problem',
      'Text Size',
      'Stronger Colours',
      'Less Movement',
    ])
      expect(link(label).kind, label).toBe('soon');
    expect(flat.some((item) => item.kind === 'link' && /wa\.me|whatsapp/i.test(item.href))).toBe(
      false,
    );
  });

  it('customers say Request, never Mission, and every label is Title Case', () => {
    const model = customerNavigation(all);
    const labels = [
      ...model.tabs.map((tab) => tab.label),
      ...model.avatar.map((entry) => entry.label),
      ...model.help.flatMap((group) => [group.label, ...group.items.map((item) => item.label)]),
    ];
    for (const label of labels) {
      expect(label).not.toMatch(/mission/i);
      for (const word of label.split(' ').filter((w) => w.length > 3))
        expect(word[0], `${label}: ${word}`).toBe(word[0]!.toUpperCase());
    }
  });
});

describe('the Meetings page', () => {
  const page = readFileSync(
    new URL('../../apps/web/app/account/meetings/page.tsx', import.meta.url),
    'utf8',
  );
  it('answers 404 unless the shells switch is on, like the navigation that leads to it', () => {
    expect(page).toContain("uxSwitchOn('CORRIDRA_UX_SHELLS_V2')");
    expect(page).toMatch(/!uxSwitchOn\('CORRIDRA_UX_SHELLS_V2'\)\) notFound\(\)/);
  });
  it('says the list is not available, not that there are no requests, where it could not read any', () => {
    expect(page).toContain('customerWorkspacesEnabled()');
    expect(page).toContain('customerRequestsEnabled()');
    expect(page).toContain('Your requests list is not available here yet');
  });
});
