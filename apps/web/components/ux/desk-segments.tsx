'use client';
// The segments under a team desk page title (team desk v4.1, unit D4): the pages of the group the page in
// view belongs to, as links to the addresses they always had. The place comes from the address and the role
// from the loaded workspace, the same two reads the team menu uses. Convenience only: a segment is listed for
// a role that may open it and the server still decides. With the role not yet known only what every role may
// open is listed, so nothing is offered and then taken away.
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { subscribeToHash } from '../../lib/address-store';
import { sectionForSlug } from '../../lib/operator-urls';
import { deskSegmentsFor, isDeskPlace } from '../../lib/ux/page-pattern';
import { currentTeamSection } from '../../lib/ux/shells';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';
import { SegmentLinks } from './sub-tabs';

export function TeamPageSegments({ urls, ownerPage }: { urls: boolean; ownerPage: boolean }) {
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
  // A mission page belongs to Missions and any other page under /operator to no group: no segments there.
  const section = currentTeamSection(pathname, hash, sectionForSlug) || 'home';
  if (!isDeskPlace(section)) return null;
  const { label, segments } = deskSegmentsFor(section, role, {
    urls,
    ownerPage,
    workspace: tenant,
  });
  return <SegmentLinks label={label} segments={segments} />;
}
