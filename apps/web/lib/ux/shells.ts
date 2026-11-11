// The four role shells (commercial readiness program, D14 and UX-02). Behind CORRIDRA_UX_SHELLS_V2:
// with the switch off nothing here is used and every page renders as before. Navigation is a
// convenience only; access is still decided by each route and the server. Owner: WS-E.
import { operatorSectionPath, sectionOfFragment } from '../operator-urls';
import { workspaceSections } from '../workspace-navigation';

export type SignedInShell = 'team' | 'customer' | 'contributor';

/** Sign-in and recovery pages under /operator are public pages: they keep the public header. */
const operatorPublicPages = /^\/operator\/(?:signin|forgot-password|reset-password|setup)(?:\/|$)/;

/**
 * Which signed-in shell a page belongs to, or null for a public page. The staff customer preview
 * (/operator/view-as) keeps its own frame and is left as it is.
 */
export function signedInShellFor(pathname: string | null | undefined): SignedInShell | null {
  const path = pathname ?? '';
  if (/^\/operator\/view-as(?:\/|$)/.test(path) || operatorPublicPages.test(path)) return null;
  if (/^\/operator(?:\/|$)/.test(path)) return 'team';
  if (/^\/account(?:\/|$)/.test(path)) return 'customer';
  if (/^\/contributor(?:\/|$)/.test(path)) return 'contributor';
  return null;
}

/** Pages that show the team sidebar: the workspace, its sections, a mission page and the owner page. */
export function teamSidebarShown(pathname: string | null | undefined): boolean {
  return signedInShellFor(pathname) === 'team';
}

export function sectionLabel(id: string): string {
  return workspaceSections.find((section) => section.id === id)?.label ?? id;
}

export function sectionAllowedFor(id: string, role: string | null): boolean {
  if (!role) return true;
  const section = workspaceSections.find((item) => item.id === id);
  return !!section && (section.roles as readonly string[]).includes(role);
}

/** The chosen workspace as a query, or nothing when it is not a workspace id. */
export function workspaceQuery(workspace: string): string {
  return /^[0-9a-f-]{36}$/i.test(workspace) ? '?workspace=' + encodeURIComponent(workspace) : '';
}

/**
 * The address of a section. With section addresses on it is `/operator/<word>`, otherwise the
 * `#` link the workspace always had. The chosen workspace is kept in both.
 */
export function teamSectionHref(id: string | undefined, urls: boolean, workspace = ''): string {
  const query = workspaceQuery(workspace);
  if (!id) return '/operator' + query;
  const path = urls ? operatorSectionPath(id) : null;
  return path ? path + query : '/operator' + query + '#' + id;
}

/**
 * The section in view for an address: a `#` part wins (old links), then the section word, then the
 * mission page (it belongs to Missions). The owner page counts as Settings.
 */
export function currentTeamSection(
  pathname: string,
  hash: string,
  slugToId: (slug: string) => string | null,
) {
  // An address inside a section (a billing block) is in view in the section that holds it.
  const fragment = sectionOfFragment(hash.replace(/^#/, ''));
  if (fragment && workspaceSections.some((section) => section.id === fragment)) return fragment;
  const [, first = '', second] = /^\/operator(?:\/([^/]+))?(?:\/([^/]+))?/.exec(pathname) ?? [];
  if (first === 'owner') return 'owner';
  const id = first ? slugToId(first) : null;
  if (id) return id;
  if (first && second) return 'workspace-missions';
  return '';
}

const teamTitles: Record<string, string> = {
  'workspace-missions': 'Missions',
  'workspace-research': 'Companies',
  'workspace-meetings': 'Meetings',
  'workspace-commercial': 'Quotes and billing',
  'workspace-delivery': 'Reports',
  'workspace-network': 'Network',
  'workspace-evidence': 'Evidence',
};

/**
 * The page title and heading of a team page (CQ-36): the sidebar word for its section, the
 * section's own name for a Settings page, and Today for the workspace home.
 */
export function teamSectionTitle(section: string | undefined): string {
  if (!section) return 'Today';
  return teamTitles[section] ?? sectionLabel(section);
}
