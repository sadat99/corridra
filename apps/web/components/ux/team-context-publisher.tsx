'use client';
// Publishes the chosen workspace and the person's role in it to the Team shell, for the team pages
// that do not mount the workspace (the Owner page and a mission page). Both values come from the
// server, which resolved them from the person's own memberships; nothing is read from the address or
// the browser. Convenience only: it decides which links the sidebar lists, never what the person may
// do, which every page and action still checks on the server. Owner: WS-E (S4).
import { useEffect } from 'react';
import { publishTeamContext } from '../../lib/ux/team-context';

export function TeamContextPublisher({ tenant, role }: { tenant: string; role: string }) {
  useEffect(() => {
    publishTeamContext({ tenant, role });
  }, [tenant, role]);
  return null;
}
