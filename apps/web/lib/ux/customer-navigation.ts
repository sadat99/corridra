// The customer navigation as data (docs/revamp/specs/navigation-v1.md, boards CustomerDesktop, CustomerMobile and
// UtilityMenus). One model feeds the sidebar, the phone tabs and the avatar, language and help menus, so they can
// never list different things. It decides nothing about access: every page and action still checks on the server,
// and an item the person cannot open is simply not given to this model by the shell.
//
// Honest features: anything that is not real in this repository yet is an entry of kind "soon", which the menus
// draw as plain text with a "Coming soon" tag, never a link or a button that does nothing.

export type CustomerTabKey = 'home' | 'requests' | 'companies' | 'meetings' | 'reports';
export type CustomerTab = { key: CustomerTabKey; label: string; href: string; icon: string };

/** One row of a menu: a link, the Listen action, plain text tagged Coming soon, or the Sign Out action. */
export type MenuEntry =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'soon'; label: string }
  | { kind: 'listen'; label: string }
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
  workspaces: readonly CustomerWorkspace[];
  /** The workspace the page belongs to, or the only workspace; it picks whose profile Company Profile opens. */
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
    { key: 'home', label: 'Home', href: move ? '/account/move' : '/account', icon: 'home' },
    { key: 'requests', label: 'Requests', href: '/account?view=work', icon: 'work' },
    ...(companies
      ? [
          {
            key: 'companies' as const,
            label: 'Companies',
            href: '/account/companies',
            icon: 'company',
          },
        ]
      : []),
    { key: 'meetings', label: 'Meetings', href: '/account/meetings', icon: 'calendar' },
    { key: 'reports', label: 'Reports', href: '/account?view=results', icon: 'library' },
  ];
}

/** The avatar menu: identity first (drawn by the menu), then these five. Nothing here is a fake control. */
export function customerAvatarItems(
  input: Pick<CustomerNavigationInput, 'billing' | 'workspaces' | 'currentWorkspaceId'>,
): MenuEntry[] {
  const profile =
    input.workspaces.find((w) => w.id === input.currentWorkspaceId) ??
    (input.workspaces.length === 1 ? input.workspaces[0] : undefined);
  return [
    { kind: 'link', label: 'Account', href: '/account?view=more' },
    profile
      ? { kind: 'link', label: 'Company Profile', href: `/account/profile/${profile.id}` }
      : { kind: 'soon', label: 'Company Profile' },
    input.billing
      ? { kind: 'link', label: 'Plan and Billing', href: '/account/billing' }
      : { kind: 'soon', label: 'Plan and Billing' },
    { kind: 'link', label: 'Notification Settings', href: '/account/notifications' },
    { kind: 'signout', label: 'Sign Out' },
  ];
}

/**
 * The help and accessibility menu. Chat on WhatsApp needs a number the owner configures, and none exists, so it is
 * Coming soon; so are Report a Problem, Text Size, Stronger Colours and Less Movement. Listen to This Page is real
 * (the same speech the corner Help sheet offers), and the About group keeps the website and privacy notice the old
 * account menu held.
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
        { kind: 'soon', label: 'Text Size' },
        { kind: 'soon', label: 'Stronger Colours' },
        { kind: 'soon', label: 'Less Movement' },
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
    ...input.workspaces.map((w) => `/account/profile/${w.id}`),
  ]);
  for (const entry of [...avatar, ...help.flatMap((group) => group.items)])
    if (entry.kind === 'link') reachable.add(entry.href);
  return { tabs, avatar, help, reachable: [...reachable] };
}
