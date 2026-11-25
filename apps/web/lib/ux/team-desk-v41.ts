// Team desk v4.1 (CORRIDRA_UX_TEAM_DESK_V41, docs/revamp/specs/team-desk-v4-1.md unit D3): what the parts inside the
// team frame share while the switch is on. Kept apart from team-context.ts so nothing that reads the workspace and
// role changes. Presentation only: nothing here grants or removes access.
import { createContext } from 'react';

/**
 * Team desk v4.1 (CORRIDRA_UX_TEAM_DESK_V41), as the team frame got it from the server. The frame provides it, so the
 * parts inside the frame read the same value in the server render and in the browser. Presentation only.
 */
export const TeamDeskV41Context = createContext(false);

/**
 * The workspace switch for menu v3. The loaded workspace publishes the workspaces the person belongs to and its own
 * guarded way of changing between them (it asks first when there are unsaved entries); the top of the menu draws
 * the control. A team page that does not mount the workspace publishes nothing, and the menu then shows only the
 * link to the page that lists every workspace. Convenience only: the server decides what each workspace shows.
 */
export type TeamSwitcher = {
  workspaces: readonly { id: string; name: string }[];
  current: string;
  busy: boolean;
  /** Changes workspace, after the unsaved-entries question where one is due. */
  choose: (id: string) => void;
};

let switcher: TeamSwitcher | null = null;
const switcherListeners = new Set<() => void>();

export function publishTeamSwitcher(next: TeamSwitcher | null) {
  switcher = next;
  switcherListeners.forEach((listener) => listener());
}
export function subscribeTeamSwitcher(listener: () => void) {
  switcherListeners.add(listener);
  return () => {
    switcherListeners.delete(listener);
  };
}
export const readTeamSwitcher = () => switcher;
export const readServerTeamSwitcher = () => null;

/** A workspace as the menu lists it. */
export type TeamWorkspace = { id: string; name: string };

/** The workspace list in one order everywhere: by name, then by id, so it never changes between visits. */
export function sortTeamWorkspaces<T extends TeamWorkspace>(workspaces: readonly T[]): T[] {
  return [...workspaces].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Where the menu's workspace switch leads on a team page that does not mount the workspace (the Inbox, a Supply
 * page, a mission page, the owner page): the same page for the chosen workspace. A page that belongs to one
 * workspace's record (a mission, a supply candidate) opens the list it came from instead, because that record is
 * not in the other workspace. Only the address is built here; the server decides what the workspace shows.
 */
export function teamPageForWorkspace(pathname: string, workspace: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const keep = parts[1] === 'supply' && parts[2] === 'do-not-contact' ? 3 : 2;
  const page = parts[0] === 'operator' ? '/' + parts.slice(0, keep).join('/') : '/operator';
  return page + '?workspace=' + encodeURIComponent(workspace);
}
