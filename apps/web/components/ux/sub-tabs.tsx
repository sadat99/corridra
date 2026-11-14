'use client';
// The shared sub-tabs (layout budget, docs/revamp/specs/layout-budget.md section 2 and test L-03).
// A long page is cut into a few tabs so it fits the page-length limit; nothing is removed. Behaviour:
//   - a labelled tablist of tabs, each tab owning one panel (WAI-ARIA tabs, automatic activation);
//   - the chosen tab is kept in ?tab= (other words in the address are kept), without a page load;
//   - an old #id still lands: a tab id, an alias, or any element inside a panel opens its tab, then
//     the element is scrolled to and focused;
//   - arrow keys, Home and End move between tabs (the arrows mirror in a right-to-left page);
//   - every panel stays in the server HTML, hidden unless chosen, so content is never lost and
//     entries in a hidden panel survive a switch.
// Navigation only: tabs never grant or remove access; each panel's content still checks the role.
// Callers own the count: the layout budget allows at most five visible tabs, with any others under a
// "More" control. This component shows every tab it is given and does not enforce the cap.
// Owner: WS-E (single writer: S4).
import './sub-tabs.css';
import { useCallback, useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useLanguage } from '../language-provider';
import { localeMeta } from '../../lib/i18n/locales';
import { nextTabIndex, resolveSubTab, safeDecode, withTab } from '../../lib/ux/sub-tabs';

export type SubTab = {
  id: string;
  label: ReactNode;
  panel: ReactNode;
  /** Old #ids that now live in this tab and must keep working. */
  aliases?: readonly string[];
  /** An old element id the panel itself takes over, so a link to it lands on this tab. */
  anchor?: string;
};

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  window.addEventListener('hashchange', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
    window.removeEventListener('hashchange', listener);
  };
}

/**
 * Reads the address again for every SubTabs on the page and shows the tab it points at. For an element
 * named by the address that only appeared after the tabs were drawn (a block that loads its data first):
 * the address and the history are left as they are.
 */
export function resolveSubTabsAgain() {
  flushSync(notify);
}

/**
 * Opens the tab that holds an element, if its panel is hidden, and returns once the panel is shown, so
 * the caller can scroll to the element and focus it. For a control that jumps to a heading or a
 * disclosure somewhere on the page (the "Jump to" list of a workbench). Does nothing for an element
 * that is not inside a tab panel or whose panel is already shown.
 */
export function revealInSubTabs(element: Element) {
  const panel = element.closest<HTMLElement>('[data-subtab]');
  if (!panel?.hidden) return;
  const tab = panel.getAttribute('aria-labelledby');
  const button = tab ? document.getElementById(tab) : null;
  // Choosing a tab updates the page before this returns (select flushes the change).
  button?.click();
}

/**
 * Opens a named tab of the SubTabs that holds `from`. For an action inside one tab whose result is shown
 * in another (selecting a mission to review in the Publication tab): the screen then shows the result
 * instead of changing nothing. Does nothing when `from` is not inside SubTabs or the tab does not exist.
 */
export function openSubTab(from: Element | null, id: string) {
  const root = from?.closest('.ux-subtabs');
  const tab = Array.from(root?.querySelectorAll<HTMLElement>('[role="tab"][data-tab]') ?? []).find(
    (button) => button.dataset.tab === id,
  );
  tab?.click();
}

export function SubTabs({
  tabs,
  label,
  className,
  dormant = false,
}: {
  tabs: readonly SubTab[];
  /** The accessible name of the tablist. */
  label: string;
  className?: string;
  /**
   * True while the section that holds these tabs is not the one on screen (several sections share one mounted
   * panel and the others are `hidden`). No tab then claims to be selected, so a page never lists a selected tab
   * from a section nobody can see. The panels, their state and their tab choice are untouched.
   */
  dormant?: boolean;
}) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { locale } = useLanguage();
  const rtl = localeMeta[locale].dir === 'rtl';
  const list = useRef<HTMLDivElement>(null);
  const keys = tabs.map((tab) => ({ id: tab.id, aliases: tab.aliases }));
  const panelDomId = (tab: SubTab) => tab.anchor ?? `${base}-panel-${tab.id}`;
  const tabDomId = (tab: SubTab) => `${base}-tab-${tab.id}`;

  // The chosen tab comes from the address. On the server and in the first render it is the first tab.
  const active = useSyncExternalStore(
    subscribe,
    () =>
      resolveSubTab(keys, window.location.search, window.location.hash, (id) => {
        const element = document.getElementById(id);
        return element?.closest<HTMLElement>('[data-subtab]')?.dataset.subtab ?? null;
      }),
    () => tabs[0]?.id ?? '',
  );

  // An old #id that sits inside a panel: once its tab is shown, go to the element.
  useEffect(() => {
    const word = safeDecode(window.location.hash);
    if (!word) return;
    const element = document.getElementById(word);
    if (!element || element.closest('[hidden]')) return;
    if (!element.closest('[data-subtab]')) return;
    element.scrollIntoView();
    if (element.tabIndex >= 0 || element.matches('a, button, input, select, textarea, [tabindex]'))
      element.focus({ preventScroll: true });
  }, [active]);

  const select = useCallback(
    (id: string) => {
      const url = new URL(window.location.href);
      url.search = withTab(url.search, id);
      // An old #id that pointed into these tabs is replaced by ?tab=. Any other hash stays: on the team
      // workspace the hash names the section being shown, and dropping it would leave that section.
      const word = safeDecode(url.hash);
      const root = list.current?.parentElement;
      const target = word ? document.getElementById(word) : null;
      const pointsHere =
        keys.some((tab) => tab.id === word || tab.aliases?.includes(word)) ||
        (!!target && !!root?.contains(target) && !!target.closest('[data-subtab]'));
      if (pointsHere) url.hash = '';
      window.history.replaceState(window.history.state, '', url);
      flushSync(notify);
    },
    // The tab keys only change when the tabs do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs],
  );

  return (
    <div className={className ? `ux-subtabs ${className}` : 'ux-subtabs'}>
      <div
        ref={list}
        className="ux-subtabs-list"
        role="tablist"
        aria-label={label}
        onKeyDown={(event) => {
          const current = tabs.findIndex((tab) => tab.id === active);
          const next = nextTabIndex(tabs.length, current, event.key, rtl);
          if (next === null || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          const tab = tabs[next]!;
          select(tab.id);
          list.current?.querySelector<HTMLElement>(`[data-tab="${tab.id}"]`)?.focus();
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={tabDomId(tab)}
            type="button"
            role="tab"
            className="ux-subtabs-tab"
            data-tab={tab.id}
            aria-selected={!dormant && tab.id === active}
            aria-controls={panelDomId(tab)}
            tabIndex={!dormant && tab.id === active ? 0 : -1}
            onClick={() => select(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={panelDomId(tab)}
          role="tabpanel"
          className="ux-subtabs-panel"
          data-subtab={tab.id}
          aria-labelledby={tabDomId(tab)}
          hidden={tab.id !== active}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
