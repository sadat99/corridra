// The customer navigation as data (docs/revamp/specs/navigation-v1.md, boards CustomerDesktop, CustomerMobile and
// UtilityMenus). One model feeds the sidebar, the phone tabs and the avatar, language and help menus, so they can
// never list different things. It decides nothing about access: every page and action still checks on the server,
// and an item the person cannot open is simply not given to this model by the shell.
//
// Honest features: anything that is not real in this repository yet is an entry of kind "soon", which the menus
// draw as plain text with a "Coming soon" tag, never a link or a button that does nothing.

import type { MessageKey } from '../i18n/messages';

export type CustomerTabKey = 'home' | 'requests' | 'companies' | 'meetings' | 'reports';
export type CustomerTab = {
  key: CustomerTabKey;
  label: string;
  href: string;
  icon: string;
  /**
   * The message key of the name the sidebar and tabs have always used, so the name follows the chosen language.
   * Absent for a word with no reviewed translation yet (Meetings): it is drawn as English and marked lang="en".
   */
  labelKey?: MessageKey;
};

/**
 * One row of a menu: a link, the Listen action, the Text Size choice, the Less Movement switch, plain text tagged
 * Coming soon, or the Sign Out action.
 */
export type MenuEntry =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'soon'; label: string }
  | { kind: 'listen'; label: string }
  | { kind: 'textsize'; label: string }
  | { kind: 'lessmovement'; label: string }
  | { kind: 'signout'; label: string };
export type HelpGroup = { label: string; items: MenuEntry[] };

export type CustomerWorkspace = { id: string; name: string };
export type CustomerNavigationInput = {
  /** True where the approved-companies module is on. */
  companies: boolean;
  /** `CORRIDRA_UX_MOVE`: Home is Your Move. */
  move: boolean;
  /** True where customer billing is on; otherwise Plan and Billing is Coming soon. */
  billing: boolean;
  /** True where the email choices page exists (its own switches); otherwise Notification Settings is Coming soon. */
  notificationSettings: boolean;
  /**
   * True where the organisation profiles module is on: Company Profile is then always a link (to the chosen
   * workspace's profile, or to the workspace chooser). Otherwise it is plain Coming soon.
   */
  organisationProfiles: boolean;
  workspaces: readonly CustomerWorkspace[];
  /**
   * The workspace the page belongs to, or the only workspace; it picks whose profile Company Profile opens. With
   * none, Company Profile opens the chooser.
   */
  currentWorkspaceId?: string;
};

/** Where New Request goes: a person with a workspace goes to where requests are made, otherwise to the plan page. */
export const newRequestHref = (hasWorkspace: boolean) =>
  hasWorkspace ? '/account?view=work#customer-workspaces' : '/plan';
export const manageWorkspacesHref = '/account?view=work#customer-workspaces';

/** The primary destinations in their fixed order. Companies appears only where its module is on. */
export function customerTabs({
  companies,
  move,
}: Pick<CustomerNavigationInput, 'companies' | 'move'>): CustomerTab[] {
  return [
    {
      key: 'home',
      label: 'Home',
      href: move ? '/account/move' : '/account',
      icon: 'home',
      labelKey: 'wse.nav.home',
    },
    {
      key: 'requests',
      label: 'Requests',
      href: '/account?view=work',
      icon: 'work',
      labelKey: 'wse.nav.work',
    },
    ...(companies
      ? [
          {
            key: 'companies' as const,
            label: 'Companies',
            href: '/account/companies',
            icon: 'company',
            labelKey: 'wse.nav.companies' as const,
          },
        ]
      : []),
    { key: 'meetings', label: 'Meetings', href: '/account/meetings', icon: 'calendar' },
    {
      key: 'reports',
      label: 'Reports',
      href: '/account?view=results',
      icon: 'library',
      labelKey: 'wse.nav.results',
    },
  ];
}

/** The avatar menu: identity first (drawn by the menu), then these five. Nothing here is a fake control. */
export function customerAvatarItems(
  input: Pick<
    CustomerNavigationInput,
    | 'billing'
    | 'notificationSettings'
    | 'organisationProfiles'
    | 'workspaces'
    | 'currentWorkspaceId'
  >,
): MenuEntry[] {
  // With its module off the profile page only says the profile is unavailable, so the entry is plain Coming soon.
  // With the module on it is always a link: to the chosen workspace's profile, or else to the chooser, which lists
  // the person's workspaces (or says there are none) and opens the only one directly.
  const profile =
    input.workspaces.find((w) => w.id === input.currentWorkspaceId) ??
    (input.workspaces.length === 1 ? input.workspaces[0] : undefined);
  return [
    { kind: 'link', label: 'Account', href: '/account?view=more' },
    input.organisationProfiles
      ? {
          kind: 'link',
          label: 'Company Profile',
          href: profile ? `/account/profile/${profile.id}` : '/account/profile',
        }
      : { kind: 'soon', label: 'Company Profile' },
    input.billing
      ? { kind: 'link', label: 'Plan and Billing', href: '/account/billing' }
      : { kind: 'soon', label: 'Plan and Billing' },
    input.notificationSettings
      ? { kind: 'link', label: 'Notification Settings', href: '/account/notifications' }
      : { kind: 'soon', label: 'Notification Settings' },
    { kind: 'signout', label: 'Sign Out' },
  ];
}

/**
 * The help and accessibility menu. Chat on WhatsApp needs a number the owner configures, and none exists, so it is
 * Coming soon; so are Report a Problem and Stronger Colours. Listen to This Page, Text Size and Less Movement are
 * real (the speech the corner Help sheet offers, and two choices kept in this browser only), and the About group
 * keeps the website and privacy notice the old account menu held.
 */
export function customerHelpGroups(): HelpGroup[] {
  return [
    {
      label: 'Get Help',
      items: [
        { kind: 'link', label: 'See How It Works', href: '/how-it-works' },
        { kind: 'soon', label: 'Chat on WhatsApp' },
        { kind: 'link', label: 'How We Label Facts', href: '/trust' },
        { kind: 'soon', label: 'Report a Problem' },
      ],
    },
    {
      label: 'Make It Easier to Read',
      items: [
        { kind: 'listen', label: 'Listen to This Page' },
        { kind: 'textsize', label: 'Text Size' },
        { kind: 'soon', label: 'Stronger Colours' },
        { kind: 'lessmovement', label: 'Less Movement' },
      ],
    },
    {
      label: 'About Corridra',
      items: [
        { kind: 'link', label: 'Corridra Website', href: '/' },
        { kind: 'link', label: 'Privacy Notice', href: '/privacy' },
      ],
    },
  ];
}

/** Everything in one place, with the set of addresses a person can reach from it (used by the reachability test). */
export function customerNavigation(input: CustomerNavigationInput) {
  const tabs = customerTabs(input);
  const avatar = customerAvatarItems(input);
  const help = customerHelpGroups();
  const reachable = new Set<string>([
    ...tabs.map((tab) => tab.href),
    newRequestHref(input.workspaces.length > 0),
    manageWorkspacesHref,
    // With the profiles module on, the chooser and each workspace's profile (the avatar's workspace rows).
    ...(input.organisationProfiles
      ? ['/account/profile', ...input.workspaces.map((w) => `/account/profile/${w.id}`)]
      : []),
  ]);
  for (const entry of [...avatar, ...help.flatMap((group) => group.items)])
    if (entry.kind === 'link') reachable.add(entry.href);
  return { tabs, avatar, help, reachable: [...reachable] };
}
