// The Pages scope of the customer search (docs/revamp/specs/navigation-v1/customer-search.md, section 7). Built in the
// browser from the same navigation model the tabs, the avatar menu and the help menu read, so it can list only what the
// shell already offers this person. It reads no data and sends no request. A row of kind "soon" (Coming soon) is never
// a page, Sign Out and the external, Listen, Text Size, Stronger Colours and Less Movement rows are not pages, and the
// Companies tab is absent where its module is off, because the model leaves it out.
import { queryWords, rankFields } from '../palette-rank';
import {
  customerAvatarItems,
  customerHelpGroups,
  customerProblemReportsPath,
  customerTabs,
  manageWorkspacesHref,
  newRequestHref,
  reportProblemHref,
  type CustomerNavigationInput,
  type CustomerTabKey,
  type MenuEntry,
} from './customer-navigation';
import type { CustomerScopeId } from './customer-search-status';

export type PageEntry = {
  /** Stable key: `page:<label>` (two pages may share an address, as New Request and Manage Workspaces do). */
  key: string;
  label: string;
  detail: string;
  href: string;
  /** Set for a main tab, so the Requests and Companies scopes can show their own page. */
  tab?: CustomerTabKey;
};

/** Pages shown per search under All and for one scope, the same as the Requests and Companies rows. */
export const pagesShownAll = 5;
export const pagesShownScope = 10;

const entry = (label: string, detail: string, href: string, tab?: CustomerTabKey): PageEntry => ({
  key: `page:${label}`,
  label,
  detail,
  href,
  tab,
});
const links = (items: MenuEntry[], detail: string): PageEntry[] =>
  items.flatMap((item) => (item.kind === 'link' ? [entry(item.label, detail, item.href)] : []));

/**
 * Every page this person can open from the shell, once each by label, in the order of the menus: the tabs, New Request, Manage
 * Workspaces (only with a workspace), the account menu links, then the help menu links. `from` is the page the person
 * is on, which the Report a Problem form carries.
 */
export function customerSearchPages(
  input: CustomerNavigationInput,
  from: string = '/account',
): PageEntry[] {
  const hasWorkspace = input.workspaces.length > 0;
  const help = customerHelpGroups(
    null,
    input.problemReports ? reportProblemHref(customerProblemReportsPath, from) : null,
  );
  const all = [
    ...customerTabs(input).map((tab) => entry(tab.label, 'Main navigation', tab.href, tab.key)),
    entry('New Request', 'Starts a new Request', newRequestHref(hasWorkspace)),
    ...(hasWorkspace ? [entry('Manage Workspaces', 'Account menu', manageWorkspacesHref)] : []),
    ...links(customerAvatarItems(input), 'Account menu'),
    ...help.flatMap((group) => links(group.items, 'Help menu')),
  ];
  const seen = new Set<string>();
  return all.filter((page) => !seen.has(page.key) && !!seen.add(page.key));
}

export type PageMatch = PageEntry & { close: boolean };

/**
 * The rows the Pages scope shows. With nothing to look for: All lists the tabs and New Request, Requests and Companies
 * list only their own tab, Pages lists every page. With words: every page whose label or detail has all of them, best
 * match first, at most five under All and ten for one scope.
 */
export function pagesFor(
  pages: readonly PageEntry[],
  scope: CustomerScopeId,
  text: string,
): PageMatch[] {
  const words = queryWords(text);
  const inScope = pages.filter((page) =>
    scope === 'requests' || scope === 'companies' ? page.tab === scope : true,
  );
  if (words.length === 0) {
    const empty =
      scope === 'all'
        ? inScope.filter((page) => page.tab || page.label === 'New Request')
        : inScope;
    return empty.map((page) => ({ ...page, close: false }));
  }
  const found: { match: PageMatch; score: number }[] = [];
  for (const page of inScope) {
    const ranked = rankFields(words, [{ value: page.label, label: true }, { value: page.detail }]);
    if (ranked) found.push({ match: { ...page, close: ranked.close }, score: ranked.score });
  }
  // Array sort is stable, so equal scores keep the order of the menus.
  found.sort((a, b) => b.score - a.score);
  return found
    .slice(0, scope === 'all' ? pagesShownAll : pagesShownScope)
    .map((item) => item.match);
}
