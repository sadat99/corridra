// What the team frame knows from the server that the header menus also need: whether section addresses are on, and
// whether Report a Problem is offered. The frame publishes them once; the header menus read them. Convenience only: they
// change which address a link uses (`/operator/<word>` or the `#` link) and whether a row is a link or says Coming
// soon, never what a role may open. Owner: S4.

export type TeamFlags = { urls: boolean; problemReports: boolean };

const empty: TeamFlags = { urls: false, problemReports: false };
let current: TeamFlags = empty;
const listeners = new Set<() => void>();

export function publishTeamFlags(next: TeamFlags) {
  if (next.urls === current.urls && next.problemReports === current.problemReports) return;
  current = next;
  listeners.forEach((listener) => listener());
}
export function subscribeTeamFlags(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const readTeamFlags = () => current;
export const readServerTeamFlags = () => empty;
