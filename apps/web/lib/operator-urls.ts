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
