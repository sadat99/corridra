import { workspaceSections } from './workspace-navigation';

type SectionId = (typeof workspaceSections)[number]['id'];

// Lane 9 of the UX update: each team workspace section can also be opened at its own address. The
// words below are the only addresses; they map to the section ids the workspace already uses, so the
// old `#workspace-...` links keep working and nothing is renamed. `satisfies` makes a new section
// fail the build until it gets an address.
export const operatorSlugs = {
  'workspace-missions': 'missions',
  'workspace-research': 'research',
  'workspace-meetings': 'meetings',
  'workspace-commercial': 'commercial',
  'workspace-delivery': 'delivery',
  'workspace-sources': 'sources',
  'workspace-evidence': 'evidence',
  'workspace-ai': 'assistance',
  'workspace-network': 'network',
  'workspace-operations': 'operations',
  'ops-dashboard': 'dashboard',
  'ops-center': 'control-center',
  'ops-health': 'health',
  'ops-gates': 'readiness',
  'workspace-settings': 'settings',
  'workspace-audit': 'audit',
  'workspace-authenticator': 'authenticator',
  'workspace-controls': 'controls',
} as const satisfies Record<SectionId, string>;

/** Addresses under /operator that already exist as their own pages. A section word may never be one. */
export const reservedOperatorSegments = [
  'owner',
  'setup',
  'signin',
  'forgot-password',
  'reset-password',
  'view-as',
] as const;

/** The section id for an address word, or null. Exact match on a closed list; nothing is parsed. */
export function sectionForSlug(slug: string): SectionId | null {
  for (const [id, word] of Object.entries(operatorSlugs)) if (word === slug) return id as SectionId;
  return null;
}

/** The address of a section, or null for anything that is not one of the sections. */
export function operatorSectionPath(id: string): string | null {
  return Object.hasOwn(operatorSlugs, id)
    ? `/operator/${(operatorSlugs as Record<string, string>)[id]}`
    : null;
}

/**
 * Addresses of a block inside a section, not sections of their own: a link to one shows the section that
 * holds it, then lands on the block. The list is closed. These are not sign-in return addresses
 * (`operatorReturnTo` keeps only section ids), so a sign-in return link for one opens the workspace
 * address (`/operator?workspace=...`) instead of the section's own page.
 */
export const inSectionAddresses = {
  'billing-services': 'workspace-delivery',
  'billing-plans': 'workspace-delivery',
  'billing-sample-invoices': 'workspace-delivery',
  'billing-invoices': 'workspace-delivery',
  'billing-payments': 'workspace-delivery',
} as const satisfies Record<string, SectionId>;

/** The section an address belongs to: its own id for a section, the holding section for an in-section address, else the address itself. */
export function sectionOfFragment(fragment: string): string {
  return Object.hasOwn(inSectionAddresses, fragment)
    ? (inSectionAddresses as Record<string, string>)[fragment]!
    : fragment;
}

export type AddressDestination = 'block' | 'section' | 'directory' | 'none';

/**
 * Where the workspace sends the eyes for an address. The block itself when it is there; else, for an
 * address inside a section the person may open, the section that holds it (the block may not exist for
 * their role, or may not have loaded yet); else the navigation directory; nothing for an empty address.
 */
export function addressDestination(address: {
  fragment: string;
  sectionId: string;
  allowed: boolean;
  blockExists: boolean;
  holderExists: boolean;
}): AddressDestination {
  if (!address.fragment) return 'none';
  if (address.allowed && address.blockExists) return 'block';
  if (address.allowed && address.sectionId !== address.fragment && address.holderExists)
    return 'section';
  return 'directory';
}

/**
 * What the workspace shows for an address: a `#` part always wins, so every old link keeps working on a
 * section address too; with none, the section the address names (or nothing, as before).
 */
export function fragmentFor(hash: string, initialSection: string): string {
  return hash.replace(/^#/, '') || initialSection;
}

/**
 * The workspace and section an operator address shows, for a link that should come back to it (the
 * error page's sign-in link). `/operator` takes its section from the `#` part; a section address takes
 * it from the address word unless a `#` part wins. Any other page under /operator, or an address with
 * neither a workspace nor a section, gives null. Nothing is validated here: `operatorSignInPath`
 * keeps only a return address `operatorReturnTo` allows.
 */
export function operatorPlaceFor(
  address: Pick<URL, 'pathname' | 'search' | 'hash'>,
): { workspace: string; section: string } | null {
  const slug = /^\/operator\/([^/]+)$/.exec(address.pathname)?.[1];
  const named = slug === undefined ? null : sectionForSlug(slug);
  if (address.pathname !== '/operator' && !named) return null;
  const workspace = new URLSearchParams(address.search).get('workspace') ?? '';
  const section = fragmentFor(address.hash, named ?? '');
  return workspace || section ? { workspace, section } : null;
}
