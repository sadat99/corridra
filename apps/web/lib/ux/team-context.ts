// What the team shell needs to know from the loaded workspace: the chosen workspace and the person's
// role in it. The workspace publishes it once it has loaded; the sidebar and the header read it.
// Convenience only: it hides links a role cannot open, it never grants anything. Owner: WS-E.

export type TeamContext = { tenant: string; role: string | null };

const empty: TeamContext = { tenant: '', role: null };
let current: TeamContext = empty;
const listeners = new Set<() => void>();

export function publishTeamContext(next: TeamContext) {
  if (next.tenant === current.tenant && next.role === current.role) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export function subscribeTeamContext(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const readTeamContext = () => current;
export const readServerTeamContext = () => empty;
