import { describe, expect, test } from 'vitest';
import {
  customerNavigation,
  customerTabs,
  type CustomerNavigationInput,
} from '../../apps/web/lib/ux/customer-navigation';
import { customerSearchPages, pagesFor } from '../../apps/web/lib/ux/customer-search-pages';

// P3 (docs/revamp/specs/navigation-v1/customer-search.md, section 7): the Pages scope lists only what the shell already
// offers this person. It is built from the same model as the tabs and the menus, so it can only be narrower.
const workspace = { id: '11111111-1111-4111-8111-111111111111', name: 'Acme' };
const everything: CustomerNavigationInput = {
  companies: true,
  move: false,
  billing: true,
  notificationSettings: true,
  organisationProfiles: true,
  problemReports: true,
  workspaces: [workspace],
  currentWorkspaceId: workspace.id,
};
const narrowest: CustomerNavigationInput = {
  companies: false,
  move: false,
  billing: false,
  notificationSettings: false,
  organisationProfiles: false,
  workspaces: [],
};
const labels = (input: CustomerNavigationInput) => customerSearchPages(input).map((p) => p.label);

describe('P3 the pages are the shell pages and nothing more', () => {
  test('every address is one the navigation model says the person can reach', () => {
    for (const input of [everything, narrowest, { ...everything, companies: false, move: true }]) {
      const reachable = new Set(customerNavigation(input).reachable);
      for (const page of customerSearchPages(input)) expect(reachable.has(page.href)).toBe(true);
    }
  });
  test('with every module on the pages are the tabs, New Request, workspaces, account and help links', () => {
    expect(labels(everything)).toEqual([
      'Home',
      'Requests',
      'Companies',
      'Meetings',
      'Reports',
      'New Request',
      'Manage Workspaces',
      'Account',
      'Company Profile',
      'Plan and Billing',
      'Notification Settings',
      'See How It Works',
      'How We Label Facts',
      'Report a Problem',
      'Corridra Website',
      'Privacy Notice',
    ]);
  });
  test('Companies is absent when its module is off, and there are four tabs', () => {
    const off = customerSearchPages({ ...everything, companies: false });
    expect(off.map((p) => p.label)).not.toContain('Companies');
    expect(off.filter((p) => p.tab)).toHaveLength(4);
    expect(customerSearchPages(everything).filter((p) => p.tab)).toHaveLength(5);
  });
  test('a Coming soon row is never a page', () => {
    const pages = labels(narrowest);
    for (const soon of [
      'Company Profile',
      'Plan and Billing',
      'Notification Settings',
      'Report a Problem',
    ])
      expect(pages).not.toContain(soon);
    expect(pages).not.toContain('Manage Workspaces');
    expect(pages).not.toContain('Chat on WhatsApp');
  });
  test('Sign Out and the reading choices are not pages', () => {
    const pages = labels(everything);
    for (const word of [
      'Sign Out',
      'Listen to This Page',
      'Text Size',
      'Stronger Colours',
      'Less Movement',
    ])
      expect(pages).not.toContain(word);
  });
  test('each page appears once and the tab list is not changed', () => {
    const pages = customerSearchPages(everything);
    expect(new Set(pages.map((p) => p.key)).size).toBe(pages.length);
    expect(customerTabs(everything).map((t) => t.label)).toEqual([
      'Home',
      'Requests',
      'Companies',
      'Meetings',
      'Reports',
    ]);
  });
  test('Home follows the move switch and New Request follows the workspace', () => {
    expect(customerSearchPages({ ...narrowest, move: true })[0]!.href).toBe('/account/move');
    expect(customerSearchPages(narrowest).find((p) => p.label === 'New Request')!.href).toBe(
      '/plan',
    );
    expect(customerSearchPages(everything).find((p) => p.label === 'New Request')!.href).toBe(
      '/account?view=work#customer-workspaces',
    );
  });
  test('the Report a Problem form carries the page the person is on', () => {
    const page = customerSearchPages(everything, '/account/companies').find(
      (p) => p.label === 'Report a Problem',
    )!;
    expect(page.href).toBe('/account/problem-reports/new?from=%2Faccount%2Fcompanies');
  });
});

describe('P3 finding pages', () => {
  const pages = customerSearchPages(everything);
  test.each([
    ['billing', 'Plan and Billing'],
    ['profile', 'Company Profile'],
    ['new', 'New Request'],
    ['help', 'See How It Works'],
  ])('"%s" finds %s', (word, label) => {
    expect(pagesFor(pages, 'all', word).map((p) => p.label)).toContain(label);
  });
  test('nothing typed lists the tabs and New Request under All', () => {
    expect(pagesFor(pages, 'all', '').map((p) => p.label)).toEqual([
      'Home',
      'Requests',
      'Companies',
      'Meetings',
      'Reports',
      'New Request',
    ]);
  });
  test('nothing typed lists every page under Pages and only the own tab under Requests or Companies', () => {
    expect(pagesFor(pages, 'pages', '')).toHaveLength(pages.length);
    expect(pagesFor(pages, 'requests', '').map((p) => p.label)).toEqual(['Requests']);
    expect(pagesFor(pages, 'companies', '').map((p) => p.label)).toEqual(['Companies']);
  });
  test('a one-letter or symbol-only query counts as nothing typed', () => {
    expect(pagesFor(pages, 'all', '!!')).toHaveLength(6);
  });
  test('the best match comes first and a typo is marked close', () => {
    const found = pagesFor(pages, 'pages', 'notification');
    expect(found[0]!.label).toBe('Notification Settings');
    expect(found[0]!.close).toBe(false);
    const typo = pagesFor(pages, 'pages', 'notifcation');
    expect(typo[0]!.label).toBe('Notification Settings');
    expect(typo[0]!.close).toBe(true);
  });
  test('five under All and ten for one scope', () => {
    expect(pagesFor(pages, 'all', 'a').length).toBeLessThanOrEqual(5);
    expect(pagesFor(pages, 'all', 'e')).toHaveLength(5);
    expect(pagesFor(pages, 'pages', 'e').length).toBeLessThanOrEqual(10);
    expect(pagesFor(pages, 'pages', 'e').length).toBeGreaterThan(5);
  });
  test('words that match nothing find nothing', () => {
    expect(pagesFor(pages, 'all', 'zebra')).toEqual([]);
  });
});
