// The one page pattern of the team desk (docs/revamp/specs/team-desk-v4-1.md, unit D4), behind
// CORRIDRA_UX_TEAM_DESK_V41: a title, one purpose line, at most one primary action and, for a place that
// belongs to a group, the group's segments under the title. A segment is a link to an address that already
// exists; nothing here adds, renames or removes an address. Navigation is a convenience only: a segment is
// listed for a role that may open its place, and the server still decides. Pure, so it is tested without a browser.
import { workspaceSections } from '../workspace-navigation';
import { teamSectionHref, workspaceQuery } from './shells';

type SectionId = (typeof workspaceSections)[number]['id'];
/** A team page that is not one of the seventeen places and has its own address: the Inbox and the Supply pages. */
export const deskOwnPages = {
  inbox: '/operator/inbox',
  supply: '/operator/supply',
  'supply-dnc': '/operator/supply/do-not-contact',
  'supply-mission': '/operator/supply',
  'supply-candidate': '/operator/supply',
} as const;
export type DeskOwnPageId = keyof typeof deskOwnPages;
/** A place of the team desk: the workspace home, a workspace section, the owner page or a page of its own. */
export type DeskPlaceId = SectionId | 'home' | 'owner' | DeskOwnPageId;
export type DeskGroupKey = 'companies' | 'status' | 'team' | 'settings';
export type DeskSegment = { id: DeskPlaceId; label: string };

/**
 * Where the seventeen places go. Each group is one menu word with its places as segments, in order. A place
 * that is in no group (Today, Missions, Meetings, Helpers, Money, Reports, Authenticator) shows no segments.
 */
export const deskGroups: Record<DeskGroupKey, { title: string; segments: readonly DeskSegment[] }> =
  {
    companies: {
      title: 'Companies',
      segments: [
        { id: 'workspace-research', label: 'Companies' },
        { id: 'workspace-sources', label: 'Sources and claims' },
        { id: 'workspace-evidence', label: 'Evidence review' },
      ],
    },
    status: {
      title: 'Status',
      segments: [
        { id: 'workspace-operations', label: 'Operations' },
        { id: 'ops-dashboard', label: 'Dashboard' },
        { id: 'ops-health', label: 'Health' },
        { id: 'ops-gates', label: 'Readiness' },
      ],
    },
    team: {
      title: 'Team and access',
      segments: [
        { id: 'workspace-controls', label: 'People and access' },
        { id: 'workspace-audit', label: 'Audit' },
      ],
    },
    settings: {
      title: 'Settings',
      segments: [
        { id: 'workspace-settings', label: 'Settings' },
        { id: 'workspace-ai', label: 'Assistance' },
        { id: 'ops-center', label: 'Control Center' },
        { id: 'owner', label: 'Owner page' },
      ],
    },
  };

/** The title of a place that is in no group, and the one purpose line of every place. */
const places: Record<DeskPlaceId, { title?: string; purpose: string }> = {
  home: { title: 'Today', purpose: 'What needs your decision now and what is waiting on others.' },
  'workspace-missions': {
    title: 'Missions',
    purpose: 'Every customer request with its owner and its next step.',
  },
  'workspace-meetings': {
    title: 'Meetings',
    purpose: 'Introductions and meetings, each with an owner and a next step.',
  },
  'workspace-network': {
    title: 'Helpers',
    purpose: 'People outside the team and the work assigned to them.',
  },
  'workspace-commercial': {
    title: 'Money',
    purpose: 'Opportunities, overdue follow-ups and outcomes for each mission, in exact amounts.',
  },
  'workspace-delivery': {
    title: 'Reports',
    purpose: 'What is prepared, reviewed and delivered to each customer.',
  },
  'workspace-authenticator': {
    title: 'Authenticator',
    purpose: 'A fresh code from your authenticator app, asked for before a protected action.',
  },
  'workspace-research': { purpose: 'The companies your team has researched for its missions.' },
  'workspace-sources': {
    purpose: 'Where information came from, what it claims and which facts are verified.',
  },
  'workspace-evidence': { purpose: 'Files to review before they count as evidence.' },
  'workspace-operations': { purpose: 'The work in progress across every mission.' },
  'ops-dashboard': { purpose: 'Corridra fees and customer trade results across missions.' },
  'ops-health': { purpose: 'What failed, what is recovering and what needs a retry.' },
  'ops-gates': { purpose: 'What is ready for real use and what is still closed.' },
  'workspace-audit': { purpose: 'What changed in this workspace, who changed it and when.' },
  'workspace-controls': {
    purpose: 'Members, invitations, roles and the tools this workspace offers.',
  },
  'workspace-settings': {
    purpose: 'Routes, mission templates and the reviewed policies for each route.',
  },
  'workspace-ai': { purpose: 'Where assistance may help and what a person must review.' },
  'ops-center': {
    purpose: 'Readiness reviews, budgets, documents and effort records for each route.',
  },
  owner: { purpose: 'What is blocked, what is still open and which features are switched on.' },
  inbox: {
    title: 'Inbox',
    purpose: 'Problem reports, erasure requests, programme applications and helper interest.',
  },
  supply: {
    title: 'Supply Sources',
    purpose: 'Where candidate companies come from, and the rules each source follows.',
  },
  'supply-dnc': {
    title: 'Do Not Contact',
    purpose: 'The companies the team must not contact, and the reason for each block.',
  },
  'supply-mission': {
    title: 'Supply Candidates',
    purpose: 'The candidate companies found for one mission, each with its source.',
  },
  'supply-candidate': {
    title: 'Candidate',
    purpose: 'One candidate company with its source, its review and its match.',
  },
};

export function isDeskPlace(id: string): id is DeskPlaceId {
  return Object.hasOwn(places, id);
}

/** The group a place belongs to, or null for a place that stands alone. */
export function deskGroupOf(place: DeskPlaceId): DeskGroupKey | null {
  for (const key of Object.keys(deskGroups) as DeskGroupKey[])
    if (deskGroups[key].segments.some((segment) => segment.id === place)) return key;
  return null;
}

/** The title (the group's word for a grouped place), the purpose line and the group of a place. */
export function deskPattern(place: DeskPlaceId): {
  title: string;
  purpose: string;
  group: DeskGroupKey | null;
} {
  const group = deskGroupOf(place);
  const entry = places[place];
  return {
    title: group ? deskGroups[group].title : (entry.title ?? ''),
    purpose: entry.purpose,
    group,
  };
}

/**
 * Whether a role may be shown a place. The same rule as the team menu: the section's own role list, the owner
 * page for owner and admin, and with the role not yet known only what every role (a viewer) may open.
 */
export function deskPlaceAllowed(place: DeskPlaceId, role: string | null): boolean {
  if (place === 'home') return true;
  if (place === 'owner') return role === 'owner' || role === 'admin';
  // A page of its own is in no group, so it is never a segment: its own page and its routes decide.
  if (Object.hasOwn(deskOwnPages, place)) return false;
  const roles = workspaceSections.find((section) => section.id === place)?.roles as
    readonly string[] | undefined;
  return !!roles?.includes(role ?? 'viewer');
}

/** The address of a place, exactly as the menu builds it; the chosen workspace is kept. */
export function deskPlaceHref(place: DeskPlaceId, urls: boolean, workspace = ''): string {
  if (place === 'owner') return '/operator/owner';
  if (Object.hasOwn(deskOwnPages, place))
    return deskOwnPages[place as DeskOwnPageId] + workspaceQuery(workspace);
  return teamSectionHref(place === 'home' ? undefined : place, urls, workspace);
}

/**
 * The segments under the title for the place in view: the places of its group this role may open, each with
 * its address. Nothing for a place in no group, for a place the role may not open, or when fewer than two
 * segments are left (one link to the page itself says nothing).
 */
export function deskSegmentsFor(
  place: DeskPlaceId,
  role: string | null,
  options: { urls: boolean; ownerPage: boolean; workspace?: string },
): { label: string; segments: { id: string; label: string; href: string; current: boolean }[] } {
  const group = deskGroupOf(place);
  if (!group) return { label: '', segments: [] };
  const allowed = deskGroups[group].segments.filter(
    (segment) =>
      deskPlaceAllowed(segment.id, role) && (segment.id !== 'owner' || options.ownerPage),
  );
  if (allowed.length < 2 || !allowed.some((segment) => segment.id === place))
    return { label: '', segments: [] };
  return {
    label: `${deskGroups[group].title} pages`,
    segments: allowed.map((segment) => ({
      id: segment.id,
      label: segment.label,
      href: deskPlaceHref(segment.id, options.urls, options.workspace),
      current: segment.id === place,
    })),
  };
}

/** The Status pages: with the pattern on, the workspace's scanning line is shown on these only. */
export function deskStatusPlace(place: string): boolean {
  return deskGroups.status.segments.some((segment) => segment.id === place);
}

/**
 * The browser tab title of a place with the pattern on: the page title for a place in no group, and for a
 * grouped place its segment word, then the group word when the two differ ("Sources and claims · Companies").
 */
export function deskTabTitle(place: DeskPlaceId): string {
  const group = deskGroupOf(place);
  if (!group) return deskPattern(place).title;
  const { title, segments } = deskGroups[group];
  const label = segments.find((segment) => segment.id === place)!.label;
  return label === title ? title : `${label} \u00b7 ${title}`;
}
