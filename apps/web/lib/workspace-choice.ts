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
} as const;
export type WorkspaceKind = keyof typeof workspaceDestinations;

/** Programme management is for owners and admins; the other sections are open to every member. */
export function workspacesFor<T extends { role: string }>(kind: WorkspaceKind, rows: T[]): T[] {
  return kind === 'programmes' ? rows.filter((row) => ['owner', 'admin'].includes(row.role)) : rows;
}

export const workspacePath = (kind: WorkspaceKind, workspaceId: string) =>
  '/account/' + workspaceDestinations[kind].path + '/' + encodeURIComponent(workspaceId);
