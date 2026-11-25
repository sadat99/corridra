'use client';
// The parts of a team desk page header that follow the address (team desk v4.1, unit D4): the title, the
// purpose line with the one primary action, and the segments of the group the page belongs to. All three read
// ONE place, so they always agree: a `#` part wins (an old link), then the section word of the address, and
// the place the server named is used for the server render and for an address that names no place. The role
// comes from the loaded workspace, the same read the team menu uses. Convenience only: a segment is listed for
// a role that may open it and the server still decides. With the role not yet known only what every role may
// open is listed, so nothing is offered and then taken away.
import { usePathname } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';
import { subscribeToHash } from '../../lib/address-store';
import { sectionForSlug } from '../../lib/operator-urls';
import {
  deskOwnPages,
  deskPattern,
  deskSegmentsFor,
  isDeskPlace,
  type DeskPlaceId,
} from '../../lib/ux/page-pattern';
import { currentTeamSection } from '../../lib/ux/shells';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';
import { PageFrameLead } from './page-frame';
import { SegmentLinks } from './sub-tabs';

/** The place in view. `place` is what the server rendered; the address is read once the page is in the browser. */
export function useDeskPlace(place: DeskPlaceId): DeskPlaceId {
  const pathname = usePathname() ?? '/operator';
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => '',
  );
  const section = currentTeamSection(pathname, hash, sectionForSlug);
  // A page of its own (the Inbox, a Supply page) is the place its server named: its address names no section.
  if (Object.hasOwn(deskOwnPages, place)) return place;
  if (section) return isDeskPlace(section) ? section : place;
  // No `#` part and no section word: the workspace home, or a page of its own that named its place.
  return pathname === '/operator' ? 'home' : place;
}

export function DeskTitle({ place }: { place: DeskPlaceId }) {
  return deskPattern(useDeskPlace(place)).title;
}

/**
 * The header's primary-action slot for a workspace section whose one primary action needs the section's loaded
 * data (unit D11: "Propose Meeting"). The section draws its button into this element; it stays empty, and takes
 * no room, for a role or a state that has no such action.
 */
export const deskPrimarySlotId = 'ux-desk-primary-slot';
const slotPlaces: readonly DeskPlaceId[] = ['workspace-meetings'];

export function DeskLead({ place, primary }: { place: DeskPlaceId; primary?: ReactNode }) {
  const current = useDeskPlace(place);
  const slot = slotPlaces.includes(current) ? (
    <div id={deskPrimarySlotId} className="ux-desk-primary-slot" />
  ) : undefined;
  return <PageFrameLead helper={deskPattern(current).purpose} primary={primary ?? slot} />;
}

export function TeamPageSegments({
  place,
  urls,
  ownerPage,
}: {
  place: DeskPlaceId;
  urls: boolean;
  ownerPage: boolean;
}) {
  const current = useDeskPlace(place);
  const { tenant, role } = useSyncExternalStore(
    subscribeTeamContext,
    readTeamContext,
    readServerTeamContext,
  );
  const { label, segments } = deskSegmentsFor(current, role, {
    urls,
    ownerPage,
    workspace: tenant,
  });
  return <SegmentLinks label={label} segments={segments} />;
}
