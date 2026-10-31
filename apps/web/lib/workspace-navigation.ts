// Destinations are a closed list. Never turn a return URL into an open redirect.
export const workspaceSections = [
  {
    id: 'workspace-missions',
    label: 'Missions and requirements',
    part: 'V2 1–3',
    roles: ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  },
  {
    id: 'workspace-research',
    label: 'Companies and research',
    part: 'V2 1–3',
    roles: ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  },
  {
    id: 'workspace-meetings',
    label: 'Introductions and meetings',
    part: 'V2 2–3',
    roles: ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  },
  {
    id: 'workspace-commercial',
    label: 'Commercial progress',
    part: 'V2 1–3',
    roles: ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  },
  {
    id: 'workspace-delivery',
    label: 'Client and institution delivery',
    part: 'V2 3',
    roles: ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  },
  {
    id: 'workspace-sources',
    label: 'Sources and claims',
    part: 'V2 1–5',
    roles: ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  },
  {
    id: 'workspace-evidence',
    label: 'Evidence review',
    part: 'V2 1–5',
    roles: ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  },
  {
    id: 'workspace-ai',
    label: 'AI assistance',
    part: 'V2 4',
    roles: ['owner', 'admin', 'operator', 'reviewer'],
  },
  {
    id: 'workspace-network',
    label: 'Execution network',
    part: 'V2 4',
    roles: ['owner', 'admin', 'operator', 'reviewer'],
  },
  {
    id: 'workspace-operations',
    label: 'Global operations',
    part: 'V2 5',
    roles: ['owner', 'admin', 'operator'],
  },
  {
    id: 'ops-dashboard',
    label: 'Mission dashboard and economics',
    part: 'V2 5',
    roles: ['owner', 'admin', 'operator'],
  },
  { id: 'ops-center', label: 'Corridor Control Center', part: 'V2 5', roles: ['owner', 'admin'] },
  {
    id: 'ops-health',
    label: 'Recovery and health',
    part: 'V2 5',
    roles: ['owner', 'admin', 'operator'],
  },
  {
    id: 'ops-gates',
    label: 'Production readiness',
    part: 'V2 5',
    roles: ['owner', 'admin', 'operator'],
  },
  {
    id: 'workspace-settings',
    label: 'Corridors and policies',
    part: 'V2 1, 4–5',
    roles: ['owner', 'admin'],
  },
  { id: 'workspace-audit', label: 'Access and audit', part: 'V2 1–5', roles: ['owner', 'admin'] },
  {
    id: 'workspace-authenticator',
    label: 'Authenticator',
    part: 'Access',
    roles: ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  },
  { id: 'workspace-controls', label: 'Workspace controls', part: 'Access', roles: ['owner'] },
] as const;

export function operatorReturnTo(value: string | undefined): string {
  if (!value || value.length > 240) return '/operator';
  if (/^\/contributor\?workspace=[0-9a-f-]{36}$/i.test(value)) return value;
  const match = /^\/operator(?:\?workspace=[0-9a-f-]{36})?(?:#([a-z-]+))?$/i.exec(value);
  if (!match) return '/operator';
  return !match[1] ||
    workspaceSections.some((section) => section.id === match[1]) ||
    match[1] === 'workspace-navigation'
    ? value
    : '/operator';
}

// Every way into operator sign-in is a full page load (a plain anchor or location change): it drops
// the cached workspace, and Next 16.4.3 brings back a doubled or stale # on a soft return.
export const operatorSignInPage = '/operator/signin';

/**
 * The operator sign-in address that comes back to a workspace and section afterwards. Every return
 * address is checked by `operatorReturnTo` above and only one it keeps unchanged is used: a section
 * outside the closed list is dropped before the workspace is, and anything else falls back to
 * `/operator`.
 */
export function operatorSignInPath(workspace = '', section = ''): string {
  const place = workspace ? '/operator?workspace=' + encodeURIComponent(workspace) : '/operator';
  const next =
    [place + '#' + section, place, '/operator#' + section].find(
      (candidate) => operatorReturnTo(candidate) === candidate,
    ) ?? '/operator';
  return operatorSignInPage + '?next=' + encodeURIComponent(next);
}
