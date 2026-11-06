// What the team frame knows from the server that the header menus also need: whether section addresses are on.
// The frame publishes it once; the avatar menu reads it. Convenience only: it changes which address a link
// uses (`/operator/<word>` or the `#` link), never what a role may open. Owner: S4.

export type TeamFlags = { urls: boolean };

const empty: TeamFlags = { urls: false };
let current: TeamFlags = empty;
const listeners = new Set<() => void>();

export function publishTeamFlags(next: TeamFlags) {
  if (next.urls === current.urls) return;
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
