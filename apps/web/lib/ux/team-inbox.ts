// The Inbox page of the team desk (team desk v4.1, decision 5 and unit D18; CORRIDRA_UX_TEAM_DESK_V41): one page
// for problem reports, erasure requests, programme applications and helper interest. The lists are the ones the
// desk already has, unchanged; only where they are shown changes. With the switch on, an old address of a list
// inside Settings leads here, so every earlier link keeps working. Pure, so it is tested without a browser.
// Navigation only: each list still asks the server, which decides again with a fresh authenticator check.
import { deskOwnPages } from './page-pattern';
import { workspaceQuery } from './shells';

export const inboxPath = deskOwnPages.inbox;

/** The tabs of the Inbox page, in order. */
export const inboxTabIds = ['reports', 'erasure', 'applications', 'helpers'] as const;
export type InboxTabId = (typeof inboxTabIds)[number];

/** The same rule as the lists themselves (canTriage, canReadApplications, canReadHelperInterest): owner and admin. */
export const canOpenInbox = (role: string | null | undefined) =>
  role === 'owner' || role === 'admin';

/** The Settings tab that held each list before, to the Inbox tab that holds it now. */
/** A `Map`, so no object key ("constructor") is ever read as a tab. */
const tabOfSettingsTab = new Map<string, InboxTabId>([
  ['settings-reports', 'reports'],
  ['settings-erasure', 'erasure'],
  ['settings-applications', 'applications'],
]);
/** An element inside a list that an old `#` link names. The link keeps its `#` part and lands on the element. */
const elementAddresses = [
  'problem-report-queue',
  'erasure-queue-title',
  'programme-application-queue',
] as const;

/** The address of the Inbox page, with the chosen workspace and, when one is named, the tab to open. */
export function inboxHref(workspace = '', tab?: InboxTabId): string {
  const query = new URLSearchParams(workspaceQuery(workspace));
  if (tab) query.set('tab', tab);
  const words = query.toString();
  return inboxPath + (words ? '?' + words : '');
}

/**
 * Where an old address of a list inside Settings leads with the switch on, or null for any other address.
 * `fragment` is the `#` part (without the `#`), `settingsTab` is the `?tab=` of an address that shows Settings.
 * An old `#` link to an element keeps its `#` part, so the page opens the tab that holds the element and lands on it.
 */
export function inboxHrefForOldAddress(address: {
  fragment: string;
  settingsTab: string | null;
  workspace: string;
}): string | null {
  const { fragment, settingsTab, workspace } = address;
  if ((elementAddresses as readonly string[]).includes(fragment))
    return inboxHref(workspace) + '#' + fragment;
  const tab = tabOfSettingsTab.get(fragment) ?? tabOfSettingsTab.get(settingsTab ?? '');
  return tab ? inboxHref(workspace, tab) : null;
}
