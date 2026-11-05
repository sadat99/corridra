// The logic of the shared sub-tabs (components/ux/sub-tabs.tsx), kept apart so it can be tested
// without a browser. A tab is chosen by an old #id first (an old link names a place), then by ?tab=,
// and otherwise the first tab is shown. Navigation only: nothing here grants or removes access.
// Owner: WS-E.

export type SubTabKey = {
  id: string;
  /** Old #ids that now live in this tab and must keep working. */
  aliases?: readonly string[];
};

/**
 * The word in a hash: without the leading #, decoded, and empty when it cannot be decoded. A hash comes
 * from the address bar or a link anyone can write, so a malformed one (such as %E0%A4%A) must never
 * throw into the page; it simply names nothing.
 */
export function safeDecode(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return '';
  }
}

const matches = (tab: SubTabKey, word: string) =>
  tab.id === word || (tab.aliases?.includes(word) ?? false);

/**
 * Which tab an address points at. `panelOf` answers, for an #id that is neither a tab nor an alias,
 * which tab's panel holds the element with that id (the browser asks the page; a test passes a map).
 */
export function resolveSubTab(
  tabs: readonly SubTabKey[],
  search: string,
  hash: string,
  panelOf?: (id: string) => string | null,
): string {
  const word = safeDecode(hash);
  if (word) {
    const direct = tabs.find((tab) => matches(tab, word));
    if (direct) return direct.id;
    const inside = panelOf?.(word);
    if (inside && tabs.some((tab) => tab.id === inside)) return inside;
  }
  const asked = new URLSearchParams(search).get('tab');
  const named = asked ? tabs.find((tab) => matches(tab, asked)) : undefined;
  return (named ?? tabs[0])?.id ?? '';
}

/** The tab index a key moves to, or null for a key that does nothing. The arrows mirror in a right-to-left page. */
export function nextTabIndex(
  count: number,
  current: number,
  key: string,
  rtl: boolean,
): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === forward) return (current + 1) % count;
  if (key === back) return (current - 1 + count) % count;
  return null;
}

/** The query string with ?tab= set to the chosen tab and every other word kept. */
export function withTab(search: string, id: string): string {
  const params = new URLSearchParams(search);
  params.set('tab', id);
  return '?' + params.toString();
}
