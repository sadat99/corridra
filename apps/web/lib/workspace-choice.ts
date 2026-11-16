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

/**
 * The workspaces that can start new work, in the order given. An archived workspace stays readable by its own
 * address but is not offered as a choice. A row without the flag is not archived. Display only: it grants nothing.
 */
export function activeWorkspaces<T extends { archived?: boolean }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.archived !== true);
}

/**
 * The workspaces a menu offers: the active ones, plus the archived workspace whose page the person is on (`current`),
 * last, so a switcher never loses the page it is drawn on.
 */
export function offeredWorkspaces<T extends { archived?: boolean }>(
  rows: readonly T[],
  current?: T,
): T[] {
  const active = activeWorkspaces(rows);
  return current?.archived === true ? [...active, current] : active;
}

/** Billing and the company profile hold money and history, so their choosers keep archived workspaces. */
export const keepsArchived = (kind: WorkspaceKind) => kind === 'billing' || kind === 'profile';

/**
 * The workspaces a destination offers. Programme management is for owners and admins; the other sections are open
 * to every member. Archived workspaces are left out unless the destination keeps them (`includeArchived`).
 */
export function workspacesFor<T extends { role: string; archived?: boolean }>(
  kind: WorkspaceKind,
  rows: readonly T[],
  includeArchived = keepsArchived(kind),
): T[] {
  const offered = includeArchived ? [...rows] : activeWorkspaces(rows);
  return kind === 'programmes'
    ? offered.filter((row) => ['owner', 'admin'].includes(row.role))
    : offered;
}

export const workspacePath = (kind: WorkspaceKind, workspaceId: string) =>
  '/account/' + workspaceDestinations[kind].path + '/' + encodeURIComponent(workspaceId);
