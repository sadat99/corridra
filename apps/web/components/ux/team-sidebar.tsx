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
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { OperatorIcon } from '../operator-icon';
import { useLanguage } from '../language-provider';
import { subscribeToHash } from '../../lib/address-store';
import { sectionForSlug } from '../../lib/operator-urls';
import { currentTeamSection } from '../../lib/ux/shells';
import {
  itemForPlace,
  placeHref,
  teamItemsFor,
  teamPlacesFor,
  type TeamItem,
  type TeamPlaceId,
} from '../../lib/ux/team-map';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';

const translated: Partial<
  Record<TeamItem['key'], Parameters<ReturnType<typeof useLanguage>['t']>[0]>
> = {
  today: 'wse.team.today',
  missions: 'wse.team.missions',
  companies: 'wse.team.companies',
  meetings: 'wse.team.meetings',
};

export function TeamSidebar({ urls }: { urls: boolean; ownerPage?: boolean }) {
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
  const section = currentTeamSection(pathname, hash, sectionForSlug);
  const place = (section || 'home') as TeamPlaceId;
  const current = itemForPlace(place, role);
  const admin = useRef<HTMLDetailsElement | null>(null);
  const account = useRef<HTMLDetailsElement | null>(null);
  // The Admin group opens by itself on one of its pages, so a deep link lands visibly.
  useEffect(() => {
    if (admin.current && current === 'admin') admin.current.open = true;
    if (account.current && current === 'account') account.current.open = true;
  }, [current]);
  // A section word on a mission page, the owner page or a `#` link is a full page change: the
  // workspace reads the address once, so a soft change could show the old section.
  const plain = pathname !== '/operator' && !sectionForSlug(pathname.split('/')[2] ?? '');
  const label = (item: TeamItem): ReactNode => {
    const key = translated[item.key];
    if (key && locale === 'en') return item.label;
    if (key) {
      const text = t(key);
      return text;
    }
    return locale !== 'en' ? <span lang="en">{item.label}</span> : item.label;
  };
  const english = (text: string): ReactNode =>
    locale !== 'en' ? <span lang="en">{text}</span> : text;
  function link(
    key: string,
    text: ReactNode,
    name: string,
    icon: string,
    target: string,
    active: boolean,
  ) {
    const content = (
      <>
        <OperatorIcon name={icon} />
        <span>{text}</span>
      </>
    );
    // The name shows as a tooltip when the bar is collapsed to icons.
    return plain || target.includes('#') ? (
      <a key={key} href={target} title={name} aria-current={active ? 'page' : undefined}>
        {content}
      </a>
    ) : (
      <Link
        key={key}
        prefetch={false}
        href={target}
        title={name}
        aria-current={active ? 'page' : undefined}
      >
        {content}
      </Link>
    );
  }
  const items = teamItemsFor(role);
  const daily = items.filter((item) => item.key !== 'admin' && item.key !== 'account');
  const adminItem = items.find((item) => item.key === 'admin');
  const accountItem = items.find((item) => item.key === 'account');
  return (
    <nav
      id="workspace-navigation"
      tabIndex={-1}
      className="ux-team-sidebar"
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
                item.label,
                item.icon,
                placeHref(first.id, urls, tenant),
                current === item.key,
              )}
            </li>
          );
        })}
      </ul>
      {adminItem ? (
        <details ref={admin} className="ux-team-group" open={current === 'admin'}>
          <summary aria-current={current === 'admin' ? 'true' : undefined}>
            <OperatorIcon name={adminItem.icon} />
            <span>{label(adminItem)}</span>
            <OperatorIcon name="chevron" className="ux-team-chevron" />
          </summary>
          <ul>
            {teamPlacesFor(adminItem, role).map((entry) => (
              <li key={entry.id}>
                {link(
                  entry.id,
                  english(entry.label),
                  entry.label,
                  'chevron',
                  placeHref(entry.id, urls, tenant),
                  place === entry.id ||
                    (entry.id === 'workspace-settings' &&
                      (place === 'ops-center' || place === 'owner')),
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {accountItem ? (
        <details ref={account} className="ux-team-group" open={current === 'account'}>
          <summary aria-current={current === 'account' ? 'true' : undefined}>
            <OperatorIcon name={accountItem.icon} />
            <span>{label(accountItem)}</span>
            <OperatorIcon name="chevron" className="ux-team-chevron" />
          </summary>
          <ul>
            {teamPlacesFor(accountItem, role).map((entry) => (
              <li key={entry.id}>
                {link(
                  entry.id,
                  english(entry.label),
                  entry.label,
                  'chevron',
                  placeHref(entry.id, urls, tenant),
                  place === entry.id,
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </nav>
  );
}
