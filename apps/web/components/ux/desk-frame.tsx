// The one page pattern of the team desk (team desk v4.1, unit D4), behind CORRIDRA_UX_TEAM_DESK_V41. A page
// names its place and gets what the existing WorkspaceShell needs: the title, the purpose line with at most
// one primary action under it, the shell class that marks the pattern for the screen units, and the segments to
// place as the shell's first child. No label above the title. A page supplies only its place and, when it has
// a real control for it, the one primary action; the words live in lib/ux/page-pattern.ts.
import type { ReactNode } from 'react';
import { deskPattern, type DeskPlaceId } from '../../lib/ux/page-pattern';
import { TeamPageSegments } from './desk-segments';
import { PageFrameLead } from './page-frame';

export const deskFrameClass = 'ux-desk-frame';

export function deskFrame({
  place,
  urls,
  ownerPage,
  primary,
  title,
}: {
  place: DeskPlaceId;
  /** Section addresses are on (CORRIDRA_UX_OPERATOR_URLS), so a segment opens `/operator/<word>`. */
  urls: boolean;
  /** The owner page is on and this person may open it, so Settings lists it. */
  ownerPage: boolean;
  /** The one primary action of the page. Never more than one, and only a control that works today. */
  primary?: ReactNode;
  /** A title the page already has and keeps (a mission's name). Left out, the place's own word is used. */
  title?: ReactNode;
}): { title: ReactNode; lead: ReactNode; className: string; segments: ReactNode } {
  const pattern = deskPattern(place);
  return {
    title: title ?? pattern.title,
    lead: <PageFrameLead helper={pattern.purpose} primary={primary} />,
    className: deskFrameClass,
    segments: <TeamPageSegments urls={urls} ownerPage={ownerPage} />,
  };
}
