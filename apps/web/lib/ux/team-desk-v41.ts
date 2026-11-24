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
