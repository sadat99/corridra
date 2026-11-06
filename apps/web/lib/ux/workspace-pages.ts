/**
 * Customer pages that belong to one workspace: the section and the workspace id, so the left bar's workspace
 * card (the one workspace switcher) can name the workspace and open the same section of another one.
 */
export const workspacePage =
  /^\/account\/(request|drafts|billing|profile|delegations|service-requests)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;
