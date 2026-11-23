'use client';
// The quiet lines of journey modes (docs/revamp/specs/journey-modes.md 3.7): what a scoped page is showing, with one
// way back to Everything, and the line that says Companies is not sorted by journey. Plain paragraphs, never alerts.
import './journey-note.css';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  hrefForJourneySwitch,
  journeyModeWords,
  type JourneyOfMode,
} from '../../lib/ux/journey-mode';
import { rememberJourneyMode, useJourneyMode } from './journey-mode-context';

/** Sets the mode to Everything and shows the same section again, as the sidebar's switcher does. */
export function ShowEverything({ children = 'Show Everything' }: { children?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  return (
    <button
      type="button"
      className="text-link ux-journey-note-action"
      lang="en"
      onClick={() => {
        rememberJourneyMode('all');
        const here = window.location.pathname + window.location.search + window.location.hash;
        const href = hrefForJourneySwitch(
          pathname,
          window.location.search + window.location.hash,
          'all',
        );
        if (href && href !== here) router.push(href);
        else router.refresh();
      }}
    >
      {children}
    </button>
  );
}

/** Above a list that shows one journey only. */
export function JourneyShowing({ mode }: { mode: JourneyOfMode }) {
  return (
    <p className="ux-journey-note" lang="en">
      Showing {journeyModeWords[mode]}. <ShowEverything />
    </p>
  );
}

/** On Companies while a journey is chosen: the list is the same in every journey. Nothing in Everything. */
export function CompaniesShared() {
  const mode = useJourneyMode();
  if (!mode || mode === 'all') return null;
  return (
    <p className="ux-journey-note" lang="en">
      Companies are shared across all your journeys.
    </p>
  );
}
