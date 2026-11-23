// Navigation v1 for the Corridra team (docs/revamp/specs/navigation-v1.md): the dark sidebar holds
// Today, Missions, Companies, Meetings and Money, with an Admin group for owner and admin. Each item
// opens a second level of at most five places. Every workspace section, the owner page and the
// mission page keep their address; this file only says where each one is found. Navigation never
// grants access: a place is listed only for a role that may open it, and the server still decides.
// Owner: S4.
import { sectionAllowedFor, teamSectionHref, workspaceQuery } from './shells';
import { workspaceSections } from '../workspace-navigation';
import { teamProblemReportsPath } from './team-help';

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
    places: [{ id: 'home', label: 'Today' }],
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
      { id: 'workspace-sources', label: 'Sources and claims' },
      { id: 'workspace-evidence', label: 'Evidence review' },
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
      { id: 'workspace-commercial', label: 'Money' },
      { id: 'ops-dashboard', label: 'Dashboard' },
    ],
  },
  {
    key: 'admin',
    label: 'Admin',
    icon: 'shield',
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
 * The operator desk grouping (CORRIDRA_UX_OPERATOR_DESK, owner approved 20 Nov 2026): five groups instead of six.
 * Meetings, Reports and Network join Missions; Assistance joins Companies; Admin becomes "Settings and checks". The
 * same seventeen places (Today and the sixteen sections), each with the address and the role gate it had; the item key `admin` is unchanged so the role
 * rule (owner and admin only) is the same code. A test holds the union of places per role equal to the map above.
 */
export const deskMap: readonly TeamItem[] = [
  teamMap[0]!,
  {
    key: 'missions',
    label: 'Missions',
    icon: 'mission',
    places: [
      { id: 'workspace-missions', label: 'Missions' },
      { id: 'workspace-meetings', label: 'Meetings' },
      { id: 'workspace-operations', label: 'Operations' },
      { id: 'workspace-delivery', label: 'Reports' },
      { id: 'workspace-network', label: 'Network' },
    ],
  },
  {
    key: 'companies',
    label: 'Companies',
    icon: 'company',
    places: [
      { id: 'workspace-research', label: 'Companies' },
      { id: 'workspace-sources', label: 'Sources and claims' },
      { id: 'workspace-evidence', label: 'Evidence review' },
      { id: 'workspace-ai', label: 'Assistance' },
    ],
  },
  teamMap[4]!,
  { ...teamMap[5]!, label: 'Settings and checks' },
];

/** The map in force: the operator desk grouping when its switch is on, otherwise Navigation v1 as it was. */
export function mapFor(desk: boolean): readonly TeamItem[] {
  return desk ? deskMap : teamMap;
}

/** The address with the Settings sub-tab chosen (?tab=, kept before any # part), so a fresh visit lands on that tab. */
function withSettingsTab(href: string, tab: string): string {
  const [path = '', hash] = href.split('#') as [string, string | undefined];
  const joined = path + (path.includes('?') ? '&' : '?') + 'tab=' + tab;
  return hash === undefined ? joined : joined + '#' + hash;
}

/**
 * Pinned queues (operator desk only): a second labelled list under the groups, for the roles that triage. The
 * addresses are built like every other sidebar link, so they work from any team page and keep the chosen workspace:
 * Erasure Requests opens the Settings section on its Erasure requests tab (?tab=settings-erasure), Problem Reports opens the workspace home at the panel's own fragment
 * (#problem-report-queue, which the workspace reads as inside Settings). Problem Reports is listed only where Report a
 * Problem is offered.
 */
export type TeamPin = { id: 'problem-reports' | 'erasure'; label: string; href: string };
export function teamPins(
  role: string | null,
  problemReports: boolean,
  urls = false,
  workspace = '',
): TeamPin[] {
  // Same rule as canTriage in lib/problem-report-queue.ts (a test holds them equal; that module is too heavy for the sidebar).
  if (role !== 'owner' && role !== 'admin') return [];
  return [
    ...(problemReports
      ? [
          {
            id: 'problem-reports' as const,
            label: 'Problem Reports',
            href: teamSectionHref(undefined, urls, workspace) + '#problem-report-queue',
          },
        ]
      : []),
    {
      id: 'erasure' as const,
      label: 'Erasure Requests',
      href: withSettingsTab(placeHref('workspace-settings', urls, workspace), 'settings-erasure'),
    },
  ];
}

/**
 * Places that are not a first-level entry of their own: they sit in the second level of the item
 * that leads to them. Control Center and the owner page live under Settings.
 */
export const settingsPlaces: readonly TeamPlace[] = [
  { id: 'workspace-settings', label: 'Routes and policies' },
  { id: 'ops-center', label: 'Control Center' },
  { id: 'owner', label: 'Owner page' },
];

export function placeAllowed(id: TeamPlaceId, role: string | null): boolean {
  if (id === 'home') return true;
  if (id === 'owner') return role === null ? false : role === 'owner' || role === 'admin';
  return sectionAllowedFor(id, role);
}

/** The items a role sees. With the role unknown only what every role may open is listed. */
export function teamItemsFor(role: string | null, desk = false): TeamItem[] {
  const admin = role === 'owner' || role === 'admin';
  return mapFor(desk)
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
  return item.places.filter((place) => placeAllowedStrict(place.id, role));
}

/** The second level of Settings: three places, shown on any of them. */
export function settingsLevel(role: string | null): TeamPlace[] {
  return settingsPlaces.filter((place) => placeAllowedStrict(place.id, role));
}

/** The item that holds a place for a role. Admin wins for the places it lists, for owner and admin. */
export function itemForPlace(
  id: TeamPlaceId,
  role: string | null,
  desk = false,
): TeamItem['key'] | 'none' {
  const admin = role === 'owner' || role === 'admin';
  const teamMap = mapFor(desk);
  if (admin && teamMap.find((i) => i.key === 'admin')?.places.some((p) => p.id === id))
    return 'admin';
  if (id === 'ops-center' || id === 'owner') return 'admin';
  const found = teamMap.find((i) => i.key !== 'admin' && i.places.some((p) => p.id === id));
  // The Authenticator, and Health and Readiness for a role with no Admin, live in the avatar menu: no sidebar item is current.
  return found ? found.key : 'none';
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

/**
 * The places the avatar menu carries: the Authenticator for every role, and Health and Readiness for a role that may
 * open them but is not shown Admin (an operator). Owner and admin find those two in Admin. With the role unknown only
 * what every role may open is offered.
 */
const accountPlaces: readonly TeamPlace[] = [
  { id: 'workspace-authenticator', label: 'Authenticator' },
  { id: 'ops-health', label: 'Health' },
  { id: 'ops-gates', label: 'Readiness' },
];
export function teamAccountPlaces(role: string | null): TeamPlace[] {
  const admin = role === 'owner' || role === 'admin';
  return accountPlaces.filter(
    (place) =>
      placeAllowedStrict(place.id, role) &&
      !(admin && (place.id === 'ops-health' || place.id === 'ops-gates')),
  );
}

/**
 * The avatar menu's place links, with their addresses and which one is the current page: what the menu renders, so a
 * test can walk them without opening it. `current` is the place in view (a `#` part or a section address), if any.
 */
export function teamAccountLinks(
  role: string | null,
  urls: boolean,
  workspace = '',
  current: TeamPlaceId | '' = '',
  problemReports?: { current: boolean },
): { id: TeamPlaceId | 'problem-reports'; label: string; href: string; current: boolean }[] {
  const places = teamAccountPlaces(role).map((place) => ({
    id: place.id,
    label: place.label,
    href: placeHref(place.id, urls, workspace),
    current: place.id === current,
  }));
  // Their own problem reports, for every role, only where Report a Problem is offered. The fourth row at most.
  return problemReports
    ? [
        ...places,
        {
          id: 'problem-reports',
          label: 'Your Problem Reports',
          href: teamProblemReportsPath + workspaceQuery(workspace),
          current: problemReports.current,
        },
      ]
    : places;
}
