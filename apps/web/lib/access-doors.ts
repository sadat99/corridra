/**
 * The three doors into Corridra, in one place: who each door is for, where its page lives, and the words on
 * that page. The three pages under /access, the shared "Not what you need?" bar and the help-link lists that
 * sit under the sign-in forms all read from here, so a link or a role is named once.
 *
 * This is separate from `front-doors.ts` (the founder and helper cards), which is unchanged.
 * Words are English only for now and are not part of the translation catalogues.
 */
export type AccessDoorId = 'customer' | 'team' | 'link';

export type AccessRole = { id: string; label: string };

export type AccessDoor = {
  id: AccessDoorId;
  /** The name of the door: the page label, the metadata title and the link text in the other doors' bar. */
  title: string;
  /** One line about who the door is for. */
  line: string;
  /** The entry page of the door. */
  href: string;
  /** Every kind of person this door is for. A role appears under exactly one door. */
  roles: readonly AccessRole[];
};

export const accessDoors: readonly AccessDoor[] = [
  {
    id: 'customer',
    title: 'Customer Access',
    line: 'For business owners, teammates, organisers and participants.',
    href: '/access/customer',
    roles: [
      { id: 'owner', label: 'Business owner' },
      { id: 'teammate', label: 'Teammate (admin or member)' },
      { id: 'organiser', label: 'Organiser' },
      { id: 'participant', label: 'Participant' },
    ],
  },
  {
    id: 'team',
    title: 'Team and Network Access',
    line: 'For Corridra team members, reviewers, admins and invited field helpers.',
    href: '/access/team',
    roles: [
      { id: 'operator', label: 'Operator' },
      { id: 'reviewer', label: 'Reviewer' },
      { id: 'viewer', label: 'Viewer' },
      { id: 'admin', label: 'Admin' },
      { id: 'founder', label: 'Founder (staff)' },
      { id: 'helper', label: 'Helper (field contributor)' },
    ],
  },
  {
    id: 'link',
    title: 'Private Link Access',
    line: 'For buyers, suppliers, clients and institutions.',
    href: '/access/link',
    roles: [
      { id: 'buyer', label: 'Buyer' },
      { id: 'supplier', label: 'Supplier' },
      { id: 'client', label: 'Client' },
      { id: 'institution', label: 'Institution' },
    ],
  },
];

export function accessDoor(id: AccessDoorId): AccessDoor {
  const door = accessDoors.find((entry) => entry.id === id);
  if (!door) throw new Error(`Unknown access door: ${id}`);
  return door;
}

/** The two doors that are not `id`, in registry order: what the "Not what you need?" bar links to. */
export function otherAccessDoors(id: AccessDoorId): AccessDoor[] {
  return accessDoors.filter((entry) => entry.id !== id);
}

export type AccessAction = { text: string; href: string };

export type AccessIconName =
  'inbox' | 'trip' | 'calendar' | 'shield' | 'network' | 'people' | 'document';

/** Customer door: /access/customer. */
export const customerDoorPage = {
  eyebrow: 'CUSTOMER ACCESS',
  title: 'Open your workspace, or start one.',
  lead: 'For business owners, teammates, organisers and participants.',
  panels: {
    create: {
      heading: 'New to Corridra',
      text: 'Create an account to start and follow your requests.',
      primary: { text: 'Create Account', href: '/signup' } as AccessAction,
      textLink: { text: 'Start a Request Without an Account', href: '/plan' } as AccessAction,
    },
    signIn: {
      heading: 'Already have an account',
      text: 'Sign in with your email and password.',
      /** Shown instead of `text` (and without the button) when customer sign-in is not configured here. */
      unavailableText:
        'Customer sign-in is not available here yet. You can still start a request without an account.',
      secondary: { text: 'Sign In', href: '/signin' } as AccessAction,
    },
  },
  otherWays: {
    heading: 'Other ways to join',
    cards: [
      {
        id: 'invitation',
        icon: 'inbox' as AccessIconName,
        title: 'Workspace invitation',
        text: 'A workspace owner invited you as an admin or member. Sign in, then accept it from your account.',
        action: { text: 'Accept Invitation', href: '/signin' } as AccessAction,
        gate: null,
      },
      {
        id: 'delegation',
        icon: 'trip' as AccessIconName,
        title: 'Delegation programme',
        text: 'You are a participant or want to apply. Sign in, then open Programmes in your account.',
        action: { text: 'Register or Apply', href: '/account/delegations' } as AccessAction,
        gate: 'participants' as const,
      },
      {
        id: 'organiser',
        icon: 'calendar' as AccessIconName,
        title: 'Organising a delegation',
        text: 'You lead a group trip for your members or clients.',
        action: {
          text: 'Start As an Organiser',
          href: '/account/delegations/organise',
        } as AccessAction,
        gate: 'programmes' as const,
      },
    ],
  },
};

/** Team and network door: /access/team. */
export const teamDoorPage = {
  eyebrow: 'TEAM AND NETWORK ACCESS',
  title: 'Sign in to team or field work.',
  lead: 'For Corridra team members, reviewers, admins and invited field helpers.',
  note: 'This is separate from a customer account. You need an invitation and an authenticator app.',
  cards: [
    {
      id: 'team',
      icon: 'shield' as AccessIconName,
      title: 'Corridra team',
      text: 'Operator, reviewer, viewer, admin or founder.',
      action: { text: 'Team Sign-In', href: '/operator/signin' } as AccessAction,
      actionKind: 'primary' as const,
      textLink: { text: 'Set Up Invited Access', href: '/operator/setup' } as AccessAction,
    },
    {
      id: 'helper',
      icon: 'network' as AccessIconName,
      title: 'Field helper',
      text: 'You were invited to do local tasks for the Corridra Network.',
      action: { text: 'Open Helper Tasks', href: '/contributor' } as AccessAction,
      actionKind: 'secondary' as const,
      textLink: { text: 'Accept an Invitation', href: '/contributor/setup' } as AccessAction,
    },
  ],
  steps: {
    heading: 'Your first invitation',
    // The password rule matches the setup form: at least 14 and at most 128 characters.
    items: [
      'Verify the email of your Corridra account.',
      'Set a separate password of 14 to 128 characters.',
      'Add an authenticator app to your phone.',
    ],
    more: { text: 'How the Corridra Network Works', href: '/network' } as AccessAction,
  },
};

/** Private link door: /access/link. Role cards carry no link on purpose: the link itself is the access. */
export const linkDoorPage = {
  eyebrow: 'PRIVATE LINK ACCESS',
  title: 'Open the link Corridra sent you.',
  lead: 'For buyers, suppliers, clients and institutions.',
  note: 'You do not need an account. The link is your access, and it works only for the person it was sent to.',
  cards: [
    {
      id: 'introduction',
      icon: 'people' as AccessIconName,
      title: 'An introduction',
      text: 'For a buyer or supplier. Open the link in the message to read the introduction and reply.',
    },
    {
      id: 'report',
      icon: 'document' as AccessIconName,
      title: 'A report or programme brief',
      text: 'For a client or institution. Open the link in the message to read what was shared with you.',
    },
  ],
  trouble: {
    heading: 'Link not working?',
    text: 'Links can expire or be cancelled. Ask the person who sent it for a new link.',
  },
};

/** The "Not what you need?" bar shared by the three pages. */
export const accessElsewhereWords = { heading: 'Not what you need?' } as const;

export type AccessHelpLink = { href: string; text: string; plainAnchor?: boolean };
export type AccessHelp = { label: string; intro?: string; links: AccessHelpLink[] };

/**
 * The help-link lists under the sign-in and setup pages. Each is the exact words, addresses and labels that
 * the page carried before they moved here. `plainAnchor` keeps a link a plain `<a>` where it always was one.
 */
export const accessHelp = {
  /** Under the customer sign-in form, in a disclosure. */
  customerOtherRoutes: {
    label: 'Other access routes',
    intro:
      'Team members sign in separately. For a shared mission, programme or task, use the private link we sent you.',
    links: [
      { href: '/operator', text: 'Team Sign-in' },
      { href: '/workspace', text: 'Start Page' },
      { href: '/contributor', text: 'Local Helper Tasks' },
      { href: '/plan', text: 'Plan a Mission' },
    ],
  },
  /** The plain sign-in page when customer sign-in is not configured. */
  signInFallback: {
    label: 'Other ways in',
    links: [
      { href: '/operator', text: 'Team Sign-in' },
      { href: '/contributor', text: 'Local Helper Tasks' },
      { href: '/', text: 'Back to Corridra' },
    ],
  },
  operatorSetup: (signInHref: string): AccessHelp => ({
    label: 'Operator setup help',
    links: [
      { href: '/account', text: 'Customer account and email verification' },
      { href: signInHref, text: 'Operator sign-in and authenticator', plainAnchor: true },
      { href: '/workspace', text: 'All workspaces and tools' },
    ],
  }),
  operatorForgotPassword: (signInHref: string): AccessHelp => ({
    label: 'Recovery options',
    links: [
      { href: '/operator/setup', text: 'Finish a pending invitation' },
      { href: signInHref, text: 'Back to operator sign-in', plainAnchor: true },
      { href: '/forgot-password', text: 'Reset a customer account password' },
    ],
  }),
  /** Under the operator sign-in form. A contributor return address points the first link at contributor setup. */
  operatorSignIn: (returnTo: string): AccessHelp => {
    const contributor = returnTo.startsWith('/contributor?');
    return {
      label: 'Sign-in alternatives',
      links: [
        {
          href: contributor ? '/contributor/setup' : '/operator/setup',
          text: contributor
            ? 'Set up invited contributor access'
            : 'Set up invited operator access',
        },
        { href: '/workspace', text: 'All workspaces and tools' },
        { href: '/signin', text: 'Customer account sign-in' },
        { href: '/contributor', text: 'Assigned-task invitation help' },
        { href: '/', text: 'Back to Corridra' },
      ],
    };
  },
  /** The workspace error page. `signInHref` is the sign-in address for the place the person was in. */
  operatorError: (signInHref: string): AccessHelp => ({
    label: 'Workspace recovery',
    links: [
      { href: signInHref, text: 'Verify operator access', plainAnchor: true },
      { href: '/workspace', text: 'All workspaces and tools' },
      { href: '/', text: 'Back to Corridra' },
    ],
  }),
  contributorSetup: {
    label: 'Contributor setup help',
    links: [
      { href: '/account', text: 'Account and email verification' },
      { href: '/contributor', text: 'Assigned-task access help' },
      { href: '/network', text: 'About Corridra Network' },
    ],
  },
  contributorError: {
    label: 'Assigned work recovery',
    links: [
      { href: '/signin', text: 'Choose your sign-in route' },
      { href: '/workspace', text: 'All workspaces and tools' },
    ],
  },
  buyer: {
    label: 'Private introduction help',
    links: [
      { href: '/workspace', text: 'Workspace and invitation help' },
      { href: '/', text: 'Back to Corridra' },
    ],
  },
} as const;
