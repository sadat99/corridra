// Lane 13 of the UX update: small front doors for the founder and the helper (contributor) areas. A
// front door is a short list of plain cards that link to pages that already exist. It stores nothing,
// reads nothing and counts nothing, so it cannot claim a number it does not have. The words for the
// founder come from the locked navigation in UI direction (Business, Operations, Routes and settings,
// People and access, Ready to start?).
import { helperWays } from './access-doors';

export type DoorItem = {
  id: string;
  title: string;
  line: string;
  /** An exact existing address. A test checks each one against the real sections and pages. */
  href: string;
  primary?: boolean;
};

export const founderDoor: readonly DoorItem[] = [
  {
    id: 'business',
    title: 'Business',
    line: 'Commercial progress and the missions behind it.',
    href: '/operator#workspace-commercial',
  },
  {
    id: 'operations',
    title: 'Operations',
    line: 'Corridor operations, the mission dashboard and recovery.',
    href: '/operator#workspace-operations',
  },
  {
    id: 'routes',
    title: 'Routes and settings',
    line: 'Routes and settings.',
    href: '/operator#workspace-settings',
  },
  {
    id: 'people',
    title: 'People and access',
    line: 'Who has access, and the audit trail.',
    href: '/operator#workspace-audit',
  },
  {
    id: 'ready',
    title: 'Ready to start?',
    line: 'Production readiness: what is still open before real work.',
    href: '/operator#ops-gates',
    primary: true,
  },
];

const workspaceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The same cards with each workspace link carrying the workspace the page is showing. Without it a link
 * opens the person's first workspace, not the one they chose. The fragment is kept.
 */
export function withWorkspace(items: readonly DoorItem[], workspace: string): readonly DoorItem[] {
  if (!workspaceId.test(workspace)) return items;
  return items.map((item) =>
    item.href.startsWith('/operator#')
      ? { ...item, href: `/operator?workspace=${workspace}${item.href.slice('/operator'.length)}` }
      : item,
  );
}

// The helper addresses and titles come from the access doors (`access-doors.ts`), so they are named once. Only the
// one-line explanations live here.
export const helperDoor: readonly DoorItem[] = [
  {
    id: 'accept',
    title: helperWays.setup.text,
    line: 'Set up your separate helper access from the invitation the Corridra team sent.',
    href: helperWays.setup.href,
    primary: true,
  },
  {
    id: 'how',
    title: helperWays.network.text,
    line: 'What a task holds, how evidence is reviewed and what a reward does and does not mean.',
    href: helperWays.network.href,
  },
  {
    id: 'signin',
    title: helperWays.signIn.text,
    line: 'Sign in with your work account to open the tasks assigned to you.',
    href: helperWays.signIn.href,
  },
];
