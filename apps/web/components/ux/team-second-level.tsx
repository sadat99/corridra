'use client';
// The second level of the Team shell (Navigation v1): the places inside the current sidebar item,
// as a row of links under the page header. At most five. A single place shows no row. Settings
// shows its own three (Corridors and policies, Control Center, Owner page). Counts are not shown
// until a real count exists for a place; no number is invented. Owner: S4.
import './team-nav.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
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
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';

export function TeamSecondLevel({ urls, ownerPage }: { urls: boolean; ownerPage: boolean }) {
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
  const key = itemForPlace(place, role);
  const item = teamItemsFor(role).find((entry) => entry.key === key);
  const places: TeamPlace[] = settings
    ? settingsLevel(role).filter((entry) => entry.id !== 'owner' || ownerPage)
    : item
      ? teamPlacesFor(item, role)
      : [];
  // A mission page belongs to Missions and has no row of its own.
  if (places.length < 2 || !places.some((entry) => entry.id === place)) return null;
  const plain = pathname !== '/operator' && !sectionForSlug(pathname.split('/')[2] ?? '');
  return (
    <nav className="ux-team-second" aria-label="In this section">
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
