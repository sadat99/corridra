'use client';
// The second level of the Team shell (Navigation v1): the places inside the current sidebar item,
// as a row of links under the page header. At most five. A single place shows no row. Settings
// shows its own three (Routes and settings, Control Center, Owner page). Counts are not shown
// until a real count exists for a place; no number is invented. Owner: S4.
import './team-nav.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useContext, useSyncExternalStore } from 'react';
import { useLanguage } from '../language-provider';
import { subscribeToHash } from '../../lib/address-store';
import { sectionForSlug } from '../../lib/operator-urls';
import { currentTeamSection } from '../../lib/ux/shells';
import {
  itemForPlace,
  placeHref,
  settingsLevel,
  teamItemsFor,
  teamPlacesFor,
  type TeamPlace,
  type TeamPlaceId,
} from '../../lib/ux/team-map';
import { TeamDeskV41Context } from '../../lib/ux/team-desk-v41';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';

export function TeamSecondLevel({
  urls,
  ownerPage,
  desk = false,
}: {
  urls: boolean;
  ownerPage: boolean;
  desk?: boolean;
}) {
  const deskV41 = useContext(TeamDeskV41Context);
  const { locale } = useLanguage();
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
  const settings = place === 'workspace-settings' || place === 'ops-center' || place === 'owner';
  const key = itemForPlace(place, role, desk);
  const item = teamItemsFor(role, desk).find((entry) => entry.key === key);
  const places: TeamPlace[] = settings
    ? settingsLevel(role).filter((entry) => entry.id !== 'owner' || ownerPage)
    : item
      ? teamPlacesFor(item, role)
      : [];
  // The row shows only on a page that is one of its places, and never for a single place. A mission page is
  // inside Missions, so it shows the Missions row.
  // Team desk v4.1 (decision 1): no second level and no second tab bar. Menu v3 holds every item.
  if (deskV41) return null;
  if (places.length < 2 || !places.some((entry) => entry.id === place)) return null;
  const plain = pathname !== '/operator' && !sectionForSlug(pathname.split('/')[2] ?? '');
  return (
    <nav
      className="ux-team-second"
      aria-label="In this section"
      lang={locale !== 'en' ? 'en' : undefined}
    >
      <ul>
        {places.map((entry) => {
          const target = placeHref(entry.id, urls, tenant);
          const active = entry.id === place;
          const content = locale !== 'en' ? <span lang="en">{entry.label}</span> : entry.label;
          return (
            <li key={entry.id}>
              {plain || target.includes('#') ? (
                <a href={target} aria-current={active ? 'page' : undefined}>
                  {content}
                </a>
              ) : (
                <Link prefetch={false} href={target} aria-current={active ? 'page' : undefined}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
