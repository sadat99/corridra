// The contributor navigation target for "Your tasks". The task board opens from
// /contributor?workspace=<id> and the page shows it only with that id, so the link keeps a valid id
// from the address and drops anything else. Navigation only: the page and the server still decide
// who sees what. Owner: WS-E.
const workspaceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function contributorTasksHref(workspace: string | null | undefined): string {
  return workspace && workspaceId.test(workspace)
    ? `/contributor?workspace=${workspace}`
    : '/contributor';
}
