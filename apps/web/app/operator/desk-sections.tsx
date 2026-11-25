'use client';
// Team desk v4.1 (decision 1: no second tab bar). A page that already has segments under its title draws its
// former inner tabs as the parts of one page: the first part in the open, every later part
// as a closed fold. Nothing is removed and nothing is renamed:
//   - a part keeps the id its tab panel had (`anchor`), so an address with that # still lands;
//   - `?tab=` and an old #id (`aliases`) open the part they name and bring it into view;
//   - an element inside a closed part that the address names opens the part (the workspace also opens every
//     fold around the block it lands on);
//   - every part stays in the server HTML, so entries in a closed part survive.
// Navigation only: a part never grants or removes access; its content still checks the role.
// Used only with CORRIDRA_UX_TEAM_DESK_V41 on; with it off the callers draw the shared tabs as before.
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { SubTabs, type SubTab } from '../../components/ux/sub-tabs';
import { useOperatorFlags } from './operator-flags';
import './desk-helpers-status-team.css';
import { resolveSubTab, safeDecode } from '../../lib/ux/sub-tabs';

const onAddressChange = (changed: () => void) => {
  window.addEventListener('hashchange', changed);
  window.addEventListener('popstate', changed);
  return () => {
    window.removeEventListener('hashchange', changed);
    window.removeEventListener('popstate', changed);
  };
};
const pageTitle = () => document.querySelector('main h1')?.textContent?.trim() ?? '';

/**
 * Whether the title of the page already says `words`. A panel whose own heading is the same words then keeps
 * that heading for screen readers only, so a name is printed once in either state of the team desk v4.1
 * switch. Where the title says something else (the old "Your workspace." header) the heading stays in view.
 * The title is read from the page, so a panel needs no knowledge of the shell switches; it is read again after
 * every render, and the first server render shows the heading.
 */
export function usePageTitleSays(words: string): boolean {
  return useSyncExternalStore(
    onAddressChange,
    () => pageTitle() === words,
    () => false,
  );
}

/** Opens the part of the nearest sections that holds `id`. Does nothing when there is no such part. */
export function openDeskSection(from: Element | null, id: string) {
  const part = from
    ?.closest('.ux-desk-sections')
    ?.querySelector<HTMLElement>(`[data-desk-section="${CSS.escape(id)}"]`);
  if (!part) return;
  if (part instanceof HTMLDetailsElement) part.open = true;
  part.scrollIntoView();
  part.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
}

export function DeskSections({
  tabs,
  label,
  className,
}: {
  tabs: readonly SubTab[];
  /** The accessible name of the group of parts. */
  label: string;
  className?: string;
}) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const root = useRef<HTMLDivElement>(null);
  const keys = tabs.map((tab) => [tab.id, ...(tab.aliases ?? [])].join(' ')).join('|');

  useEffect(() => {
    const land = () => {
      const node = root.current;
      // A page that is not the one on screen leaves the address alone.
      if (!node || node.closest('[hidden]')) return;
      const word = safeDecode(window.location.hash);
      const target = word ? document.getElementById(word) : null;
      const inside = target && node.contains(target) ? target : null;
      // An element the address names inside a closed part: the part is opened, the browser or the workspace
      // then goes to the element.
      for (
        let fold = inside?.closest('details') ?? null;
        fold && node.contains(fold);
        fold = fold.parentElement?.closest('details') ?? null
      )
        fold.open = true;
      const asked = new URLSearchParams(window.location.search).get('tab');
      const names = (value: string | null) =>
        !!value && tabs.some((tab) => tab.id === value || tab.aliases?.includes(value));
      if (!names(word) && !names(asked)) return;
      const id = resolveSubTab(tabs, window.location.search, window.location.hash);
      const part = node.querySelector<HTMLElement>(`[data-desk-section="${CSS.escape(id)}"]`);
      if (!part) return;
      if (part instanceof HTMLDetailsElement) part.open = true;
      // The first part is at the top of the page already; a later part is brought into view.
      if (id === tabs[0]?.id || inside) return;
      part.scrollIntoView();
      part.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
    };
    land();
    window.addEventListener('hashchange', land);
    window.addEventListener('popstate', land);
    return () => {
      window.removeEventListener('hashchange', land);
      window.removeEventListener('popstate', land);
    };
    // The parts only change when their keys do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  return (
    <div
      ref={root}
      role="group"
      aria-label={label}
      className={className ? `ux-desk-sections ${className}` : 'ux-desk-sections'}
    >
      {tabs.map((tab, index) => {
        const id = tab.anchor ?? `${base}-part-${tab.id}`;
        return index === 0 ? (
          // The first part is the page itself: the title and the segment already name it, so it has no
          // heading and is no landmark of its own.
          <div key={tab.id} id={id} className="ux-desk-section" data-desk-section={tab.id}>
            {tab.panel}
          </div>
        ) : (
          <details key={tab.id} id={id} className="ux-desk-section" data-desk-section={tab.id}>
            <summary>{tab.label}</summary>
            {tab.panel}
          </details>
        );
      })}
    </div>
  );
}

/**
 * The inner parts of a page that has segments under its title. With the team desk v4.1 switch on they are the
 * parts of one page (no second tab row); with it off they are the shared tabs exactly as before.
 */
export function DeskParts(props: {
  tabs: readonly SubTab[];
  label: string;
  className?: string;
  dormant?: boolean;
}) {
  const { teamDeskV41 } = useOperatorFlags();
  return teamDeskV41 ? (
    <DeskSections tabs={props.tabs} label={props.label} className={props.className} />
  ) : (
    <SubTabs {...props} />
  );
}
