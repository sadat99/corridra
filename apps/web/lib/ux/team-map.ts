// Navigation v1 for the Corridra team (docs/revamp/specs/navigation-v1.md): the dark sidebar holds
// Today, Missions, Companies, Meetings and Money, with an Admin group for owner and admin. Each item
// opens a second level of at most five places. Every workspace section, the owner page and the
// mission page keep their address; this file only says where each one is found. Navigation never
// grants access: a place is listed only for a role that may open it, and the server still decides.
// Owner: S4.
import { sectionAllowedFor, teamSectionHref } from './shells';
import { workspaceSections } from '../workspace-navigation';

type SectionId = (typeof workspaceSections)[number]['id'];
/** A place is a workspace section, the workspace home (''), or the owner page. */
export type TeamPlaceId = SectionId | 'home' | 'owner';

export type TeamPlace = { id: TeamPlaceId; label: string };
export type TeamItem = {
  key: 'today' | 'missions' | 'companies' | 'meetings' | 'money' | 'admin';
  label: string;
  icon: string;
  /** The second level, in order. The first place is where the item itself leads. */
  places: readonly TeamPlace[];
  /** Admin only: shown to owner and admin, never to another role. */
  adminOnly?: true;
};

export const teamMap: readonly TeamItem[] = [
  {
    key: 'today',
    label: 'Today',
    icon: 'home',
    places: [
      { id: 'home', label: 'Today' },
      { id: 'ops-health', label: 'Health' },
      { id: 'ops-gates', label: 'Readiness' },
      { id: 'workspace-authenticator', label: 'Authenticator' },
    ],
  },
  {
    key: 'missions',
    label: 'Missions',
    icon: 'mission',
    places: [
      { id: 'workspace-missions', label: 'Missions' },
      { id: 'workspace-operations', label: 'Operations' },
      { id: 'workspace-network', label: 'Network' },
      { id: 'workspace-ai', label: 'Assistance' },
    ],
  },
  {
    key: 'companies',
    label: 'Companies',
    icon: 'company',
    places: [
      { id: 'workspace-research', label: 'Companies' },
      { id: 'workspace-sources', label: 'Sources' },
      { id: 'workspace-evidence', label: 'Evidence' },
    ],
  },
  {
    key: 'meetings',
    label: 'Meetings',
    icon: 'calendar',
    places: [
      { id: 'workspace-meetings', label: 'Meetings' },
      { id: 'workspace-delivery', label: 'Reports' },
    ],
  },
  {
    key: 'money',
    label: 'Money',
    icon: 'progress',
    places: [
      { id: 'workspace-commercial', label: 'Quotes and billing' },
      { id: 'ops-dashboard', label: 'Dashboard' },
    ],
  },
  {
    key: 'admin',
    label: 'Admin',
    icon: 'settings',
    adminOnly: true,
    places: [
      { id: 'ops-health', label: 'Health' },
      { id: 'ops-gates', label: 'Readiness' },
      { id: 'workspace-audit', label: 'Audit' },
      { id: 'workspace-controls', label: 'People and access' },
      { id: 'workspace-settings', label: 'Settings' },
    ],
  },
];

/**
 * Places that are not a first-level entry of their own: they sit in the second level of the item
 * that leads to them. Control Center and the owner page live under Settings.
 */
export const settingsPlaces: readonly TeamPlace[] = [
  { id: 'workspace-settings', label: 'Corridors and policies' },
  { id: 'ops-center', label: 'Control Center' },
  { id: 'owner', label: 'Owner page' },
];

export function placeAllowed(id: TeamPlaceId, role: string | null): boolean {
  if (id === 'home') return true;
  if (id === 'owner') return role === null ? false : role === 'owner' || role === 'admin';
  return sectionAllowedFor(id, role);
}

/** The items a role sees. With the role unknown only what every role may open is listed. */
export function teamItemsFor(role: string | null): TeamItem[] {
  const admin = role === 'owner' || role === 'admin';
  return teamMap
    .filter((item) => !item.adminOnly || admin)
    .filter((item) => item.places.some((place) => placeAllowedStrict(place.id, role)));
}

function placeAllowedStrict(id: TeamPlaceId, role: string | null): boolean {
  if (id === 'home') return true;
  if (role === null) {
    const roles = workspaceSections.find((entry) => entry.id === id)?.roles as
      readonly string[] | undefined;
    return !!roles?.includes('viewer');
  }
  return placeAllowed(id, role);
}

export function teamPlacesFor(item: TeamItem, role: string | null): TeamPlace[] {
  const places = item.key === 'admin' ? adminPlaces() : [...item.places];
  return places.filter((place) => placeAllowedStrict(place.id, role));
}

function adminPlaces(): TeamPlace[] {
  return [...(teamMap.find((i) => i.key === 'admin')?.places ?? [])];
}

/** The second level of Settings: three places, shown on any of them. */
export function settingsLevel(role: string | null): TeamPlace[] {
  return settingsPlaces.filter((place) => placeAllowedStrict(place.id, role));
}

/** The item that holds a place for a role. Admin wins for the places it lists, for owner and admin. */
export function itemForPlace(id: TeamPlaceId, role: string | null): TeamItem['key'] {
  const admin = role === 'owner' || role === 'admin';
  if (admin && teamMap.find((i) => i.key === 'admin')?.places.some((p) => p.id === id))
    return 'admin';
  if (id === 'ops-center' || id === 'owner') return 'admin';
  const found = teamMap.find((i) => i.key !== 'admin' && i.places.some((p) => p.id === id));
  return found ? found.key : 'admin';
}

/**
 * The address of a place. A section uses its address word (or the `#` link when section addresses
 * are off), the workspace home is `/operator` and the owner page is `/operator/owner`. The chosen
 * workspace is kept in each.
 */
export function placeHref(id: TeamPlaceId, urls: boolean, workspace = ''): string {
  if (id === 'owner') return '/operator/owner';
  return teamSectionHref(id === 'home' ? undefined : id, urls, workspace);
}
