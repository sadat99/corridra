// All tools: every customer page a person may reach, each with a plain verb. It exists so the shorter
// navigation never hides anything. A test fails when a customer page is neither listed here nor
// excluded with a written reason (tests/integration/ux-all-tools.test.ts), so a page added later
// cannot go missing from this list or from the reasons.

export type ToolModule =
  'move' | 'serviceRequests' | 'participants' | 'programmes' | 'companies' | 'profiles' | 'billing';

export type ToolGroup = 'Start' | 'Your Move' | 'Missions' | 'Library' | 'Companies' | 'More';
export const toolGroups: readonly ToolGroup[] = [
  'Start',
  'Your Move',
  'Missions',
  'Library',
  'Companies',
  'More',
];

export type Tool = {
  /** The page file this link opens, as a route pattern (`/account` for the view links). */
  route: string;
  href: string;
  /** A plain verb phrase. */
  label: string;
  line: string;
  group: ToolGroup;
  /** The module that must be on for the person to reach it. Absent means always. */
  module?: ToolModule;
};

export const tools: readonly Tool[] = [
  {
    route: '/plan',
    href: '/plan',
    label: 'Plan a mission',
    line: 'Tell us your goal. It takes a few minutes.',
    group: 'Start',
  },
  {
    route: '/plan',
    href: '/plan#receipt-check',
    label: 'Check a request receipt',
    line: 'See progress and replies on a request you sent.',
    group: 'Start',
  },
  {
    route: '/workspace',
    href: '/workspace',
    label: 'Open the start page',
    line: 'All the ways to use Corridra.',
    group: 'Start',
  },
  {
    route: '/account/move',
    href: '/account/move',
    label: 'See what is waiting for you',
    line: 'One list of what needs you and what others hold.',
    group: 'Your Move',
    module: 'move',
  },
  {
    route: '/account',
    href: '/account?view=work',
    label: 'See your workspaces and requests',
    line: 'Workspaces, drafts and every request you sent.',
    group: 'Missions',
  },
  {
    route: '/account/service-requests',
    href: '/account/service-requests',
    label: 'Ask for help or a quote',
    line: 'Review requests for help, questions and quotes.',
    group: 'Missions',
    module: 'serviceRequests',
  },
  {
    route: '/account/delegations',
    href: '/account/delegations',
    label: 'See your delegation registrations',
    line: 'Delegations you are registered to join.',
    group: 'Missions',
    module: 'participants',
  },
  {
    route: '/account/delegations/organise',
    href: '/account/delegations/organise',
    label: 'Organise a delegation',
    line: 'Participants, terms, places, fee schedules and delivery.',
    group: 'Missions',
    module: 'programmes',
  },
  {
    route: '/account',
    href: '/account?view=results',
    label: 'Open your results and saved reports',
    line: 'Missions shared with you and reports you saved.',
    group: 'Library',
  },
  {
    route: '/account/companies',
    href: '/account/companies',
    label: 'Browse approved companies',
    line: 'Companies cleared to take part in missions.',
    group: 'Companies',
    module: 'companies',
  },
  {
    route: '/account/profile',
    href: '/account/profile',
    label: 'Keep your company details current',
    line: 'Company details and a reviewed company link.',
    group: 'More',
    module: 'profiles',
  },
  {
    route: '/account/billing',
    href: '/account/billing',
    label: 'See your plan and billing',
    line: 'The sample plan your workspace holds and the plans on offer.',
    group: 'More',
    module: 'billing',
  },
  {
    route: '/account',
    href: '/account?view=more',
    label: 'Manage your account',
    line: 'Account details, sign-out and help.',
    group: 'More',
  },
];

export type ExcludedPage = { route: string; why: string };

/**
 * Pages that are real but not a place to go to from a list. Each has a written reason. A page that
 * needs an id is opened from the page that holds that id; a page for a person who arrives by a
 * private link is not part of a signed-in list at all.
 */
export const excludedPages: readonly ExcludedPage[] = [
  { route: '/account/all-tools', why: 'This is the list itself.' },
  {
    route: '/account/request/[workspaceId]',
    why: 'Needs a workspace. It opens from the workspace under Missions.',
  },
  {
    route: '/account/requests/[requestId]',
    why: 'Needs one request. It opens from the request list under Missions and from Your Move.',
  },
  {
    route: '/account/rooms/[requestId]',
    why: 'Needs one request. It opens from the saved request page and from Your Move, and shows the Road, replies and report for that request.',
  },
  {
    route: '/account/drafts/[workspaceId]',
    why: 'Needs a workspace. It opens from the workspace under Missions and from Your Move.',
  },
  {
    route: '/account/missions/[resourceId]',
    why: 'Needs one shared mission. It opens from the Library.',
  },
  {
    route: '/account/profile/[workspaceId]',
    why: 'Needs a workspace. It opens from company details.',
  },
  {
    route: '/account/service-requests/new',
    why: 'It opens from the service request list and from a workspace, which choose what the request is about.',
  },
  {
    route: '/account/service-requests/[workspaceId]',
    why: 'Needs a workspace. It opens from the service request list.',
  },
  {
    route: '/account/service-requests/[workspaceId]/[requestId]',
    why: 'Needs one service request. It opens from the service request list and from Your Move.',
  },
  {
    route: '/account/billing/[workspaceId]',
    why: 'Needs a workspace. It opens from the plan and billing overview.',
  },
  {
    route: '/account/delegations/[workspaceId]',
    why: 'Needs one programme. It opens from the delegation list.',
  },
  {
    route: '/client',
    why: 'A person who receives a private link opens it. It is not a signed-in page and has no list entry.',
  },
  {
    route: '/programme',
    why: 'A programme participant opens it from a private link. It is not a signed-in page.',
  },
  {
    route: '/buyer',
    why: 'A supplier or buyer opens it from a private link. It is not a signed-in page.',
  },
  {
    route: '/mute/[requestId]',
    why: 'A person opens it from an email link to stop messages about one request. It is not a signed-in page.',
  },
];

export type ToolModules = Record<ToolModule, boolean>;

/** The tools a person can reach: a tool whose module is off is not listed. Order is kept. */
export function toolsFor(modules: ToolModules): Tool[] {
  return tools.filter((tool) => !tool.module || modules[tool.module]);
}
