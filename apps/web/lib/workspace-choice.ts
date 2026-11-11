// Where each "choose a workspace" entry in My Work leads. The choice grants nothing: the destination
// pages and their APIs repeat the fresh identity and role checks.
export const workspaceDestinations = {
  profile: {
    path: 'profile',
    description: 'Your company details, supporting statements and reviewed company links.',
  },
  programmes: {
    path: 'delegations',
    description: 'Programme participants, terms, places, fee schedules and delivery.',
  },
  services: {
    path: 'service-requests',
    description: 'Help requests, questions and quotes for work in this workspace.',
  },
  billing: {
    path: 'billing',
    description: 'The sample plan this workspace holds, what it includes and the plans on offer.',
  },
} as const;
export type WorkspaceKind = keyof typeof workspaceDestinations;

/**
 * What a destination says it holds. Company links are mentioned only while the company links switch is on;
 * with it off the profile destination names only what exists.
 */
export function workspaceDescription(kind: WorkspaceKind, linksEnabled: boolean): string {
  return kind === 'profile' && !linksEnabled
    ? 'Your company details and supporting statements.'
    : workspaceDestinations[kind].description;
}

/** The name of the company profiles entry: it names links only while the company links switch is on. */
export const companyProfilesTitle = (linksEnabled: boolean) =>
  linksEnabled ? 'Company profiles and links' : 'Company profiles';

/** Programme management is for owners and admins; the other sections are open to every member. */
export function workspacesFor<T extends { role: string }>(kind: WorkspaceKind, rows: T[]): T[] {
  return kind === 'programmes' ? rows.filter((row) => ['owner', 'admin'].includes(row.role)) : rows;
}

export const workspacePath = (kind: WorkspaceKind, workspaceId: string) =>
  '/account/' + workspaceDestinations[kind].path + '/' + encodeURIComponent(workspaceId);
