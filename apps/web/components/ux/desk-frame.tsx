// The one page pattern of the team desk (team desk v4.1, unit D4), behind CORRIDRA_UX_TEAM_DESK_V41. A page
// names its place and gets what the existing WorkspaceShell needs: the title, the purpose line with at most
// one primary action under it, the shell class that marks the pattern, and the segments to place among the
// shell's first children. No label above the title. A page supplies only its place and, when it has a real
// control for it, the one primary action; the words live in lib/ux/page-pattern.ts. The title, the purpose line
// and the segments follow the address together (an old `#` link shows the page it names).
import type { ReactNode } from 'react';
import { operatorHeaderWords } from '../../app/operator/operator-header';
import type { DeskPlaceId } from '../../lib/ux/page-pattern';
import { DeskLead, DeskTitle, TeamPageSegments } from './desk-segments';
import './page-frame.css';

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
  return {
    title: title ?? <DeskTitle place={place} />,
    lead: <DeskLead place={place} primary={primary} />,
    className: deskFrameClass,
    segments: <TeamPageSegments place={place} urls={urls} ownerPage={ownerPage} />,
  };
}

/**
 * The header of the workspace page (/operator and /operator/<section>) for its switches and address: what
 * operator-entry.tsx hands to WorkspaceShell, and what the test fixture renders, from one function. With the
 * pattern off `lead` and `segments` are nothing and the rest is the header the desk always had.
 */
export function operatorHeader(options: {
  shellsV2: boolean;
  urls: boolean;
  teamDeskV41: boolean;
  section?: string;
  ownerPage: boolean;
}): {
  eyebrow: string | undefined;
  title: ReactNode;
  lead: ReactNode;
  className: string;
  segments: ReactNode;
} {
  const words = operatorHeaderWords(options);
  const frame = words.place
    ? deskFrame({ place: words.place, urls: options.urls, ownerPage: options.ownerPage })
    : null;
  return {
    eyebrow: words.eyebrow,
    title: frame?.title ?? words.title,
    lead: frame?.lead ?? null,
    className: words.className,
    segments: frame?.segments ?? null,
  };
}
