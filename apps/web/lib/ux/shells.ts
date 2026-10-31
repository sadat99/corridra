// The four role shells (commercial readiness program, D14 and UX-02). Behind CORRIDRA_UX_SHELLS_V2:
// with the switch off nothing here is used and every page renders as before. Navigation is a
// convenience only; access is still decided by each route and the server. Owner: WS-E.
import type { MessageKey } from '../i18n/messages';
import { operatorSectionPath } from '../operator-urls';
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

type SectionId = (typeof workspaceSections)[number]['id'];

export type TeamNavItem = {
  key: string;
  label: MessageKey;
  icon: string;
  /** The section this item opens; absent for Today (the workspace overview). */
  section?: SectionId;
  /** Other sections that count as this item being the current one. */
  also?: readonly SectionId[];
};

/** The Team sidebar, in the order D14 fixes. */
export const teamNavigation: readonly TeamNavItem[] = [
  { key: 'today', label: 'wse.team.today', icon: 'home' },
  { key: 'missions', label: 'wse.team.missions', icon: 'mission', section: 'workspace-missions' },
  { key: 'companies', label: 'wse.team.companies', icon: 'company', section: 'workspace-research' },
  { key: 'meetings', label: 'wse.team.meetings', icon: 'people', section: 'workspace-meetings' },
  { key: 'quotes', label: 'wse.team.quotes', icon: 'progress', section: 'workspace-commercial' },
  { key: 'reports', label: 'wse.team.reports', icon: 'document', section: 'workspace-delivery' },
  { key: 'network', label: 'wse.team.network', icon: 'network', section: 'workspace-network' },
  {
    key: 'evidence',
    label: 'wse.team.evidence',
    icon: 'evidence',
    section: 'workspace-evidence',
    also: ['workspace-sources'],
  },
];

/**
 * Everything else lives under Settings, so every original section stays one or two clicks away.
 * The Owner page is added there when the owner page is on and the person can open it.
 */
export const teamSettingsSections: readonly SectionId[] = [
  'workspace-settings',
  'workspace-audit',
  'workspace-controls',
  'workspace-authenticator',
  'workspace-sources',
  'workspace-ai',
  'workspace-operations',
  'ops-dashboard',
  'ops-center',
  'ops-health',
  'ops-gates',
];

export function sectionLabel(id: string): string {
  return workspaceSections.find((section) => section.id === id)?.label ?? id;
}

export function sectionAllowedFor(id: string, role: string | null): boolean {
  if (!role) return true;
  const section = workspaceSections.find((item) => item.id === id);
  return !!section && (section.roles as readonly string[]).includes(role);
}

/**
 * The address of a section. With section addresses on it is `/operator/<word>`, otherwise the
 * `#` link the workspace always had. The chosen workspace is kept in both.
 */
export function teamSectionHref(id: string | undefined, urls: boolean, workspace = ''): string {
  const query = /^[0-9a-f-]{36}$/i.test(workspace)
    ? '?workspace=' + encodeURIComponent(workspace)
    : '';
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
  const fragment = hash.replace(/^#/, '');
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

/** Which sidebar item is current for a section id ('' is Today). */
export function currentTeamItem(section: string): string {
  if (!section) return 'today';
  const direct = teamNavigation.find(
    (item) => item.section === section || item.also?.includes(section as SectionId),
  );
  if (direct) return direct.key;
  return 'settings';
}
