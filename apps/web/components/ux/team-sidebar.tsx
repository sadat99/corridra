'use client';
// The Team shell sidebar (Navigation v1, docs/revamp/specs/navigation-v1.md): Today, Missions,
// Companies, Meetings and Money, and an Admin group for owner and admin. Every workspace section,
// the owner page and the mission page keep their address; lib/ux/team-map.ts says where each is
// found and the second level (team-second-level.tsx) lists the places inside an item. Convenience
// only: each section still checks the role and the server decides every action. Owner: S4.
import './shells.css';
import './team-nav.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { OperatorIcon } from '../operator-icon';
import { useLanguage } from '../language-provider';
import { translate } from '../../lib/i18n/messages';
import { subscribeToHash } from '../../lib/address-store';
import { sectionForSlug } from '../../lib/operator-urls';
import { currentTeamSection } from '../../lib/ux/shells';
import {
  itemForPlace,
  menuGroupsFor,
  menuItemForAddress,
  menuItemHref,
  menuPlacesFor,
  placeHref,
  teamItemsFor,
  teamPins,
  teamPlacesFor,
  type TeamItem,
  type TeamPlaceId,
} from '../../lib/ux/team-map';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';
import {
  readServerTeamSwitcher,
  readTeamSwitcher,
  subscribeTeamSwitcher,
} from '../../lib/ux/team-desk-v41';
import {
  readPinCounts,
  readServerPinCounts,
  subscribePinCounts,
} from '../../lib/ux/team-pin-counts';

const translated: Partial<
  Record<TeamItem['key'], Parameters<ReturnType<typeof useLanguage>['t']>[0]>
> = {
  today: 'wse.team.today',
  missions: 'wse.team.missions',
  companies: 'wse.team.companies',
  meetings: 'wse.team.meetings',
};

type SidebarProps = {
  urls: boolean;
  ownerPage?: boolean;
  /** CORRIDRA_UX_OPERATOR_DESK: five groups, Settings and checks, and the pinned queues. */
  desk?: boolean;
  /** Report a Problem is offered: only then is its queue pinned. */
  problemReports?: boolean;
  /** CORRIDRA_UX_TEAM_DESK_V41: menu v3. Off, the sidebar is the one above this switch, unchanged. */
  deskV41?: boolean;
  /** CORRIDRA_SUPPLY_SOURCES: the Supply Sources pages exist, so menu v3 may list Supply. */
  supply?: boolean;
};

/** The team sidebar: menu v3 behind CORRIDRA_UX_TEAM_DESK_V41, otherwise the sidebar as it was. */
export function TeamSidebar({ deskV41 = false, supply = false, ...legacy }: SidebarProps) {
  return deskV41 ? (
    <TeamMenuV3 urls={legacy.urls} supply={supply} />
  ) : (
    <TeamSidebarV1 {...legacy} />
  );
}

// The whole address after the path, for the item that is lit. The Settings sub-tabs change ?tab= without a page load
// or an event (history.replaceState), so the address is read again after a click or a key inside the page.
function subscribeToAddress(notify: () => void) {
  const later = () => window.setTimeout(notify, 0);
  const stopHash = subscribeToHash(notify);
  document.addEventListener('click', later);
  document.addEventListener('keyup', later);
  return () => {
    stopHash();
    document.removeEventListener('click', later);
    document.removeEventListener('keyup', later);
  };
}
const readAddress = () => window.location.search + window.location.hash;
const readServerAddress = () => '';

/**
 * Menu v3 (team desk v4.1, decision 1): Work, People and companies, Results, Admin. Every item is one link; there is
 * no second level and no expander. Which item a role sees and where it leads is lib/ux/team-map.ts (`menuV3`); the
 * addresses are the ones every earlier link used. Inbox shows no number (decision 5): this menu reads no queue.
 */
function TeamMenuV3({ urls, supply }: { urls: boolean; supply: boolean }) {
  const { t, locale } = useLanguage();
  const pathname = usePathname() ?? '/operator';
  const address = useSyncExternalStore(subscribeToAddress, readAddress, readServerAddress);
  const { tenant, role } = useSyncExternalStore(
    subscribeTeamContext,
    readTeamContext,
    readServerTeamContext,
  );
  const switcher = useSyncExternalStore(
    subscribeTeamSwitcher,
    readTeamSwitcher,
    readServerTeamSwitcher,
  );
  const base = useId();
  const cut = address.indexOf('#');
  const search = cut < 0 ? address : address.slice(0, cut);
  const hash = cut < 0 ? '' : address.slice(cut);
  const place = (currentTeamSection(pathname, hash, sectionForSlug) || 'home') as TeamPlaceId;
  const options = { supply };
  const lit = menuItemForAddress({ place, pathname, search, hash }, role, options);
  // As in the sidebar before it: a section word on a page that is not the workspace is a full page change.
  const plain = pathname !== '/operator' && !sectionForSlug(pathname.split('/')[2] ?? '');
  const english = (text: string): ReactNode =>
    locale !== 'en' ? <span lang="en">{text}</span> : text;
  return (
    <nav
      id="workspace-navigation"
      tabIndex={-1}
      className="ux-team-sidebar ux-team-menu"
      data-menu="v3"
      aria-label={t('wse.team.nav')}
    >
      {/* The workspace switch sits at the top of the menu. The loaded workspace publishes its list and its own
          guarded change (the unsaved-entries question); a page that does not mount it leaves only the link. */}
      <div className="ux-team-menu-workspace">
        {switcher ? (
          <div className="ux-team-menu-switch" lang={locale !== 'en' ? 'en' : undefined}>
            <label htmlFor="operator-workspace-select">Workspace</label>
            <select
              id="operator-workspace-select"
              disabled={switcher.busy}
              value={switcher.current}
              onChange={(event) => switcher.choose(event.target.value)}
            >
              {switcher.workspaces.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <a href="/workspace" title="All Workspaces">
          <OperatorIcon name="grid" />
          <span>{english('All Workspaces')}</span>
        </a>
      </div>
      {menuGroupsFor(role, options).map((group) => {
        const heading = `${base}-${group.key}`;
        return (
          <div
            key={group.key}
            className="ux-team-menu-group"
            role="group"
            aria-labelledby={heading}
          >
            <p id={heading} className="ux-team-menu-heading">
              {english(group.label)}
            </p>
            <ul>
              {group.items.map((item) => {
                const key = translated[item.key as TeamItem['key']];
                const text = key ? t(key) : item.label;
                const words =
                  locale !== 'en' && (!key || text === translate('en', key)) ? english(text) : text;
                const target = menuItemHref(item, role, urls, tenant);
                const lead = menuPlacesFor(item, role)[0]?.id;
                // "page" on the item whose own page is open; "true" when a segment or a page inside it is open.
                const current =
                  lit !== item.key
                    ? undefined
                    : item.special ||
                        (lead === place && !/^\/operator\/[^/]+\/[^/]+/.test(pathname))
                      ? ('page' as const)
                      : ('true' as const);
                const content = (
                  <>
                    <OperatorIcon name={item.icon} />
                    <span>{words}</span>
                  </>
                );
                return (
                  <li key={item.key}>
                    {plain || item.special || target.includes('#') ? (
                      <a href={target} title={text} aria-current={current}>
                        {content}
                      </a>
                    ) : (
                      <Link prefetch={false} href={target} title={text} aria-current={current}>
                        {content}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function TeamSidebarV1({
  urls,
  desk = false,
  problemReports = false,
}: Omit<SidebarProps, 'deskV41' | 'supply'>) {
  const { t, locale } = useLanguage();
  const pathname = usePathname() ?? '/operator';
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => '',
  );
  const { tenant, role } = useSyncExternalStore(
    subscribeTeamContext,
    readTeamContext,
    readServerTeamContext,
  );
  const counts = useSyncExternalStore(subscribePinCounts, readPinCounts, readServerPinCounts);
  const section = currentTeamSection(pathname, hash, sectionForSlug);
  const place = (section || 'home') as TeamPlaceId;
  const current = itemForPlace(place, role, desk);
  const adminNote = useId();
  const admin = useRef<HTMLDetailsElement | null>(null);
  // The Admin group opens by itself on one of its pages, so a deep link lands visibly.
  useEffect(() => {
    if (admin.current && current === 'admin') admin.current.open = true;
  }, [current]);
  // A section word on a mission page, the owner page or a `#` link is a full page change: the
  // workspace reads the address once, so a soft change could show the old section.
  const plain = pathname !== '/operator' && !sectionForSlug(pathname.split('/')[2] ?? '');
  // The visible words of an item, in the chosen language where one exists; also its tooltip.
  const labelText = (item: TeamItem): string => {
    const key = translated[item.key];
    return key ? t(key) : item.label;
  };
  const label = (item: TeamItem): ReactNode => {
    const key = translated[item.key];
    const text = labelText(item);
    const untranslated = !key || text === translate('en', key);
    return locale !== 'en' && untranslated ? <span lang="en">{text}</span> : text;
  };
  const english = (text: string): ReactNode =>
    locale !== 'en' ? <span lang="en">{text}</span> : text;
  type Current = 'page' | 'true' | undefined;
  /** "page" only on the link of the page itself; a parent of the current page is "true". */
  const mark = (own: boolean, parent: boolean): Current =>
    own ? 'page' : parent ? 'true' : undefined;
  function link(
    key: string,
    text: ReactNode,
    name: string,
    icon: string | null,
    target: string,
    current: Current,
  ) {
    const content = (
      <>
        {icon ? <OperatorIcon name={icon} /> : null}
        <span>{text}</span>
      </>
    );
    // The name shows as a tooltip when the bar is collapsed to icons.
    return plain || target.includes('#') ? (
      <a key={key} href={target} title={name} aria-current={current}>
        {content}
      </a>
    ) : (
      <Link key={key} prefetch={false} href={target} title={name} aria-current={current}>
        {content}
      </Link>
    );
  }
  const items = teamItemsFor(role, desk);
  const pins = desk ? teamPins(role, problemReports, urls, tenant) : [];
  const daily = items.filter((item) => item.key !== 'admin');
  const adminItem = items.find((item) => item.key === 'admin');
  return (
    <nav
      id="workspace-navigation"
      tabIndex={-1}
      className="ux-team-sidebar"
      data-desk={desk ? 'true' : undefined}
      aria-label={t('wse.team.nav')}
    >
      <ul>
        {daily.map((item) => {
          const first = teamPlacesFor(item, role)[0];
          if (!first) return null;
          return (
            <li key={item.key}>
              {link(
                item.key,
                label(item),
                labelText(item),
                item.icon,
                placeHref(first.id, urls, tenant),
                mark(place === first.id, current === item.key),
              )}
            </li>
          );
        })}
      </ul>
      {adminItem ? (
        <details ref={admin} className="ux-team-group" open={current === 'admin'}>
          <summary
            title={labelText(adminItem)}
            aria-describedby={adminNote}
            aria-current={current === 'admin' ? 'true' : undefined}
          >
            <OperatorIcon name={adminItem.icon} />
            <span>{label(adminItem)}</span>
            {/* The board's caption. Hidden from the name (the name stays "Admin") and read as its description. */}
            <small id={adminNote} className="ux-team-caption" aria-hidden="true">
              {english('Owner and admin')}
            </small>
            <OperatorIcon name="chevron" className="ux-team-chevron" />
          </summary>
          <ul>
            {teamPlacesFor(adminItem, role).map((entry) => (
              <li key={entry.id}>
                {link(
                  entry.id,
                  english(entry.label),
                  entry.label,
                  null,
                  placeHref(entry.id, urls, tenant),
                  mark(
                    place === entry.id,
                    entry.id === 'workspace-settings' &&
                      (place === 'ops-center' || place === 'owner'),
                  ),
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {pins.length > 0 ? (
        <ul className="ux-team-pins" aria-label="Queues">
          {pins.map((pin) => {
            const count = pin.id === 'problem-reports' ? counts.problemReports : counts.erasure;
            const text =
              count === null
                ? null
                : pin.id === 'erasure' && counts.erasureAtLeast
                  ? `${count}+`
                  : count;
            return (
              <li key={pin.id}>
                <a href={pin.href} title={pin.label}>
                  <span>{english(pin.label)}</span>
                  {text !== null ? <span className="ux-team-pin-count">{text}</span> : null}
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </nav>
  );
}
